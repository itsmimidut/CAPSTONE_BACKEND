import express from 'express';
import { checkEmailExists } from '../controllers/customerController.js';

const router = express.Router();

/**
 * ============================================================
 * CUSTOMER ROUTES
 * ============================================================
 * Base path: /api/customers
 */

// Check if email exists
router.get('/check-email/:email', checkEmailExists);

export default router;
