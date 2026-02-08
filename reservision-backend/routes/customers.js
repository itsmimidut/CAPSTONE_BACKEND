import express from 'express';
const router = express.Router();
import { checkEmailExists, getCustomerProfile, updateCustomerProfile, customerSignup, customerLogin } from '../controllers/customerController.js';
// Customer signup
router.post('/signup', customerSignup);

// Customer login
router.post('/login', customerLogin);

/**
 * ============================================================
 * CUSTOMER ROUTES
 * ============================================================
 * Base path: /api/customers
 */

// Check if email exists
router.get('/check-email/:email', checkEmailExists);

// Get customer profile by email
router.get('/profile/:email', getCustomerProfile);

// Update customer profile by email
router.put('/profile/:email', updateCustomerProfile);

export default router;
