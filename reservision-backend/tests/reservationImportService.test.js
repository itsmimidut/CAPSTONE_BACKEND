import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeImportRow } from '../services/reservationImportService.js';

test('normalizes a legacy reservation row without recalculating its historical price', () => {
  const row = normalizeImportRow({
    row_number: 7,
    reservation_code: 'OLD-2025-007',
    guest_name: 'Juan Dela Cruz',
    item_type: 'room',
    item_name: 'Family Room 1',
    check_in_date: '2025-04-10',
    check_out_date: '2025-04-12',
    adults: 2,
    children: 1,
    total: 5000,
    amount_paid: 5000,
    payment_status: 'paid',
    booking_status: 'completed',
    payment_method: 'cash',
  });

  assert.equal(row.rowNumber, 7);
  assert.equal(row.legacyReference, 'OLD-2025-007');
  assert.equal(row.firstName, 'Juan');
  assert.equal(row.lastName, 'Dela Cruz');
  assert.equal(row.itemType, 'Room');
  assert.equal(row.totalGuests, 3);
  assert.equal(row.totalAmount, 5000);
  assert.equal(row.paymentStatus, 'Paid');
  assert.equal(row.bookingStatus, 'Checked-Out');
});

test('normalization does not accept arbitrary status and item values', () => {
  const row = normalizeImportRow({
    guest_name: 'Test Guest',
    item_type: 'database',
    booking_status: "confirmed' OR 1=1 --",
    payment_status: 'magic',
  });
  assert.equal(row.itemType, null);
  assert.equal(row.bookingStatus, null);
  assert.equal(row.paymentStatus, null);
});

test('normalization clamps demographic counts and amounts to safe values', () => {
  const row = normalizeImportRow({
    adults: -5,
    children: '2.9',
    seniors: 'invalid',
    total: -100,
    amount_paid: -50,
  });
  assert.equal(row.adults, 0);
  assert.equal(row.children, 2);
  assert.equal(row.seniors, 0);
  assert.equal(row.totalAmount, 0);
  assert.equal(row.amountPaid, 0);
});
