import {
  FeedbackServiceError,
  checkFeedbackEligibility,
  createFeedback,
  deleteFeedback,
  getCustomerFeedbackHistory,
  getAdminFeedback,
  getAdminFeedbackById,
  getFeedbackByBooking,
  getPublicFeedback,
  moderateFeedback,
  replyToFeedback,
  restoreFeedbackAsAdmin,
  updateFeedback,
} from '../services/feedbackService.js';

const sendServiceError = (res, error) => {
  if (error instanceof FeedbackServiceError) {
    return res.status(error.status).json({
      success: false,
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error('Feedback API error:', error);
  return res.status(500).json({
    success: false,
    error: 'Unable to process feedback right now.',
    code: 'FEEDBACK_INTERNAL_ERROR',
  });
};

export const getEligibility = async (req, res) => {
  try {
    const result = await checkFeedbackEligibility({
      bookingId: Number(req.params.bookingId),
      userId: req.user.id,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const getMyFeedback = async (req, res) => {
  try {
    const result = await getCustomerFeedbackHistory({
      userId: req.user.id,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const getBookingFeedback = async (req, res) => {
  try {
    const result = await getFeedbackByBooking({
      bookingId: Number(req.params.bookingId),
      userId: req.user.id,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const create = async (req, res) => {
  try {
    const result = await createFeedback({
      userId: req.user.id,
      input: req.validatedFeedback,
      req,
    });
    return res.status(result.restored ? 200 : 201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const update = async (req, res) => {
  try {
    const result = await updateFeedback({
      feedbackId: req.validatedFeedback.feedbackId,
      userId: req.user.id,
      input: req.validatedFeedback,
      req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const remove = async (req, res) => {
  try {
    const result = await deleteFeedback({
      feedbackId: Number(req.params.feedbackId),
      userId: req.user.id,
      req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const getPublic = async (req, res) => {
  try {
    const result = await getPublicFeedback(req.validatedFeedbackQuery);
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const getAdminList = async (req, res) => {
  try {
    const result = await getAdminFeedback(req.validatedFeedbackQuery);
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const getAdminById = async (req, res) => {
  try {
    const result = await getAdminFeedbackById({
      feedbackId: req.validatedFeedbackId,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const moderateAsAdmin = async (req, res) => {
  try {
    const result = await moderateFeedback({
      feedbackId: req.validatedModeration.feedbackId,
      adminUserId: req.user.id,
      status: req.validatedModeration.status,
      reason: req.validatedModeration.reason,
      req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const replyAsAdmin = async (req, res) => {
  try {
    const result = await replyToFeedback({
      feedbackId: req.validatedAdminReply.feedbackId,
      adminUserId: req.user.id,
      reply: req.validatedAdminReply.reply,
      req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};

export const restoreAsAdmin = async (req, res) => {
  try {
    const result = await restoreFeedbackAsAdmin({
      feedbackId: req.validatedFeedbackId,
      adminUserId: req.user.id,
      req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
};
