import test from 'node:test';
import assert from 'node:assert/strict';
import { logAudit } from '../utils/auditLogger.js';

test('audit logger uses the supplied transaction connection', async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      return [{ insertId: 1 }];
    },
  };

  await logAudit({
    userId: 77,
    action: 'FEEDBACK_CREATED',
    entityType: 'BOOKING_FEEDBACK',
    entityId: 101,
    oldValue: null,
    newValue: { moderationStatus: 'pending' },
    req: {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'node-test' },
    },
    connection,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO audit_logs/);
  assert.deepEqual(calls[0].values, [
    77,
    'FEEDBACK_CREATED',
    'BOOKING_FEEDBACK',
    101,
    null,
    JSON.stringify({ moderationStatus: 'pending' }),
    '127.0.0.1',
    'node-test',
  ]);
});

test('audit logger propagates transaction query failures', async () => {
  const connection = {
    async query() {
      throw new Error('forced audit failure');
    },
  };

  await assert.rejects(
    logAudit({
      userId: 77,
      action: 'FEEDBACK_UPDATED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: 101,
      connection,
    }),
    /forced audit failure/,
  );
});
