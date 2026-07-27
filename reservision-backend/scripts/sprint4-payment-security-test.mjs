/**
 * Sprint 4 — Payment & Financial Security validation
 * Run: node scripts/sprint4-payment-security-test.mjs
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCsrfToken } from '../utils/csrfCookie.js';
import { claimWebhookEvent } from '../middleware/idempotency.js';

dotenv.config();

const BASE = process.env.API_BASE || 'http://localhost:8000';
const WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN || 'test-webhook-token';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const postWebhook = async (body, headers = {}) => {
  return fetch(`${BASE}/api/xendit/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
};

async function main() {
  console.log('\nSprint 4 Payment Security Tests\n');

  // Task 01 — webhook verification
  try {
    const invalid = await postWebhook({ status: 'PAID', id: 'inv-test', external_id: '1' });
    let invalidBody = {};
    try { invalidBody = await invalid.json(); } catch { invalidBody = {}; }
    record(
      'Task 01: Invalid webhook token returns 401',
      invalid.status === 401 && invalidBody.error === 'INVALID_WEBHOOK_SIGNATURE',
      `status=${invalid.status}`,
    );

    const valid = await postWebhook(
      { status: 'PAID', id: 'inv-valid-1', external_id: '999999', amount: 100 },
      { 'x-callback-token': WEBHOOK_TOKEN },
    );
    record(
      'Task 01: Valid webhook token is accepted',
      valid.status === 200,
      `status=${valid.status}`,
    );
  } catch (error) {
    record('Task 01: Webhook endpoint reachable', false, error.message);
  }

  // Task 02 — idempotency (unit + integration)
  const testEventId = `sprint4-test-${Date.now()}`;
  const firstClaim = await claimWebhookEvent(testEventId, 'test.invoice.paid');
  const secondClaim = await claimWebhookEvent(testEventId, 'test.invoice.paid');
  record('Task 02: First webhook event claim succeeds', firstClaim === true);
  record('Task 02: Duplicate webhook event claim is ignored', secondClaim === false);

  try {
    const uniqueSuffix = Date.now();
    const payload = {
      status: 'PAID',
      id: `inv-dup-${uniqueSuffix}`,
      external_id: `sprint4-nonexistent-${uniqueSuffix}`,
      amount: 50,
      updated: `sprint4-${uniqueSuffix}`,
    };
    const headers = { 'x-callback-token': WEBHOOK_TOKEN };

    const first = await postWebhook(payload, headers);
    let firstBody = {};
    try { firstBody = await first.json(); } catch { firstBody = {}; }

    const second = await postWebhook(payload, headers);
    let secondBody = {};
    try { secondBody = await second.json(); } catch { secondBody = {}; }

    record(
      'Task 02: First webhook processed',
      first.status === 200 && firstBody.duplicate !== true,
      `status=${first.status}, duplicate=${firstBody.duplicate}`,
    );
    record(
      'Task 02: Duplicate webhook ignored',
      second.status === 200 && secondBody.duplicate === true,
      `status=${second.status}`,
    );
  } catch (error) {
    record('Task 02: Duplicate webhook integration', false, error.message);
  }

  // Task 03 — refund service module exists
  try {
    const refundModule = await import('../services/xenditRefundService.js');
    record(
      'Task 03: Xendit refund service exported',
      typeof refundModule.createXenditRefund === 'function'
        && typeof refundModule.processApprovedRefundViaXendit === 'function',
    );
  } catch (error) {
    record('Task 03: Xendit refund service exported', false, error.message);
  }

  // Task 04 — audit logger module
  try {
    const auditModule = await import('../utils/auditLogger.js');
    record(
      'Task 04: Audit logger exported',
      typeof auditModule.logAudit === 'function'
        && auditModule.AUDIT_ACTIONS?.REFUND_APPROVED === 'REFUND_APPROVED',
    );
  } catch (error) {
    record('Task 04: Audit logger exported', false, error.message);
  }

  // Task 05 — backup script exists
  const backupScript = path.join(__dirname, 'backupDatabase.js');
  record('Task 05: Backup script exists', fs.existsSync(backupScript), backupScript);

  // Task 06 — logger module
  try {
    const loggerModule = await import('../utils/logger.js');
    loggerModule.logSecurityEvent('RATE_LIMIT_TRIGGERED', {
      user_id: 0,
      ip_address: '127.0.0.1',
      timestamp: new Date().toISOString(),
    });
    const securityLog = path.join(__dirname, '..', 'logs', 'security.log');
    record(
      'Task 06: Security log entry created',
      fs.existsSync(securityLog),
      securityLog,
    );
  } catch (error) {
    record('Task 06: Security log entry created', false, error.message);
  }

  // CSRF still works (regression)
  const token = generateCsrfToken();
  const csrfBlocked = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
  });
  record(
    'Regression: CSRF still enforced on login',
    csrfBlocked.status === 403,
    `status=${csrfBlocked.status}`,
  );

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nSummary: ${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
