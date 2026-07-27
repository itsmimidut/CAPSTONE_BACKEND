import { db } from '../config/db.js';

const APPROVED_STATUSES = ['Approved', 'Enrolled', 'Completed'];

const parseInstructorDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const text = String(value).trim();
    if (!text) return null;
    const parsed = text.includes('T') || text.includes('GMT')
        ? new Date(text)
        : new Date(`${text.slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatInstructorDate = (value) => {
    const date = parseInstructorDate(value);
    if (!date) return value ? String(value).slice(0, 10) : 'TBD';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

const formatInstructorDateRange = (startValue, endValue) => {
    const start = formatInstructorDate(startValue);
    const end = formatInstructorDate(endValue);
    if (start === 'TBD' && end === 'TBD') return 'TBD';
    if (start === end) return start;
    return `${start} - ${end}`;
};

const SORT_COLUMNS = {
    name: 'e.last_name ASC, e.first_name ASC',
    batch: 'b.batch_name ASC, e.last_name ASC',
    enrolled_at: 'e.created_at DESC',
};

const buildCoachOwnershipClause = () => '(e.coach_id = ? OR s.coach_id = ?)';

export async function getCoachByUserId(userId) {
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

export async function assertEnrollmentBelongsToCoach(enrollmentId, coachId) {
    const [rows] = await db.query(
        `SELECT e.enrollment_id
         FROM swimming_enrollments e
         LEFT JOIN swimming_batch_schedules s ON s.schedule_id = e.schedule_id
         WHERE e.enrollment_id = ?
           AND (e.coach_id = ? OR s.coach_id = ?)
         LIMIT 1`,
        [enrollmentId, coachId, coachId]
    );

    return rows.length > 0;
}

export async function assertBatchBelongsToCoach(batchId, coachId) {
    const [rows] = await db.query(
        `SELECT s.batch_id
         FROM swimming_batch_schedules s
         WHERE s.batch_id = ? AND s.coach_id = ?
         LIMIT 1`,
        [batchId, coachId]
    );

    return rows.length > 0;
}

export async function assertScheduleBelongsToCoach(scheduleId, coachId) {
    const [rows] = await db.query(
        `SELECT schedule_id
         FROM swimming_batch_schedules
         WHERE schedule_id = ? AND coach_id = ?
         LIMIT 1`,
        [scheduleId, coachId]
    );

    return rows.length > 0;
}

function normalizeSortDir(value = 'asc') {
    return String(value).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
}

function buildStudentFilterClauses(options = {}) {
    const clauses = [];
    const params = [];

    if (options.search) {
        const term = `%${String(options.search).trim()}%`;
        clauses.push(`(
            e.first_name LIKE ?
            OR e.last_name LIKE ?
            OR e.email LIKE ?
            OR e.booking_reference LIKE ?
            OR CONCAT(e.first_name, ' ', e.last_name) LIKE ?
        )`);
        params.push(term, term, term, term, term);
    }

    if (options.batchId) {
        clauses.push('e.batch_id = ?');
        params.push(Number(options.batchId));
    }

    if (options.scheduleId) {
        clauses.push('e.schedule_id = ?');
        params.push(Number(options.scheduleId));
    }

    if (options.enrollmentStatus) {
        if (String(options.enrollmentStatus) === 'Approved') {
            clauses.push("e.enrollment_status IN ('Approved', 'Enrolled')");
        } else {
            clauses.push('e.enrollment_status = ?');
            params.push(String(options.enrollmentStatus));
        }
    }

    const filterSql = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    return { filterSql, params };
}

function buildOrderClause(sortBy = 'name', sortDir = 'asc') {
    const column = SORT_COLUMNS[sortBy] || SORT_COLUMNS.name;
    if (sortBy === 'enrolled_at') {
        return `ORDER BY e.created_at ${normalizeSortDir(sortDir)}`;
    }
    if (sortBy === 'batch') {
        return `ORDER BY b.batch_name ${normalizeSortDir(sortDir)}, e.last_name ASC, e.first_name ASC`;
    }
    const direction = normalizeSortDir(sortDir);
    return `ORDER BY e.last_name ${direction}, e.first_name ${direction}`;
}

function mapStudentRow(row) {
    const sessionsRecorded = Number(row.sessions_recorded || 0);
    const presentCount = Number(row.present_count || 0);

    return {
        enrollment_id: row.enrollment_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        mobile_phone: row.mobile_phone,
        booking_reference: row.booking_reference,
        batch_id: row.batch_id,
        schedule_id: row.schedule_id,
        batch_name: row.batch_name || 'Unassigned',
        lesson_type: row.lesson_type || 'Lesson',
        class_period: row.class_period,
        start_time: row.start_time,
        end_time: row.end_time,
        start_date: row.start_date,
        end_date: row.end_date,
        enrollment_status: row.enrollment_status,
        payment_status: row.payment_status,
        attendance_summary: {
            sessions_recorded: sessionsRecorded,
            present: presentCount,
            absent: Number(row.absent_count || 0),
            late: Number(row.late_count || 0),
            excused: Number(row.excused_count || 0),
            attendance_rate: sessionsRecorded
                ? Math.round((presentCount / sessionsRecorded) * 100)
                : 0,
        },
    };
}

export async function getStudentsForCoach(coachId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;

    if (options.batchId) {
        const batchOwned = await assertBatchBelongsToCoach(options.batchId, coachId);
        if (!batchOwned) {
            return { forbidden: true, message: 'Forbidden: batch is not assigned to your coach profile.' };
        }
    }

    if (options.scheduleId) {
        const scheduleOwned = await assertScheduleBelongsToCoach(options.scheduleId, coachId);
        if (!scheduleOwned) {
            return { forbidden: true, message: 'Forbidden: schedule is not assigned to your coach profile.' };
        }
    }

    const { filterSql, params: filterParams } = buildStudentFilterClauses(options);
    const ownershipParams = [coachId, coachId];
    const orderClause = buildOrderClause(options.sortBy, options.sortDir);

    const baseJoins = `
        FROM swimming_enrollments e
        LEFT JOIN swimming_batch_schedules s ON s.schedule_id = e.schedule_id
        LEFT JOIN swimming_batches b ON b.batch_id = e.batch_id
    `;

    const baseWhere = `
        WHERE ${buildCoachOwnershipClause()}
        ${filterSql}
    `;

    const attendanceJoin = `
        LEFT JOIN (
            SELECT
                enrollment_id,
                COUNT(attendance_id) AS sessions_recorded,
                SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
            FROM swimming_attendance
            GROUP BY enrollment_id
        ) att ON att.enrollment_id = e.enrollment_id
    `;

    const [[{ total }]] = await db.query(
        `SELECT COUNT(DISTINCT e.enrollment_id) AS total ${baseJoins} ${baseWhere}`,
        [...ownershipParams, ...filterParams]
    );

    const [rows] = await db.query(
        `SELECT
            e.enrollment_id,
            e.first_name,
            e.last_name,
            e.email,
            e.mobile_phone,
            e.booking_reference,
            e.batch_id,
            e.schedule_id,
            e.enrollment_status,
            e.payment_status,
            b.batch_name,
            b.lesson_type,
            b.start_date,
            b.end_date,
            s.class_period,
            s.start_time,
            s.end_time,
            COALESCE(att.sessions_recorded, 0) AS sessions_recorded,
            COALESCE(att.present_count, 0) AS present_count,
            COALESCE(att.absent_count, 0) AS absent_count,
            COALESCE(att.late_count, 0) AS late_count,
            COALESCE(att.excused_count, 0) AS excused_count
        ${baseJoins}
        ${attendanceJoin}
        ${baseWhere}
        ${orderClause}
        LIMIT ? OFFSET ?`,
        [...ownershipParams, ...filterParams, limit, offset]
    );

    const [[summaryRow]] = await db.query(
        `SELECT
            COUNT(DISTINCT e.enrollment_id) AS total_students,
            COUNT(DISTINCT CASE
                WHEN e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                THEN e.enrollment_id
            END) AS approved_count,
            COUNT(DISTINCT CASE
                WHEN e.enrollment_status = 'Pending'
                THEN e.enrollment_id
            END) AS pending_count
        ${baseJoins}
        ${baseWhere}`,
        [...ownershipParams, ...filterParams]
    );

    const [[capacityRow]] = await db.query(
        `SELECT COALESCE(SUM(s.max_slots), 0) AS total_capacity
         FROM swimming_batch_schedules s
         WHERE s.coach_id = ?`,
        [coachId]
    );

    const approvedCount = Number(summaryRow?.approved_count || 0);
    const totalCapacity = Number(capacityRow?.total_capacity || 0);

    return {
        students: rows.map(mapStudentRow),
        pagination: {
            page,
            limit,
            total: Number(total || 0),
            totalPages: Math.ceil(Number(total || 0) / limit) || 0,
        },
        summary: {
            total: Number(summaryRow?.total_students || 0),
            approved: approvedCount,
            pending: Number(summaryRow?.pending_count || 0),
            availableSlots: Math.max(0, totalCapacity - approvedCount),
        },
    };
}

export async function getStudentDetail(enrollmentId, coachId) {
    const owned = await assertEnrollmentBelongsToCoach(enrollmentId, coachId);
    if (!owned) {
        return { forbidden: true };
    }

    const [rows] = await db.query(
        `SELECT
            e.enrollment_id,
            e.first_name,
            e.last_name,
            e.email,
            e.mobile_phone,
            e.address,
            e.booking_reference,
            e.father_name,
            e.mother_name,
            e.emergency_contact_name,
            e.emergency_contact_phone,
            e.batch_id,
            e.schedule_id,
            e.enrollment_status,
            e.payment_status,
            e.lesson_type,
            e.skill_level,
            e.created_at,
            b.batch_name,
            b.start_date,
            b.end_date,
            s.class_period,
            s.start_time,
            s.end_time,
            COALESCE(att.sessions_recorded, 0) AS sessions_recorded,
            COALESCE(att.present_count, 0) AS present_count,
            COALESCE(att.absent_count, 0) AS absent_count,
            COALESCE(att.late_count, 0) AS late_count,
            COALESCE(att.excused_count, 0) AS excused_count
         FROM swimming_enrollments e
         LEFT JOIN swimming_batch_schedules s ON s.schedule_id = e.schedule_id
         LEFT JOIN swimming_batches b ON b.batch_id = e.batch_id
         LEFT JOIN (
            SELECT
                enrollment_id,
                COUNT(attendance_id) AS sessions_recorded,
                SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
            FROM swimming_attendance
            GROUP BY enrollment_id
         ) att ON att.enrollment_id = e.enrollment_id
         WHERE e.enrollment_id = ?
         LIMIT 1`,
        [enrollmentId]
    );

    if (!rows.length) {
        return { notFound: true };
    }

    const row = rows[0];
    const guardianName = row.emergency_contact_name
        || [row.father_name, row.mother_name].filter(Boolean).join(' / ')
        || '';

    return {
        student: {
            ...mapStudentRow(row),
            address: row.address || '',
            guardian_name: guardianName,
            contact_number: row.emergency_contact_phone || row.mobile_phone || '',
            skill_level: row.skill_level || '',
            enrolled_at: row.created_at,
            days: row.start_date && row.end_date
                ? formatInstructorDateRange(row.start_date, row.end_date)
                : 'TBD',
        },
    };
}

export async function getStudentAttendance(enrollmentId, coachId) {
    const owned = await assertEnrollmentBelongsToCoach(enrollmentId, coachId);
    if (!owned) {
        return { forbidden: true };
    }

    const [rows] = await db.query(
        `SELECT
            a.attendance_id,
            a.attendance_date,
            a.status,
            a.remarks,
            a.schedule_id,
            s.batch_id,
            s.class_period,
            s.start_time,
            s.end_time,
            b.batch_name
         FROM swimming_attendance a
         LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
         LEFT JOIN swimming_batches b ON b.batch_id = s.batch_id
         WHERE a.enrollment_id = ?
         ORDER BY a.attendance_date DESC, a.attendance_id DESC`,
        [enrollmentId]
    );

    const summary = rows.reduce(
        (acc, row) => {
            const status = String(row.status || '').toLowerCase();
            if (status === 'present') acc.present += 1;
            else if (status === 'absent') acc.absent += 1;
            else if (status === 'late') acc.late += 1;
            else if (status === 'excused') acc.excused += 1;
            return acc;
        },
        { present: 0, absent: 0, late: 0, excused: 0 }
    );

    const [studentRows] = await db.query(
        `SELECT CONCAT(first_name, ' ', last_name) AS student_name
         FROM swimming_enrollments
         WHERE enrollment_id = ?
         LIMIT 1`,
        [enrollmentId]
    );

    return {
        enrollment_id: enrollmentId,
        student_name: studentRows[0]?.student_name || '',
        records: rows,
        summary,
    };
}

function buildScheduleFilterClauses(options = {}) {
    const clauses = [];
    const params = [];

    if (options.date) {
        clauses.push('? BETWEEN b.start_date AND b.end_date');
        params.push(String(options.date));
    }

    if (options.batchId) {
        clauses.push('s.batch_id = ?');
        params.push(Number(options.batchId));
    }

    if (options.status) {
        const status = String(options.status);
        if (status === 'Upcoming') {
            clauses.push("(s.status = 'Open' OR LOWER(b.status) IN ('open', 'active', 'filling'))");
        } else if (status === 'Completed') {
            clauses.push("(s.status = 'Closed' OR LOWER(b.status) IN ('completed', 'closed', 'done'))");
        } else if (status === 'Ongoing') {
            clauses.push("(LOWER(b.status) IN ('active', 'ongoing') OR s.status = 'Full')");
        } else if (status === 'Cancelled') {
            clauses.push("LOWER(b.status) LIKE '%cancel%'");
        }
    }

    if (options.period) {
        clauses.push('s.class_period = ?');
        params.push(String(options.period));
    }

    if (options.search) {
        const term = `%${String(options.search).trim()}%`;
        clauses.push('(b.batch_name LIKE ? OR b.lesson_type LIKE ?)');
        params.push(term, term);
    }

    const filterSql = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    return { filterSql, params };
}

function buildBatchFilterClauses(options = {}) {
    const clauses = [];
    const params = [];

    if (options.search) {
        const term = `%${String(options.search).trim()}%`;
        clauses.push('(b.batch_name LIKE ? OR b.lesson_type LIKE ?)');
        params.push(term, term);
    }

    if (options.status) {
        const status = String(options.status);
        if (status === 'Active') {
            clauses.push("LOWER(b.status) IN ('open', 'active', 'ongoing')");
        } else if (status === 'Upcoming') {
            clauses.push("LOWER(b.status) IN ('filling', 'upcoming')");
        } else if (status === 'Completed') {
            clauses.push("LOWER(b.status) IN ('completed', 'closed', 'done')");
        } else if (status === 'Cancelled') {
            clauses.push("LOWER(b.status) LIKE '%cancel%'");
        }
    }

    const filterSql = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    return { filterSql, params };
}

function mapScheduleRow(row) {
    return {
        schedule_id: row.schedule_id,
        batch_id: row.batch_id,
        coach_id: row.coach_id,
        class_period: row.class_period,
        start_time: row.start_time,
        end_time: row.end_time,
        max_slots: Number(row.max_slots || 0),
        status: row.status,
        schedule_status: row.status,
        batch_name: row.batch_name,
        lesson_type: row.lesson_type,
        start_date: row.start_date,
        end_date: row.end_date,
        batch_status: row.batch_status,
        coach_name: row.coach_name,
        used_slots: Number(row.used_slots || 0),
    };
}

function mapBatchRow(row) {
    return {
        batch_id: row.batch_id,
        batch_name: row.batch_name,
        lesson_type: row.lesson_type,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        schedule_count: Number(row.schedule_count || 0),
        schedule_capacity: Number(row.schedule_capacity || 0),
        enrolled_count: Number(row.enrolled_count || 0),
        class_period: row.class_period || null,
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        coach_name: row.coach_name || null,
    };
}

export async function getDashboardSummary(coachId) {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    const [[studentRow]] = await db.query(
        `SELECT COUNT(DISTINCT e.enrollment_id) AS total_students
         FROM swimming_enrollments e
         LEFT JOIN swimming_batch_schedules s ON s.schedule_id = e.schedule_id
         WHERE (e.coach_id = ? OR s.coach_id = ?)
           AND e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')`,
        [coachId, coachId]
    );

    const [[batchRow]] = await db.query(
        `SELECT COUNT(DISTINCT b.batch_id) AS active_batches
         FROM swimming_batches b
         INNER JOIN swimming_batch_schedules s ON s.batch_id = b.batch_id AND s.coach_id = ?
         WHERE LOWER(b.status) IN ('open', 'active', 'filling', 'ongoing')`,
        [coachId]
    );

    const [[todayRow]] = await db.query(
        `SELECT COUNT(DISTINCT s.schedule_id) AS today_classes
         FROM swimming_batch_schedules s
         INNER JOIN swimming_batches b ON b.batch_id = s.batch_id
         WHERE s.coach_id = ?
           AND ? BETWEEN b.start_date AND b.end_date`,
        [coachId, today]
    );

    const [[attendanceRow]] = await db.query(
        `SELECT
            COUNT(*) AS total_records,
            SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present_count
         FROM swimming_attendance
         WHERE coach_id = ?`,
        [coachId]
    );

    const [[completedRow]] = await db.query(
        `SELECT COUNT(DISTINCT CONCAT(attendance_date, '-', schedule_id)) AS completed_lessons
         FROM swimming_attendance
         WHERE coach_id = ?
           AND attendance_date >= ?`,
        [coachId, monthStart]
    );

    const totalStudents = Number(studentRow?.total_students || 0);
    const activeBatches = Number(batchRow?.active_batches || 0);
    const todayClasses = Number(todayRow?.today_classes || 0);
    const totalRecords = Number(attendanceRow?.total_records || 0);
    const presentCount = Number(attendanceRow?.present_count || 0);
    const attendanceRate = totalRecords
        ? Math.round((presentCount / totalRecords) * 100)
        : 0;
    const completedLessons = Number(completedRow?.completed_lessons || 0);

    return {
        totalStudents,
        activeBatches,
        todayClasses,
        attendanceRate,
        assignedStudents: totalStudents,
        assigned_students: totalStudents,
        active_batches: activeBatches,
        today_classes: todayClasses,
        pendingAttendance: todayClasses,
        pending_attendance: todayClasses,
        completedLessons,
        completed_lessons: completedLessons,
    };
}

export async function getCoachSchedules(coachId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;

    if (options.batchId) {
        const batchOwned = await assertBatchBelongsToCoach(options.batchId, coachId);
        if (!batchOwned) {
            return { forbidden: true, message: 'Forbidden: batch is not assigned to your coach profile.' };
        }
    }

    const { filterSql, params: filterParams } = buildScheduleFilterClauses(options);
    const baseFrom = `
        FROM swimming_batch_schedules s
        INNER JOIN swimming_batches b ON b.batch_id = s.batch_id
        LEFT JOIN swimming_coaches c ON c.coach_id = s.coach_id
        LEFT JOIN swimming_enrollments e ON e.schedule_id = s.schedule_id
        WHERE s.coach_id = ?
        ${filterSql}
    `;

    const [[{ total }]] = await db.query(
        `SELECT COUNT(DISTINCT s.schedule_id) AS total ${baseFrom}`,
        [coachId, ...filterParams]
    );

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
        ${baseFrom}
        GROUP BY s.schedule_id
        ORDER BY b.start_date ASC, s.start_time ASC
        LIMIT ? OFFSET ?`,
        [coachId, ...filterParams, limit, offset]
    );

    return {
        schedules: rows.map(mapScheduleRow),
        pagination: {
            page,
            limit,
            total: Number(total || 0),
            totalPages: Math.ceil(Number(total || 0) / limit) || 0,
        },
    };
}

export async function getCoachBatches(coachId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;

    const { filterSql, params: filterParams } = buildBatchFilterClauses(options);
    const baseFrom = `
        FROM swimming_batches b
        INNER JOIN swimming_batch_schedules s ON s.batch_id = b.batch_id AND s.coach_id = ?
        LEFT JOIN swimming_enrollments e ON e.schedule_id = s.schedule_id
        WHERE 1=1
        ${filterSql}
    `;

    const [[{ total }]] = await db.query(
        `SELECT COUNT(DISTINCT b.batch_id) AS total ${baseFrom}`,
        [coachId, ...filterParams]
    );

    const [rows] = await db.query(
        `SELECT
            b.batch_id,
            b.batch_name,
            b.lesson_type,
            b.start_date,
            b.end_date,
            b.status,
            MIN(s.class_period) AS class_period,
            MIN(s.start_time) AS start_time,
            MIN(s.end_time) AS end_time,
            COUNT(DISTINCT s.schedule_id) AS schedule_count,
            COALESCE(SUM(s.max_slots), 0) AS schedule_capacity,
            COUNT(DISTINCT CASE
                WHEN e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
                THEN e.enrollment_id
            END) AS enrolled_count
        ${baseFrom}
        GROUP BY b.batch_id
        ORDER BY b.start_date DESC
        LIMIT ? OFFSET ?`,
        [coachId, ...filterParams, limit, offset]
    );

    const [[summaryRow]] = await db.query(
        `SELECT
            COUNT(DISTINCT b.batch_id) AS total_batches,
            COUNT(DISTINCT CASE
                WHEN LOWER(b.status) IN ('open', 'active', 'ongoing')
                THEN b.batch_id
            END) AS active_count,
            COUNT(DISTINCT CASE
                WHEN LOWER(b.status) IN ('filling', 'upcoming')
                THEN b.batch_id
            END) AS upcoming_count
        ${baseFrom}`,
        [coachId, ...filterParams]
    );

    const [[studentCountRow]] = await db.query(
        `SELECT COUNT(DISTINCT e.enrollment_id) AS total_students
         FROM swimming_enrollments e
         LEFT JOIN swimming_batch_schedules s ON s.schedule_id = e.schedule_id
         WHERE (e.coach_id = ? OR s.coach_id = ?)
           AND e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')`,
        [coachId, coachId]
    );

    const [[capacityRow]] = await db.query(
        `SELECT COALESCE(SUM(max_slots), 0) AS total_capacity
         FROM swimming_batch_schedules
         WHERE coach_id = ?`,
        [coachId]
    );

    const totalStudents = Number(studentCountRow?.total_students || 0);
    const totalCapacity = Number(capacityRow?.total_capacity || 0);

    return {
        batches: rows.map(mapBatchRow),
        pagination: {
            page,
            limit,
            total: Number(total || 0),
            totalPages: Math.ceil(Number(total || 0) / limit) || 0,
        },
        summary: {
            active: Number(summaryRow?.active_count || 0),
            upcoming: Number(summaryRow?.upcoming_count || 0),
            totalStudents,
            availableSlots: Math.max(0, totalCapacity - totalStudents),
        },
    };
}

const VALID_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

function mapAttendanceHistoryRow(row) {
    return {
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
        status: 'Saved',
    };
}

function buildAttendanceHistoryFilterClauses(options = {}) {
    const clauses = [];
    const params = [];

    if (options.date) {
        clauses.push('a.attendance_date = ?');
        params.push(String(options.date));
    }

    if (options.batchId) {
        clauses.push('s.batch_id = ?');
        params.push(Number(options.batchId));
    }

    if (options.search) {
        const term = `%${String(options.search).trim()}%`;
        clauses.push(`EXISTS (
            SELECT 1
            FROM swimming_enrollments e
            WHERE e.enrollment_id = a.enrollment_id
              AND (
                e.first_name LIKE ?
                OR e.last_name LIKE ?
                OR CONCAT(e.first_name, ' ', e.last_name) LIKE ?
              )
        )`);
        params.push(term, term, term);
    }

    const filterSql = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    return { filterSql, params };
}

export async function getAttendanceClasses(coachId, options = {}) {
    const date = options.date || new Date().toISOString().slice(0, 10);

    if (options.batchId) {
        const batchOwned = await assertBatchBelongsToCoach(options.batchId, coachId);
        if (!batchOwned) {
            return { forbidden: true, message: 'Forbidden: batch is not assigned to your coach profile.' };
        }
    }

    const { filterSql, params: filterParams } = buildScheduleFilterClauses({
        date,
        batchId: options.batchId,
        status: options.status,
        period: options.period,
    });

    const baseFrom = `
        FROM swimming_batch_schedules s
        INNER JOIN swimming_batches b ON b.batch_id = s.batch_id
        LEFT JOIN swimming_coaches c ON c.coach_id = s.coach_id
        LEFT JOIN swimming_enrollments e ON e.schedule_id = s.schedule_id
        WHERE s.coach_id = ?
        ${filterSql}
    `;

    const [scheduleRows] = await db.query(
        `SELECT
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
        ${baseFrom}
        GROUP BY s.schedule_id
        ORDER BY s.start_time ASC`,
        [coachId, ...filterParams]
    );

    if (!scheduleRows.length) {
        return { date, classes: [] };
    }

    const scheduleIds = scheduleRows.map((row) => row.schedule_id);

    const [studentRows] = await db.query(
        `SELECT
            e.enrollment_id,
            e.first_name,
            e.last_name,
            e.email,
            e.schedule_id,
            e.batch_id,
            b.batch_name,
            b.lesson_type
         FROM swimming_enrollments e
         LEFT JOIN swimming_batches b ON b.batch_id = e.batch_id
         WHERE e.schedule_id IN (?)
           AND e.enrollment_status IN ('Approved', 'Enrolled', 'Completed')
         ORDER BY e.last_name ASC, e.first_name ASC`,
        [scheduleIds]
    );

    const [attendanceRows] = await db.query(
        `SELECT
            attendance_id,
            enrollment_id,
            schedule_id,
            status,
            remarks
         FROM swimming_attendance
         WHERE coach_id = ?
           AND attendance_date = ?
           AND schedule_id IN (?)`,
        [coachId, date, scheduleIds]
    );

    const attendanceByEnrollment = new Map(
        attendanceRows.map((row) => [
            `${row.schedule_id}-${row.enrollment_id}`,
            row,
        ])
    );

    const studentsBySchedule = new Map();
    studentRows.forEach((student) => {
        const key = student.schedule_id;
        if (!studentsBySchedule.has(key)) {
            studentsBySchedule.set(key, []);
        }

        const attendance = attendanceByEnrollment.get(`${student.schedule_id}-${student.enrollment_id}`);
        studentsBySchedule.get(key).push({
            enrollment_id: student.enrollment_id,
            first_name: student.first_name,
            last_name: student.last_name,
            email: student.email,
            batch_name: student.batch_name || '',
            lesson_type: student.lesson_type || '',
            attendance_id: attendance?.attendance_id || null,
            attendance_status: attendance?.status || '',
            remarks: attendance?.remarks || '',
        });
    });

    const classes = scheduleRows.map((row) => {
        const students = studentsBySchedule.get(row.schedule_id) || [];
        const present = students.filter((s) => s.attendance_status === 'Present').length;
        const late = students.filter((s) => s.attendance_status === 'Late').length;
        const absent = students.filter((s) => s.attendance_status === 'Absent').length;
        const excused = students.filter((s) => s.attendance_status === 'Excused').length;
        const total = Number(row.used_slots || students.length || 1);

        return {
            ...mapScheduleRow(row),
            schedule_date: date,
            students_count: Number(row.used_slots || students.length || 0),
            attendance: {
                present,
                late,
                absent,
                excused,
                rate: Math.round(((present + late) / total) * 1000) / 10,
            },
            students,
        };
    });

    return { date, classes };
}

export async function getAttendanceHistory(coachId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;

    if (options.batchId) {
        const batchOwned = await assertBatchBelongsToCoach(options.batchId, coachId);
        if (!batchOwned) {
            return { forbidden: true, message: 'Forbidden: batch is not assigned to your coach profile.' };
        }
    }

    const { filterSql, params: filterParams } = buildAttendanceHistoryFilterClauses(options);
    const baseFrom = `
        FROM swimming_attendance a
        LEFT JOIN swimming_batch_schedules s ON s.schedule_id = a.schedule_id
        LEFT JOIN swimming_batches b ON b.batch_id = s.batch_id
        WHERE a.coach_id = ?
        ${filterSql}
    `;

    const groupBy = `
        GROUP BY
            a.attendance_date,
            a.schedule_id,
            s.batch_id,
            b.batch_name,
            b.lesson_type,
            s.class_period,
            s.start_time,
            s.end_time
    `;

    const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total
         FROM (
            SELECT a.attendance_date, a.schedule_id
            ${baseFrom}
            ${groupBy}
         ) grouped`,
        [coachId, ...filterParams]
    );

    const [rows] = await db.query(
        `SELECT
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
        ${baseFrom}
        ${groupBy}
        ORDER BY a.attendance_date DESC, s.start_time DESC
        LIMIT ? OFFSET ?`,
        [coachId, ...filterParams, limit, offset]
    );

    return {
        history: rows.map(mapAttendanceHistoryRow),
        pagination: {
            page,
            limit,
            total: Number(total || 0),
            totalPages: Math.ceil(Number(total || 0) / limit) || 0,
        },
    };
}

export async function saveAttendance(coachId, payload = {}) {
    const {
        schedule_id: scheduleId,
        batch_id: batchId,
        attendance_date: attendanceDate,
        records = [],
    } = payload;

    if (!scheduleId || !attendanceDate || !Array.isArray(records)) {
        return { badRequest: true, message: 'Missing required attendance fields.' };
    }

    const scheduleOwned = await assertScheduleBelongsToCoach(scheduleId, coachId);
    if (!scheduleOwned) {
        return { forbidden: true, message: 'Forbidden: you can only submit attendance for your assigned classes.' };
    }

    const [scheduleRows] = await db.query(
        `SELECT schedule_id, coach_id, batch_id
         FROM swimming_batch_schedules
         WHERE schedule_id = ?
         LIMIT 1`,
        [scheduleId]
    );

    if (!scheduleRows.length) {
        return { notFound: true, message: 'Schedule not found.' };
    }

    const schedule = scheduleRows[0];
    const resolvedBatchId = batchId || schedule.batch_id || null;

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        for (const record of records) {
            const status = record.status || record.attendance_status || 'Present';
            if (!VALID_ATTENDANCE_STATUSES.includes(status)) {
                await connection.rollback();
                return { badRequest: true, message: `Invalid attendance status: ${status}` };
            }

            await connection.query(
                `INSERT INTO swimming_attendance (
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
                    updated_at = NOW()`,
                [
                    coachId,
                    scheduleId,
                    resolvedBatchId,
                    record.enrollment_id,
                    attendanceDate,
                    status,
                    record.remarks || '',
                ]
            );
        }

        await connection.commit();
        return { success: true, message: 'Attendance saved successfully.' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function updateAttendance(coachId, attendanceId, payload = {}) {
    const [rows] = await db.query(
        `SELECT
            a.attendance_id,
            a.coach_id,
            a.schedule_id,
            a.status,
            a.remarks
         FROM swimming_attendance a
         WHERE a.attendance_id = ?
         LIMIT 1`,
        [attendanceId]
    );

    if (!rows.length) {
        return { notFound: true, message: 'Attendance record not found.' };
    }

    const record = rows[0];
    const scheduleOwned = await assertScheduleBelongsToCoach(record.schedule_id, coachId);
    if (!scheduleOwned) {
        return { forbidden: true, message: 'Forbidden: you do not have access to this attendance record.' };
    }

    const nextStatus = payload.status ?? record.status;
    if (!VALID_ATTENDANCE_STATUSES.includes(nextStatus)) {
        return { badRequest: true, message: 'Invalid attendance status.' };
    }

    const nextRemarks = payload.remarks !== undefined ? payload.remarks : record.remarks;

    await db.query(
        `UPDATE swimming_attendance
         SET status = ?, remarks = ?, updated_at = NOW()
         WHERE attendance_id = ?`,
        [nextStatus, nextRemarks || '', attendanceId]
    );

    const [updatedRows] = await db.query(
        `SELECT
            attendance_id,
            enrollment_id,
            schedule_id,
            attendance_date,
            status,
            remarks
         FROM swimming_attendance
         WHERE attendance_id = ?
         LIMIT 1`,
        [attendanceId]
    );

    return {
        success: true,
        message: 'Attendance updated successfully.',
        record: updatedRows[0] || null,
    };
}

export { APPROVED_STATUSES, VALID_ATTENDANCE_STATUSES };
