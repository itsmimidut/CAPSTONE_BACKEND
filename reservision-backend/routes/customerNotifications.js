import express from 'express';
import {
  getCustomerNotifications,
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
} from '../controllers/customerNotificationController.js';
import { customerNotificationsLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

router.get('/', customerNotificationsLimiter, getCustomerNotifications);
router.patch('/read-all', customerNotificationsLimiter, markAllCustomerNotificationsRead);
router.patch('/:id/read', customerNotificationsLimiter, markCustomerNotificationRead);

export default router;
