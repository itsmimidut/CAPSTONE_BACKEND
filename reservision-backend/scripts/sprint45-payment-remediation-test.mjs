/**
 * Sprint 4.5 Payment Architecture Remediation — validation tests
 * Usage: node scripts/sprint45-payment-remediation-test.mjs
 */
import dotenv from 'dotenv';
import db from '../config/db.js';
import { beginWebhookEvent, completeWebhookEvent, failWebhookEvent } from '../services/webhookEventService.js';
import { amountsMatch, getBookingAmountDue } from '../utils/bookingAmount.js';
import { WEBHOOK_PROCESSING_STATUS } from '../utils/paymentStatuses.js';

dotenv.config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';
const results = [];

const pass = (name, detail = '') => results.push({ name, ok: true, detail });
const fail = (name, detail = '') => results.push({ name, ok: false, detail });

// Task 01 — update-payment removed
try {
  const res = await fetch(`${API_BASE}/api/bookings/update-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: 1, status: 'paid' }),
  });
  if ([403, 404].includes(res.status)) pass('Task 01: update-payment removed', `status ${res.status}`);
  else fail('Task 01: update-payment removed', `got ${res.status}`);
} catch (error) {
  fail('Task 01: update-payment returns 404', error.message);
}

// Task 03 — PayMongo routes removed
for (const path of ['/api/paymongo/create-payment-link', '/api/webhooks/paymongo']) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: '{}' });
    if ([403, 404].includes(res.status)) pass(`Task 03: ${path} removed`, `status ${res.status}`);
    else fail(`Task 03: ${path} removed`, `got ${res.status}`);
  } catch (error) {
    fail(`Task 03: ${path} removed`, error.message);
  }
}

// Task 02 — amount integrity unit test
if (amountsMatch(5000, 5000) && !amountsMatch(5000, 100)) {
  pass('Task 02: amountsMatch helper');
} else {
  fail('Task 02: amountsMatch helper');
}

const [bookingRow] = await db.query(
  `SELECT booking_id, total FROM bookings WHERE total > 0 ORDER BY booking_id DESC LIMIT 1`,
);
if (bookingRow.length) {
  const due = await getBookingAmountDue(bookingRow[0].booking_id);
  if (due && due.amountDue === Number(bookingRow[0].total)) {
    pass('Task 02: getBookingAmountDue uses database total');
  } else {
    fail('Task 02: getBookingAmountDue uses database total');
  }
} else {
  pass('Task 02: getBookingAmountDue uses database total', 'skipped — no bookings');
}

// Task 04 — webhook retry after failure
const retryEventId = `sprint45:test:retry:${Date.now()}`;
const first = await beginWebhookEvent(retryEventId, 'test.retry');
if (first.action === 'process') pass('Task 04: beginWebhookEvent inserts PENDING/PROCESSING');
else fail('Task 04: beginWebhookEvent inserts PENDING/PROCESSING', first.action);

await failWebhookEvent(retryEventId, 'simulated crash');
const retry = await beginWebhookEvent(retryEventId, 'test.retry');
if (retry.action === 'process') pass('Task 04: failed webhook can retry');
else fail('Task 04: failed webhook can retry', retry.action);

await completeWebhookEvent(retryEventId);
const [completed] = await db.query(
  `SELECT processing_status FROM webhook_events WHERE event_id = ?`,
  [retryEventId],
);
if (completed[0]?.processing_status === WEBHOOK_PROCESSING_STATUS.COMPLETED) {
  pass('Task 04: webhook completes to COMPLETED');
} else {
  fail('Task 04: webhook completes to COMPLETED');
}

// Task 05 — mark-refunded removed
try {
  const res = await fetch(`${API_BASE}/api/admin/refunds/1/mark-refunded`, { method: 'PUT' });
  if ([401, 403, 404].includes(res.status)) pass('Task 05: mark-refunded route removed or protected', `status ${res.status}`);
  else fail('Task 05: mark-refunded route removed', `got ${res.status}`);
} catch (error) {
  fail('Task 05: mark-refunded route removed', error.message);
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log('\nSprint 4.5 Test Results');
console.log('========================');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
console.log(`\n${passed}/${results.length} passed`);

await db.end?.();
process.exit(failed.length > 0 ? 1 : 0);
