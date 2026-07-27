import { body, param } from 'express-validator';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const hasRoomBookingItems = (items = []) =>
  Array.isArray(items) &&
  items.some((item) => {
    const type = String(item?.booking_type || item?.bookingType || item?.category || '').toLowerCase();
    return type === 'room' || type.includes('room');
  });

const requiresStayDates = (body = {}) => {
  if (body.isSwimmingOnly === true || body.isSwimmingOnly === 'true') return false;
  return hasRoomBookingItems(body.items);
};

export const bookingConfirmValidators = [
  body('guest').isObject().withMessage('Guest information is required'),
  body('guest.firstName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('Guest first name is required'),
  body('guest.lastName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('Guest last name is required'),
  body('guest.email').trim().normalizeEmail().isEmail().withMessage('Valid guest email is required'),
  body('guest.phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[\d\s+\-()]{7,20}$/)
    .withMessage('Invalid phone number'),
  // Rooms require check-in/out. Event/cottage/swimming can omit top-level stay dates.
  body('checkIn')
    .custom((value, { req }) => {
      if (!requiresStayDates(req.body)) {
        if (value == null || value === '') return true;
        return isoDatePattern.test(String(value).trim());
      }
      return isoDatePattern.test(String(value || '').trim());
    })
    .withMessage('checkIn must be YYYY-MM-DD'),
  body('checkOut')
    .custom((value, { req }) => {
      if (!requiresStayDates(req.body)) {
        if (value == null || value === '') return true;
        return isoDatePattern.test(String(value).trim());
      }
      return isoDatePattern.test(String(value || '').trim());
    })
    .withMessage('checkOut must be YYYY-MM-DD'),
  body('items').isArray({ min: 1 }).withMessage('At least one booking item is required'),
  body('items.*.item_id').optional().isInt({ min: 1 }).withMessage('Invalid item ID'),
  body('items.*.itemId').optional().isInt({ min: 1 }).withMessage('Invalid item ID'),
  body('items.*.guests').optional().isInt({ min: 1, max: 1000 }).withMessage('Guests must be between 1 and 1000'),
  body('items.*.total_guests').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid total guests'),
  body('items.*.adults').optional().isInt({ min: 0, max: 100000 }).withMessage('Adults cannot be negative'),
  body('items.*.children').optional().isInt({ min: 0, max: 100000 }).withMessage('Children cannot be negative'),
  body('items.*.seniors').optional().isInt({ min: 0, max: 100000 }).withMessage('Seniors cannot be negative'),
  body('items.*.infants').optional().isInt({ min: 0, max: 100000 }).withMessage('Infants cannot be negative'),
  body('items.*.guest_breakdown_type')
    .optional({ values: 'falsy' })
    .isIn(['exact', 'estimated', 'not_provided'])
    .withMessage('Invalid guest breakdown type'),
  body('items.*.booking_date')
    .optional({ values: 'falsy' })
    .matches(isoDatePattern)
    .withMessage('booking_date must be YYYY-MM-DD'),
  body('items.*.start_time')
    .optional({ values: 'falsy' })
    .matches(/^\d{1,2}:\d{2}(:\d{2})?$/)
    .withMessage('start_time must be HH:MM'),
  body('items.*.end_time')
    .optional({ values: 'falsy' })
    .matches(/^\d{1,2}:\d{2}(:\d{2})?$/)
    .withMessage('end_time must be HH:MM'),
  body('paymentMethod')
    .optional({ values: 'falsy' })
    .trim()
    .escape()
    .isLength({ max: 50 })
    .withMessage('Invalid payment method'),
  body('subtotal').optional().isFloat({ min: 0 }).withMessage('Subtotal must be a positive number'),
  body('total').optional().isFloat({ min: 0 }).withMessage('Total must be a positive number'),
  body('userId').optional().isInt({ min: 1 }).withMessage('Invalid user ID'),
  body('isSwimmingOnly').optional().isBoolean(),
  body('entranceFee').optional().isFloat({ min: 0 }),
  body('extraPersonFee').optional().isFloat({ min: 0 }),
];

export const bookingUpdateValidators = [
  param('id').isInt({ min: 1 }).withMessage('Valid booking ID is required'),
  body('status')
    .optional()
    .trim()
    .isIn(['Pending', 'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled', 'No-Show'])
    .withMessage('Invalid booking status'),
  body('payment_status')
    .optional()
    .trim()
    .isIn(['Pending', 'Paid', 'Failed', 'Refunded', 'Partial'])
    .withMessage('Invalid payment status'),
  body('special_requests').optional().trim().escape().isLength({ max: 2000 }),
];

export const updatePaymentValidators = [
  body('bookingId').isInt({ min: 1 }).withMessage('Valid booking ID is required'),
  body('status')
    .optional()
    .trim()
    .isIn(['Pending', 'Paid', 'Failed', 'Refunded'])
    .withMessage('Invalid payment status'),
  body('paymentReference').optional().trim().escape().isLength({ max: 255 }),
];
