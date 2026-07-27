import express from "express";
import {
    getRefunds,
    getRefundById,
    createRefund,
    approveRefund,
    rejectRefund,
    exportRefundsCSV
} from "../controllers/adminRefundController.js";
import { handleValidationErrors } from "../middleware/validate.js";
import { adminRefundApproveValidators } from "../middleware/validators/refundValidators.js";

const router = express.Router();

router.get("/", getRefunds);
router.get("/export/csv", exportRefundsCSV);
router.get("/:id", getRefundById);

router.post("/", createRefund);

router.put("/:id/approve", adminRefundApproveValidators, handleValidationErrors, approveRefund);
router.put("/:id/reject", rejectRefund);

export default router;
