import express from 'express';
import { 
  sendOTP, 
  verifyOTP, 
  resendOTP, 
  checkEmailVerification 
} from '../controllers/otpController.js';

const router = express.Router();

/**
 * ============================================================
 * OTP VERIFICATION ROUTES
 * ============================================================
 * Base path: /api/otp
 */

// Send OTP to email
router.post('/send', sendOTP);

// Verify OTP code
router.post('/verify', verifyOTP);

// Resend OTP
router.post('/resend', resendOTP);

// Check if email is already verified
router.get('/check/:email', checkEmailVerification);

export default router;
