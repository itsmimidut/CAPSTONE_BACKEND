/** Normalized payment architecture statuses (Sprint 4.5) */

export const BOOKING_STATUS = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  CHECKED_IN: 'Checked-In',
  CHECKED_OUT: 'Checked-Out',
};

export const PAYMENT_STATUS = {
  UNPAID: 'Unpaid',
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  EXPIRED: 'Expired',
};

export const REFUND_STATUS = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

export const PAYMENT_RECORD_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
};

export const WEBHOOK_PROCESSING_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/** POS transaction payment lifecycle (Phase 2) */
export const POS_PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  VOIDED: 'VOIDED',
};

export const POS_TRANSACTION_STATUS = {
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
};
