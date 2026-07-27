import express from 'express';
import { handleXenditPaymentWebhook } from '../controllers/paymentWebhookController.js';
import { verifyXenditWebhook } from '../middleware/xenditWebhookVerification.js';

const router = express.Router();

router.post('/xendit/webhook', verifyXenditWebhook, handleXenditPaymentWebhook);

export default router;
