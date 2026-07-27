import { body, param } from 'express-validator';

const phonePattern = /^[\d\s+\-()]{7,20}$/;
const passwordMinLength = 8;

export const signupValidators = [
  body('firstName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('First name is required'),
  body('lastName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: passwordMinLength, max: 128 })
    .withMessage(`Password must be at least ${passwordMinLength} characters`)
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
    .matches(/\d/).withMessage('Password must contain a number'),
  body('contactNumber')
    .optional({ values: 'falsy' })
    .trim()
    .matches(phonePattern)
    .withMessage('Invalid phone number format'),
  body('emailVerificationToken').isString().notEmpty().withMessage('Email verification is required'),
  body('termsAccepted').custom(value => value === true).withMessage('Terms and Privacy consent is required'),
];

export const loginValidators = [
  body('email')
    .trim()
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false })
    .isEmail()
    .withMessage('Valid email is required'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password is required'),
];

export const resetPasswordValidators = [
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('newPassword')
    .isLength({ min: passwordMinLength, max: 128 })
    .withMessage(`Password must be at least ${passwordMinLength} characters`),
];

export const changePasswordValidators = [
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('currentPassword').isLength({ min: 1, max: 128 }).withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: passwordMinLength, max: 128 })
    .withMessage(`New password must be at least ${passwordMinLength} characters`),
];

export const profileEmailParam = [
  param('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
];

export const updateProfileValidators = [
  ...profileEmailParam,
  body('firstName').optional().trim().escape().isLength({ min: 1, max: 100 }),
  body('lastName').optional().trim().escape().isLength({ min: 1, max: 100 }),
  body('contactNumber')
    .optional({ values: 'falsy' })
    .trim()
    .matches(phonePattern)
    .withMessage('Invalid phone number format'),
  body('address').optional().trim().escape().isLength({ max: 500 }),
];
