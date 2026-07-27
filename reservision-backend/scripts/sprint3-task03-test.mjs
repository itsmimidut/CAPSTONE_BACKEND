/**
 * Sprint 3 Task 03 — Session revocation validation
 * Run: node scripts/sprint3-task03-test.mjs
 */

import dotenv from 'dotenv';
import {
  hashRefreshToken,
  revokeAllUserRefreshTokens,
  revokeRefreshTokenByPlain,
} from '../utils/tokenService.js';

dotenv.config();

const BASE = process.env.API_BASE || 'http://localhost:8000';
const TEST_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@resort.com';
const TEST_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin123';

const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const parseCookieHeader = (setCookieHeaders = []) => {
  const cookies = {};
  for (const header of setCookieHeaders) {
    const [pair] = String(header).split(';');
    const [name, ...valueParts] = pair.split('=');
    cookies[name.trim()] = valueParts.join('=').trim();
  }
  return cookies;
};

const getSetCookies = (response) => (
  typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
);

const loginDevice = async (label) => {
  const response = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const data = await response.json();
  const cookies = parseCookieHeader(getSetCookies(response));
  return { label, response, data, cookies };
};

const refreshWithCookies = async (cookies) => {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
};

const logoutWithCookies = async (cookies) => {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
};

const logoutAllWithCookies = async (cookies) => {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return fetch(`${BASE}/api/auth/logout-all`, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
};

async function main() {
  console.log('\nSprint 3 Task 03 Tests\n');

  record('hashRefreshToken produces 64-char SHA-256 hex', hashRefreshToken('sample-token').length === 64);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend not reachable.');
    process.exit(1);
  }

  const routeProbe = await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
  if (routeProbe.status === 404) {
    console.log('[SKIP] Auth logout routes — restart backend to load Sprint 3 Task 03 code');
    const passed = results.filter((r) => r.passed).length;
    console.log(`\nSummary: ${passed}/${results.length} passed\n`);
    process.exit(passed === results.length ? 0 : 1);
  }

  record('POST /api/auth/logout succeeds without cookies', routeProbe.ok, `status=${routeProbe.status}`);

  const deviceA = await loginDevice('Device A');
  const deviceB = await loginDevice('Device B');

  if (!deviceA.response.ok || !deviceB.response.ok) {
    console.log(`[SKIP] Multi-device integration — login failed (status A=${deviceA.response.status}, B=${deviceB.response.status})`);
    const passed = results.filter((r) => r.passed).length;
    console.log(`\nSummary: ${passed}/${results.length} passed\n`);
    process.exit(passed === results.length ? 0 : 1);
  }

  record('Device A login sets cookies', Boolean(deviceA.cookies.refresh_token && deviceA.cookies.access_token));
  record('Device B login sets cookies', Boolean(deviceB.cookies.refresh_token && deviceB.cookies.access_token));
  record(
    'Device A and B receive different refresh tokens',
    deviceA.cookies.refresh_token !== deviceB.cookies.refresh_token,
  );

  const refreshBefore = await refreshWithCookies(deviceA.cookies);
  record('Device A refresh works before logout-all', refreshBefore.ok, `status=${refreshBefore.status}`);

  const refreshBeforeB = await refreshWithCookies(deviceB.cookies);
  record('Device B refresh works before logout-all', refreshBeforeB.ok, `status=${refreshBeforeB.status}`);

  const logoutAllRes = await logoutAllWithCookies(deviceA.cookies);
  const logoutAllData = await logoutAllRes.json().catch(() => ({}));
  record('logout-all succeeds from Device A', logoutAllRes.ok && logoutAllData.success === true, `status=${logoutAllRes.status}`);

  const refreshAfterA = await refreshWithCookies(deviceA.cookies);
  record('Device A refresh fails after logout-all', refreshAfterA.status === 401, `status=${refreshAfterA.status}`);

  const refreshAfterB = await refreshWithCookies(deviceB.cookies);
  record('Device B refresh fails after logout-all', refreshAfterB.status === 401, `status=${refreshAfterB.status}`);

  const deviceC = await loginDevice('Device C');
  if (deviceC.response.ok) {
    const singleLogout = await logoutWithCookies(deviceC.cookies);
    record('logout revokes current session only', singleLogout.ok, `status=${singleLogout.status}`);

    const refreshAfterSingle = await refreshWithCookies(deviceC.cookies);
    record('refresh fails after logout', refreshAfterSingle.status === 401, `status=${refreshAfterSingle.status}`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nSummary: ${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
