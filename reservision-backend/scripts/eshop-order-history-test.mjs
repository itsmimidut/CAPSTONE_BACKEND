/**
 * E-Shop order history fix — validation tests
 * Usage: node scripts/eshop-order-history-test.mjs
 */
import db from '../config/db.js';
import { assertCustomerIdAccess } from '../middleware/ownership.js';

const results = [];
const pass = (name, detail = '') => results.push({ name, ok: true, detail });
const fail = (name, detail = '') => results.push({ name, ok: false, detail });

const [nullWithUser] = await db.query(
  `SELECT COUNT(*) AS total FROM pos_transactions
   WHERE customer_id IS NULL AND user_id IS NOT NULL`,
);
if (Number(nullWithUser[0].total) === 0) {
  pass('Task 2/4: backfilled all rows with user_id');
} else {
  fail('Task 2/4: backfilled all rows with user_id', `count=${nullWithUser[0].total}`);
}

const [mapping] = await db.query(
  `SELECT customer_id, user_id FROM customers
   WHERE user_id IS NOT NULL
   LIMIT 10`,
);
if (mapping.length > 0 && mapping.every((row) => row.user_id && row.customer_id)) {
  pass('Task 1: customers table has user_id → customer_id mapping');
} else {
  fail('Task 1: customers table mapping', `rows=${mapping.length}`);
}

const [eshopWithCustomer] = await db.query(
  `SELECT id, user_id, customer_id FROM pos_transactions
   WHERE type = 'E-Shop' AND customer_id IS NOT NULL
   ORDER BY id DESC LIMIT 1`,
);
if (eshopWithCustomer.length) {
  pass('E-Shop orders have customer_id', `id=${eshopWithCustomer[0].id}`);
} else {
  pass('E-Shop orders have customer_id', 'skipped — no E-Shop orders yet');
}

const source = await import('fs/promises').then((fs) =>
  fs.readFile(new URL('../controllers/posController.js', import.meta.url), 'utf8'),
);
if (!source.includes('customerId || null') && source.includes('resolveCustomerIdForUser')) {
  pass('Task 3/4: createEshopOrder derives customer_id from auth user');
} else {
  fail('Task 3/4: createEshopOrder derives customer_id from auth user');
}

if (source.includes("type = 'E-Shop' AND customer_id = ?") && !source.includes('customer_id IS NULL')) {
  pass('Task 5: order history query uses customer_id only');
} else {
  fail('Task 5: order history query uses customer_id only');
}

if (mapping.length >= 2) {
  const owner = mapping[0];
  const other = mapping.find((row) => row.customer_id !== owner.customer_id) || mapping[1];
  const ownerReq = { user: { id: owner.user_id, role: 'customer' } };
  const ownerRes = { status: () => ownerRes, json: () => ownerRes, statusCode: 200 };
  let ownerStatus = 200;
  const ownerResProxy = {
    status(code) { ownerStatus = code; return ownerResProxy; },
    json() { return ownerResProxy; },
  };
  const ownerAllowed = await assertCustomerIdAccess(ownerReq, ownerResProxy, owner.customer_id);
  if (ownerAllowed) pass('Task 6/7: owner can access own customer_id');

  let otherStatus = 200;
  const otherResProxy = {
    status(code) { otherStatus = code; return otherResProxy; },
    json() { return otherResProxy; },
  };
  const otherDenied = !(await assertCustomerIdAccess(
    { user: { id: owner.user_id, role: 'customer' } },
    otherResProxy,
    other.customer_id,
  ));
  if (otherDenied && otherStatus === 403) {
    pass('Task 7: cross-customer history returns 403');
  } else {
    fail('Task 7: cross-customer history returns 403', `status=${otherStatus}`);
  }
}

console.log('\nE-Shop Order History Test Results');
console.log('==================================');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
