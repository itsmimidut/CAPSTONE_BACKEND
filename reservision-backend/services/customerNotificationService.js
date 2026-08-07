import db from '../config/db.js';
import { emitCustomerNotification } from './customerNotificationRealtimeService.js';

const activityLink = (tab, focus = null) => {
    const params = new URLSearchParams({
        section: 'activity',
        tab: String(tab || 'all'),
    });
    if (focus) params.set('focus', String(focus));
    return `/customer?${params.toString()}`;
};

const mapNotificationRow = (row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    link: row.link,
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
});

const fetchNotificationById = async (notificationId, connection = db) => {
    const [rows] = await connection.query(
        `SELECT id, user_id, customer_id, title, message, type, link, is_read, created_at
         FROM customer_notifications
         WHERE id = ?
         LIMIT 1`,
        [notificationId],
    );
    return rows[0] ? mapNotificationRow(rows[0]) : null;
};

export const getBookingNotificationTarget = async (bookingId) => {
    const [rows] = await db.query(
        `SELECT c.user_id, c.customer_id, b.booking_reference
         FROM bookings b
         JOIN customers c ON c.customer_id = b.customer_id
         WHERE b.booking_id = ?
         LIMIT 1`,
        [bookingId],
    );
    return rows[0] || null;
};

export const getRefundNotificationTarget = async (refundId) => {
    const [rows] = await db.query(
        `SELECT c.user_id, c.customer_id, b.booking_reference, r.refund_reference
         FROM refunds r
         JOIN bookings b ON b.booking_id = r.booking_id
         JOIN customers c ON c.customer_id = b.customer_id
         WHERE r.refund_id = ?
         LIMIT 1`,
        [refundId],
    );
    return rows[0] || null;
};

export const createCustomerNotification = async ({
    userId,
    customerId = null,
    title,
    message,
    type = 'general',
    link = null,
    eventKey = null,
    connection = db,
}) => {
    if (!userId || !title || !message) {
        return null;
    }

    const [result] = await connection.query(
        `INSERT INTO customer_notifications (
            user_id, customer_id, title, message, type, event_key, link
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE event_key = event_key`,
        [userId, customerId, title, message, type, eventKey, link],
    );

    const notificationId = Number(result.insertId || 0);
    const notification = notificationId
        ? await fetchNotificationById(notificationId, connection)
        : null;
    if (notification && connection === db) {
        try {
            emitCustomerNotification(userId, notification);
        } catch (error) {
            console.warn('Realtime customer notification emit failed:', error.message);
        }
    }

    return notificationId || null;
};

export const emitPersistedCustomerNotification = async (notificationId) => {
    if (!notificationId) return null;
    const notification = await fetchNotificationById(notificationId, db);
    if (!notification) return null;
    emitCustomerNotification(notification.user_id, notification);
    return notification;
};

export const notifyBookingConfirmed = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Booking Confirmed',
        message: 'Your reservation has been confirmed.',
        type: 'booking_confirmed',
        link: activityLink('reservations', bookingReference),
    });
};

export const notifyBookingCancelled = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Booking Cancelled',
        message: 'Your reservation has been cancelled.',
        type: 'booking_cancelled',
        link: activityLink('reservations', bookingReference),
    });
};

export const notifyPaymentReceived = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Payment Received',
        message: 'Your payment has been successfully received.',
        type: 'payment_received',
        link: activityLink('reservations', bookingReference),
    });
};

export const notifyRefundApproved = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Refund Approved',
        message: 'Your refund request has been approved.',
        type: 'refund_approved',
        link: activityLink('refunds', bookingReference),
    });
};

export const notifyRefundRejected = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Refund Rejected',
        message: 'Your refund request was rejected. Please contact support for more information.',
        type: 'refund_rejected',
        link: activityLink('refunds', bookingReference),
    });
};

export const notifyRefundCompleted = async ({ userId, customerId, bookingReference }) => {
    return createCustomerNotification({
        userId,
        customerId,
        title: 'Refund Completed',
        message: 'Your refund has been successfully processed.',
        type: 'refund_completed',
        link: activityLink('refunds', bookingReference),
    });
};
