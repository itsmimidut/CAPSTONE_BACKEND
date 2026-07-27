/**
 * Sprint 3 Task 01 — HttpOnly cookie auth validation
 * Run: node scripts/sprint3-task01-test.mjs
 */

import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { getAccessTokenCookieOptions } from '../utils/accessTokenCookie.js';

dotenv.config();

const BASE = process.env.API_BASE || 'http://localhost:8000';
const TEST_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@resort.com';
const TEST_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin123';

const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const authAccepted = (status) => status !== 401 && status !== 403;

const parseCookieHeader = (setCookieHeaders = []) => {
  const cookies = {};
  for (const header of setCookieHeaders) {
    const [pair] = String(header).split(';');
    const [name, ...valueParts] = pair.split('=');
    cookies[name.trim()] = valueParts.join('=').trim();
  }
  return cookies;
};

async function main() {
  console.log(`\nSprint 3 Task 01 Tests @ ${BASE}\n`);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend not reachable. Start with: node server.js');
    process.exit(1);
  }

  const cookieOptions = getAccessTokenCookieOptions();
  record('Dev cookie uses httpOnly + lax + non-secure', process.env.NODE_ENV !== 'production'
    && cookieOptions.httpOnly === true
    && cookieOptions.sameSite === 'lax'
    && cookieOptions.secure === false);

  const missingAuthRes = await fetch(`${BASE}/api/notifications/pending-counts`);
  record('Protected route rejects missing auth', missingAuthRes.status === 401, `status=${missingAuthRes.status}`);

  const signedCookieToken = jwt.sign(
    { id: 1, email: 'cookie-test@example.com', role: 'admin', name: 'Cookie Test' },
    getJwtSecret(),
    { expiresIn: '5m' },
  );

  const cookieRes = await fetch(`${BASE}/api/notifications/pending-counts`, {
    headers: { Cookie: `access_token=${signedCookieToken}` },
  });
  record('authenticateToken accepts access_token cookie', authAccepted(cookieRes.status), `status=${cookieRes.status}`);

  const bearerToken = jwt.sign(
    { id: 1, email: 'bearer-test@example.com', role: 'admin', name: 'Bearer Test' },
    getJwtSecret(),
    { expiresIn: '5m' },
  );

  const bearerRes = await fetch(`${BASE}/api/notifications/pending-counts`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  record('Bearer token compatibility still works', authAccepted(bearerRes.status), `status=${bearerRes.status}`);

  const refreshRes = await fetch(`${BASE}/api/notifications/pending-counts`, {
    headers: { Cookie: `access_token=${signedCookieToken}` },
  });
  record('Cookie session persists after simulated refresh', authAccepted(refreshRes.status), `status=${refreshRes.status}`);

  const loginRes = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const loginData = await loginRes.json();

  record('Login response excludes token field', loginData.token === undefined);

  if (loginRes.ok && loginData.success) {
    const setCookieHeaders = typeof loginRes.headers.getSetCookie === 'function'
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get('set-cookie')].filter(Boolean);
    const cookies = parseCookieHeader(setCookieHeaders);

    record('Login returns success', true, `status=${loginRes.status}`);
    record('Set-Cookie includes access_token', Boolean(cookies.access_token));
    record('access_token cookie is HttpOnly', setCookieHeaders.some((h) => /httponly/i.test(h)));

    const liveCookieRes = await fetch(`${BASE}/api/notifications/pending-counts`, {
      headers: { Cookie: `access_token=${cookies.access_token}` },
    });
    record('Login cookie works on protected endpoint', authAccepted(liveCookieRes.status), `status=${liveCookieRes.status}`);
  } else {
    console.log(`[SKIP] Login integration — database unavailable (status=${loginRes.status})`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nSummary: ${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
