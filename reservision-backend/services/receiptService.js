import { db } from '../config/db.js';

const RECEIPT_RETRY_LIMIT = 5;
/** MySQL signed INT max — pos_receipt_sequences.id column type */
const MAX_SEQUENCE_ID = 2_147_483_647;
/** Walk-in POS receipts are short padded numbers (e.g. 001, 042, 1205) */
const WALK_IN_RECEIPT_MAX = 999_999;

const parseNumericReceipt = (value) => {
    const digits = String(value || '').replace(/[^\d]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getSafeWalkInReceiptMax = async (executor = db) => {
    const [[row]] = await executor.query(
        `SELECT MAX(CAST(receipt_no AS UNSIGNED)) AS max_no
         FROM pos_transactions
         WHERE receipt_no REGEXP '^[0-9]+$'
           AND LENGTH(receipt_no) <= 6
           AND CAST(receipt_no AS UNSIGNED) <= ?`,
        [WALK_IN_RECEIPT_MAX]
    );

    const maxNo = Number(row?.max_no || 0);
    if (!Number.isFinite(maxNo) || maxNo < 0) return 0;
    return Math.min(maxNo, WALK_IN_RECEIPT_MAX);
};

const getSequenceAutoIncrement = async (executor = db) => {
    const [[row]] = await executor.query(
        `SELECT AUTO_INCREMENT AS next_seq
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'pos_receipt_sequences'`
    );
    const nextSeq = Number(row?.next_seq || 1);
    if (!Number.isFinite(nextSeq) || nextSeq < 1) return 1;
    return nextSeq;
};

const clampSequenceTarget = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(Math.floor(parsed), MAX_SEQUENCE_ID);
};

/**
 * Allocate the next walk-in POS receipt number inside an open DB transaction.
 * Uses an AUTO_INCREMENT sequence table for concurrency-safe sequencing.
 */
export const generateReceiptNumber = async (connection) => {
    const executor = connection?.query ? connection : db;

    for (let attempt = 0; attempt < RECEIPT_RETRY_LIMIT; attempt += 1) {
        try {
            await executor.query('INSERT INTO pos_receipt_sequences () VALUES ()');
        } catch (error) {
            if (error?.code === 'ER_WARN_DATA_OUT_OF_RANGE' || error?.errno === 1264) {
                await repairReceiptSequence(executor);
                continue;
            }
            throw error;
        }

        const [[row]] = await executor.query('SELECT LAST_INSERT_ID() AS seq');
        const seq = Number(row?.seq || 0);
        if (!seq || seq > MAX_SEQUENCE_ID) {
            await repairReceiptSequence(executor);
            continue;
        }

        const receiptNo = String(seq).padStart(3, '0');

        const [[existing]] = await executor.query(
            'SELECT id FROM pos_transactions WHERE receipt_no = ? LIMIT 1',
            [receiptNo]
        );

        if (!existing) {
            return receiptNo;
        }
    }

    throw new Error('Unable to allocate a unique POS receipt number');
};

export const repairReceiptSequence = async (executor = db) => {
    const safeMax = await getSafeWalkInReceiptMax(executor);
    const target = clampSequenceTarget(safeMax + 1);

    await executor.query(`ALTER TABLE pos_receipt_sequences AUTO_INCREMENT = ${target}`);
    console.warn(`[POS] Repaired pos_receipt_sequences AUTO_INCREMENT -> ${target}`);
    return target;
};

export const ensureReceiptSequenceSchema = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_receipt_sequences (
            id INT AUTO_INCREMENT PRIMARY KEY
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const safeMax = await getSafeWalkInReceiptMax();
    const currentAutoInc = await getSequenceAutoIncrement();
    const target = clampSequenceTarget(Math.max(safeMax + 1, currentAutoInc > MAX_SEQUENCE_ID ? 1 : currentAutoInc));

    if (currentAutoInc > MAX_SEQUENCE_ID) {
        console.warn(
            `[POS] pos_receipt_sequences AUTO_INCREMENT was out of range (${currentAutoInc}); resetting to ${target}`
        );
    }

    await db.query(`ALTER TABLE pos_receipt_sequences AUTO_INCREMENT = ${target}`);
};

export const ensureReceiptNoUniqueIndex = async () => {
    const [indexes] = await db.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'pos_transactions'
          AND COLUMN_NAME = 'receipt_no'
          AND NON_UNIQUE = 0
    `);

    if (indexes.length > 0) {
        return;
    }

    const [duplicates] = await db.query(`
        SELECT receipt_no, COUNT(*) AS total
        FROM pos_transactions
        GROUP BY receipt_no
        HAVING COUNT(*) > 1
        LIMIT 1
    `);

    if (duplicates.length > 0) {
        console.warn(
            '[DB] Skipped unique index on pos_transactions.receipt_no because duplicates exist:',
            duplicates[0].receipt_no
        );
        return;
    }

    await db.query(`
        ALTER TABLE pos_transactions
        ADD UNIQUE INDEX uq_pos_transactions_receipt_no (receipt_no)
    `);
    console.log('[DB] Ensured unique index on pos_transactions.receipt_no');
};

export { parseNumericReceipt };
