/**
 * ============================================================
 * Swimming Enrollment Routes
 * ============================================================
 * 
 * Purpose:
 * - Handle swimming lesson enrollment submissions
 * - Manage swimming coaches data
 * - Provide enrollment management endpoints
 * 
 * Endpoints:
 * POST   /api/swimming/enrollments     - Create new enrollment
 * GET    /api/swimming/enrollments     - Get all enrollments
 * GET    /api/swimming/enrollments/:id - Get enrollment by ID
 * PUT    /api/swimming/enrollments/:id - Update enrollment
 * DELETE /api/swimming/enrollments/:id - Delete enrollment
 * GET    /api/swimming/coaches         - Get all coaches
 * GET    /api/swimming/coaches/:id     - Get coach by ID
 * POST   /api/swimming/coaches         - Create coach
 * PUT    /api/swimming/coaches/:id     - Update coach
 */

import express from "express";
import { db } from "../config/db.js";
import { handleValidationErrors } from "../middleware/validate.js";
import { swimmingEnrollValidators } from "../middleware/validators/swimmingValidators.js";
import {
    batchIdParam,
    adminBatchIdParam,
    createBatchValidators,
    updateBatchValidators,
} from "../middleware/validators/swimmingBatchValidators.js";
import {
    buildCoachDisplayName,
    syncSwimmingCoachFromUser,
    syncAllSwimmingCoachesFromUsers
} from "../services/syncSwimmingCoachFromUser.js";
import instructorSwimmingRoutes from "./instructorSwimming.js";
import { requireStaff, requireAdmin } from "../middleware/authorize.js";
import {
    generateBatchSessions,
    regenerateBatchSessions,
    getBatchSessions,
    getPublicBatchSessions,
    getBatchById,
    syncBatchStatus,
    assertBatchHasEnrollmentCapacity,
    incrementBatchBookedSlots,
    validateBatchScheduleConfig,
    parseBatchDays,
    parseTimeSlot,
} from "../services/swimmingSessionGenerator.js";

const router = express.Router();

const lessonRateMap = {
    '7 Years Old & Above': 3000,
    '6 Years Old & Below': 4000,
    'Group Lessons': 3000,
    'Private Lessons': 4000
};

const generateSwimmingBookingReference = () => {
    const stamp = Date.now().toString().slice(-8);
    return `SWM${stamp}`;
};

const normalizeScheduleType = (value) => {
    const text = String(value || 'DAILY').toUpperCase();
    if (['DAILY', 'SELECTED_DAYS', 'FLEXIBLE'].includes(text)) {
        return text;
    }
    return 'DAILY';
};

const maybeAutoGenerateBatchSessions = async (batchId, batchRow, autoGenerate = true) => {
    if (!autoGenerate || !batchRow) {
        return null;
    }

    const scheduleType = normalizeScheduleType(batchRow.schedule_type);
    if (scheduleType === 'FLEXIBLE') {
        return null;
    }

    try {
        validateBatchScheduleConfig(batchRow);
        return await generateBatchSessions(batchId);
    } catch (error) {
        console.warn(`[Swimming] Auto session generation skipped for batch ${batchId}:`, error.message);
        return null;
    }
};

const inferClassPeriod = (startTime) => {
    if (!startTime) return 'AM';
    const hour = Number(String(startTime).split(':')[0]);
    if (Number.isNaN(hour)) return 'AM';
    return hour >= 12 ? 'PM' : 'AM';
};

const maybeCreateDefaultBatchSchedule = async (batchId, { coachId, timeSlot, capacity, status }) => {
    const { startTime, endTime } = parseTimeSlot(timeSlot);
    if (!startTime || !endTime) {
        return null;
    }

    const [[existing]] = await db.query(
        `SELECT schedule_id FROM swimming_batch_schedules WHERE batch_id = ? LIMIT 1`,
        [batchId]
    );
    if (existing?.schedule_id) {
        return existing.schedule_id;
    }

    const [result] = await db.query(
        `INSERT INTO swimming_batch_schedules (
            batch_id, coach_id, class_period, start_time, end_time, max_slots, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            batchId,
            coachId || null,
            inferClassPeriod(startTime),
            startTime,
            endTime,
            Number(capacity) > 0 ? Number(capacity) : 10,
            status || 'Open',
        ]
    );

    return result.insertId;
};

const countApprovedEnrollmentsForSchedule = async (scheduleId) => {
    const [[{ count }]] = await db.query(
        `SELECT COUNT(*) AS count
         FROM swimming_enrollments
         WHERE schedule_id = ? AND enrollment_status = 'Approved'`,
        [scheduleId]
    );
    return Number(count || 0);
};

const getAuthenticatedUserId = (req) => {
    const id = req.user?.id ?? req.user?.user_id;
    return id != null ? Number(id) : null;
};

const isStaffRole = (role) => ['admin', 'receptionist'].includes(String(role || '').toLowerCase());

async function resolveCoachForUser(userId) {
    if (!userId) return null;
    const [rows] = await db.query(
        `SELECT coach_id, user_id, name, specialization, status
         FROM swimming_coaches
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function authorizeInstructorCoachAccess(req, res, requestedCoachId = null) {
    const userId = getAuthenticatedUserId(req);
    const userRole = req.user?.role;

    if (isStaffRole(userRole)) {
        if (!requestedCoachId) {
            return { coach: null, staffOverride: true };
        }
        const [rows] = await db.query(
            `SELECT coach_id, user_id, name, specialization, status
             FROM swimming_coaches
             WHERE coach_id = ?
             LIMIT 1`,
            [requestedCoachId]
        );
        if (!rows.length) {
            res.status(404).json({ success: false, message: 'Coach not found' });
            return { error: true };
        }
        return { coach: rows[0], staffOverride: true };
    }

    const coach = await resolveCoachForUser(userId);
    if (!coach) {
        res.status(403).json({
            success: false,
            message: 'Coach profile not linked to this account.'
        });
        return { error: true };
    }

    if (requestedCoachId && Number(requestedCoachId) !== Number(coach.coach_id)) {
        res.status(403).json({
            success: false,
            message: 'Forbidden: you can only access your own coach profile.'
        });
        return { error: true };
    }

    return { coach, staffOverride: false };
}

async function assertScheduleCoachAccess(req, res, scheduleId, coach) {
    const [scheduleRows] = await db.query(
        `SELECT schedule_id, coach_id, batch_id
         FROM swimming_batch_schedules
         WHERE schedule_id = ?
         LIMIT 1`,
        [scheduleId]
    );

    if (!scheduleRows.length) {
        res.status(404).json({ success: false, message: 'Schedule not found' });
        return { error: true };
    }

    const schedule = scheduleRows[0];
    const userRole = req.user?.role;

    if (!isStaffRole(userRole)) {
        if (!coach || Number(schedule.coach_id) !== Number(coach.coach_id)) {
            res.status(403).json({
                success: false,
                message: 'Forbidden: you can only manage attendance for your assigned classes.'
            });
            return { error: true };
        }
    }

    return { schedule };
}

const buildAttendanceFilterClause = (query = {}) => {
    const clauses = [];
    const params = [];

    if (query.dateFrom) {
        clauses.push('a.attendance_date >= ?');
        params.push(query.dateFrom);
    }
    if (query.dateTo) {
        clauses.push('a.attendance_date <= ?');
        params.push(query.dateTo);
    }
    if (query.batchId) {
        clauses.push('COALESCE(s.batch_id, e.batch_id) = ?');
        params.push(Number(query.batchId));
    }
    if (query.coachId) {
        clauses.push('a.coach_id = ?');
        params.push(Number(query.coachId));
    }
    if (query.status) {
        clauses.push('a.status = ?');
        params.push(query.status);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return { whereSql, params };
};

const fetchCoachUserById = async (userId) => {
    const [users] = await db.query(
        `SELECT user_id, first_name, last_name, email, phone, role
         FROM user
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );
    return users[0] || null;
};

const assertEligibleCoachUser = async (userId, excludeCoachId = null) => {
    const user = await fetchCoachUserById(userId);
    if (!user) {
        return { error: 'Selected user account was not found.' };
    }
    if (user.role !== 'swimming_instructor') {
        return { error: 'Selected user must have the swimming_instructor role.' };
    }

    let linkSql = `SELECT coach_id FROM swimming_coaches WHERE user_id = ?`;
    const linkParams = [userId];
    if (excludeCoachId) {
        linkSql += ` AND coach_id != ?`;
        linkParams.push(excludeCoachId);
    }

    const [linked] = await db.query(linkSql, linkParams);
    if (linked.length) {
        return { error: 'This instructor account is already linked to another coach profile.' };
    }

    return { user, displayName: buildCoachDisplayName(user) };
};

const updateBatchScheduleStatus = async (scheduleId) => {
    const [[scheduleRow]] = await db.query(
        `SELECT schedule_id, max_slots, status
         FROM swimming_batch_schedules
         WHERE schedule_id = ?`,
        [scheduleId]
    );

    if (!scheduleRow || scheduleRow.status === 'Closed') return;

    const approvedCount = await countApprovedEnrollmentsForSchedule(scheduleId);
    const nextStatus = approvedCount >= Number(scheduleRow.max_slots) ? 'Full' : 'Open';

    if (nextStatus !== scheduleRow.status) {
        await db.query(
            `UPDATE swimming_batch_schedules
             SET status = ?
             WHERE schedule_id = ?`,
            [nextStatus, scheduleId]
        );
    }
};

const findCoachScheduleConflict = async (coachId, batchId, startTime, endTime, excludeScheduleId = null) => {
    if (!coachId) return false;

    const [batchRows] = await db.query(
        `SELECT start_date, end_date
         FROM swimming_batches
         WHERE batch_id = ?`,
        [batchId]
    );
    if (!batchRows.length) return false;

    const { start_date, end_date } = batchRows[0];

    let sql = `
        SELECT s.schedule_id
        FROM swimming_batch_schedules s
        INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
        WHERE s.coach_id = ?
          AND NOT (b.end_date < ? OR b.start_date > ?)
          AND NOT (s.end_time <= ? OR s.start_time >= ?)`;
    const params = [coachId, start_date, end_date, startTime, endTime];

    if (excludeScheduleId) {
        sql += ` AND s.schedule_id != ?`;
        params.push(excludeScheduleId);
    }

    const [rows] = await db.query(sql, params);
    return rows.length > 0;
};

// Phase 1–4 instructor endpoints (must mount before legacy /instructor/dashboard/:coachId)
router.use('/instructor', instructorSwimmingRoutes);

/**
 * GET /api/swimming/instructor/dashboard/:coachId
 * Instructor dashboard summary for the coach.
 */
router.get('/instructor/dashboard/:coachId', async (req, res) => {
    try {
        const { coachId } = req.params;
        if (!coachId) {
            return res.status(400).json({ success: false, error: 'Coach ID is required' });
        }

        const [coachRows] = await db.query(
            `SELECT coach_id, name
             FROM swimming_coaches
             WHERE coach_id = ?
             LIMIT 1`,
            [coachId]
        );

        if (!coachRows.length) {
            return res.status(404).json({ success: false, error: 'Coach not found' });
        }

        const coach = coachRows[0];

        const [[scheduleStats]] = await db.query(
            `SELECT
                COUNT(*) AS todayClasses
             FROM swimming_batch_schedules s
             INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
             WHERE s.coach_id = ?
               AND DATE(NOW()) BETWEEN b.start_date AND b.end_date`,
            [coachId]
        );

        const [[generalStats]] = await db.query(
            `SELECT
                COUNT(DISTINCT CASE
                    WHEN se.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN se.enrollment_id
                END) AS assignedStudents,
                COUNT(DISTINCT CASE
                    WHEN LOWER(b.status) IN ('active', 'open', 'filling')
                    THEN b.batch_id
                END) AS activeBatches,
                COUNT(DISTINCT CASE
                    WHEN se.enrollment_status = 'Pending'
                    THEN se.enrollment_id
                END) AS pendingAttendance,
                COUNT(DISTINCT CASE
                    WHEN se.enrollment_status = 'Completed'
                    THEN se.enrollment_id
                END) AS completedLessons
             FROM swimming_enrollments se
             LEFT JOIN swimming_batch_schedules s ON se.schedule_id = s.schedule_id
             LEFT JOIN swimming_batches b ON se.batch_id = b.batch_id
             WHERE se.coach_id = ?
                OR s.coach_id = ?`,
            [coachId, coachId]
        );

        const [todaySchedules] = await db.query(
            `SELECT
                s.schedule_id,
                s.batch_id,
                b.batch_name,
                b.lesson_type,
                b.capacity,
                b.status AS batch_status,
                s.class_period,
                s.start_time,
                s.end_time,
                b.days,
                s.max_slots,
                s.status AS schedule_status,
                COUNT(DISTINCT CASE
                    WHEN se.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN se.enrollment_id
                END) AS students_count
             FROM swimming_batch_schedules s
             INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
             LEFT JOIN swimming_enrollments se ON se.schedule_id = s.schedule_id
             WHERE s.coach_id = ?
               AND DATE(NOW()) BETWEEN b.start_date AND b.end_date
             GROUP BY s.schedule_id
             ORDER BY s.start_time ASC
             LIMIT 10`,
            [coachId]
        );

        const [assignedBatches] = await db.query(
            `SELECT
                b.batch_id,
                s.schedule_id,
                b.batch_name,
                b.lesson_type,
                b.days,
                b.time_slot,
                b.capacity,
                b.status,
                s.class_period,
                s.start_time,
                s.end_time,
                s.max_slots,
                s.status AS schedule_status,
                COUNT(DISTINCT CASE
                    WHEN se.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN se.enrollment_id
                END) AS students
             FROM swimming_batch_schedules s
             INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
             LEFT JOIN swimming_enrollments se
               ON se.schedule_id = s.schedule_id
               AND se.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
             WHERE s.coach_id = ?
             GROUP BY s.schedule_id, b.batch_id
             ORDER BY b.start_date DESC, s.start_time ASC
             LIMIT 12`,
            [coachId]
        );

        const [myStudents] = await db.query(
            `SELECT
                se.enrollment_id,
                se.first_name,
                se.last_name,
                se.email,
                se.lesson_type,
                se.batch_id,
                se.schedule_id,
                se.coach_id,
                b.batch_name,
                b.time_slot,
                b.days,
                s.class_period,
                s.start_time,
                s.end_time,
                se.enrollment_status
             FROM swimming_enrollments se
             LEFT JOIN swimming_batch_schedules s ON se.schedule_id = s.schedule_id
             LEFT JOIN swimming_batches b ON se.batch_id = b.batch_id
             WHERE se.coach_id = ?
                OR s.coach_id = ?
             ORDER BY se.created_at DESC
             LIMIT 20`,
            [coachId, coachId]
        );

        const [calendarEvents] = await db.query(
            `SELECT
                s.schedule_id AS id,
                b.batch_name,
                b.lesson_type,
                s.start_time,
                s.end_time,
                b.status AS batch_status,
                DATE(NOW()) AS date
             FROM swimming_batch_schedules s
             INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
             WHERE s.coach_id = ?
               AND DATE(NOW()) BETWEEN b.start_date AND b.end_date
             ORDER BY s.start_time ASC
             LIMIT 20`,
            [coachId]
        );

        res.json({
            success: true,
            coach,
            stats: {
                todayClasses: Number(scheduleStats?.todayClasses || 0),
                today_classes: Number(scheduleStats?.todayClasses || 0),
                assignedStudents: Number(generalStats?.assignedStudents || 0),
                assigned_students: Number(generalStats?.assignedStudents || 0),
                activeBatches: Number(generalStats?.activeBatches || 0),
                active_batches: Number(generalStats?.activeBatches || 0),
                pendingAttendance: Number(generalStats?.pendingAttendance || 0),
                pending_attendance: Number(generalStats?.pendingAttendance || 0),
                completedLessons: Number(generalStats?.completedLessons || 0),
                completed_lessons: Number(generalStats?.completedLessons || 0)
            },
            todaySchedules,
            assignedBatches,
            myStudents,
            calendarEvents
        });
    } catch (error) {
        console.error('Error fetching instructor dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch instructor dashboard',
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/instructor/coach-profile
 * Resolve coach profile for the authenticated user.
 */
router.get('/instructor/coach-profile', async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const coach = await resolveCoachForUser(userId);

        if (!coach) {
            return res.status(404).json({
                success: false,
                message: 'Coach profile not linked to this account.'
            });
        }

        return res.json({
            success: true,
            coach: {
                coach_id: coach.coach_id,
                coachId: coach.coach_id,
                name: coach.name,
                specialization: coach.specialization,
                status: coach.status
            }
        });
    } catch (error) {
        console.error('Error resolving coach profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to resolve coach profile',
            error: error.message
        });
    }
});

/**
 * GET /api/swimming/instructor/attendance/history
 * Attendance history for the authenticated coach.
 */
router.get('/instructor/attendance/history', async (req, res) => {
    try {
        const auth = await authorizeInstructorCoachAccess(req, res);
        if (auth.error) return;

        const coachId = auth.coach?.coach_id;
        if (!coachId) {
            return res.status(403).json({
                success: false,
                message: 'Coach profile not available for attendance history.'
            });
        }

        const [rows] = await db.query(
            `
      SELECT
        a.attendance_date,
        a.schedule_id,
        s.batch_id AS batch_id,
        b.batch_name,
        b.lesson_type,
        s.class_period,
        s.start_time,
        s.end_time,
        COUNT(DISTINCT a.enrollment_id) AS total,
        SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) AS excused
      FROM swimming_attendance a
      LEFT JOIN swimming_batch_schedules s
        ON s.schedule_id = a.schedule_id
      LEFT JOIN swimming_batches b
        ON b.batch_id = s.batch_id
      WHERE a.coach_id = ?
      GROUP BY
        a.attendance_date,
        a.schedule_id,
        s.batch_id,
        b.batch_name,
        b.lesson_type,
        s.class_period,
        s.start_time,
        s.end_time
      ORDER BY a.attendance_date DESC, s.start_time DESC
      LIMIT 50
      `,
            [coachId]
        );

        return res.json({
            success: true,
            history: rows.map(row => ({
                id: `${row.schedule_id}-${row.attendance_date}`,
                date: row.attendance_date,
                attendance_date: row.attendance_date,
                schedule_id: row.schedule_id,
                batch_id: row.batch_id,
                batch: row.batch_name || 'N/A',
                batch_name: row.batch_name || 'N/A',
                lesson_type: row.lesson_type || 'N/A',
                schedule: `${row.class_period || ''} ${row.start_time || ''} - ${row.end_time || ''}`.trim(),
                class_period: row.class_period,
                start_time: row.start_time,
                end_time: row.end_time,
                present: Number(row.present || 0),
                absent: Number(row.absent || 0),
                late: Number(row.late || 0),
                excused: Number(row.excused || 0),
                total: Number(row.total || 0),
                status: 'Saved'
            }))
        });
    } catch (error) {
        console.error('Error fetching instructor attendance history:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch attendance history',
            error: error.message
        });
    }
});

/**
 * GET /api/swimming/instructor/attendance/history/:coachId
 * Attendance history summary for instructor (legacy path with ownership check).
 */
router.get('/instructor/attendance/history/:coachId', async (req, res) => {
    try {
        const { coachId } = req.params;
        const auth = await authorizeInstructorCoachAccess(req, res, coachId);
        if (auth.error) return;

        const [rows] = await db.query(
            `
      SELECT
        a.attendance_date,
        a.schedule_id,
        s.batch_id AS batch_id,
        b.batch_name,
        b.lesson_type,
        s.class_period,
        s.start_time,
        s.end_time,
        COUNT(DISTINCT a.enrollment_id) AS total,
        SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) AS excused
      FROM swimming_attendance a
      LEFT JOIN swimming_batch_schedules s
        ON s.schedule_id = a.schedule_id
      LEFT JOIN swimming_batches b
        ON b.batch_id = s.batch_id
      WHERE a.coach_id = ?
      GROUP BY
        a.attendance_date,
        a.schedule_id,
        s.batch_id,
        b.batch_name,
        b.lesson_type,
        s.class_period,
        s.start_time,
        s.end_time
      ORDER BY a.attendance_date DESC, s.start_time DESC
      LIMIT 50
      `,
            [coachId]
        )

        return res.json({
            success: true,
            history: rows.map(row => ({
                id: `${row.schedule_id}-${row.attendance_date}`,
                date: row.attendance_date,
                attendance_date: row.attendance_date,
                schedule_id: row.schedule_id,
                batch_id: row.batch_id,
                batch: row.batch_name || 'N/A',
                batch_name: row.batch_name || 'N/A',
                lesson_type: row.lesson_type || 'N/A',
                schedule: `${row.class_period || ''} ${row.start_time || ''} - ${row.end_time || ''}`.trim(),
                class_period: row.class_period,
                start_time: row.start_time,
                end_time: row.end_time,
                present: Number(row.present || 0),
                absent: Number(row.absent || 0),
                late: Number(row.late || 0),
                excused: Number(row.excused || 0),
                total: Number(row.total || 0),
                status: 'Saved'
            }))
        })
    } catch (error) {
        console.error('Error fetching instructor attendance history:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch attendance history',
            error: error.message
        })
    }
})

/**
 * POST /api/swimming/instructor/attendance
 * Save instructor attendance records.
 */
router.post('/instructor/attendance', async (req, res) => {
    const connection = await db.getConnection()

    try {
        await connection.beginTransaction()

        const {
            schedule_id,
            batch_id,
            attendance_date,
            records
        } = req.body

        if (!schedule_id || !attendance_date || !Array.isArray(records)) {
            await connection.rollback()
            return res.status(400).json({
                success: false,
                message: 'Missing required attendance fields.'
            })
        }

        const auth = await authorizeInstructorCoachAccess(req, res);
        if (auth.error) {
            await connection.rollback();
            return;
        }

        const [scheduleRows] = await connection.query(
            `SELECT schedule_id, coach_id, batch_id
             FROM swimming_batch_schedules
             WHERE schedule_id = ?
             LIMIT 1`,
            [schedule_id]
        );

        if (!scheduleRows.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Schedule not found.'
            });
        }

        const schedule = scheduleRows[0];
        let coachId = Number(schedule.coach_id);

        if (!isStaffRole(req.user?.role)) {
            if (!auth.coach || Number(coachId) !== Number(auth.coach.coach_id)) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you can only submit attendance for your assigned classes.'
                });
            }
            coachId = Number(auth.coach.coach_id);
        } else if (!coachId && auth.coach?.coach_id) {
            coachId = Number(auth.coach.coach_id);
        }

        if (!coachId) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'No coach is assigned to this schedule.'
            });
        }

        for (const record of records) {
            await connection.query(
                `
        INSERT INTO swimming_attendance (
          coach_id,
          schedule_id,
          batch_id,
          enrollment_id,
          attendance_date,
          status,
          remarks,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          remarks = VALUES(remarks),
          coach_id = VALUES(coach_id),
          updated_at = NOW()
        `,
                [
                    coachId,
                    schedule_id,
                    batch_id || schedule.batch_id || null,
                    record.enrollment_id,
                    attendance_date,
                    record.status || record.attendance_status || 'Present',
                    record.remarks || ''
                ]
            )
        }

        await connection.commit()

        return res.json({
            success: true,
            message: 'Attendance saved successfully.'
        })
    } catch (error) {
        await connection.rollback()
        console.error('Error saving attendance:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to save attendance.',
            error: error.message
        })
    } finally {
        connection.release()
    }
})

/**
 * GET /api/swimming/instructor/attendance/:scheduleId/:date
 * Load previously saved attendance records for a schedule and date.
 */
router.get('/instructor/attendance/:scheduleId/:date', async (req, res) => {
    try {
        const { scheduleId, date } = req.params

        const auth = await authorizeInstructorCoachAccess(req, res);
        if (auth.error) return;

        const scheduleAccess = await assertScheduleCoachAccess(req, res, scheduleId, auth.coach);
        if (scheduleAccess.error) return;

        const [records] = await db.query(
            `
      SELECT
        a.attendance_id,
        a.coach_id,
        a.schedule_id,
        COALESCE(s.batch_id, e.batch_id) AS batch_id,
        a.enrollment_id,
        a.attendance_date,
        a.status,
        a.remarks,
        e.first_name,
        e.last_name,
        e.email
      FROM swimming_attendance a
      LEFT JOIN swimming_enrollments e
        ON e.enrollment_id = a.enrollment_id
      LEFT JOIN swimming_batch_schedules s
        ON s.schedule_id = a.schedule_id
      WHERE a.schedule_id = ?
        AND a.attendance_date = ?
      ORDER BY e.last_name ASC, e.first_name ASC
      `,
            [scheduleId, date]
        )

        return res.json({
            success: true,
            records
        })
    } catch (error) {
        console.error('Error fetching attendance records:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch attendance records',
            error: error.message
        })
    }
})

/**
 * GET /api/swimming/instructor/dashboard-data/:coachId
 * Instructor dashboard summary using admin-style data filtered by coach.
 */
router.get('/instructor/dashboard-data/:coachId', async (req, res) => {
    try {
        const { coachId } = req.params;
        const auth = await authorizeInstructorCoachAccess(req, res, coachId);
        if (auth.error) return;

        if (!coachId) {
            return res.status(400).json({ success: false, error: 'Coach ID is required' });
        }

        const [coachRows] = await db.query(
            `SELECT
                coach_id,
                user_id,
                name,
                specialization,
                status
             FROM swimming_coaches
             WHERE coach_id = ?
             LIMIT 1`,
            [coachId]
        );

        if (!coachRows.length) {
            return res.status(404).json({ success: false, error: 'Coach not found' });
        }

        const coach = coachRows[0];
        const today = new Date().toISOString().slice(0, 10);

        const [students] = await db.query(`
            SELECT
                e.enrollment_id,
                CONCAT(e.first_name, ' ', e.last_name) AS name,
                e.first_name,
                e.last_name,
                e.email,
                e.mobile_phone,
                e.booking_reference,
                e.lesson_type,
                e.payment_status,
                e.enrollment_status,
                e.batch_id,
                e.schedule_id,
                e.coach_id,
                b.batch_name,
                b.start_date,
                b.end_date,
                b.status AS batch_status,
                s.class_period,
                s.start_time,
                s.end_time,
                s.max_slots,
                s.status AS schedule_status,
                sc.name AS schedule_coach_name
            FROM swimming_enrollments e
            LEFT JOIN swimming_batch_schedules s
                ON s.schedule_id = e.schedule_id
            LEFT JOIN swimming_batches b
                ON b.batch_id = e.batch_id
            LEFT JOIN swimming_coaches sc
                ON sc.coach_id = COALESCE(e.coach_id, s.coach_id)
            WHERE e.coach_id = ?
               OR s.coach_id = ?
            ORDER BY e.created_at DESC
        `, [coachId, coachId]);

        const [batchSchedules] = await db.query(`
            SELECT
                s.schedule_id,
                s.batch_id,
                s.coach_id,
                s.class_period,
                s.start_time,
                s.end_time,
                s.max_slots,
                s.status,
                b.batch_name,
                b.lesson_type,
                b.start_date,
                b.end_date,
                b.status AS batch_status,
                c.name AS coach_name,
                COUNT(DISTINCT CASE
                    WHEN e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN e.enrollment_id
                END) AS used_slots
            FROM swimming_batch_schedules s
            INNER JOIN swimming_batches b
                ON b.batch_id = s.batch_id
            LEFT JOIN swimming_coaches c
                ON c.coach_id = s.coach_id
            LEFT JOIN swimming_enrollments e
                ON e.schedule_id = s.schedule_id
            WHERE s.coach_id = ?
            GROUP BY s.schedule_id
            ORDER BY b.start_date ASC, s.start_time ASC
        `, [coachId]);

        const [batches] = await db.query(`
            SELECT
                b.batch_id,
                b.batch_name,
                b.lesson_type,
                b.start_date,
                b.end_date,
                b.status,
                COUNT(DISTINCT s.schedule_id) AS schedule_count,
                COALESCE(SUM(s.max_slots), 0) AS schedule_capacity,
                COUNT(DISTINCT CASE
                    WHEN e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN e.enrollment_id
                END) AS enrolled_count
            FROM swimming_batches b
            INNER JOIN swimming_batch_schedules s
                ON s.batch_id = b.batch_id
               AND s.coach_id = ?
            LEFT JOIN swimming_enrollments e
                ON e.schedule_id = s.schedule_id
            GROUP BY b.batch_id
            ORDER BY b.start_date DESC
        `, [coachId]);

        const [todaySchedules] = await db.query(`
            SELECT
                s.schedule_id,
                s.batch_id,
                s.coach_id,
                s.class_period,
                s.start_time,
                s.end_time,
                s.max_slots,
                s.status,
                b.batch_name,
                b.lesson_type,
                c.name AS coach_name,
                COUNT(DISTINCT CASE
                    WHEN e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                    THEN e.enrollment_id
                END) AS used_slots
            FROM swimming_batch_schedules s
            INNER JOIN swimming_batches b
                ON b.batch_id = s.batch_id
            LEFT JOIN swimming_coaches c
                ON c.coach_id = s.coach_id
            LEFT JOIN swimming_enrollments e
                ON e.schedule_id = s.schedule_id
            WHERE s.coach_id = ?
              AND ? BETWEEN b.start_date AND b.end_date
            GROUP BY s.schedule_id
            ORDER BY s.start_time ASC
        `, [coachId, today]);

        const approvedStudents = students.filter((student) =>
            ['approved', 'enrolled', 'completed'].includes(String(student.enrollment_status || '').toLowerCase())
        );

        const activeBatches = batches.filter((batch) =>
            ['open', 'active', 'filling'].includes(String(batch.status || '').toLowerCase())
        );

        const pendingAttendance = todaySchedules.length;
        const stats = {
            todayClasses: todaySchedules.length,
            today_classes: todaySchedules.length,
            assignedStudents: approvedStudents.length,
            assigned_students: approvedStudents.length,
            activeBatches: activeBatches.length,
            active_batches: activeBatches.length,
            pendingAttendance,
            pending_attendance: pendingAttendance,
            completedLessons: 0,
            completed_lessons: 0
        };

        const calendarEvents = batchSchedules.map((row) => ({
            id: row.schedule_id,
            schedule_id: row.schedule_id,
            date: row.start_date,
            batch: row.batch_name,
            batch_name: row.batch_name,
            lesson_type: row.lesson_type,
            time: `${row.start_time || 'TBD'} - ${row.end_time || 'TBD'}`,
            start_time: row.start_time,
            end_time: row.end_time,
            status: row.status || row.batch_status || 'Open'
        }));

        res.json({
            success: true,
            coach,
            stats,
            students,
            batches,
            batchSchedules,
            todaySchedules,
            calendarEvents
        });
    } catch (error) {
        console.error('Error fetching instructor dashboard data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch instructor dashboard data',
            details: error.message
        });
    }
});

router.get('/instructor/coach-by-user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const requesterId = getAuthenticatedUserId(req);
        const requesterRole = req.user?.role;
        const isStaff = isStaffRole(requesterRole);

        if (!isStaff && Number(requesterId) !== Number(userId)) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: you can only access your own coach profile.',
                code: 'FORBIDDEN'
            });
        }

        const [rows] = await db.query(
            `SELECT coach_id, name
             FROM swimming_coaches
             WHERE user_id = ?
             LIMIT 1`,
            [userId]
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Coach profile not linked to this account.'
            });
        }

        res.json({
            success: true,
            coach: rows[0]
        });
    } catch (error) {
        console.error('Error fetching coach by user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch coach profile',
            error: error.message
        });
    }
});

// ============================================================
// ENROLLMENT ENDPOINTS
// ============================================================

/**
 * POST /api/swimming/enrollments
 * Create a new swimming enrollment
 * 
 * Request Body:
 * {
 *   firstName, lastName, dateOfBirth, email, etc.
 * }
 * 
 * Returns: Created enrollment record with enrollment_id
 */
router.post("/enrollments", requireStaff, async (req, res) => {
    try {
        const {
            // Personal Information
            firstName,
            middleName,
            lastName,
            dateOfBirth,
            bookingReference,

            // Personal Details
            sex,
            weight,
            height,
            address,
            mobilePhone,
            email,

            // Parent/Guardian Information
            fatherName,
            motherName,
            emergencyContactName,
            emergencyContactPhone,
            physicianPhone,

            // Swimming Details
            skillLevel,

            // Agreement
            agreedToTerms,
            agreedToWaiver,
            agriedToWaiver
        } = req.body;

        // Validate required fields
        if (!bookingReference || !firstName || !lastName || !dateOfBirth || !email || !address) {
            return res.status(400).json({
                error: "Missing required fields",
                required: ["bookingReference", "firstName", "lastName", "dateOfBirth", "email", "address"]
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        // Fetch booking details from booking_items
        const [bookingResult] = await db.query(
            `SELECT 
                bi.item_name as lesson_type,
                bi.unit_price as rate_amount,
                bi.batch_id,
                bi.schedule_id,
                bi.coach_id,
                b.payment_status
            FROM bookings b
            JOIN booking_items bi ON b.booking_id = bi.booking_id
            WHERE b.booking_reference = ?
                AND bi.item_type = 'Swimming'
                AND b.payment_status = 'Paid'`,
            [bookingReference]
        );

        if (bookingResult.length === 0) {
            return res.status(404).json({
                error: "Booking reference not found or not a valid swimming booking"
            });
        }

        const bookingData = bookingResult[0];

        // Check if batch_id and schedule_id are present
        if (!bookingData.batch_id || !bookingData.schedule_id) {
            return res.status(400).json({
                error: "This swimming booking is missing batch schedule details. Please create a new batch-based swimming booking."
            });
        }

        // If coach_id is missing from booking_items, get from swimming_batch_schedules
        let coachId = bookingData.coach_id;
        if (!coachId) {
            const [scheduleResult] = await db.query(
                `SELECT coach_id FROM swimming_batch_schedules WHERE schedule_id = ?`,
                [bookingData.schedule_id]
            );
            if (scheduleResult.length > 0) {
                coachId = scheduleResult[0].coach_id;
            }
        }

        const sql = `
      INSERT INTO swimming_enrollments (
        booking_reference,
        first_name, middle_name, last_name, date_of_birth,
        sex, weight, height, preferred_coach, address, mobile_phone, email,
        father_name, mother_name,
        emergency_contact_name, emergency_contact_phone,
        physician_phone,
        lesson_type, skill_level,
        batch_id, schedule_id, coach_id, rate_amount, payment_status, enrollment_status,
        agreed_to_terms, agreed_to_waiver
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const values = [
            bookingReference,
            firstName, middleName, lastName, dateOfBirth,
            sex || 'Male', weight, height, '', address, mobilePhone, email,
            fatherName || null, motherName || null,
            emergencyContactName || null, emergencyContactPhone || null,
            physicianPhone || null,
            bookingData.lesson_type, skillLevel || 'Beginner',
            bookingData.batch_id, bookingData.schedule_id, coachId, bookingData.rate_amount, bookingData.payment_status, 'Pending',
            agreedToTerms ? 1 : 0, (agreedToWaiver ?? agriedToWaiver) ? 1 : 0
        ];

        const [result] = await db.query(sql, values);

        // Fetch the created enrollment
        const [enrollment] = await db.query(
            "SELECT * FROM swimming_enrollments WHERE enrollment_id = ?",
            [result.insertId]
        );

        res.status(201).json({
            message: "Enrollment submitted successfully",
            enrollment: enrollment[0]
        });

    } catch (error) {
        console.error("Error creating enrollment:", error);
        res.status(500).json({
            error: "Failed to submit enrollment",
            details: error.message
        });
    }
});

/**
 * POST /api/swimming/validate-booking
 * Validate if booking reference can accept new enrollment
 * 
 * Request Body:
 * {
 *   bookingReference: "SWM12345678"
 * }
 * 
 * Returns: Booking details and enrollment capacity info
 */
router.post("/validate-booking", requireStaff, async (req, res) => {
    try {
        const { bookingReference } = req.body;

        if (!bookingReference) {
            return res.status(400).json({
                success: false,
                error: "Booking reference is required"
            });
        }

        // Query booking details with batch and schedule info
        const [result] = await db.query(
            `SELECT 
                b.booking_id,
                b.booking_reference,
                b.customer_id,
                b.payment_status,
                CONCAT(c.first_name, ' ', c.last_name) as booker_name,
                c.email as booker_email,
                c.phone as booker_phone,
                bi.guests as paid_slots,
                bi.item_name,
                bi.unit_price,
                bi.batch_id,
                bi.schedule_id,
                bi.coach_id,
                sb.batch_name,
                sb.start_date,
                sb.end_date,
                sbs.class_period,
                sbs.start_time,
                sbs.end_time,
                co.name as coach_name
            FROM bookings b
            JOIN booking_items bi ON b.booking_id = bi.booking_id
            JOIN customers c ON b.customer_id = c.customer_id
            LEFT JOIN swimming_batches sb ON bi.batch_id = sb.batch_id
            LEFT JOIN swimming_batch_schedules sbs ON bi.schedule_id = sbs.schedule_id
            LEFT JOIN swimming_coaches co ON bi.coach_id = co.coach_id OR sbs.coach_id = co.coach_id
            WHERE b.booking_reference = ?
                AND bi.item_type = 'Swimming'
                AND b.payment_status = 'Paid'`,
            [bookingReference]
        );

        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Booking reference not found, not a swimming booking, or payment not confirmed"
            });
        }

        const booking = result[0];

        // Count existing enrollments for this booking reference
        const [enrollmentCount] = await db.query(
            `SELECT COUNT(*) as enrolled_count
             FROM swimming_enrollments
             WHERE booking_reference = ?`,
            [bookingReference]
        );

        const [existingEnrollments] = await db.query(
            `SELECT *
             FROM swimming_enrollments
             WHERE booking_reference = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [bookingReference]
        );

        const existingEnrollment = existingEnrollments[0] || null;
        const enrolledCount = enrollmentCount[0].enrolled_count;
        const availableSlots = booking.paid_slots - enrolledCount;
        const bookingIsFull = availableSlots <= 0;

        // If the booking is full and no existing enrollment exists, block new enrollments.
        if (bookingIsFull && !existingEnrollment) {
            return res.status(400).json({
                success: false,
                canEnroll: false,
                error: `Booking is full. All ${booking.paid_slots} slot(s) have been used.`,
                booking: {
                    ...booking,
                    enrolled_count: enrolledCount,
                    available_slots: 0
                }
            });
        }

        // Parse swimming details from item_description
        let swimmingDetails = null;
        if (booking.item_description) {
            try {
                swimmingDetails = JSON.parse(booking.item_description);
            } catch (e) {
                console.error("Error parsing swimming details:", e);
            }
        }

        res.json({
            success: true,
            canEnroll: !bookingIsFull,
            existingEnrollment: existingEnrollment,
            booking: {
                booking_reference: booking.booking_reference,
                item_name: booking.item_name,
                unit_price: booking.unit_price,
                payment_status: booking.payment_status,
                batch_id: booking.batch_id,
                schedule_id: booking.schedule_id,
                coach_id: booking.coach_id,
                batch_name: booking.batch_name,
                start_date: booking.start_date,
                end_date: booking.end_date,
                class_period: booking.class_period,
                start_time: booking.start_time,
                end_time: booking.end_time,
                coach_name: booking.coach_name,
                swimmingDetails: swimmingDetails,
                enrolled_count: enrolledCount,
                available_slots: Math.max(0, availableSlots)
            },
            message: bookingIsFull
                ? `Booking is full, but an existing enrollment was found. You may update your registration.`
                : `Booking validated successfully. ${availableSlots} slot(s) available. Class ID: ${booking.booking_reference}`
        });

    } catch (error) {
        console.error("Error validating booking:", error);
        res.status(500).json({
            success: false,
            error: "Failed to validate booking",
            details: error.message
        });
    }
});

/**
 * POST /api/swimming/enroll
 * Enroll a student using booking reference
 * 
 * Request Body:
 * {
 *   bookingReference: "SWM12345678",
 *   firstName, lastName, dateOfBirth, email, etc.
 * }
 * 
 * Returns: Created enrollment with validation of booking capacity
 */
router.post("/enroll", requireStaff, swimmingEnrollValidators, handleValidationErrors, async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const {
            bookingReference,
            bookingId,
            firstName,
            middleName,
            lastName,
            dateOfBirth,
            sex,
            weight,
            height,
            preferredCoach,
            address,
            mobilePhone,
            email,
            fatherName,
            motherName,
            emergencyContactName,
            emergencyContactPhone,
            lessonType,
            skillLevel
        } = req.body;

        // Validate required fields
        if (!bookingReference || !firstName || !lastName || !dateOfBirth || !email || !address) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: "Missing required fields: bookingReference, firstName, lastName, dateOfBirth, email, address"
            });
        }

        // Step 1: Validate booking reference and get capacity (simplified approach)
        const [bookingCheck] = await connection.query(
            `SELECT 
                b.booking_id,
                b.booking_reference,
                bi.guests as paid_slots,
                bi.item_name as lesson_type,
                bi.item_description,
                bi.batch_id,
                bi.schedule_id
            FROM bookings b
            JOIN booking_items bi ON b.booking_id = bi.booking_id
            WHERE b.booking_reference = ?
                AND bi.item_type = 'Swimming'
                AND b.payment_status = 'Paid'`,
            [bookingReference]
        );

        if (bookingCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                error: "Invalid booking reference or payment not confirmed"
            });
        }

        const booking = bookingCheck[0];

        // Parse swimming details from item_description
        let swimmingDetails = null;
        if (booking.item_description) {
            try {
                swimmingDetails = JSON.parse(booking.item_description);
            } catch (e) {
                console.error("Error parsing swimming details:", e);
            }
        }

        // Extract batch_id and schedule_id from booking item
        let batchId = booking.batch_id;
        let scheduleId = booking.schedule_id;

        // Fallback: try to parse from swimmingDetails if batch/schedule not in booking_items
        if (!batchId && swimmingDetails && swimmingDetails.batch_id) {
            batchId = swimmingDetails.batch_id;
        }
        if (!scheduleId && swimmingDetails && swimmingDetails.schedule_id) {
            scheduleId = swimmingDetails.schedule_id;
        }

        // Get coach_id from swimming_batch_schedules if schedule_id is available
        let coachId = null;
        if (scheduleId) {
            try {
                const [scheduleData] = await connection.query(
                    `SELECT coach_id FROM swimming_batch_schedules WHERE schedule_id = ?`,
                    [scheduleId]
                );
                if (scheduleData.length > 0) {
                    coachId = scheduleData[0].coach_id;
                }
            } catch (e) {
                console.error("Error fetching coach_id:", e);
            }
        }

        // Step 2: Check how many enrollments already exist for this booking reference
        const [enrollmentCount] = await connection.query(
            `SELECT COUNT(*) as enrolled_count
             FROM swimming_enrollments
             WHERE booking_reference = ?`,
            [bookingReference]
        );

        const currentEnrollments = enrollmentCount[0].enrolled_count;

        // Step 3: Check if booking is full
        if (currentEnrollments >= booking.paid_slots) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: `Booking is full. Paid for ${booking.paid_slots} participant(s), ${currentEnrollments} already enrolled.`
            });
        }

        // Step 4: Create enrollment with booking reference
        const [enrollmentResult] = await connection.query(
            `INSERT INTO swimming_enrollments (
                booking_reference,
                batch_id,
                schedule_id,
                coach_id,
                first_name,
                middle_name,
                last_name,
                date_of_birth,
                sex,
                weight,
                height,
                preferred_coach,
                address,
                mobile_phone,
                email,
                father_name,
                mother_name,
                emergency_contact_name,
                emergency_contact_phone,
                lesson_type,
                skill_level,
                enrollment_status,
               created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', NOW())`,
            [
                bookingReference,
                batchId || null,
                scheduleId || null,
                coachId || null,
                firstName,
                middleName || null,
                lastName,
                dateOfBirth,
                sex || null,
                weight || null,
                height || null,
                preferredCoach || null,
                address,
                mobilePhone || null,
                email,
                fatherName || null,
                motherName || null,
                emergencyContactName || null,
                emergencyContactPhone || null,
                lessonType || booking.lesson_type,
                skillLevel || 'Beginner'
            ]
        );

        const enrollmentId = enrollmentResult.insertId;

        // Get final count
        const finalEnrollments = currentEnrollments + 1;
        const allSlotsFilled = finalEnrollments >= booking.paid_slots;

        await connection.commit();

        res.json({
            success: true,
            enrollmentId: enrollmentId,
            message: `Successfully enrolled ${firstName} ${lastName}`,
            bookingReference: bookingReference,
            classId: bookingReference,
            batchId: batchId,
            scheduleId: scheduleId,
            coachId: coachId,
            totalSlots: booking.paid_slots,
            slotsUsed: finalEnrollments,
            allSlotsFilled: allSlotsFilled,
            swimmingDetails: swimmingDetails,
            enrollmentDetails: {
                name: `${firstName} ${lastName}`,
                email: email,
                lessonType: lessonType || booking.lesson_type,
                skillLevel: skillLevel || 'Beginner',
                batchId: batchId,
                scheduleId: scheduleId,
                coachId: coachId
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error creating enrollment:", error);
        res.status(500).json({
            success: false,
            error: "Failed to create enrollment",
            details: error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * GET /api/swimming/enrollments
 * Get all enrollments with optional filtering
 * 
 * Query Parameters:
 * - status: Filter by enrollment_status
 * - lessonType: Filter by lesson_type
 * - limit: Number of records to return
 * - offset: Pagination offset
 */
router.get("/enrollments", requireStaff, async (req, res) => {
    try {
        const { status, lessonType, limit = 100, offset = 0 } = req.query;

        let sql = "SELECT * FROM swimming_enrollments WHERE 1=1";
        const params = [];

        if (status) {
            sql += " AND enrollment_status = ?";
            params.push(status);
        }

        if (lessonType) {
            sql += " AND lesson_type = ?";
            params.push(lessonType);
        }

        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        params.push(parseInt(limit), parseInt(offset));

        const [enrollments] = await db.query(sql, params);

        // Get total count
        let countSql = "SELECT COUNT(*) as total FROM swimming_enrollments WHERE 1=1";
        const countParams = [];

        if (status) {
            countSql += " AND enrollment_status = ?";
            countParams.push(status);
        }

        if (lessonType) {
            countSql += " AND lesson_type = ?";
            countParams.push(lessonType);
        }

        const [[{ total }]] = await db.query(countSql, countParams);

        res.json({
            enrollments,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error("Error fetching enrollments:", error);
        res.status(500).json({
            error: "Failed to fetch enrollments",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/enrollments/:id
 * Get a specific enrollment by ID
 */
router.get("/enrollments/:id", requireStaff, async (req, res) => {
    try {
        const { id } = req.params;

        const [enrollments] = await db.query(
            "SELECT * FROM swimming_enrollments WHERE enrollment_id = ?",
            [id]
        );

        if (enrollments.length === 0) {
            return res.status(404).json({ error: "Enrollment not found" });
        }

        res.json(enrollments[0]);

    } catch (error) {
        console.error("Error fetching enrollment:", error);
        res.status(500).json({
            error: "Failed to fetch enrollment",
            details: error.message
        });
    }
});

/**
 * PUT /api/swimming/enrollments/:id
 * Update enrollment (typically used to change status or payment)
 */
router.put("/enrollments/:id", requireStaff, async (req, res) => {
    try {
        const { id } = req.params;
        const { enrollmentStatus, paymentStatus, ...updateFields } = req.body;

        // Build dynamic update query
        const updates = [];
        const values = [];

        if (enrollmentStatus) {
            updates.push("enrollment_status = ?");
            values.push(enrollmentStatus);
        }

        if (paymentStatus) {
            updates.push("payment_status = ?");
            values.push(paymentStatus);
        }

        // Add other fields that can be updated (exclude fields derived from booking)
        const allowedFields = [
            'first_name', 'middle_name', 'last_name', 'email', 'mobile_phone',
            'address', 'skill_level',
            'sex', 'weight', 'height', 'father_name', 'mother_name',
            'emergency_contact_name', 'emergency_contact_phone', 'physician_phone'
        ];

        Object.keys(updateFields).forEach(field => {
            const snakeField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            if (allowedFields.includes(snakeField)) {
                updates.push(`${snakeField} = ?`);
                values.push(updateFields[field]);
            }
        });

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid fields to update" });
        }

        values.push(id);

        const sql = `UPDATE swimming_enrollments SET ${updates.join(", ")} WHERE enrollment_id = ?`;

        await db.query(sql, values);

        // Fetch updated enrollment
        const [enrollment] = await db.query(
            "SELECT * FROM swimming_enrollments WHERE enrollment_id = ?",
            [id]
        );

        res.json({
            message: "Enrollment updated successfully",
            enrollment: enrollment[0]
        });

    } catch (error) {
        console.error("Error updating enrollment:", error);
        res.status(500).json({
            error: "Failed to update enrollment",
            details: error.message
        });
    }
});

/**
 * DELETE /api/swimming/enrollments/:id
 * Delete an enrollment (admin only)
 */
router.delete("/enrollments/:id", requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM swimming_enrollments WHERE enrollment_id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Enrollment not found" });
        }

        res.json({ message: "Enrollment deleted successfully" });

    } catch (error) {
        console.error("Error deleting enrollment:", error);
        res.status(500).json({
            error: "Failed to delete enrollment",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/page-data
 * Serve swimming landing page metadata for the website
 */
router.get("/page-data", async (req, res) => {
    try {
        res.json({
            features: [
                { icon: 'fas fa-user-tie', title: 'Certified Instructors', description: 'Learn from experienced, certified swimming coaches with years of teaching experience' },
                { icon: 'fas fa-shield-alt', title: 'Safety First', description: 'State-of-the-art facilities with lifeguards on duty and safety equipment available' },
                { icon: 'fas fa-users', title: 'All Skill Levels', description: 'From beginners to advanced swimmers, we have programs tailored to your needs' }
            ],
            lessonTypes: [
                {
                    type: '7 Years Old & Above', subtitle: 'Teen & Adult Program', icon: 'fas fa-star',
                    price: 3000, duration: 'package', image: '/images/child.jpeg',
                    features: ['10 sessions program', '1 hour per session', 'Expert instruction', 'Progressive skill building', 'Flexible scheduling']
                },
                {
                    type: '6 Years Old & Below', subtitle: 'Kids Swimming Program', icon: 'fas fa-swimmer',
                    price: 4000, duration: 'package', image: '/images/teen.jpg',
                    features: ['10 sessions program', '1 hour per session', 'Fun & safe learning', 'Age-appropriate methods', 'Parental involvement welcome']
                }
            ],
            schedule: [
                { time: '6:00 AM - 7:00 AM', weekday: 'Advanced Training', weekend: 'Private Sessions' },
                { time: '8:00 AM - 9:00 AM', weekday: 'Beginner Group', weekend: 'Family Sessions' },
                { time: '10:00 AM - 11:00 AM', weekday: 'Intermediate Group', weekend: 'Kids Group' },
                { time: '2:00 PM - 3:00 PM', weekday: 'Kids Group', weekend: 'Beginner Group' },
                { time: '4:00 PM - 5:00 PM', weekday: 'Private Sessions', weekend: 'Advanced Group' }
            ],
            galleryImages: [
                { url: '/images/child.jpeg', caption: '7 Years Old & Above' },
                { url: '/images/teen.jpg', caption: '6 Years Old & Below' }
            ]
        });
    } catch (error) {
        console.error('Error fetching page data:', error);
        res.status(500).json({ error: 'Failed to fetch swimming page data', details: error.message });
    }
});

/**
 * GET /api/swimming/batches
 * Return visible swimming batches for customer booking
 */
router.get('/batches', async (req, res) => {
    try {
        const [batches] = await db.query(
            `SELECT
                batch_id,
                batch_name,
                lesson_type,
                days,
                time_slot,
                start_date,
                end_date,
                status,
                schedule_type,
                max_sessions,
                generated_sessions,
                capacity
             FROM swimming_batches
             WHERE status IN ('Open', 'Ongoing')
             ORDER BY start_date ASC`
        );

        res.json({ success: true, batches });
    } catch (error) {
        console.error('Error fetching swimming batches:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch swimming batches', details: error.message });
    }
});

/**
 * GET /api/swimming/batches/:batchId/sessions
 * Public read-only session dates for customer booking
 */
router.get('/batches/:batchId/sessions', batchIdParam, handleValidationErrors, async (req, res) => {
    try {
        const batchId = Number(req.params.batchId);
        const result = await getPublicBatchSessions(batchId);

        if (result.notFound) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }

        if (result.notAvailable) {
            return res.status(404).json({ success: false, error: 'Batch is not open for booking' });
        }

        return res.json({
            success: true,
            batch: {
                batch_id: result.batch.batch_id,
                batch_name: result.batch.batch_name,
                schedule_type: result.batch.schedule_type,
                max_sessions: result.batch.max_sessions,
                generated_sessions: result.batch.generated_sessions,
                start_date: result.batch.start_date,
                end_date: result.batch.end_date,
                time_slot: result.batch.time_slot,
            },
            sessions: result.sessions,
            count: result.sessions.length,
        });
    } catch (error) {
        console.error('Error fetching public batch sessions:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch batch sessions' });
    }
});

/**
 * GET /api/swimming/batch-schedules
 * Return batch schedules for customer booking
 */
router.get('/batch-schedules', async (req, res) => {
    try {
        const { batchId } = req.query;
        const params = [];
        let whereClause = `b.status IN ('Open', 'Ongoing')`;

        if (batchId) {
            whereClause += ' AND s.batch_id = ?';
            params.push(batchId);
        }

        const [rows] = await db.query(
            `SELECT
                s.schedule_id,
                s.batch_id,
                s.coach_id,
                s.class_period,
                s.start_time,
                s.end_time,
                s.max_slots,
                s.status,
                c.name AS coach_name,
                b.batch_name,
                b.start_date,
                b.end_date
             FROM swimming_batch_schedules s
             INNER JOIN swimming_batches b ON s.batch_id = b.batch_id
             LEFT JOIN swimming_coaches c ON s.coach_id = c.coach_id
             WHERE ${whereClause}
             ORDER BY b.start_date ASC, s.start_time ASC`,
            params
        );

        const schedules = await Promise.all(rows.map(async row => {
            const used_slots = await countApprovedEnrollmentsForSchedule(row.schedule_id);
            return {
                ...row,
                used_slots,
                slots_left: Math.max(0, Number(row.max_slots || 0) - used_slots)
            };
        }));

        res.json({ success: true, schedules });
    } catch (error) {
        console.error('Error fetching batch schedules:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch batch schedules', details: error.message });
    }
});

// ============================================================
// COACHES ENDPOINTS
// ============================================================

/**
 * GET /api/swimming/coaches
 * Get all swimming coaches
 */
router.get("/coaches", async (req, res) => {
    try {
        const { status = 'Active' } = req.query;

        const [coaches] = await db.query(
            `SELECT
                sc.coach_id,
                sc.user_id,
                COALESCE(CONCAT(u.first_name, ' ', u.last_name), sc.name) AS name,
                u.email,
                u.phone,
                sc.specialization,
                sc.experience_years,
                sc.certification,
                sc.bio,
                sc.availability,
                sc.status
             FROM swimming_coaches sc
             LEFT JOIN user u ON u.user_id = sc.user_id
             WHERE sc.status = ?
             ORDER BY name`,
            [status]
        );

        res.json({
            success: true,
            data: coaches
        });

    } catch (error) {
        console.error("Error fetching coaches:", error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch coaches',
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/coaches/:id
 * Get a specific coach by ID
 */
router.get("/coaches/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [coaches] = await db.query(
            `SELECT
                sc.*,
                u.first_name,
                u.last_name,
                u.email AS user_email,
                u.phone AS user_phone,
                COALESCE(CONCAT(u.first_name, ' ', u.last_name), sc.name) AS display_name
             FROM swimming_coaches sc
             LEFT JOIN user u ON u.user_id = sc.user_id
             WHERE sc.coach_id = ?`,
            [id]
        );

        if (coaches.length === 0) {
            return res.status(404).json({ error: "Coach not found" });
        }

        const coach = coaches[0];
        res.json({
            ...coach,
            name: coach.display_name,
            email: coach.user_email,
            phone: coach.user_phone
        });

    } catch (error) {
        console.error("Error fetching coach:", error);
        res.status(500).json({
            error: "Failed to fetch coach",
            details: error.message
        });
    }
});

/**
 * POST /api/swimming/coaches
 * Create a new coach (admin only)
 */
router.post("/coaches", async (req, res) => {
    try {
        const {
            userId,
            user_id,
            specialization,
            experienceYears,
            experience_years,
            certification,
            bio,
            profileImage,
            profile_image,
            availability,
            maxStudents,
            max_students,
            status
        } = req.body;

        const linkedUserId = userId ?? user_id;
        if (!linkedUserId) {
            return res.status(400).json({ success: false, error: "Instructor account is required" });
        }
        if (!specialization?.trim()) {
            return res.status(400).json({ success: false, error: "Specialization is required" });
        }

        const eligibility = await assertEligibleCoachUser(linkedUserId);
        if (eligibility.error) {
            return res.status(400).json({ success: false, error: eligibility.error });
        }

        const experienceYearsValue = experienceYears ?? experience_years ?? null;
        const maxStudentsValue = maxStudents ?? max_students ?? 10;
        const profileImageValue = profileImage ?? profile_image ?? null;
        const statusValue = status || 'Active';

        const sql = `
      INSERT INTO swimming_coaches (
        user_id, name, specialization, experience_years, certification,
        bio, profile_image, availability, max_students, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const [result] = await db.query(sql, [
            linkedUserId,
            eligibility.displayName,
            specialization.trim(),
            experienceYearsValue,
            certification,
            bio,
            profileImageValue,
            availability || null,
            maxStudentsValue,
            statusValue
        ]);

        await syncSwimmingCoachFromUser(linkedUserId);

        const [coach] = await db.query(
            `SELECT
                sc.coach_id,
                sc.user_id,
                COALESCE(CONCAT(u.first_name, ' ', u.last_name), sc.name) AS name,
                u.email,
                u.phone,
                sc.specialization,
                sc.availability,
                sc.max_students,
                sc.status
             FROM swimming_coaches sc
             LEFT JOIN user u ON u.user_id = sc.user_id
             WHERE sc.coach_id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: "Coach created successfully",
            coach: coach[0]
        });

    } catch (error) {
        console.error("Error creating coach:", error);
        res.status(500).json({
            success: false,
            error: "Failed to create coach",
            details: error.message
        });
    }
});

/**
 * PUT /api/swimming/coaches/:id
 * Update coach information
 */
router.put("/coaches/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const {
            userId,
            user_id,
            specialization,
            availability,
            maxStudents,
            max_students,
            status,
            experienceYears,
            experience_years,
            certification,
            bio,
            profileImage,
            profile_image
        } = req.body;

        const [existingRows] = await db.query(
            'SELECT coach_id FROM swimming_coaches WHERE coach_id = ? LIMIT 1',
            [id]
        );
        if (!existingRows.length) {
            return res.status(404).json({ success: false, error: 'Coach not found' });
        }

        const updates = [];
        const values = [];

        const nextUserId = userId ?? user_id;
        if (nextUserId != null && nextUserId !== '') {
            const eligibility = await assertEligibleCoachUser(nextUserId, id);
            if (eligibility.error) {
                return res.status(400).json({ success: false, error: eligibility.error });
            }
            updates.push('user_id = ?', 'name = ?');
            values.push(nextUserId, eligibility.displayName);
        }

        if (specialization !== undefined) {
            updates.push('specialization = ?');
            values.push(String(specialization).trim());
        }
        if (availability !== undefined) {
            updates.push('availability = ?');
            values.push(availability || null);
        }
        if (maxStudents !== undefined || max_students !== undefined) {
            updates.push('max_students = ?');
            values.push(maxStudents ?? max_students ?? 10);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }
        if (experienceYears !== undefined || experience_years !== undefined) {
            updates.push('experience_years = ?');
            values.push(experienceYears ?? experience_years ?? null);
        }
        if (certification !== undefined) {
            updates.push('certification = ?');
            values.push(certification);
        }
        if (bio !== undefined) {
            updates.push('bio = ?');
            values.push(bio);
        }
        if (profileImage !== undefined || profile_image !== undefined) {
            updates.push('profile_image = ?');
            values.push(profileImage ?? profile_image ?? null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: "No valid fields to update" });
        }

        values.push(id);

        const sql = `UPDATE swimming_coaches SET ${updates.join(", ")} WHERE coach_id = ?`;

        await db.query(sql, values);

        const [linkedCoach] = await db.query(
            'SELECT user_id FROM swimming_coaches WHERE coach_id = ? LIMIT 1',
            [id]
        );
        if (linkedCoach[0]?.user_id) {
            await syncSwimmingCoachFromUser(linkedCoach[0].user_id);
        }

        const [coach] = await db.query(
            `SELECT
                sc.coach_id,
                sc.user_id,
                COALESCE(CONCAT(u.first_name, ' ', u.last_name), sc.name) AS name,
                u.email,
                u.phone,
                sc.specialization,
                sc.availability,
                sc.max_students,
                sc.status
             FROM swimming_coaches sc
             LEFT JOIN user u ON u.user_id = sc.user_id
             WHERE sc.coach_id = ?`,
            [id]
        );

        res.json({
            success: true,
            message: "Coach updated successfully",
            coach: coach[0]
        });

    } catch (error) {
        console.error("Error updating coach:", error);
        res.status(500).json({
            error: "Failed to update coach",
            details: error.message
        });
    }
});

/**
 * DELETE /api/swimming/coaches/:id
 * Remove coach (hard delete when unused, otherwise mark Inactive)
 */
router.delete("/coaches/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query(
            "SELECT coach_id, name FROM swimming_coaches WHERE coach_id = ?",
            [id]
        );
        if (!existing.length) {
            return res.status(404).json({ success: false, error: "Coach not found" });
        }

        const [[usage]] = await db.query(
            `SELECT
                (SELECT COUNT(*) FROM swimming_enrollments WHERE coach_id = ?) AS enrollment_count,
                (SELECT COUNT(*) FROM swimming_batch_schedules WHERE coach_id = ?) AS schedule_count,
                (SELECT COUNT(*) FROM swimming_batches WHERE coach_id = ?) AS batch_count`,
            [id, id, id]
        );

        const inUse = Number(usage.enrollment_count || 0)
            + Number(usage.schedule_count || 0)
            + Number(usage.batch_count || 0) > 0;

        if (inUse) {
            await db.query(
                "UPDATE swimming_coaches SET status = 'Inactive' WHERE coach_id = ?",
                [id]
            );
            return res.json({
                success: true,
                message: "Coach marked inactive because they are linked to existing records",
                softDeleted: true
            });
        }

        await db.query("DELETE FROM swimming_coaches WHERE coach_id = ?", [id]);
        res.json({
            success: true,
            message: "Coach deleted successfully",
            softDeleted: false
        });
    } catch (error) {
        console.error("Error deleting coach:", error);
        res.status(500).json({
            success: false,
            error: "Failed to delete coach",
            details: error.message
        });
    }
});

// ============================================================
// SWIMMING CLASS BOOKINGS (CONNECTED TO MAIN RESERVATIONS)
// ============================================================

/**
 * POST /api/swimming/class-bookings
 * Creates a swimming reservation entry in bookings + booking_items
 * so it appears in Admin Reservation Management for the selected date.
 */
router.post("/class-bookings", async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const {
            fullName,
            email,
            phone,
            lessonType,
            skillLevel,
            preferredDate,
            preferredTime,
            participants = 1,
            notes,
            paymentMethod = 'Cash'
        } = req.body;

        if (!fullName || !email || !phone || !lessonType || !preferredDate || !preferredTime) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['fullName', 'email', 'phone', 'lessonType', 'preferredDate', 'preferredTime']
            });
        }

        const safeParticipants = Math.max(parseInt(participants) || 1, 1);
        const [firstName, ...lastParts] = String(fullName).trim().split(/\s+/);
        const lastName = lastParts.join(' ') || '-';
        const unitPrice = lessonRateMap[lessonType] || 0;
        const totalAmount = unitPrice * safeParticipants;
        const bookingReference = generateSwimmingBookingReference();

        let customerId;
        const [existingCustomer] = await connection.query(
            'SELECT customer_id FROM customers WHERE email = ? LIMIT 1',
            [email]
        );

        if (existingCustomer.length > 0) {
            customerId = existingCustomer[0].customer_id;
            await connection.query(
                `UPDATE customers
                 SET first_name = ?, last_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE customer_id = ?`,
                [firstName, lastName, phone, customerId]
            );
        } else {
            const [customerResult] = await connection.query(
                `INSERT INTO customers (first_name, last_name, email, phone, city, country)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [firstName, lastName, email, phone, 'Calapan', 'Philippines']
            );
            customerId = customerResult.insertId;
        }

        const [bookingResult] = await connection.query(
            `INSERT INTO bookings (
                booking_reference,
                customer_id,
                first_name,
                last_name,
                email,
                phone,
                address,
                city,
                country,
                check_in_date,
                check_out_date,
                nights,
                adults,
                children,
                arrival_time,
                special_requests,
                subtotal,
                total,
                booking_status,
                payment_status,
                payment_method
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Unpaid', ?)`,
            [
                bookingReference,
                customerId,
                firstName,
                lastName,
                email,
                phone,
                'Swimming Lesson Reservation',
                'Calapan',
                'Philippines',
                preferredDate,
                preferredDate,
                0,
                safeParticipants,
                0,
                preferredTime,
                notes || null,
                totalAmount,
                totalAmount,
                paymentMethod
            ]
        );

        const bookingId = bookingResult.insertId;

        await connection.query(
            `INSERT INTO booking_items (
                booking_id,
                item_type,
                item_name,
                item_description,
                unit_price,
                quantity,
                nights,
                total_price,
                guests,
                per_night
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                bookingId,
                'Swimming',
                `Swimming Lesson - ${lessonType}`,
                `Lesson Type: ${lessonType} | Skill: ${skillLevel || 'N/A'} | Time: ${preferredTime}`,
                unitPrice,
                safeParticipants,
                0,
                totalAmount,
                safeParticipants,
                false
            ]
        );

        await connection.query(
            `INSERT INTO booking_logs (booking_id, action, new_status, description, performed_by)
             VALUES (?, 'Created', 'Pending', ?, 'Swimming Website')`,
            [bookingId, `Swimming lesson booking created (${lessonType})`]
        );

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: 'Swimming class booking submitted successfully',
            data: {
                bookingId,
                bookingReference,
                reservationType: 'Swimming Lesson',
                lessonType,
                preferredDate,
                preferredTime,
                participants: safeParticipants,
                totalAmount,
                email
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating swimming class booking:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create swimming class booking',
            details: error.message
        });
    } finally {
        connection.release();
    }
});

/**
 * GET /api/swimming/class-bookings
 * Optional helper endpoint for daily swimming lesson reservations.
 */
router.get('/class-bookings', async (req, res) => {
    try {
        const { date } = req.query;

        let sql = `
            SELECT
                b.booking_id,
                b.booking_reference,
                b.check_in_date,
                b.arrival_time,
                b.first_name,
                b.last_name,
                b.email,
                b.phone,
                b.booking_status,
                b.payment_status,
                b.total,
                bi.item_name,
                bi.item_description,
                bi.quantity,
                bi.unit_price
            FROM bookings b
            INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
            WHERE bi.item_name LIKE 'Swimming Lesson - %'
        `;
        const params = [];

        if (date) {
            sql += ' AND b.check_in_date = ?';
            params.push(date);
        }

        sql += ' ORDER BY b.check_in_date DESC, b.created_at DESC';

        const [rows] = await db.query(sql, params);

        return res.json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching swimming class bookings:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch swimming class bookings',
            details: error.message
        });
    }
});

// ============================================================
// SWIMMING CLASS BOOKINGS (FOR ENROLLMENT CLASSES)
// ============================================================

/**
 * POST /api/swimming/class-bookings
 * Book a class schedule for an enrollment
 */
router.post("/class-bookings", async (req, res) => {
    try {
        const {
            enrollmentId,
            classDate,
            classTime,
            coachName,
            remarks
        } = req.body;

        // Validate required fields
        if (!enrollmentId || !classDate || !classTime || !coachName) {
            return res.status(400).json({
                error: "Missing required fields",
                required: ["enrollmentId", "classDate", "classTime", "coachName"]
            });
        }

        const sql = `
            INSERT INTO swimming_class_bookings (
                enrollment_id, class_date, class_time, coach_name, remarks
            ) VALUES (?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(sql, [
            enrollmentId, classDate, classTime, coachName, remarks || null
        ]);

        // Fetch the created booking
        const [booking] = await db.query(
            "SELECT * FROM swimming_class_bookings WHERE booking_id = ?",
            [result.insertId]
        );

        res.status(201).json({
            message: "Class booking created successfully",
            booking: booking[0]
        });

    } catch (error) {
        console.error("Error creating class booking:", error);
        res.status(500).json({
            error: "Failed to create class booking",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/class-bookings
 * Get all class bookings, optionally filtered by enrollment
 */
router.get("/class-bookings", async (req, res) => {
    try {
        const { enrollmentId } = req.query;

        let sql = "SELECT * FROM swimming_class_bookings WHERE 1=1";
        const params = [];

        if (enrollmentId) {
            sql += " AND enrollment_id = ?";
            params.push(enrollmentId);
        }

        sql += " ORDER BY class_date DESC";

        const [bookings] = await db.query(sql, params);

        res.json({
            success: true,
            data: bookings
        });

    } catch (error) {
        console.error("Error fetching class bookings:", error);
        res.status(500).json({
            error: "Failed to fetch class bookings",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/class-bookings/:id
 * Get a specific class booking
 */
router.get("/class-bookings/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [bookings] = await db.query(
            "SELECT * FROM swimming_class_bookings WHERE booking_id = ?",
            [id]
        );

        if (bookings.length === 0) {
            return res.status(404).json({ error: "Class booking not found" });
        }

        res.json(bookings[0]);

    } catch (error) {
        console.error("Error fetching class booking:", error);
        res.status(500).json({
            error: "Failed to fetch class booking",
            details: error.message
        });
    }
});

/**
 * PUT /api/swimming/class-bookings/:id
 * Update class booking status or details
 */
router.put("/class-bookings/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { classDate, classTime, coachName, status, remarks } = req.body;

        const updates = [];
        const values = [];

        if (classDate) {
            updates.push("class_date = ?");
            values.push(classDate);
        }
        if (classTime) {
            updates.push("class_time = ?");
            values.push(classTime);
        }
        if (coachName) {
            updates.push("coach_name = ?");
            values.push(coachName);
        }
        if (status) {
            updates.push("status = ?");
            values.push(status);
        }
        if (remarks !== undefined) {
            updates.push("remarks = ?");
            values.push(remarks || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "No fields to update" });
        }

        values.push(id);

        const sql = `UPDATE swimming_class_bookings SET ${updates.join(", ")} WHERE booking_id = ?`;

        await db.query(sql, values);

        // Fetch updated booking
        const [booking] = await db.query(
            "SELECT * FROM swimming_class_bookings WHERE booking_id = ?",
            [id]
        );

        res.json({
            message: "Class booking updated successfully",
            booking: booking[0]
        });

    } catch (error) {
        console.error("Error updating class booking:", error);
        res.status(500).json({
            error: "Failed to update class booking",
            details: error.message
        });
    }
});

/**
 * DELETE /api/swimming/class-bookings/:id
 * Delete a class booking
 */
router.delete("/class-bookings/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM swimming_class_bookings WHERE booking_id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Class booking not found" });
        }

        res.json({ message: "Class booking deleted successfully" });

    } catch (error) {
        console.error("Error deleting class booking:", error);
        res.status(500).json({
            error: "Failed to delete class booking",
            details: error.message
        });
    }
});

// ============================================================
// ADMIN MANAGEMENT ENDPOINTS
// ============================================================

/**
 * GET /api/swimming/admin/students
 * Get all enrolled students with detailed info for admin panel
 * Includes coach names, booking info, and payment status
 */
router.get("/admin/students", async (req, res) => {
    try {
        const [students] = await db.query(`
            SELECT
                se.enrollment_id,
                CONCAT(se.first_name, ' ', se.last_name) AS name,
                se.first_name,
                se.last_name,
                COALESCE(NULLIF(se.lesson_type, ''), bi.item_name) AS lesson_type,
                COALESCE(sc.name, se.admin_assigned_coach, se.preferred_coach) AS coach,
                se.email,
                se.mobile_phone,
                se.enrollment_status,
                se.admin_lesson_dates,
                se.admin_lesson_time,
                se.admin_assigned_coach,
                se.booking_reference,
                se.created_at,
                b.booking_id,
                b.payment_status,
                b.created_at AS booking_date,
COALESCE(se.batch_id, bi.batch_id) AS batch_id,
            COALESCE(se.schedule_id, bi.schedule_id) AS schedule_id,
            se.rate_amount,
            se.age_group,
            se.rejection_reason,
            sb.batch_name,
            s.class_period,
            s.start_time,
            s.end_time,
            s.status AS schedule_status,
            s.max_slots,
            COALESCE(sc2.name, 'Unassigned') AS schedule_coach_name,
            JSON_UNQUOTE(JSON_EXTRACT(bi.item_description, '$.dates')) AS item_lesson_dates,
            JSON_UNQUOTE(JSON_EXTRACT(bi.item_description, '$.time')) AS item_lesson_time
            FROM swimming_enrollments se
            LEFT JOIN bookings b ON se.booking_reference = b.booking_reference
            LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id AND bi.item_type = 'Swimming'
            LEFT JOIN swimming_coaches sc ON sc.coach_id = se.coach_id
            LEFT JOIN swimming_batch_schedules s ON COALESCE(se.schedule_id, bi.schedule_id) = s.schedule_id
            LEFT JOIN swimming_batches sb ON COALESCE(se.batch_id, bi.batch_id) = sb.batch_id
            LEFT JOIN swimming_coaches sc2 ON sc2.coach_id = s.coach_id
            ORDER BY se.created_at DESC
        `);

        res.json({
            success: true,
            students,
            count: students.length
        });

    } catch (error) {
        console.error("Error fetching students for admin:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch students",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/batches
 * List swimming batches with schedule counts
 */
router.get("/admin/batches", requireStaff, async (req, res) => {
    try {
        const [batches] = await db.query(`
            SELECT
                b.batch_id,
                b.batch_id,
                b.batch_name,
                b.lesson_type,
                b.coach_id,
                b.days,
                b.time_slot,
                b.capacity AS batch_capacity,
                b.notes,
                b.start_date,
                b.end_date,
                b.status,
                b.schedule_type,
                b.max_sessions,
                b.generated_sessions,
                COUNT(DISTINCT bs.schedule_id) AS schedule_count,
                COALESCE(SUM(bs.max_slots), 0) AS schedule_capacity,
                COUNT(DISTINCT se.enrollment_id) AS enrolled_count,
                SUM(CASE WHEN bs.status = 'Full' THEN 1 ELSE 0 END) AS full_schedule_count
            FROM swimming_batches b
            LEFT JOIN swimming_batch_schedules bs ON bs.batch_id = b.batch_id
            LEFT JOIN swimming_enrollments se ON se.schedule_id = bs.schedule_id AND se.enrollment_status = 'Approved'
            GROUP BY b.batch_id
            ORDER BY b.start_date ASC
        `);

        res.json({ success: true, batches, count: batches.length });
    } catch (error) {
        console.error("Error fetching batches:", error);
        res.status(500).json({ success: false, error: "Failed to fetch batches", details: error.message });
    }
});

/**
 * POST /api/swimming/admin/batches
 * Create a new batch
 */
router.post("/admin/batches", requireStaff, createBatchValidators, handleValidationErrors, async (req, res) => {
    try {
        const {
            batchName,
            lessonType = null,
            coachId = null,
            days = null,
            timeSlot = null,
            capacity = 0,
            notes = null,
            startDate,
            endDate,
            status = 'Open',
            scheduleType = 'DAILY',
            maxSessions = null,
            autoGenerateSessions = true,
        } = req.body;

        if (!batchName || !startDate || !endDate) {
            return res.status(400).json({ success: false, error: "batchName, startDate, and endDate are required" });
        }

        const normalizedScheduleType = normalizeScheduleType(scheduleType);
        const parsedMaxSessions = maxSessions == null || maxSessions === ''
            ? null
            : Number(maxSessions);

        if (parsedMaxSessions != null) {
            validateBatchScheduleConfig({
                schedule_type: normalizedScheduleType,
                max_sessions: parsedMaxSessions,
                start_date: startDate,
                end_date: endDate,
                days,
            });
        } else if (normalizedScheduleType === 'SELECTED_DAYS') {
            const selectedDays = Array.isArray(days) ? days : [];
            if (!selectedDays.length) {
                return res.status(400).json({ success: false, error: 'SELECTED_DAYS requires at least one day selected' });
            }
        }

        if (new Date(`${startDate}T00:00:00`) > new Date(`${endDate}T00:00:00`)) {
            return res.status(400).json({ success: false, error: 'startDate cannot be after endDate' });
        }

        const [result] = await db.query(
            `INSERT INTO swimming_batches (
                batch_name, lesson_type, coach_id, days, time_slot, capacity, notes,
                start_date, end_date, status, schedule_type, max_sessions, generated_sessions
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                batchName,
                lessonType,
                coachId || null,
                JSON.stringify(days || []),
                timeSlot,
                Number(capacity) || 0,
                notes || null,
                startDate,
                endDate,
                status,
                normalizedScheduleType,
                parsedMaxSessions,
            ]
        );

        const batchId = result.insertId;
        const batch = await getBatchById(batchId);
        const defaultScheduleId = await maybeCreateDefaultBatchSchedule(batchId, {
            coachId,
            timeSlot,
            capacity,
            status,
        });
        const generation = await maybeAutoGenerateBatchSessions(batchId, batch, autoGenerateSessions !== false);

        res.status(201).json({
            success: true,
            batch: await getBatchById(batchId),
            defaultScheduleId,
            sessionGeneration: generation,
        });
    } catch (error) {
        console.error("Error creating batch:", error);
        res.status(400).json({ success: false, error: error.message || "Failed to create batch" });
    }
});

/**
 * PUT /api/swimming/admin/batches/:id
 * Update batch details or status
 */
router.put("/admin/batches/:id", requireStaff, updateBatchValidators, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const { batchName, lessonType, coachId, days, timeSlot, capacity, notes, startDate, endDate, status, scheduleType, maxSessions } = req.body;

        const updates = [];
        const values = [];

        if (batchName) {
            updates.push("batch_name = ?");
            values.push(batchName);
        }
        if (lessonType !== undefined) {
            updates.push("lesson_type = ?");
            values.push(lessonType || null);
        }
        if (coachId !== undefined) {
            updates.push("coach_id = ?");
            values.push(coachId || null);
        }
        if (days !== undefined) {
            updates.push("days = ?");
            values.push(JSON.stringify(days || []));
        }
        if (timeSlot !== undefined) {
            updates.push("time_slot = ?");
            values.push(timeSlot || null);
        }
        if (capacity !== undefined) {
            updates.push("capacity = ?");
            values.push(Number(capacity) || 0);
        }
        if (notes !== undefined) {
            updates.push("notes = ?");
            values.push(notes || null);
        }
        if (startDate) {
            updates.push("start_date = ?");
            values.push(startDate);
        }
        if (endDate) {
            updates.push("end_date = ?");
            values.push(endDate);
        }
        if (status) {
            updates.push("status = ?");
            values.push(status);
        }
        if (scheduleType !== undefined) {
            updates.push("schedule_type = ?");
            values.push(normalizeScheduleType(scheduleType));
        }
        if (maxSessions !== undefined) {
            updates.push("max_sessions = ?");
            values.push(maxSessions == null || maxSessions === '' ? null : Number(maxSessions));
        }

        if (!updates.length) {
            return res.status(400).json({ success: false, error: "No batch fields provided for update" });
        }

        const existingBatch = await getBatchById(id);
        if (!existingBatch) {
            return res.status(404).json({ success: false, error: "Batch not found" });
        }

        const nextBatchPreview = {
            ...existingBatch,
            batch_name: batchName || existingBatch.batch_name,
            lesson_type: lessonType !== undefined ? lessonType : existingBatch.lesson_type,
            coach_id: coachId !== undefined ? coachId : existingBatch.coach_id,
            days: days !== undefined ? days : existingBatch.days,
            time_slot: timeSlot !== undefined ? timeSlot : existingBatch.time_slot,
            capacity: capacity !== undefined ? capacity : existingBatch.capacity,
            start_date: startDate || existingBatch.start_date,
            end_date: endDate || existingBatch.end_date,
            schedule_type: scheduleType !== undefined ? normalizeScheduleType(scheduleType) : existingBatch.schedule_type,
            max_sessions: maxSessions !== undefined
                ? (maxSessions == null || maxSessions === '' ? null : Number(maxSessions))
                : existingBatch.max_sessions,
        };

        if (nextBatchPreview.max_sessions != null) {
            validateBatchScheduleConfig(nextBatchPreview);
        } else if (String(nextBatchPreview.schedule_type).toUpperCase() === 'SELECTED_DAYS') {
            const selectedDays = parseBatchDays(nextBatchPreview.days);
            if (!selectedDays.length) {
                return res.status(400).json({ success: false, error: 'SELECTED_DAYS requires at least one day selected' });
            }
        }

        if (new Date(`${String(nextBatchPreview.start_date).slice(0, 10)}T00:00:00`)
            > new Date(`${String(nextBatchPreview.end_date).slice(0, 10)}T00:00:00`)) {
            return res.status(400).json({ success: false, error: 'startDate cannot be after endDate' });
        }

        values.push(id);
        await db.query(`UPDATE swimming_batches SET ${updates.join(", ")} WHERE batch_id = ?`, values);

        await syncBatchStatus(id);
        const [batchRows] = await db.query("SELECT * FROM swimming_batches WHERE batch_id = ?", [id]);
        return res.json({ success: true, batch: batchRows[0] });
    } catch (error) {
        console.error("Error updating batch:", error);
        res.status(400).json({ success: false, error: error.message || "Failed to update batch" });
    }
});

const handleGetBatchSessions = async (req, res) => {
    try {
        const batchId = Number(req.params.batchId);
        const batch = await getBatchById(batchId);
        if (!batch) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }

        const sessions = await getBatchSessions(batchId);
        return res.json({
            success: true,
            batch,
            sessions,
            count: sessions.length,
        });
    } catch (error) {
        console.error('Error fetching batch sessions:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to fetch batch sessions' });
    }
};

const handleGenerateBatchSessions = async (req, res) => {
    try {
        const batchId = Number(req.params.batchId);
        const result = await generateBatchSessions(batchId);
        const sessions = await getBatchSessions(batchId);
        return res.json({
            success: true,
            ...result,
            sessions,
        });
    } catch (error) {
        console.error('Error generating batch sessions:', error);
        return res.status(400).json({ success: false, error: error.message || 'Failed to generate batch sessions' });
    }
};

const handleRegenerateBatchSessions = async (req, res) => {
    try {
        const batchId = Number(req.params.batchId);
        const result = await regenerateBatchSessions(batchId);
        const sessions = await getBatchSessions(batchId);
        return res.json({
            success: true,
            ...result,
            sessions,
        });
    } catch (error) {
        console.error('Error regenerating batch sessions:', error);
        return res.status(400).json({ success: false, error: error.message || 'Failed to regenerate batch sessions' });
    }
};

/**
 * GET /api/swimming/admin/batches/:batchId/sessions
 * POST /api/swimming/admin/batches/:batchId/generate-sessions
 * POST /api/swimming/admin/batches/:batchId/regenerate
 */
router.get('/admin/batches/:batchId/sessions', requireStaff, batchIdParam, handleValidationErrors, handleGetBatchSessions);
router.post('/admin/batches/:batchId/generate-sessions', requireStaff, batchIdParam, handleValidationErrors, handleGenerateBatchSessions);
router.post('/admin/batches/:batchId/regenerate', requireStaff, batchIdParam, handleValidationErrors, handleRegenerateBatchSessions);

/**
 * DELETE /api/swimming/admin/batches/:id
 * Close or delete batch depending on existing schedules
 */
router.delete("/admin/batches/:id", requireStaff, adminBatchIdParam, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const [[{ schedule_count }]] = await db.query(
            `SELECT COUNT(*) AS schedule_count FROM swimming_batch_schedules WHERE batch_id = ?`,
            [id]
        );

        if (schedule_count > 0) {
            await db.query(`UPDATE swimming_batches SET status = 'Closed' WHERE batch_id = ?`, [id]);
            return res.json({ success: true, message: "Batch closed because it has existing schedules" });
        }

        const [result] = await db.query(`DELETE FROM swimming_batches WHERE batch_id = ?`, [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: "Batch not found" });
        }

        res.json({ success: true, message: "Batch deleted successfully" });
    } catch (error) {
        console.error("Error deleting batch:", error);
        res.status(500).json({ success: false, error: "Failed to delete batch", details: error.message });
    }
});

/**
 * GET /api/swimming/admin/batch-schedules
 * List batch schedules with batch and coach details
 */
router.get("/admin/batch-schedules", async (req, res) => {
    try {
        const [schedules] = await db.query(`
            SELECT
                bs.schedule_id,
                bs.batch_id,
                sb.batch_name,
                bs.class_period,
                bs.start_time,
                bs.end_time,
                bs.max_slots,
                bs.status,
                bs.coach_id,
                COALESCE(sc.name, 'Unassigned') AS coach_name,
                COUNT(se.enrollment_id) AS used_slots
            FROM swimming_batch_schedules bs
            INNER JOIN swimming_batches sb ON bs.batch_id = sb.batch_id
            LEFT JOIN swimming_coaches sc ON bs.coach_id = sc.coach_id
            LEFT JOIN swimming_enrollments se ON se.schedule_id = bs.schedule_id AND se.enrollment_status = 'Approved'
            GROUP BY bs.schedule_id
            ORDER BY sb.start_date ASC, bs.start_time ASC
        `);

        res.json({ success: true, schedules, count: schedules.length });
    } catch (error) {
        console.error("Error fetching batch schedules:", error);
        res.status(500).json({ success: false, error: "Failed to fetch batch schedules", details: error.message });
    }
});

/**
 * POST /api/swimming/admin/batch-schedules
 * Create a new schedule slot under a batch
 */
router.post("/admin/batch-schedules", async (req, res) => {
    try {
        const { batchId, coachId, classPeriod, startTime, endTime, maxSlots = 10, status = 'Open' } = req.body;

        if (!batchId || !classPeriod || !startTime || !endTime) {
            return res.status(400).json({ success: false, error: "batchId, classPeriod, startTime, and endTime are required" });
        }

        if (classPeriod !== 'AM' && classPeriod !== 'PM') {
            return res.status(400).json({ success: false, error: "classPeriod must be 'AM' or 'PM'" });
        }

        if (endTime <= startTime) {
            return res.status(400).json({ success: false, error: "endTime must be later than startTime" });
        }

        if (await findCoachScheduleConflict(coachId, batchId, startTime, endTime)) {
            return res.status(400).json({ success: false, error: "This coach already has a class schedule during this time." });
        }

        const [result] = await db.query(
            `INSERT INTO swimming_batch_schedules (
                batch_id, coach_id, class_period, start_time, end_time, max_slots, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [batchId, coachId || null, classPeriod, startTime, endTime, maxSlots, status]
        );

        const [scheduleRows] = await db.query("SELECT * FROM swimming_batch_schedules WHERE schedule_id = ?", [result.insertId]);
        res.status(201).json({ success: true, schedule: scheduleRows[0] });
    } catch (error) {
        console.error("Error creating batch schedule:", error);
        res.status(500).json({ success: false, error: "Failed to create batch schedule", details: error.message });
    }
});

/**
 * PUT /api/swimming/admin/batch-schedules/:id
 * Update a batch schedule
 */
router.put("/admin/batch-schedules/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { batchId, coachId, classPeriod, startTime, endTime, maxSlots, status } = req.body;

        const [existingRows] = await db.query("SELECT * FROM swimming_batch_schedules WHERE schedule_id = ?", [id]);
        if (!existingRows.length) {
            return res.status(404).json({ success: false, error: "Schedule not found" });
        }

        const existing = existingRows[0];
        const updates = [];
        const values = [];

        if (batchId) {
            updates.push("batch_id = ?");
            values.push(batchId);
        }
        if (coachId !== undefined) {
            updates.push("coach_id = ?");
            values.push(coachId || null);
        }
        if (classPeriod) {
            if (classPeriod !== 'AM' && classPeriod !== 'PM') {
                return res.status(400).json({ success: false, error: "classPeriod must be 'AM' or 'PM'" });
            }
            updates.push("class_period = ?");
            values.push(classPeriod);
        }
        if (startTime) {
            updates.push("start_time = ?");
            values.push(startTime);
        }
        if (endTime) {
            updates.push("end_time = ?");
            values.push(endTime);
        }
        if (maxSlots !== undefined) {
            updates.push("max_slots = ?");
            values.push(maxSlots);
        }
        if (status) {
            updates.push("status = ?");
            values.push(status);
        }

        if (!updates.length) {
            return res.status(400).json({ success: false, error: "No batch schedule fields provided for update" });
        }

        const targetBatchId = batchId || existing.batch_id;
        const targetStartTime = startTime || existing.start_time;
        const targetEndTime = endTime || existing.end_time;
        const targetCoachId = coachId !== undefined ? coachId : existing.coach_id;

        if (targetStartTime && targetEndTime && targetEndTime <= targetStartTime) {
            return res.status(400).json({ success: false, error: "endTime must be later than startTime" });
        }

        if (await findCoachScheduleConflict(targetCoachId, targetBatchId, targetStartTime, targetEndTime, Number(id))) {
            return res.status(400).json({ success: false, error: "This coach already has a class schedule during this time." });
        }

        values.push(id);
        await db.query(`UPDATE swimming_batch_schedules SET ${updates.join(", ")} WHERE schedule_id = ?`, values);

        const [scheduleRows] = await db.query("SELECT * FROM swimming_batch_schedules WHERE schedule_id = ?", [id]);
        res.json({ success: true, schedule: scheduleRows[0] });
    } catch (error) {
        console.error("Error updating batch schedule:", error);
        res.status(500).json({ success: false, error: "Failed to update batch schedule", details: error.message });
    }
});

/**
 * DELETE /api/swimming/admin/batch-schedules/:id
 * Delete a schedule only if no enrollments exist under it
 */
router.delete("/admin/batch-schedules/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM swimming_enrollments WHERE schedule_id = ?`,
            [id]
        );

        if (total > 0) {
            return res.status(400).json({ success: false, error: "Cannot delete schedule with existing enrollments" });
        }

        const [result] = await db.query(`DELETE FROM swimming_batch_schedules WHERE schedule_id = ?`, [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: "Schedule not found" });
        }

        res.json({ success: true, message: "Schedule deleted successfully" });
    } catch (error) {
        console.error("Error deleting batch schedule:", error);
        res.status(500).json({ success: false, error: "Failed to delete batch schedule", details: error.message });
    }
});

/**
 * PUT /api/swimming/admin/students/:id
 * Update enrollment details, payment, or assignment fields
 */
router.put("/admin/students/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const allowed = [
            'batch_id', 'schedule_id', 'coach_id', 'rate_amount', 'age_group',
            'payment_status', 'enrollment_status', 'rejection_reason'
        ];

        const updates = [];
        const values = [];

        Object.keys(req.body).forEach((field) => {
            if (allowed.includes(field)) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        });

        if (!updates.length) {
            return res.status(400).json({ success: false, error: "No valid fields provided for update" });
        }

        values.push(id);
        await db.query(`UPDATE swimming_enrollments SET ${updates.join(', ')} WHERE enrollment_id = ?`, values);

        if (req.body.schedule_id) {
            await updateBatchScheduleStatus(req.body.schedule_id);
        }

        const [updatedRows] = await db.query("SELECT * FROM swimming_enrollments WHERE enrollment_id = ?", [id]);
        res.json({ success: true, enrollment: updatedRows[0] });
    } catch (error) {
        console.error("Error updating enrollment:", error);
        res.status(500).json({ success: false, error: "Failed to update enrollment", details: error.message });
    }
});

/**
 * GET /api/swimming/admin/schedules
 * Get batch schedule data for admin panel
 */
router.get("/admin/schedules", async (req, res) => {
    try {
        const [coaches] = await db.query(`
            SELECT
                sc.coach_id,
                sc.user_id,
                COALESCE(CONCAT(u.first_name, ' ', u.last_name), sc.name) AS coach_name,
                u.email,
                u.phone,
                sc.specialization,
                sc.availability,
                sc.max_students,
                sc.status
            FROM swimming_coaches sc
            LEFT JOIN user u ON u.user_id = sc.user_id
            ORDER BY coach_name
        `);

        res.json({
            success: true,
            schedules: coaches
        });

    } catch (error) {
        console.error("Error fetching schedules for admin:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch schedules",
            details: error.message
        });
    }
});

/**
 * POST /api/swimming/admin/coaches/sync-profiles
 * Re-sync all linked coach names from user profiles.
 */
router.post('/admin/coaches/sync-profiles', async (req, res) => {
    try {
        const result = await syncAllSwimmingCoachesFromUsers();
        res.json({
            success: true,
            message: 'Coach profiles synced from user accounts',
            ...result
        });
    } catch (error) {
        console.error('Error syncing coach profiles:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync coach profiles',
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/coach-eligible-users
 * Swimming instructors not yet linked to a coach profile.
 */
router.get('/admin/coach-eligible-users', async (req, res) => {
    try {
        const excludeCoachId = req.query.excludeCoachId ? Number(req.query.excludeCoachId) : null;

        let sql = `
            SELECT
                u.user_id,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                u.role
            FROM user u
            LEFT JOIN swimming_coaches sc ON sc.user_id = u.user_id
            WHERE u.role = 'swimming_instructor'
        `;
        const params = [];

        if (excludeCoachId) {
            sql += ` AND (sc.coach_id IS NULL OR sc.coach_id = ?)`;
            params.push(excludeCoachId);
        } else {
            sql += ` AND sc.coach_id IS NULL`;
        }

        sql += ` ORDER BY u.first_name ASC, u.last_name ASC`;

        const [users] = await db.query(sql, params);

        res.json({
            success: true,
            users: users.map((user) => ({
                userId: user.user_id,
                firstName: user.first_name,
                lastName: user.last_name,
                name: buildCoachDisplayName(user),
                email: user.email,
                phone: user.phone,
                role: user.role
            }))
        });
    } catch (error) {
        console.error('Error fetching coach-eligible users:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch eligible instructor accounts',
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/payments
 * Get all swimming-related payments with student info
 */
router.get("/admin/payments", async (req, res) => {
    try {
        const [payments] = await db.query(`
            SELECT 
                b.booking_id,
                b.booking_reference,
                CONCAT(se.first_name, ' ', se.last_name) as student_name,
                se.lesson_type,
                SUM(bi.unit_price * bi.quantity) as amount,
                b.payment_status as status,
                b.payment_method,
                b.created_at as booking_date
            FROM bookings b
            INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
            LEFT JOIN swimming_enrollments se ON b.booking_reference = se.booking_reference
            WHERE bi.item_type = 'Swimming'
            GROUP BY b.booking_id, b.booking_reference, student_name, se.lesson_type, b.payment_status, b.payment_method, b.created_at
            ORDER BY b.created_at DESC
        `);

        res.json({
            success: true,
            payments: payments
        });

    } catch (error) {
        console.error("Error fetching payments for admin:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch payments",
            details: error.message
        });
    }
});

/**
 * PUT /api/swimming/admin/students/:id/status
 * Update student enrollment status
 */
router.put("/admin/students/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'approved', 'active', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: "Invalid status. Must be one of: " + validStatuses.join(', ')
            });
        }

        await db.query(
            "UPDATE swimming_enrollments SET enrollment_status = ? WHERE enrollment_id = ?",
            [status, id]
        );

        const [[enrollment]] = await db.query(
            'SELECT batch_id FROM swimming_enrollments WHERE enrollment_id = ? LIMIT 1',
            [id]
        );

        if (enrollment?.batch_id) {
            const normalizedStatus = String(status || '').toLowerCase();
            if (['approved', 'active', 'completed'].includes(normalizedStatus)) {
                await incrementBatchBookedSlots(enrollment.batch_id);
            } else {
                await syncBatchStatus(enrollment.batch_id);
            }
        }

        res.json({
            success: true,
            message: "Enrollment status updated successfully"
        });

    } catch (error) {
        console.error("Error updating enrollment status:", error);
        res.status(500).json({
            success: false,
            error: "Failed to update enrollment status",
            details: error.message
        });
    }
});

/**
 * PUT /api/swimming/admin/students/:id/schedule
 * Assign or update a student's training schedule (dates, time, coach)
 * Requires: ADD_SCHEDULE_TO_SWIMMING_ENROLLMENTS.sql migration
 */
router.put("/admin/students/:id/schedule", async (req, res) => {
    try {
        const { id } = req.params;
        const { lesson_dates, lesson_time, assigned_coach } = req.body;

        if (!lesson_dates || !Array.isArray(lesson_dates) || lesson_dates.length === 0) {
            return res.status(400).json({ success: false, error: "At least one lesson date is required" });
        }
        if (!lesson_time) {
            return res.status(400).json({ success: false, error: "Lesson time is required" });
        }

        await db.query(
            `UPDATE swimming_enrollments
             SET admin_lesson_dates = ?, admin_lesson_time = ?, admin_assigned_coach = ?
             WHERE enrollment_id = ?`,
            [JSON.stringify(lesson_dates), lesson_time, assigned_coach || null, id]
        );

        res.json({ success: true, message: "Schedule updated successfully" });

    } catch (error) {
        console.error("Error updating student schedule:", error);
        res.status(500).json({
            success: false,
            error: "Failed to update schedule — ensure ADD_SCHEDULE_TO_SWIMMING_ENROLLMENTS.sql has been run",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/calendar/lessons
 * Get all swimming lessons with dates and times for calendar view
 * Returns lessons grouped with student and coach information
 * 
 * Relationships:
 * swimming_enrollments --[booking_reference]--> bookings --[booking_id]--> booking_items
 */
router.get("/admin/calendar/lessons", async (req, res) => {
    try {
        const [lessons] = await db.query(`
            SELECT
                se.enrollment_id,
                se.booking_reference,
                CONCAT(se.first_name, ' ', se.last_name) AS student_name,
                se.lesson_type,
                COALESCE(sc.name, se.admin_assigned_coach, se.preferred_coach) AS coach_name,
                se.admin_lesson_dates AS dates,
                se.admin_lesson_time AS time,
                se.enrollment_status,
                b.payment_status,
                b.booking_status,
                se.mobile_phone AS student_phone
            FROM swimming_enrollments se
            LEFT JOIN bookings b ON se.booking_reference = b.booking_reference
            LEFT JOIN swimming_coaches sc ON CAST(sc.coach_id AS CHAR) = se.admin_assigned_coach
            WHERE se.enrollment_status = 'Approved'
                AND se.admin_lesson_dates IS NOT NULL
            UNION ALL
            SELECT 
                se.enrollment_id,
                b.booking_reference,
                CONCAT(se.first_name, ' ', se.last_name) AS student_name,
                bi.item_name AS lesson_type,
                COALESCE(sc2.name, se.preferred_coach) AS coach_name,
                JSON_UNQUOTE(JSON_EXTRACT(bi.item_description, '$.dates')) AS dates,
                JSON_UNQUOTE(JSON_EXTRACT(bi.item_description, '$.time')) AS time,
                se.enrollment_status,
                b.payment_status,
                b.booking_status,
                se.mobile_phone AS student_phone
            FROM booking_items bi
            INNER JOIN bookings b ON bi.booking_id = b.booking_id
            INNER JOIN swimming_enrollments se ON se.booking_reference = b.booking_reference
            LEFT JOIN swimming_coaches sc2 ON CAST(sc2.coach_id AS CHAR) = se.preferred_coach
            WHERE bi.item_type = 'Swimming'
                AND bi.item_description IS NOT NULL
                AND b.booking_status IN ('Confirmed', 'Pending')
                AND se.enrollment_status = 'Approved'
                AND (se.admin_lesson_dates IS NULL OR se.admin_lesson_dates = '[]')
        `);

        // Transform the response to parse dates array
        const transformedLessons = lessons.map(lesson => {
            let datesArray = [];
            try {
                if (lesson.dates) {
                    datesArray = typeof lesson.dates === 'string' ? JSON.parse(lesson.dates) : lesson.dates;
                }
            } catch (e) {
                console.error('Error parsing dates for lesson:', lesson.enrollment_id, e);
            }

            return {
                item_id: lesson.enrollment_id,
                booking_id: lesson.booking_id || null,
                booking_reference: lesson.booking_reference,
                student_name: lesson.student_name,
                lesson_type: lesson.lesson_type,
                coach_name: lesson.coach_name,
                dates: datesArray,
                time: lesson.time,
                enrollment_status: lesson.enrollment_status,
                payment_status: lesson.payment_status,
                booking_status: lesson.booking_status,
                student_phone: lesson.student_phone
            };
        });

        res.json({
            success: true,
            lessons: transformedLessons,
            count: transformedLessons.length
        });

    } catch (error) {
        console.error("Error fetching calendar lessons for admin:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch calendar lessons",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/today-schedules
 * Get today's approved lesson schedule summary for the admin dashboard
 */
router.get("/admin/today-schedules", async (req, res) => {
    try {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayKey = `${yyyy}-${mm}-${dd}`;

        const [rows] = await db.query(`
            SELECT
                coach_name,
                batch_name,
                time,
                SUM(used_slots) AS used_slots,
                MAX(slots_total) AS slots_total
            FROM (
                SELECT
                    COALESCE(sc.name, se.admin_assigned_coach, se.preferred_coach) AS coach_name,
                    se.lesson_type AS batch_name,
                    se.admin_lesson_time AS time,
                    1 AS used_slots,
                    COALESCE(s.max_slots, 10) AS slots_total
                FROM swimming_enrollments se
                LEFT JOIN swimming_coaches sc ON CAST(sc.coach_id AS CHAR) = se.admin_assigned_coach
                LEFT JOIN swimming_batch_schedules s ON se.schedule_id = s.schedule_id
                WHERE se.enrollment_status = 'Approved'
                  AND se.admin_lesson_dates IS NOT NULL
                  AND JSON_CONTAINS(se.admin_lesson_dates, JSON_ARRAY(?), '$')
                UNION ALL
                SELECT
                    COALESCE(sc2.name, se.preferred_coach) AS coach_name,
                    se.lesson_type AS batch_name,
                    JSON_UNQUOTE(JSON_EXTRACT(bi.item_description, '$.time')) AS time,
                    1 AS used_slots,
                    10 AS slots_total
                FROM swimming_enrollments se
                INNER JOIN bookings b ON se.booking_reference = b.booking_reference
                INNER JOIN booking_items bi ON b.booking_id = bi.booking_id AND bi.item_type = 'Swimming'
                LEFT JOIN swimming_coaches sc2 ON CAST(sc2.coach_id AS CHAR) = se.preferred_coach
                WHERE se.enrollment_status = 'Approved'
                  AND bi.item_description IS NOT NULL
                  AND b.booking_status IN ('Confirmed', 'Pending')
                  AND (se.admin_lesson_dates IS NULL OR se.admin_lesson_dates = '[]')
                  AND JSON_CONTAINS(bi.item_description, JSON_ARRAY(?), '$.dates')
            ) AS today_data
            GROUP BY coach_name, batch_name, time
            ORDER BY time ASC
        `, [todayKey, todayKey]);

        const schedules = rows.map(row => ({
            time: row.time || 'TBD',
            batch: row.batch_name || 'General',
            coach: row.coach_name || 'Unassigned',
            slotsUsed: Number(row.used_slots) || 0,
            slotsTotal: Number(row.slots_total) || 10,
            slotsFull: Number(row.used_slots) >= (Number(row.slots_total) || 10)
        }));

        res.json({ success: true, schedules, count: schedules.length });
    } catch (error) {
        console.error("Error fetching today's schedules for admin:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch today's schedules",
            details: error.message
        });
    }
});

/**
 * DELETE /api/swimming/admin/students/:id
 * Delete a student enrollment
 */
router.delete("/admin/students/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            "DELETE FROM swimming_enrollments WHERE enrollment_id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: "Student enrollment not found"
            });
        }

        res.json({
            success: true,
            message: "Student enrollment deleted successfully"
        });

    } catch (error) {
        console.error("Error deleting student enrollment:", error);
        res.status(500).json({
            success: false,
            error: "Failed to delete student enrollment",
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/attendance
 * Staff-only attendance records from swimming_attendance.
 */
router.get('/admin/attendance', async (req, res) => {
    try {
        const { whereSql, params } = buildAttendanceFilterClause(req.query);

        const [records] = await db.query(
            `
            SELECT
                a.attendance_id,
                a.attendance_date,
                a.status,
                a.remarks,
                a.created_at,
                a.updated_at,
                a.enrollment_id,
                a.schedule_id,
                COALESCE(s.batch_id, e.batch_id) AS batch_id,
                a.coach_id,
                CONCAT(e.first_name, ' ', e.last_name) AS student_name,
                e.booking_reference,
                e.lesson_type,
                b.batch_name,
                c.name AS coach_name,
                s.class_period,
                s.start_time,
                s.end_time
            FROM swimming_attendance a
            LEFT JOIN swimming_enrollments e ON e.enrollment_id = a.enrollment_id
            LEFT JOIN swimming_batches b ON b.batch_id = COALESCE(s.batch_id, e.batch_id)
            LEFT JOIN swimming_coaches c ON c.coach_id = a.coach_id
            LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
            ${whereSql}
            ORDER BY a.attendance_date DESC, a.created_at DESC
            LIMIT 1000
            `,
            params
        );

        res.json({
            success: true,
            records: records.map((row) => ({
                attendanceId: row.attendance_id,
                sessionDate: row.attendance_date,
                status: row.status,
                remarks: row.remarks || '',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                enrollmentId: row.enrollment_id,
                scheduleId: row.schedule_id,
                batchId: row.batch_id,
                coachId: row.coach_id,
                student: row.student_name || 'Unknown',
                bookingReference: row.booking_reference || '',
                lessonType: row.lesson_type || '',
                batch: row.batch_name || 'General',
                coach: row.coach_name || 'Unassigned',
                recordedBy: row.coach_name || 'Unassigned',
                recordedDate: row.updated_at || row.created_at,
                classPeriod: row.class_period || '',
                startTime: row.start_time,
                endTime: row.end_time
            }))
        });
    } catch (error) {
        console.error('Error fetching admin attendance records:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendance records',
            details: error.message
        });
    }
});

/**
 * GET /api/swimming/admin/attendance-summary
 * Staff-only attendance metrics.
 */
router.get('/admin/attendance-summary', async (req, res) => {
    try {
        const { whereSql, params } = buildAttendanceFilterClause(req.query);

        const [[totals]] = await db.query(
            `
            SELECT
                COUNT(*) AS total_sessions,
                SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
            FROM swimming_attendance a
            LEFT JOIN swimming_enrollments e ON e.enrollment_id = a.enrollment_id
            LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
            ${whereSql}
            `,
            params
        );

        const [byBatch] = await db.query(
            `
            SELECT
                COALESCE(b.batch_name, 'General') AS batch_name,
                COUNT(*) AS total,
                SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
            FROM swimming_attendance a
            LEFT JOIN swimming_enrollments e ON e.enrollment_id = a.enrollment_id
            LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
            LEFT JOIN swimming_batches b ON b.batch_id = COALESCE(s.batch_id, e.batch_id)
            ${whereSql}
            GROUP BY COALESCE(b.batch_name, 'General')
            ORDER BY total DESC
            LIMIT 20
            `,
            params
        );

        const [byCoach] = await db.query(
            `
            SELECT
                COALESCE(c.name, 'Unassigned') AS coach_name,
                a.coach_id,
                COUNT(*) AS total,
                SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
            FROM swimming_attendance a
            LEFT JOIN swimming_enrollments e ON e.enrollment_id = a.enrollment_id
            LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
            LEFT JOIN swimming_coaches c ON c.coach_id = a.coach_id
            ${whereSql}
            GROUP BY a.coach_id, COALESCE(c.name, 'Unassigned')
            ORDER BY total DESC
            LIMIT 20
            `,
            params
        );

        const totalSessions = Number(totals?.total_sessions || 0);
        const pct = (count) => totalSessions > 0
            ? Number(((Number(count || 0) / totalSessions) * 100).toFixed(1))
            : 0;

        const mapBreakdown = (rows) => rows.map((row) => {
            const total = Number(row.total || 0);
            const toPct = (count) => total > 0 ? Number(((Number(count || 0) / total) * 100).toFixed(1)) : 0;
            return {
                label: row.batch_name || row.coach_name || 'N/A',
                coachId: row.coach_id || null,
                total,
                presentPct: toPct(row.present_count),
                absentPct: toPct(row.absent_count),
                latePct: toPct(row.late_count),
                excusedPct: toPct(row.excused_count)
            };
        });

        res.json({
            success: true,
            summary: {
                totalSessions,
                presentPct: pct(totals?.present_count),
                absentPct: pct(totals?.absent_count),
                latePct: pct(totals?.late_count),
                excusedPct: pct(totals?.excused_count),
                presentCount: Number(totals?.present_count || 0),
                absentCount: Number(totals?.absent_count || 0),
                lateCount: Number(totals?.late_count || 0),
                excusedCount: Number(totals?.excused_count || 0),
                byBatch: mapBreakdown(byBatch),
                byCoach: mapBreakdown(byCoach)
            }
        });
    } catch (error) {
        console.error('Error fetching admin attendance summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendance summary',
            details: error.message
        });
    }
});

export default router;
