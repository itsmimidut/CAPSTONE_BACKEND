import { body } from 'express-validator';

export const otpSendValidators = [
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('firstName').optional().trim().escape().isLength({ max: 100 }),
];

export const otpVerifyValidators = [
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('otp')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('OTP must be a 6-digit code'),
];
