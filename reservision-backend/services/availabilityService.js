import db from '../config/db.js';
import {
  BLOCKING_BOOKING_STATUSES,
} from '../constants/bookingStatusRules.js';
import { isBookableInventoryStatus } from './inventoryBookabilityService.js';
import {
  fetchDateRangeBlocksForMonth,
  fetchEventBlocksForMonth,
  findManualBlockConflict,
  mapBlockToCalendarStatus,
} from './availabilityBlockService.js';
import { expireStalePendingBookings } from './pendingBookingExpiryService.js';

export const normalizeTimeValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = String(match[1]).padStart(2, '0');
  const minutes = String(match[2]).padStart(2, '0');
  const seconds = String(match[3] || '00').padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

export const normalizeDateValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toMinutes = (value) => {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return (h * 60) + m;
};

const isUnavailableItemStatus = (status) => !isBookableInventoryStatus(status);

const responseAvailable = () => ({
  success: true,
  available: true,
  reason: null,
  message: 'This item is available.'
});

const responseConflict = (bookingReference, status) => ({
  success: true,
  available: false,
  reason: 'BOOKING_CONFLICT',
  message: 'This item is already booked for the selected date/time.',
  conflict: {
    booking_reference: bookingReference || null,
    status: status || null
  }
});

const responseItemUnavailable = () => ({
  success: true,
  available: false,
  reason: 'ITEM_UNAVAILABLE',
  message: 'This item is currently unavailable or under maintenance.'
});

const responseManualBlock = (block) => ({
  success: true,
  available: false,
  reason: 'MANUAL_BLOCK',
  message: 'This item is blocked by admin for the selected date/time.',
  conflict: {
    block_type: block.block_type || null,
    reason: block.reason || null,
  },
});

const responseInvalid = (message, reason = 'INVALID_REQUEST') => ({
  success: false,
  available: false,
  reason,
  message
});

const getInventoryItem = async (connection, inventoryItemId) => {
  const conn = connection || db;
  const [rows] = await conn.query(
    `SELECT item_id, category_type, status
     FROM inventory_items
     WHERE item_id = ?
     LIMIT 1`,
    [inventoryItemId]
  );
  return rows[0] || null;
};

let bookingItemsColumnsCache = null;
const getBookingItemsColumns = async (connection) => {
  if (bookingItemsColumnsCache) return bookingItemsColumnsCache;
  const conn = connection || db;
  const [rows] = await conn.query('SHOW COLUMNS FROM booking_items');
  bookingItemsColumnsCache = new Set(rows.map((row) => row.Field));
  return bookingItemsColumnsCache;
};

export const checkRoomAvailability = async (payload, connection = null) => {
  await expireStalePendingBookings(connection);
  const inventoryItemId = Number(payload.inventory_item_id);
  const checkIn = normalizeDateValue(payload.check_in_date);
  const checkOut = normalizeDateValue(payload.check_out_date);

  if (!checkIn || !checkOut) {
    return responseInvalid('Check-in and check-out dates are required.');
  }
  if (checkOut <= checkIn) {
    return responseInvalid('Check-out date must be after check-in date.');
  }

  const conn = connection || db;
  const [rows] = await conn.query(
    `SELECT b.booking_reference, b.booking_status
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND ? < b.check_out_date
       AND ? > b.check_in_date
     LIMIT 1`,
    [
      inventoryItemId,
      ...BLOCKING_BOOKING_STATUSES,
      checkIn,
      checkOut
    ]
  );

  if (rows.length > 0) {
    return responseConflict(rows[0].booking_reference, rows[0].booking_status);
  }

  const manualBlock = await findManualBlockConflict({
    category_type: 'room',
    inventory_item_id: inventoryItemId,
    check_in_date: checkIn,
    check_out_date: checkOut,
  }, conn);

  if (manualBlock) {
    return responseManualBlock(manualBlock);
  }

  return responseAvailable();
};

export const checkCottageAvailability = async (payload, connection = null) => {
  await expireStalePendingBookings(connection);
  const inventoryItemId = Number(payload.inventory_item_id);
  const bookingDate = normalizeDateValue(payload.booking_date || payload.check_in_date);
  if (!bookingDate) {
    return responseInvalid('Booking date is required for cottages.');
  }

  const conn = connection || db;

  const [occupiedRows] = await conn.query(
    `SELECT b.booking_reference, b.booking_status
     FROM occupied_dates od
     INNER JOIN bookings b ON b.booking_id = od.booking_id
     WHERE od.inventory_item_id = ?
       AND od.occupied_date = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
     LIMIT 1`,
    [
      inventoryItemId,
      bookingDate,
      ...BLOCKING_BOOKING_STATUSES
    ]
  );

  if (occupiedRows.length > 0) {
    return responseConflict(occupiedRows[0].booking_reference, occupiedRows[0].booking_status);
  }

  const [fallbackRows] = await conn.query(
    `SELECT b.booking_reference, b.booking_status
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND (
         (b.check_in_date IS NOT NULL AND b.check_out_date IS NOT NULL
             AND ? >= b.check_in_date AND ? < b.check_out_date)
         OR (b.check_in_date IS NOT NULL AND b.check_out_date IS NULL
             AND b.check_in_date = ?)
       )
     LIMIT 1`,
    [
      inventoryItemId,
      ...BLOCKING_BOOKING_STATUSES,
      bookingDate,
      bookingDate,
      bookingDate
    ]
  );

  if (fallbackRows.length > 0) {
    return responseConflict(fallbackRows[0].booking_reference, fallbackRows[0].booking_status);
  }

  const manualBlock = await findManualBlockConflict({
    category_type: 'cottage',
    inventory_item_id: inventoryItemId,
    booking_date: bookingDate,
  }, conn);

  if (manualBlock) {
    return responseManualBlock(manualBlock);
  }

  return responseAvailable();
};

const parseEventFromDescription = (rawDescription) => {
  if (!rawDescription) return null;
  try {
    const parsed = typeof rawDescription === 'string' ? JSON.parse(rawDescription) : rawDescription;
    return {
      bookingDate: normalizeDateValue(parsed.booking_date || parsed.bookingDate),
      startTime: normalizeTimeValue(parsed.start_time || parsed.startTime),
      endTime: normalizeTimeValue(parsed.end_time || parsed.endTime)
    };
  } catch {
    return null;
  }
};

export const checkEventAreaAvailability = async (payload, connection = null) => {
  await expireStalePendingBookings(connection);
  const inventoryItemId = Number(payload.inventory_item_id);
  const bookingDate = normalizeDateValue(payload.booking_date);
  const startTime = normalizeTimeValue(payload.start_time);
  const endTime = normalizeTimeValue(payload.end_time);

  if (!bookingDate) return responseInvalid('Booking date is required.');
  if (!startTime || !endTime) return responseInvalid('Start time and end time are required.');
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    return responseInvalid('End time must be later than start time.');
  }

  const conn = connection || db;
  const columns = await getBookingItemsColumns(conn);

  if (columns.has('booking_date') && columns.has('start_time') && columns.has('end_time')) {
    const [rows] = await conn.query(
      `SELECT b.booking_reference, b.booking_status
       FROM bookings b
       INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
       WHERE bi.inventory_item_id = ?
         AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
         AND bi.booking_date = ?
         AND bi.start_time < ?
         AND bi.end_time > ?
       LIMIT 1`,
      [
        inventoryItemId,
        ...BLOCKING_BOOKING_STATUSES,
        bookingDate,
        endTime,
        startTime
      ]
    );

    if (rows.length > 0) {
      return responseConflict(rows[0].booking_reference, rows[0].booking_status);
    }
  } else {
    const [rows] = await conn.query(
      `SELECT b.booking_reference, b.booking_status, bi.item_description
       FROM bookings b
       INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
       WHERE bi.inventory_item_id = ?
         AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})`,
      [
        inventoryItemId,
        ...BLOCKING_BOOKING_STATUSES
      ]
    );

    const conflict = rows.find((row) => {
      const eventMeta = parseEventFromDescription(row.item_description);
      if (!eventMeta || eventMeta.bookingDate !== bookingDate) return false;
      const existingStart = toMinutes(eventMeta.startTime);
      const existingEnd = toMinutes(eventMeta.endTime);
      const requestedStart = toMinutes(startTime);
      const requestedEnd = toMinutes(endTime);
      if ([existingStart, existingEnd, requestedStart, requestedEnd].some((v) => v == null)) return false;
      return requestedStart < existingEnd && requestedEnd > existingStart;
    });

    if (conflict) {
      return responseConflict(conflict.booking_reference, conflict.booking_status);
    }
  }

  const manualBlock = await findManualBlockConflict({
    category_type: 'event',
    inventory_item_id: inventoryItemId,
    booking_date: bookingDate,
    start_time: startTime,
    end_time: endTime,
  }, conn);

  if (manualBlock) {
    return responseManualBlock(manualBlock);
  }

  return responseAvailable();
};

export const checkAvailability = async (payload = {}, connection = null) => {
  const inventoryItemId = Number(payload.inventory_item_id);
  const requestedCategory = String(payload.category_type || '').trim().toLowerCase();

  if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
    return responseInvalid('Inventory item is required.');
  }

  if (!requestedCategory) {
    return responseInvalid('Category type is required.');
  }

  const item = await getInventoryItem(connection, inventoryItemId);
  if (!item) {
    return responseInvalid('Inventory item not found.');
  }

  const dbCategory = String(item.category_type || '').toLowerCase();
  if (dbCategory !== requestedCategory) {
    return responseInvalid(
      `Category type mismatch. Selected item is ${dbCategory}, but request used ${requestedCategory}.`,
      'CATEGORY_MISMATCH'
    );
  }

  if (isUnavailableItemStatus(item.status)) {
    return responseItemUnavailable();
  }

  if (requestedCategory === 'room') {
    return checkRoomAvailability(payload, connection);
  }
  if (requestedCategory === 'cottage') {
    return checkCottageAvailability(payload, connection);
  }
  if (requestedCategory === 'event') {
    return checkEventAreaAvailability(payload, connection);
  }

  return responseInvalid('Invalid category type.', 'INVALID_CATEGORY_TYPE');
};

const pad2 = (n) => String(n).padStart(2, '0');

const getMonthBounds = (year, month) => {
  const y = Number(year);
  const m = Number(month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${pad2(m)}-01`;
  const monthEnd = `${y}-${pad2(m)}-${pad2(daysInMonth)}`;
  return { monthStart, monthEnd, daysInMonth, year: y, month: m };
};

const enumerateMonthDates = ({ year, month, daysInMonth }) => {
  const dates = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    dates.push(`${year}-${pad2(month)}-${pad2(day)}`);
  }
  return dates;
};

const mapInventoryStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'under maintenance') {
    return { status: 'maintenance', block_type: 'maintenance' };
  }
  if (normalized === 'unavailable') {
    return { status: 'unavailable', block_type: null };
  }
  return null;
};

const isDateInRoomStay = (dateYmd, checkIn, checkOut) => {
  const checkInYmd = normalizeDateValue(checkIn);
  const checkOutYmd = normalizeDateValue(checkOut);
  if (!checkInYmd || !checkOutYmd) return false;
  return dateYmd >= checkInYmd && dateYmd < checkOutYmd;
};

async function fetchRoomBookingsForMonth(conn, inventoryItemId, monthStart, monthEnd) {
  const [rows] = await conn.query(
    `SELECT
        b.booking_reference,
        b.booking_status,
        b.check_in_date,
        b.check_out_date,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS guest_name
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND b.check_in_date IS NOT NULL
       AND b.check_out_date IS NOT NULL
       AND b.check_in_date <= ?
       AND b.check_out_date > ?
     ORDER BY b.check_in_date ASC`,
    [
      inventoryItemId,
      ...BLOCKING_BOOKING_STATUSES,
      monthEnd,
      monthStart,
    ]
  );
  return rows;
}

async function fetchCottageBookingsForMonth(conn, inventoryItemId, monthStart, monthEnd) {
  const [occupiedRows] = await conn.query(
    `SELECT
        DATE_FORMAT(od.occupied_date, '%Y-%m-%d') AS occupied_date,
        b.booking_reference,
        b.booking_status,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS guest_name
     FROM occupied_dates od
     INNER JOIN bookings b ON b.booking_id = od.booking_id
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE od.inventory_item_id = ?
       AND od.occupied_date BETWEEN ? AND ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
     ORDER BY od.occupied_date ASC`,
    [
      inventoryItemId,
      monthStart,
      monthEnd,
      ...BLOCKING_BOOKING_STATUSES,
    ]
  );

  const bookedByDate = new Map();
  occupiedRows.forEach((row) => {
    const date = normalizeDateValue(row.occupied_date);
    if (!date || bookedByDate.has(date)) return;
    bookedByDate.set(date, {
      booking_reference: row.booking_reference,
      booking_status: row.booking_status,
      guest_name: String(row.guest_name || '').trim() || null,
      block_type: 'booking',
    });
  });

  const [fallbackRows] = await conn.query(
    `SELECT
        b.booking_reference,
        b.booking_status,
        b.check_in_date,
        b.check_out_date,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS guest_name
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND (
         (b.check_in_date IS NOT NULL AND b.check_out_date IS NOT NULL
           AND b.check_in_date <= ? AND b.check_out_date > ?)
         OR (b.check_in_date IS NOT NULL AND b.check_out_date IS NULL
           AND b.check_in_date BETWEEN ? AND ?)
       )
     ORDER BY b.check_in_date ASC`,
    [
      inventoryItemId,
      ...BLOCKING_BOOKING_STATUSES,
      monthEnd,
      monthStart,
      monthStart,
      monthEnd,
    ]
  );

  fallbackRows.forEach((row) => {
    const checkIn = normalizeDateValue(row.check_in_date);
    const checkOut = normalizeDateValue(row.check_out_date);
    const bookingInfo = {
      booking_reference: row.booking_reference,
      booking_status: row.booking_status,
      guest_name: String(row.guest_name || '').trim() || null,
      block_type: 'booking',
    };

    if (checkIn && checkOut) {
      const cursor = new Date(`${checkIn}T00:00:00`);
      const end = new Date(`${checkOut}T00:00:00`);
      while (cursor < end) {
        const ymd = normalizeDateValue(cursor);
        if (ymd >= monthStart && ymd <= monthEnd && !bookedByDate.has(ymd)) {
          bookedByDate.set(ymd, bookingInfo);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return;
    }

    if (checkIn && checkIn >= monthStart && checkIn <= monthEnd && !bookedByDate.has(checkIn)) {
      bookedByDate.set(checkIn, bookingInfo);
    }
  });

  return bookedByDate;
}

const toHHMM = (timeValue) => {
  const normalized = normalizeTimeValue(timeValue);
  if (!normalized) return null;
  return normalized.slice(0, 5);
};

const parseEventTypeFromRow = (row) => {
  if (row.event_purpose) return String(row.event_purpose).trim() || null;
  if (!row.item_description) return null;
  try {
    const parsed = typeof row.item_description === 'string'
      ? JSON.parse(row.item_description)
      : row.item_description;
    return String(
      parsed.event_type
      || parsed.custom_event_type
      || parsed.purpose
      || ''
    ).trim() || null;
  } catch {
    return null;
  }
};

const mapEventBookingRow = (row) => {
  let bookingDate = normalizeDateValue(row.booking_date);
  let startTime = toHHMM(row.start_time);
  let endTime = toHHMM(row.end_time);

  if (!bookingDate || !startTime || !endTime) {
    const parsed = parseEventFromDescription(row.item_description);
    bookingDate = bookingDate || parsed?.bookingDate || null;
    startTime = startTime || toHHMM(parsed?.startTime);
    endTime = endTime || toHHMM(parsed?.endTime);
  }

  if (!bookingDate || !startTime || !endTime) return null;

  return {
    date: bookingDate,
    start_time: startTime,
    end_time: endTime,
    status: 'booked',
    block_type: 'booking',
    booking_reference: row.booking_reference,
    booking_status: row.booking_status,
    event_type: parseEventTypeFromRow(row),
    customer_name: String(row.customer_name || '').trim() || null,
  };
};

async function fetchEventBookingsForMonth(conn, inventoryItemId, monthStart, monthEnd) {
  const columns = await getBookingItemsColumns(conn);
  const hasScheduleColumns = columns.has('booking_date')
    && columns.has('start_time')
    && columns.has('end_time');

  const eventPurposeSelect = columns.has('event_purpose') ? ', bi.event_purpose' : '';

  const baseSelect = `SELECT
      b.booking_reference,
      b.booking_status,
      bi.item_description,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS customer_name
      ${eventPurposeSelect}`;

  const baseJoin = `
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     INNER JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
     WHERE bi.inventory_item_id = ?
       AND ii.category_type = 'event'
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})`;

  let rows = [];

  if (hasScheduleColumns) {
    const [scheduleRows] = await conn.query(
      `${baseSelect},
        DATE_FORMAT(bi.booking_date, '%Y-%m-%d') AS booking_date,
        bi.start_time,
        bi.end_time
      ${baseJoin}
        AND bi.booking_date BETWEEN ? AND ?
      ORDER BY bi.booking_date ASC, bi.start_time ASC`,
      [
        inventoryItemId,
        ...BLOCKING_BOOKING_STATUSES,
        monthStart,
        monthEnd,
      ]
    );
    rows = scheduleRows;
  } else {
    const [fallbackRows] = await conn.query(
      `${baseSelect}
      ${baseJoin}
      ORDER BY b.booking_id ASC`,
      [
        inventoryItemId,
        ...BLOCKING_BOOKING_STATUSES,
      ]
    );
    rows = fallbackRows;
  }

  const bookingsByDate = new Map();

  rows.forEach((row) => {
    const mapped = mapEventBookingRow(row);
    if (!mapped) return;
    if (mapped.date < monthStart || mapped.date > monthEnd) return;

    if (!bookingsByDate.has(mapped.date)) {
      bookingsByDate.set(mapped.date, []);
    }

    const { date, ...slot } = mapped;
    bookingsByDate.get(date).push(slot);
  });

  bookingsByDate.forEach((slots, date) => {
    slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    bookingsByDate.set(date, slots);
  });

  return bookingsByDate;
}

export const getAvailabilityCalendar = async ({
  category_type,
  inventory_item_id,
  month,
  year,
}, connection = null) => {
  await expireStalePendingBookings(connection);
  const categoryType = String(category_type || '').trim().toLowerCase();
  const inventoryItemId = Number(inventory_item_id);
  const bounds = getMonthBounds(year, month);

  if (!['room', 'cottage', 'event'].includes(categoryType)) {
    return {
      success: false,
      message: 'category_type must be room, cottage, or event.',
    };
  }

  if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
    return {
      success: false,
      message: 'inventory_item_id is required.',
    };
  }

  if (!Number.isFinite(bounds.year) || bounds.year < 2000 || bounds.year > 2100) {
    return { success: false, message: 'Invalid year.' };
  }

  if (!Number.isFinite(bounds.month) || bounds.month < 1 || bounds.month > 12) {
    return { success: false, message: 'Invalid month.' };
  }

  const conn = connection || db;
  const item = await getInventoryItem(conn, inventoryItemId);

  if (!item) {
    return { success: false, message: 'Inventory item not found.' };
  }

  const dbCategory = String(item.category_type || '').toLowerCase();
  if (dbCategory !== categoryType) {
    return {
      success: false,
      reason: 'CATEGORY_MISMATCH',
      message: `Category type mismatch. Selected item is ${dbCategory}, but request used ${categoryType}.`,
    };
  }

  const [itemRows] = await conn.query(
    `SELECT item_id, name, category_type, status
     FROM inventory_items
     WHERE item_id = ?
     LIMIT 1`,
    [inventoryItemId]
  );
  const itemMeta = itemRows[0] || {};
  const inventoryStatus = mapInventoryStatus(itemMeta.status);
  const dates = enumerateMonthDates(bounds);

  if (inventoryStatus) {
    const dayPayload = categoryType === 'event'
      ? {
        item_status: itemMeta.status,
        slots: [],
      }
      : {
        block_type: inventoryStatus.block_type,
      };

    return {
      success: true,
      item: {
        item_id: itemMeta.item_id,
        name: itemMeta.name,
        category_type: itemMeta.category_type,
        status: itemMeta.status,
      },
      month: bounds.month,
      year: bounds.year,
      data: dates.map((date) => ({
        date,
        status: inventoryStatus.status,
        ...dayPayload,
      })),
    };
  }

  const data = [];

  if (categoryType === 'event') {
    const bookingsByDate = await fetchEventBookingsForMonth(
      conn,
      inventoryItemId,
      bounds.monthStart,
      bounds.monthEnd
    );
    const blocksByDate = await fetchEventBlocksForMonth(
      conn,
      inventoryItemId,
      bounds.monthStart,
      bounds.monthEnd
    );

    dates.forEach((date) => {
      const bookingSlots = bookingsByDate.get(date) || [];
      const blockSlots = blocksByDate.get(date) || [];
      const slots = [...bookingSlots, ...blockSlots].sort((a, b) => a.start_time.localeCompare(b.start_time));

      if (!slots.length) {
        data.push({
          date,
          status: 'available',
          item_status: itemMeta.status,
          slots: [],
        });
        return;
      }

      data.push({
        date,
        status: 'partially_booked',
        item_status: itemMeta.status,
        slots,
      });
    });
  } else if (categoryType === 'room') {
    const bookings = await fetchRoomBookingsForMonth(
      conn,
      inventoryItemId,
      bounds.monthStart,
      bounds.monthEnd
    );
    const blocksByDate = await fetchDateRangeBlocksForMonth(
      conn,
      inventoryItemId,
      'room',
      bounds.monthStart,
      bounds.monthEnd
    );

    dates.forEach((date) => {
      const block = blocksByDate.get(date);
      const match = bookings.find((row) => isDateInRoomStay(
        date,
        row.check_in_date,
        row.check_out_date
      ));

      if (match) {
        data.push({
          date,
          status: 'booked',
          block_type: 'booking',
          booking_reference: match.booking_reference,
          booking_status: match.booking_status,
          guest_name: String(match.guest_name || '').trim() || null,
          check_in_date: normalizeDateValue(match.check_in_date),
          check_out_date: normalizeDateValue(match.check_out_date),
        });
        return;
      }

      if (block) {
        data.push({
          date,
          status: mapBlockToCalendarStatus(block.block_type),
          block_type: block.block_type,
          reason: block.reason,
          notes: block.notes,
          block_id: block.block_id,
        });
        return;
      }

      data.push({ date, status: 'available', block_type: null });
    });
  } else {
    const bookedByDate = await fetchCottageBookingsForMonth(
      conn,
      inventoryItemId,
      bounds.monthStart,
      bounds.monthEnd
    );
    const blocksByDate = await fetchDateRangeBlocksForMonth(
      conn,
      inventoryItemId,
      'cottage',
      bounds.monthStart,
      bounds.monthEnd
    );

    dates.forEach((date) => {
      const match = bookedByDate.get(date);
      if (match) {
        data.push({
          date,
          status: 'booked',
          block_type: 'booking',
          booking_reference: match.booking_reference,
          booking_status: match.booking_status,
          guest_name: match.guest_name,
        });
        return;
      }

      const block = blocksByDate.get(date);
      if (block) {
        data.push({
          date,
          status: mapBlockToCalendarStatus(block.block_type),
          block_type: block.block_type,
          reason: block.reason,
          notes: block.notes,
          block_id: block.block_id,
        });
        return;
      }

      data.push({ date, status: 'available', block_type: null });
    });
  }

  return {
    success: true,
    item: {
      item_id: itemMeta.item_id,
      name: itemMeta.name,
      category_type: itemMeta.category_type,
      status: itemMeta.status,
    },
    month: bounds.month,
    year: bounds.year,
    data,
  };
};
