import express from "express";
import db from "../config/db.js";

const router = express.Router();

// Check if an email already exists in bookings
router.get("/check-email/:email", async (req, res) => {
    const rawEmail = req.params.email ? decodeURIComponent(req.params.email) : "";
    const email = rawEmail.trim();

    if (!email) {
        return res.status(400).json({ success: false, error: "Email is required" });
    }

    try {
        const [rows] = await db.query(
            "SELECT first_name AS firstName, last_name AS lastName, email FROM bookings WHERE email = ? ORDER BY created_at DESC LIMIT 1",
            [email]
        );

        if (rows.length > 0) {
            return res.json({
                success: true,
                exists: true,
                customer: {
                    firstName: rows[0].firstName,
                    lastName: rows[0].lastName,
                    email: rows[0].email
                }
            });
        }

        return res.json({ success: true, exists: false });
    } catch (error) {
        console.error("Check email error:", error);
        return res.status(500).json({ success: false, error: "Database error" });
    }
});

export default router;
