const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReservationConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReservationConflictError';
    this.statusCode = 409;
    this.code = 'RESERVATION_DATE_CONFLICT';
    this.details = details;
  }
}

const dateOnly = (value) => {
  if (typeof value === 'string' && DATE_RE.test(value.slice(0, 10))) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

export function buildOccupiedDateRange(startDate, endDate) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (!start || !end || start >= end) {
    throw Object.assign(new Error('Check-out must be later than check-in.'), { statusCode: 400, code: 'INVALID_DATE_RANGE' });
  }
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const limit = new Date(`${end}T00:00:00Z`);
  while (cursor < limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function reserveInventoryDateRange(connection, {
  inventoryItemId,
  bookingId,
  startDate,
  endDate,
  excludeBookingId = null,
  itemName = 'Inventory item',
}) {
  const itemId = Number(inventoryItemId);
  const bid = Number(bookingId);
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(bid) || bid <= 0) {
    throw Object.assign(new Error('Valid inventory item and booking IDs are required.'), { statusCode: 400, code: 'INVALID_RESERVATION_TARGET' });
  }
  const dates = buildOccupiedDateRange(startDate, endDate);

  // All writers lock the same inventory row first. This serializes concurrent
  // attempts before checking occupied_dates and closes the check/insert race.
  const [inventory] = await connection.query(
    'SELECT item_id, name FROM inventory_items WHERE item_id = ? FOR UPDATE',
    [itemId],
  );
  if (!inventory.length) throw Object.assign(new Error('Inventory item was not found.'), { statusCode: 404, code: 'INVENTORY_NOT_FOUND' });

  const params = [itemId, dates[0], dates[dates.length - 1]];
  let exclusion = '';
  if (Number(excludeBookingId) > 0) {
    exclusion = 'AND od.booking_id <> ?';
    params.push(Number(excludeBookingId));
  }
  const [conflicts] = await connection.query(
    `SELECT od.occupied_date, od.booking_id, b.booking_reference
       FROM occupied_dates od
       LEFT JOIN bookings b ON b.booking_id = od.booking_id
      WHERE od.inventory_item_id = ?
        AND od.occupied_date BETWEEN ? AND ?
        ${exclusion}
      ORDER BY od.occupied_date
      LIMIT 1
      FOR UPDATE`,
    params,
  );
  if (conflicts.length) {
    const conflict = conflicts[0];
    throw new ReservationConflictError(
      `${itemName} is already reserved on ${dateOnly(conflict.occupied_date)}${conflict.booking_reference ? ` by ${conflict.booking_reference}` : ''}.`,
      { inventoryItemId: itemId, occupiedDate: dateOnly(conflict.occupied_date), conflictingBookingId: conflict.booking_id },
    );
  }

  try {
    for (const date of dates) {
      await connection.query(
        'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES (?, ?, ?)',
        [itemId, bid, date],
      );
    }
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new ReservationConflictError(`${itemName} was reserved by another request. Please select different dates.`, { inventoryItemId: itemId });
    }
    throw error;
  }
  return dates;
}

export function sendReservationWriteError(res, error, fallbackMessage) {
  const status = error?.statusCode || (error?.code === 'ER_DUP_ENTRY' ? 409 : 500);
  return res.status(status).json({
    success: false,
    message: status === 500 ? fallbackMessage : error.message,
    code: error?.code === 'ER_DUP_ENTRY' ? 'RESERVATION_DATE_CONFLICT' : error?.code,
    ...(error?.details ? { details: error.details } : {}),
  });
}

