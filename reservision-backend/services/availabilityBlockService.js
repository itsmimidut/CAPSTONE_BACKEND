import db from '../config/db.js';
import { BLOCKING_BOOKING_STATUSES } from '../constants/bookingStatusRules.js';
import { expireStalePendingBookings } from './pendingBookingExpiryService.js';
import {
  AVAILABILITY_BLOCK_STATUSES,
  AVAILABILITY_BLOCK_TYPES,
} from '../constants/availabilityBlockTypes.js';

const normalizeTimeValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = String(match[1]).padStart(2, '0');
  const minutes = String(match[2]).padStart(2, '0');
  const seconds = String(match[3] || '00').padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const normalizeDateValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const pad2 = (n) => String(n).padStart(2, '0');

const toHHMM = (timeValue) => {
  const normalized = normalizeTimeValue(timeValue);
  if (!normalized) return null;
  return normalized.slice(0, 5);
};

const toMinutes = (value) => {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return (h * 60) + m;
};

const timesOverlap = (startA, endA, startB, endB) => {
  const aStart = toMinutes(startA);
  const aEnd = toMinutes(endA);
  const bStart = toMinutes(startB);
  const bEnd = toMinutes(endB);
  if ([aStart, aEnd, bStart, bEnd].some((v) => v == null)) return false;
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && aEnd > bStart;
};

const enumerateInclusiveDates = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    dates.push(normalizeDateValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const mapBlockRow = (row) => ({
  id: row.id,
  inventory_item_id: row.inventory_item_id,
  category_type: row.category_type,
  block_type: row.block_type,
  reason: row.reason,
  notes: row.notes,
  start_date: normalizeDateValue(row.start_date),
  end_date: normalizeDateValue(row.end_date),
  start_time: toHHMM(row.start_time),
  end_time: toHHMM(row.end_time),
  status: row.status,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
  item_name: row.item_name || null,
});

export const validateBlockPayload = (payload, { isUpdate = false } = {}) => {
  const errors = [];
  const categoryType = String(payload.category_type || '').trim().toLowerCase();
  const blockType = String(payload.block_type || '').trim().toLowerCase();
  const status = payload.status ? String(payload.status).trim() : 'Active';
  const startDate = normalizeDateValue(payload.start_date);
  const endDate = normalizeDateValue(payload.end_date);
  const startTime = toHHMM(payload.start_time);
  const endTime = toHHMM(payload.end_time);
  const reason = String(payload.reason || '').trim();

  if (!isUpdate) {
    if (!Number.isFinite(Number(payload.inventory_item_id)) || Number(payload.inventory_item_id) <= 0) {
      errors.push('inventory_item_id is required.');
    }
    if (!['room', 'cottage', 'event'].includes(categoryType)) {
      errors.push('category_type must be room, cottage, or event.');
    }
    if (!AVAILABILITY_BLOCK_TYPES.includes(blockType)) {
      errors.push('block_type is invalid.');
    }
    if (!startDate) errors.push('start_date is required.');
    if (!reason) errors.push('reason is required.');
  }

  if (payload.status && !AVAILABILITY_BLOCK_STATUSES.includes(status)) {
    errors.push('status must be Active or Inactive.');
  }

  if (categoryType === 'event' || payload.category_type === 'event') {
    if (!startTime) errors.push('start_time is required for event areas.');
    if (!endTime) errors.push('end_time is required for event areas.');
    if (startTime && endTime && toMinutes(endTime) <= toMinutes(startTime)) {
      errors.push('end_time must be later than start_time.');
    }
  } else if (['room', 'cottage'].includes(categoryType)) {
    if (!endDate) errors.push('end_date is required for rooms and cottages.');
    if (startDate && endDate && endDate < startDate) {
      errors.push('end_date must be the same or after start_date.');
    }
  }

  return {
    errors,
    normalized: {
      inventory_item_id: Number(payload.inventory_item_id),
      category_type: categoryType,
      block_type: blockType,
      reason,
      notes: payload.notes ? String(payload.notes).trim() : null,
      start_date: startDate,
      end_date: endDate || startDate,
      start_time: startTime,
      end_time: endTime,
      status,
    },
  };
};

async function getInventoryItemMeta(conn, inventoryItemId) {
  const [rows] = await conn.query(
    `SELECT item_id, name, category_type, status
     FROM inventory_items
     WHERE item_id = ?
     LIMIT 1`,
    [inventoryItemId]
  );
  return rows[0] || null;
}

async function checkRoomBookingConflict(conn, inventoryItemId, startDate, endDate) {
  const [rows] = await conn.query(
    `SELECT b.booking_reference, b.booking_status
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND b.check_in_date IS NOT NULL
       AND b.check_out_date IS NOT NULL
       AND b.check_in_date <= ?
       AND b.check_out_date > ?
     LIMIT 1`,
    [
      inventoryItemId,
      ...BLOCKING_BOOKING_STATUSES,
      endDate,
      startDate,
    ]
  );
  return rows[0] || null;
}

async function checkCottageBookingConflict(conn, inventoryItemId, startDate, endDate) {
  const dates = enumerateInclusiveDates(startDate, endDate);
  for (const date of dates) {
    const [occupiedRows] = await conn.query(
      `SELECT b.booking_reference, b.booking_status
       FROM occupied_dates od
       INNER JOIN bookings b ON b.booking_id = od.booking_id
       WHERE od.inventory_item_id = ?
         AND od.occupied_date = ?
         AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       LIMIT 1`,
      [inventoryItemId, date, ...BLOCKING_BOOKING_STATUSES]
    );
    if (occupiedRows.length) return occupiedRows[0];

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
        date,
        date,
        date,
      ]
    );
    if (fallbackRows.length) return fallbackRows[0];
  }
  return null;
}

async function checkEventBookingConflict(conn, inventoryItemId, bookingDate, startTime, endTime) {
  const normalizedStart = normalizeTimeValue(startTime);
  const normalizedEnd = normalizeTimeValue(endTime);

  const [rows] = await conn.query(
    `SELECT b.booking_reference, b.booking_status, bi.start_time, bi.end_time, bi.item_description
     FROM bookings b
     INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
     WHERE bi.inventory_item_id = ?
       AND b.booking_status IN (${BLOCKING_BOOKING_STATUSES.map(() => '?').join(', ')})
       AND bi.booking_date = ?`,
    [inventoryItemId, ...BLOCKING_BOOKING_STATUSES, bookingDate]
  );

  const conflict = rows.find((row) => {
    let rowStart = row.start_time;
    let rowEnd = row.end_time;
    if (!rowStart || !rowEnd) {
      try {
        const parsed = JSON.parse(row.item_description || '{}');
        rowStart = parsed.start_time || parsed.startTime;
        rowEnd = parsed.end_time || parsed.endTime;
      } catch {
        return false;
      }
    }
    return timesOverlap(normalizedStart, normalizedEnd, rowStart, rowEnd);
  });

  return conflict || null;
}

async function checkBlockOverlap(conn, {
  inventoryItemId,
  categoryType,
  startDate,
  endDate,
  startTime,
  endTime,
  excludeBlockId = null,
}) {
  const params = [inventoryItemId, categoryType];
  let excludeSql = '';
  if (excludeBlockId) {
    excludeSql = ' AND ab.id <> ?';
    params.push(excludeBlockId);
  }

  const [rows] = await conn.query(
    `SELECT *
     FROM availability_blocks ab
     WHERE ab.inventory_item_id = ?
       AND ab.category_type = ?
       AND ab.status = 'Active'
       ${excludeSql}`,
    params
  );

  if (categoryType === 'event') {
    return rows.find((row) => {
      const rowDate = normalizeDateValue(row.start_date);
      if (rowDate !== startDate) return false;
      return timesOverlap(startTime, endTime, row.start_time, row.end_time);
    }) || null;
  }

  return rows.find((row) => {
    const rowStart = normalizeDateValue(row.start_date);
    const rowEnd = normalizeDateValue(row.end_date || row.start_date);
    return startDate <= rowEnd && endDate >= rowStart;
  }) || null;
}

export async function checkBlockSaveConflicts(payload, excludeBlockId = null, connection = null) {
  const conn = connection || db;
  await expireStalePendingBookings(conn);
  const {
    inventory_item_id: inventoryItemId,
    category_type: categoryType,
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
  } = payload;

  const item = await getInventoryItemMeta(conn, inventoryItemId);
  if (!item) {
    return { success: false, reason: 'NOT_FOUND', message: 'Inventory item not found.' };
  }
  if (String(item.category_type).toLowerCase() !== categoryType) {
    return { success: false, reason: 'INVALID_CATEGORY', message: 'Category type does not match inventory item.' };
  }

  let bookingConflict = null;
  if (categoryType === 'room') {
    bookingConflict = await checkRoomBookingConflict(conn, inventoryItemId, startDate, endDate);
  } else if (categoryType === 'cottage') {
    bookingConflict = await checkCottageBookingConflict(conn, inventoryItemId, startDate, endDate);
  } else {
    bookingConflict = await checkEventBookingConflict(conn, inventoryItemId, startDate, startTime, endTime);
  }

  if (bookingConflict) {
    return {
      success: false,
      reason: categoryType === 'event' ? 'BLOCK_CONFLICT' : 'BOOKING_CONFLICT',
      message: categoryType === 'event'
        ? 'This event area already has a booking or block during the selected time.'
        : 'This item already has a booking during the selected block period.',
      conflict: bookingConflict,
    };
  }

  const blockConflict = await checkBlockOverlap(conn, {
    inventoryItemId,
    categoryType,
    startDate,
    endDate: endDate || startDate,
    startTime,
    endTime,
    excludeBlockId,
  });

  if (blockConflict) {
    return {
      success: false,
      reason: 'BLOCK_CONFLICT',
      message: categoryType === 'event'
        ? 'This event area already has a booking or block during the selected time.'
        : 'This item already has an active block during the selected period.',
      conflict: blockConflict,
    };
  }

  return { success: true };
}

export async function listAvailabilityBlocks(filters = {}, connection = null) {
  const conn = connection || db;
  const params = [];
  let sql = `
    SELECT ab.*, ii.name AS item_name
    FROM availability_blocks ab
    LEFT JOIN inventory_items ii ON ii.item_id = ab.inventory_item_id
    WHERE 1 = 1
  `;

  if (filters.inventory_item_id) {
    sql += ' AND ab.inventory_item_id = ?';
    params.push(Number(filters.inventory_item_id));
  }
  if (filters.category_type) {
    sql += ' AND ab.category_type = ?';
    params.push(String(filters.category_type).toLowerCase());
  }
  if (filters.status) {
    sql += ' AND ab.status = ?';
    params.push(filters.status);
  }
  if (filters.start_date) {
    sql += ' AND COALESCE(ab.end_date, ab.start_date) >= ?';
    params.push(normalizeDateValue(filters.start_date));
  }
  if (filters.end_date) {
    sql += ' AND ab.start_date <= ?';
    params.push(normalizeDateValue(filters.end_date));
  }

  sql += ' ORDER BY ab.start_date DESC, ab.id DESC';

  const [rows] = await conn.query(sql, params);
  return rows.map(mapBlockRow);
}

export async function getAvailabilityBlockById(id, connection = null) {
  const conn = connection || db;
  const [rows] = await conn.query(
    `SELECT ab.*, ii.name AS item_name
     FROM availability_blocks ab
     LEFT JOIN inventory_items ii ON ii.item_id = ab.inventory_item_id
     WHERE ab.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapBlockRow(rows[0]) : null;
}

export async function createAvailabilityBlock(payload, createdBy = null, connection = null) {
  const conn = connection || db;
  const { errors, normalized } = validateBlockPayload(payload);
  if (errors.length) {
    return { success: false, message: errors.join(' ') };
  }

  const conflict = await checkBlockSaveConflicts(normalized, null, conn);
  if (!conflict.success) return conflict;

  const [result] = await conn.query(
    `INSERT INTO availability_blocks (
      inventory_item_id, category_type, block_type, reason, notes,
      start_date, end_date, start_time, end_time, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.inventory_item_id,
      normalized.category_type,
      normalized.block_type,
      normalized.reason,
      normalized.notes,
      normalized.start_date,
      normalized.category_type === 'event' ? normalized.start_date : normalized.end_date,
      normalized.category_type === 'event' ? `${normalized.start_time}:00` : null,
      normalized.category_type === 'event' ? `${normalized.end_time}:00` : null,
      normalized.status,
      createdBy,
    ]
  );

  const block = await getAvailabilityBlockById(result.insertId, conn);
  return { success: true, data: block };
}

export async function updateAvailabilityBlock(id, payload, connection = null) {
  const conn = connection || db;
  const existing = await getAvailabilityBlockById(id, conn);
  if (!existing) {
    return { success: false, message: 'Block not found.' };
  }

  const merged = {
    inventory_item_id: existing.inventory_item_id,
    category_type: existing.category_type,
    block_type: payload.block_type ?? existing.block_type,
    reason: payload.reason ?? existing.reason,
    notes: payload.notes ?? existing.notes,
    start_date: payload.start_date ?? existing.start_date,
    end_date: payload.end_date ?? existing.end_date,
    start_time: payload.start_time ?? existing.start_time,
    end_time: payload.end_time ?? existing.end_time,
    status: payload.status ?? existing.status,
  };

  const { errors, normalized } = validateBlockPayload(merged, { isUpdate: true });
  if (errors.length) {
    return { success: false, message: errors.join(' ') };
  }

  const conflict = await checkBlockSaveConflicts(normalized, id, conn);
  if (!conflict.success) return conflict;

  await conn.query(
    `UPDATE availability_blocks
     SET block_type = ?, reason = ?, notes = ?, start_date = ?, end_date = ?,
         start_time = ?, end_time = ?, status = ?
     WHERE id = ?`,
    [
      normalized.block_type,
      normalized.reason,
      normalized.notes,
      normalized.start_date,
      normalized.category_type === 'event' ? normalized.start_date : normalized.end_date,
      normalized.category_type === 'event' ? `${normalized.start_time}:00` : null,
      normalized.category_type === 'event' ? `${normalized.end_time}:00` : null,
      normalized.status,
      id,
    ]
  );

  const block = await getAvailabilityBlockById(id, conn);
  return { success: true, data: block };
}

export async function deleteAvailabilityBlock(id, connection = null) {
  const conn = connection || db;
  const existing = await getAvailabilityBlockById(id, conn);
  if (!existing) {
    return { success: false, message: 'Block not found.' };
  }

  await conn.query('DELETE FROM availability_blocks WHERE id = ?', [id]);
  return { success: true, message: 'Block deleted.' };
}

export async function findManualBlockConflict(payload, connection = null) {
  const conn = connection || db;
  const categoryType = String(payload.category_type || '').trim().toLowerCase();
  const inventoryItemId = Number(payload.inventory_item_id);

  if (categoryType === 'room') {
    const checkIn = normalizeDateValue(payload.check_in_date);
    const checkOut = normalizeDateValue(payload.check_out_date);
    if (!checkIn || !checkOut) return null;

    const [rows] = await conn.query(
      `SELECT block_type, reason, notes, start_date, end_date
       FROM availability_blocks
       WHERE inventory_item_id = ?
         AND category_type = 'room'
         AND status = 'Active'
         AND start_date < ?
         AND COALESCE(end_date, start_date) >= ?
       LIMIT 1`,
      [inventoryItemId, checkOut, checkIn]
    );
    return rows[0] || null;
  }

  if (categoryType === 'cottage') {
    const bookingDate = normalizeDateValue(payload.booking_date || payload.check_in_date);
    if (!bookingDate) return null;

    const [rows] = await conn.query(
      `SELECT block_type, reason, notes, start_date, end_date
       FROM availability_blocks
       WHERE inventory_item_id = ?
         AND category_type = 'cottage'
         AND status = 'Active'
         AND start_date <= ?
         AND COALESCE(end_date, start_date) >= ?
       LIMIT 1`,
      [inventoryItemId, bookingDate, bookingDate]
    );
    return rows[0] || null;
  }

  if (categoryType === 'event') {
    const bookingDate = normalizeDateValue(payload.booking_date);
    const startTime = normalizeTimeValue(payload.start_time);
    const endTime = normalizeTimeValue(payload.end_time);
    if (!bookingDate || !startTime || !endTime) return null;

    const [rows] = await conn.query(
      `SELECT block_type, reason, notes, start_time, end_time
       FROM availability_blocks
       WHERE inventory_item_id = ?
         AND category_type = 'event'
         AND status = 'Active'
         AND start_date = ?`,
      [inventoryItemId, bookingDate]
    );

    return rows.find((row) => timesOverlap(startTime, endTime, row.start_time, row.end_time)) || null;
  }

  return null;
}

export async function fetchDateRangeBlocksForMonth(conn, inventoryItemId, categoryType, monthStart, monthEnd) {
  const [rows] = await conn.query(
    `SELECT id, block_type, reason, notes, start_date, end_date
     FROM availability_blocks
     WHERE inventory_item_id = ?
       AND category_type = ?
       AND status = 'Active'
       AND start_date <= ?
       AND COALESCE(end_date, start_date) >= ?`,
    [inventoryItemId, categoryType, monthEnd, monthStart]
  );

  const blocksByDate = new Map();
  rows.forEach((row) => {
    const start = normalizeDateValue(row.start_date);
    const end = normalizeDateValue(row.end_date || row.start_date);
    enumerateInclusiveDates(start, end).forEach((date) => {
      if (date < monthStart || date > monthEnd) return;
      if (!blocksByDate.has(date) || row.block_type === 'maintenance') {
        blocksByDate.set(date, {
          block_type: row.block_type,
          reason: row.reason,
          notes: row.notes,
          block_id: row.id,
        });
      }
    });
  });

  return blocksByDate;
}

export async function fetchEventBlocksForMonth(conn, inventoryItemId, monthStart, monthEnd) {
  const [rows] = await conn.query(
    `SELECT id, block_type, reason, notes, start_date, start_time, end_time
     FROM availability_blocks
     WHERE inventory_item_id = ?
       AND category_type = 'event'
       AND status = 'Active'
       AND start_date BETWEEN ? AND ?`,
    [inventoryItemId, monthStart, monthEnd]
  );

  const blocksByDate = new Map();
  rows.forEach((row) => {
    const date = normalizeDateValue(row.start_date);
    if (!date) return;
    if (!blocksByDate.has(date)) blocksByDate.set(date, []);
    blocksByDate.get(date).push({
      start_time: toHHMM(row.start_time),
      end_time: toHHMM(row.end_time),
      status: 'blocked',
      block_type: row.block_type,
      reason: row.reason,
      notes: row.notes,
      block_id: row.id,
    });
  });

  blocksByDate.forEach((slots, date) => {
    slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    blocksByDate.set(date, slots);
  });

  return blocksByDate;
}

export const mapBlockToCalendarStatus = (blockType) => (
  blockType === 'maintenance' ? 'maintenance' : 'blocked'
);
