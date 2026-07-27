import { db } from '../config/db.js';
import { ensurePosOrderSessionSchema } from '../services/posOrderSessionService.js';
import { ensureDisplaySessionSchema } from '../services/displaySessionService.js';

await ensurePosOrderSessionSchema();
await ensureDisplaySessionSchema();

const [columns] = await db.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'pos_transactions'
       AND COLUMN_NAME IN (
           'service_order_number',
           'service_order_date',
           'order_type',
           'station_id',
           'terminal_id',
           'pickup_name',
           'recipient_name'
       )`
);
const [tables] = await db.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('pos_order_number_counters', 'pos_order_sessions')`
);
const [displayColumns] = await db.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'display_payment_sessions'
       AND COLUMN_NAME IN ('service_order_number', 'order_type', 'location_number')`
);

console.log(JSON.stringify({
    columns: columns.map((row) => row.COLUMN_NAME).sort(),
    tables: tables.map((row) => row.TABLE_NAME).sort(),
    displayColumns: displayColumns.map((row) => row.COLUMN_NAME).sort(),
}));

await db.end();
