import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../config/db.js';
import {
    normalizePosTransactionItems,
    PosTransactionItemValidationError,
} from '../services/posTransactionItemService.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.resolve(scriptDirectory, '../logs/eshop-item-backfill-report.json');
const batchSize = Math.max(1, Number(process.env.ESHOP_BACKFILL_BATCH_SIZE || 100));

const summary = {
    transactionsScanned: 0,
    transactionsSkipped: 0,
    transactionsAlreadyNormalized: 0,
    transactionsBackfilled: 0,
    linesInserted: 0,
    linesAlreadyPresent: 0,
    linesSkipped: 0,
    malformedTransactions: 0,
    ambiguousMenuMatches: 0,
    missingMenuIds: 0,
};
const failures = [];

const parseItems = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') throw new Error('Items payload is not a JSON array');
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('Items payload is not a JSON array');
    return parsed;
};

const loadCatalog = async () => {
    const [rows] = await db.query('SELECT menu_id, name FROM menu_items');
    const ids = new Set(rows.map((row) => Number(row.menu_id)));
    const byName = new Map();
    rows.forEach((row) => {
        const key = String(row.name || '').trim().toLowerCase();
        if (!key) return;
        const matches = byName.get(key) || [];
        matches.push(Number(row.menu_id));
        byName.set(key, matches);
    });
    return { ids, byName };
};

const resolveMenuId = (line, catalog) => {
    if (line.menuId && catalog.ids.has(line.menuId)) return line.menuId;
    const matches = catalog.byName.get(line.productNameSnapshot.toLowerCase()) || [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) summary.ambiguousMenuMatches += 1;
    summary.missingMenuIds += 1;
    return null;
};

const backfillTransaction = async (transaction, catalog) => {
    let items;
    let normalized;
    try {
        items = parseItems(transaction.items);
        normalized = normalizePosTransactionItems(items);
    } catch (error) {
        summary.transactionsSkipped += 1;
        summary.malformedTransactions += 1;
        const skippedLines = Array.isArray(items) ? items.length : 0;
        summary.linesSkipped += skippedLines;
        failures.push({
            transactionId: transaction.id,
            receiptNo: transaction.receipt_no,
            code: error instanceof PosTransactionItemValidationError ? error.code : 'MALFORMED_JSON',
            lineNumber: error.lineNumber ?? null,
            message: error.message,
        });
        return;
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [existingRows] = await connection.query(
            `SELECT line_id, line_number
             FROM pos_transaction_items
             WHERE transaction_id = ?
             ORDER BY line_number
             FOR UPDATE`,
            [transaction.id],
        );

        if (existingRows.length > 0) {
            summary.transactionsAlreadyNormalized += 1;
            summary.linesAlreadyPresent += existingRows.length;
            await connection.commit();
            return;
        }

        for (const line of normalized) {
            const menuId = resolveMenuId(line, catalog);
            await connection.query(
                `INSERT INTO pos_transaction_items (
                    transaction_id, receipt_no, item_name, menu_id, quantity,
                    unit_price, line_total, booking_reference, line_number,
                    product_name_snapshot, unit_price_snapshot, modifiers_snapshot,
                    line_total_snapshot, image_url_snapshot
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    transaction.id,
                    transaction.receipt_no,
                    line.productNameSnapshot,
                    menuId,
                    line.quantity,
                    line.unitPriceSnapshot,
                    line.lineTotalSnapshot,
                    line.bookingReference,
                    line.lineNumber,
                    line.productNameSnapshot,
                    line.unitPriceSnapshot,
                    line.modifiersSnapshot === null ? null : JSON.stringify(line.modifiersSnapshot),
                    line.lineTotalSnapshot,
                    line.imageUrlSnapshot || null,
                ],
            );
        }

        await connection.commit();
        summary.transactionsBackfilled += 1;
        summary.linesInserted += normalized.length;
    } catch (error) {
        await connection.rollback();
        summary.transactionsSkipped += 1;
        summary.linesSkipped += normalized.length;
        failures.push({
            transactionId: transaction.id,
            receiptNo: transaction.receipt_no,
            code: error.code || 'BACKFILL_FAILED',
            lineNumber: null,
            message: error.message,
        });
    } finally {
        connection.release();
    }
};

const main = async () => {
    const catalog = await loadCatalog();
    let lastId = 0;

    while (true) {
        const [transactions] = await db.query(
            `SELECT id, receipt_no, items
             FROM pos_transactions
             WHERE LOWER(TRIM(type)) = 'e-shop'
               AND id > ?
             ORDER BY id
             LIMIT ?`,
            [lastId, batchSize],
        );
        if (transactions.length === 0) break;

        for (const transaction of transactions) {
            summary.transactionsScanned += 1;
            await backfillTransaction(transaction, catalog);
            lastId = transaction.id;
        }
    }

    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        summary,
        failures,
    }, null, 2)}\n`);

    console.log('E-Shop item backfill summary');
    Object.entries(summary).forEach(([key, value]) => console.log(`${key}: ${value}`));
    console.log(`Detailed report: ${reportPath}`);

    if (failures.length > 0) process.exitCode = 2;
};

try {
    await main();
} finally {
    await db.end();
}
