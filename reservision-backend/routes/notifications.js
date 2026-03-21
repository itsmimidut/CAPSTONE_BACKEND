import express from "express";
import { db } from "../config/db.js";

const router = express.Router();

/**
 * GET /api/notifications/pending-counts
 * Returns counts of pending items for sidebar badges
 */
router.get("/pending-counts", async (req, res) => {
    try {
        const [[bookingRow]] = await db.query(
            "SELECT COUNT(*) AS count FROM bookings WHERE booking_status = 'Pending'"
        );
        const [[swimmingRow]] = await db.query(
            "SELECT COUNT(*) AS count FROM swimming_enrollments WHERE enrollment_status = 'Pending'"
        );

        res.json({
            reservationPendingCount: bookingRow.count,
            swimmingPendingCount: swimmingRow.count
        });
    } catch (error) {
        console.error("Error fetching notification counts:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
