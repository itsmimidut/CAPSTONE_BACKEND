import db from '../config/db.js';
import {
  assertEmailAccess,
  assertUserIdAccess,
  isStaffUser,
  sendForbidden,
} from '../utils/authHelpers.js';

export const assertCustomerIdAccess = async (req, res, customerId) => {
  if (isStaffUser(req.user)) return true;

  const [rows] = await db.query(
    'SELECT user_id FROM customers WHERE customer_id = ? LIMIT 1',
    [customerId]
  );

  if (!rows.length) {
    res.status(404).json({ success: false, error: 'Customer not found' });
    return false;
  }

  return assertUserIdAccess(req, res, rows[0].user_id);
};

export const assertBookingAccess = async (req, res, bookingId) => {
  if (isStaffUser(req.user)) return true;

  const [rows] = await db.query(
    `SELECT c.user_id
     FROM bookings b
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE b.booking_id = ?
     LIMIT 1`,
    [bookingId]
  );

  if (!rows.length) {
    res.status(404).json({ success: false, error: 'Booking not found' });
    return false;
  }

  if (!rows[0].user_id) {
    sendForbidden(res);
    return false;
  }

  return assertUserIdAccess(req, res, rows[0].user_id);
};

export const resolveBookingIdByReference = async (bookingReference) => {
  const [rows] = await db.query(
    'SELECT booking_id FROM bookings WHERE booking_reference = ? LIMIT 1',
    [bookingReference]
  );
  return rows[0]?.booking_id ?? null;
};

export const resolveBookingIdByInvoiceId = async (invoiceId) => {
  const [rows] = await db.query(
    'SELECT booking_id FROM payments WHERE payment_reference = ? LIMIT 1',
    [invoiceId]
  );
  return rows[0]?.booking_id ?? null;
};

export const assertBookingReferenceAccess = async (req, res, bookingReference) => {
  if (isStaffUser(req.user)) return true;

  const bookingId = await resolveBookingIdByReference(bookingReference);
  if (!bookingId) {
    res.status(404).json({ success: false, error: 'Booking not found' });
    return false;
  }

  return assertBookingAccess(req, res, bookingId);
};

/**
 * Same as assertBookingReferenceAccess but returns false without sending 403
 * so callers can respond with a generic 404 (reference enumeration mitigation).
 */
export const canAccessBookingReference = async (req, bookingReference) => {
  if (isStaffUser(req.user)) return true;

  const bookingId = await resolveBookingIdByReference(bookingReference);
  if (!bookingId) return false;

  const [rows] = await db.query(
    `SELECT c.user_id
     FROM bookings b
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE b.booking_id = ?
     LIMIT 1`,
    [bookingId]
  );

  if (!rows.length || !rows[0].user_id) return false;

  return Number(req.user?.id) === Number(rows[0].user_id);
};

export const assertInvoiceAccess = async (req, res, invoiceId) => {
  const bookingId = await resolveBookingIdByInvoiceId(invoiceId);
  if (!bookingId) {
    res.status(404).json({ success: false, error: 'Payment not found' });
    return false;
  }

  return assertBookingAccess(req, res, bookingId);
};

export { assertUserIdAccess, assertEmailAccess, assertCustomerIdAccess as assertCustomerAccess };
