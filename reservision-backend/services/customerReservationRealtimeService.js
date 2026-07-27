import db from '../config/db.js';
import { getDisplayIo } from './displayWebSocketService.js';

const emitToUser = (userId, event, payload) => {
    const io = getDisplayIo();
    const normalizedUserId = Number(userId);
    if (!io || !Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !payload) {
        return false;
    }

    io.to(`user:${normalizedUserId}`).emit(event, payload);
    return true;
};

const emitToStaff = (event, payload) => {
    const io = getDisplayIo();
    if (!io || !payload) {
        return false;
    }
    io.to('staff:reservations').emit(event, payload);
    return true;
};

export const buildReservationRealtimePayload = async (bookingId) => {
    const normalizedId = Number(bookingId);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT
            b.booking_id,
            b.booking_status,
            b.updated_at,
            c.user_id,
            (
                SELECT bi.item_type
                FROM booking_items bi
                WHERE bi.booking_id = b.booking_id
                ORDER BY bi.item_id ASC
                LIMIT 1
            ) AS reservation_type
         FROM bookings b
         JOIN customers c ON c.customer_id = b.customer_id
         WHERE b.booking_id = ?
         LIMIT 1`,
        [normalizedId],
    );

    if (!rows.length) {
        return null;
    }

    const row = rows[0];
    return {
        userId: row.user_id,
        reservationId: row.booking_id,
        status: row.booking_status,
        reservationType: row.reservation_type || 'Booking',
        updatedAt: row.updated_at
            ? new Date(row.updated_at).toISOString()
            : new Date().toISOString(),
    };
};

export const emitReservationUpdated = (userId, reservation) => {
    if (!reservation?.reservationId) return false;
    return emitToUser(userId, 'reservation:updated', {
        reservationId: reservation.reservationId,
        status: reservation.status,
        reservationType: reservation.reservationType || 'Booking',
        updatedAt: reservation.updatedAt || new Date().toISOString(),
    });
};

export const emitReservationCancelled = (userId, reservation) => {
    if (!reservation?.reservationId) return false;
    return emitToUser(userId, 'reservation:cancelled', {
        reservationId: reservation.reservationId,
        status: reservation.status || 'Cancelled',
    });
};

export const emitReservationCheckedIn = (userId, reservation) => {
    if (!reservation?.reservationId) return false;
    return emitToUser(userId, 'reservation:checked-in', {
        reservationId: reservation.reservationId,
        status: reservation.status || 'Checked-In',
    });
};

export const emitReservationCheckedOut = (userId, reservation) => {
    if (!reservation?.reservationId) return false;
    return emitToUser(userId, 'reservation:checked-out', {
        reservationId: reservation.reservationId,
        status: reservation.status || 'Checked-Out',
    });
};

export const emitReservationChangeForBooking = async (bookingId, { newStatus } = {}) => {
    const payload = await buildReservationRealtimePayload(bookingId);
    if (!payload?.userId) {
        return false;
    }

    const status = newStatus || payload.status;
    const base = {
        reservationId: payload.reservationId,
        status,
        reservationType: payload.reservationType,
        updatedAt: payload.updatedAt,
    };

    if (status === 'Cancelled') {
        emitToStaff('reservation:admin-updated', { ...base, channel: 'cancelled' });
        return emitReservationCancelled(payload.userId, base);
    }
    if (status === 'Checked-In') {
        emitToStaff('reservation:admin-updated', { ...base, channel: 'checked-in' });
        return emitReservationCheckedIn(payload.userId, base);
    }
    if (status === 'Checked-Out') {
        emitToStaff('reservation:admin-updated', { ...base, channel: 'checked-out' });
        return emitReservationCheckedOut(payload.userId, base);
    }

    emitToStaff('reservation:admin-updated', { ...base, channel: 'updated' });
    return emitReservationUpdated(payload.userId, base);
};
