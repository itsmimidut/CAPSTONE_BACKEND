import express from "express";
import mysql from "mysql2/promise";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { predictTomorrowBookings } from "../controllers/predictionController.js";

console.log("✅ USING THIS prediction.js FILE:", import.meta.url);

const router = express.Router();

/**
 * ============================================================
 * DEBUG: Log every request that reaches this router
 * ============================================================
 */
router.use((req, res, next) => {
  console.log("✅ PREDICTION ROUTER HIT:", req.method, req.path, "query:", req.query);
  next();
});

// ✅ EDIT IF NEEDED
const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "eduardos",
};

/**
 * ============================================================
 * DATE HELPERS — future only (tomorrow+), Asia/Manila
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
  d.setDate(d.getDate() + 1); // tomorrow
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

/**
 * ============================================================
 * PYTHON MODEL RUNNER
 * ============================================================
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Correct relative path for your structure:
const PY_SCRIPT = path.resolve(__dirname, "../../../PREDICTIVE ANALYTICS/predict_real.py");

function runPython(args) {
  return new Promise((resolve, reject) => {
    execFile("python", [PY_SCRIPT, ...args], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
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
 * BASIC ROUTES
 * ============================================================
 */

// GET /api/prediction/ping
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    message: "prediction routes working",
    min_allowed_date: minAllowedDateYMD(),
    python_script: PY_SCRIPT,
  });
});

// 🔍 DEBUG: list all routes inside this router
// GET /api/prediction/_routes
router.get("/_routes", (req, res) => {
  const routes = router.stack
    .filter((l) => l.route)
    .map((l) => {
      const methods = Object.keys(l.route.methods).map((m) => m.toUpperCase());
      return { path: l.route.path, methods };
    });

  res.json({ count: routes.length, routes });
});

// GET /api/prediction/tomorrow-bookings
router.get("/tomorrow-bookings", predictTomorrowBookings);

/**
 * ============================================================
 * REAL MODEL ROUTES (calls Python saved model) — future only
 * ============================================================
 */

// GET /api/prediction/predict-date?date=YYYY-MM-DD
router.get("/predict-date", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const check = ensureFutureOnlyYMD(date);
    if (!check.ok) return res.status(400).json({ message: check.message });

    const result = await runPython(["date", date]);
    res.json(result);
  } catch (err) {
    console.error("predict-date error:", err);
    res.status(500).json({ message: "Prediction failed", error: err.message });
  }
});

// GET /api/prediction/forecast-range?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/forecast-range", async (req, res) => {
  try {
    const start = String(req.query.start || "");
    const end = String(req.query.end || "");

    const startCheck = ensureFutureOnlyYMD(start);
    if (!startCheck.ok) return res.status(400).json({ message: startCheck.message });

    const endCheck = ensureFutureOnlyYMD(end);
    if (!endCheck.ok) return res.status(400).json({ message: endCheck.message });

    if (end < start) {
      return res.status(400).json({ message: "end must be >= start" });
    }

    const result = await runPython(["range", start, end]);
    res.json(result);
  } catch (err) {
    console.error("forecast-range error:", err);
    res.status(500).json({ message: "Forecast failed", error: err.message });
  }
});

/**
 * ============================================================
 * DB FORECAST ROUTES (bookings_forecast table) — future only
 * ============================================================
 */

// GET /api/prediction/forecast/daily
router.get("/forecast/daily", async (req, res) => {
  let conn;
  try {
    const min = minAllowedDateYMD();
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.query(
      `
      SELECT forecast_date, predicted_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      ORDER BY forecast_date ASC
      `,
      [min]
    );

    res.json(rows);
  } catch (err) {
    console.error("forecast/daily error:", err);
    res.status(500).json({ message: "Failed to fetch daily forecast", error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

// GET /api/prediction/forecast/weekly
router.get("/forecast/weekly", async (req, res) => {
  let conn;
  try {
    const min = minAllowedDateYMD();
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        WEEK(forecast_date, 1) AS week,
        MIN(forecast_date) AS week_start,
        MAX(forecast_date) AS week_end,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY year, week
      ORDER BY year, week
      `,
      [min]
    );

    res.json(rows);
  } catch (err) {
    console.error("forecast/weekly error:", err);
    res.status(500).json({ message: "Failed to fetch weekly forecast", error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

// GET /api/prediction/forecast/monthly
router.get("/forecast/monthly", async (req, res) => {
  let conn;
  try {
    const min = minAllowedDateYMD();
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        MONTH(forecast_date) AS month,
        DATE_FORMAT(forecast_date, '%Y-%m') AS ym,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY year, month, ym
      ORDER BY year, month
      `,
      [min]
    );

    res.json(rows);
  } catch (err) {
    console.error("forecast/monthly error:", err);
    res.status(500).json({ message: "Failed to fetch monthly forecast", error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

// GET /api/prediction/forecast/yearly
router.get("/forecast/yearly", async (req, res) => {
  let conn;
  try {
    const min = minAllowedDateYMD();
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.query(
      `
      SELECT 
        YEAR(forecast_date) AS year,
        SUM(predicted_bookings) AS total_bookings
      FROM bookings_forecast
      WHERE forecast_date >= ?
      GROUP BY year
      ORDER BY year
      `,
      [min]
    );

    res.json(rows);
  } catch (err) {
    console.error("forecast/yearly error:", err);
    res.status(500).json({ message: "Failed to fetch yearly forecast", error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

export default router;