import express from 'express';
import {
  createPayment,
  confirmPaymentFromXendit,
  getPaymentMethods,
  getPaymentStatus,
  abandonUnpaidBooking,
  webhookHandler,
} from '../controllers/xenditController.js';
import {
  paymentConfirmLimiter,
  paymentCreateLimiter,
  paymentStatusLimiter,
} from '../middleware/rateLimiters.js';
import { verifyXenditWebhook } from '../middleware/xenditWebhookVerification.js';
import { authenticateToken } from '../middleware/authenticateToken.js';

const router = express.Router();

// Create payment invoice
router.post('/create-payment', authenticateToken, paymentCreateLimiter, createPayment);

// Cancel unpaid booking when payment session creation fails
router.post('/abandon-unpaid-booking', authenticateToken, paymentCreateLimiter, abandonUnpaidBooking);

// Get supported payment methods
router.get('/payment-methods', authenticateToken, getPaymentMethods);

// Get payment status (client polling — not a Xendit callback)
router.get('/payment-status/:invoiceId', authenticateToken, paymentStatusLimiter, getPaymentStatus);

// Verify paid invoice with Xendit API and update booking (webhook fallback for local dev)
router.post('/confirm-payment', authenticateToken, paymentConfirmLimiter, confirmPaymentFromXendit);

// Webhook endpoint for Xendit callbacks
router.post('/webhook', verifyXenditWebhook, webhookHandler);

export default router;
