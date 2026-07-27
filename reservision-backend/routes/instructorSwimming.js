import express from 'express';
import { param } from 'express-validator';
import { handleValidationErrors } from '../middleware/validate.js';
import {
    resolveInstructorCoach,
    requireEnrollmentOwnership,
} from '../middleware/instructorCoach.js';
import {
    instructorStudentsQueryValidators,
    instructorSchedulesQueryValidators,
    instructorBatchesQueryValidators,
    instructorAttendanceClassesQueryValidators,
    instructorAttendanceHistoryQueryValidators,
    saveAttendanceBodyValidators,
    updateAttendanceBodyValidators,
} from '../middleware/validators/instructorSwimmingValidators.js';
import {
    getStudentsForCoach,
    getStudentDetail,
    getStudentAttendance,
    getDashboardSummary,
    getCoachSchedules,
    getCoachBatches,
    getAttendanceClasses,
    getAttendanceHistory,
    saveAttendance,
    updateAttendance,
} from '../services/instructorSwimmingService.js';

const router = express.Router();

const enrollmentIdValidator = [
    param('enrollmentId')
        .isInt({ min: 1 })
        .withMessage('enrollmentId must be a positive integer')
        .toInt(),
    handleValidationErrors,
];

/**
 * GET /api/swimming/instructor/me
 * Authenticated instructor coach profile (derived from session user).
 */
router.get('/me', resolveInstructorCoach, (req, res) => {
    return res.json({
        success: true,
        coach: {
            coach_id: req.coach.coach_id,
            name: req.coach.name,
            specialization: req.coach.specialization,
            status: req.coach.status,
        },
    });
});

/**
 * GET /api/swimming/instructor/dashboard/summary
 */
router.get('/dashboard/summary', resolveInstructorCoach, async (req, res) => {
    try {
        const stats = await getDashboardSummary(req.coach.coach_id);
        return res.json({
            success: true,
            coach: {
                coach_id: req.coach.coach_id,
                name: req.coach.name,
            },
            stats,
        });
    } catch (error) {
        console.error('GET /instructor/dashboard/summary error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard summary',
            error: error.message,
        });
    }
});

/**
 * GET /api/swimming/instructor/schedules
 */
router.get(
    '/schedules',
    resolveInstructorCoach,
    instructorSchedulesQueryValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await getCoachSchedules(req.coach.coach_id, {
                page: req.query.page,
                limit: req.query.limit,
                date: req.query.date,
                batchId: req.query.batchId,
                status: req.query.status,
                period: req.query.period,
                search: req.query.search,
            });

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                schedules: result.schedules,
                pagination: result.pagination,
            });
        } catch (error) {
            console.error('GET /instructor/schedules error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch schedules',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/batches
 */
router.get(
    '/batches',
    resolveInstructorCoach,
    instructorBatchesQueryValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await getCoachBatches(req.coach.coach_id, {
                page: req.query.page,
                limit: req.query.limit,
                search: req.query.search,
                status: req.query.status,
            });

            return res.json({
                success: true,
                batches: result.batches,
                pagination: result.pagination,
                summary: result.summary,
            });
        } catch (error) {
            console.error('GET /instructor/batches error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch batches',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/attendance/classes
 */
router.get(
    '/attendance/classes',
    resolveInstructorCoach,
    instructorAttendanceClassesQueryValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await getAttendanceClasses(req.coach.coach_id, {
                date: req.query.date,
                batchId: req.query.batchId,
                status: req.query.status,
                period: req.query.period,
            });

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                date: result.date,
                classes: result.classes,
            });
        } catch (error) {
            console.error('GET /instructor/attendance/classes error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch attendance classes',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/attendance/history
 */
router.get(
    '/attendance/history',
    resolveInstructorCoach,
    instructorAttendanceHistoryQueryValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await getAttendanceHistory(req.coach.coach_id, {
                page: req.query.page,
                limit: req.query.limit,
                date: req.query.date,
                batchId: req.query.batchId,
                search: req.query.search,
            });

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                history: result.history,
                pagination: result.pagination,
            });
        } catch (error) {
            console.error('GET /instructor/attendance/history error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch attendance history',
                error: error.message,
            });
        }
    }
);

/**
 * POST /api/swimming/instructor/attendance
 */
router.post(
    '/attendance',
    resolveInstructorCoach,
    saveAttendanceBodyValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await saveAttendance(req.coach.coach_id, req.body);

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            if (result.notFound) {
                return res.status(404).json({
                    success: false,
                    message: result.message,
                });
            }

            if (result.badRequest) {
                return res.status(400).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                message: result.message,
            });
        } catch (error) {
            console.error('POST /instructor/attendance error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to save attendance.',
                error: error.message,
            });
        }
    }
);

const attendanceIdValidator = [
    param('attendanceId')
        .isInt({ min: 1 })
        .withMessage('attendanceId must be a positive integer')
        .toInt(),
    handleValidationErrors,
];

/**
 * PUT /api/swimming/instructor/attendance/:attendanceId
 */
router.put(
    '/attendance/:attendanceId',
    resolveInstructorCoach,
    attendanceIdValidator,
    updateAttendanceBodyValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await updateAttendance(
                req.coach.coach_id,
                req.params.attendanceId,
                req.body
            );

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            if (result.notFound) {
                return res.status(404).json({
                    success: false,
                    message: result.message,
                });
            }

            if (result.badRequest) {
                return res.status(400).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                message: result.message,
                record: result.record,
            });
        } catch (error) {
            console.error('PUT /instructor/attendance/:attendanceId error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update attendance.',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/students
 * Paginated students for the authenticated coach.
 */
router.get(
    '/students',
    resolveInstructorCoach,
    instructorStudentsQueryValidators,
    handleValidationErrors,
    async (req, res) => {
        try {
            const result = await getStudentsForCoach(req.coach.coach_id, {
                page: req.query.page,
                limit: req.query.limit,
                search: req.query.search,
                batchId: req.query.batchId,
                scheduleId: req.query.scheduleId,
                enrollmentStatus: req.query.enrollmentStatus,
                sortBy: req.query.sortBy,
                sortDir: req.query.sortDir,
            });

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: result.message,
                });
            }

            return res.json({
                success: true,
                coach: {
                    coach_id: req.coach.coach_id,
                    name: req.coach.name,
                },
                pagination: result.pagination,
                students: result.students,
                summary: result.summary,
            });
        } catch (error) {
            console.error('GET /instructor/students error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch students',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/students/:enrollmentId/attendance
 * Attendance history for a student owned by the authenticated coach.
 */
router.get(
    '/students/:enrollmentId/attendance',
    resolveInstructorCoach,
    enrollmentIdValidator,
    requireEnrollmentOwnership,
    async (req, res) => {
        try {
            const result = await getStudentAttendance(
                req.params.enrollmentId,
                req.coach.coach_id
            );

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this enrollment.',
                });
            }

            return res.json({
                success: true,
                enrollment_id: result.enrollment_id,
                student_name: result.student_name,
                records: result.records,
                summary: result.summary,
            });
        } catch (error) {
            console.error('GET /instructor/students/:enrollmentId/attendance error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch student attendance',
                error: error.message,
            });
        }
    }
);

/**
 * GET /api/swimming/instructor/students/:enrollmentId
 * Student detail for an enrollment owned by the authenticated coach.
 */
router.get(
    '/students/:enrollmentId',
    resolveInstructorCoach,
    enrollmentIdValidator,
    requireEnrollmentOwnership,
    async (req, res) => {
        try {
            const result = await getStudentDetail(
                req.params.enrollmentId,
                req.coach.coach_id
            );

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this enrollment.',
                });
            }

            if (result.notFound) {
                return res.status(404).json({
                    success: false,
                    message: 'Student enrollment not found.',
                });
            }

            return res.json({
                success: true,
                student: result.student,
            });
        } catch (error) {
            console.error('GET /instructor/students/:enrollmentId error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch student detail',
                error: error.message,
            });
        }
    }
);

export default router;
