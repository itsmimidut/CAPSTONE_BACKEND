/**
 * Security auth validation script.
 * Run with backend server on port 8000:
 *   node scripts/security-auth-test.mjs
 */
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const BASE = 'http://localhost:8000';
const SECRET = process.env.JWT_SECRET;

const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

const request = async (method, path, token = null) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

const makeToken = (payload, options = {}) => {
  if (!SECRET) throw new Error('JWT_SECRET missing from environment');
  return jwt.sign(payload, SECRET, { expiresIn: options.expiresIn || '1h' });
};

const run = async () => {
  console.log('=== Security Auth Validation ===\n');

  const adminToken = makeToken({ id: 1, email: 'admin@test.com', role: 'admin', name: 'Admin' });
  const customerToken = makeToken({ id: 99, email: 'customer@test.com', role: 'customer', name: 'Customer' });
  const expiredToken = makeToken({ id: 1, email: 'admin@test.com', role: 'admin', name: 'Admin' }, { expiresIn: '-1s' });
  const invalidToken = 'not.a.valid.jwt.token';

  // Unauthorized access
  const noTokenNotifications = await request('GET', '/api/notifications/pending-counts');
  record('No token → notifications 401', noTokenNotifications.status === 401, `status=${noTokenNotifications.status}`);

  const noTokenAdmin = await request('GET', '/api/admin/refunds');
  record('No token → admin refunds 401', noTokenAdmin.status === 401, `status=${noTokenAdmin.status}`);

  const invalidJwt = await request('GET', '/api/admin/refunds', invalidToken);
  record('Invalid JWT → 401', invalidJwt.status === 401, `status=${invalidJwt.status}`);

  const expiredJwt = await request('GET', '/api/admin/refunds', expiredToken);
  record('Expired JWT → 401', expiredJwt.status === 401, `status=${expiredJwt.status}`);

  // Customer blocked from admin
  const customerAdmin = await request('GET', '/api/admin/refunds', customerToken);
  record('Customer → admin refunds 403', customerAdmin.status === 403, `status=${customerAdmin.status}`);

  const customerAnalytics = await request('GET', '/api/analytics/stats', customerToken);
  record('Customer → analytics 403', customerAnalytics.status === 403, `status=${customerAnalytics.status}`);

  // Admin allowed (may 200 or 500 depending on DB — auth should pass)
  const adminNotifications = await request('GET', '/api/notifications/pending-counts', adminToken);
  record(
    'Admin → notifications not 401/403',
    adminNotifications.status !== 401 && adminNotifications.status !== 403,
    `status=${adminNotifications.status}`
  );

  const adminRefunds = await request('GET', '/api/admin/refunds', adminToken);
  record(
    'Admin → refunds not 401/403',
    adminRefunds.status !== 401 && adminRefunds.status !== 403,
    `status=${adminRefunds.status}`
  );

  // IDOR: customer accessing another user's profile
  const idorProfile = await request('GET', '/api/customers/profile/id/1', customerToken);
  record('Customer → other user profile 403', idorProfile.status === 403, `status=${idorProfile.status}`);

  const ownProfile = await request('GET', '/api/customers/profile/id/99', customerToken);
  record(
    'Customer → own profile not forbidden',
    ownProfile.status !== 403,
    `status=${ownProfile.status}`
  );

  // Public routes remain public
  const publicRooms = await request('GET', '/api/rooms');
  record('Public rooms accessible', publicRooms.status === 200, `status=${publicRooms.status}`);

  const publicLogin = await request('POST', '/api/customers/login');
  record('Login route reachable without token', publicLogin.status !== 401, `status=${publicLogin.status}`);

  const failures = results.filter((r) => !r.passed);
  console.log(`\nTotal: ${results.length}, Passed: ${results.length - failures.length}, Failed: ${failures.length}`);
  process.exit(failures.length > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Validation script failed to run:', error.message);
  process.exit(1);
});
