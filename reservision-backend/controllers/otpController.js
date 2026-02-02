import db from '../config/db.js';
import { sendOTPEmail } from '../services/emailService.js';

/**
 * ============================================================
 * OTP VERIFICATION CONTROLLER
 * ============================================================
 * Handles OTP generation, sending, and verification
 */

/**
 * Generate random 6-digit OTP
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP to Email
 * POST /api/otp/send
 * 
 * Body: {
 *   email: "user@example.com",
 *   firstName: "Juan" (optional)
 * }
 */
export const sendOTP = async (req, res) => {
  try {
    const { email, firstName } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }
    
    // Check if there's a recent OTP sent (prevent spam)
    const [recentOTP] = await db.query(
      `SELECT * FROM otp_verifications 
       WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    
    if (recentOTP.length > 0) {
      return res.status(429).json({
        success: false,
        error: 'Please wait 1 minute before requesting a new OTP',
        retryAfter: 60
      });
    }
    
    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    
    // Save OTP to database
    await db.query(
      `INSERT INTO otp_verifications (email, otp_code, expires_at)
       VALUES (?, ?, ?)`,
      [email, otpCode, expiresAt]
    );
    
    // Send OTP via email
    try {
      await sendOTPEmail(email, otpCode, firstName || 'Guest');
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification email. Please try again.',
        details: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }
    
    res.json({
      success: true,
      message: 'Verification code sent to your email',
      expiresIn: 600 // seconds
    });
    
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send verification code',
      details: error.message
    });
  }
};

/**
 * Verify OTP
 * POST /api/otp/verify
 * 
 * Body: {
 *   email: "user@example.com",
 *   otp: "123456"
 * }
 */
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Email and OTP are required'
      });
    }
    
    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP format. Must be 6 digits.'
      });
    }
    
    // Find OTP in database
    const [otpRecords] = await db.query(
      `SELECT * FROM otp_verifications 
       WHERE email = ? AND otp_code = ? AND verified = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );
    
    if (otpRecords.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code'
      });
    }
    
    const otpRecord = otpRecords[0];
    
    // Check if OTP is expired
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'Verification code has expired. Please request a new one.',
        expired: true
      });
    }
    
    // Mark OTP as verified
    await db.query(
      'UPDATE otp_verifications SET verified = TRUE WHERE id = ?',
      [otpRecord.id]
    );
    
    res.json({
      success: true,
      message: 'Email verified successfully',
      email: email
    });
    
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify code',
      details: error.message
    });
  }
};

/**
 * Resend OTP
 * POST /api/otp/resend
 * 
 * Body: {
 *   email: "user@example.com",
 *   firstName: "Juan" (optional)
 * }
 */
export const resendOTP = async (req, res) => {
  // Same as sendOTP but invalidate previous OTPs first
  try {
    const { email, firstName } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }
    
    // Invalidate all previous OTPs for this email
    await db.query(
      'UPDATE otp_verifications SET verified = TRUE WHERE email = ? AND verified = FALSE',
      [email]
    );
    
    // Then send new OTP using the sendOTP function
    return sendOTP(req, res);
    
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend verification code',
      details: error.message
    });
  }
};

/**
 * Check if email is already verified recently (within 30 minutes)
 * GET /api/otp/check/:email
 */
export const checkEmailVerification = async (req, res) => {
  try {
    const { email } = req.params;
    
    const [verified] = await db.query(
      `SELECT * FROM otp_verifications 
       WHERE email = ? AND verified = TRUE 
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    
    res.json({
      success: true,
      verified: verified.length > 0,
      email: email
    });
    
  } catch (error) {
    console.error('Check verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check verification status'
    });
  }
};
