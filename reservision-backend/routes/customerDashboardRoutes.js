import express from "express";
import { getTopPicks } from "../controllers/customerDashboardController.js";

const router = express.Router();

router.get("/top-picks", getTopPicks);

export default router;
