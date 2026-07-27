import { db } from '../config/db.js';
import { POS_PAYMENT_STATUS } from '../utils/paymentStatuses.js';

const getColumnSet = async (connection, tableName) => {
    const executor = connection?.query ? connection : db;
    const [rows] = await executor.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
};

const ensureColumn = async (tableName, columnName, definition) => {
    const columnSet = await getColumnSet(null, tableName);
    if (columnSet.has(columnName)) return;
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

export const ensurePosPhase2Schema = async () => {
    await ensureColumn('pos_transactions', 'payment_status', "VARCHAR(20) NOT NULL DEFAULT 'PENDING'");
    await ensureColumn('pos_transactions', 'xendit_invoice_id', 'VARCHAR(255) NULL');
    await ensureColumn('pos_transactions', 'payment_reference', 'VARCHAR(255) NULL');
    await ensureColumn('pos_transactions', 'paid_at', 'DATETIME NULL');
    await ensureColumn('pos_transactions', 'payment_processed', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('pos_transactions', 'status', "VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'");
    await ensureColumn('pos_transactions', 'voided_at', 'DATETIME NULL');
    await ensureColumn('pos_transactions', 'voided_by', 'INT NULL');
    await ensureColumn('pos_transactions', 'void_reason', 'TEXT NULL');

  try {
    await db.query('CREATE INDEX idx_pos_transactions_payment_status ON pos_transactions (payment_status)');
  } catch {
    // index may already exist
  }

  try {
    await db.query('CREATE INDEX idx_pos_transactions_xendit_invoice ON pos_transactions (xendit_invoice_id)');
  } catch {
    // index may already exist
  }

    console.log('[DB] Ensured POS Phase 2 payment lifecycle columns.');
};

export const getPosTransactionById = async (connection, transactionId, { forUpdate = false } = {}) => {
    const executor = connection?.query ? connection : db;
    const lockClause = forUpdate ? 'FOR UPDATE' : '';
    const [rows] = await executor.query(
        `SELECT *
         FROM pos_transactions
         WHERE id = ?
         LIMIT 1
         ${lockClause}`,
        [transactionId]
    );
    return rows[0] || null;
};

export const findPosTransactionByInvoice = async (connection, invoiceId, externalId = null) => {
    const executor = connection?.query ? connection : db;

    if (invoiceId) {
        const [rows] = await executor.query(
            `SELECT * FROM pos_transactions WHERE xendit_invoice_id = ? LIMIT 1 FOR UPDATE`,
            [invoiceId]
        );
        if (rows[0]) return rows[0];
    }

    if (externalId && String(externalId).startsWith('pos:')) {
        const receiptNo = String(externalId).slice(4);
        const [rows] = await executor.query(
            `SELECT * FROM pos_transactions WHERE receipt_no = ? LIMIT 1 FOR UPDATE`,
            [receiptNo]
        );
        if (rows[0]) return rows[0];
    }

    return null;
};

export const markPending = async (connection, transactionId, { invoiceId, paymentReference, paymentUrl } = {}) => {
    const sets = ['payment_status = ?'];
    const values = [POS_PAYMENT_STATUS.PENDING];

    const columnSet = await getColumnSet(connection, 'pos_transactions');

    if (columnSet.has('xendit_invoice_id') && invoiceId) {
        sets.push('xendit_invoice_id = ?');
        values.push(invoiceId);
    }
    if (columnSet.has('payment_reference') && paymentReference) {
        sets.push('payment_reference = ?');
        values.push(paymentReference);
    }
    if (columnSet.has('payment_url') && paymentUrl) {
        sets.push('payment_url = ?');
        values.push(paymentUrl);
    }

    values.push(transactionId);
    await connection.query(
        `UPDATE pos_transactions SET ${sets.join(', ')} WHERE id = ?`,
        values
    );
};

export const markPaid = async (connection, transactionId, { invoiceId, paymentReference, paidAt = new Date() } = {}) => {
    const columnSet = await getColumnSet(connection, 'pos_transactions');
    const sets = ['payment_status = ?'];
    const values = [POS_PAYMENT_STATUS.PAID];

    if (columnSet.has('paid_at')) {
        sets.push('paid_at = ?');
        values.push(paidAt);
    }
    if (columnSet.has('payment_processed')) {
        sets.push('payment_processed = 1');
    }
    if (columnSet.has('xendit_invoice_id') && invoiceId) {
        sets.push('xendit_invoice_id = ?');
        values.push(invoiceId);
    }
    if (columnSet.has('payment_reference') && paymentReference) {
        sets.push('payment_reference = ?');
        values.push(paymentReference);
    }

    values.push(transactionId);
    await connection.query(
        `UPDATE pos_transactions SET ${sets.join(', ')} WHERE id = ?`,
        values
    );
};

export const markFailed = async (connection, transactionId) => {
    await connection.query(
        `UPDATE pos_transactions SET payment_status = ? WHERE id = ?`,
        [POS_PAYMENT_STATUS.FAILED, transactionId]
    );
};

export const markExpired = async (connection, transactionId) => {
    await connection.query(
        `UPDATE pos_transactions SET payment_status = ? WHERE id = ?`,
        [POS_PAYMENT_STATUS.EXPIRED, transactionId]
    );
};

export const getPosTransactionColumnSet = async (connection = null) =>
    getColumnSet(connection, 'pos_transactions');
