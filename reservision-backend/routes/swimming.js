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
            homePhone,
            mobilePhone,
            email,

            // Parent/Guardian Information
            fatherName,
            fatherOccupation,
            fatherPhone,
            motherName,
            motherOccupation,
            motherPhone,
            emergencyContactName,
            emergencyContactPhone,
            emergencyContactRelationship,

            // Medical Information
            medicalConditions,
            allergies,
            medications,
            physicianName,
            physicianPhone,

            // Swimming Details
            lessonType,
            skillLevel,
            previousExperience,
            swimmingGoals,

            // Schedule Preferences
            preferredDays,
            preferredTime,
            startDate,

            // Additional Information
            howDidYouHear,
            specialRequests,

            // Agreement
            agreedToTerms,
            agreedToWaiver
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
        sex, weight, height, preferred_coach, address, home_phone, mobile_phone, email,
        father_name, father_occupation, father_phone,
        mother_name, mother_occupation, mother_phone,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        medical_conditions, allergies, medications, physician_name, physician_phone,
        lesson_type, skill_level, previous_experience, swimming_goals,
        preferred_days, preferred_time, start_date,
        how_did_you_hear, special_requests,
        agreed_to_terms, agreed_to_waiver
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const values = [
            firstName, middleName, lastName, dateOfBirth,
            sex, weight, height, preferredCoach, address, homePhone, mobilePhone, email,
            fatherName, fatherOccupation, fatherPhone,
            motherName, motherOccupation, motherPhone,
            emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
            medicalConditions, allergies, medications, physicianName, physicianPhone,
            lessonType, skillLevel, previousExperience, swimmingGoals,
            preferredDays, preferredTime, startDate,
            howDidYouHear, specialRequests,
            agreedToTerms ? 1 : 0, agreedToWaiver ? 1 : 0
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
            'preferred_days', 'preferred_time', 'start_date', 'special_requests'
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
            "SELECT * FROM swimming_coaches WHERE status = ? ORDER BY name",
            [status]
        );

        res.json(coaches);

    } catch (error) {
        console.error("Error fetching coaches:", error);
        res.status(500).json({
            error: "Failed to fetch coaches",
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

export default router;
