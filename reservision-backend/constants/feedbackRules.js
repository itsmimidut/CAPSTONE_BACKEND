export const FEEDBACK_EDIT_WINDOW_DAYS = 7;

export const FEEDBACK_LIMITS = Object.freeze({
  MIN_RATING: 1,
  MAX_RATING: 5,
  MAX_TITLE_LENGTH: 150,
  MIN_COMMENT_LENGTH: 10,
  MAX_COMMENT_LENGTH: 2000,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 50,
});

export const FEEDBACK_MODERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  HIDDEN: 'hidden',
});

export const FEEDBACK_ELIGIBILITY_CODE = Object.freeze({
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_NOT_OWNED: 'BOOKING_NOT_OWNED',
  BOOKING_NOT_COMPLETED: 'BOOKING_NOT_COMPLETED',
  FEEDBACK_ALREADY_EXISTS: 'FEEDBACK_ALREADY_EXISTS',
  FEEDBACK_EDITABLE: 'FEEDBACK_EDITABLE',
  FEEDBACK_DELETED_RESTORABLE: 'FEEDBACK_DELETED_RESTORABLE',
  FEEDBACK_EDIT_WINDOW_EXPIRED: 'FEEDBACK_EDIT_WINDOW_EXPIRED',
  ELIGIBLE: 'ELIGIBLE',
});

export const FEEDBACK_ELIGIBLE_BOOKING_STATUSES = new Set([
  'checked_out',
  'completed',
]);

export const FEEDBACK_PUBLIC_SORT_SQL = Object.freeze({
  newest: 'f.created_at DESC',
  oldest: 'f.created_at ASC',
  highest: 'f.overall_rating DESC, f.created_at DESC',
  lowest: 'f.overall_rating ASC, f.created_at DESC',
});

export const FEEDBACK_ALLOWED_TRANSITIONS = Object.freeze({
  pending: new Set(['approved', 'rejected']),
  approved: new Set(['hidden']),
  rejected: new Set(['pending']),
  hidden: new Set(['approved']),
});

export function canTransitionFeedbackStatus(currentStatus, nextStatus) {
  return Boolean(FEEDBACK_ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus));
}

export function normalizeBookingStatus(status) {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isFeedbackEligibleBooking(booking) {
  const normalizedStatus = normalizeBookingStatus(booking?.booking_status);
  if (!FEEDBACK_ELIGIBLE_BOOKING_STATUSES.has(normalizedStatus)) return false;
  if (normalizedStatus === 'checked_out' && !booking?.actual_check_out_time) return false;
  return true;
}

export function getFeedbackEditDeadline(createdAt) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  created.setUTCDate(created.getUTCDate() + FEEDBACK_EDIT_WINDOW_DAYS);
  return created;
}

export function isWithinFeedbackEditWindow(createdAt, serverNow = new Date()) {
  const deadline = getFeedbackEditDeadline(createdAt);
  return Boolean(deadline && serverNow.getTime() <= deadline.getTime());
}
