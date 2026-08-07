export const SALES_CHANNELS = Object.freeze({
  RESERVATION: 'reservation',
  RESTAURANT_POS: 'restaurant_pos',
  ESHOP: 'eshop',
});

export const SUCCESSFUL_REFUND_STATUSES = Object.freeze(['APPROVED', 'REFUNDED', 'COMPLETED']);
export const REVENUE_PAYMENT_STATUSES = Object.freeze(['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PARTIAL_REFUND']);
export const MAX_SALES_REPORT_SEARCH_LENGTH = 150;
export const MAX_TRANSACTION_EXPORT_ROWS = 25000;

export const normalizeReportStatus = (value) => String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_');
export const approximatelyEqual = (left, right, tolerance = 0.01) => Math.abs(Number(left || 0) - Number(right || 0)) <= tolerance;
