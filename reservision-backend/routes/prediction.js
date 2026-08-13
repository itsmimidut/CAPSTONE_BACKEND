import express from "express";
import { requireAdmin } from "../middleware/authorize.js";
import {
  predictTomorrowBookings,
  predictDate,
  forecastRange,
  getDailyForecast,
  getWeeklyForecast,
  getMonthlyForecast,
  getYearlyForecast,
  predictionPing,
  getPredictionReadiness,
  syncBookingDemandDataset,
  listBookingDemandDataset,
  syncTrainingData,
  trainPredictionModels,
} from "../controllers/predictionController.js";

const router = express.Router();

router.get("/ping", predictionPing);
router.get("/readiness", requireAdmin, getPredictionReadiness);
// Descriptive 7-day rolling average — not a Prophet forecast (kept for backward compatibility)
router.get("/tomorrow-bookings", predictTomorrowBookings);
router.get("/predict-date", requireAdmin, predictDate);
// Phase 4: dual-model daily forecast (bookings + guests) — admin only
router.get("/forecast-range", requireAdmin, forecastRange);

// Legacy table-based forecast routes (bookings_forecast)
router.get("/forecast/daily", getDailyForecast);
router.get("/forecast/weekly", getWeeklyForecast);
router.get("/forecast/monthly", getMonthlyForecast);
router.get("/forecast/yearly", getYearlyForecast);

// Admin: rebuild bookings_daily from live data + optional retrain
router.post("/sync-training-data", requireAdmin, syncTrainingData);

// Phase 3: train Prophet bookings + guests models (blocked when dataset not ready)
router.post("/train", requireAdmin, trainPredictionModels);

// Phase 2: isolated arrival-demand dataset. These routes never train a model.
router.post("/demand-dataset/sync", requireAdmin, syncBookingDemandDataset);
router.get("/demand-dataset", requireAdmin, listBookingDemandDataset);

export default router;
