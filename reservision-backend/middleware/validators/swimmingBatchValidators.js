import { body, param } from 'express-validator';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const scheduleTypes = ['DAILY', 'SELECTED_DAYS', 'FLEXIBLE'];
const batchStatuses = ['Open', 'Active', 'Filling', 'Full', 'Closed', 'Ongoing', 'Completed'];

export const batchIdParam = [
  param('batchId').isInt({ min: 1 }).withMessage('Valid batchId is required'),
];

export const adminBatchIdParam = [
  param('id').isInt({ min: 1 }).withMessage('Valid batch id is required'),
];

export const createBatchValidators = [
  body('batchName').trim().escape().isLength({ min: 1, max: 100 }).withMessage('batchName is required'),
  body('startDate').trim().matches(isoDatePattern).withMessage('startDate must be YYYY-MM-DD'),
  body('endDate').trim().matches(isoDatePattern).withMessage('endDate must be YYYY-MM-DD'),
  body('scheduleType').optional().trim().isIn(scheduleTypes).withMessage('Invalid scheduleType'),
  body('maxSessions')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 366 })
    .withMessage('maxSessions must be between 1 and 366'),
  body('days').optional().isArray().withMessage('days must be an array'),
  body('days.*').optional().trim().isLength({ min: 2, max: 20 }),
  body('lessonType').optional({ values: 'falsy' }).trim().escape().isLength({ max: 100 }),
  body('coachId').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('coachId must be a positive integer'),
  body('timeSlot').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('capacity').optional().isInt({ min: 0, max: 500 }).withMessage('capacity must be 0-500'),
  body('notes').optional({ values: 'falsy' }).trim().escape().isLength({ max: 2000 }),
  body('status').optional().trim().isIn(batchStatuses).withMessage('Invalid batch status'),
  body('autoGenerateSessions').optional().isBoolean().withMessage('autoGenerateSessions must be boolean'),
];

export const updateBatchValidators = [
  ...adminBatchIdParam,
  body('batchName').optional().trim().escape().isLength({ min: 1, max: 100 }),
  body('startDate').optional().trim().matches(isoDatePattern),
  body('endDate').optional().trim().matches(isoDatePattern),
  body('scheduleType').optional().trim().isIn(scheduleTypes),
  body('maxSessions')
    .optional({ nullable: true })
    .custom((value) => value === null || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 366))
    .withMessage('maxSessions must be between 1 and 366'),
  body('days').optional().isArray(),
  body('days.*').optional().trim().isLength({ min: 2, max: 20 }),
  body('lessonType').optional({ nullable: true }).trim().escape().isLength({ max: 100 }),
  body('coachId').optional({ nullable: true }).custom((value) => value === null || value === '' || Number(value) >= 1),
  body('timeSlot').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('capacity').optional().isInt({ min: 0, max: 500 }),
  body('notes').optional({ nullable: true }).trim().escape().isLength({ max: 2000 }),
  body('status').optional().trim().isIn(batchStatuses),
];
