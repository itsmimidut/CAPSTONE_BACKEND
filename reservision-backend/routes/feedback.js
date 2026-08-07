import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireCustomer } from '../middleware/authorize.js';
import { requireAdmin } from '../middleware/authorize.js';
import {
  create,
  getAdminById,
  getAdminList,
  getBookingFeedback,
  getEligibility,
  getMyFeedback,
  getPublic,
  moderateAsAdmin,
  remove,
  replyAsAdmin,
  restoreAsAdmin,
  update,
} from '../controllers/feedbackController.js';
import {
  validateBookingId,
  validateAdminFeedbackQuery,
  validateAdminReply,
  validateCreateFeedback,
  validateFeedbackId,
  validateModeration,
  validatePublicFeedbackQuery,
  validateUpdateFeedback,
} from '../validators/feedbackValidator.js';

const router = express.Router();

router.get('/public', validatePublicFeedbackQuery, getPublic);

router.get('/admin', authenticateToken, requireAdmin, validateAdminFeedbackQuery, getAdminList);
router.get('/admin/:feedbackId', authenticateToken, requireAdmin, validateFeedbackId, getAdminById);
router.patch('/admin/:feedbackId/status', authenticateToken, requireAdmin, validateModeration, moderateAsAdmin);
router.post('/admin/:feedbackId/reply', authenticateToken, requireAdmin, validateAdminReply, replyAsAdmin);
router.patch('/admin/:feedbackId/restore', authenticateToken, requireAdmin, validateFeedbackId, restoreAsAdmin);

router.get('/eligibility/:bookingId', authenticateToken, requireCustomer, validateBookingId, getEligibility);
router.get('/me', authenticateToken, requireCustomer, getMyFeedback);
router.get('/booking/:bookingId', authenticateToken, requireCustomer, validateBookingId, getBookingFeedback);
router.post('/', authenticateToken, requireCustomer, validateCreateFeedback, create);
router.patch('/:feedbackId', authenticateToken, requireCustomer, validateFeedbackId, validateUpdateFeedback, update);
router.delete('/:feedbackId', authenticateToken, requireCustomer, validateFeedbackId, remove);

export default router;
