import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOccupiedDateRange, reserveInventoryDateRange } from '../services/reservationConflictService.js';

test('builds a checkout-exclusive occupied date range', () => {
  assert.deepEqual(buildOccupiedDateRange('2026-08-10', '2026-08-13'), ['2026-08-10', '2026-08-11', '2026-08-12']);
});

test('rejects reversed and zero-night stays', () => {
  assert.throws(() => buildOccupiedDateRange('2026-08-10', '2026-08-10'), error => error.code === 'INVALID_DATE_RANGE');
  assert.throws(() => buildOccupiedDateRange('2026-08-11', '2026-08-10'), error => error.code === 'INVALID_DATE_RANGE');
});

test('locks inventory before checking and reserving dates', async () => {
  const calls = [];
  const connection = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM inventory_items/i.test(sql)) return [[{ item_id: 4, name: 'Room 4' }]];
    if (/FROM occupied_dates/i.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  } };
  const dates = await reserveInventoryDateRange(connection, { inventoryItemId: 4, bookingId: 9, startDate: '2026-08-10', endDate: '2026-08-12', itemName: 'Room 4' });
  assert.deepEqual(dates, ['2026-08-10', '2026-08-11']);
  assert.match(calls[0].sql, /inventory_items.*FOR UPDATE/is);
  assert.match(calls[1].sql, /occupied_dates.*FOR UPDATE/is);
  assert.equal(calls.filter(call => /^INSERT INTO occupied_dates/i.test(call.sql)).length, 2);
});

test('rejects a conflicting date without inserting occupancy', async () => {
  const calls = [];
  const connection = { query: async (sql) => {
    calls.push(sql);
    if (/FROM inventory_items/i.test(sql)) return [[{ item_id: 4 }]];
    if (/FROM occupied_dates/i.test(sql)) return [[{ occupied_date: '2026-08-11', booking_id: 2, booking_reference: 'BK2' }]];
    return [{ affectedRows: 1 }];
  } };
  await assert.rejects(
    reserveInventoryDateRange(connection, { inventoryItemId: 4, bookingId: 9, startDate: '2026-08-10', endDate: '2026-08-12' }),
    error => error.statusCode === 409 && error.code === 'RESERVATION_DATE_CONFLICT',
  );
  assert.equal(calls.some(sql => /^INSERT INTO occupied_dates/i.test(sql)), false);
});

