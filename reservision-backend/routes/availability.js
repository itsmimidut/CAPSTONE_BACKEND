import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireStaff } from '../middleware/authorize.js';
import {
  checkAvailabilityController,
  getAvailabilityCalendarController,
} from '../controllers/availabilityController.js';

const router = express.Router();

router.post('/check', checkAvailabilityController);

// Admin/staff calendar view for room & cottage availability
router.get(
  '/calendar',
  authenticateToken,
  requireStaff,
  getAvailabilityCalendarController
);

export default router;
