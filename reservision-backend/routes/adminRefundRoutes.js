import express from "express";
import {
    getRefunds,
    getRefundById,
    createRefund,
    approveRefund,
    rejectRefund,
    markRefunded,
    exportRefundsCSV
} from "../controllers/adminRefundController.js";

const router = express.Router();

router.get("/", getRefunds);
router.get("/export/csv", exportRefundsCSV);
router.get("/:id", getRefundById);

router.post("/", createRefund);

router.put("/:id/approve", approveRefund);
router.put("/:id/reject", rejectRefund);
router.put("/:id/mark-refunded", markRefunded);

export default router;
