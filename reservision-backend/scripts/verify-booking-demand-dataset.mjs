import assert from 'node:assert/strict';
import {
  buildContinuousDemandRows,
  normalizeArrivalBooking,
  PredictionDatasetValidationError,
  validateDemandRows,
} from '../services/predictionTrainingService.js';

const exactBooking = {
  booking_id: 1,
  arrival_date: '2026-07-01',
  booking_status: 'Checked-Out',
  total_guests: 3,
  adults: 2,
  children: 1,
  seniors: 0,
  infants: 0,
  guest_breakdown_provided: 1,
};

const unknownBooking = {
  booking_id: 2,
  arrival_date: '2026-07-01',
  booking_status: 'Completed',
  total_guests: 2,
  adults: 2,
  children: 0,
  seniors: 0,
  infants: 0,
  guest_breakdown_provided: 0,
};

const laterBooking = {
  booking_id: 3,
  arrival_date: '2026-07-03',
  booking_status: 'Checked-In',
  total_guests: 1,
  adults: 1,
  children: 0,
  seniors: 0,
  infants: 0,
  guest_breakdown_provided: 1,
};

const normalizedUnknown = normalizeArrivalBooking(unknownBooking);
assert.equal(normalizedUnknown.adults, 0);
assert.equal(normalizedUnknown.unknown_guests, 2);
assert.equal(normalizedUnknown.total_guests, 2);

const rows = buildContinuousDemandRows([
  exactBooking,
  unknownBooking,
  laterBooking,
]);

assert.equal(rows.length, 3);
assert.deepEqual(
  rows.map((row) => row.demand_date),
  ['2026-07-01', '2026-07-02', '2026-07-03']
);

assert.deepEqual(
  {
    bookings: rows[0].bookings,
    guests: rows[0].guests,
    adults: rows[0].adults,
    children: rows[0].children,
    unknown: rows[0].unknown_guests,
    coverage: rows[0].guest_mix_coverage_pct,
  },
  {
    bookings: 2,
    guests: 5,
    adults: 2,
    children: 1,
    unknown: 2,
    coverage: 60,
  }
);

assert.deepEqual(
  {
    bookings: rows[1].bookings,
    guests: rows[1].guests,
    unknown: rows[1].unknown_guests,
    coverage: rows[1].guest_mix_coverage_pct,
  },
  {
    bookings: 0,
    guests: 0,
    unknown: 0,
    coverage: 100,
  }
);

assert.equal(validateDemandRows(rows).valid, true);

assert.throws(
  () => buildContinuousDemandRows([exactBooking, { ...exactBooking }]),
  (error) => (
    error instanceof PredictionDatasetValidationError
    && error.details.booking_id === 1
  )
);

assert.throws(
  () => normalizeArrivalBooking({
    ...exactBooking,
    booking_id: 4,
    total_guests: 2,
    adults: 2,
    children: 1,
  }),
  (error) => (
    error instanceof PredictionDatasetValidationError
    && error.details.known_guests === 3
  )
);

console.log('booking_demand_daily verification passed');
