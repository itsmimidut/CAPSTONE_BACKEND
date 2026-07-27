import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/db.js';
import { BLOCKING_BOOKING_STATUSES } from '../constants/bookingStatusRules.js';
import {
  MINIMUM_TRAINING_DAYS,
  quarantineModel,
} from './predictionModelService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRAIN_SCRIPT = path.resolve(__dirname, '../../../Predictive_Analytics/train_real_model.py');

const ACTIVE_STATUSES = [...BLOCKING_BOOKING_STATUSES, 'Completed'];
const DEMAND_TABLE = 'booking_demand_daily';
const ACTUAL_ARRIVAL_STATUSES = new Set(['checked-in', 'checked-out', 'completed']);
const MINIMUM_DEMAND_DAYS = Number(process.env.PREDICTION_MINIMUM_DEMAND_DAYS || 120);
const MINIMUM_GUEST_MIX_COVERAGE_PCT = Number(
  process.env.PREDICTION_MINIMUM_GUEST_MIX_COVERAGE_PCT || 70
);
const REQUIRED_BOOKING_COLUMNS = [
  'booking_id',
  'booking_reference',
  'check_in_date',
  'booking_status',
  'adults',
  'children',
  'total_guests',
  'seniors',
  'infants',
  'guest_breakdown_provided',
];

export class PredictionDatasetValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PredictionDatasetValidationError';
    this.code = 'INVALID_BOOKING_DEMAND_DATASET';
    this.details = details;
  }
}

const toNonNegativeInteger = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
};

const roundPercentage = (value) => Math.round(Number(value || 0) * 100) / 100;

const addDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const parseExcludedBookingIds = () => String(process.env.PREDICTION_EXCLUDED_BOOKING_IDS || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

async function getTableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

function assertBookingDatasetColumns(columns) {
  const missing = REQUIRED_BOOKING_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new PredictionDatasetValidationError(
      'Guest-breakdown migration is required before building booking_demand_daily.',
      { missing_columns: missing }
    );
  }
}

function buildProvenanceFilters(columns) {
  const clauses = [];
  const applied = [];

  if (columns.has('is_test')) {
    clauses.push('COALESCE(b.is_test, 0) = 0');
    applied.push('is_test');
  }
  if (columns.has('is_demo')) {
    clauses.push('COALESCE(b.is_demo, 0) = 0');
    applied.push('is_demo');
  }

  for (const column of ['data_origin', 'record_source', 'data_source']) {
    if (!columns.has(column)) continue;
    clauses.push(
      `LOWER(COALESCE(NULLIF(TRIM(b.${column}), ''), 'live')) NOT IN ('test', 'demo', 'seed', 'synthetic')`
    );
    applied.push(column);
    break;
  }

  if (applied.length) {
    return {
      clauses,
      applied,
      verified: true,
      mode: 'filtered',
      warning: null,
    };
  }

  // No explicit demo/test markers on bookings: treat all rows as live production data.
  // This is still safe for training; excluded booking IDs remain available via env.
  return {
    clauses,
    applied,
    verified: true,
    mode: 'assumed_live_no_markers',
    warning:
      'No explicit test/demo provenance column exists on bookings. All rows are treated as live; configure PREDICTION_EXCLUDED_BOOKING_IDS to drop specific IDs.',
  };
}

async function ensureBookingDemandDailyTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS booking_demand_daily (
      demand_date DATE NOT NULL,
      bookings INT UNSIGNED NOT NULL DEFAULT 0,
      guests INT UNSIGNED NOT NULL DEFAULT 0,
      adults INT UNSIGNED NOT NULL DEFAULT 0,
      children INT UNSIGNED NOT NULL DEFAULT 0,
      seniors INT UNSIGNED NOT NULL DEFAULT 0,
      infants INT UNSIGNED NOT NULL DEFAULT 0,
      unknown_guests INT UNSIGNED NOT NULL DEFAULT 0,
      known_guests INT UNSIGNED NOT NULL DEFAULT 0,
      guest_mix_coverage_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
      actual_arrival_bookings INT UNSIGNED NOT NULL DEFAULT 0,
      confirmed_fallback_bookings INT UNSIGNED NOT NULL DEFAULT 0,
      generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (demand_date),
      CONSTRAINT chk_booking_demand_guest_total
        CHECK (adults + children + seniors + infants + unknown_guests = guests),
      CONSTRAINT chk_booking_demand_known_total
        CHECK (adults + children + seniors + infants = known_guests),
      CONSTRAINT chk_booking_demand_coverage
        CHECK (guest_mix_coverage_pct >= 0 AND guest_mix_coverage_pct <= 100)
    ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
  `);

  // One-time compatibility for the brief Phase 2 draft that used predictive
  // names for historical facts. Historical source columns are bookings/guests.
  const columns = await getTableColumns(connection, DEMAND_TABLE);
  if (columns.has('expected_bookings') && !columns.has('bookings')) {
    await connection.query(
      `ALTER TABLE ${DEMAND_TABLE}
       CHANGE COLUMN expected_bookings bookings INT UNSIGNED NOT NULL DEFAULT 0`
    );
  }
  if (columns.has('expected_guests') && !columns.has('guests')) {
    await connection.query(
      `ALTER TABLE ${DEMAND_TABLE}
       CHANGE COLUMN expected_guests guests INT UNSIGNED NOT NULL DEFAULT 0`
    );
  }
}

/**
 * Convert one booking row into one arrival record.
 *
 * Demographics are considered known only when guest_breakdown_provided=1.
 * Legacy adults/children values may still establish total guest count, but are
 * intentionally assigned to unknown_guests when the explicit flag is absent.
 */
export function normalizeArrivalBooking(row) {
  const adults = toNonNegativeInteger(row.adults);
  const children = toNonNegativeInteger(row.children);
  const seniors = toNonNegativeInteger(row.seniors);
  const infants = toNonNegativeInteger(row.infants);
  const categoryTotal = adults + children + seniors + infants;
  const storedTotal = toNonNegativeInteger(row.total_guests);
  const totalGuests = storedTotal > 0 ? storedTotal : categoryTotal;
  const breakdownProvided = Number(row.guest_breakdown_provided) === 1
    || row.guest_breakdown_provided === true;

  if (!row.booking_id || !row.arrival_date) {
    throw new PredictionDatasetValidationError(
      'Every source booking must have a booking ID and arrival date.',
      { booking_id: row.booking_id || null, arrival_date: row.arrival_date || null }
    );
  }

  if (totalGuests < 1) {
    throw new PredictionDatasetValidationError(
      'Every included arrival booking must contain at least one guest.',
      { booking_id: row.booking_id, total_guests: totalGuests }
    );
  }

  if (breakdownProvided && categoryTotal > totalGuests) {
    throw new PredictionDatasetValidationError(
      'Known demographic counts exceed total guests.',
      {
        booking_id: row.booking_id,
        total_guests: totalGuests,
        known_guests: categoryTotal,
      }
    );
  }

  const status = String(row.booking_status || '').trim().toLowerCase();
  const knownGuests = breakdownProvided ? categoryTotal : 0;

  return {
    booking_id: Number(row.booking_id),
    arrival_date: String(row.arrival_date).slice(0, 10),
    total_guests: totalGuests,
    adults: breakdownProvided ? adults : 0,
    children: breakdownProvided ? children : 0,
    seniors: breakdownProvided ? seniors : 0,
    infants: breakdownProvided ? infants : 0,
    known_guests: knownGuests,
    unknown_guests: totalGuests - knownGuests,
    is_confirmed_fallback: status === 'confirmed',
    is_actual_arrival: ACTUAL_ARRIVAL_STATUSES.has(status),
  };
}

/**
 * Build a complete daily calendar from booking-level arrival records.
 */
export function buildContinuousDemandRows(sourceRows) {
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    throw new PredictionDatasetValidationError(
      'No valid historical arrival bookings were found.',
      { source_rows: 0 }
    );
  }

  const seenBookingIds = new Set();
  const daily = new Map();

  for (const sourceRow of sourceRows) {
    const booking = normalizeArrivalBooking(sourceRow);
    if (seenBookingIds.has(booking.booking_id)) {
      throw new PredictionDatasetValidationError(
        'Duplicate booking ID found while building the demand dataset.',
        { booking_id: booking.booking_id }
      );
    }
    seenBookingIds.add(booking.booking_id);

    const current = daily.get(booking.arrival_date) || {
      demand_date: booking.arrival_date,
      bookings: 0,
      guests: 0,
      adults: 0,
      children: 0,
      seniors: 0,
      infants: 0,
      unknown_guests: 0,
      known_guests: 0,
      actual_arrival_bookings: 0,
      confirmed_fallback_bookings: 0,
    };

    current.bookings += 1;
    current.guests += booking.total_guests;
    current.adults += booking.adults;
    current.children += booking.children;
    current.seniors += booking.seniors;
    current.infants += booking.infants;
    current.unknown_guests += booking.unknown_guests;
    current.known_guests += booking.known_guests;
    current.actual_arrival_bookings += booking.is_actual_arrival ? 1 : 0;
    current.confirmed_fallback_bookings += booking.is_confirmed_fallback ? 1 : 0;
    daily.set(booking.arrival_date, current);
  }

  const dateKeys = [...daily.keys()].sort();
  const start = dateKeys[0];
  const end = dateKeys[dateKeys.length - 1];
  const result = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const row = daily.get(date) || {
      demand_date: date,
      bookings: 0,
      guests: 0,
      adults: 0,
      children: 0,
      seniors: 0,
      infants: 0,
      unknown_guests: 0,
      known_guests: 0,
      actual_arrival_bookings: 0,
      confirmed_fallback_bookings: 0,
    };
    row.guest_mix_coverage_pct = row.guests > 0
      ? roundPercentage((row.known_guests / row.guests) * 100)
      : 100;
    result.push(row);
  }

  return result;
}

export function validateDemandRows(rows) {
  const errors = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push({ code: 'EMPTY_DATASET', message: 'Dataset contains no daily rows.' });
  }

  rows.forEach((row, index) => {
    const demographicTotal = row.adults
      + row.children
      + row.seniors
      + row.infants
      + row.unknown_guests;
    const knownTotal = row.adults + row.children + row.seniors + row.infants;

    if (demographicTotal !== row.guests) {
      errors.push({
        code: 'GUEST_TOTAL_MISMATCH',
        date: row.demand_date,
        guests: row.guests,
        demographic_total: demographicTotal,
      });
    }
    if (knownTotal !== row.known_guests) {
      errors.push({
        code: 'KNOWN_GUEST_TOTAL_MISMATCH',
        date: row.demand_date,
        known_guests: row.known_guests,
        category_total: knownTotal,
      });
    }
    if (row.bookings > 0 && row.guests < row.bookings) {
      errors.push({
        code: 'GUESTS_BELOW_BOOKINGS',
        date: row.demand_date,
        bookings: row.bookings,
        guests: row.guests,
      });
    }
    if (index > 0 && row.demand_date !== addDays(rows[index - 1].demand_date, 1)) {
      errors.push({
        code: 'NON_CONTINUOUS_DATES',
        previous_date: rows[index - 1].demand_date,
        current_date: row.demand_date,
      });
    }
    if (
      row.guest_mix_coverage_pct < 0
      || row.guest_mix_coverage_pct > 100
      || !Number.isFinite(row.guest_mix_coverage_pct)
    ) {
      errors.push({
        code: 'INVALID_COVERAGE',
        date: row.demand_date,
        coverage: row.guest_mix_coverage_pct,
      });
    }
  });

  if (errors.length) {
    throw new PredictionDatasetValidationError(
      'booking_demand_daily failed validation; existing dataset was preserved.',
      { errors: errors.slice(0, 100), error_count: errors.length }
    );
  }

  return {
    valid: true,
    rows: rows.length,
    date_from: rows[0].demand_date,
    date_to: rows[rows.length - 1].demand_date,
  };
}

async function loadArrivalBookingRows(connection, {
  includeConfirmedFallback = false,
} = {}) {
  const columns = await getTableColumns(connection, 'bookings');
  assertBookingDatasetColumns(columns);

  const provenance = buildProvenanceFilters(columns);
  const excludedIds = parseExcludedBookingIds();
  const clauses = [
    'b.check_in_date IS NOT NULL',
    'DATE(b.check_in_date) <= CURDATE()',
    `(
      LOWER(TRIM(b.booking_status)) IN ('checked-in', 'checked-out', 'completed')
      ${includeConfirmedFallback
        ? "OR (LOWER(TRIM(b.booking_status)) = 'confirmed' AND DATE(b.check_in_date) < CURDATE())"
        : ''}
    )`,
    ...provenance.clauses,
  ];
  const params = [];

  if (excludedIds.length) {
    clauses.push('b.booking_id NOT IN (?)');
    params.push(excludedIds);
  }

  const [rows] = await connection.query(
    `SELECT
       b.booking_id,
       b.booking_reference,
       DATE_FORMAT(b.check_in_date, '%Y-%m-%d') AS arrival_date,
       b.booking_status,
       b.payment_status,
       b.total_guests,
       b.adults,
       b.children,
       b.seniors,
       b.infants,
       b.guest_breakdown_provided,
       b.guest_breakdown_type
     FROM bookings b
     WHERE ${clauses.join('\n       AND ')}
     ORDER BY b.check_in_date ASC, b.booking_id ASC`,
    params
  );

  return {
    rows,
    provenance: {
      filters_applied: provenance.applied,
      excluded_booking_ids: excludedIds.length,
      verified: provenance.verified,
      mode: provenance.mode,
      warning: provenance.warning,
    },
  };
}

/**
 * Phase 2 pipeline: rebuild the isolated, validated daily demand dataset.
 * This function never trains a model and never writes legacy prediction tables.
 */
export async function syncBookingDemandDaily({
  includeConfirmedFallback = false,
} = {}) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await ensureBookingDemandDailyTable(connection);

    const source = await loadArrivalBookingRows(connection, { includeConfirmedFallback });
    const rows = buildContinuousDemandRows(source.rows);
    const validation = validateDemandRows(rows);

    await connection.query(`DELETE FROM ${DEMAND_TABLE}`);

    const generatedAt = new Date();
    const values = rows.map((row) => [
      row.demand_date,
      row.bookings,
      row.guests,
      row.adults,
      row.children,
      row.seniors,
      row.infants,
      row.unknown_guests,
      row.known_guests,
      row.guest_mix_coverage_pct,
      row.actual_arrival_bookings,
      row.confirmed_fallback_bookings,
      generatedAt,
    ]);

    await connection.query(
      `INSERT INTO ${DEMAND_TABLE} (
         demand_date,
         bookings,
         guests,
         adults,
         children,
         seniors,
         infants,
         unknown_guests,
         known_guests,
         guest_mix_coverage_pct,
         actual_arrival_bookings,
         confirmed_fallback_bookings,
         generated_at
       ) VALUES ?`,
      [values]
    );

    await connection.commit();

    const totalGuests = rows.reduce((sum, row) => sum + row.guests, 0);
    const knownGuests = rows.reduce((sum, row) => sum + row.known_guests, 0);
    const totalBookings = rows.reduce((sum, row) => sum + row.bookings, 0);
    const coveragePct = totalGuests > 0
      ? roundPercentage((knownGuests / totalGuests) * 100)
      : 100;
    const provenanceVerified = !source.provenance.warning
      || source.provenance.mode === 'assumed_live_no_markers'
      || source.provenance.verified === true;
    const enoughHistory = rows.length >= MINIMUM_DEMAND_DAYS;

    return {
      dataset: DEMAND_TABLE,
      training_started: false,
      status_policy: {
        actual_arrivals: ['Checked-In', 'Checked-Out', 'Completed'],
        confirmed_fallback_enabled: Boolean(includeConfirmedFallback),
        excluded: ['Cancelled', 'Canceled', 'Rejected', 'No-Show', 'No-show', 'Expired', 'Voided'],
      },
      source_bookings: source.rows.length,
      rows_written: rows.length,
      zero_demand_days: rows.filter((row) => row.bookings === 0).length,
      date_from: validation.date_from,
      date_to: validation.date_to,
      totals: {
        bookings: totalBookings,
        guests: totalGuests,
        known_guests: knownGuests,
        unknown_guests: totalGuests - knownGuests,
      },
      guest_mix_coverage_pct: coveragePct,
      readiness: {
        enough_history: enoughHistory,
        minimum_demand_days: MINIMUM_DEMAND_DAYS,
        provenance_verified: provenanceVerified,
        provenance_mode: source.provenance.mode || (provenanceVerified ? 'filtered' : 'unverified'),
        bookings_and_guests_ready: enoughHistory && provenanceVerified,
        guest_mix_ready: (
          enoughHistory
          && provenanceVerified
          && coveragePct >= MINIMUM_GUEST_MIX_COVERAGE_PCT
        ),
        minimum_guest_mix_coverage_pct: MINIMUM_GUEST_MIX_COVERAGE_PCT,
      },
      validation,
      provenance: source.provenance,
      generated_at: generatedAt.toISOString(),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getBookingDemandDaily({
  start = null,
  end = null,
  limit = 400,
} = {}) {
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 400));
  const params = [];
  const clauses = [];

  if (start) {
    clauses.push('demand_date >= ?');
    params.push(start);
  }
  if (end) {
    clauses.push('demand_date <= ?');
    params.push(end);
  }
  params.push(safeLimit);

  const [rows] = await db.query(
    `SELECT
       DATE_FORMAT(demand_date, '%Y-%m-%d') AS demand_date,
       bookings,
       guests,
       adults,
       children,
       seniors,
       infants,
       unknown_guests,
       known_guests,
       guest_mix_coverage_pct,
       actual_arrival_bookings,
       confirmed_fallback_bookings,
       generated_at
     FROM ${DEMAND_TABLE}
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY demand_date ASC
     LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    ...row,
    bookings: Number(row.bookings || 0),
    guests: Number(row.guests || 0),
    adults: Number(row.adults || 0),
    children: Number(row.children || 0),
    seniors: Number(row.seniors || 0),
    infants: Number(row.infants || 0),
    unknown_guests: Number(row.unknown_guests || 0),
    known_guests: Number(row.known_guests || 0),
    guest_mix_coverage_pct: Number(row.guest_mix_coverage_pct || 0),
    actual_arrival_bookings: Number(row.actual_arrival_bookings || 0),
    confirmed_fallback_bookings: Number(row.confirmed_fallback_bookings || 0),
  }));
}

function runPythonTrain() {
  return new Promise((resolve, reject) => {
    execFile('python', [TRAIN_SCRIPT], { timeout: 600_000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message || 'Model training failed'));
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function extractJsonPayload(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Fall through — training scripts may print human-readable lines before JSON.
  }

  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function runPythonPhase3Train({
  checkOnly = false,
  provenanceVerified = true,
  testDays = 28,
} = {}) {
  const args = [
    TRAIN_SCRIPT,
    `--provenance-verified=${provenanceVerified ? 'true' : 'false'}`,
    `--test-days=${Math.max(7, Number(testDays) || 28)}`,
  ];
  if (checkOnly) args.push('--check-only');

  return new Promise((resolve) => {
    execFile('python', args, { timeout: 600_000 }, (err, stdout, stderr) => {
      const output = String(stdout || '').trim();
      const payload = extractJsonPayload(output);
      resolve({
        ok: !err && payload?.ready === true,
        exit_code: err?.code ?? (payload?.ready ? 0 : 2),
        output,
        stderr: String(stderr || '').trim(),
        result: payload,
      });
    });
  });
}

/**
 * Phase 3 gatekeeper: inspect booking_demand_daily before any model training.
 */
export async function assessForecastTrainingReadiness() {
  const blockingReasons = [];
  let rows = [];
  let provenanceVerified = true;

  try {
    rows = await getBookingDemandDaily({ limit: 5000 });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      blockingReasons.push('Dataset not verified: booking_demand_daily has not been created');
      return {
        ready: false,
        blocking_reasons: blockingReasons,
        model_version: '3.0',
        training_days: 0,
        minimum_training_days: MINIMUM_DEMAND_DAYS,
        dataset: DEMAND_TABLE,
      };
    }
    throw error;
  }

  if (!rows.length) {
    blockingReasons.push('Dataset validation failed: booking_demand_daily is empty');
  } else {
    try {
      validateDemandRows(rows.map((row) => ({
        ...row,
        adults: Number(row.adults || 0),
        children: Number(row.children || 0),
        seniors: Number(row.seniors || 0),
        infants: Number(row.infants || 0),
        unknown_guests: Number(row.unknown_guests || 0),
        known_guests: Number(row.known_guests || 0),
        guests: Number(row.guests || 0),
        bookings: Number(row.bookings || 0),
        guest_mix_coverage_pct: Number(row.guest_mix_coverage_pct || 0),
      })));
    } catch (error) {
      if (error?.code === 'INVALID_BOOKING_DEMAND_DATASET') {
        blockingReasons.push('Dataset validation failed');
      } else {
        throw error;
      }
    }
  }

  const trainingDays = rows.length;
  if (trainingDays < MINIMUM_DEMAND_DAYS) {
    blockingReasons.push(
      `History below ${MINIMUM_DEMAND_DAYS} days (${trainingDays}/${MINIMUM_DEMAND_DAYS})`
    );
  }

  const totalGuests = rows.reduce((sum, row) => sum + Number(row.guests || 0), 0);
  const knownGuests = rows.reduce((sum, row) => sum + Number(row.known_guests || 0), 0);
  const guestMixCoveragePct = totalGuests > 0
    ? roundPercentage((knownGuests / totalGuests) * 100)
    : 100;

  // Best-effort provenance signal from bookings table (same filters as Phase 2).
  let provenanceMode = 'unknown';
  let provenanceWarning = null;
  try {
    const columns = await getTableColumns(db, 'bookings');
    const provenance = buildProvenanceFilters(columns);
    provenanceVerified = provenance.verified !== false;
    provenanceMode = provenance.mode || (provenanceVerified ? 'filtered' : 'unverified');
    provenanceWarning = provenance.warning;
    if (!provenanceVerified) {
      blockingReasons.push('Provenance not verified');
    }
  } catch {
    // If bookings schema cannot be inspected, do not block training on an
    // already-validated booking_demand_daily dataset.
    provenanceVerified = true;
    provenanceMode = 'dataset_trusted';
    provenanceWarning = 'Could not inspect bookings schema; trusting booking_demand_daily.';
  }

  return {
    ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    model_version: '3.0',
    training_days: trainingDays,
    minimum_training_days: MINIMUM_DEMAND_DAYS,
    date_from: rows[0]?.demand_date || null,
    date_to: rows[rows.length - 1]?.demand_date || null,
    guest_mix_coverage_pct: guestMixCoveragePct,
    guest_mix_ready: guestMixCoveragePct >= MINIMUM_GUEST_MIX_COVERAGE_PCT,
    minimum_guest_mix_coverage_pct: MINIMUM_GUEST_MIX_COVERAGE_PCT,
    provenance_verified: provenanceVerified,
    provenance_mode: provenanceMode,
    provenance_warning: provenanceWarning,
    dataset: DEMAND_TABLE,
  };
}

/**
 * Phase 3 training pipeline.
 * Never trains when readiness fails. Never writes model files on abort.
 */
export async function trainForecastModels({
  checkOnly = false,
  testDays = 28,
} = {}) {
  const readiness = await assessForecastTrainingReadiness();

  if (!readiness.ready) {
    quarantineModel();
    return {
      ready: false,
      blocking_reasons: readiness.blocking_reasons,
      model_version: '3.0',
      trained: false,
      training_started: false,
      message: 'Training Aborted',
      readiness,
    };
  }

  const python = await runPythonPhase3Train({
    checkOnly,
    provenanceVerified: readiness.provenance_verified,
    testDays,
  });

  const result = python.result || {
    ready: false,
    blocking_reasons: [
      python.stderr || 'Python training script did not return a readiness payload',
    ],
    model_version: '3.0',
    trained: false,
  };

  if (!result.ready) {
    quarantineModel();
  }

  return {
    ...result,
    training_started: !checkOnly && readiness.ready,
    python_exit_code: python.exit_code,
    python_output: python.output.slice(-4000),
    readiness,
  };
}

/**
 * Rebuild bookings_daily from live bookings (stay/check-in dates).
 * Uses check_in_date when present, otherwise booking created_at date.
 */
export async function syncBookingsDailyFromLive(connection = null) {
  const conn = connection || db;
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');

  const [aggregated] = await conn.query(
    `
    SELECT
      stay_date,
      COUNT(*) AS total_bookings
    FROM (
      SELECT
        COALESCE(DATE(b.check_in_date), DATE(b.created_at)) AS stay_date
      FROM bookings b
      WHERE b.booking_status IN (${placeholders})
        AND COALESCE(b.check_in_date, b.created_at) IS NOT NULL
    ) AS src
    WHERE stay_date IS NOT NULL
    GROUP BY stay_date
  `,
    ACTIVE_STATUSES
  );

  await conn.query('DELETE FROM bookings_daily');

  if (aggregated.length > 0) {
    const values = aggregated.map((row) => [
      row.stay_date,
      Number(row.total_bookings || 0),
    ]);
    await conn.query(
      'INSERT INTO bookings_daily (check_in_date, total_bookings) VALUES ?',
      [values]
    );
  }

  const dates = aggregated.map((r) => r.stay_date).sort();
  return {
    rows_written: aggregated.length,
    date_from: dates[0] || null,
    date_to: dates[dates.length - 1] || null,
    total_bookings: aggregated.reduce((sum, row) => sum + Number(row.total_bookings || 0), 0),
  };
}

export async function syncAndRetrainModel({ retrain = true } = {}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const syncResult = await syncBookingsDailyFromLive(connection);
    await connection.commit();

    let training = null;
    if (retrain) {
      if (syncResult.rows_written < MINIMUM_TRAINING_DAYS) {
        quarantineModel();
        training = {
          skipped: true,
          status: 'skipped',
          reason: 'NOT_ENOUGH_HISTORY',
          message: `Need at least ${MINIMUM_TRAINING_DAYS} days of history for training; found ${syncResult.rows_written}.`,
          usable_days: syncResult.rows_written,
          minimum_days: MINIMUM_TRAINING_DAYS,
        };
      } else {
        const output = await runPythonTrain();
        training = {
          skipped: false,
          status: 'completed',
          output: output.slice(-2000),
          usable_days: syncResult.rows_written,
          minimum_days: MINIMUM_TRAINING_DAYS,
        };
      }
    }

    return {
      sync: syncResult,
      training,
      model: {
        available: !training?.skipped,
        source: training?.skipped ? 'quarantined_or_missing' : 'live_bookings',
        safe_for_live_use: !training?.skipped,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
