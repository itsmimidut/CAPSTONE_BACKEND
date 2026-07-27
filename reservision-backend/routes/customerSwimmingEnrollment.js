import express from 'express';
import { handleValidationErrors } from '../middleware/validate.js';
import { bookingLookupLimiter } from '../middleware/rateLimiters.js';
import {
    customerValidateBookingValidators,
    customerEnrollmentBodyValidators,
    customerEnrollmentUpdateValidators,
    customerBatchIdParam,
} from '../middleware/validators/customerSwimmingEnrollmentValidators.js';
import {
    getCustomerSwimmingOverview,
    validateCustomerBooking,
    createCustomerEnrollment,
    updateCustomerEnrollment,
    getCustomerBatchSessions,
} from '../services/customerSwimmingEnrollmentService.js';

const router = express.Router();

const getUserId = (req) => Number(req.user?.id ?? req.user?.user_id);

/**
 * GET /api/swimming/customer/batches/:batchId/sessions
 */
router.get(
    '/batches/:batchId/sessions',
    customerBatchIdParam,
    handleValidationErrors,
    async (req, res) => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const result = await getCustomerBatchSessions(userId, Number(req.params.batchId));

            if (result.notFound) {
                return res.status(404).json({ success: false, error: result.message });
            }

            if (result.forbidden) {
                return res.status(403).json({ success: false, error: result.message });
            }

            return res.json({
                success: true,
                batch: result.batch,
                sessions: result.sessions,
                count: result.count,
            });
        } catch (error) {
            console.error('GET /swimming/customer/batches/:batchId/sessions error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to load batch sessions',
            });
        }
    }
);

/**
 * GET /api/swimming/customer/enrollment/me
 */
router.get('/enrollment/me', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const overview = await getCustomerSwimmingOverview(userId);
        return res.json({ success: true, ...overview });
    } catch (error) {
        console.error('GET /swimming/customer/enrollment/me error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load swimming enrollment overview',
        });
    }
});

/**
 * POST /api/swimming/customer/validate-booking
 */
router.post(
    '/validate-booking',
    bookingLookupLimiter,
    customerValidateBookingValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const result = await validateCustomerBooking(
                userId,
                req.body.bookingReference
            );

            if (result.notFound) {
                return res.status(404).json({ success: false, error: result.message });
            }

            if (result.forbidden) {
                return res.status(400).json({
                    success: false,
                    error: result.message,
                    booking: result.booking,
                });
            }

            return res.json({
                success: true,
                canEnroll: result.canEnroll,
                existingEnrollment: result.existingEnrollment,
                booking: result.booking,
                message: result.message,
            });
        } catch (error) {
            console.error('POST /swimming/customer/validate-booking error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to validate booking',
            });
        }
    }
);

/**
 * POST /api/swimming/customer/enrollment
 */
router.post(
    '/enrollment',
    customerEnrollmentBodyValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const result = await createCustomerEnrollment(userId, req.body);

            if (result.notFound) {
                return res.status(404).json({ success: false, error: result.message });
            }

            if (result.badRequest) {
                return res.status(400).json({ success: false, error: result.message });
            }

            return res.status(201).json({
                success: true,
                message: result.message,
                enrollment: result.enrollment,
            });
        } catch (error) {
            console.error('POST /swimming/customer/enrollment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to submit enrollment',
            });
        }
    }
);

/**
 * PUT /api/swimming/customer/enrollment/:enrollmentId
 */
router.put(
    '/enrollment/:enrollmentId',
    customerEnrollmentUpdateValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const result = await updateCustomerEnrollment(
                userId,
                req.params.enrollmentId,
                req.body
            );

            if (result.notFound) {
                return res.status(404).json({ success: false, error: result.message });
            }

            if (result.forbidden) {
                return res.status(403).json({ success: false, error: result.message });
            }

            if (result.badRequest) {
                return res.status(400).json({ success: false, error: result.message });
            }

            return res.json({
                success: true,
                message: result.message,
                enrollment: result.enrollment,
            });
        } catch (error) {
            console.error('PUT /swimming/customer/enrollment/:enrollmentId error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update enrollment',
            });
        }
    }
);

export default router;
