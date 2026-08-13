import { db } from "../config/db.js";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { getForecastReadiness } from "../services/predictionModelService.js";
import {
  buildForecastRecommendations,
  computeForecastSummary,
  toLegacyPromoSuggestion,
} from "../services/forecastRecommendationService.js";

/**
 * ============================================================
 * PATH / PYTHON SETUP
 * ============================================================
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PY_SCRIPT = path.resolve(__dirname, "../../../Predictive_Analytics/predict_real.py");

/**
 * ============================================================
 * HELPERS
 * ============================================================
 */
function nowInManila() {
  const manilaStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" });
  return new Date(manilaStr);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toYMD(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minAllowedDateYMD() {
  const d = nowInManila();
  d.setDate(d.getDate() + 1);
  return toYMD(d);
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function ensureFutureOnlyYMD(dateStr) {
  if (!isValidYMD(dateStr)) {
    return { ok: false, message: "Invalid date format. Use YYYY-MM-DD." };
  }

  const min = minAllowedDateYMD();
  if (dateStr < min) {
    return { ok: false, message: `Past/today date not allowed. Minimum is ${min}.` };
  }

  return { ok: true };
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .trim();
}

function daysBetween(start, end) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return Math.floor((e - s) / 86400000);
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

async function getHistoricalAverageBookings(days = 30) {
  const safeDays = Math.max(7, Math.min(Number(days || 30), 365));

  // Use the same validated arrival-demand dataset that trains Prophet.
  // This includes zero-demand calendar dates and avoids mixing booking-created
  // dates with the model's arrival-date target.
  const [rows] = await db.query(
    `
    SELECT
      DATE_FORMAT(demand_date, '%Y-%m-%d') AS booking_day,
      bookings
    FROM booking_demand_daily
    WHERE demand_date > DATE_SUB(
      (SELECT MAX(demand_date) FROM booking_demand_daily),
      INTERVAL ? DAY
    )
    ORDER BY demand_date ASC
    `,
    [safeDays]
  );

  if (!rows.length) {
    return {
      baselineAvg: 0,
      dailyRows: [],
      peak: 0,
      min: 0,
    };
  }

  const totals = rows.map((row) => Number(row.bookings || 0));
  return {
    baselineAvg: average(totals),
    dailyRows: rows,
    peak: Math.max(...totals),
    min: Math.min(...totals),
  };
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    execFile("python", [PY_SCRIPT, ...args], (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }

      try {
        resolve(JSON.parse(String(stdout)));
      } catch {
        reject(new Error("Invalid JSON from python: " + String(stdout)));
      }
    });
  });
}

/**
 * ============================================================
 * BASIC DB PREDICTION
 * ============================================================
 */
export const predictTomorrowBookings = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS bookings
      FROM bookings
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        AND booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 7
    `);

    if (!rows.length) {
      return res.json({
        method: "7_day_rolling_average",
        label: "Recent 7-day average (descriptive baseline, not a model forecast)",
        average_bookings: 0,
        prediction: 0,
        days_included: 0,
        details: [],
        note: "Use GET /prediction/forecast-range for Prophet model forecasts.",
      });
    }

    const total = rows.reduce((sum, r) => sum + Number(r.bookings || 0), 0);
    const avg = total / rows.length;
    const roundedAvg = Math.round(avg);

    return res.json({
      method: "7_day_rolling_average",
      label: "Recent 7-day average (descriptive baseline, not a model forecast)",
      average_bookings: roundedAvg,
      prediction: roundedAvg,
      days_included: rows.length,
      details: rows,
      note: "Use GET /prediction/forecast-range for Prophet model forecasts.",
    });
  } catch (error) {
    console.error("Prediction error:", error);
    return res.status(500).json({
      error: "Failed to compute recent booking average",
    });
  }
};

/**
 * ============================================================
 * PYTHON MODEL: SINGLE DATE
 * ============================================================
 */
export const predictDate = async (req, res) => {
  try {
    const readinessState = await ensureForecastReady(res);
    if (!readinessState) return;

    const date = sanitizeText(req.query.date || "");
    const check = ensureFutureOnlyYMD(date);

    if (!check.ok) {
      return res.status(400).json({ message: check.message });
    }

    const result = await runPython(["date", date]);

    return res.json({
      ...result,
      model_metadata: result?.model_metadata || readinessState.model?.metadata || null,
    });
  } catch (error) {
    console.error("predict-date error:", error);
    return res.status(500).json({
      message: "Prediction failed",
      error: sanitizeText(error.message),
    });
  }
};

/**
 * ============================================================
 * PYTHON MODELS: RANGE (Phase 4) + PROMO SUGGESTION
 * ============================================================
 */
export const forecastRange = async (req, res) => {
  try {
    const readinessState = await ensureForecastReady(res);
    if (!readinessState) return;

    // Accept both legacy (start/end) and Phase 4 (startDate/endDate) params.
    const start = sanitizeText(req.query.startDate || req.query.start || "");
    const end = sanitizeText(req.query.endDate || req.query.end || "");

    const startCheck = ensureFutureOnlyYMD(start);
    if (!startCheck.ok) {
      return res.status(400).json({ success: false, message: startCheck.message, promo_suggestion: fallbackPromoSuggestion() });
    }

    const endCheck = ensureFutureOnlyYMD(end);
    if (!endCheck.ok) {
      return res.status(400).json({ success: false, message: endCheck.message, promo_suggestion: fallbackPromoSuggestion() });
    }

    const { generateForecastRange } = await import('../services/predictionForecastService.js');

    let result;
    try {
      result = await generateForecastRange({
        startDate: start,
        endDate: end,
        allowHistorical: true,
      });
    } catch (err) {
      const status = Number(err?.status) || 500;
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        code: err?.code || 'FORECAST_FAILED',
        message: sanitizeText(err.message || 'Forecast failed'),
        details: err?.details || null,
        promo_suggestion: fallbackPromoSuggestion(),
      });
    }

    // Backward-compatible rows for the existing Vue dashboard.
    const rows = result.forecasts.map((row) => ({
      date: row.date,
      predicted_bookings: row.predicted_bookings,
      predicted_bookings_lower: row.bookings_lower,
      predicted_bookings_upper: row.bookings_upper,
      predicted_total_guests: row.predicted_total_guests,
      guests_lower: row.guests_lower,
      guests_upper: row.guests_upper,
    }));

    // Dynamic baseline from real bookings
    let historical = { baselineAvg: 0, peak: 0, min: 0 };
    try {
      historical = await getHistoricalAverageBookings(30);
    } catch {}
    const metadata = readinessState.model?.metadata || {};
    const guestMix = {
      ...result.guest_mix,
      minimum_coverage_pct: Number(
        metadata.guest_mix_minimum_coverage_pct
        ?? metadata.minimum_guest_mix_coverage_pct
        ?? 70
      ),
    };
    const summary = computeForecastSummary(result.forecasts);
    const recommendations = buildForecastRecommendations({
      forecasts: result.forecasts,
      guestMix,
      recentBaselineAverage: historical.baselineAvg,
      now: toYMD(nowInManila()),
    });
    const promoSuggestion = toLegacyPromoSuggestion(recommendations);
    const model = {
      ...result.model,
      date_from: metadata.date_from || null,
      date_to: metadata.date_to || null,
      minimum_training_days: metadata.minimum_training_days || null,
      data_source: metadata.data_source || null,
      targets: metadata.targets || {},
      metrics: {
        mae: metadata.mae ?? metadata.targets?.bookings?.metrics?.mae ?? null,
        rmse: metadata.rmse ?? metadata.targets?.bookings?.metrics?.rmse ?? null,
        wape: metadata.wape ?? metadata.targets?.bookings?.metrics?.wape ?? null,
        bias: metadata.bias ?? metadata.targets?.bookings?.metrics?.bias ?? null,
        prediction_interval_coverage:
          metadata.targets?.bookings?.metrics?.prediction_interval_coverage ?? null,
      },
      baseline_metrics: metadata.targets?.bookings?.baseline_metrics || null,
      baseline_note: result.model?.baseline_note || metadata.baseline_note || null,
      freshness: readinessState.model?.freshness || null,
    };
    const limitations = [
      ...(model.baseline_note
        ? ['Current forecasts reflect the available historical dataset; the stored holdout note indicates limited recent arrival demand.']
        : []),
      ...(guestMix.ready
        ? []
        : [`Guest-category estimates are unavailable until reliable demographic coverage reaches ${guestMix.minimum_coverage_pct}%.`]),
      'Recommendation rules do not currently account for verified room, activity, pool, or restaurant capacity.',
      ...(model.baseline_note ? [model.baseline_note] : []),
    ];

    return res.json({
      success: true,
      model,
      forecast_range: result.forecast_range,
      guest_mix: guestMix,
      aggregate_interval_available: false,
      summary,
      forecasts: result.forecasts,
      recommendations,
      limitations,
      generated_at: result.generated_at,
      // Legacy fields kept for the current admin dashboard
      rows,
      model_metadata: readinessState.model?.metadata || null,
      promo_suggestion: promoSuggestion,
      promo_context: {
        recent_baseline_avg: Math.round(historical.baselineAvg || 0),
        recent_peak: Math.round(historical.peak || 0),
        recent_min: Math.round(historical.min || 0),
      },
      forecast_disclaimer:
        "Point forecasts include Prophet confidence intervals. Do not sum daily lower/upper bounds into weekly or monthly intervals.",
      readiness: readinessState.readiness,
    });
  } catch (error) {
    console.error("forecast-range error:", error);
    return res.status(500).json({
      success: false,
      message: "Forecast failed",
      error: sanitizeText(error.message),
      promo_suggestion: fallbackPromoSuggestion()
    });
  }
}

function fallbackPromoSuggestion() {
  return {
    demand_level: "N/A",
    headline: "No suggestions available",
    description: "Rule-based suggestions could not be generated.",
    actions: ["Check backend logic or data."],
  };
}

async function ensureForecastReady(res) {
  const readiness = await getForecastReadiness();
  if (!readiness.safe_for_live_use) {
    res.status(422).json({
      success: false,
      code: readiness.code || "FORECAST_NOT_READY",
      message: readiness.message,
      readiness: readiness.readiness,
      model: readiness.model,
      training: readiness.training,
    });
    return null;
  }
  return readiness;
}


/**
 * ============================================================
 * FORECAST TABLE ROUTES
 * ============================================================
 */
export const getDailyForecast = async (req, res) => {
  try {
    const min = minAllowedDateYMD();

    const [rows] = await db.query(
      `
      SELECT forecast_date, predicted_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      ORDER BY forecast_date ASC
      `,
      [min]
    );

    return res.json(rows);
  } catch (error) {
    console.error("forecast/daily error:", error);
    return res.status(500).json({
      message: "Failed to fetch daily forecast",
      error: sanitizeText(error.message),
    });
  }
};

export const getWeeklyForecast = async (req, res) => {
  try {
    const min = minAllowedDateYMD();

    const [rows] = await db.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        WEEK(forecast_date, 1) AS week,
        MIN(forecast_date) AS week_start,
        MAX(forecast_date) AS week_end,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY YEAR(forecast_date), WEEK(forecast_date, 1)
      ORDER BY YEAR(forecast_date), WEEK(forecast_date, 1)
      `,
      [min]
    );

    return res.json(rows);
  } catch (error) {
    console.error("forecast/weekly error:", error);
    return res.status(500).json({
      message: "Failed to fetch weekly forecast",
      error: sanitizeText(error.message),
    });
  }
};

export const getMonthlyForecast = async (req, res) => {
  try {
    const min = minAllowedDateYMD();

    const [rows] = await db.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        MONTH(forecast_date) AS month,
        DATE_FORMAT(forecast_date, '%Y-%m') AS ym,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY YEAR(forecast_date), MONTH(forecast_date), DATE_FORMAT(forecast_date, '%Y-%m')
      ORDER BY YEAR(forecast_date), MONTH(forecast_date)
      `,
      [min]
    );

    return res.json(rows);
  } catch (error) {
    console.error("forecast/monthly error:", error);
    return res.status(500).json({
      message: "Failed to fetch monthly forecast",
      error: sanitizeText(error.message),
    });
  }
};

export const getYearlyForecast = async (req, res) => {
  try {
    const min = minAllowedDateYMD();

    const [rows] = await db.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY YEAR(forecast_date)
      ORDER BY YEAR(forecast_date)
      `,
      [min]
    );

    return res.json(rows);
  } catch (error) {
    console.error("forecast/yearly error:", error);
    return res.status(500).json({
      message: "Failed to fetch yearly forecast",
      error: sanitizeText(error.message),
    });
  }
};

export const predictionPing = async (req, res) => {
  return res.json({
    ok: true,
    message: "prediction routes working",
    min_allowed_date: minAllowedDateYMD(),
  });
};

export const getPredictionReadiness = async (req, res) => {
  try {
    const readiness = await getForecastReadiness();
    return res.json({
      success: readiness.safe_for_live_use,
      ...readiness,
    });
  } catch (error) {
    console.error("prediction/readiness error:", error);
    return res.status(500).json({
      success: false,
      code: "READINESS_CHECK_FAILED",
      message: "Failed to check forecast readiness",
      error: sanitizeText(error.message),
    });
  }
};

/**
 * Phase 2 only: rebuild the validated booking_demand_daily dataset.
 * This endpoint never trains or replaces a model.
 */
export const syncBookingDemandDataset = async (req, res) => {
  try {
    const includeConfirmedFallback = String(
      req.query.includeConfirmedFallback ?? 'false'
    ).toLowerCase() === 'true';
    const { syncBookingDemandDaily } = await import(
      '../services/predictionTrainingService.js'
    );
    const result = await syncBookingDemandDaily({ includeConfirmedFallback });

    return res.json({
      success: true,
      message: 'booking_demand_daily rebuilt and validated. No model training was started.',
      ...result,
    });
  } catch (error) {
    console.error('sync-booking-demand-dataset error:', error);
    const validationFailure = error?.code === 'INVALID_BOOKING_DEMAND_DATASET';
    return res.status(validationFailure ? 422 : 500).json({
      success: false,
      code: error?.code || 'BOOKING_DEMAND_SYNC_FAILED',
      message: validationFailure
        ? 'Booking demand dataset failed validation; the previous dataset was preserved.'
        : 'Failed to build booking demand dataset.',
      error: sanitizeText(error.message),
      details: error?.details || null,
    });
  }
};

export const listBookingDemandDataset = async (req, res) => {
  try {
    const start = sanitizeText(req.query.start || '');
    const end = sanitizeText(req.query.end || '');
    const limit = Number(req.query.limit || 400);

    if (start && !isValidYMD(start)) {
      return res.status(400).json({
        success: false,
        message: 'start must use YYYY-MM-DD format.',
      });
    }
    if (end && !isValidYMD(end)) {
      return res.status(400).json({
        success: false,
        message: 'end must use YYYY-MM-DD format.',
      });
    }
    if (start && end && start > end) {
      return res.status(400).json({
        success: false,
        message: 'start must be on or before end.',
      });
    }

    const { getBookingDemandDaily } = await import(
      '../services/predictionTrainingService.js'
    );
    const rows = await getBookingDemandDaily({ start, end, limit });

    return res.json({
      success: true,
      dataset: 'booking_demand_daily',
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error('booking-demand-dataset list error:', error);
    const notBuilt = error?.code === 'ER_NO_SUCH_TABLE';
    return res.status(notBuilt ? 409 : 500).json({
      success: false,
      code: notBuilt ? 'BOOKING_DEMAND_DATASET_NOT_BUILT' : 'BOOKING_DEMAND_READ_FAILED',
      message: notBuilt
        ? 'booking_demand_daily has not been created yet. Run the Phase 2 sync first.'
        : 'Failed to read booking demand dataset.',
      error: sanitizeText(error.message),
    });
  }
};

export const syncTrainingData = async (req, res) => {
  try {
    const retrain = String(req.query.retrain ?? 'true').toLowerCase() !== 'false';
    const { syncAndRetrainModel } = await import('../services/predictionTrainingService.js');
    const result = await syncAndRetrainModel({ retrain });

    return res.json({
      success: true,
      message: retrain
        ? 'Training data synced and model retrain attempted.'
        : 'Training data synced.',
      ...result,
    });
  } catch (error) {
    console.error('sync-training-data error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync training data',
      error: sanitizeText(error.message),
    });
  }
};

/**
 * Phase 3: train Prophet bookings + guests models from booking_demand_daily.
 * Refuses to train when Phase 2 readiness requirements are not met.
 */
export const trainPredictionModels = async (req, res) => {
  try {
    const checkOnly = String(
      req.query.checkOnly ?? req.body?.checkOnly ?? 'false'
    ).toLowerCase() === 'true';
    const testDays = Number(req.query.testDays ?? req.body?.testDays ?? 28);

    const { trainForecastModels } = await import(
      '../services/predictionTrainingService.js'
    );
    const result = await trainForecastModels({ checkOnly, testDays });

    const status = result.ready ? 200 : 409;
    return res.status(status).json({
      success: result.ready,
      message: result.ready
        ? (checkOnly
          ? 'Training readiness checks passed.'
          : 'Forecast models trained and marked ready.')
        : (result.message || 'Training Aborted'),
      ...result,
    });
  } catch (error) {
    console.error('prediction/train error:', error);
    return res.status(500).json({
      success: false,
      ready: false,
      blocking_reasons: [sanitizeText(error.message)],
      message: 'Failed to run forecast model training',
      error: sanitizeText(error.message),
    });
  }
};
