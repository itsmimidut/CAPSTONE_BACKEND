/**
 * Sprint 2 security validation script
 * Run: node scripts/sprint2-security-test.mjs
 * Requires backend on http://localhost:8000
 */

const BASE = process.env.API_BASE || 'http://localhost:8000';
const ALLOWED_ORIGIN = 'http://localhost:5173';
const BLOCKED_ORIGIN = 'http://malicious-example.test';

const results = [];

const record = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const postJson = async (path, body, headers = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { status: response.status, data, headers: response.headers };
};

const getWithOrigin = async (path, origin) => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { Origin: origin },
  });
  return { status: response.status, headers: response.headers };
};

async function testLoginRateLimit() {
  const payload = { email: 'ratelimit-test@example.com', password: 'wrong-password-1' };
  let blocked = false;

  for (let i = 1; i <= 6; i += 1) {
    const { status, data } = await postJson('/api/customers/login', payload);
    if (i <= 5 && status === 429) {
      blocked = true;
      break;
    }
    if (i === 6 && status === 429 && data?.error === 'Too many login attempts') {
      blocked = true;
    }
  }

  record('Login rate limit blocks 6th attempt', blocked);
}

async function testOtpRateLimit() {
  const payload = { email: 'otp-limit@example.com', firstName: 'Test' };
  let blocked = false;

  for (let i = 1; i <= 4; i += 1) {
    const { status } = await postJson('/api/otp/send', payload);
    if (i === 4 && status === 429) blocked = true;
  }

  record('OTP rate limit blocks abuse', blocked);
}

async function testSignupRateLimit() {
  let blocked = false;

  for (let i = 1; i <= 6; i += 1) {
    const { status } = await postJson('/api/customers/signup', {
      firstName: 'Rate',
      lastName: `Test${i}`,
      email: `signup-limit-${Date.now()}-${i}@example.com`,
      password: 'Password123!',
      contactNumber: '09171234567',
    });
    if (i === 6 && status === 429) blocked = true;
  }

  record('Signup rate limit blocks abuse', blocked);

  const { cleanupTestUsers } = await import('./cleanup-test-users.mjs');
  await cleanupTestUsers({ silent: true });
}

async function testValidationLayer() {
  const { status, data } = await postJson('/api/customers/login', {
    email: 'not-an-email',
    password: '',
  });

  const passed = status === 400 && data?.code === 'VALIDATION_ERROR';
  record('Validation rejects invalid login payload', passed, `status=${status}`);
}

async function testHelmetHeaders() {
  const response = await fetch(`${BASE}/`);
  const required = [
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  ];

  const missing = required.filter((header) => !response.headers.get(header));
  record('Helmet security headers present', missing.length === 0, missing.join(', ') || 'all present');
}

async function testCorsAllowed() {
  const { status } = await getWithOrigin('/api/rooms', ALLOWED_ORIGIN);
  record('CORS allows localhost:5173', status !== 403, `status=${status}`);
}

async function testCorsBlocked() {
  const { status } = await getWithOrigin('/api/rooms', BLOCKED_ORIGIN);
  record('CORS blocks unknown origin', status === 403, `status=${status}`);
}

async function main() {
  console.log(`\nSprint 2 Security Tests @ ${BASE}\n`);

  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error('Backend is not reachable. Start server with: node server.js');
    process.exit(1);
  }

  await testHelmetHeaders();
  await testCorsAllowed();
  await testCorsBlocked();
  await testValidationLayer();
  await testLoginRateLimit();
  await testOtpRateLimit();
  await testSignupRateLimit();

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\nSummary: ${passed}/${total} passed\n`);
  process.exit(passed === total ? 0 : 1);
}

main();
