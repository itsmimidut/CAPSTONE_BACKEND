import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastRecommendations,
  computeForecastSummary,
  toLegacyPromoSuggestion,
} from '../services/forecastRecommendationService.js';

const rows = (bookings, {
  start = '2026-08-10',
  guestsMultiplier = 2,
  mix = null,
} = {}) => bookings.map((value, index) => ({
  date: `2026-08-${String(Number(start.slice(-2)) + index).padStart(2, '0')}`,
  predicted_bookings: value,
  predicted_total_guests: value * guestsMultiplier,
  estimated_guest_mix: mix?.[index] || null,
}));

test('low demand produces a transparent recovery recommendation', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([1, 1, 2]),
    recentBaselineAverage: 4,
    now: '2026-08-01',
  });
  assert.equal(result.promotions[0].code, 'LOW_DEMAND_RECOVERY');
  assert.equal(result.promotions[0].reason.recent_baseline_average, 4);
});

test('high demand produces capacity review guidance', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([6, 7, 8]),
    recentBaselineAverage: 4,
    now: '2026-08-01',
  });
  assert.equal(result.operations[0].code, 'HIGH_DEMAND_CAPACITY_REVIEW');
  assert.equal(result.operations[0].priority, 'high');
});

test('moderate demand maintains normal operations', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([4, 4, 5]),
    recentBaselineAverage: 4,
    now: '2026-08-01',
  });
  assert.equal(result.operations[0].code, 'MODERATE_DEMAND_MONITOR');
});

test('insufficient guest coverage never creates demographic recommendations', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([3, 3, 3]),
    guestMix: { ready: false, coverage_pct: 0, minimum_coverage_pct: 70 },
    recentBaselineAverage: 3,
    now: '2026-08-01',
  });
  assert.equal(result.activities.length, 0);
  assert.equal(result.monitoring[0].code, 'GUEST_MIX_UNAVAILABLE');
});

test('demographic activity requires both share and absolute count', () => {
  const lowCount = buildForecastRecommendations({
    forecasts: rows([2], {
      mix: [{ adults: 1, children: 3, seniors: 0, infants: 0 }],
    }),
    guestMix: { ready: true },
    recentBaselineAverage: 2,
    now: '2026-08-01',
  });
  assert.equal(lowCount.activities.length, 0);

  const qualifying = buildForecastRecommendations({
    forecasts: rows([5, 5], {
      mix: [
        { adults: 4, children: 5, seniors: 0, infants: 1 },
        { adults: 4, children: 5, seniors: 0, infants: 1 },
      ],
    }),
    guestMix: { ready: true },
    recentBaselineAverage: 5,
    now: '2026-08-01',
  });
  assert.equal(qualifying.activities[0].code, 'FAMILY_ACTIVITY_REVIEW');
});

test('lead time blocks recovery and demographic actions', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([1], {
      start: '2026-08-02',
      mix: [{ adults: 3, children: 8, seniors: 0, infants: 0 }],
    }),
    guestMix: { ready: true },
    recentBaselineAverage: 5,
    now: '2026-08-01',
  });
  assert.equal(result.promotions.length, 0);
  assert.equal(result.activities.length, 0);
});

test('every generated recommendation contains reason metadata', () => {
  const result = buildForecastRecommendations({
    forecasts: rows([1, 2]),
    recentBaselineAverage: 5,
    now: '2026-08-01',
  });
  for (const category of Object.values(result)) {
    for (const item of category) {
      assert.equal(typeof item.reason, 'object');
      assert.ok(item.code);
    }
  }
});

test('empty forecasts return empty recommendation categories', () => {
  const result = buildForecastRecommendations({ forecasts: [] });
  assert.deepEqual(result, {
    operations: [],
    promotions: [],
    activities: [],
    monitoring: [],
  });
});

test('summary computes bookings, guests, averages, and peak', () => {
  assert.deepEqual(computeForecastSummary(rows([1, 3, 2])), {
    total_predicted_bookings: 6,
    total_predicted_guests: 12,
    average_daily_bookings: 2,
    average_daily_guests: 4,
    peak_date: '2026-08-11',
    peak_predicted_bookings: 3,
    peak_predicted_guests: 6,
  });
});

test('legacy promo compatibility maps structured recommendations', () => {
  const recommendations = buildForecastRecommendations({
    forecasts: rows([1, 1]),
    recentBaselineAverage: 5,
    now: '2026-08-01',
  });
  const legacy = toLegacyPromoSuggestion(recommendations);
  assert.equal(legacy.demand_level, 'Low');
  assert.ok(legacy.headline);
  assert.ok(Array.isArray(legacy.actions));
});
