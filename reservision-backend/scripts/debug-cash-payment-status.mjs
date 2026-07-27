import { db } from '../config/db.js';
import { getPosTransactionColumnSet, ensurePosPhase2Schema } from '../services/paymentStatusService.js';

const [dbName] = await db.query('SELECT DATABASE() AS db');
console.log('DATABASE():', dbName[0]?.db);

const [cols] = await db.query(`
  SELECT COLUMN_NAME, TABLE_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pos_transactions'
    AND COLUMN_NAME IN ('payment_status','payment_processed','paid_at')
`);
console.log('INFORMATION_SCHEMA cols:', cols);

const [desc] = await db.query('DESCRIBE pos_transactions');
console.log(
  'DESCRIBE payment cols:',
  desc.filter((r) => /payment|paid_at|^status$/.test(r.Field))
);

let columnSet = await getPosTransactionColumnSet(null);
console.log('columnSet before ensure:', {
  payment_status: columnSet.has('payment_status'),
  payment_processed: columnSet.has('payment_processed'),
  paid_at: columnSet.has('paid_at'),
});

await ensurePosPhase2Schema();

columnSet = await getPosTransactionColumnSet(null);
console.log('columnSet after ensure:', {
  payment_status: columnSet.has('payment_status'),
  payment_processed: columnSet.has('payment_processed'),
  paid_at: columnSet.has('paid_at'),
});

process.exit(0);
