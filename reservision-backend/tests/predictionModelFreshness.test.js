import test from 'node:test';
import assert from 'node:assert/strict';

import { assessModelFreshness } from '../services/predictionModelService.js';

const now = new Date('2026-08-10T00:00:00Z');

test('forecast model is fresh when recent and trained through current history', () => {
  assert.deepEqual(assessModelFreshness({
    trainedAt: '2026-07-26T09:26:12Z', modelDateTo: '2026-07-26', historyDateTo: '2026-07-26', now, maxAgeDays: 30,
  }), { fresh: true, age_days: 14, maximum_age_days: 30, newer_history_available: false });
});

test('forecast model is stale when newer demand history exists', () => {
  const result = assessModelFreshness({
    trainedAt: '2026-08-09T00:00:00Z', modelDateTo: '2026-08-01', historyDateTo: '2026-08-09', now, maxAgeDays: 30,
  });
  assert.equal(result.fresh, false);
  assert.equal(result.newer_history_available, true);
});

test('forecast model is stale after the configured maximum age', () => {
  const result = assessModelFreshness({
    trainedAt: '2026-06-01T00:00:00Z', modelDateTo: '2026-06-01', historyDateTo: '2026-06-01', now, maxAgeDays: 30,
  });
  assert.equal(result.fresh, false);
  assert.equal(result.age_days, 70);
});
