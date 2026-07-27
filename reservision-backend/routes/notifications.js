import express from "express";
import { db } from "../config/db.js";
import { getDashboardNotifications, markStaffNotificationRead, markAllStaffNotificationsRead } from "../controllers/adminNotificationController.js";
import { adminNotificationsLimiter } from "../middleware/rateLimiters.js";

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
        const [[eshopRow]] = await db.query(
            `SELECT COUNT(*) AS count
             FROM pos_transactions
             WHERE LOWER(TRIM(COALESCE(type, ''))) = 'e-shop'
               AND fulfillment_status IN (
                 'received', 'preparing', 'out_for_delivery', 'ready_for_pickup'
               )`
        );

        res.json({
            reservationPendingCount: bookingRow.count,
            swimmingPendingCount: swimmingRow.count,
            eshopPendingCount: eshopRow.count
        });
    } catch (error) {
        console.error("Error fetching notification counts:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/feed", adminNotificationsLimiter, getDashboardNotifications);
router.post("/read-all", adminNotificationsLimiter, markAllStaffNotificationsRead);
router.post("/:notificationId/read", adminNotificationsLimiter, markStaffNotificationRead);

export default router;
