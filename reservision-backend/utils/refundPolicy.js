import { BOOKING_STATUS, PAYMENT_STATUS, REFUND_STATUS } from './paymentStatuses.js';

export const sanitizeSpreadsheetCell = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export const canRejectRefundStatus = status => status === REFUND_STATUS.PENDING;

export const calculateRemainingRefundableAmount = ({ paidAmount = 0, completedRefundAmount = 0 } = {}) => (
  Math.max(0, Math.round((Number(paidAmount || 0) - Number(completedRefundAmount || 0)) * 100) / 100)
);

export const getRefundCompletionState = (refundType) => {
  const partial = refundType === 'Partial';
  return {
    bookingStatus: partial ? BOOKING_STATUS.PARTIALLY_REFUNDED : BOOKING_STATUS.CANCELLED,
    paymentStatus: partial ? PAYMENT_STATUS.PARTIALLY_REFUNDED : PAYMENT_STATUS.REFUNDED,
    updatePaymentRecordAsRefunded: !partial,
  };
};
