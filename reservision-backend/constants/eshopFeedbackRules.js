import {
    FEEDBACK_ALLOWED_TRANSITIONS,
    FEEDBACK_LIMITS,
    FEEDBACK_MODERATION_STATUS,
} from './feedbackRules.js';

export const ESHOP_FEEDBACK_EDIT_WINDOW_DAYS = 7;
export const ESHOP_FEEDBACK_SUBMISSION_WINDOW_DAYS = 30;
export const ESHOP_FEEDBACK_ELIGIBLE_STATUSES = new Set(['delivered', 'picked_up']);
export const ESHOP_FEEDBACK_MODERATION_STATUS = FEEDBACK_MODERATION_STATUS;
export const ESHOP_FEEDBACK_MODERATION_TRANSITIONS = FEEDBACK_ALLOWED_TRANSITIONS;
export const ESHOP_FEEDBACK_LIMITS = FEEDBACK_LIMITS;
export const ESHOP_PUBLIC_SORT_SQL = Object.freeze({
    newest: 'f.created_at DESC',
    oldest: 'f.created_at ASC',
    highest: 'f.overall_rating DESC, f.created_at DESC',
    lowest: 'f.overall_rating ASC, f.created_at DESC',
});

export const ESHOP_FEEDBACK_CODE = Object.freeze({
    TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
    ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
    NOT_OWNER: 'NOT_OWNER',
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',
    SUBMISSION_WINDOW_EXPIRED: 'SUBMISSION_WINDOW_EXPIRED',
    FEEDBACK_EXISTS: 'FEEDBACK_EXISTS',
    FEEDBACK_EDITABLE: 'FEEDBACK_EDITABLE',
    FEEDBACK_DELETED_RESTORABLE: 'FEEDBACK_DELETED_RESTORABLE',
    EDIT_WINDOW_EXPIRED: 'EDIT_WINDOW_EXPIRED',
    ELIGIBLE: 'ELIGIBLE',
});

export const normalizeEshopValue = (value) => String(value ?? '').trim().toLowerCase();

export const addUtcDays = (value, days) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date;
};

export const getEshopFeedbackEditDeadline = (createdAt) =>
    addUtcDays(createdAt, ESHOP_FEEDBACK_EDIT_WINDOW_DAYS);

export const getEshopFeedbackSubmissionDeadline = (fulfilledAt) =>
    addUtcDays(fulfilledAt, ESHOP_FEEDBACK_SUBMISSION_WINDOW_DAYS);

export const isWithinEshopFeedbackEditWindow = (createdAt, now = new Date()) => {
    const deadline = getEshopFeedbackEditDeadline(createdAt);
    return Boolean(deadline && now.getTime() <= deadline.getTime());
};

export const isWithinEshopFeedbackSubmissionWindow = (fulfilledAt, now = new Date()) => {
    const deadline = getEshopFeedbackSubmissionDeadline(fulfilledAt);
    return Boolean(deadline && now.getTime() <= deadline.getTime());
};
