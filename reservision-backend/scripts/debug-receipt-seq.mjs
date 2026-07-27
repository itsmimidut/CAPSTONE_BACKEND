import { db } from '../config/db.js';
import { ensureReceiptSequenceSchema } from '../services/receiptService.js';

await ensureReceiptSequenceSchema();

const [[maxAll]] = await db.query(
  `SELECT MAX(CAST(receipt_no AS UNSIGNED)) AS max_no
   FROM pos_transactions
   WHERE receipt_no REGEXP '^[0-9]+$'`
);

const [[autoInc]] = await db.query(
  `SELECT AUTO_INCREMENT AS v
   FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'pos_receipt_sequences'`
);

const [short] = await db.query(
  `SELECT receipt_no FROM pos_transactions
   WHERE receipt_no REGEXP '^[0-9]+$' AND LENGTH(receipt_no) <= 6
   ORDER BY CAST(receipt_no AS UNSIGNED) DESC LIMIT 5`
);
console.log('short walk-in style receipts:', short);

process.exit(0);
