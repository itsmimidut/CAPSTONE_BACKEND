import { body, param } from 'express-validator';

const refundReasons = [
  'Customer cancellation',
  'Duplicate payment',
  'Wrong booking date',
  'Unavailable room/cottage/event',
  'Admin cancellation',
  'Service issue',
  'Other',
  'Waiting for admin review',
];

const isValidRefundType = (value) => {
  const normalized = String(value).trim();
  return (
    /^full(\s+refund)?$/i.test(normalized)
    || /^partial(\s+refund)?$/i.test(normalized)
    || /^no\s*refund$/i.test(normalized)
  );
};

const refundMethods = [
  'Same as payment method',
  'GCash',
  'Bank transfer',
  'Cash',
  'Other',
];

export const customerRefundRequestValidators = [
  body('booking_id').isInt({ min: 1 }).withMessage('Valid booking ID is required'),
  body('refund_reason')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 3, max: 255 })
    .withMessage('Refund reason must be between 3 and 255 characters'),
  body('refund_note').optional().trim().escape().isLength({ max: 2000 }),
  body('refund_method')
    .optional()
    .trim()
    .isIn(refundMethods)
    .withMessage('Invalid refund method'),
];

export const adminRefundApproveValidators = [
  param('id').isInt({ min: 1 }).withMessage('Valid refund ID is required'),
  body('refund_type')
    .optional()
    .trim()
    .custom((value) => {
      if (!value) return true;
      if (isValidRefundType(value)) return true;
      throw new Error('refund_type must be Full, Partial, or No Refund');
    }),
  body('refund_amount').optional().isFloat({ min: 0 }).withMessage('Refund amount must be positive'),
  body('refund_reason')
    .optional()
    .trim()
    .isIn(refundReasons)
    .withMessage('Invalid refund reason')
    .escape(),
  body('refund_note').optional().trim().escape().isLength({ max: 2000 }),
];
