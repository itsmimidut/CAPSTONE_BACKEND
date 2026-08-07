import { FEEDBACK_LIMITS } from '../constants/feedbackRules.js';

const CREATE_FIELDS = new Set([
  'bookingId',
  'overallRating',
  'title',
  'comment',
  'isAnonymous',
]);
const UPDATE_FIELDS = new Set([
  'overallRating',
  'title',
  'comment',
  'isAnonymous',
]);

const findUnknownFields = (body, allowed) =>
  Object.keys(body || {}).filter((field) => !allowed.has(field));

const validatePositiveInteger = (value, field, errors) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push({ field, message: `${field} must be a positive integer.` });
    return null;
  }
  return parsed;
};

const validateRating = (value, errors) => {
  const rating = Number(value);
  if (
    !Number.isInteger(rating)
    || rating < FEEDBACK_LIMITS.MIN_RATING
    || rating > FEEDBACK_LIMITS.MAX_RATING
  ) {
    errors.push({
      field: 'overallRating',
      message: 'Overall rating must be between 1 and 5.',
    });
    return null;
  }
  return rating;
};

const validateTitle = (value, errors) => {
  if (value == null || String(value).trim() === '') return null;
  const title = String(value).trim();
  if (title.length > FEEDBACK_LIMITS.MAX_TITLE_LENGTH) {
    errors.push({
      field: 'title',
      message: `Title must not exceed ${FEEDBACK_LIMITS.MAX_TITLE_LENGTH} characters.`,
    });
    return null;
  }
  return title;
};

const validateComment = (value, errors) => {
  const comment = String(value ?? '').trim();
  if (comment.length < FEEDBACK_LIMITS.MIN_COMMENT_LENGTH) {
    errors.push({
      field: 'comment',
      message: `Comment must contain at least ${FEEDBACK_LIMITS.MIN_COMMENT_LENGTH} characters.`,
    });
  }
  if (comment.length > FEEDBACK_LIMITS.MAX_COMMENT_LENGTH) {
    errors.push({
      field: 'comment',
      message: `Comment must not exceed ${FEEDBACK_LIMITS.MAX_COMMENT_LENGTH} characters.`,
    });
  }
  return comment;
};

const validateBoolean = (value, field, errors) => {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    errors.push({ field, message: `${field} must be a boolean.` });
    return false;
  }
  return value;
};

const sendValidationError = (res, errors) => res.status(400).json({
  success: false,
  error: 'Validation failed',
  code: 'VALIDATION_ERROR',
  errors,
});

const parseQueryInteger = (value, field, errors, { min = 1, max = null, fallback }) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max !== null && parsed > max)) {
    errors.push({ field, message: `${field} must be an integer between ${min} and ${max ?? 'any higher value'}.` });
    return fallback;
  }
  return parsed;
};

const parseDate = (value, field, errors) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    errors.push({ field, message: `${field} must use YYYY-MM-DD format.` });
    return null;
  }
  return value;
};

const validateBody = (req, res, next, { create }) => {
  const errors = [];
  const allowed = create ? CREATE_FIELDS : UPDATE_FIELDS;
  for (const field of findUnknownFields(req.body, allowed)) {
    errors.push({ field, message: `${field} is not allowed.` });
  }

  const feedbackId = create
    ? null
    : validatePositiveInteger(req.params?.feedbackId, 'feedbackId', errors);
  const bookingId = create
    ? validatePositiveInteger(req.body?.bookingId, 'bookingId', errors)
    : null;
  const overallRating = validateRating(req.body?.overallRating, errors);
  const title = validateTitle(req.body?.title, errors);
  const comment = validateComment(req.body?.comment, errors);
  const isAnonymous = validateBoolean(req.body?.isAnonymous, 'isAnonymous', errors);

  if (errors.length) return sendValidationError(res, errors);
  req.validatedFeedback = {
    ...(create ? { bookingId } : { feedbackId }),
    overallRating,
    title,
    comment,
    isAnonymous,
  };
  return next();
};

export const validateCreateFeedback = (req, res, next) =>
  validateBody(req, res, next, { create: true });

export const validateUpdateFeedback = (req, res, next) =>
  validateBody(req, res, next, { create: false });

const validateParam = (req, res, next, { source, target }) => {
  const errors = [];
  const value = validatePositiveInteger(req.params?.[source], source, errors);
  if (errors.length) return sendValidationError(res, errors);
  req[target] = value;
  return next();
};

export const validateFeedbackId = (req, res, next) =>
  validateParam(req, res, next, {
    source: 'feedbackId',
    target: 'validatedFeedbackId',
  });

export const validateBookingId = (req, res, next) =>
  validateParam(req, res, next, {
    source: 'bookingId',
    target: 'validatedBookingId',
  });

export const validatePublicFeedbackQuery = (req, res, next) => {
  const errors = [];
  const page = parseQueryInteger(req.query.page, 'page', errors, { fallback: 1 });
  const limit = parseQueryInteger(req.query.limit, 'limit', errors, {
    max: FEEDBACK_LIMITS.MAX_PAGE_SIZE,
    fallback: FEEDBACK_LIMITS.DEFAULT_PAGE_SIZE,
  });
  const rating = req.query.rating === undefined
    ? null
    : parseQueryInteger(req.query.rating, 'rating', errors, { max: 5, fallback: null });
  const sort = req.query.sort || 'newest';
  if (!['newest', 'oldest', 'highest', 'lowest'].includes(sort)) {
    errors.push({ field: 'sort', message: 'sort must be newest, oldest, highest, or lowest.' });
  }
  if (errors.length) return sendValidationError(res, errors);
  req.validatedFeedbackQuery = { page, limit, rating, sort };
  return next();
};

export const validateAdminFeedbackQuery = (req, res, next) => {
  const errors = [];
  const page = parseQueryInteger(req.query.page, 'page', errors, { fallback: 1 });
  const limit = parseQueryInteger(req.query.limit, 'limit', errors, {
    max: FEEDBACK_LIMITS.MAX_PAGE_SIZE,
    fallback: FEEDBACK_LIMITS.DEFAULT_PAGE_SIZE,
  });
  const rating = req.query.rating === undefined
    ? null
    : parseQueryInteger(req.query.rating, 'rating', errors, { max: 5, fallback: null });
  const status = req.query.status || 'all';
  const allowedStatuses = ['pending', 'approved', 'rejected', 'hidden', 'deleted', 'all'];
  if (!allowedStatuses.includes(status)) {
    errors.push({ field: 'status', message: `status must be one of: ${allowedStatuses.join(', ')}.` });
  }
  const sort = req.query.sort || 'newest';
  if (!['newest', 'oldest', 'highest', 'lowest'].includes(sort)) {
    errors.push({ field: 'sort', message: 'sort must be newest, oldest, highest, or lowest.' });
  }
  const dateFrom = parseDate(req.query.dateFrom, 'dateFrom', errors);
  const dateTo = parseDate(req.query.dateTo, 'dateTo', errors);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    errors.push({ field: 'dateTo', message: 'dateTo must not be earlier than dateFrom.' });
  }
  const search = String(req.query.search || '').trim();
  if (search.length > 100) errors.push({ field: 'search', message: 'search must not exceed 100 characters.' });
  if (errors.length) return sendValidationError(res, errors);
  req.validatedFeedbackQuery = { page, limit, status, rating, dateFrom, dateTo, search, sort };
  return next();
};

export const validateModeration = (req, res, next) => {
  const errors = [];
  const feedbackId = validatePositiveInteger(req.params?.feedbackId, 'feedbackId', errors);
  const unknown = findUnknownFields(req.body, new Set(['status', 'reason']));
  unknown.forEach((field) => errors.push({ field, message: `${field} is not allowed.` }));
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['pending', 'approved', 'rejected', 'hidden'].includes(status)) {
    errors.push({ field: 'status', message: 'A valid moderation status is required.' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (status === 'rejected' && !reason) {
    errors.push({ field: 'reason', message: 'A rejection reason is required.' });
  }
  if (reason.length > 500) errors.push({ field: 'reason', message: 'Reason must not exceed 500 characters.' });
  if (errors.length) return sendValidationError(res, errors);
  req.validatedModeration = { feedbackId, status, reason: reason || null };
  return next();
};

export const validateAdminReply = (req, res, next) => {
  const errors = [];
  const feedbackId = validatePositiveInteger(req.params?.feedbackId, 'feedbackId', errors);
  const unknown = findUnknownFields(req.body, new Set(['reply']));
  unknown.forEach((field) => errors.push({ field, message: `${field} is not allowed.` }));
  const reply = String(req.body?.reply || '').trim();
  if (reply.length < 2) errors.push({ field: 'reply', message: 'Reply must contain at least 2 characters.' });
  if (reply.length > 2000) errors.push({ field: 'reply', message: 'Reply must not exceed 2000 characters.' });
  if (errors.length) return sendValidationError(res, errors);
  req.validatedAdminReply = { feedbackId, reply };
  return next();
};
