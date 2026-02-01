import express from 'express';
import { 
  createPaymentLink, 
  createPaymentIntent, 
  getPaymentStatus, 
  webhookHandler 
} from '../controllers/paymongoController.js';

const router = express.Router();

// Create payment link (recommended - simpler)
router.post('/create-payment-link', createPaymentLink);

// Create payment intent (advanced - for custom checkout)
router.post('/create-payment-intent', createPaymentIntent);

// Get payment status
router.get('/payment-status/:paymentId', getPaymentStatus);

// Webhook endpoint for PayMongo callbacks
router.post('/webhook', webhookHandler);

export default router;
