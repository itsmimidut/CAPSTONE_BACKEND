import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAnalyticsFilters } from '../services/analyticsService.js';

test('normalizes analytics filters through fixed allowlists', () => {
  assert.deepEqual(parseAnalyticsFilters({
    date_from: '2026-08-01',
    date_to: '2026-08-07',
    category: 'Revenue',
    status: 'Checked-In',
  }), {
    dateFrom: '2026-08-01',
    dateTo: '2026-08-07',
    status: 'in_progress',
    transactionStatus: 'in_progress',
    categoryType: null,
    category: 'revenue',
    module: 'revenue',
  });
});

test('rejects reversed analytics dates', () => {
  assert.throws(
    () => parseAnalyticsFilters({ date_from: '2026-08-08', date_to: '2026-08-07' }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_DATE_RANGE',
  );
});

test('rejects analytics ranges over 366 days', () => {
  assert.throws(
    () => parseAnalyticsFilters({ date_from: '2025-01-01', date_to: '2026-01-02' }),
    (error) => error.statusCode === 400 && error.code === 'DATE_RANGE_TOO_LARGE',
  );
});

test('rejects unsupported category and status values', () => {
  assert.throws(
    () => parseAnalyticsFilters({ date_from: '2026-08-01', date_to: '2026-08-07', category: 'database' }),
    (error) => error.code === 'INVALID_CATEGORY',
  );
  assert.throws(
    () => parseAnalyticsFilters({ date_from: '2026-08-01', date_to: '2026-08-07', status: "paid' OR 1=1 --" }),
    (error) => error.code === 'INVALID_STATUS',
  );
});
