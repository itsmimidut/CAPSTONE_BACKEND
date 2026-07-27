/**
 * Backfill pos_transactions.customer_id from customers.user_id mapping.
 * Usage: node scripts/backfill-pos-customer-id.mjs
 */
import db from '../config/db.js';

const [beforeRows] = await db.query(
  `SELECT id, user_id, customer_id FROM pos_transactions WHERE customer_id IS NULL`,
);
console.log(`Before backfill: ${beforeRows.length} rows with NULL customer_id`);

const [result] = await db.query(`
  UPDATE pos_transactions pt
  JOIN customers c ON pt.user_id = c.user_id
  SET pt.customer_id = c.customer_id
  WHERE pt.customer_id IS NULL
`);

console.log(`Updated ${result.affectedRows ?? result.changedRows ?? 0} rows`);

const [afterRows] = await db.query(
  `SELECT id, user_id, customer_id FROM pos_transactions WHERE customer_id IS NULL`,
);
console.log(`After backfill: ${afterRows.length} rows with NULL customer_id`);

const [countRow] = await db.query(
  `SELECT COUNT(*) AS total FROM pos_transactions WHERE customer_id IS NULL`,
);
console.log(`NULL customer_id count: ${countRow[0].total}`);

process.exit(Number(countRow[0].total) > 0 ? 1 : 0);
