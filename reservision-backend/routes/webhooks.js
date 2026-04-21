import express from 'express';
import { handlePayMongoWebhook } from '../controllers/webhookController.js';

const router = express.Router();

/**
 * POST /api/webhooks/paymongo
 * Receives webhook events from PayMongo
 */
router.post('/paymongo', handlePayMongoWebhook);

export default router;
