import crypto from 'node:crypto';
import db from '../config/db.js';
import { reserveInventoryDateRange } from './reservationConflictService.js';

const MAX_ROWS = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_RE = /^[+()\d][+()\d\s-]{6,19}$/;
const ITEM_TYPES = new Map([
  ['room', 'Room'], ['cottage', 'Cottage'], ['event', 'Event'], ['swimming', 'Swimming'],
]);
const BOOKING_STATUSES = new Map([
  ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['checked-in', 'Checked-In'],
  ['checked_in', 'Checked-In'], ['checked-out', 'Checked-Out'], ['checked_out', 'Checked-Out'],
  ['completed', 'Checked-Out'], ['cancelled', 'Cancelled'], ['canceled', 'Cancelled'],
]);
const PAYMENT_STATUSES = new Map([
  ['unpaid', 'Unpaid'], ['pending', 'Unpaid'], ['partially paid', 'Partially Paid'],
  ['partially_paid', 'Partially Paid'], ['paid', 'Paid'], ['refunded', 'Refunded'],
]);
const PAYMENT_METHODS = new Map([
  ['cash', 'Cash'], ['credit card', 'Credit Card'], ['credit_card', 'Credit Card'],
  ['debit card', 'Debit Card'], ['debit_card', 'Debit Card'], ['bank transfer', 'Bank Transfer'],
  ['bank_transfer', 'Bank Transfer'], ['gcash', 'GCash'], ['paymaya', 'PayMaya'],
]);

const text = (value, max = 255) => String(value ?? '').trim().slice(0, max);
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const integer = (value, fallback = 0) => Math.max(0, Math.trunc(number(value, fallback)));
const mapValue = (map, value) => map.get(text(value).toLowerCase()) || null;

function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateDiff(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

export function normalizeImportRow(input = {}, index = 0) {
  const guestName = text(input.guestName || input.guest_name, 200);
  const nameParts = guestName.split(/\s+/).filter(Boolean);
  const firstName = text(input.firstName || input.first_name || nameParts.shift(), 100);
  const lastName = text(input.lastName || input.last_name || nameParts.join(' ') || 'Legacy Guest', 100);
  const checkIn = text(input.checkIn || input.check_in || input.check_in_date, 10);
  const checkOut = text(input.checkOut || input.check_out || input.check_out_date, 10);
  const itemType = mapValue(ITEM_TYPES, input.itemType || input.item_type);
  const bookingStatus = mapValue(BOOKING_STATUSES, input.bookingStatus || input.booking_status);
  const paymentStatus = mapValue(PAYMENT_STATUSES, input.paymentStatus || input.payment_status);
  const suppliedPaymentMethod = text(input.paymentMethod || input.payment_method);
  const paymentMethod = mapValue(PAYMENT_METHODS, suppliedPaymentMethod);
  const numericInputs = {
    adults: input.adults, children: input.children, seniors: input.seniors, infants: input.infants,
    totalAmount: input.totalAmount ?? input.total_amount ?? input.total,
    amountPaid: input.amountPaid ?? input.amount_paid,
  };
  const adults = integer(input.adults);
  const children = integer(input.children);
  const seniors = integer(input.seniors);
  const infants = integer(input.infants);
  const totalAmount = Math.max(0, number(input.totalAmount ?? input.total_amount ?? input.total));

  return {
    rowNumber: integer(input.rowNumber || input.row_number, index + 2),
    legacyReference: text(input.legacyReference || input.legacy_reference || input.reservationCode || input.reservation_code, 120),
    firstName,
    lastName,
    email: text(input.email, 255).toLowerCase(),
    phone: text(input.phone || input.contactNumber || input.contact_number, 20),
    itemType,
    itemName: text(input.itemName || input.item_name || input.roomFacility || input.room_facility, 255),
    inventoryItemId: integer(input.inventoryItemId || input.inventory_item_id) || null,
    checkIn,
    checkOut,
    adults,
    children,
    seniors,
    infants,
    totalGuests: adults + children + seniors + infants,
    totalAmount,
    amountPaid: Math.max(0, number(input.amountPaid ?? input.amount_paid)),
    paymentMethod,
    paymentStatus,
    bookingStatus,
    notes: text(input.notes || input.special_requests, 2000),
    inputValidity: {
      paymentMethod: Boolean(paymentMethod),
      adults: numericInputs.adults === '' || numericInputs.adults == null || (Number.isInteger(Number(numericInputs.adults)) && Number(numericInputs.adults) >= 0),
      children: numericInputs.children === '' || numericInputs.children == null || (Number.isInteger(Number(numericInputs.children)) && Number(numericInputs.children) >= 0),
      seniors: numericInputs.seniors === '' || numericInputs.seniors == null || (Number.isInteger(Number(numericInputs.seniors)) && Number(numericInputs.seniors) >= 0),
      infants: numericInputs.infants === '' || numericInputs.infants == null || (Number.isInteger(Number(numericInputs.infants)) && Number(numericInputs.infants) >= 0),
      totalAmount: numericInputs.totalAmount !== '' && numericInputs.totalAmount != null && Number.isFinite(Number(numericInputs.totalAmount)) && Number(numericInputs.totalAmount) >= 0,
      amountPaid: numericInputs.amountPaid === '' || numericInputs.amountPaid == null || (Number.isFinite(Number(numericInputs.amountPaid)) && Number(numericInputs.amountPaid) >= 0),
      suppliedPaymentMethod,
    },
  };
}

function basicValidation(row) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!row.firstName) add('FIRST_NAME_REQUIRED', 'First name or guest name is required.');
  if (row.email && !EMAIL_RE.test(row.email)) add('INVALID_EMAIL', 'Email address is invalid.');
  if (row.phone && !CONTACT_RE.test(row.phone)) add('INVALID_CONTACT_NUMBER', 'Contact number is invalid.');
  if (!row.itemType) add('INVALID_ITEM_TYPE', 'Item type must be Room, Cottage, Event, or Swimming.');
  if (!row.itemName && !row.inventoryItemId) add('ITEM_REQUIRED', 'Item name or inventory item ID is required.');
  if (!validDate(row.checkIn)) add('INVALID_CHECK_IN', 'Check-in must be a valid YYYY-MM-DD date.');
  if (!validDate(row.checkOut)) add('INVALID_CHECK_OUT', 'Check-out must be a valid YYYY-MM-DD date.');
  if (validDate(row.checkIn) && validDate(row.checkOut) && dateDiff(row.checkIn, row.checkOut) < 1) {
    add('INVALID_DATE_RANGE', 'Check-out must be later than check-in.');
  }
  if (!row.bookingStatus) add('INVALID_BOOKING_STATUS', 'Booking status is invalid.');
  if (!row.paymentStatus) add('INVALID_PAYMENT_STATUS', 'Payment status is invalid.');
  if (!row.inputValidity.paymentMethod) add('INVALID_PAYMENT_METHOD', `Payment method "${row.inputValidity.suppliedPaymentMethod || '(blank)'}" is invalid.`);
  ['adults', 'children', 'seniors', 'infants'].forEach((field) => {
    if (!row.inputValidity[field]) add(`INVALID_${field.toUpperCase()}`, `${field[0].toUpperCase()}${field.slice(1)} must be a non-negative whole number.`);
  });
  if (!row.inputValidity.totalAmount) add('INVALID_TOTAL', 'Total amount must be a non-negative number.');
  if (!row.inputValidity.amountPaid) add('INVALID_AMOUNT_PAID', 'Amount paid must be a non-negative number.');
  if (row.totalAmount < 0) add('INVALID_TOTAL', 'Total amount cannot be negative.');
  if (row.amountPaid > row.totalAmount) add('AMOUNT_PAID_EXCEEDS_TOTAL', 'Amount paid cannot exceed total amount.');
  return errors;
}

async function resolveInventory(row, executor = db) {
  if (!row.itemType) return null;
  const params = [];
  let where;
  if (row.inventoryItemId) {
    where = 'item_id = ?';
    params.push(row.inventoryItemId);
  } else {
    where = 'LOWER(TRIM(name)) = LOWER(TRIM(?))';
    params.push(row.itemName);
  }
  const [items] = await executor.query(
    `SELECT item_id, name, category_type, category, status FROM inventory_items WHERE ${where} LIMIT 2`,
    params,
  );
  return items.length === 1 ? items[0] : null;
}

async function inspectRow(row, executor = db) {
  const errors = basicValidation(row);
  const warnings = [];
  const today = new Date().toISOString().slice(0, 10);
  const historical = validDate(row.checkOut) && row.checkOut < today;
  let duplicate = false;
  let inventory = null;

  if (!errors.length) {
    const clauses = [];
    const params = [];
    if (row.legacyReference) {
      clauses.push('(legacy_reference = ? OR booking_reference = ?)');
      params.push(row.legacyReference, row.legacyReference);
    }
    if (row.email) {
      clauses.push('(LOWER(email) = LOWER(?) AND check_in_date = ? AND check_out_date = ?)');
      params.push(row.email, row.checkIn, row.checkOut);
    } else if (!row.legacyReference) {
      clauses.push('(LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND check_in_date = ? AND check_out_date = ?)');
      params.push(row.firstName, row.lastName, row.checkIn, row.checkOut);
    }
    const [matches] = await executor.query(
      `SELECT booking_id, booking_reference FROM bookings WHERE ${clauses.join(' OR ')} LIMIT 1`,
      params,
    );
    duplicate = matches.length > 0;
    if (duplicate) errors.push({ code: 'DUPLICATE_BOOKING', message: `Matches existing booking ${matches[0].booking_reference}.` });

    inventory = await resolveInventory(row, executor);
    if (!inventory) {
      errors.push({ code: 'INVENTORY_NOT_FOUND', message: 'No unique inventory item matches the supplied item.' });
    } else if (inventory) {
      row.inventoryItemId = Number(inventory.item_id);
      row.itemName = inventory.name;
    }

    if (!historical && inventory && row.bookingStatus !== 'Cancelled') {
      const [conflicts] = await executor.query(
        `SELECT od.occupied_date, b.booking_reference
           FROM occupied_dates od
           JOIN bookings b ON b.booking_id = od.booking_id
          WHERE od.inventory_item_id = ? AND od.occupied_date >= ? AND od.occupied_date < ?
          LIMIT 1`,
        [inventory.item_id, row.checkIn, row.checkOut],
      );
      if (conflicts.length) errors.push({ code: 'DATE_CONFLICT', message: `Inventory conflicts with ${conflicts[0].booking_reference}.` });
    }
  }

  if (historical) warnings.push('Historical record: current inventory occupancy will not be changed.');
  if (!row.email) warnings.push('No email supplied; booking will remain a guest-only historical record.');
  const status = duplicate ? 'DUPLICATE' : errors.length ? 'INVALID' : warnings.length ? 'WARNING' : 'VALID';
  return { ...row, historical, validationStatus: status, errors, warnings };
}

export async function previewReservationImport({ rows, filename = 'reservation-import.xlsx' }) {
  if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('At least one reservation row is required.'), { statusCode: 400 });
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`A single import cannot exceed ${MAX_ROWS} rows.`), { statusCode: 400 });
  const normalized = rows.map(normalizeImportRow);
  const inspected = [];
  for (const row of normalized) inspected.push(await inspectRow(row));
  const fileKeys = new Map();
  for (const row of inspected) {
    const key = row.legacyReference
      ? `reference:${row.legacyReference.toLowerCase()}`
      : `guest:${row.email || `${row.firstName} ${row.lastName}`.toLowerCase()}:${row.checkIn}:${row.checkOut}:${row.itemName.toLowerCase()}`;
    if (fileKeys.has(key)) {
      row.validationStatus = 'DUPLICATE';
      row.errors.push({ code: 'DUPLICATE_IN_FILE', message: `Duplicates row ${fileKeys.get(key)} in this file.` });
    } else {
      fileKeys.set(key, row.rowNumber);
    }
  }
  return {
    filename: text(filename, 255) || 'reservation-import.xlsx',
    rows: inspected,
    summary: inspected.reduce((result, row) => {
      result.total += 1;
      if (row.validationStatus === 'VALID' || row.validationStatus === 'WARNING') result.valid += 1;
      else if (row.validationStatus === 'DUPLICATE') result.duplicates += 1;
      else result.invalid += 1;
      return result;
    }, { total: 0, valid: 0, invalid: 0, duplicates: 0 }),
  };
}

const makeBatchReference = () => `RIMP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const makeBookingReference = (batchReference, rowNumber) => `${batchReference.replace('RIMP-', 'LI').slice(0, 15)}${String(rowNumber).padStart(3, '0')}`.slice(0, 20);

async function insertBooking(connection, batchId, batchReference, row) {
  const reference = row.legacyReference && row.legacyReference.length <= 20 ? row.legacyReference : makeBookingReference(batchReference, row.rowNumber);
  const nights = dateDiff(row.checkIn, row.checkOut);
  const [result] = await connection.query(
    `INSERT INTO bookings (
       booking_reference, first_name, last_name, email, phone, address, city, country,
       check_in_date, check_out_date, nights, adults, children, special_requests,
       subtotal, discount, tax, total, booking_status, payment_status, payment_method,
       import_batch_id, booking_source, is_historical_import, legacy_reference, created_at
     ) VALUES (?, ?, ?, ?, ?, '', '', 'Philippines', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'LEGACY_IMPORT', ?, ?, NOW())`,
    [reference, row.firstName, row.lastName, row.email, row.phone, row.checkIn, row.checkOut, nights,
      row.adults, row.children, row.notes || null, row.totalAmount, row.totalAmount,
      row.bookingStatus, row.paymentStatus, row.paymentMethod, batchId, row.historical ? 1 : 0, row.legacyReference || null],
  );
  const bookingId = result.insertId;
  await connection.query(
    `INSERT INTO booking_items (
       booking_id, item_type, item_name, item_description, inventory_item_id, unit_price,
       quantity, nights, total_price, guests, per_night, total_guests, adults, children,
       seniors, infants, guest_breakdown_provided, guest_breakdown_type
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'exact')`,
    [bookingId, row.itemType, row.itemName, JSON.stringify({ notes: row.notes, import_source: 'LEGACY_IMPORT' }),
      row.inventoryItemId, nights ? row.totalAmount / nights : row.totalAmount, nights, row.totalAmount,
      row.totalGuests, ['Room', 'Cottage'].includes(row.itemType) ? 1 : 0, row.totalGuests,
      row.adults, row.children, row.seniors, row.infants],
  );
  if (!row.historical && row.bookingStatus !== 'Cancelled' && ['Room', 'Cottage'].includes(row.itemType)) {
    await reserveInventoryDateRange(connection, {
      inventoryItemId: row.inventoryItemId,
      bookingId,
      startDate: row.checkIn,
      endDate: row.checkOut,
      itemName: row.itemName,
    });
  }
  await connection.query(
    `INSERT INTO booking_logs (booking_id, action, new_status, description, performed_by)
     VALUES (?, 'legacy_import', ?, ?, ?)`,
    [bookingId, row.bookingStatus, `Imported through batch ${batchReference}`, 'admin'],
  );
  return { bookingId, reference };
}

export async function confirmReservationImport({ rows, filename, createdBy }) {
  const preview = await previewReservationImport({ rows, filename });
  const connection = await db.getConnection();
  const batchReference = makeBatchReference();
  try {
    await connection.beginTransaction();
    const [batchResult] = await connection.query(
      `INSERT INTO reservation_import_batches
       (batch_reference, source_filename, status, total_rows, valid_rows, rejected_rows, created_by)
       VALUES (?, ?, 'IMPORTING', ?, ?, ?, ?)`,
      [batchReference, preview.filename, preview.summary.total, preview.summary.valid,
        preview.summary.invalid + preview.summary.duplicates, text(createdBy, 120) || 'admin'],
    );
    const batchId = batchResult.insertId;
    let imported = 0;
    for (const row of preview.rows) {
      let rowStatus = row.validationStatus;
      let bookingId = null;
      let rowErrors = row.errors;
      if (rowStatus === 'VALID' || rowStatus === 'WARNING') {
        try {
          await connection.query(`SAVEPOINT import_row_${row.rowNumber}`);
          const inserted = await insertBooking(connection, batchId, batchReference, row);
          bookingId = inserted.bookingId;
          rowStatus = 'IMPORTED';
          imported += 1;
        } catch (error) {
          await connection.query(`ROLLBACK TO SAVEPOINT import_row_${row.rowNumber}`);
          rowStatus = 'FAILED';
          rowErrors = [{ code: error.code === 'ER_DUP_ENTRY' ? 'CONFLICT_DURING_IMPORT' : 'IMPORT_FAILED', message: error.message }];
        }
      }
      await connection.query(
        `INSERT INTO reservation_import_rows
         (import_batch_id, row_number, legacy_reference, booking_id, validation_status, error_codes, error_messages, normalized_payload, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchId, row.rowNumber, row.legacyReference || null, bookingId, rowStatus,
          JSON.stringify(rowErrors.map((item) => item.code)), JSON.stringify(rowErrors.map((item) => item.message)),
          JSON.stringify(row), bookingId ? new Date() : null],
      );
    }
    const rejected = preview.summary.total - imported;
    const status = imported === preview.summary.total ? 'COMPLETED' : imported > 0 ? 'PARTIAL' : 'FAILED';
    await connection.query(
      `UPDATE reservation_import_batches SET status = ?, imported_rows = ?, rejected_rows = ?, completed_at = NOW()
       WHERE import_batch_id = ?`,
      [status, imported, rejected, batchId],
    );
    await connection.commit();
    return { batchId, batchReference, status, imported, rejected, total: preview.summary.total };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listReservationImportBatches(limit = 20) {
  const [rows] = await db.query(
    `SELECT * FROM reservation_import_batches ORDER BY import_batch_id DESC LIMIT ?`,
    [Math.min(100, Math.max(1, integer(limit, 20)))],
  );
  return rows;
}

export async function rollbackReservationImport(batchId, rolledBackBy) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [batches] = await connection.query('SELECT * FROM reservation_import_batches WHERE import_batch_id = ? FOR UPDATE', [batchId]);
    if (!batches.length) throw Object.assign(new Error('Import batch not found.'), { statusCode: 404 });
    if (batches[0].status === 'ROLLED_BACK') throw Object.assign(new Error('Import batch was already rolled back.'), { statusCode: 409 });
    const [bookings] = await connection.query('SELECT booking_id FROM bookings WHERE import_batch_id = ? FOR UPDATE', [batchId]);
    await connection.query('DELETE FROM bookings WHERE import_batch_id = ?', [batchId]);
    await connection.query(
      `UPDATE reservation_import_rows SET validation_status = 'ROLLED_BACK', booking_id = NULL WHERE import_batch_id = ? AND booking_id IS NOT NULL`,
      [batchId],
    );
    await connection.query(
      `UPDATE reservation_import_batches SET status = 'ROLLED_BACK', rolled_back_at = NOW(), created_by = CONCAT(created_by, ' | rollback: ', ?) WHERE import_batch_id = ?`,
      [text(rolledBackBy, 80) || 'admin', batchId],
    );
    await connection.commit();
    return { batchId: Number(batchId), removedBookings: bookings.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
