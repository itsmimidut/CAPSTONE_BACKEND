import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateForecastRangeInput,
  reconcileForecastRow,
} from '../services/predictionForecastService.js';
import {
  deriveBaselineNote,
  toDateOnly,
} from '../services/predictionModelService.js';

test('forecast range validation rejects missing or malformed dates', () => {
  assert.equal(validateForecastRangeInput({}).ok, false);
  assert.equal(validateForecastRangeInput({ startDate: '2026-08-01' }).ok, false);
  assert.equal(
    validateForecastRangeInput({ startDate: '2026/08/01', endDate: '2026-08-10' }).code,
    'INVALID_START_DATE',
  );
  assert.equal(
    validateForecastRangeInput({ startDate: '2026-08-01', endDate: '2026-13-40' }).code,
    'INVALID_END_DATE',
  );
});

test('forecast range validation rejects end before start', () => {
  const result = validateForecastRangeInput({
    startDate: '2026-08-20',
    endDate: '2026-08-01',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_RANGE');
  assert.equal(result.message, 'End date must not be earlier than start date');
});

test('forecast range validation rejects ranges longer than 90 days', () => {
  const result = validateForecastRangeInput({
    startDate: '2026-08-01',
    endDate: '2026-11-15',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RANGE_TOO_LARGE');
});

test('forecast range validation accepts a valid 31-day window', () => {
  const result = validateForecastRangeInput({
    startDate: '2026-07-27',
    endDate: '2026-08-26',
  });
  assert.equal(result.ok, true);
  assert.equal(result.days, 31);
});

test('reconciliation clamps negatives and keeps counts as integers', () => {
  const row = reconcileForecastRow({
    date: '2026-08-01',
    predicted_bookings: -3.4,
    bookings_lower: -5,
    bookings_upper: -1,
    predicted_total_guests: -2,
    guests_lower: -9,
    guests_upper: -1,
  });

  assert.equal(row.predicted_bookings, 0);
  assert.equal(row.bookings_lower, 0);
  assert.equal(row.bookings_upper, 0);
  assert.equal(row.predicted_total_guests, 0);
  assert.equal(row.guests_lower, 0);
  assert.equal(row.guests_upper, 0);
});

test('reconciliation enforces guests >= bookings', () => {
  const row = reconcileForecastRow({
    date: '2026-08-01',
    predicted_bookings: 5,
    bookings_lower: 3,
    bookings_upper: 7,
    predicted_total_guests: 2,
    guests_lower: 1,
    guests_upper: 3,
  });

  assert.equal(row.predicted_total_guests, 5);
  assert.ok(row.predicted_total_guests >= row.predicted_bookings);
  assert.ok(row.guests_lower <= row.predicted_total_guests);
  assert.ok(row.guests_upper >= row.predicted_total_guests);
});

test('reconciliation bumps bookings to 1 when guests are positive', () => {
  const row = reconcileForecastRow({
    date: '2026-07-31',
    predicted_bookings: 0,
    bookings_lower: 0,
    bookings_upper: 0,
    predicted_total_guests: 1,
    guests_lower: 0,
    guests_upper: 1,
  });

  assert.equal(row.predicted_bookings, 1);
  assert.equal(row.predicted_total_guests, 1);
  assert.ok(row.bookings_lower <= row.predicted_bookings);
  assert.ok(row.bookings_upper >= row.predicted_bookings);
});

test('reconciliation keeps lower <= prediction <= upper for both targets', () => {
  const row = reconcileForecastRow({
    date: '2026-08-01',
    predicted_bookings: 4,
    bookings_lower: 6,
    bookings_upper: 2,
    predicted_total_guests: 9,
    guests_lower: 12,
    guests_upper: 5,
  });

  assert.ok(row.bookings_lower <= row.predicted_bookings);
  assert.ok(row.predicted_bookings <= row.bookings_upper);
  assert.ok(row.guests_lower <= row.predicted_total_guests);
  assert.ok(row.predicted_total_guests <= row.guests_upper);
});

test('reconciliation never invents demographic categories', () => {
  const row = reconcileForecastRow({
    date: '2026-08-01',
    predicted_bookings: 4,
    predicted_total_guests: 9,
  });
  assert.equal(row.estimated_guest_mix, null);
});

test('toDateOnly keeps date-only values as YYYY-MM-DD', () => {
  assert.equal(toDateOnly('2026-03-11'), '2026-03-11');
  assert.equal(toDateOnly('2026-03-11T00:00:00.000Z'), '2026-03-11');
  // Local calendar Date objects should keep their local Y-M-D, not UTC-shifted ISO.
  assert.equal(toDateOnly(new Date(2026, 2, 11)), '2026-03-11');
});

test('deriveBaselineNote documents perfect zero-demand holdouts', () => {
  assert.equal(
    deriveBaselineNote({
      baseline_note: 'Holdout period contained only zero-demand days.',
    }),
    'Holdout period contained only zero-demand days.',
  );
  assert.equal(
    deriveBaselineNote({
      targets: {
        bookings: {
          baseline_metrics: { mae: 0, rmse: 0, wape: 0 },
        },
      },
    }),
    'Holdout period contained only zero-demand days.',
  );
});
