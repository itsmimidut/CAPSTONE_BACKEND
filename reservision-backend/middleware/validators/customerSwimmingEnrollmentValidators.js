import { body, param } from 'express-validator';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const sexValues = ['Male', 'Female', 'Other', 'M', 'F'];

export const customerBatchIdParam = [
    param('batchId')
        .isInt({ min: 1 })
        .withMessage('Valid batchId is required')
        .toInt(),
];

export const customerValidateBookingValidators = [
    body('bookingReference')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Booking reference is required'),
];

export const customerEnrollmentBodyValidators = [
    body('bookingReference').trim().isLength({ min: 3, max: 50 }).withMessage('Booking reference is required'),
    body('firstName').trim().isLength({ min: 1, max: 100 }).withMessage('First name is required'),
    body('lastName').trim().isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
    body('dateOfBirth').trim().matches(isoDatePattern).withMessage('dateOfBirth must be YYYY-MM-DD'),
    body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
    body('address').trim().isLength({ min: 3, max: 500 }).withMessage('Address is required'),
    body('mobilePhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/)
        .withMessage('Invalid mobile phone'),
    body('sex').optional().trim().isIn(sexValues).withMessage('Invalid sex value'),
    body('weight').optional().isFloat({ min: 1, max: 500 }),
    body('height').optional().isFloat({ min: 1, max: 300 }),
    body('skillLevel').optional().trim().isIn(['Beginner', 'Intermediate', 'Advanced']),
    body('middleName').optional().trim().isLength({ max: 100 }),
    body('fatherName').optional().trim().isLength({ max: 100 }),
    body('motherName').optional().trim().isLength({ max: 100 }),
    body('emergencyContactName').optional().trim().isLength({ max: 100 }),
    body('emergencyContactPhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/)
        .withMessage('Invalid emergency contact phone'),
    body('physicianPhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/)
        .withMessage('Invalid physician phone'),
    body('agreedToTerms').isBoolean().withMessage('agreedToTerms must be true').equals(true),
    body('agreedToWaiver').isBoolean().withMessage('agreedToWaiver must be true').equals(true),
];

export const customerEnrollmentUpdateValidators = [
    param('enrollmentId')
        .isInt({ min: 1 })
        .withMessage('enrollmentId must be a positive integer')
        .toInt(),
    body('bookingReference').optional().trim().isLength({ min: 3, max: 50 }),
    body('firstName').optional().trim().isLength({ min: 1, max: 100 }),
    body('lastName').optional().trim().isLength({ min: 1, max: 100 }),
    body('dateOfBirth').optional().trim().matches(isoDatePattern),
    body('email').optional().trim().normalizeEmail().isEmail(),
    body('address').optional().trim().isLength({ min: 3, max: 500 }),
    body('mobilePhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/),
    body('sex').optional().trim().isIn(sexValues),
    body('weight').optional().isFloat({ min: 1, max: 500 }),
    body('height').optional().isFloat({ min: 1, max: 300 }),
    body('skillLevel').optional().trim().isIn(['Beginner', 'Intermediate', 'Advanced']),
    body('middleName').optional().trim().isLength({ max: 100 }),
    body('fatherName').optional().trim().isLength({ max: 100 }),
    body('motherName').optional().trim().isLength({ max: 100 }),
    body('emergencyContactName').optional().trim().isLength({ max: 100 }),
    body('emergencyContactPhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/),
    body('physicianPhone')
        .optional({ values: 'falsy' })
        .trim()
        .matches(/^[\d\s+\-()]{7,20}$/),
    body('agreedToTerms').optional().isBoolean(),
    body('agreedToWaiver').optional().isBoolean(),
];
