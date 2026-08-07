import {
    EshopFeedbackServiceError,
    createFeedback,
    deleteFeedback,
    getCustomerHistory,
    getEligibility,
    getFeedback,
    getPublicFeedback,
    getAdminFeedback,
    getAdminFeedbackById,
    moderateFeedback,
    replyToFeedback,
    restoreFeedbackAsAdmin,
    restoreFeedback,
    updateFeedback,
} from '../services/eshopFeedbackService.js';

export const sendEshopFeedbackError = (res, error) => {
    if (error instanceof EshopFeedbackServiceError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    console.error('E-Shop feedback API error:', error);
    return res.status(500).json({
        success: false,
        error: 'Unable to process E-Shop feedback right now.',
        code: 'ESHOP_FEEDBACK_INTERNAL_ERROR',
    });
};

export const eligibility = async (req, res) => {
    try {
        const data = await getEligibility({
            transactionItemId: req.validatedTransactionItemId,
            userId: req.user.id,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const create = async (req, res) => {
    try {
        const data = await createFeedback({
            userId: req.user.id,
            input: req.validatedEshopFeedback,
            req,
        });
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const mine = async (req, res) => {
    try {
        const data = await getCustomerHistory({
            userId: req.user.id,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const item = async (req, res) => {
    try {
        const data = await getFeedback({
            transactionItemId: req.validatedTransactionItemId,
            userId: req.user.id,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const update = async (req, res) => {
    try {
        const data = await updateFeedback({
            feedbackId: req.validatedEshopFeedback.feedbackId,
            userId: req.user.id,
            input: req.validatedEshopFeedback,
            req,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const remove = async (req, res) => {
    try {
        const data = await deleteFeedback({
            feedbackId: req.validatedEshopFeedbackId,
            userId: req.user.id,
            req,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const restore = async (req, res) => {
    try {
        const data = await restoreFeedback({
            feedbackId: req.validatedEshopFeedbackId,
            userId: req.user.id,
            req,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const publicList = async (req, res) => {
    try {
        return res.json({ success: true, data: await getPublicFeedback(req.validatedEshopPublicQuery) });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const adminList = async (req, res) => {
    try {
        return res.json({ success: true, data: await getAdminFeedback(req.validatedEshopAdminQuery) });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const adminDetail = async (req, res) => {
    try {
        return res.json({
            success: true,
            data: await getAdminFeedbackById({ feedbackId: req.validatedEshopFeedbackId }),
        });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const adminModerate = async (req, res) => {
    try {
        return res.json({
            success: true,
            data: await moderateFeedback({
                feedbackId: req.validatedEshopModeration.feedbackId,
                adminUserId: req.user.id,
                status: req.validatedEshopModeration.status,
                reason: req.validatedEshopModeration.reason,
                req,
            }),
        });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const adminReply = async (req, res) => {
    try {
        return res.json({
            success: true,
            data: await replyToFeedback({
                feedbackId: req.validatedEshopReply.feedbackId,
                adminUserId: req.user.id,
                reply: req.validatedEshopReply.reply,
                req,
            }),
        });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};

export const adminRestore = async (req, res) => {
    try {
        return res.json({
            success: true,
            data: await restoreFeedbackAsAdmin({
                feedbackId: req.validatedEshopFeedbackId,
                adminUserId: req.user.id,
                req,
            }),
        });
    } catch (error) {
        return sendEshopFeedbackError(res, error);
    }
};
