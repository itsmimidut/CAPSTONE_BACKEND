import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuousDemandRows,
  validateDemandRows,
} from '../services/predictionTrainingService.js';

test('Phase 2 demand rows remain continuous and valid for Phase 3 training input', () => {
  const rows = buildContinuousDemandRows([
    {
      booking_id: 1,
      arrival_date: '2026-01-01',
      booking_status: 'Completed',
      adults: 2,
      children: 0,
      seniors: 0,
      infants: 0,
      total_guests: 2,
      guest_breakdown_provided: 1,
    },
    {
      booking_id: 2,
      arrival_date: '2026-01-03',
      booking_status: 'Checked-In',
      adults: 1,
      children: 1,
      seniors: 0,
      infants: 0,
      total_guests: 2,
      guest_breakdown_provided: 1,
    },
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[1].demand_date, '2026-01-02');
  assert.equal(rows[1].bookings, 0);
  assert.doesNotThrow(() => validateDemandRows(rows));
});

test('Phase 3 training gate expects at least 120 continuous demand days', () => {
  const minimumDays = Number(process.env.PREDICTION_MINIMUM_DEMAND_DAYS || 120);
  assert.equal(minimumDays, 120);

  const sequential = Array.from({ length: 77 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index));
    return {
      booking_id: index + 1,
      arrival_date: date.toISOString().slice(0, 10),
      booking_status: 'Completed',
      adults: 2,
      children: 0,
      seniors: 0,
      infants: 0,
      total_guests: 2,
      guest_breakdown_provided: 1,
    };
  });

  const rows = buildContinuousDemandRows(sequential);
  assert.equal(rows.length, 77);
  assert.ok(rows.length < minimumDays);
  assert.doesNotThrow(() => validateDemandRows(rows));
});
