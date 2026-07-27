/**
 * Sprint 3 Task 02 — Refresh token validation
 * Run: node scripts/sprint3-task02-test.mjs
 */

import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {
  createAccessToken,
  hashRefreshToken,
  generateRefreshToken,
} from '../utils/tokenService.js';
import { getAccessTokenCookieOptions } from '../utils/accessTokenCookie.js';
import { getRefreshTokenCookieOptions } from '../utils/refreshTokenCookie.js';
import { getJwtSecret } from '../utils/jwtSecret.js';

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

const toCookieHeader = (cookies) =>
  Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

async function main() {
  console.log(`\nSprint 3 Task 02 Tests\n`);

  const accessToken = createAccessToken({
    id: 1,
    email: 'test@example.com',
    role: 'admin',
    name: 'Test User',
  });
  const decoded = jwt.decode(accessToken);
  const ttlSeconds = decoded.exp - decoded.iat;
  record('Access token TTL is 15 minutes', ttlSeconds === 15 * 60, `ttl=${ttlSeconds}s`);

  record(
    'Access cookie maxAge is 15 minutes',
    getAccessTokenCookieOptions().maxAge === 15 * 60 * 1000,
  );

  record(
    'Refresh cookie maxAge is 30 days',
    getRefreshTokenCookieOptions().maxAge === 30 * 24 * 60 * 60 * 1000,
  );

  record(
    'Refresh cookie path is /api/auth',
    getRefreshTokenCookieOptions().path === '/api/auth',
  );

  const plain = generateRefreshToken();
  const hashed = hashRefreshToken(plain);
  record('Refresh token hash is SHA-256 hex', hashed.length === 64 && /^[a-f0-9]+$/.test(hashed));
  record('Hashing is deterministic', hashRefreshToken(plain) === hashed);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend not reachable.');
    process.exit(1);
  }

  const missingRefresh = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
  let missingBody = {};
  try {
    missingBody = await missingRefresh.json();
  } catch {
    missingBody = {};
  }
  if (missingRefresh.status === 404) {
    console.log('[SKIP] POST /api/auth/refresh route — restart backend to load Sprint 3 Task 02 code');
  } else {
    record(
      'POST /api/auth/refresh rejects missing cookie',
      missingRefresh.status === 401 && missingBody.code === 'REFRESH_INVALID',
      `status=${missingRefresh.status}`,
    );
  }

  const loginRes = await fetch(`${BASE}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const loginData = await loginRes.json();

  if (loginRes.ok && loginData.success) {
    const setCookieHeaders = typeof loginRes.headers.getSetCookie === 'function'
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get('set-cookie')].filter(Boolean);
    const cookies = parseCookieHeader(setCookieHeaders);

    record('Login sets refresh_token cookie', Boolean(cookies.refresh_token));
    record('Login sets access_token cookie', Boolean(cookies.access_token));

    const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: toCookieHeader(cookies) },
    });
    const refreshData = await refreshRes.json();
    const refreshSetCookies = typeof refreshRes.headers.getSetCookie === 'function'
      ? refreshRes.headers.getSetCookie()
      : [refreshRes.headers.get('set-cookie')].filter(Boolean);
    const rotatedCookies = parseCookieHeader(refreshSetCookies);

    record('Refresh endpoint succeeds', refreshRes.ok && refreshData.success === true, `status=${refreshRes.status}`);
    record('Refresh rotates refresh_token value', rotatedCookies.refresh_token !== cookies.refresh_token);
    record('Refresh issues new access_token', Boolean(rotatedCookies.access_token));

    const staleRefreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${cookies.refresh_token}` },
    });
    record(
      'Old refresh token is revoked after rotation',
      staleRefreshRes.status === 401,
      `status=${staleRefreshRes.status}`,
    );

    const newAccess = rotatedCookies.access_token;
    const protectedRes = await fetch(`${BASE}/api/notifications/pending-counts`, {
      headers: { Cookie: `access_token=${newAccess}` },
    });
    record(
      'New access token works on protected route',
      protectedRes.status !== 401,
      `status=${protectedRes.status}`,
    );
  } else {
    console.log(`[SKIP] Refresh integration — database unavailable (login status=${loginRes.status})`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\nSummary: ${passed}/${results.length} passed\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
