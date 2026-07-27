import { query, body } from 'express-validator';

const positiveInt = (field) =>
    query(field)
        .optional()
        .isInt({ min: 1 })
        .withMessage(`${field} must be a positive integer`)
        .toInt();

export const instructorStudentsQueryValidators = [
    positiveInt('page'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('limit must be between 1 and 50')
        .toInt(),
    query('search')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('search must be at most 100 characters'),
    positiveInt('batchId'),
    positiveInt('scheduleId'),
    query('enrollmentStatus')
        .optional()
        .trim()
        .isIn(['Approved', 'Enrolled', 'Pending', 'Completed', 'Rejected'])
        .withMessage('Invalid enrollmentStatus'),
    query('sortBy')
        .optional()
        .trim()
        .isIn(['name', 'batch', 'enrolled_at'])
        .withMessage('sortBy must be name, batch, or enrolled_at'),
    query('sortDir')
        .optional()
        .trim()
        .isIn(['asc', 'desc'])
        .withMessage('sortDir must be asc or desc'),
];

export const instructorSchedulesQueryValidators = [
    positiveInt('page'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('limit must be between 1 and 50')
        .toInt(),
    query('date')
        .optional()
        .trim()
        .matches(/^\d{4}-\d{2}-\d{2}$/)
        .withMessage('date must be YYYY-MM-DD'),
    positiveInt('batchId'),
    query('status')
        .optional()
        .trim()
        .isIn(['Upcoming', 'Ongoing', 'Completed', 'Cancelled'])
        .withMessage('Invalid status'),
    query('period')
        .optional()
        .trim()
        .isIn(['AM', 'PM'])
        .withMessage('period must be AM or PM'),
    query('search')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('search must be at most 100 characters'),
];

export const instructorBatchesQueryValidators = [
    positiveInt('page'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('limit must be between 1 and 50')
        .toInt(),
    query('search')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('search must be at most 100 characters'),
    query('status')
        .optional()
        .trim()
        .isIn(['Active', 'Upcoming', 'Completed', 'Cancelled'])
        .withMessage('Invalid status'),
];

export const instructorAttendanceClassesQueryValidators = [
    query('date')
        .optional()
        .trim()
        .matches(/^\d{4}-\d{2}-\d{2}$/)
        .withMessage('date must be YYYY-MM-DD'),
    positiveInt('batchId'),
    query('status')
        .optional()
        .trim()
        .isIn(['Upcoming', 'Ongoing', 'Completed', 'Cancelled'])
        .withMessage('Invalid status'),
    query('period')
        .optional()
        .trim()
        .isIn(['AM', 'PM'])
        .withMessage('period must be AM or PM'),
];

export const instructorAttendanceHistoryQueryValidators = [
    positiveInt('page'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('limit must be between 1 and 50')
        .toInt(),
    query('date')
        .optional()
        .trim()
        .matches(/^\d{4}-\d{2}-\d{2}$/)
        .withMessage('date must be YYYY-MM-DD'),
    positiveInt('batchId'),
    query('search')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('search must be at most 100 characters'),
];

export const saveAttendanceBodyValidators = [
    body('schedule_id')
        .isInt({ min: 1 })
        .withMessage('schedule_id must be a positive integer')
        .toInt(),
    body('attendance_date')
        .trim()
        .matches(/^\d{4}-\d{2}-\d{2}$/)
        .withMessage('attendance_date must be YYYY-MM-DD'),
    body('batch_id')
        .optional({ nullable: true })
        .isInt({ min: 1 })
        .withMessage('batch_id must be a positive integer')
        .toInt(),
    body('records')
        .isArray({ min: 1 })
        .withMessage('records must be a non-empty array'),
    body('records.*.enrollment_id')
        .isInt({ min: 1 })
        .withMessage('Each record must include enrollment_id')
        .toInt(),
    body('records.*.status')
        .optional()
        .trim()
        .isIn(['Present', 'Absent', 'Late', 'Excused'])
        .withMessage('Invalid attendance status'),
    body('records.*.attendance_status')
        .optional()
        .trim()
        .isIn(['Present', 'Absent', 'Late', 'Excused'])
        .withMessage('Invalid attendance status'),
];

export const updateAttendanceBodyValidators = [
    body('status')
        .optional()
        .trim()
        .isIn(['Present', 'Absent', 'Late', 'Excused'])
        .withMessage('Invalid attendance status'),
    body('remarks')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('remarks must be at most 500 characters'),
];
