import { db } from "../config/db.js";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

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

function sanitizePromoSuggestion(suggestion) {
  return {
    demand_level: sanitizeText(suggestion.demand_level),
    title: sanitizeText(suggestion.title),
    type: sanitizeText(suggestion.type),
    description: sanitizeText(suggestion.description),
    action: sanitizeText(suggestion.action),
  };
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

async function getHistoricalAverageBookings(days = 30) {
  const safeDays = Math.max(7, Math.min(Number(days || 30), 365));

  // Safe query: placeholders prevent SQL injection
  const [rows] = await db.query(
    `
    SELECT DATE(created_at) AS booking_day, COUNT(*) AS bookings
    FROM bookings
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
    GROUP BY DATE(created_at)
    ORDER BY booking_day ASC
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

function buildPromoSuggestion(rows, baselineAvg = 0) {
  const next7 = Array.isArray(rows) ? rows.slice(0, 7) : [];
  const totals = next7.map((row) => Number(row.predicted_bookings || 0));

  const total7 = totals.reduce((sum, value) => sum + value, 0);
  const avg7 = next7.length ? total7 / next7.length : 0;
  const peak7 = totals.length ? Math.max(...totals) : 0;
  const min7 = totals.length ? Math.min(...totals) : 0;

  const weekendDays = next7.filter((row) => {
    const d = new Date(`${row.date}T00:00:00`);
    const day = d.getDay();
    return day === 0 || day === 6;
  });

  const weekendAvg =
    weekendDays.length > 0
      ? weekendDays.reduce((sum, row) => sum + Number(row.predicted_bookings || 0), 0) / weekendDays.length
      : 0;

  let suggestion;

  // Best logic: compare forecast to recent real baseline
  if (baselineAvg > 0) {
    const ratio = avg7 / baselineAvg;

    if (ratio < 0.85) {
      suggestion = {
        demand_level: "Low",
        title: "Recovery Discount Promo",
        type: "Discount",
        description: `Forecasted demand is below your recent booking baseline. Expected average is ${Math.round(avg7)} versus recent average of ${Math.round(baselineAvg)}.`,
        action: "Offer 10% to 15% off on weekday bookings, add free swimming access, or push cottage promos to recover demand."
      };
    } else if (ratio <= 1.15) {
      suggestion = {
        demand_level: "Medium",
        title: "Bundle Value Promo",
        type: "Bundle",
        description: `Forecasted demand is close to your normal booking level. Expected average is ${Math.round(avg7)} and recent average is ${Math.round(baselineAvg)}.`,
        action: "Offer family bundles, meal add-ons, room-plus-swimming packages, or stay extensions to raise average transaction value."
      };
    } else if (weekendAvg >= baselineAvg * 1.2) {
      suggestion = {
        demand_level: "High",
        title: "Weekend Premium Promo",
        type: "Upsell",
        description: `Weekend demand is stronger than usual. Weekend average is ${Math.round(weekendAvg)} while recent daily average is ${Math.round(baselineAvg)}.`,
        action: "Avoid large discounts. Promote premium rooms, food packages, and weekend add-ons for high-intent guests."
      };
    } else {
      suggestion = {
        demand_level: "High",
        title: "Upsell Premium Package",
        type: "Upsell",
        description: `Forecasted demand is above your recent baseline. Expected average is ${Math.round(avg7)} with peak of ${Math.round(peak7)} bookings.`,
        action: "Avoid deep discounts. Focus on premium offers, upgrades, and add-ons to maximize revenue."
      };
    }

    return sanitizePromoSuggestion(suggestion);
  }

  // Fallback if no historical baseline exists yet
  if (avg7 < 25) {
    suggestion = {
      demand_level: "Low",
      title: "Weekday Saver Promo",
      type: "Discount",
      description: `Expected demand is lower than usual with an average of ${Math.round(avg7)} bookings in the next 7 days.`,
      action: "Offer 10% to 15% off on weekday bookings, cottage packages, or free swimming access to attract more reservations."
    };
  } else if (avg7 < 40) {
    suggestion = {
      demand_level: "Medium",
      title: "Family Bundle Promo",
      type: "Bundle",
      description: `Expected demand is moderate with an average of ${Math.round(avg7)} bookings in the next 7 days.`,
      action: "Offer family bundles, meal add-ons, or room-plus-swimming packages to increase average transaction value."
    };
  } else if (weekendAvg >= 45) {
    suggestion = {
      demand_level: "High",
      title: "Weekend Premium Promo",
      type: "Upsell",
      description: `Weekend demand is especially strong, averaging ${Math.round(weekendAvg)} bookings.`,
      action: "Avoid large discounts. Push premium rooms, cottages with add-ons, and food bundles for weekend guests."
    };
  } else {
    suggestion = {
      demand_level: "High",
      title: "Upsell Premium Package",
      type: "Upsell",
      description: `Strong demand is expected with an average of ${Math.round(avg7)} bookings and peak of ${Math.round(peak7)} bookings.`,
      action: "Avoid deep discounts. Promote premium rooms, add-ons, and food packages to maximize revenue."
    };
  }

  return sanitizePromoSuggestion(suggestion);
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
        prediction: 0,
        details: [],
      });
    }

    const total = rows.reduce((sum, r) => sum + Number(r.bookings || 0), 0);
    const avg = total / rows.length;

    return res.json({
      prediction: Math.round(avg),
      details: rows,
    });
  } catch (error) {
    console.error("Prediction error:", error);
    return res.status(500).json({
      error: "Prediction failed",
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
    const date = sanitizeText(req.query.date || "");
    const check = ensureFutureOnlyYMD(date);

    if (!check.ok) {
      return res.status(400).json({ message: check.message });
    }

    const result = await runPython(["date", date]);

    return res.json(result);
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
 * PYTHON MODEL: RANGE + PROMO SUGGESTION
 * ============================================================
 */
export const forecastRange = async (req, res) => {
  try {
    const start = sanitizeText(req.query.start || "");
    const end = sanitizeText(req.query.end || "");

    const startCheck = ensureFutureOnlyYMD(start);
    if (!startCheck.ok) {
      return res.status(400).json({ message: startCheck.message, promo_suggestion: fallbackPromoSuggestion() });
    }

    const endCheck = ensureFutureOnlyYMD(end);
    if (!endCheck.ok) {
      return res.status(400).json({ message: endCheck.message, promo_suggestion: fallbackPromoSuggestion() });
    }

    if (end < start) {
      return res.status(400).json({
        message: "end must be greater than or equal to start",
        promo_suggestion: fallbackPromoSuggestion()
      });
    }

    const rangeDays = daysBetween(start, end);
    if (rangeDays > 365) {
      return res.status(400).json({
        message: "Date range cannot exceed 365 days.",
        promo_suggestion: fallbackPromoSuggestion()
      });
    }

    let result;
    try {
      result = await runPython(["range", start, end]);
    } catch (err) {
      // If python fails, still return fallback promo suggestion
      return res.status(500).json({
        message: "Forecast failed (python error)",
        error: sanitizeText(err.message),
        promo_suggestion: fallbackPromoSuggestion()
      });
    }

    const rows = Array.isArray(result?.rows)
      ? result.rows.map((row) => ({
          date: sanitizeText(row.date),
          predicted_bookings: Number(row.predicted_bookings || 0),
        }))
      : [];

    // Dynamic baseline from real bookings
    let historical = { baselineAvg: 0, peak: 0, min: 0 };
    try {
      historical = await getHistoricalAverageBookings(30);
    } catch {}
    let promoSuggestion = buildPromoSuggestion(rows, historical.baselineAvg);
    if (!promoSuggestion || typeof promoSuggestion !== 'object') {
      promoSuggestion = fallbackPromoSuggestion();
    }

    return res.json({
      rows,
      metrics: result?.metrics || null,
      promo_suggestion: promoSuggestion,
      promo_context: {
        recent_baseline_avg: Math.round(historical.baselineAvg || 0),
        recent_peak: Math.round(historical.peak || 0),
        recent_min: Math.round(historical.min || 0),
      },
    });
  } catch (error) {
    console.error("forecast-range error:", error);
    return res.status(500).json({
      message: "Forecast failed",
      error: sanitizeText(error.message),
      promo_suggestion: fallbackPromoSuggestion()
    });
  }
}

function fallbackPromoSuggestion() {
  return {
    demand_level: "N/A",
    title: "No Suggestion",
    type: "N/A",
    description: "Promo suggestion could not be generated.",
    action: "Check backend logic or data."
  };
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
    python_script: PY_SCRIPT,
  });
};