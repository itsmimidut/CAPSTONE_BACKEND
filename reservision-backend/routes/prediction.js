import express from 'express';
import { predictTomorrowBookings } from '../controllers/predictionController.js';

const router = express.Router();

// GET /api/prediction/tomorrow-bookings
router.get('/tomorrow-bookings', predictTomorrowBookings);

export default router;
