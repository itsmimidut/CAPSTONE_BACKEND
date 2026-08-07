import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBookingItemType, requireBookingItemType } from '../utils/bookingItemType.js';

test('normalizes supported booking item aliases to ENUM-safe values', () => {
  assert.equal(normalizeBookingItemType('Rooms'), 'Room');
  assert.equal(normalizeBookingItemType('cottages'), 'Cottage');
  assert.equal(normalizeBookingItemType('event_area'), 'Event');
  assert.equal(normalizeBookingItemType('swim'), 'Swimming');
});

test('derives historical types from recognizable item names', () => {
  assert.equal(normalizeBookingItemType('', { itemName: 'FAMILY ROOM 4' }), 'Room');
  assert.equal(normalizeBookingItemType(null, { itemName: 'Functional Hall' }), 'Event');
});

test('rejects unknown types instead of writing an empty ENUM value', () => {
  assert.throws(
    () => requireBookingItemType('Unknown package', { itemName: 'Mystery item' }),
    (error) => error.code === 'INVALID_BOOKING_ITEM_TYPE',
  );
});
