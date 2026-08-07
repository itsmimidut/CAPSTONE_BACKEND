import { db } from '../config/db.js';

const checks = [
    {
        name: 'duplicate line identities',
        sql: `SELECT transaction_id, line_number, COUNT(*) AS total
              FROM pos_transaction_items
              GROUP BY transaction_id, line_number
              HAVING COUNT(*) > 1`,
    },
    {
        name: 'missing required values',
        sql: `SELECT line_id
              FROM pos_transaction_items
              WHERE line_number IS NULL
                 OR product_name_snapshot IS NULL
                 OR TRIM(product_name_snapshot) = ''
                 OR unit_price_snapshot IS NULL
                 OR quantity IS NULL
                 OR quantity <= 0`,
    },
    {
        name: 'invalid amounts',
        sql: `SELECT line_id
              FROM pos_transaction_items
              WHERE unit_price_snapshot < 0
                 OR line_total_snapshot < 0`,
    },
    {
        name: 'valid E-Shop transactions without normalized lines',
        sql: `SELECT pt.id
              FROM pos_transactions pt
              LEFT JOIN pos_transaction_items pti ON pti.transaction_id = pt.id
              WHERE LOWER(TRIM(pt.type)) = 'e-shop'
                AND pt.items IS NOT NULL
                AND JSON_VALID(pt.items) = 1
                AND JSON_TYPE(pt.items) = 'ARRAY'
                AND JSON_LENGTH(pt.items) > 0
              GROUP BY pt.id
              HAVING COUNT(pti.line_id) = 0`,
    },
];

const reconciliationSql = `
    SELECT
        pt.id,
        JSON_LENGTH(pt.items) AS json_line_count,
        COUNT(pti.line_id) AS normalized_line_count,
        COALESCE(SUM(pti.quantity), 0) AS normalized_quantity
    FROM pos_transactions pt
    LEFT JOIN pos_transaction_items pti ON pti.transaction_id = pt.id
    WHERE LOWER(TRIM(pt.type)) = 'e-shop'
      AND JSON_VALID(pt.items) = 1
      AND JSON_TYPE(pt.items) = 'ARRAY'
    GROUP BY pt.id, pt.items
    HAVING json_line_count <> normalized_line_count
`;

let failed = false;
try {
    for (const check of checks) {
        const [rows] = await db.query(check.sql);
        const passed = rows.length === 0;
        failed ||= !passed;
        console.log(`${passed ? 'PASS' : 'FAIL'}: ${check.name} (${rows.length} row(s))`);
        if (!passed) console.log(JSON.stringify(rows, null, 2));
    }

    const [reconciliationRows] = await db.query(reconciliationSql);
    const reconciliationPassed = reconciliationRows.length === 0;
    failed ||= !reconciliationPassed;
    console.log(`${reconciliationPassed ? 'PASS' : 'FAIL'}: JSON/normalized line counts (${reconciliationRows.length} mismatch(es))`);
    if (!reconciliationPassed) console.log(JSON.stringify(reconciliationRows, null, 2));
} finally {
    await db.end();
}

if (failed) process.exitCode = 1;
