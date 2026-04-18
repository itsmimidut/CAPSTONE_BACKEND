import express from 'express';
import * as entranceRatesController from '../../controllers/entranceRatesController.js';

const router = express.Router();

/**
 * GET /api/entrance-rates
 * Fetch all rates with pagination and filtering
 * Query params: page, search, day_type, status
 */
router.get('/', entranceRatesController.getRates);

/**
 * GET /api/entrance-rates/by-date
 * Get rates for a specific date (used for fee computation)
 * Query params: date (YYYY-MM-DD)
 */
router.get('/by-date', entranceRatesController.getRatesByDate);

/**
 * GET /api/entrance-rates/:id
 * Get single rate by ID
 */
router.get('/:id', entranceRatesController.getRateById);

/**
 * POST /api/entrance-rates
 * Create new entrance rate
 */
router.post('/', entranceRatesController.createRate);

/**
 * PUT /api/entrance-rates/:id
 * Update entrance rate
 */
router.put('/:id', entranceRatesController.updateRate);

/**
 * DELETE /api/entrance-rates/:id
 * Delete entrance rate
 */
router.delete('/:id', entranceRatesController.deleteRate);

/**
 * PATCH /api/entrance-rates/:id/status
 * Toggle rate status (active/hidden)
 */
router.patch('/:id/status', entranceRatesController.toggleStatus);

export default router;
