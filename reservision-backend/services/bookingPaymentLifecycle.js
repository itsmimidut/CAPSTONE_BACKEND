import { BOOKING_STATUS, PAYMENT_STATUS } from '../utils/paymentStatuses.js';
import { isCashPaymentMethod } from './paymentRecordService.js';

export const getInitialBookingPaymentState = (paymentMethod) => ({
  bookingStatus: BOOKING_STATUS.PENDING,
  paymentStatus: isCashPaymentMethod(paymentMethod)
    ? PAYMENT_STATUS.UNPAID
    : PAYMENT_STATUS.PENDING,
});

export const getPaidBookingPaymentState = () => ({
  // Payment settlement is not reservation approval. The booking remains
  // pending until an authorized admin explicitly confirms it.
  bookingStatus: BOOKING_STATUS.PENDING,
  paymentStatus: PAYMENT_STATUS.PAID,
});

export const getFailedBookingPaymentState = (gatewayStatus) => {
  const expired = String(gatewayStatus || '').toUpperCase() === 'EXPIRED';
  return {
    bookingStatus: expired ? BOOKING_STATUS.EXPIRED : BOOKING_STATUS.CANCELLED,
    paymentStatus: expired ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.FAILED,
    releaseInventory: true,
  };
};

export const canCreatePaymentForBooking = (booking = {}) => (
  booking.booking_status === BOOKING_STATUS.PENDING
  && booking.payment_status !== PAYMENT_STATUS.PAID
);

export const resolveBookingIdFromExternalId = (externalId) => {
  const normalized = String(externalId || '').trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const match = normalized.match(/^BOOKING-(\d+)-/i);
  if (match) return Number(match[1]);
  return null;
};

export const invoiceBelongsToBooking = (externalId, bookingId) => {
  const parsed = resolveBookingIdFromExternalId(externalId);
  if (parsed != null) return String(parsed) === String(bookingId);
  return String(externalId) === String(bookingId);
};

export const isPlaceholderInvoiceId = (invoiceId) => {
  const value = String(invoiceId || '').trim();
  if (!value) return true;
  return /\{+\s*INVOICE_ID\s*\}+/i.test(value);
};

