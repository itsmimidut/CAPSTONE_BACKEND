import express from 'express';
import { getRateEntries, getRateCards } from '../controllers/ratesController.js';

const router = express.Router();

// GET table-style rate entries
router.get('/entries', getRateEntries);

// GET card-style rates (e.g., function hall)
router.get('/cards', getRateCards);

export default router;
