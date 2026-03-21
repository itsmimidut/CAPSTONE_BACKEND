import express from 'express';
const router = express.Router();
import { checkEmailExists, getCustomerProfile, updateCustomerProfile, customerSignup, customerLogin, customerGoogleLogin, getCustomerIdByUserId, resetPassword, profileImageUpload, getCustomerProfileById, changeCustomerPassword } from '../controllers/customerController.js';

const handleProfileUpload = (req, res, next) => {
    profileImageUpload.single('profileImage')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        req.body = req.body || {};
        next();
    });
};
// Customer signup
router.post('/signup', customerSignup);

// Customer login
router.post('/login', customerLogin);

// Customer Google login
router.post('/google-login', customerGoogleLogin);

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
router.put('/profile/:email', handleProfileUpload, updateCustomerProfile);

// Get customer_id by user_id
router.get('/id/by-user/:userId', getCustomerIdByUserId);

// Reset password (after OTP verified on frontend)
router.post('/reset-password', resetPassword);

// Change password while logged in
router.post('/change-password', changeCustomerPassword);
router.post('/changes-password', changeCustomerPassword);

// Get customer profile by ID
router.get('/profile/id/:id', getCustomerProfileById);


export default router;
