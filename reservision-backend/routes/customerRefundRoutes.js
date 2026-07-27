import express from 'express';
import {
  createCustomerRefundRequest,
  getCustomerRefundByBooking,
} from '../controllers/customerRefundController.js';
import { handleValidationErrors } from '../middleware/validate.js';
import { customerRefundRequestValidators } from '../middleware/validators/refundValidators.js';

const router = express.Router();

router.get('/booking/:bookingId', getCustomerRefundByBooking);
router.post('/request', customerRefundRequestValidators, handleValidationErrors, createCustomerRefundRequest);

export default router;
