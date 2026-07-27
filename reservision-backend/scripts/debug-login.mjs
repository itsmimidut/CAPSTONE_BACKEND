import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';

dotenv.config();

const email = (process.argv[2] || '').trim().toLowerCase();
const testPassword = process.argv[3] || '';

if (!email) {
  console.log('Usage: node scripts/debug-login.mjs <email> [password-to-test]');
  process.exit(1);
}

const [users] = await db.query(
  `SELECT user_id, email, role, password, auth_provider, first_name, last_name,
          LENGTH(password) AS pwd_len,
          LEFT(password, 4) AS pwd_prefix
   FROM user
   WHERE LOWER(TRIM(email)) = ?
   LIMIT 5`,
  [email],
);

if (!users.length) {
  console.log('❌ No user row with this email (case-insensitive):', email);
  const [similar] = await db.query(
    `SELECT user_id, email, role FROM user WHERE email LIKE ? LIMIT 5`,
    [`%${email.split('@')[0]}%`],
  );
  if (similar.length) {
    console.log('Similar emails in DB:', similar);
  }
  process.exit(1);
}

const allowedRoles = ['customer', 'admin', 'restaurantstaff', 'receptionist', 'swimming_instructor'];

for (const u of users) {
  console.log('\n--- User', u.user_id);
  console.log('  email:', u.email);
  console.log('  role:', u.role, allowedRoles.includes(u.role) ? '✅ allowed for login' : '❌ NOT in login role list');
  console.log('  auth_provider:', u.auth_provider || '(null)');
  console.log('  password length:', u.pwd_len);
  console.log('  password looks bcrypt:', u.pwd_prefix === '$2a$' || u.pwd_prefix === '$2b$' ? 'yes' : 'NO — plain or empty');

  if (!u.password) {
    console.log('  ❌ password is NULL/empty — cannot login with password (guest/Google account?)');
  } else if (testPassword) {
    const ok = await bcrypt.compare(testPassword, u.password);
    console.log('  bcrypt.compare test:', ok ? '✅ MATCH' : '❌ NO MATCH');
    if (!ok && !String(u.password).startsWith('$2')) {
      console.log('  plain-text compare:', u.password === testPassword ? '✅ plain match' : 'no');
    }
  }
}

const loginQuery = await db.query(
  `SELECT user_id FROM user WHERE email = ? AND role IN ('customer', 'admin', 'restaurantstaff', 'receptionist', 'swimming_instructor') LIMIT 1`,
  [email],
);
console.log('\nLogin SQL (exact email match):', loginQuery[0].length ? '✅ found' : '❌ not found — check email casing in DB vs lowercase input');

process.exit(0);
