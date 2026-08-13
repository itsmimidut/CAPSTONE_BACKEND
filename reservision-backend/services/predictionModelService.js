import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_DIR = path.resolve(__dirname, '../../../Predictive_Analytics');
export const MODEL_PATH = path.join(MODEL_DIR, 'bookings_model.joblib');
export const GUESTS_MODEL_PATH = path.join(MODEL_DIR, 'guests_model.joblib');
export const METADATA_PATH = path.join(MODEL_DIR, 'bookings_model_metadata.json');
export const FORECAST_METADATA_PATH = path.join(MODEL_DIR, 'forecast_models_metadata.json');
export const UNVERIFIED_MODEL_PATH = path.join(MODEL_DIR, 'bookings_model.unverified.joblib');
export const UNVERIFIED_GUESTS_MODEL_PATH = path.join(MODEL_DIR, 'guests_model.unverified.joblib');

export const MINIMUM_TRAINING_DAYS = Number(process.env.PREDICTION_MINIMUM_DEMAND_DAYS || 120);
export const MAX_MODEL_AGE_DAYS = Number(process.env.PREDICTION_MAX_MODEL_AGE_DAYS || 30);

export function assessModelFreshness({ trainedAt, modelDateTo, historyDateTo, now = new Date(), maxAgeDays = MAX_MODEL_AGE_DAYS } = {}) {
  const trained = trainedAt ? new Date(trainedAt) : null;
  const ageDays = trained && !Number.isNaN(trained.getTime())
    ? Math.max(0, Math.floor((now.getTime() - trained.getTime()) / 86_400_000))
    : null;
  const newerHistoryAvailable = Boolean(modelDateTo && historyDateTo && historyDateTo > modelDateTo);
  return {
    fresh: ageDays !== null && ageDays <= maxAgeDays && !newerHistoryAvailable,
    age_days: ageDays,
    maximum_age_days: maxAgeDays,
    newer_history_available: newerHistoryAvailable,
  };
}

/** Normalize MySQL DATE / Date / ISO strings to YYYY-MM-DD (no UTC day-shift). */
export function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    // If a full ISO timestamp is present and UTC hour is not midnight, the
    // calendar day may have shifted (e.g. PH midnight → previous UTC day).
    if (value.includes('T') && !/T00:00:00/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
        return local.toISOString().slice(0, 10);
      }
    }
    return match[1];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }
  return null;
}

export function readModelMetadata() {
  const preferred = [FORECAST_METADATA_PATH, METADATA_PATH];
  for (const filePath of preferred) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      // try next metadata file
    }
  }
  return null;
}

export function deriveBaselineNote(metadata = null) {
  if (!metadata || typeof metadata !== 'object') return null;
  if (metadata.baseline_note) return metadata.baseline_note;

  const targets = metadata.targets || {};
  for (const key of ['bookings', 'guests']) {
    const note = targets[key]?.baseline_note || targets[key]?.baseline_metrics?.note;
    if (note) return note;
  }

  const baseline = targets.bookings?.baseline_metrics;
  if (
    baseline
    && Number(baseline.mae || 0) === 0
    && Number(baseline.rmse || 0) === 0
    && Number(baseline.wape || 0) === 0
  ) {
    return 'Holdout period contained only zero-demand days.';
  }
  return null;
}

export function modelFileExists() {
  return fs.existsSync(MODEL_PATH);
}

export function guestsModelFileExists() {
  return fs.existsSync(GUESTS_MODEL_PATH);
}

export function quarantineModel() {
  if (fs.existsSync(MODEL_PATH)) {
    if (fs.existsSync(UNVERIFIED_MODEL_PATH)) {
      fs.unlinkSync(UNVERIFIED_MODEL_PATH);
    }
    fs.renameSync(MODEL_PATH, UNVERIFIED_MODEL_PATH);
  }

  if (fs.existsSync(GUESTS_MODEL_PATH)) {
    if (fs.existsSync(UNVERIFIED_GUESTS_MODEL_PATH)) {
      fs.unlinkSync(UNVERIFIED_GUESTS_MODEL_PATH);
    }
    fs.renameSync(GUESTS_MODEL_PATH, UNVERIFIED_GUESTS_MODEL_PATH);
  }

  for (const filePath of [METADATA_PATH, FORECAST_METADATA_PATH]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export function quarantineModelIfUnverified() {
  if (modelFileExists() && !readModelMetadata()) {
    quarantineModel();
  }
}

export async function getLiveHistoryStats() {
  try {
    const [demandRows] = await db.query(`
      SELECT
        COUNT(*) AS days,
        DATE_FORMAT(MIN(demand_date), '%Y-%m-%d') AS date_from,
        DATE_FORMAT(MAX(demand_date), '%Y-%m-%d') AS date_to,
        COALESCE(SUM(bookings), 0) AS total_bookings,
        COALESCE(SUM(guests), 0) AS total_guests
      FROM booking_demand_daily
    `);
    const demand = demandRows[0] || {};
    if (Number(demand.days || 0) > 0) {
      return {
        days: Number(demand.days || 0),
        date_from: toDateOnly(demand.date_from),
        date_to: toDateOnly(demand.date_to),
        total_bookings: Number(demand.total_bookings || 0),
        total_guests: Number(demand.total_guests || 0),
        dataset: 'booking_demand_daily',
      };
    }
  } catch {
    // Fall back to legacy bookings_daily when Phase 2 table is absent.
  }

  const [rows] = await db.query(`
    SELECT
      COUNT(*) AS days,
      DATE_FORMAT(MIN(check_in_date), '%Y-%m-%d') AS date_from,
      DATE_FORMAT(MAX(check_in_date), '%Y-%m-%d') AS date_to,
      COALESCE(SUM(total_bookings), 0) AS total_bookings
    FROM bookings_daily
  `);

  const row = rows[0] || {};
  return {
    days: Number(row.days || 0),
    date_from: toDateOnly(row.date_from),
    date_to: toDateOnly(row.date_to),
    total_bookings: Number(row.total_bookings || 0),
    total_guests: null,
    dataset: 'bookings_daily',
  };
}

export async function getForecastReadiness() {
  quarantineModelIfUnverified();

  const history = await getLiveHistoryStats();
  const metadata = readModelMetadata();
  const hasModel = modelFileExists();
  const hasGuestsModel = guestsModelFileExists();
  const usable_days = history.days;
  const minimum_days = MINIMUM_TRAINING_DAYS;

  let code = 'READY';
  let message = 'Live forecast ready.';
  let safe_for_live_use = false;
  let model_source = 'none';

  const metadataReady = metadata?.ready === true || metadata?.safe_for_live_use === true;
  const freshness = assessModelFreshness({
    trainedAt: metadata?.trained_at,
    modelDateTo: metadata?.date_to || metadata?.training_end,
    historyDateTo: history.date_to,
  });
  const metadataSourceOk = (
    !metadata
    || metadata.data_source === 'live_bookings'
    || metadata.data_source === 'booking_demand_daily'
    || metadata.dataset === 'booking_demand_daily'
  );

  if (usable_days < minimum_days) {
    code = 'NOT_ENOUGH_HISTORY';
    message =
      `Not enough live booking history to generate a reliable forecast. Found ${usable_days} days; need at least ${minimum_days}.`;
  } else if (!hasModel) {
    code = 'MODEL_MISSING';
    message = 'No trained model available. Sync training data to train the model.';
  } else if (!metadata) {
    code = 'MODEL_UNVERIFIED';
    message =
      'Forecast model has no verified metadata. Retrain before using operational forecasts.';
    model_source = 'unverified';
  } else if (metadata.is_demo) {
    code = 'DEMO_MODEL';
    message = 'Demo forecast only. Do not use for staffing, pricing, or promotional decisions.';
    model_source = 'demo';
  } else if (!metadataSourceOk) {
    code = 'MODEL_UNVERIFIED';
    message = 'Forecast model was not trained on verified live booking data.';
    model_source = metadata.data_source || 'unknown';
  } else if (Number(metadata.usable_days || metadata.training_days || 0) < minimum_days) {
    code = 'MODEL_STALE';
    message =
      `Trained model only used ${metadata.usable_days || metadata.training_days} days of data. Retrain with at least ${minimum_days} days.`;
    model_source = 'live_bookings';
  } else if (metadata.ready === false || metadata.safe_for_live_use === false) {
    code = 'MODEL_NOT_READY';
    message = 'Trained models failed readiness checks and are not safe for live forecasts.';
    model_source = 'live_bookings';
  } else if (!metadataReady) {
    code = 'MODEL_NOT_READY';
    message = 'Trained models are missing a positive readiness flag.';
    model_source = 'live_bookings';
  } else if (!freshness.fresh) {
    code = 'MODEL_STALE';
    message = freshness.newer_history_available
      ? `New booking-demand history is available through ${history.date_to}; retrain the model before operational use.`
      : `Forecast model is ${freshness.age_days ?? 'an unknown number of'} days old; maximum allowed age is ${freshness.maximum_age_days} days.`;
    model_source = 'live_bookings';
  } else {
    safe_for_live_use = true;
    model_source = 'live_bookings';
    message = `Model trained using ${metadata.usable_days || metadata.training_days} days of live booking history.`;
  }

  return {
    safe_for_live_use,
    code,
    message,
    readiness: {
      usable_days,
      minimum_days,
      history_date_from: history.date_from,
      history_date_to: history.date_to,
      total_bookings_in_history: history.total_bookings,
      total_guests_in_history: history.total_guests,
      dataset: history.dataset,
    },
    model: {
      available: hasModel,
      guests_model_available: hasGuestsModel,
      source: model_source,
      safe_for_live_use,
      metadata: metadata || null,
      trained_at: metadata?.trained_at || null,
      model_version: metadata?.model_version || null,
      baseline_note: deriveBaselineNote(metadata),
      freshness,
    },
    training: {
      status: safe_for_live_use ? 'ready' : code === 'NOT_ENOUGH_HISTORY' ? 'skipped' : 'unavailable',
      reason: safe_for_live_use ? null : code,
      usable_days,
      minimum_days,
    },
  };
}
