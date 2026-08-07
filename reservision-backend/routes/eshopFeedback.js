import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireCustomer } from '../middleware/authorize.js';
import { requireAdmin } from '../middleware/authorize.js';
import {
    adminDetail,
    adminList,
    adminModerate,
    adminReply,
    adminRestore,
    create,
    eligibility,
    item,
    mine,
    publicList,
    remove,
    restore,
    update,
} from '../controllers/eshopFeedbackController.js';
import {
    validateCreateEshopFeedback,
    validateAdminEshopFeedbackQuery,
    validateEshopFeedbackId,
    validateEshopModeration,
    validateEshopReply,
    validatePublicEshopFeedbackQuery,
    validateTransactionItemId,
    validateUpdateEshopFeedback,
} from '../validators/eshopFeedbackValidator.js';

const router = express.Router();

router.get('/public', validatePublicEshopFeedbackQuery, publicList);
router.get('/admin', authenticateToken, requireAdmin, validateAdminEshopFeedbackQuery, adminList);
router.get('/admin/:feedbackId', authenticateToken, requireAdmin, validateEshopFeedbackId, adminDetail);
router.patch('/admin/:feedbackId/status', authenticateToken, requireAdmin, validateEshopModeration, adminModerate);
router.post('/admin/:feedbackId/reply', authenticateToken, requireAdmin, validateEshopReply, adminReply);
router.patch('/admin/:feedbackId/restore', authenticateToken, requireAdmin, validateEshopFeedbackId, adminRestore);

router.use(authenticateToken, requireCustomer);
router.get('/eligibility/:transactionItemId', validateTransactionItemId, eligibility);
router.get('/me', mine);
router.get('/item/:transactionItemId', validateTransactionItemId, item);
router.post('/', validateCreateEshopFeedback, create);
router.patch('/:feedbackId', validateUpdateEshopFeedback, update);
router.delete('/:feedbackId', validateEshopFeedbackId, remove);
router.patch('/:feedbackId/restore', validateEshopFeedbackId, restore);

export default router;
