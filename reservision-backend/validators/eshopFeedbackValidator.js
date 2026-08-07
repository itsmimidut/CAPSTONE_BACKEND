import {
    ESHOP_FEEDBACK_LIMITS,
    ESHOP_FEEDBACK_MODERATION_STATUS,
    ESHOP_PUBLIC_SORT_SQL,
} from '../constants/eshopFeedbackRules.js';

const CREATE_FIELDS = new Set(['transactionItemId', 'overallRating', 'title', 'comment', 'isAnonymous']);
const UPDATE_FIELDS = new Set(['overallRating', 'title', 'comment', 'isAnonymous']);

const fail = (res, errors) => res.status(422).json({
    success: false,
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    errors,
});

const positiveInteger = (value, field, errors) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        errors.push({ field, message: `${field} must be a positive integer.` });
        return null;
    }
    return parsed;
};

const validateBody = (req, res, next, create) => {
    const errors = [];
    const allowed = create ? CREATE_FIELDS : UPDATE_FIELDS;
    Object.keys(req.body || {}).filter((key) => !allowed.has(key)).forEach((field) => {
        errors.push({ field, message: `${field} is not allowed.` });
    });

    const overallRating = Number(req.body?.overallRating);
    if (!Number.isInteger(overallRating)
        || overallRating < ESHOP_FEEDBACK_LIMITS.MIN_RATING
        || overallRating > ESHOP_FEEDBACK_LIMITS.MAX_RATING) {
        errors.push({ field: 'overallRating', message: 'Overall rating must be between 1 and 5.' });
    }

    const title = req.body?.title == null || String(req.body.title).trim() === ''
        ? null
        : String(req.body.title).trim();
    if (title && title.length > ESHOP_FEEDBACK_LIMITS.MAX_TITLE_LENGTH) {
        errors.push({ field: 'title', message: `Title must not exceed ${ESHOP_FEEDBACK_LIMITS.MAX_TITLE_LENGTH} characters.` });
    }

    const comment = String(req.body?.comment ?? '').trim();
    if (comment.length < ESHOP_FEEDBACK_LIMITS.MIN_COMMENT_LENGTH) {
        errors.push({ field: 'comment', message: `Comment must contain at least ${ESHOP_FEEDBACK_LIMITS.MIN_COMMENT_LENGTH} characters.` });
    }
    if (comment.length > ESHOP_FEEDBACK_LIMITS.MAX_COMMENT_LENGTH) {
        errors.push({ field: 'comment', message: `Comment must not exceed ${ESHOP_FEEDBACK_LIMITS.MAX_COMMENT_LENGTH} characters.` });
    }

    const isAnonymous = req.body?.isAnonymous ?? false;
    if (typeof isAnonymous !== 'boolean') {
        errors.push({ field: 'isAnonymous', message: 'isAnonymous must be a boolean.' });
    }

    const transactionItemId = create
        ? positiveInteger(req.body?.transactionItemId, 'transactionItemId', errors)
        : null;
    const feedbackId = create
        ? null
        : positiveInteger(req.params?.feedbackId, 'feedbackId', errors);

    if (errors.length) return fail(res, errors);
    req.validatedEshopFeedback = {
        ...(create ? { transactionItemId } : { feedbackId }),
        overallRating,
        title,
        comment,
        isAnonymous,
    };
    return next();
};

const validateParam = (param, target) => (req, res, next) => {
    const errors = [];
    const value = positiveInteger(req.params?.[param], param, errors);
    if (errors.length) return fail(res, errors);
    req[target] = value;
    return next();
};

export const validateCreateEshopFeedback = (req, res, next) => validateBody(req, res, next, true);
export const validateUpdateEshopFeedback = (req, res, next) => validateBody(req, res, next, false);
export const validateEshopFeedbackId = validateParam('feedbackId', 'validatedEshopFeedbackId');
export const validateTransactionItemId = validateParam('transactionItemId', 'validatedTransactionItemId');

const queryInteger = (value, field, errors, { fallback = null, min = 1, max = null } = {}) => {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || (max !== null && parsed > max)) {
        errors.push({ field, message: `${field} must be an integer from ${min}${max ? ` to ${max}` : ''}.` });
        return fallback;
    }
    return parsed;
};

const dateOnly = (value, field, errors) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        errors.push({ field, message: `${field} must use YYYY-MM-DD format.` });
        return null;
    }
    return value;
};

export const validatePublicEshopFeedbackQuery = (req, res, next) => {
    const errors = [];
    const menuItemId = queryInteger(req.query.menuItemId, 'menuItemId', errors);
    if (menuItemId === null && req.query.menuItemId === undefined) {
        errors.push({ field: 'menuItemId', message: 'menuItemId is required.' });
    }
    const page = queryInteger(req.query.page, 'page', errors, { fallback: 1 });
    const limit = queryInteger(req.query.limit, 'limit', errors, { fallback: 10, max: 50 });
    const rating = queryInteger(req.query.rating, 'rating', errors, { fallback: null, max: 5 });
    const sort = String(req.query.sort || 'newest');
    if (!ESHOP_PUBLIC_SORT_SQL[sort]) errors.push({ field: 'sort', message: 'sort must be newest, oldest, highest, or lowest.' });
    if (errors.length) return fail(res, errors);
    req.validatedEshopPublicQuery = { menuItemId, page, limit, rating, sort };
    return next();
};

export const validateAdminEshopFeedbackQuery = (req, res, next) => {
    const errors = [];
    const page = queryInteger(req.query.page, 'page', errors, { fallback: 1 });
    const limit = queryInteger(req.query.limit, 'limit', errors, { fallback: 10, max: 50 });
    const rating = queryInteger(req.query.rating, 'rating', errors, { fallback: null, max: 5 });
    const menuItemId = queryInteger(req.query.menuItemId, 'menuItemId', errors, { fallback: null });
    const statuses = ['all', ...Object.values(ESHOP_FEEDBACK_MODERATION_STATUS), 'deleted'];
    const status = String(req.query.status || 'all');
    if (!statuses.includes(status)) errors.push({ field: 'status', message: `status must be one of: ${statuses.join(', ')}.` });
    const sort = String(req.query.sort || 'newest');
    if (!ESHOP_PUBLIC_SORT_SQL[sort]) errors.push({ field: 'sort', message: 'sort must be newest, oldest, highest, or lowest.' });
    const dateFrom = dateOnly(req.query.dateFrom, 'dateFrom', errors);
    const dateTo = dateOnly(req.query.dateTo, 'dateTo', errors);
    if (dateFrom && dateTo && dateFrom > dateTo) errors.push({ field: 'dateTo', message: 'dateTo must not be earlier than dateFrom.' });
    const search = String(req.query.search || '').trim();
    if (search.length > 100) errors.push({ field: 'search', message: 'search must not exceed 100 characters.' });
    if (errors.length) return fail(res, errors);
    req.validatedEshopAdminQuery = { page, limit, rating, menuItemId, status, sort, dateFrom, dateTo, search };
    return next();
};

export const validateEshopModeration = (req, res, next) => {
    const errors = [];
    const feedbackId = positiveInteger(req.params.feedbackId, 'feedbackId', errors);
    Object.keys(req.body || {}).filter((key) => !['status', 'reason'].includes(key))
        .forEach((field) => errors.push({ field, message: `${field} is not allowed.` }));
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!Object.values(ESHOP_FEEDBACK_MODERATION_STATUS).includes(status)) {
        errors.push({ field: 'status', message: 'A valid moderation status is required.' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (status === 'rejected' && !reason) errors.push({ field: 'reason', message: 'A rejection reason is required.' });
    if (reason.length > 500) errors.push({ field: 'reason', message: 'Reason must not exceed 500 characters.' });
    if (errors.length) return fail(res, errors);
    req.validatedEshopModeration = { feedbackId, status, reason: status === 'rejected' ? reason : null };
    return next();
};

export const validateEshopReply = (req, res, next) => {
    const errors = [];
    const feedbackId = positiveInteger(req.params.feedbackId, 'feedbackId', errors);
    Object.keys(req.body || {}).filter((key) => key !== 'reply')
        .forEach((field) => errors.push({ field, message: `${field} is not allowed.` }));
    const reply = String(req.body?.reply || '').trim();
    if (reply.length < 2) errors.push({ field: 'reply', message: 'Reply must contain at least 2 characters.' });
    if (reply.length > 2000) errors.push({ field: 'reply', message: 'Reply must not exceed 2000 characters.' });
    if (errors.length) return fail(res, errors);
    req.validatedEshopReply = { feedbackId, reply };
    return next();
};
