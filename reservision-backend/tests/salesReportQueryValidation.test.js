import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSalesReportQuery } from '../utils/salesReportQueryValidation.js';

const baseQuery = {
  dateFrom: '2025-08-06',
  dateTo: '2026-08-06',
  channel: 'all',
};

test('sales report accepts a search containing exactly 150 characters', () => {
  const result = validateSalesReportQuery({ ...baseQuery, search: 'a'.repeat(150) });
  assert.equal(result.valid, true);
  assert.equal(result.filters.search.length, 150);
});

test('sales report rejects a search exceeding 150 characters', () => {
  const result = validateSalesReportQuery({ ...baseQuery, search: 'a'.repeat(151) });
  assert.equal(result.valid, false);
  assert.equal(result.message, 'Search must not exceed 150 characters.');
});

test('sales report rejects removed aggregate POS channels', () => {
  for (const channel of ['restaurant_online', 'general_pos']) {
    const result = validateSalesReportQuery({ ...baseQuery, channel });
    assert.equal(result.valid, false);
  }
});
