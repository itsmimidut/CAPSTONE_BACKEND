/**
 * Sprint 3 Tasks 04-06 validation
 * Run: node scripts/sprint3-tasks04-06-test.mjs
 */

import dotenv from 'dotenv';
import { generateCsrfToken } from '../utils/csrfCookie.js';

dotenv.config();

const BASE = process.env.API_BASE || 'http://localhost:8000';
const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  console.log('\nSprint 3 Tasks 04-06 Tests\n');

  record('CSRF token generator works', typeof generateCsrfToken() === 'string' && generateCsrfToken().length > 10);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend not reachable.');
    process.exit(1);
  }

  const bootstrap = await fetch(`${BASE}/api/auth/me`, { credentials: 'include' });
  const csrfCookies = typeof bootstrap.headers.getSetCookie === 'function'
    ? bootstrap.headers.getSetCookie()
    : [bootstrap.headers.get('set-cookie')].filter(Boolean);

  record('Bootstrap issues csrf_token cookie', csrfCookies.some((cookie) => cookie.startsWith('csrf_token=')));

  const missingCsrf = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
  });
  let missingBody = {};
  try { missingBody = await missingCsrf.json(); } catch { missingBody = {}; }
  record(
    'Missing CSRF token returns 403',
    missingCsrf.status === 403 && missingBody.code === 'CSRF_MISSING',
    `status=${missingCsrf.status}`,
  );

  const token = generateCsrfToken();
  const invalidCsrf = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `csrf_token=${token}`,
      'X-CSRF-Token': 'invalid-token',
    },
    body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
  });
  let invalidBody = {};
  try { invalidBody = await invalidCsrf.json(); } catch { invalidBody = {}; }
  record(
    'Invalid CSRF token returns 403',
    invalidCsrf.status === 403 && invalidBody.code === 'CSRF_INVALID',
    `status=${invalidCsrf.status}`,
  );

  const validCsrf = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `csrf_token=${token}`,
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
  });
  record(
    'Valid CSRF token passes middleware',
    validCsrf.status !== 403,
    `status=${validCsrf.status}`,
  );

  const meRoute = await fetch(`${BASE}/api/auth/me`, { credentials: 'include' });
  record('GET /api/auth/me route exists', meRoute.status === 401 || meRoute.status === 200, `status=${meRoute.status}`);

  const sessionsRoute = await fetch(`${BASE}/api/auth/sessions`, { credentials: 'include' });
  record('GET /api/auth/sessions route exists', sessionsRoute.status === 401 || sessionsRoute.status === 200, `status=${sessionsRoute.status}`);

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nSummary: ${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
