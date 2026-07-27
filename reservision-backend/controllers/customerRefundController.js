import db from '../config/db.js';
import { createRefund } from './adminRefundController.js';
import { assertBookingAccess } from '../middleware/ownership.js';
import { isStaffUser } from '../utils/authHelpers.js';

const REJECTION_MARKER = 'Rejection reason:';

const splitRefundNote = (note = '') => {
  const text = String(note || '').trim();
  const markerIndex = text.indexOf(REJECTION_MARKER);

  if (markerIndex >= 0) {
    return {
      customer_note: text.slice(0, markerIndex).trim(),
      admin_remarks: text.slice(markerIndex + REJECTION_MARKER.length).trim(),
    };
  }

  return {
    customer_note: text,
    admin_remarks: '',
  };
};

/**
 * GET /api/customer/refunds/booking/:bookingId
 * Returns the latest refund request for a booking owned by the customer.
 */
export const getCustomerRefundByBooking = async (req, res) => {
  const bookingId = Number(req.params.bookingId);

  if (!bookingId) {
    return res.status(400).json({
      success: false,
      message: 'Booking ID is required.',
      code: 'VALIDATION_ERROR',
    });
  }

  if (!(await assertBookingAccess(req, res, bookingId))) {
    return;
  }

  try {
    const [rows] = await db.query(
      `SELECT
        refund_id,
        booking_id,
        refund_reference,
        refund_reason,
        refund_note,
        refund_method,
        refund_status,
        requested_at,
        approved_at,
        refunded_at,
        refund_amount
      FROM refunds
      WHERE booking_id = ?
      ORDER BY refund_id DESC
      LIMIT 1`,
      [bookingId],
    );

    if (!rows.length) {
      return res.json({ success: true, data: null });
    }

    const refund = rows[0];
    const { customer_note, admin_remarks } = splitRefundNote(refund.refund_note);

    return res.json({
      success: true,
      data: {
        ...refund,
        refund_requested_at: refund.requested_at,
        customer_refund_note: customer_note,
        admin_remarks,
      },
    });
  } catch (error) {
    console.error('getCustomerRefundByBooking error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch refund details.',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
};

/**
 * POST /api/customer/refunds/request
 * Customer-initiated refund request for their own paid booking.
 */
export const createCustomerRefundRequest = async (req, res) => {
  const { booking_id, refund_reason, refund_note, refund_method } = req.body || {};
  const bookingId = Number(booking_id);

  if (!bookingId) {
    return res.status(400).json({
      success: false,
      message: 'Booking ID is required.',
      code: 'VALIDATION_ERROR',
    });
  }

  if (isStaffUser(req.user)) {
    return createRefund(req, res);
  }

  if (!(await assertBookingAccess(req, res, bookingId))) {
    return;
  }

  req.body = {
    booking_id: bookingId,
    refund_reason: refund_reason || 'Customer cancellation',
    refund_note: refund_note || 'Customer refund request',
    refund_method: refund_method || 'Same as payment method',
  };

  req.user = {
    ...req.user,
    name: req.user.name || req.user.email || 'Customer',
  };

  return createRefund(req, res);
};
