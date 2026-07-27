import fetch from 'node-fetch';
import dotenv from 'dotenv';
import db from '../config/db.js';
import { assertBookingAccess, assertInvoiceAccess } from '../middleware/ownership.js';
import { amountsMatch, getBookingAmountDue } from '../utils/bookingAmount.js';
import {
  beginWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from '../services/webhookEventService.js';
import { logPaymentEvent, logSecurityEvent } from '../utils/logger.js';
import { logAudit, AUDIT_ACTIONS } from '../utils/auditLogger.js';
import { handleXenditRefundWebhook } from '../services/xenditRefundService.js';
import { routeXenditInvoiceWebhook, isPosExternalId } from '../services/xenditWebhookService.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
} from '../utils/paymentStatuses.js';
import { generateQRCode, formatBookingDataForQR } from '../services/qrCodeService.js';
import { sendBookingConfirmationWithQR, resolveCustomerEmailForBooking } from '../services/emailService.js';
import {
  findReusableXenditInvoice,
  expireActiveXenditInvoiceForBooking,
  getLatestPaymentForBooking,
  mapPaymentMethodToXenditInvoiceChannels,
  markXenditPaymentFailedOrExpired,
  markXenditPaymentPaid,
  upsertXenditPendingPayment,
} from '../services/paymentRecordService.js';
import {
  cancelPaymentRequest,
  createQrphPaymentRequest,
  fetchPaymentRequest,
  isPaymentRequestId,
  isPaymentRequestPaid,
  qrStringToDataUrl,
} from '../services/xenditQrPaymentService.js';
import {
  getBookingNotificationTarget,
  notifyPaymentReceived,
} from '../services/customerNotificationService.js';
import {
  canCreatePaymentForBooking,
  getFailedBookingPaymentState,
  getPaidBookingPaymentState,
  invoiceBelongsToBooking,
  isPlaceholderInvoiceId,
} from '../services/bookingPaymentLifecycle.js';

dotenv.config();

const XENDIT_API_KEY = process.env.XENDIT_SECRET_KEY;
const XENDIT_API_URL = 'https://api.xendit.co/v2/invoices';
const BOOKING_PAYMENT_STATUS_FOR_UNPAID_FLOW = PAYMENT_STATUS.PENDING;
const PAYMENT_HOLD_SECONDS = Math.max(
  60,
  Number(process.env.BOOKING_PAYMENT_HOLD_MINUTES || 30) * 60,
);

const buildWebhookEventId = (payment) => {
  const invoiceId = payment?.id || payment?.invoice_id || 'unknown';
  const status = payment?.status || payment?.event || 'unknown';
  const updatedAt = payment?.updated || payment?.paid_at || payment?.created || '';
  return `xendit:invoice:${invoiceId}:${status}:${updatedAt}`;
};

const buildRefundWebhookEventId = (payload) => {
  const refundId = payload?.id || 'unknown';
  const status = payload?.status || 'unknown';
  return `xendit:refund:${refundId}:${status}`;
};

const buildBookingLookup = (externalId) => {
  const normalized = String(externalId);
  const isNumericId = /^\d+$/.test(normalized);
  const attemptMatch = normalized.match(/^BOOKING-(\d+)-/i);

  if (isNumericId) {
    return {
      sql: 'WHERE booking_reference = ? OR booking_id = ?',
      params: [normalized, Number(normalized)],
    };
  }

  if (attemptMatch) {
    return {
      sql: 'WHERE booking_id = ?',
      params: [Number(attemptMatch[1])],
    };
  }

  return {
    sql: 'WHERE booking_reference = ?',
    params: [normalized],
  };
};

const processPaidInvoiceWebhook = async (payment) => {
  const lookup = buildBookingLookup(payment.external_id);
  const [bookingRows] = await db.query(
    `SELECT booking_id, customer_id, payment_method, total, payment_status, booking_status
     FROM bookings
     ${lookup.sql}
     LIMIT 1`,
    lookup.params,
  );

  if (!bookingRows.length) {
    console.warn('⚠️ Xendit Webhook - No booking rows matched external_id:', payment.external_id);
    return;
  }

  const booking = bookingRows[0];
  const paidState = getPaidBookingPaymentState();
  const latestPayment = await getLatestPaymentForBooking(booking.booking_id);

  if (!amountsMatch(payment.amount, booking.total)) {
    logSecurityEvent('PAYMENT_AMOUNT_MISMATCH', {
      booking_id: booking.booking_id,
      expected: booking.total,
      received: payment.amount,
      invoice_id: payment.id,
    });
    throw new Error('PAYMENT_AMOUNT_MISMATCH');
  }

  if (booking.payment_status === PAYMENT_STATUS.PAID) {
    const [paidPaymentRows] = await db.query(
      `SELECT payment_reference
       FROM payments
       WHERE booking_id = ?
         AND status = 'paid'
       ORDER BY paid_at ASC, payment_id ASC
       LIMIT 1`,
      [booking.booking_id],
    );
    const acceptedPaymentReference = paidPaymentRows[0]?.payment_reference || null;
    const isDuplicatePayment = (
      acceptedPaymentReference
      && String(acceptedPaymentReference) !== String(payment.id || '')
    );
    await db.query(
      `UPDATE bookings
       SET booking_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?
         AND booking_status = ?`,
      [paidState.bookingStatus, booking.booking_id, BOOKING_STATUS.PENDING],
    );
    await markXenditPaymentPaid({
      bookingId: booking.booking_id,
      customerId: booking.customer_id,
      invoiceId: payment.id,
      amount: payment.amount,
      paymentMethod: booking.payment_method || 'xendit',
      paidAt: payment.paid_at ? new Date(payment.paid_at) : new Date(),
    });
    if (isDuplicatePayment) {
      logSecurityEvent('DUPLICATE_PAYMENT_RECEIVED', {
        booking_id: booking.booking_id,
        accepted_payment_reference: acceptedPaymentReference,
        duplicate_payment_reference: payment.id,
        amount: payment.amount,
      });
    }
    console.log('ℹ️ Booking already paid:', booking.booking_id);
    return;
  }

  if (booking.payment_status === PAYMENT_STATUS.REFUNDED) {
    logPaymentEvent('LATE_PAYMENT_IGNORED_AFTER_REFUND', {
      booking_id: booking.booking_id,
      invoice_id: payment.id,
    });
    return;
  }

  const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();

  if (
    latestPayment
    && String(latestPayment.payment_reference || '') !== String(payment.id || '')
  ) {
    await expireActiveXenditInvoiceForBooking(booking.booking_id);
  }

  await db.query(
    `UPDATE bookings SET
      payment_status = ?,
      booking_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE booking_id = ?
      AND payment_status IN (?, ?, ?, ?)`,
    [
      paidState.paymentStatus,
      paidState.bookingStatus,
      booking.booking_id,
      PAYMENT_STATUS.UNPAID,
      PAYMENT_STATUS.PENDING,
      PAYMENT_STATUS.FAILED,
      PAYMENT_STATUS.EXPIRED,
    ],
  );

  await markXenditPaymentPaid({
    bookingId: booking.booking_id,
    customerId: booking.customer_id,
    invoiceId: payment.id,
    amount: payment.amount,
    paymentMethod: booking.payment_method || 'xendit',
    paidAt,
  });

  await logAudit({
    userId: 0,
    action: AUDIT_ACTIONS.PAYMENT_RECEIVED,
    entityType: 'booking',
    entityId: booking.booking_id,
    newValue: {
      invoice_id: payment.id,
      external_id: payment.external_id,
      amount: payment.amount,
      status: payment.status,
    },
  });

  logPaymentEvent('PAYMENT_SUCCESS', {
    booking_id: booking.booking_id,
    invoice_id: payment.id,
    external_id: payment.external_id,
    amount: payment.amount,
  });

  try {
    const target = await getBookingNotificationTarget(booking.booking_id);
    if (target?.user_id) {
      await notifyPaymentReceived({
        userId: target.user_id,
        customerId: target.customer_id,
        bookingReference: target.booking_reference,
      });
    }
  } catch (notifyError) {
    console.warn('Payment received notification failed:', notifyError.message);
  }

  try {
    const emailBooking = await resolveCustomerEmailForBooking(booking.booking_id);

    if (emailBooking?.email) {
      const [items] = await db.query(
        `SELECT bi.quantity AS qty, bi.unit_price AS price, bi.item_name AS name, bi.item_type AS category
         FROM booking_items bi WHERE bi.booking_id = ?`,
        [booking.booking_id],
      );

      let qrCodeData = null;
      try {
        const formattedQRData = formatBookingDataForQR(
          {
            booking_reference: emailBooking.booking_reference,
            first_name: emailBooking.first_name,
            last_name: emailBooking.last_name,
          },
          items.map((item) => ({
            item_name: item.name,
            quantity: item.qty,
            item_type: item.category || 'Room',
          })),
        );
        qrCodeData = await generateQRCode(formattedQRData);
      } catch (qrError) {
        console.warn('QR code generation failed after payment:', qrError.message);
      }

      await sendBookingConfirmationWithQR(
        {
          email: emailBooking.email,
          firstName: emailBooking.first_name,
          lastName: emailBooking.last_name,
          bookingReference: emailBooking.booking_reference,
          checkIn: emailBooking.check_in_date,
          checkOut: emailBooking.check_out_date,
          items: items.map((item) => ({ name: item.name, qty: item.qty, price: item.price })),
          total: emailBooking.total,
        },
        qrCodeData?.base64 || null,
      );
    } else {
      console.warn(`Confirmation email skipped for booking ${booking.booking_id}: no customer email found`);
    }
  } catch (emailError) {
    console.warn('Confirmation email failed after webhook payment:', emailError.message);
  }
};

const processFailedInvoiceWebhook = async (payment) => {
  const lookup = buildBookingLookup(payment.external_id);

  const [bookingRows] = await db.query(
    `SELECT booking_id FROM bookings ${lookup.sql} LIMIT 1`,
    lookup.params,
  );

  const bookingId = bookingRows[0]?.booking_id || 0;
  const latestPayment = bookingId ? await getLatestPaymentForBooking(bookingId) : null;

  if (
    latestPayment?.payment_reference
    && String(latestPayment.payment_reference) !== String(payment.id)
  ) {
    logPaymentEvent('STALE_PAYMENT_FAILURE_IGNORED', {
      booking_id: bookingId,
      stale_invoice_id: payment.id,
      active_invoice_id: latestPayment.payment_reference,
      status: payment.status,
    });
    return;
  }

  const failedState = getFailedBookingPaymentState(payment.status);
  const whereClause = lookup.sql.replace(/^WHERE /i, '');
  const [releaseResult] = await db.query(
    `UPDATE bookings SET
      payment_status = ?,
      booking_status = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE (${whereClause})
       AND payment_status NOT IN (?, ?)`,
    [
      failedState.paymentStatus,
      failedState.bookingStatus,
      ...lookup.params,
      PAYMENT_STATUS.PAID,
      PAYMENT_STATUS.REFUNDED,
    ],
  );

  const bookingReleased = Number(releaseResult?.affectedRows || 0) > 0;
  if (bookingId && bookingReleased) {
    await db.query('DELETE FROM occupied_dates WHERE booking_id = ?', [bookingId]);
  }

  if (bookingId && bookingReleased) {
    await markXenditPaymentFailedOrExpired({
      bookingId,
      invoiceId: payment.id,
      status: payment.status,
    });
  }

  await logAudit({
    userId: 0,
    action: AUDIT_ACTIONS.PAYMENT_FAILED,
    entityType: 'booking',
    entityId: bookingId,
    newValue: {
      invoice_id: payment.id,
      external_id: payment.external_id,
      status: payment.status,
    },
  });

  logPaymentEvent('PAYMENT_FAILED', {
    booking_id: bookingId,
    invoice_id: payment.id,
    external_id: payment.external_id,
    status: payment.status,
  });
};

export const createPayment = async (req, res) => {
  try {
    if (!XENDIT_API_KEY) {
      return res.status(500).json({
        error: 'Payment service not configured. Please contact administrator.',
      });
    }

    const {
      email,
      description,
      bookingId,
      customerName,
      paymentMethod,
    } = req.body;

    const hasAccess = await assertBookingAccess(req, res, bookingId);
    if (!hasAccess) return;

    const selectedPaymentMethod = String(paymentMethod || '').trim().toUpperCase();

    if (!email || !bookingId || !customerName) {
      return res.status(400).json({
        error: 'Missing required fields: email, bookingId, customerName',
      });
    }
    if (!selectedPaymentMethod || !mapPaymentMethodToXenditInvoiceChannels(selectedPaymentMethod)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PAYMENT_METHOD',
        error: 'Please select a valid payment method.',
      });
    }

    const bookingData = await getBookingAmountDue(bookingId);
    if (!bookingData) {
      return res.status(404).json({ error: 'Booking not found or invalid amount' });
    }

    const { booking, amountDue } = bookingData;

    if (booking.payment_status === PAYMENT_STATUS.PAID) {
      return res.status(400).json({ error: 'Booking is already paid' });
    }

    if (!canCreatePaymentForBooking(booking)) {
      return res.status(409).json({
        success: false,
        code: 'BOOKING_NOT_PAYMENT_PENDING',
        error: 'This booking is no longer awaiting payment. Please create a new reservation.',
      });
    }

    const previousPayment = await getLatestPaymentForBooking(bookingId);
    if (
      previousPayment
      && String(previousPayment.status || '').toLowerCase() === 'pending'
      && isPaymentRequestId(previousPayment.payment_reference)
    ) {
      const cancellation = await cancelPaymentRequest(previousPayment.payment_reference);
      if (isPaymentRequestPaid(cancellation.paymentRequest)) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_ALREADY_COMPLETED',
          error: 'The previous QR payment was already completed. Please wait while it is confirmed.',
        });
      }
      if (cancellation.unsupportedLegacyRequest) {
        logPaymentEvent('PAYMENT_SUPERSEDED_UNCANCELLED', {
          booking_id: bookingId,
          payment_request_id: previousPayment.payment_reference,
          replacement_payment_method: selectedPaymentMethod,
        });
      }
      await markXenditPaymentFailedOrExpired({
        bookingId,
        invoiceId: previousPayment.payment_reference,
        status: 'EXPIRED',
      });
    }

    const reusable = await findReusableXenditInvoice(bookingId, selectedPaymentMethod);
    if (reusable && selectedPaymentMethod !== 'QRPH') {
      logPaymentEvent('PAYMENT_REUSED', {
        booking_id: bookingId,
        invoice_id: reusable.invoice_id,
      });

      return res.json({
        success: true,
        reused: true,
        checkout_mode: 'redirect',
        checkout_url: reusable.checkout_url,
        invoice_id: reusable.invoice_id,
        external_id: reusable.invoice.external_id,
        status: reusable.invoice.status,
        amount: amountDue,
        expiry_date: reusable.invoice.expiry_date,
        booking_id: bookingId,
        payment_method_note: 'Reused existing unpaid Xendit invoice for this booking.',
      });
    }

    await expireActiveXenditInvoiceForBooking(bookingId);

    if (selectedPaymentMethod === 'QRPH') {
      const qrPayment = await createQrphPaymentRequest({
        bookingId,
        amount: amountDue,
      });
      const qrImage = await qrStringToDataUrl(qrPayment.qr_string);

      await db.query(
        `UPDATE bookings
         SET payment_status = ?,
             booking_status = ?,
             payment_method = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE booking_id = ?`,
        [
          BOOKING_PAYMENT_STATUS_FOR_UNPAID_FLOW,
          BOOKING_STATUS.PENDING,
          selectedPaymentMethod,
          bookingId,
        ],
      );

      await upsertXenditPendingPayment({
        bookingId: booking.booking_id,
        customerId: booking.customer_id,
        invoiceId: qrPayment.paymentRequestId,
        amount: amountDue,
        paymentMethod: selectedPaymentMethod,
        checkoutUrl: null,
      });

      logPaymentEvent('PAYMENT_CREATED', {
        booking_id: bookingId,
        payment_request_id: qrPayment.paymentRequestId,
        amount: amountDue,
        payment_method: selectedPaymentMethod,
        checkout_mode: 'embedded_qr',
      });

      return res.json({
        success: true,
        reused: false,
        checkout_mode: 'embedded_qr',
        qr_string: qrPayment.qr_string,
        qr_image: qrImage,
        payment_request_id: qrPayment.paymentRequestId,
        invoice_id: qrPayment.paymentRequestId,
        status: qrPayment.status,
        amount: amountDue,
        expiry_date: qrPayment.expires_at,
        booking_id: bookingId,
        payment_method: selectedPaymentMethod,
        payment_method_note: 'Scan the QR code with your bank or e-wallet app to complete payment.',
      });
    }

    const trimmedEmail = String(email).trim();
    const trimmedCustomerName = String(customerName).trim();
    const [givenName, ...otherNameParts] = trimmedCustomerName.split(' ').filter(Boolean);
    const surname = otherNameParts.join(' ');

    const invoiceData = {
      external_id: `BOOKING-${bookingId}-${Date.now()}`,
      amount: Math.round(amountDue),
      payer_email: trimmedEmail,
      description: description || `Booking Payment - ${bookingId}`,
      currency: 'PHP',
      invoice_duration: PAYMENT_HOLD_SECONDS,
      customer: {
        given_names: givenName,
        ...(surname ? { surname } : {}),
        email: trimmedEmail,
      },
      success_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-return?bookingId=${bookingId}&gateway=xendit`,
      failure_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-return?bookingId=${bookingId}&status=failed&gateway=xendit`,
    };

    const xenditChannels = mapPaymentMethodToXenditInvoiceChannels(selectedPaymentMethod);
    if (xenditChannels?.length) {
      invoiceData.payment_methods = xenditChannels;
    }

    const response = await fetch(XENDIT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
      },
      body: JSON.stringify(invoiceData),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Failed to create payment',
        details: data,
      });
    }

    await db.query(
      `UPDATE bookings
       SET payment_status = ?,
           booking_status = ?,
           payment_method = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
      [
        BOOKING_PAYMENT_STATUS_FOR_UNPAID_FLOW,
        BOOKING_STATUS.PENDING,
        selectedPaymentMethod,
        bookingId,
      ],
    );

    await upsertXenditPendingPayment({
      bookingId: booking.booking_id,
      customerId: booking.customer_id,
      invoiceId: data.id,
      amount: amountDue,
      paymentMethod: selectedPaymentMethod,
      checkoutUrl: data.invoice_url || null,
    });

    logPaymentEvent('PAYMENT_CREATED', {
      booking_id: bookingId,
      invoice_id: data.id,
      amount: amountDue,
      payment_method: selectedPaymentMethod,
      payment_methods_sent: xenditChannels || 'all',
    });

    res.json({
      success: true,
      reused: false,
      checkout_mode: 'redirect',
      checkout_url: data.invoice_url,
      invoice_id: data.id,
      external_id: data.external_id,
      status: data.status,
      amount: amountDue,
      expiry_date: data.expiry_date,
      booking_id: bookingId,
      payment_method: selectedPaymentMethod,
      payment_methods_sent: xenditChannels || null,
      payment_method_note: xenditChannels
        ? 'Your selected method is prioritized on the Xendit checkout page.'
        : 'You will choose the final payment channel on the Xendit checkout page.',
    });
  } catch (error) {
    console.error('Xendit Payment Error:', error);
    const status = Number(error?.status) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: error.message || 'Internal server error',
      message: error.message,
      code: error.code || error.details?.error_code || null,
      details: error.details || null,
    });
  }
};

export const getPaymentMethods = async (req, res) => {
  try {
    const methods = [
      { code: 'GCASH', label: 'GCash', description: 'Pay using GCash on the Xendit secure checkout page.' },
      { code: 'MAYA', label: 'Maya', description: 'Pay using Maya on the Xendit secure checkout page.' },
      { code: 'CARD', label: 'Credit / Debit Card', description: 'Pay using Visa, Mastercard, or JCB on Xendit checkout.' },
      { code: 'QRPH', label: 'QRPH', description: 'Scan an on-page QRPH code with your bank or e-wallet app.' },
      { code: 'BANK_TRANSFER', label: 'Bank Transfer', description: 'Pay through bank transfer on the Xendit checkout page.' },
      { code: 'CASH', label: 'Cash', description: 'Pay upon arrival at the resort. No online checkout required.' },
    ];

    res.json({
      success: true,
      data: methods,
      checkout_mode: 'xendit_invoice_v2',
      note: 'Online methods are completed on the Xendit hosted checkout page. Your selected method is prioritized, but final channel confirmation happens on Xendit.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load payment methods' });
  }
};

/**
 * Server-side payment confirmation when Xendit webhook cannot reach localhost.
 * Verifies invoice status directly with Xendit API — never trusts client payment claims.
 * POST /api/xendit/confirm-payment { bookingId, invoiceId }
 */
export const confirmPaymentFromXendit = async (req, res) => {
  try {
    const bookingId = req.body?.bookingId;
    let invoiceId = req.body?.invoiceId;

    const hasAccess = await assertBookingAccess(
      req,
      res,
      bookingId
    );

    if (!hasAccess) return;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        error: 'bookingId is required',
      });
    }

    if (!XENDIT_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Payment service not configured',
      });
    }

    const [existingBookingRows] = await db.query(
      `SELECT booking_id, booking_reference, payment_status, booking_status
       FROM bookings WHERE booking_id = ? LIMIT 1`,
      [bookingId],
    );
    const existingBooking = existingBookingRows[0] || null;

    if (!existingBooking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    if (existingBooking.payment_status === PAYMENT_STATUS.PAID) {
      return res.json({
        success: true,
        isPaid: true,
        alreadyPaid: true,
        booking: existingBooking,
      });
    }

    if (isPlaceholderInvoiceId(invoiceId)) {
      invoiceId = null;
    }

    if (!invoiceId) {
      const latestPayment = await getLatestPaymentForBooking(bookingId);
      invoiceId = latestPayment?.payment_reference || null;
    }

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        error: 'invoiceId is required',
        message: 'No payment reference found for this booking yet.',
      });
    }

    if (isPaymentRequestId(invoiceId)) {
      const paymentRequest = await fetchPaymentRequest(invoiceId);
      const metadataBookingId = paymentRequest?.metadata?.booking_id;

      if (metadataBookingId && String(metadataBookingId) !== String(bookingId)) {
        logSecurityEvent('PAYMENT_BOOKING_MISMATCH', {
          booking_id: bookingId,
          payment_request_id: invoiceId,
          metadata_booking_id: metadataBookingId,
        });
        return res.status(400).json({
          success: false,
          error: 'Payment request does not match booking',
        });
      }

      if (!isPaymentRequestPaid(paymentRequest)) {
        return res.json({
          success: false,
          isPaid: false,
          status: paymentRequest.status,
          message: 'Payment not completed yet',
        });
      }

      const paidAmount = Number(
        paymentRequest.request_amount
        ?? paymentRequest.amount
        ?? paymentRequest.capture_amount
        ?? 0,
      );

      const bookingData = await getBookingAmountDue(bookingId);
      if (!bookingData) {
        return res.status(404).json({ success: false, error: 'Booking not found or invalid amount' });
      }

      if (paidAmount > 0 && !amountsMatch(paidAmount, bookingData.amountDue)) {
        logSecurityEvent('PAYMENT_AMOUNT_MISMATCH', {
          booking_id: bookingId,
          expected: bookingData.amountDue,
          received: paidAmount,
          payment_request_id: invoiceId,
        });
        return res.status(400).json({
          success: false,
          error: 'PAYMENT_AMOUNT_MISMATCH',
        });
      }

      const { booking } = bookingData;
      const paidAt = paymentRequest.updated ? new Date(paymentRequest.updated) : new Date();
      const paidState = getPaidBookingPaymentState();

      await db.query(
        `UPDATE bookings SET
          payment_status = ?,
          booking_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE booking_id = ?
          AND payment_status IN (?, ?, ?, ?)`,
        [
          paidState.paymentStatus,
          paidState.bookingStatus,
          booking.booking_id,
          PAYMENT_STATUS.UNPAID,
          PAYMENT_STATUS.PENDING,
          PAYMENT_STATUS.FAILED,
          PAYMENT_STATUS.EXPIRED,
        ],
      );

      await markXenditPaymentPaid({
        bookingId: booking.booking_id,
        customerId: booking.customer_id,
        invoiceId,
        amount: paidAmount || bookingData.amountDue,
        paymentMethod: booking.payment_method || 'QRPH',
        paidAt,
      });

      const [rows] = await db.query(
        `SELECT booking_id, booking_reference, payment_status, booking_status
         FROM bookings WHERE booking_id = ? LIMIT 1`,
        [bookingId],
      );

      return res.json({
        success: true,
        isPaid: true,
        booking: rows[0] || null,
      });
    }

    const response = await fetch(`${XENDIT_API_URL}/${invoiceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
      },
    });

    const invoice = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: 'Failed to verify payment with Xendit',
        details: invoice,
      });
    }

    const invoiceStatus = String(invoice.status).toUpperCase();
    if (!['PAID', 'SETTLED'].includes(invoiceStatus)) {
      return res.json({
        success: false,
        isPaid: false,
        status: invoice.status,
        message: 'Payment not completed yet',
      });
    }

    if (!invoiceBelongsToBooking(invoice.external_id, bookingId)) {
      logSecurityEvent('PAYMENT_BOOKING_MISMATCH', {
        booking_id: bookingId,
        invoice_id: invoiceId,
        external_id: invoice.external_id,
      });
      return res.status(400).json({
        success: false,
        error: 'Invoice does not match booking',
      });
    }

    await processPaidInvoiceWebhook(invoice);

    const [rows] = await db.query(
      `SELECT booking_id, booking_reference, payment_status, booking_status
       FROM bookings WHERE booking_id = ? LIMIT 1`,
      [bookingId],
    );

    return res.json({
      success: true,
      isPaid: true,
      booking: rows[0] || null,
    });
  } catch (error) {
    if (error.message === 'PAYMENT_AMOUNT_MISMATCH') {
      return res.status(400).json({
        success: false,
        error: 'PAYMENT_AMOUNT_MISMATCH',
      });
    }
    console.error('confirmPaymentFromXendit error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to confirm payment',
      message: error.message,
    });
  }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const hasAccess = await assertInvoiceAccess(req, res, invoiceId);
    if (!hasAccess) return;

    if (isPaymentRequestId(invoiceId)) {
      const paymentRequest = await fetchPaymentRequest(invoiceId);

      return res.json({
        success: true,
        isPaid: isPaymentRequestPaid(paymentRequest),
        status: paymentRequest.status,
        amount: paymentRequest.request_amount ?? paymentRequest.amount,
        payment_request_id: paymentRequest.id,
        checkout_mode: 'embedded_qr',
      });
    }

    const response = await fetch(`${XENDIT_API_URL}/${invoiceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: 'Failed to get payment status',
        details: data,
      });
    }

    res.json({
      success: true,
      isPaid: ['PAID', 'SETTLED'].includes(String(data.status).toUpperCase()),
      status: data.status,
      paid_at: data.paid_at,
      amount: data.amount,
      external_id: data.external_id,
      invoice_id: data.id,
      checkout_mode: 'redirect',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
};

const runWebhookHandler = async (req, res, handler) => {
  const body = req.body || {};
  const isRefundEvent = body.event && String(body.event).toLowerCase().includes('refund');
  const eventId = isRefundEvent
    ? buildRefundWebhookEventId(body.data || body)
    : buildWebhookEventId(body);
  const eventType = isRefundEvent
    ? String(body.event)
    : `invoice.${String(body.status || 'unknown').toLowerCase()}`;

  const begin = await beginWebhookEvent(eventId, eventType);

  if (begin.action === 'skip_completed') {
    return res.status(200).json({ success: true, duplicate: true });
  }

  if (begin.action === 'skip_in_progress') {
    return res.status(200).json({ success: true, processing: true });
  }

  try {
    const result = await handler(body);
    await completeWebhookEvent(eventId);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    await failWebhookEvent(eventId, error.message);
    if (error.message === 'PAYMENT_AMOUNT_MISMATCH') {
      return res.status(400).json({
        success: false,
        error: 'PAYMENT_AMOUNT_MISMATCH',
      });
    }
    console.error('❌ Webhook Error:', error);
    logSecurityEvent('INVALID_WEBHOOK', {
      error: error.message,
      path: req.originalUrl,
    });
    return res.status(500).json({
      success: false,
      error: 'Webhook processing failed',
    });
  }
};

export const abandonUnpaidBooking = async (req, res) => {
  try {
    const bookingId = req.body?.bookingId || req.params?.bookingId;
    const reason = String(req.body?.reason || 'Payment session could not be started').trim();

    const hasAccess = await assertBookingAccess(req, res, bookingId);
    if (!hasAccess) return;

    const [rows] = await db.query(
      `SELECT booking_id, booking_reference, booking_status, payment_status
       FROM bookings
       WHERE booking_id = ?
       LIMIT 1`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const paymentStatus = String(booking.payment_status || '').toLowerCase();
    const bookingStatus = String(booking.booking_status || '').toLowerCase();

    if (paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Paid bookings cannot be abandoned',
      });
    }

    if (bookingStatus.includes('cancel')) {
      return res.json({
        success: true,
        already_cancelled: true,
        booking_id: booking.booking_id,
        booking_reference: booking.booking_reference,
      });
    }

    await db.query(
      `UPDATE bookings
       SET booking_status = ?,
           payment_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
      [BOOKING_STATUS.CANCELLED, PAYMENT_STATUS.FAILED, bookingId],
    );

    await db.query(`DELETE FROM occupied_dates WHERE booking_id = ?`, [bookingId]);

    try {
      await db.query(
        `INSERT INTO booking_logs (booking_id, action, old_status, new_status, description, performed_by)
         VALUES (?, 'Cancelled', ?, 'Cancelled', ?, 'Customer')`,
        [bookingId, booking.booking_status, reason],
      );
    } catch (logError) {
      console.warn('Unable to write abandon booking log:', logError.message);
    }

    logPaymentEvent('PAYMENT_ABANDONED', {
      booking_id: bookingId,
      booking_reference: booking.booking_reference,
      reason,
    });

    return res.json({
      success: true,
      booking_id: booking.booking_id,
      booking_reference: booking.booking_reference,
      booking_status: BOOKING_STATUS.CANCELLED,
      payment_status: PAYMENT_STATUS.FAILED,
    });
  } catch (error) {
    console.error('Abandon unpaid booking error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to abandon unpaid booking',
    });
  }
};

export const webhookHandler = async (req, res) => {
  const body = req.body || {};

  if (body.event && String(body.event).toLowerCase().includes('refund')) {
    return runWebhookHandler(req, res, async () => {
      const refundResult = await handleXenditRefundWebhook(body.data || body, req);
      return { handled: refundResult.handled, duplicate: false };
    });
  }

  return runWebhookHandler(req, res, async (payload) => {
    if (isPosExternalId(payload.external_id)) {
      const posResult = await routeXenditInvoiceWebhook(payload);
      return { received: true, ...posResult };
    }

    if (payload.status === 'PAID' && payload.external_id) {
      await processPaidInvoiceWebhook(payload);
    } else if (payload.status === 'EXPIRED' || payload.status === 'FAILED') {
      await processFailedInvoiceWebhook(payload);
    } else if (payload.id && String(payload.status).toUpperCase() === 'SUCCEEDED' && payload.invoice_id) {
      await handleXenditRefundWebhook(payload, req);
    } else {
      console.log('ℹ️ Xendit Webhook - Unhandled payload:', {
        status: payload.status,
        event: payload.event,
        id: payload.id,
      });
    }

    return { received: true };
  });
};
