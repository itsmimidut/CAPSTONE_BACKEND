import db from '../config/db.js';

/**
 * Resolve the authoritative booking amount from the database.
 */
export const getBookingAmountDue = async (bookingId) => {
  const [rows] = await db.query(
    `SELECT booking_id, customer_id, total,
            payment_status, booking_status
     FROM bookings
     WHERE booking_id = ?
     LIMIT 1`,
    [bookingId],
  );

  if (!rows.length) {
    return null;
  }

  const booking = rows[0];
  const amountDue = Number(booking.total);

  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    return null;
  }

  return { booking, amountDue };
};

export const amountsMatch = (left, right, tolerance = 0.01) =>
  Math.abs(Number(left) - Number(right)) <= tolerance;
