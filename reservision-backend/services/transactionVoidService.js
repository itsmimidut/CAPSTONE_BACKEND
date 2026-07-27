import db from '../config/db.js';
import { POS_PAYMENT_STATUS, POS_TRANSACTION_STATUS } from '../utils/paymentStatuses.js';
import { logAudit, AUDIT_ACTIONS } from '../utils/auditLogger.js';
import { restoreInventory } from './inventorySettlementService.js';
import { getPosTransactionById, getPosTransactionColumnSet } from './paymentStatusService.js';

export class TransactionVoidError extends Error {
    constructor(message, code = 'VOID_ERROR', statusCode = 400) {
        super(message);
        this.name = 'TransactionVoidError';
        this.code = code;
        this.statusCode = statusCode;
    }
};

export const voidTransaction = async ({
    transactionId,
    voidedBy,
    voidReason,
    connection: externalConnection = null,
}) => {
    const connection = externalConnection || await db.getConnection();
    const ownsConnection = !externalConnection;

    try {
        if (!ownsConnection) {
            // caller manages transaction
        } else {
            await connection.beginTransaction();
        }

        const transaction = await getPosTransactionById(connection, transactionId, { forUpdate: true });

        if (!transaction) {
            throw new TransactionVoidError('Transaction not found', 'NOT_FOUND', 404);
        }

        if (transaction.status === POS_TRANSACTION_STATUS.VOIDED) {
            throw new TransactionVoidError('Transaction is already voided', 'ALREADY_VOIDED', 409);
        }

        const columnSet = await getPosTransactionColumnSet(connection);

        const updates = ["status = 'VOIDED'", 'payment_status = ?'];
        const values = [POS_PAYMENT_STATUS.VOIDED];

        if (columnSet.has('voided_at')) {
            updates.push('voided_at = NOW()');
        }
        if (columnSet.has('voided_by')) {
            updates.push('voided_by = ?');
            values.push(voidedBy);
        }
        if (columnSet.has('void_reason')) {
            updates.push('void_reason = ?');
            values.push(voidReason || 'Voided by staff');
        }

        values.push(transactionId);

        await connection.query(
            `UPDATE pos_transactions SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (transaction.payment_status === POS_PAYMENT_STATUS.PAID && Number(transaction.payment_processed) === 1) {
            await restoreInventory(connection, transaction);
        }

        await logAudit({
            userId: voidedBy || 0,
            action: AUDIT_ACTIONS.PAYMENT_FAILED,
            entityType: 'pos_transaction',
            entityId: transactionId,
            newValue: {
                void_reason: voidReason,
                receipt_no: transaction.receipt_no,
            },
        });

        if (ownsConnection) {
            await connection.commit();
        }

        return {
            success: true,
            transactionId,
            receiptNo: transaction.receipt_no,
            status: POS_TRANSACTION_STATUS.VOIDED,
        };
    } catch (error) {
        if (ownsConnection) {
            await connection.rollback();
        }
        throw error;
    } finally {
        if (ownsConnection) {
            connection.release();
        }
    }
};

export const recordAudit = async ({ userId, transactionId, voidReason }) => {
    await logAudit({
        userId: userId || 0,
        action: AUDIT_ACTIONS.PAYMENT_FAILED,
        entityType: 'pos_transaction',
        entityId: transactionId,
        newValue: { void_reason: voidReason },
    });
};
