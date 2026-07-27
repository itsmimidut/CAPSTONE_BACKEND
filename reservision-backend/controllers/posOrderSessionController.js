import {
    cancelPosOrderSession,
    PosOrderSessionError,
    startPosOrderSession,
} from '../services/posOrderSessionService.js';

const authenticatedUserId = (req) => Number(req.user?.id || req.user?.user_id || 0);

const sendError = (res, error, fallback) => {
    if (error instanceof PosOrderSessionError) {
        return res.status(error.statusCode).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }
    console.error(fallback, error);
    return res.status(500).json({ success: false, error: fallback });
};

export const startOrder = async (req, res) => {
    try {
        const userId = authenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const data = await startPosOrderSession({ userId, payload: req.body });
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return sendError(res, error, 'Failed to start POS order');
    }
};

export const cancelOrder = async (req, res) => {
    try {
        const userId = authenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        await cancelPosOrderSession({ sessionId: req.params.id, userId });
        return res.json({ success: true });
    } catch (error) {
        return sendError(res, error, 'Failed to cancel POS order');
    }
};
