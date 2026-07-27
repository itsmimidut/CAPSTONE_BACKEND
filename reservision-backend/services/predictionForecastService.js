import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  deriveBaselineNote,
  guestsModelFileExists,
  modelFileExists,
  readModelMetadata,
} from './predictionModelService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREDICT_SCRIPT = path.resolve(__dirname, '../../../Predictive_Analytics/predict_real.py');

export const MAX_FORECAST_DAYS = Number(process.env.PREDICTION_MAX_FORECAST_DAYS || 90);
const PYTHON_TIMEOUT_MS = Number(process.env.PREDICTION_PYTHON_TIMEOUT_MS || 120_000);
const GUEST_MIX_UNAVAILABLE_MESSAGE = 'Insufficient reliable demographic history.';

export class ForecastServiceError extends Error {
  constructor(message, { status = 500, code = 'FORECAST_FAILED', details = null } = {}) {
    super(message);
    this.name = 'ForecastServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidYMD = (value) => {
  if (!YMD_PATTERN.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const daysBetweenInclusive = (start, end) => {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
};

/**
 * Pure request validation so it can be unit tested without Python or DB.
 */
export function validateForecastRangeInput({ startDate, endDate, maxDays = MAX_FORECAST_DAYS } = {}) {
  if (!startDate) {
    return { ok: false, status: 400, code: 'MISSING_START_DATE', message: 'startDate is required (YYYY-MM-DD).' };
  }
  if (!endDate) {
    return { ok: false, status: 400, code: 'MISSING_END_DATE', message: 'endDate is required (YYYY-MM-DD).' };
  }
  if (!isValidYMD(startDate)) {
    return { ok: false, status: 400, code: 'INVALID_START_DATE', message: 'startDate must use YYYY-MM-DD format.' };
  }
  if (!isValidYMD(endDate)) {
    return { ok: false, status: 400, code: 'INVALID_END_DATE', message: 'endDate must use YYYY-MM-DD format.' };
  }
  if (endDate < startDate) {
    return { ok: false, status: 400, code: 'INVALID_RANGE', message: 'End date must not be earlier than start date' };
  }

  const days = daysBetweenInclusive(startDate, endDate);
  if (days > maxDays) {
    return {
      ok: false,
      status: 400,
      code: 'RANGE_TOO_LARGE',
      message: `Forecast range cannot exceed ${maxDays} days (requested ${days}).`,
    };
  }

  return { ok: true, days };
}

/**
 * Pure per-row reconciliation: non-negative integers,
 * guests >= bookings, guests>0 implies bookings>=1,
 * and lower <= prediction <= upper.
 */
export function reconcileForecastRow(row = {}) {
  const clamp = (value) => Math.max(0, Math.round(Number(value) || 0));

  let predictedBookings = clamp(row.predicted_bookings);
  let predictedGuests = clamp(row.predicted_total_guests);

  // Guests without a booking confuses admins — bump bookings to at least 1.
  if (predictedGuests > 0 && predictedBookings < 1) {
    predictedBookings = 1;
  }
  predictedGuests = Math.max(predictedBookings, predictedGuests);

  let bookingsLower = clamp(row.bookings_lower ?? row.predicted_bookings_lower ?? predictedBookings);
  let bookingsUpper = clamp(row.bookings_upper ?? row.predicted_bookings_upper ?? predictedBookings);
  bookingsLower = Math.min(bookingsLower, predictedBookings);
  bookingsUpper = Math.max(bookingsUpper, predictedBookings);

  let guestsLower = clamp(row.guests_lower ?? predictedGuests);
  let guestsUpper = clamp(row.guests_upper ?? predictedGuests);
  guestsLower = Math.min(guestsLower, predictedGuests);
  guestsUpper = Math.max(guestsUpper, predictedGuests);

  return {
    date: String(row.date || ''),
    predicted_bookings: predictedBookings,
    bookings_lower: bookingsLower,
    bookings_upper: bookingsUpper,
    predicted_total_guests: predictedGuests,
    guests_lower: guestsLower,
    guests_upper: guestsUpper,
    estimated_guest_mix: row.estimated_guest_mix ?? null,
  };
}

function assertModelsReady() {
  const metadata = readModelMetadata();

  if (!modelFileExists()) {
    throw new ForecastServiceError('Bookings forecast model file is missing. Train the models first.', {
      status: 409,
      code: 'MODEL_MISSING',
    });
  }
  if (!guestsModelFileExists()) {
    throw new ForecastServiceError('Guests forecast model file is missing. Train the models first.', {
      status: 409,
      code: 'MODEL_MISSING',
    });
  }
  if (!metadata) {
    throw new ForecastServiceError('Forecast model metadata is missing. Retrain the models.', {
      status: 409,
      code: 'METADATA_MISSING',
    });
  }
  if (metadata.is_demo) {
    throw new ForecastServiceError('Model was trained on demo data and cannot serve live forecasts.', {
      status: 409,
      code: 'DEMO_MODEL',
    });
  }
  if (metadata.ready !== true || metadata.safe_for_live_use !== true) {
    throw new ForecastServiceError('Trained models are not marked ready for live forecasting.', {
      status: 409,
      code: 'MODEL_NOT_READY',
      details: { blocking_reasons: metadata.blocking_reasons || [] },
    });
  }

  return metadata;
}

function runPredictScript(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'python',
      [PREDICT_SCRIPT, ...args],
      { timeout: PYTHON_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = String(stdout || '').trim();

        let payload = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            const start = raw.lastIndexOf('{');
            if (start >= 0) {
              try {
                payload = JSON.parse(raw.slice(start));
              } catch {
                payload = null;
              }
            }
          }
        }

        if (payload) {
          return resolve(payload);
        }

        if (err?.killed) {
          return reject(new ForecastServiceError('Forecast generation timed out.', {
            status: 500,
            code: 'PYTHON_TIMEOUT',
          }));
        }

        reject(new ForecastServiceError('Forecast script did not return valid JSON.', {
          status: 500,
          code: 'PYTHON_INVALID_OUTPUT',
          details: { stderr: String(stderr || '').slice(0, 2000), stdout: raw.slice(0, 2000) },
        }));
      }
    );
  });
}

/**
 * Phase 4 entry point: validate dates, verify model readiness,
 * run predict_real.py, and normalize the forecast payload.
 */
export async function generateForecastRange({ startDate, endDate, allowHistorical = false } = {}) {
  const validation = validateForecastRangeInput({ startDate, endDate });
  if (!validation.ok) {
    throw new ForecastServiceError(validation.message, {
      status: validation.status,
      code: validation.code,
    });
  }

  const metadata = assertModelsReady();

  const args = ['--start-date', startDate, '--end-date', endDate];
  if (allowHistorical) args.push('--allow-historical');

  const payload = await runPredictScript(args);

  if (payload.success !== true) {
    const code = payload.code || 'FORECAST_FAILED';
    const status = ['MODEL_MISSING', 'METADATA_MISSING', 'MODEL_NOT_READY', 'MODEL_NOT_SAFE_FOR_LIVE_USE', 'DEMO_MODEL'].includes(code)
      ? 409
      : ['INVALID_DATE', 'INVALID_RANGE', 'RANGE_TOO_LARGE', 'RANGE_OVERLAPS_HISTORY', 'INVALID_ARGS'].includes(code)
        ? 400
        : 500;
    throw new ForecastServiceError(payload.message || 'Forecast generation failed.', {
      status,
      code,
      details: payload,
    });
  }

  const forecasts = Array.isArray(payload.forecast)
    ? payload.forecast.map(reconcileForecastRow)
    : [];

  const guestMixReady = payload.guest_mix?.ready === true;

  return {
    success: true,
    model: {
      version: payload.model?.version || payload.model_version || metadata.model_version || '3.0',
      trained_at: payload.model?.trained_at || metadata.trained_at || null,
      training_days: payload.model?.training_days || metadata.training_days || metadata.usable_days || null,
      safe_for_live_use: true,
      baseline_note: deriveBaselineNote(metadata),
    },
    forecast_range: payload.forecast_range || {
      start_date: startDate,
      end_date: endDate,
      days: validation.days,
    },
    guest_mix: {
      ready: guestMixReady,
      coverage_pct: Number(payload.guest_mix?.coverage_pct ?? metadata.guest_mix_coverage_pct ?? 0),
      message: guestMixReady ? null : (payload.guest_mix?.message || GUEST_MIX_UNAVAILABLE_MESSAGE),
    },
    aggregate_interval_available: false,
    baseline_note: deriveBaselineNote(metadata),
    forecasts,
    generated_at: payload.generated_at || new Date().toISOString(),
  };
}
