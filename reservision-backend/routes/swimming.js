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
router.post("/enrollments", async (req, res) => {
    try {
        const {
            // Personal Information
            firstName,
            middleName,
            lastName,
            dateOfBirth,

            // Personal Details
            sex,
            weight,
            height,
            preferredCoach,
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
            lessonType,
            skillLevel,

            // Agreement
            agreedToTerms,
            agriedToWaiver
        } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !dateOfBirth || !email || !preferredCoach || !address || !lessonType) {
            return res.status(400).json({
                error: "Missing required fields",
                required: ["firstName", "lastName", "dateOfBirth", "email", "preferredCoach", "address", "lessonType"]
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        const sql = `
      INSERT INTO swimming_enrollments (
        first_name, middle_name, last_name, date_of_birth,
        sex, weight, height, preferred_coach, address, mobile_phone, email,
        father_name, mother_name,
        emergency_contact_name, emergency_contact_phone,
        physician_phone,
        lesson_type, skill_level,
        agreed_to_terms, agreed_to_waiver
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const values = [
            firstName, middleName, lastName, dateOfBirth,
            sex || 'Male', weight, height, preferredCoach, address, mobilePhone, email,
            fatherName || null, motherName || null,
            emergencyContactName || null, emergencyContactPhone || null,
            physicianPhone || null,
            lessonType, skillLevel || 'Beginner',
            agreedToTerms ? 1 : 0, agriedToWaiver ? 1 : 0
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
router.post("/validate-booking", async (req, res) => {
    try {
        const { bookingReference } = req.body;

        if (!bookingReference) {
            return res.status(400).json({
                success: false,
                error: "Booking reference is required"
            });
        }

        // Query booking details (no enrollment counting - using simplified approach)
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
                bi.item_name as package_name,
                bi.item_description
            FROM bookings b
            JOIN booking_items bi ON b.booking_id = bi.booking_id
            JOIN customers c ON b.customer_id = c.customer_id
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

        const enrolledCount = enrollmentCount[0].enrolled_count;
        const availableSlots = booking.paid_slots - enrolledCount;

        // Check if booking is full
        if (availableSlots <= 0) {
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
            canEnroll: true,
            booking: {
                ...booking,
                swimmingDetails: swimmingDetails,
                enrolled_count: enrolledCount,
                available_slots: availableSlots
            },
            message: `Booking validated successfully. ${availableSlots} slot(s) available. Class ID: ${booking.booking_reference}`
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
router.post("/enroll", async (req, res) => {
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
                bi.item_description
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', NOW())`,
            [
                bookingReference,
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
            totalSlots: booking.paid_slots,
            slotsUsed: finalEnrollments,
            allSlotsFilled: allSlotsFilled,
            swimmingDetails: swimmingDetails,
            enrollmentDetails: {
                name: `${firstName} ${lastName}`,
                email: email,
                lessonType: lessonType || booking.lesson_type,
                skillLevel: skillLevel || 'Beginner'
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
router.get("/enrollments", async (req, res) => {
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
router.get("/enrollments/:id", async (req, res) => {
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
router.put("/enrollments/:id", async (req, res) => {
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

        // Add other fields that can be updated
        const allowedFields = [
            'first_name', 'middle_name', 'last_name', 'email', 'mobile_phone',
            'address', 'preferred_coach', 'lesson_type', 'skill_level',
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
router.delete("/enrollments/:id", async (req, res) => {
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
            "SELECT coach_id, name, specialization, experience_years, certification, bio, availability FROM swimming_coaches WHERE status = ? ORDER BY name",
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
            "SELECT * FROM swimming_coaches WHERE coach_id = ?",
            [id]
        );

        if (coaches.length === 0) {
            return res.status(404).json({ error: "Coach not found" });
        }

        res.json(coaches[0]);

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
            name,
            specialization,
            experienceYears,
            certification,
            bio,
            profileImage,
            availability,
            maxStudents
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Coach name is required" });
        }

        const sql = `
      INSERT INTO swimming_coaches (
        name, specialization, experience_years, certification,
        bio, profile_image, availability, max_students
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const [result] = await db.query(sql, [
            name, specialization, experienceYears, certification,
            bio, profileImage, availability, maxStudents || 10
        ]);

        const [coach] = await db.query(
            "SELECT * FROM swimming_coaches WHERE coach_id = ?",
            [result.insertId]
        );

        res.status(201).json({
            message: "Coach created successfully",
            coach: coach[0]
        });

    } catch (error) {
        console.error("Error creating coach:", error);
        res.status(500).json({
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
        const updates = [];
        const values = [];

        const allowedFields = [
            'name', 'specialization', 'experience_years', 'certification',
            'bio', 'profile_image', 'availability', 'max_students',
            'current_students', 'status'
        ];

        Object.keys(req.body).forEach(field => {
            const snakeField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            if (allowedFields.includes(snakeField)) {
                updates.push(`${snakeField} = ?`);
                values.push(req.body[field]);
            }
        });

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid fields to update" });
        }

        values.push(id);

        const sql = `UPDATE swimming_coaches SET ${updates.join(", ")} WHERE coach_id = ?`;

        await db.query(sql, values);

        const [coach] = await db.query(
            "SELECT * FROM swimming_coaches WHERE coach_id = ?",
            [id]
        );

        res.json({
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
                'Event',
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
                CONCAT(se.first_name, ' ', se.last_name) as name,
                se.first_name,
                se.last_name,
                se.lesson_type,
                COALESCE(sc.name, se.preferred_coach) as coach,
                se.email,
                se.mobile_phone,
                se.enrollment_status,
                se.booking_reference,
                se.created_at,
                b.booking_id,
                b.payment_status,
                b.created_at as booking_date
            FROM swimming_enrollments se
            LEFT JOIN bookings b ON se.booking_reference = b.booking_reference
            LEFT JOIN swimming_coaches sc ON sc.coach_id = se.preferred_coach
            ORDER BY se.created_at DESC
        `);

        console.log(`Found ${students.length} students in database`);

        res.json({
            success: true,
            students: students,
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
 * GET /api/swimming/admin/schedules
 * Get all schedules grouped by coach and lesson type
 */
router.get("/admin/schedules", async (req, res) => {
    try {
        const [coaches] = await db.query(`
            SELECT 
                coach_id,
                name as coach_name,
                specialization,
                availability
            FROM swimming_coaches
            ORDER BY name
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

export default router;
