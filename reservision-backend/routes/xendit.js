import express from 'express';
import { createPayment, getPaymentStatus, webhookHandler } from '../controllers/xenditController.js';

const router = express.Router();

// Create payment invoice
router.post('/create-payment', createPayment);

// Get payment status
router.get('/payment-status/:invoiceId', getPaymentStatus);

// Webhook endpoint for Xendit callbacks
router.post('/webhook', webhookHandler);

export default router;
