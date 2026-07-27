import { body } from 'express-validator';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const sexValues = ['Male', 'Female', 'Other', 'M', 'F'];

export const swimmingEnrollValidators = [
  body('bookingReference').trim().escape().isLength({ min: 3, max: 50 }).withMessage('Booking reference is required'),
  body('firstName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('First name is required'),
  body('lastName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
  body('dateOfBirth').trim().matches(isoDatePattern).withMessage('dateOfBirth must be YYYY-MM-DD'),
  body('email').trim().normalizeEmail().isEmail().withMessage('Valid email is required'),
  body('address').trim().escape().isLength({ min: 3, max: 500 }).withMessage('Address is required'),
  body('mobilePhone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[\d\s+\-()]{7,20}$/)
    .withMessage('Invalid mobile phone'),
  body('sex').optional().trim().isIn(sexValues).withMessage('Invalid sex value'),
  body('weight').optional().isFloat({ min: 1, max: 500 }),
  body('height').optional().isFloat({ min: 1, max: 300 }),
  body('lessonType').optional().trim().escape().isLength({ max: 100 }),
  body('skillLevel').optional().trim().escape().isLength({ max: 100 }),
  body('middleName').optional().trim().escape().isLength({ max: 100 }),
  body('preferredCoach').optional().trim().escape().isLength({ max: 100 }),
  body('fatherName').optional().trim().escape().isLength({ max: 100 }),
  body('motherName').optional().trim().escape().isLength({ max: 100 }),
  body('emergencyContactName').optional().trim().escape().isLength({ max: 100 }),
  body('emergencyContactPhone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[\d\s+\-()]{7,20}$/)
    .withMessage('Invalid emergency contact phone'),
];
