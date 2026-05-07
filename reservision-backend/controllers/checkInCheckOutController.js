/**
 * ============================================================
 * Check-in/Check-out Controller
 * ============================================================
 * Handles guest check-in and check-out operations for bookings
 */

import db from '../config/db.js';

/**
 * Get booking details for QR scanner
 * GET /api/bookings/qr/:code
 */
export const getBookingByQRCode = async (req, res) => {
    try {
        const { code } = req.params;

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Booking code is required'
            });
        }

        const [bookings] = await db.query(
            `SELECT 
        b.booking_id,
        b.booking_reference,
        b.customer_id,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.booking_status,
        b.payment_status,
        b.total,
        b.arrival_time,
        b.special_requests,
        b.created_at,
        b.actual_check_in_time,
        b.actual_check_out_time,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        c.address,
        c.city,
        c.country
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN user u ON c.user_id = u.user_id
      WHERE b.booking_reference = ? OR b.booking_id = ?
      LIMIT 1`,
            [code, code]
        );

        if (!bookings.length) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        const booking = bookings[0];

        // Get booking items
        const [items] = await db.query(
            `SELECT 
        booking_item_id,
        item_type,
        item_name,
        unit_price,
        quantity,
        guests,
        nights,
        total_price
      FROM booking_items
      WHERE booking_id = ?`,
            [booking.booking_id]
        );

        return res.json({
            success: true,
            data: {
                bookingId: booking.booking_id,
                bookingReference: booking.booking_reference,
                guestName: `${booking.first_name} ${booking.last_name}`,
                email: booking.email,
                phone: booking.phone,
                address: booking.address,
                city: booking.city,
                country: booking.country,
                checkInDate: booking.check_in_date,
                checkOutDate: booking.check_out_date,
                adults: booking.adults,
                children: booking.children,
                arrivalTime: booking.arrival_time,
                specialRequests: booking.special_requests,
                bookingStatus: booking.booking_status,
                paymentStatus: booking.payment_status,
                total: booking.total,
                items: items,
                actualCheckInTime: booking.actual_check_in_time,
                actualCheckOutTime: booking.actual_check_out_time,
                createdAt: booking.created_at
            }
        });
    } catch (error) {
        console.error('Error fetching booking by QR code:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch booking details'
        });
    }
};

/**
 * Check-in guest
 * POST /api/bookings/:bookingId/check-in
 */
export const checkInGuest = async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const { bookingId } = req.params;

        if (!bookingId) {
            return res.status(400).json({
                success: false,
                error: 'Booking ID is required'
            });
        }

        // Get booking details
        const [bookings] = await connection.query(
            `SELECT booking_id, booking_status, payment_status, check_in_date, check_out_date
       FROM bookings
       WHERE booking_id = ?
       LIMIT 1`,
            [bookingId]
        );

        if (!bookings.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        const booking = bookings[0];

        // Validate booking status
        if (booking.booking_status === 'Pending') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Booking is still pending approval. Cannot check in.'
            });
        }

        if (booking.booking_status === 'Checked-out' || booking.booking_status === 'Completed') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Booking has already been completed.'
            });
        }

        if (booking.booking_status === 'Checked-in') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Guest is already checked in.'
            });
        }

        // Update booking status and set actual check-in time
        const now = new Date();
        const checkInTime = now.toISOString().slice(0, 19).replace('T', ' ');

        await connection.query(
            `UPDATE bookings
       SET booking_status = 'Checked-in',
           actual_check_in_time = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
            [checkInTime, bookingId]
        );

        await connection.commit();

        return res.json({
            success: true,
            message: 'Guest checked in successfully',
            data: {
                bookingId: booking.booking_id,
                newStatus: 'Checked-in',
                checkInTime: checkInTime
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error during check-in:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check in guest'
        });
    } finally {
        connection.release();
    }
};

/**
 * Check-out guest
 * POST /api/bookings/:bookingId/check-out
 */
export const checkOutGuest = async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const { bookingId } = req.params;

        if (!bookingId) {
            return res.status(400).json({
                success: false,
                error: 'Booking ID is required'
            });
        }

        // Get booking details
        const [bookings] = await connection.query(
            `SELECT booking_id, booking_status, check_in_date, check_out_date
       FROM bookings
       WHERE booking_id = ?
       LIMIT 1`,
            [bookingId]
        );

        if (!bookings.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        const booking = bookings[0];

        // Validate booking status - can only check out if checked in
        if (booking.booking_status !== 'Checked-in') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: `Cannot check out. Current booking status is ${booking.booking_status}. Guest must be checked in first.`
            });
        }

        // Update booking status to Completed and set actual check-out time
        const now = new Date();
        const checkOutTime = now.toISOString().slice(0, 19).replace('T', ' ');

        await connection.query(
            `UPDATE bookings
       SET booking_status = 'Completed',
           actual_check_out_time = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
            [checkOutTime, bookingId]
        );

        await connection.commit();

        return res.json({
            success: true,
            message: 'Guest checked out successfully',
            data: {
                bookingId: booking.booking_id,
                newStatus: 'Completed',
                checkOutTime: checkOutTime
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error during check-out:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check out guest'
        });
    } finally {
        connection.release();
    }
};

export default {
    getBookingByQRCode,
    checkInGuest,
    checkOutGuest
};
