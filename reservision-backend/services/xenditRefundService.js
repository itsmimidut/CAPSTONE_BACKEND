import fetch from 'node-fetch';
import dotenv from 'dotenv';
import db from '../config/db.js';
import { logPaymentEvent } from '../utils/logger.js';
import { logAudit, AUDIT_ACTIONS } from '../utils/auditLogger.js';
import { sendRefundProcessedEmail } from './emailService.js';
import { notifyRefundCompleted } from './customerNotificationService.js';
import {
  BOOKING_STATUS,
  PAYMENT_RECORD_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../utils/paymentStatuses.js';

dotenv.config();
const XENDIT_REFUND_URL = 'https://api.xendit.co/refunds';

const getXenditApiKey = () => process.env.XENDIT_SECRET_KEY;
const getAuthHeader = () => {
  const XENDIT_API_KEY = getXenditApiKey();
  return {
    Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
};

export const getXenditInvoiceIdForBooking = async (bookingId) => {
  const context = await getXenditPaymentContextForBooking(bookingId);
  return context.invoiceId;
};

export const getXenditPaymentContextForBooking = async (bookingId) => {
  const [rows] = await db.query(
    `SELECT payment_reference, payment_gateway, status, payment_method
     FROM payments
     WHERE booking_id = ?
     ORDER BY created_at DESC`,
    [bookingId],
  );

  if (!rows.length) {
    return {
      invoiceId: null,
      refundable: false,
      reason: 'no_payment_records',
      message: 'This booking has no payment records. Automatic refund via Xendit is not available.',
      gateways: [],
    };
  }

  const xenditRows = rows.filter((row) => String(row.payment_gateway || '').toLowerCase() === 'xendit');
  const paidXendit = xenditRows.find((row) =>
    /^(paid|settled|completed|success)$/i.test(String(row.status || '')),
  );

  if (paidXendit?.payment_reference) {
    return {
      invoiceId: paidXendit.payment_reference,
      refundable: true,
      reason: null,
      message: null,
      gateways: rows.map((row) => row.payment_gateway).filter(Boolean),
      paymentMethod: paidXendit.payment_method,
    };
  }

  const gateways = [...new Set(rows.map((row) => row.payment_gateway).filter(Boolean))];
  const hasPendingXendit = xenditRows.some((row) =>
    /^(pending|unpaid)$/i.test(String(row.status || '')),
  );

  let message = 'No paid Xendit invoice was found for this booking. Automatic refund via Xendit is not available.';
  if (hasPendingXendit) {
    message = 'A Xendit invoice exists but payment is not marked as paid yet. Confirm payment first before approving a gateway refund.';
  }

  return {
    invoiceId: null,
    refundable: false,
    reason: 'no_paid_xendit_invoice',
    message,
    gateways,
  };
};

const normalizeXenditRefundReason = (reason) => {
  const value = String(reason || '').trim().toUpperCase();
  if (['CANCELLATION', 'FRAUDULENT', 'DUPLICATE', 'REQUESTED_BY_CUSTOMER'].includes(value)) {
    return value === 'REQUESTED_BY_CUSTOMER' ? 'CANCELLATION' : value;
  }
  return 'CANCELLATION';
};

export const createXenditRefund = async ({ invoiceId, amount, reason = 'CANCELLATION', referenceId = null }) => {
  const XENDIT_API_KEY = getXenditApiKey();
  if (!XENDIT_API_KEY) {
    throw new Error('XENDIT_SECRET_KEY is not configured');
  }

  if (!invoiceId) {
    throw new Error('Xendit invoice ID is required for refund');
  }

  const resolvedReferenceId = referenceId || `refund-${invoiceId}-${Date.now()}`;
  const payload = {
    invoice_id: invoiceId,
    reference_id: resolvedReferenceId,
    currency: process.env.XENDIT_CURRENCY || 'PHP',
    reason: normalizeXenditRefundReason(reason),
  };

  if (amount !== undefined && amount !== null) {
    payload.amount = Math.round(Number(amount));
  }

  const response = await fetch(XENDIT_REFUND_URL, {
    method: 'POST',
    headers: {
      ...getAuthHeader(),
      'idempotency-key': resolvedReferenceId,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.errors?.[0]?.message || data?.message || 'Xendit refund request failed';
    logPaymentEvent('REFUND_FAILED', {
      invoice_id: invoiceId,
      amount: payload.amount,
      error: detail,
      details: data,
    });
    throw new Error(detail);
  }

  logPaymentEvent('REFUND_SUCCESS', {
    refund_id: data.id,
    invoice_id: invoiceId,
    amount: data.amount,
    status: data.status,
  });

  return data;
};

const sendRefundCompletionNotifications = async (refundId) => {
  const [rows] = await db.query(
    `SELECT
      r.refund_id,
      r.refund_reference,
      r.refund_amount,
      r.gateway_reference,
      b.booking_reference,
      c.customer_id,
      c.user_id,
      COALESCE(NULLIF(TRIM(u.email), ''), NULLIF(TRIM(c.email), ''), NULLIF(TRIM(b.email), '')) AS email,
      COALESCE(u.first_name, c.first_name, 'Guest') AS first_name
     FROM refunds r
     JOIN bookings b ON b.booking_id = r.booking_id
     LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
     LEFT JOIN \`user\` u ON u.user_id = c.user_id
     WHERE r.refund_id = ?
     LIMIT 1`,
    [refundId],
  );

  if (!rows.length) {
    return;
  }

  const row = rows[0];

  if (row.email) {
    try {
      await sendRefundProcessedEmail({
        email: row.email,
        firstName: row.first_name,
        bookingReference: row.booking_reference,
        refundAmount: row.refund_amount,
        gatewayReference: row.gateway_reference,
      });
    } catch (emailError) {
      console.warn('Refund completion email failed:', emailError.message);
    }
  } else {
    console.warn(`Refund completion email skipped for refund ${refundId}: no customer email found`);
  }

  if (row.user_id) {
    try {
      await notifyRefundCompleted({
        userId: row.user_id,
        customerId: row.customer_id,
        bookingReference: row.booking_reference,
      });
    } catch (notifyError) {
      console.warn('Refund completion notification failed:', notifyError.message);
    }
  }
};

export const completeRefundInDatabase = async ({
  refundId,
  gatewayReference,
  gatewayStatus,
  req = null,
  userId = 0,
}) => {
  const [refundRows] = await db.query(
    'SELECT * FROM refunds WHERE refund_id = ? LIMIT 1',
    [refundId],
  );

  if (!refundRows.length) {
    throw new Error(`Refund not found: ${refundId}`);
  }

  const refund = refundRows[0];

  if (refund.refund_status === REFUND_STATUS.COMPLETED) {
    return { alreadyCompleted: true, refund };
  }

  if (![REFUND_STATUS.PROCESSING, 'Approved', 'Refunded'].includes(refund.refund_status)) {
    throw new Error(`Refund ${refundId} is not processing (status=${refund.refund_status})`);
  }

  const bookingStatus = refund.refund_type === 'Partial'
    ? BOOKING_STATUS.PARTIALLY_REFUNDED
    : BOOKING_STATUS.CANCELLED;

  const bookingPaymentStatus = refund.refund_type === 'Partial'
    ? PAYMENT_STATUS.REFUNDED
    : PAYMENT_STATUS.REFUNDED;

  const bookingRefundStatus = refund.refund_type === 'Partial'
    ? REFUND_STATUS.COMPLETED
    : refund.refund_type === 'No Refund'
      ? 'No Refund'
      : REFUND_STATUS.COMPLETED;

  await db.query(
    `UPDATE refunds SET
      refund_status = ?,
      refunded_at = NOW(),
      gateway_reference = COALESCE(?, gateway_reference),
      gateway_status = COALESCE(?, gateway_status),
      updated_at = NOW()
    WHERE refund_id = ?`,
    [REFUND_STATUS.COMPLETED, gatewayReference || null, gatewayStatus || null, refundId],
  );

  await db.query(
    `UPDATE bookings SET
      refund_status = ?,
      booking_status = ?,
      payment_status = ?,
      last_refunded_at = NOW(),
      updated_at = CURRENT_TIMESTAMP
    WHERE booking_id = ?`,
    [bookingRefundStatus, bookingStatus, bookingPaymentStatus, refund.booking_id],
  );

  if (Number(refund.refund_amount) > 0) {
    await db.query(
      `UPDATE payments SET
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE booking_id = ?
        AND payment_gateway = 'xendit'`,
      [PAYMENT_RECORD_STATUS.REFUNDED, refund.booking_id],
    );
  }

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.REFUND_COMPLETED,
    entityType: 'refund',
    entityId: refundId,
    oldValue: { refund_status: refund.refund_status },
    newValue: {
      refund_status: REFUND_STATUS.COMPLETED,
      gateway_reference: gatewayReference,
      gateway_status: gatewayStatus,
    },
    req,
  });

  await sendRefundCompletionNotifications(refundId);

  return { alreadyCompleted: false, refund };
};

export const completeNoRefundInDatabase = async ({ refundId, req = null, userId = 0 }) => {
  const [refundRows] = await db.query(
    'SELECT * FROM refunds WHERE refund_id = ? LIMIT 1',
    [refundId],
  );

  if (!refundRows.length) {
    throw new Error(`Refund not found: ${refundId}`);
  }

  const refund = refundRows[0];

  await db.query(
    `UPDATE refunds SET
      refund_status = ?,
      refunded_at = NOW(),
      updated_at = NOW()
    WHERE refund_id = ?`,
    [REFUND_STATUS.COMPLETED, refundId],
  );

  await db.query(
    `UPDATE bookings SET
      refund_status = 'No Refund',
      booking_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE booking_id = ?`,
    [BOOKING_STATUS.CANCELLED, refund.booking_id],
  );

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.REFUND_COMPLETED,
    entityType: 'refund',
    entityId: refundId,
    newValue: { refund_status: REFUND_STATUS.COMPLETED, refund_type: 'No Refund' },
    req,
  });

  return { completed: true, refund };
};

export const processApprovedRefundViaXendit = async ({
  refund,
  req = null,
  userId = 0,
}) => {
  if (refund.refund_type === 'No Refund' || Number(refund.refund_amount) <= 0) {
    await completeNoRefundInDatabase({ refundId: refund.refund_id, req, userId });
    return { skipped: true, reason: 'no_gateway_refund_required', completed: true };
  }

  const paymentContext = await getXenditPaymentContextForBooking(refund.booking_id);
  if (!paymentContext.invoiceId) {
    throw new Error(paymentContext.message);
  }

  const xenditRefund = await createXenditRefund({
    invoiceId: paymentContext.invoiceId,
    amount: refund.refund_amount,
    reason: 'CANCELLATION',
    referenceId: `refund-${refund.refund_id}`,
  });

  await db.query(
    `UPDATE refunds SET
      gateway_reference = ?,
      gateway_status = ?,
      updated_at = NOW()
    WHERE refund_id = ?`,
    [xenditRefund.id, xenditRefund.status, refund.refund_id],
  );

  if (String(xenditRefund.status).toUpperCase() === 'SUCCEEDED') {
    await completeRefundInDatabase({
      refundId: refund.refund_id,
      gatewayReference: xenditRefund.id,
      gatewayStatus: xenditRefund.status,
      req,
      userId,
    });
    return { skipped: false, xenditRefund, completed: true };
  }

  return { skipped: false, xenditRefund, completed: false };
};

const findRefundRecordForWebhook = async (gatewayRefundId, invoiceId) => {
  const [byGateway] = await db.query(
    `SELECT refund_id, refund_status
     FROM refunds
     WHERE gateway_reference = ?
     ORDER BY refund_id DESC
     LIMIT 1`,
    [gatewayRefundId],
  );

  if (byGateway.length) {
    return byGateway[0];
  }

  if (!invoiceId) {
    return null;
  }

  const [paymentRows] = await db.query(
    `SELECT booking_id
     FROM payments
     WHERE payment_reference = ?
     LIMIT 1`,
    [invoiceId],
  );

  if (!paymentRows.length) {
    return null;
  }

  const [byBooking] = await db.query(
    `SELECT refund_id, refund_status
     FROM refunds
     WHERE gateway_reference IS NULL
       AND booking_id = ?
     ORDER BY refund_id DESC
     LIMIT 1`,
    [paymentRows[0].booking_id],
  );

  return byBooking[0] || null;
};

export const handleXenditRefundWebhook = async (payload, req = null) => {
  const refundId = payload?.id;
  const status = String(payload?.status || '').toUpperCase();
  const invoiceId = payload?.invoice_id;

  if (!refundId || status !== 'SUCCEEDED') {
    return { handled: false };
  }

  const refundRecord = await findRefundRecordForWebhook(refundId, invoiceId);

  if (!refundRecord) {
    return { handled: false, reason: 'refund_record_not_found' };
  }

  await completeRefundInDatabase({
    refundId: refundRecord.refund_id,
    gatewayReference: refundId,
    gatewayStatus: status,
    req,
    userId: 0,
  });

  return { handled: true, refundId: refundRecord.refund_id };
};
