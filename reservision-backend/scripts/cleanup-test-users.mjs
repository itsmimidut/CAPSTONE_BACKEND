/**
 * Remove security-test signup accounts from the database.
 * Run: node scripts/cleanup-test-users.mjs
 */

import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

const TEST_EMAIL_PATTERNS = [
  'signup-limit-%@example.com',
  'ratelimit-test@example.com',
  'otp-limit@example.com',
];

export async function cleanupTestUsers({ silent = false } = {}) {
  const likeClauses = TEST_EMAIL_PATTERNS.map(() => 'u.email LIKE ?').join(' OR ');
  const params = TEST_EMAIL_PATTERNS;

  const [rows] = await db.query(
    `SELECT u.user_id, u.email, u.first_name, u.last_name
     FROM user u
     WHERE ${likeClauses}
        OR (u.first_name = 'Rate' AND u.last_name LIKE 'Test%' AND u.email LIKE '%@example.com')`,
    params,
  );

  if (!rows.length) {
    if (!silent) {
      console.log('No test users found.');
    }
    return 0;
  }

  if (!silent) {
    console.log(`Found ${rows.length} test user(s) to remove:`);
    for (const row of rows) {
      console.log(`  - [${row.user_id}] ${row.first_name} ${row.last_name} <${row.email}>`);
    }
  }

  const ids = rows.map((row) => row.user_id);

  await db.query('DELETE FROM refresh_tokens WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM customers WHERE user_id IN (?)', [ids]);
  const [result] = await db.query('DELETE FROM user WHERE user_id IN (?)', [ids]);

  if (!silent) {
    console.log(`\nRemoved ${result.affectedRows} test user(s).`);
  }

  return result.affectedRows;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('cleanup-test-users.mjs');

if (isDirectRun) {
  cleanupTestUsers()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Cleanup failed:', error.message);
      process.exit(1);
    });
}
