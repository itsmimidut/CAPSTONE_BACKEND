import test from 'node:test';
import assert from 'node:assert/strict';

import { finalizeBookingsForPaidTransaction } from '../services/bookingCheckoutService.js';

test('POS payment marks a booking paid without confirming or checking it in', async () => {
  const calls = [];
  const connection = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };

  const result = await finalizeBookingsForPaidTransaction(
    connection,
    [{ bookingId: 243 }],
    12,
  );

  assert.equal(result.updated, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /SET payment_status = \?/i);
  assert.doesNotMatch(calls[0].sql, /booking_status\s*=/i);
  assert.doesNotMatch(calls[0].sql, /actual_check_in_time/i);
  assert.deepEqual(calls[0].params, ['Paid', 243, 'Paid']);
  assert.match(calls[1].sql, /INSERT INTO booking_logs/i);
  assert.equal(calls[1].params[1], 'payment_received');
});
