import express from 'express';
const router = express.Router();
import { checkEmailExists, checkContactExists, getCustomerProfile, updateCustomerProfile, customerSignup, customerLogin, customerGoogleLogin, getCustomerIdByUserId, resetPassword, profileImageUpload, getCustomerProfileById, changeCustomerPassword } from '../controllers/customerController.js';
import {
  loginLimiter,
  googleLoginLimiter,
  signupLimiter,
  passwordResetLimiter,
} from '../middleware/rateLimiters.js';
import { handleValidationErrors } from '../middleware/validate.js';
import {
  signupValidators,
  loginValidators,
  resetPasswordValidators,
  changePasswordValidators,
  updateProfileValidators,
} from '../middleware/validators/customerValidators.js';

const handleProfileUpload = (req, res, next) => {
    profileImageUpload.single('profileImage')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        req.body = req.body || {};
        next();
    });
};
// Customer signup
router.post('/signup', signupLimiter, signupValidators, handleValidationErrors, customerSignup);

// Customer login
router.post('/login', loginLimiter, loginValidators, handleValidationErrors, customerLogin);

// Customer Google login
router.post('/google-login', googleLoginLimiter, customerGoogleLogin);

/**
 * ============================================================
 * CUSTOMER ROUTES
 * ============================================================
 * Base path: /api/customers
 */

// Check if email exists
router.get('/check-email/:email', checkEmailExists);
router.get('/check-contact/:contactNumber', checkContactExists);

// Get customer profile by email
router.get('/profile/:email', getCustomerProfile);

// Update customer profile by email
router.put('/profile/:email', handleProfileUpload, updateProfileValidators, handleValidationErrors, updateCustomerProfile);

// Get customer_id by user_id
router.get('/id/by-user/:userId', getCustomerIdByUserId);

// Reset password (after OTP verified on frontend)
router.post('/reset-password', passwordResetLimiter, resetPasswordValidators, handleValidationErrors, resetPassword);

// Change password while logged in
router.post('/change-password', changePasswordValidators, handleValidationErrors, changeCustomerPassword);
router.post('/changes-password', changePasswordValidators, handleValidationErrors, changeCustomerPassword);

// Get customer profile by ID
router.get('/profile/id/:id', getCustomerProfileById);


export default router;
