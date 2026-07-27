import { db } from '../config/db.js';
import { assertBatchHasEnrollmentCapacity, getPublicBatchSessions } from './swimmingSessionGenerator.js';
import { canAccessBookingReference } from '../middleware/ownership.js';

const CUSTOMER_EDITABLE_STATUSES = new Set(['Pending', 'Rejected']);

const CUSTOMER_UPDATABLE_FIELDS = {
    firstName: 'first_name',
    middleName: 'middle_name',
    lastName: 'last_name',
    dateOfBirth: 'date_of_birth',
    sex: 'sex',
    weight: 'weight',
    height: 'height',
    address: 'address',
    mobilePhone: 'mobile_phone',
    email: 'email',
    fatherName: 'father_name',
    motherName: 'mother_name',
    emergencyContactName: 'emergency_contact_name',
    emergencyContactPhone: 'emergency_contact_phone',
    physicianPhone: 'physician_phone',
    skillLevel: 'skill_level',
};

function mapEnrollmentRow(row = {}) {
    if (!row?.enrollment_id) return null;

    return {
        enrollment_id: row.enrollment_id,
        booking_reference: row.booking_reference,
        first_name: row.first_name,
        middle_name: row.middle_name,
        last_name: row.last_name,
        date_of_birth: row.date_of_birth,
        sex: row.sex,
        weight: row.weight,
        height: row.height,
        address: row.address,
        mobile_phone: row.mobile_phone,
        email: row.email,
        father_name: row.father_name,
        mother_name: row.mother_name,
        emergency_contact_name: row.emergency_contact_name,
        emergency_contact_phone: row.emergency_contact_phone,
        physician_phone: row.physician_phone,
        skill_level: row.skill_level,
        lesson_type: row.lesson_type,
        enrollment_status: row.enrollment_status,
        payment_status: row.payment_status,
        rejection_reason: row.rejection_reason,
        batch_id: row.batch_id,
        schedule_id: row.schedule_id,
        coach_id: row.coach_id ?? null,
        // Present when the query joins batch/schedule/coach tables.
        batch_name: row.batch_name ?? null,
        schedule_type: row.schedule_type ?? null,
        start_date: row.start_date ?? null,
        end_date: row.end_date ?? null,
        class_period: row.class_period ?? null,
        start_time: row.start_time ?? null,
        end_time: row.end_time ?? null,
        coach_name: row.coach_name ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

function mapBookingSummary(row = {}) {
    return {
        booking_id: row.booking_id,
        booking_reference: row.booking_reference,
        payment_status: row.payment_status,
        item_name: row.item_name,
        package_name: row.item_name,
        unit_price: row.unit_price,
        paid_slots: Number(row.paid_slots || 0),
        enrolled_count: Number(row.enrolled_count || 0),
        available_slots: Math.max(0, Number(row.paid_slots || 0) - Number(row.enrolled_count || 0)),
        batch_id: row.batch_id,
        schedule_id: row.schedule_id,
        batch_name: row.batch_name,
        start_date: row.start_date,
        end_date: row.end_date,
        schedule_type: row.schedule_type || null,
        max_sessions: row.max_sessions != null ? Number(row.max_sessions) : null,
        generated_sessions: row.generated_sessions != null ? Number(row.generated_sessions) : null,
        time_slot: row.time_slot || null,
        class_period: row.class_period,
        start_time: row.start_time,
        end_time: row.end_time,
        coach_name: row.coach_name,
        batch_sessions: row.batch_sessions || [],
    };
}

async function fetchBatchSessionsForCustomer(batchId) {
    if (!batchId) return [];

    const result = await getPublicBatchSessions(batchId);
    if (result.notFound || result.notAvailable) {
        return [];
    }

    return result.sessions || [];
}

async function customerOwnsPaidBatchBooking(userId, batchId) {
    const [[row]] = await db.query(
        `SELECT 1 AS allowed
         FROM bookings b
         INNER JOIN customers c ON c.customer_id = b.customer_id
         INNER JOIN booking_items bi ON bi.booking_id = b.booking_id
         WHERE c.user_id = ?
           AND bi.batch_id = ?
           AND bi.item_type = 'Swimming'
           AND b.payment_status = 'Paid'
         LIMIT 1`,
        [userId, batchId]
    );

    return Boolean(row?.allowed);
}

async function fetchPaidSwimmingBooking(bookingReference) {
    const [rows] = await db.query(
        `SELECT
            b.booking_id,
            b.booking_reference,
            b.customer_id,
            b.payment_status,
            bi.guests AS paid_slots,
            bi.item_name,
            bi.unit_price,
            bi.batch_id,
            bi.schedule_id,
            bi.coach_id,
            bi.item_description,
            sb.batch_name,
            sb.start_date,
            sb.end_date,
            sb.schedule_type,
            sb.max_sessions,
            sb.generated_sessions,
            sb.time_slot,
            sbs.class_period,
            sbs.start_time,
            sbs.end_time,
            co.name AS coach_name
         FROM bookings b
         JOIN booking_items bi ON b.booking_id = bi.booking_id
         LEFT JOIN swimming_batches sb ON bi.batch_id = sb.batch_id
         LEFT JOIN swimming_batch_schedules sbs ON bi.schedule_id = sbs.schedule_id
         LEFT JOIN swimming_coaches co ON co.coach_id = COALESCE(bi.coach_id, sbs.coach_id)
         WHERE b.booking_reference = ?
           AND bi.item_type = 'Swimming'
           AND b.payment_status = 'Paid'
         LIMIT 1`,
        [bookingReference]
    );

    return rows[0] || null;
}

async function countEnrollmentsForReference(bookingReference) {
    const [[row]] = await db.query(
        `SELECT COUNT(*) AS enrolled_count
         FROM swimming_enrollments
         WHERE booking_reference = ?`,
        [bookingReference]
    );

    return Number(row?.enrolled_count || 0);
}

async function fetchLatestEnrollmentForReference(bookingReference) {
    const [rows] = await db.query(
        `SELECT *
         FROM swimming_enrollments
         WHERE booking_reference = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [bookingReference]
    );

    return rows[0] || null;
}

async function fetchEnrollmentOwnedByUser(enrollmentId, userId) {
    const [rows] = await db.query(
        `SELECT se.*
         FROM swimming_enrollments se
         INNER JOIN bookings b ON b.booking_reference = se.booking_reference
         INNER JOIN customers c ON c.customer_id = b.customer_id
         WHERE se.enrollment_id = ?
           AND c.user_id = ?
         LIMIT 1`,
        [enrollmentId, userId]
    );

    return rows[0] || null;
}

export async function getCustomerSwimmingOverview(userId) {
    const [bookingRows] = await db.query(
        `SELECT
            b.booking_id,
            b.booking_reference,
            b.payment_status,
            bi.item_id,
            bi.guests AS paid_slots,
            bi.item_name,
            bi.unit_price,
            bi.batch_id,
            bi.schedule_id,
            sb.batch_name,
            sb.start_date,
            sb.end_date,
            sb.schedule_type,
            sb.max_sessions,
            sb.generated_sessions,
            sb.time_slot,
            sbs.class_period,
            sbs.start_time,
            sbs.end_time,
            co.name AS coach_name,
            (
                SELECT COUNT(*)
                FROM swimming_enrollments se
                WHERE se.booking_reference = b.booking_reference
            ) AS enrolled_count
         FROM bookings b
         INNER JOIN customers c ON c.customer_id = b.customer_id
         INNER JOIN booking_items bi ON bi.booking_id = b.booking_id AND bi.item_type = 'Swimming'
         LEFT JOIN swimming_batches sb ON bi.batch_id = sb.batch_id
         LEFT JOIN swimming_batch_schedules sbs ON bi.schedule_id = sbs.schedule_id
         LEFT JOIN swimming_coaches co ON co.coach_id = COALESCE(bi.coach_id, sbs.coach_id)
         WHERE c.user_id = ?
           AND b.payment_status = 'Paid'
         ORDER BY b.created_at DESC`,
        [userId]
    );

    const [enrollmentRows] = await db.query(
        `SELECT
            se.*,
            sb.batch_name,
            sb.start_date,
            sb.end_date,
            sb.schedule_type,
            sbs.class_period,
            sbs.start_time,
            sbs.end_time,
            co.name AS coach_name
         FROM swimming_enrollments se
         INNER JOIN bookings b ON b.booking_reference = se.booking_reference
         INNER JOIN customers c ON c.customer_id = b.customer_id
         LEFT JOIN swimming_batches sb ON se.batch_id = sb.batch_id
         LEFT JOIN swimming_batch_schedules sbs ON se.schedule_id = sbs.schedule_id
         LEFT JOIN swimming_coaches co ON se.coach_id = co.coach_id
         WHERE c.user_id = ?
         ORDER BY se.created_at DESC`,
        [userId]
    );

    const bookings = await Promise.all(
        bookingRows.map(async (row) => {
            const batchSessions = await fetchBatchSessionsForCustomer(row.batch_id);
            return mapBookingSummary({
                ...row,
                batch_sessions: batchSessions,
            });
        })
    );

    return {
        bookings,
        enrollments: enrollmentRows.map(mapEnrollmentRow),
    };
}

export async function validateCustomerBooking(userId, bookingReference) {
    const allowed = await canAccessBookingReference({ user: { id: userId } }, bookingReference);
    if (!allowed) {
        return { notFound: true, message: 'Booking reference not found or not available.' };
    }

    const booking = await fetchPaidSwimmingBooking(bookingReference);
    if (!booking) {
        return { notFound: true, message: 'Booking reference not found or not available.' };
    }

    const enrolledCount = await countEnrollmentsForReference(bookingReference);
    const existingEnrollment = await fetchLatestEnrollmentForReference(bookingReference);
    const availableSlots = Number(booking.paid_slots || 0) - enrolledCount;
    const bookingIsFull = availableSlots <= 0;
    const batchSessions = await fetchBatchSessionsForCustomer(booking.batch_id);

    if (bookingIsFull && !existingEnrollment) {
        return {
            forbidden: true,
            message: `Booking is full. All ${booking.paid_slots} slot(s) have been used.`,
            booking: mapBookingSummary({ ...booking, enrolled_count: enrolledCount, batch_sessions: batchSessions }),
        };
    }

    return {
        success: true,
        canEnroll: !bookingIsFull,
        existingEnrollment: mapEnrollmentRow(existingEnrollment),
        booking: mapBookingSummary({
            ...booking,
            enrolled_count: enrolledCount,
            batch_sessions: batchSessions,
        }),
        message: bookingIsFull
            ? 'Booking is full, but an existing enrollment was found. You may update your registration.'
            : `Booking validated successfully. ${Math.max(0, availableSlots)} slot(s) available.`,
    };
}

export async function getCustomerBatchSessions(userId, batchId) {
    const ownsBatch = await customerOwnsPaidBatchBooking(userId, batchId);
    if (!ownsBatch) {
        return { forbidden: true, message: 'You do not have access to this batch.' };
    }

    const result = await getPublicBatchSessions(batchId);
    if (result.notFound) {
        return { notFound: true, message: 'Batch not found.' };
    }

    return {
        success: true,
        batch: result.batch,
        sessions: result.sessions || [],
        count: (result.sessions || []).length,
    };
}

export async function createCustomerEnrollment(userId, payload = {}) {
    const bookingReference = String(payload.bookingReference || '').trim();
    if (!bookingReference) {
        return { badRequest: true, message: 'Booking reference is required.' };
    }

    const allowed = await canAccessBookingReference({ user: { id: userId } }, bookingReference);
    if (!allowed) {
        return { notFound: true, message: 'Booking reference not found or not available.' };
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [bookingRows] = await connection.query(
            `SELECT
                b.booking_id,
                b.booking_reference,
                bi.guests AS paid_slots,
                bi.item_name AS lesson_type,
                bi.unit_price AS rate_amount,
                bi.batch_id,
                bi.schedule_id,
                bi.coach_id
             FROM bookings b
             JOIN booking_items bi ON b.booking_id = bi.booking_id
             WHERE b.booking_reference = ?
               AND bi.item_type = 'Swimming'
               AND b.payment_status = 'Paid'
             LIMIT 1
             FOR UPDATE`,
            [bookingReference]
        );

        if (!bookingRows.length) {
            await connection.rollback();
            return { notFound: true, message: 'Booking reference not found or not available.' };
        }

        const booking = bookingRows[0];

        if (!booking.batch_id || !booking.schedule_id) {
            await connection.rollback();
            return {
                badRequest: true,
                message: 'This swimming booking is missing batch schedule details. Please contact the resort.',
            };
        }

        try {
            await assertBatchHasEnrollmentCapacity(booking.batch_id, connection);
        } catch (capacityError) {
            await connection.rollback();
            return {
                badRequest: true,
                message: capacityError.message || 'This batch is already full.',
            };
        }

        const [[countRow]] = await connection.query(
            `SELECT COUNT(*) AS enrolled_count
             FROM swimming_enrollments
             WHERE booking_reference = ?
             FOR UPDATE`,
            [bookingReference]
        );

        const enrolledCount = Number(countRow?.enrolled_count || 0);
        if (enrolledCount >= Number(booking.paid_slots || 0)) {
            await connection.rollback();
            return {
                badRequest: true,
                message: `Booking is full. Paid for ${booking.paid_slots} participant(s), ${enrolledCount} already enrolled.`,
            };
        }

        let coachId = booking.coach_id;
        if (!coachId) {
            const [scheduleRows] = await connection.query(
                `SELECT coach_id FROM swimming_batch_schedules WHERE schedule_id = ? LIMIT 1`,
                [booking.schedule_id]
            );
            coachId = scheduleRows[0]?.coach_id || null;
        }

        const [insertResult] = await connection.query(
            `INSERT INTO swimming_enrollments (
                booking_reference,
                first_name, middle_name, last_name, date_of_birth,
                sex, weight, height, preferred_coach, address, mobile_phone, email,
                father_name, mother_name,
                emergency_contact_name, emergency_contact_phone,
                physician_phone,
                lesson_type, skill_level,
                batch_id, schedule_id, coach_id, rate_amount, payment_status, enrollment_status,
                agreed_to_terms, agreed_to_waiver
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                bookingReference,
                payload.firstName,
                payload.middleName || null,
                payload.lastName,
                payload.dateOfBirth,
                payload.sex || 'Male',
                payload.weight ?? null,
                payload.height ?? null,
                '',
                payload.address,
                payload.mobilePhone || null,
                payload.email,
                payload.fatherName || null,
                payload.motherName || null,
                payload.emergencyContactName || null,
                payload.emergencyContactPhone || null,
                payload.physicianPhone || null,
                booking.lesson_type,
                payload.skillLevel || 'Beginner',
                booking.batch_id,
                booking.schedule_id,
                coachId,
                booking.rate_amount,
                'Paid',
                'Pending',
                payload.agreedToTerms ? 1 : 0,
                payload.agreedToWaiver ? 1 : 0,
            ]
        );

        const [createdRows] = await connection.query(
            `SELECT * FROM swimming_enrollments WHERE enrollment_id = ? LIMIT 1`,
            [insertResult.insertId]
        );

        await connection.commit();

        return {
            success: true,
            message: 'Enrollment submitted successfully. Pending admin approval.',
            enrollment: mapEnrollmentRow(createdRows[0]),
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function updateCustomerEnrollment(userId, enrollmentId, payload = {}) {
    const existing = await fetchEnrollmentOwnedByUser(enrollmentId, userId);
    if (!existing) {
        return { notFound: true, message: 'Enrollment not found.' };
    }

    if (!CUSTOMER_EDITABLE_STATUSES.has(existing.enrollment_status)) {
        return {
            forbidden: true,
            message: 'This enrollment can no longer be edited.',
        };
    }

    if (payload.bookingReference && payload.bookingReference !== existing.booking_reference) {
        return { badRequest: true, message: 'Booking reference cannot be changed.' };
    }

    const updates = [];
    const values = [];

    Object.entries(CUSTOMER_UPDATABLE_FIELDS).forEach(([inputKey, column]) => {
        if (payload[inputKey] !== undefined) {
            updates.push(`${column} = ?`);
            values.push(payload[inputKey]);
        }
    });

    if (payload.agreedToTerms !== undefined) {
        updates.push('agreed_to_terms = ?');
        values.push(payload.agreedToTerms ? 1 : 0);
    }

    if (payload.agreedToWaiver !== undefined) {
        updates.push('agreed_to_waiver = ?');
        values.push(payload.agreedToWaiver ? 1 : 0);
    }

    if (existing.enrollment_status === 'Rejected') {
        updates.push("enrollment_status = 'Pending'");
        updates.push('rejection_reason = NULL');
    }

    if (!updates.length) {
        return { badRequest: true, message: 'No valid fields to update.' };
    }

    values.push(enrollmentId);

    await db.query(
        `UPDATE swimming_enrollments SET ${updates.join(', ')}, updated_at = NOW() WHERE enrollment_id = ?`,
        values
    );

    const [updatedRows] = await db.query(
        `SELECT * FROM swimming_enrollments WHERE enrollment_id = ? LIMIT 1`,
        [enrollmentId]
    );

    return {
        success: true,
        message: 'Enrollment updated successfully.',
        enrollment: mapEnrollmentRow(updatedRows[0]),
    };
}
