import fetch from 'node-fetch';
import db from '../config/db.js';
import { PAYMENT_RECORD_STATUS } from '../utils/paymentStatuses.js';
import { isPaymentRequestId } from './xenditQrPaymentService.js';

const XENDIT_INVOICE_URL = 'https://api.xendit.co/v2/invoices';

const ACTIVE_XENDIT_INVOICE_STATUSES = new Set(['PENDING', 'AWAITING_PAYMENT']);

export const isCashPaymentMethod = (method) =>
  String(method || '').trim().toUpperCase() === 'CASH';

export const mapPaymentMethodToXenditInvoiceChannels = (method) => {
  const normalized = String(method || '').trim().toUpperCase();
  const map = {
    GCASH: ['GCASH'],
    MAYA: ['PAYMAYA'],
    PAYMAYA: ['PAYMAYA'],
    CARD: ['CREDIT_CARD', 'DEBIT_CARD'],
    CREDIT_CARD: ['CREDIT_CARD', 'DEBIT_CARD'],
    DEBIT_CARD: ['DEBIT_CARD'],
    QRPH: ['QRPH'],
    BANK_TRANSFER: ['BANK_TRANSFER'],
    GRABPAY: ['GRABPAY'],
    SHOPEEPAY: ['SHOPEEPAY'],
  };

  return map[normalized] || null;
};

const getXenditAuthHeader = () => {
  const apiKey = process.env.XENDIT_SECRET_KEY;
  if (!apiKey) {
    throw new Error('XENDIT_SECRET_KEY is not configured');
  }
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
  };
};

export const isGatewayInvoiceReference = (reference) => {
  const value = String(reference || '').trim();
  if (!value) return false;
  if (isPaymentRequestId(value)) return false;
  return !value.startsWith('PAY') && !value.startsWith('BOOKING-') && !value.startsWith('CASH-');
};

export const getLatestPaymentForBooking = async (bookingId) => {
  const [rows] = await db.query(
    `SELECT payment_id, booking_id, customer_id, payment_reference, payment_method,
            payment_gateway, amount, status, checkout_url, created_at, updated_at
     FROM payments
     WHERE booking_id = ?
     ORDER BY payment_id DESC
     LIMIT 1`,
    [bookingId],
  );
  return rows[0] || null;
};

export const getActiveXenditPaymentForBooking = async (bookingId) => {
  const [rows] = await db.query(
    `SELECT payment_id, booking_id, customer_id, payment_reference, payment_method,
            payment_gateway, amount, status, checkout_url, created_at, updated_at
     FROM payments
     WHERE booking_id = ?
       AND payment_gateway = 'xendit'
       AND status IN ('pending', 'expired')
     ORDER BY payment_id DESC
     LIMIT 1`,
    [bookingId],
  );
  return rows[0] || null;
};

export const fetchXenditInvoice = async (invoiceId) => {
  const response = await fetch(`${XENDIT_INVOICE_URL}/${invoiceId}`, {
    method: 'GET',
    headers: getXenditAuthHeader(),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.message || 'Failed to fetch Xendit invoice');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
};

/**
 * Reuse an existing unpaid Xendit invoice when the customer retries checkout.
 */
export const findReusableXenditInvoice = async (bookingId, paymentMethod = null) => {
  const paymentRow = await getActiveXenditPaymentForBooking(bookingId);
  if (!paymentRow || !isGatewayInvoiceReference(paymentRow.payment_reference)) {
    return null;
  }

  const requestedMethod = String(paymentMethod || '').trim().toUpperCase();
  const existingMethod = String(paymentRow.payment_method || '').trim().toUpperCase();
  if (requestedMethod && existingMethod && requestedMethod !== existingMethod) {
    return null;
  }

  try {
    const invoice = await fetchXenditInvoice(paymentRow.payment_reference);
    const invoiceStatus = String(invoice.status || '').toUpperCase();

    if (!ACTIVE_XENDIT_INVOICE_STATUSES.has(invoiceStatus)) {
      return null;
    }

    return {
      invoice,
      paymentRow,
      checkout_url: paymentRow.checkout_url || invoice.invoice_url,
      invoice_id: invoice.id,
      reused: true,
    };
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const expireActiveXenditInvoiceForBooking = async (bookingId) => {
  const paymentRow = await getActiveXenditPaymentForBooking(bookingId);
  if (!paymentRow || !isGatewayInvoiceReference(paymentRow.payment_reference)) {
    return { expired: false };
  }

  let invoice;
  try {
    invoice = await fetchXenditInvoice(paymentRow.payment_reference);
  } catch (error) {
    if (error.status === 404) return { expired: false };
    throw error;
  }

  if (!ACTIVE_XENDIT_INVOICE_STATUSES.has(String(invoice.status || '').toUpperCase())) {
    return { expired: false };
  }

  const response = await fetch(
    `${XENDIT_INVOICE_URL}/${encodeURIComponent(paymentRow.payment_reference)}/expire!`,
    {
      method: 'POST',
      headers: getXenditAuthHeader(),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.message || 'Failed to expire previous Xendit invoice');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  await db.query(
    `UPDATE payments
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE payment_id = ?
       AND status = ?`,
    [
      PAYMENT_RECORD_STATUS.EXPIRED,
      paymentRow.payment_id,
      PAYMENT_RECORD_STATUS.PENDING,
    ],
  );

  return {
    expired: true,
    invoiceId: paymentRow.payment_reference,
  };
};

export const upsertXenditPendingPayment = async ({
  bookingId,
  customerId,
  invoiceId,
  amount,
  paymentMethod,
  checkoutUrl,
}) => {
  const existing = await getLatestPaymentForBooking(bookingId);

  if (existing && ['paid', 'refunded'].includes(String(existing.status || '').toLowerCase())) {
    const error = new Error('Booking payment is already completed');
    error.code = 'PAYMENT_ALREADY_COMPLETED';
    throw error;
  }

  if (
    existing
    && String(existing.payment_reference || '') === String(invoiceId || '')
  ) {
    await db.query(
      `UPDATE payments
       SET payment_reference = ?,
           amount = ?,
           payment_method = ?,
           payment_gateway = 'xendit',
           status = ?,
           currency = 'PHP',
           checkout_url = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE payment_id = ?`,
      [
        invoiceId,
        amount,
        paymentMethod,
        PAYMENT_RECORD_STATUS.PENDING,
        checkoutUrl,
        existing.payment_id,
      ],
    );
    return existing.payment_id;
  }

  const [result] = await db.query(
    `INSERT INTO payments (
        booking_id,
        customer_id,
        payment_reference,
        amount,
        payment_method,
        payment_gateway,
        status,
        currency,
        checkout_url,
        created_at
      ) VALUES (?, ?, ?, ?, ?, 'xendit', ?, 'PHP', ?, NOW())`,
    [
      bookingId,
      customerId,
      invoiceId,
      amount,
      paymentMethod,
      PAYMENT_RECORD_STATUS.PENDING,
      checkoutUrl,
    ],
  );

  return result.insertId;
};

export const markXenditPaymentPaid = async ({
  bookingId,
  customerId,
  invoiceId,
  amount,
  paymentMethod,
  paidAt,
}) => {
  const [rows] = await db.query(
    `SELECT payment_id
     FROM payments
     WHERE booking_id = ?
       AND payment_reference = ?
     LIMIT 1`,
    [bookingId, invoiceId],
  );

  const paidAtValue = paidAt || new Date();

  if (rows.length) {
    await db.query(
      `UPDATE payments
       SET payment_reference = ?,
           amount = ?,
           payment_method = COALESCE(?, payment_method),
           payment_gateway = 'xendit',
           status = ?,
           currency = 'PHP',
           paid_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE payment_id = ?`,
      [
        invoiceId,
        amount,
        paymentMethod,
        PAYMENT_RECORD_STATUS.PAID,
        paidAtValue,
        rows[0].payment_id,
      ],
    );
    return rows[0].payment_id;
  }

  const [result] = await db.query(
    `INSERT INTO payments (
        booking_id,
        customer_id,
        payment_reference,
        amount,
        payment_method,
        payment_gateway,
        status,
        currency,
        paid_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, 'xendit', ?, 'PHP', ?, NOW())`,
    [
      bookingId,
      customerId,
      invoiceId,
      amount,
      paymentMethod || 'xendit',
      PAYMENT_RECORD_STATUS.PAID,
      paidAtValue,
    ],
  );

  return result.insertId;
};

export const markXenditPaymentFailedOrExpired = async ({
  bookingId,
  invoiceId,
  status,
}) => {
  const recordStatus = status === 'EXPIRED'
    ? PAYMENT_RECORD_STATUS.EXPIRED
    : PAYMENT_RECORD_STATUS.FAILED;

  await db.query(
    `UPDATE payments
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE booking_id = ?
       AND payment_reference = ?`,
    [recordStatus, bookingId, invoiceId],
  );
};

export const createCashPaymentRecord = async ({
  bookingId,
  customerId,
  paymentMethod,
  amount,
}) => {
  const existing = await getLatestPaymentForBooking(bookingId);
  if (existing) {
    return existing.payment_id;
  }

  const paymentReference = `CASH-${bookingId}-${Date.now()}`;
  const [result] = await db.query(
    `INSERT INTO payments (
        booking_id,
        customer_id,
        payment_reference,
        payment_method,
        payment_gateway,
        amount,
        status,
        currency,
        created_at
      ) VALUES (?, ?, ?, ?, 'manual', ?, 'pending', 'PHP', NOW())`,
    [bookingId, customerId, paymentReference, paymentMethod, amount],
  );

  return result.insertId;
};
