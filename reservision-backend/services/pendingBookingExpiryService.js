import db from '../config/db.js';
import { BOOKING_STATUS, PAYMENT_STATUS } from '../utils/paymentStatuses.js';

const DEFAULT_HOLD_MINUTES = 30;

export const getPendingBookingHoldMinutes = () => {
  const configured = Number(process.env.BOOKING_PAYMENT_HOLD_MINUTES);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_HOLD_MINUTES;
  return Math.min(1440, Math.floor(configured));
};

/**
 * Lazily expires abandoned online-payment holds before availability checks.
 * Cash reservations are excluded because they follow staff confirmation rather
 * than the hosted payment-session lifecycle.
 */
export const expireStalePendingBookings = async (connection = null, now = new Date()) => {
  const conn = connection || db;
  const holdMinutes = getPendingBookingHoldMinutes();
  const cutoff = new Date(now.getTime() - (holdMinutes * 60 * 1000));

  const [rows] = await conn.query(
    `SELECT booking_id
     FROM bookings
     WHERE booking_status = ?
       AND COALESCE(payment_status, ?) IN (?, ?, ?)
       AND UPPER(COALESCE(payment_method, '')) NOT IN ('CASH', 'PAY AT RESORT')
       AND updated_at <= ?`,
    [
      BOOKING_STATUS.PENDING,
      PAYMENT_STATUS.UNPAID,
      PAYMENT_STATUS.UNPAID,
      PAYMENT_STATUS.PENDING,
      PAYMENT_STATUS.FAILED,
      cutoff,
    ],
  );

  const bookingIds = rows
    .map((row) => Number(row.booking_id))
    .filter((bookingId) => Number.isInteger(bookingId) && bookingId > 0);

  if (!bookingIds.length) {
    return { expired: 0, bookingIds: [] };
  }

  const placeholders = bookingIds.map(() => '?').join(', ');
  await conn.query(
    `UPDATE bookings
     SET booking_status = ?,
         payment_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE booking_id IN (${placeholders})
       AND booking_status = ?`,
    [
      BOOKING_STATUS.EXPIRED,
      PAYMENT_STATUS.EXPIRED,
      ...bookingIds,
      BOOKING_STATUS.PENDING,
    ],
  );

  const [expiredRows] = await conn.query(
    `SELECT booking_id
     FROM bookings
     WHERE booking_id IN (${placeholders})
       AND booking_status = ?
       AND payment_status = ?`,
    [...bookingIds, BOOKING_STATUS.EXPIRED, PAYMENT_STATUS.EXPIRED],
  );
  const expiredBookingIds = expiredRows
    .map((row) => Number(row.booking_id))
    .filter((bookingId) => Number.isInteger(bookingId) && bookingId > 0);

  if (!expiredBookingIds.length) {
    return { expired: 0, bookingIds: [] };
  }

  const expiredPlaceholders = expiredBookingIds.map(() => '?').join(', ');
  await conn.query(
    `DELETE FROM occupied_dates WHERE booking_id IN (${expiredPlaceholders})`,
    expiredBookingIds,
  );
  await conn.query(
    `UPDATE payments
     SET status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE booking_id IN (${expiredPlaceholders})
       AND status = 'pending'`,
    expiredBookingIds,
  );

  return { expired: expiredBookingIds.length, bookingIds: expiredBookingIds };
};

