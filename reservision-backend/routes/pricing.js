import express from 'express';
import { createPricingQuoteController } from '../controllers/pricingController.js';

const router = express.Router();

router.post('/quote', createPricingQuoteController);

export default router;
