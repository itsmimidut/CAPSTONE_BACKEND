import express from "express";
import { getOperationsDashboard } from "../controllers/adminDashboardController.js";

const router = express.Router();

router.get("/operations", getOperationsDashboard);

export default router;
