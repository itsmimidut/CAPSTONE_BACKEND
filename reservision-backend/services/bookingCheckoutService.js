import { BOOKING_STATUS, PAYMENT_STATUS, POS_PAYMENT_STATUS } from '../utils/paymentStatuses.js';

export const finalizeBookingsForPaidTransaction = async (connection, pricedItems, staffUserId = 'staff') => {
    const bookingIds = (pricedItems || [])
        .map((item) => Number(item.bookingId || item.booking_id || 0))
        .filter((id) => id > 0);

    if (!bookingIds.length) {
        return { updated: 0 };
    }

    let updated = 0;

    for (const bookingId of bookingIds) {
        const [result] = await connection.query(
            `UPDATE bookings
             SET payment_status = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE booking_id = ?
               AND payment_status != ?`,
            [PAYMENT_STATUS.PAID, bookingId, PAYMENT_STATUS.PAID]
        );

        if ((result.affectedRows || 0) > 0) {
            updated += 1;
            await connection.query(
                'INSERT INTO booking_logs (booking_id, action, description) VALUES (?, ?, ?)',
                [bookingId, 'payment_received', `POS payment recorded by ${staffUserId}; pending admin approval`]
            ).catch(() => {});
        }
    }

    return { updated, bookingIds };
};

export const releaseUnpaidBookingsOnExpiry = async (connection, pricedItems) => {
    const bookingIds = (pricedItems || [])
        .map((item) => Number(item.bookingId || item.booking_id || 0))
        .filter((id) => id > 0);

    for (const bookingId of bookingIds) {
        const [result] = await connection.query(
            `UPDATE bookings
             SET payment_status = ?,
                 booking_status = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE booking_id = ?
               AND payment_status NOT IN (?, ?)`,
            [
                PAYMENT_STATUS.EXPIRED,
                BOOKING_STATUS.EXPIRED,
                bookingId,
                PAYMENT_STATUS.PAID,
                PAYMENT_STATUS.REFUNDED,
            ]
        );

        if (Number(result?.affectedRows || 0) > 0) {
            await connection.query(
                'DELETE FROM occupied_dates WHERE booking_id = ?',
                [bookingId]
            );
        }
    }
};

export { POS_PAYMENT_STATUS };
