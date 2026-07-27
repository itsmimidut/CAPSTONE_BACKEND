import db from '../config/db.js';
import { amountsMatch } from '../utils/bookingAmount.js';
import { logSecurityEvent, logPaymentEvent } from '../utils/logger.js';
import { logAudit, AUDIT_ACTIONS } from '../utils/auditLogger.js';
import { POS_PAYMENT_STATUS } from '../utils/paymentStatuses.js';
import {
    findPosTransactionByInvoice,
    markPaid,
    markExpired,
    markFailed,
} from './paymentStatusService.js';
import { applyInventoryDeduction } from './inventorySettlementService.js';
import {
    finalizeBookingsForPaidTransaction,
    releaseUnpaidBookingsOnExpiry,
} from './bookingCheckoutService.js';
import { isPosExternalId } from './posXenditService.js';
import { notifyDisplayPaymentResult } from './displayPaymentService.js';
import { addTimelineEvent, TIMELINE_EVENTS } from './paymentTimelineService.js';

export { isPosExternalId };

const parseItems = (transaction) => {
    if (!transaction?.items) return [];
    if (Array.isArray(transaction.items)) return transaction.items;
    try {
        return JSON.parse(transaction.items);
    } catch {
        return [];
    }
};

export const processPaidPosInvoice = async (payment) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const transaction = await findPosTransactionByInvoice(
            connection,
            payment.id,
            payment.external_id
        );

        if (!transaction) {
            await connection.rollback();
            return { handled: false, reason: 'pos_transaction_not_found' };
        }

        await addTimelineEvent(
            transaction.receipt_no,
            TIMELINE_EVENTS.WEBHOOK_RECEIVED,
            `Xendit webhook status ${payment.status} for invoice ${payment.id}`
        );

        if (Number(transaction.payment_processed) === 1 || transaction.payment_status === POS_PAYMENT_STATUS.PAID) {
            await connection.commit();
            try {
                await notifyDisplayPaymentResult({
                    invoiceId: payment.id,
                    status: 'PAID',
                    receiptNo: transaction.receipt_no,
                    amount: payment.amount,
                });
            } catch (displayError) {
                console.warn('Display payment:paid re-notify failed:', displayError.message);
            }
            return { handled: true, duplicate: true, transactionId: transaction.id };
        }

        if (!amountsMatch(payment.amount, transaction.total_amount)) {
            logSecurityEvent('POS_PAYMENT_AMOUNT_MISMATCH', {
                transaction_id: transaction.id,
                expected: transaction.total_amount,
                received: payment.amount,
                invoice_id: payment.id,
            });
            throw new Error('PAYMENT_AMOUNT_MISMATCH');
        }

        const pricedItems = parseItems(transaction);
        const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();

        await markPaid(connection, transaction.id, {
            invoiceId: payment.id,
            paymentReference: payment.external_id,
            paidAt,
        });
        transaction.payment_status = POS_PAYMENT_STATUS.PAID;

        await applyInventoryDeduction(connection, transaction, pricedItems);
        await addTimelineEvent(
            transaction.receipt_no,
            TIMELINE_EVENTS.INVENTORY_DEDUCTED,
            `Inventory deducted for POS receipt ${transaction.receipt_no}`
        );

        await finalizeBookingsForPaidTransaction(connection, pricedItems, 'xendit-webhook');
        await addTimelineEvent(
            transaction.receipt_no,
            TIMELINE_EVENTS.BOOKING_FINALIZED,
            `Bookings finalized for POS receipt ${transaction.receipt_no}`
        );

        await connection.query(
            'UPDATE pos_transactions SET payment_processed = 1 WHERE id = ?',
            [transaction.id]
        );

        await connection.commit();

        await logAudit({
            userId: 0,
            action: AUDIT_ACTIONS.PAYMENT_RECEIVED,
            entityType: 'pos_transaction',
            entityId: transaction.id,
            newValue: {
                invoice_id: payment.id,
                external_id: payment.external_id,
                amount: payment.amount,
                receipt_no: transaction.receipt_no,
            },
        });

        logPaymentEvent('POS_PAYMENT_SUCCESS', {
            transaction_id: transaction.id,
            invoice_id: payment.id,
            receipt_no: transaction.receipt_no,
            amount: payment.amount,
        });

        try {
            await notifyDisplayPaymentResult({
                invoiceId: payment.id,
                status: 'PAID',
                receiptNo: transaction.receipt_no,
                amount: payment.amount,
            });
        } catch (displayError) {
            console.warn('Display payment:paid notification failed:', displayError.message);
        }

        return { handled: true, transactionId: transaction.id, receiptNo: transaction.receipt_no };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const processFailedPosInvoice = async (payment) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const transaction = await findPosTransactionByInvoice(
            connection,
            payment.id,
            payment.external_id
        );

        if (!transaction) {
            await connection.commit();
            return { handled: false, reason: 'pos_transaction_not_found' };
        }

        await addTimelineEvent(
            transaction.receipt_no,
            TIMELINE_EVENTS.WEBHOOK_RECEIVED,
            `Xendit webhook status ${payment.status} for invoice ${payment.id}`
        );

        if (transaction.payment_status === POS_PAYMENT_STATUS.PAID) {
            await connection.commit();
            return { handled: true, duplicate: true };
        }

        const pricedItems = parseItems(transaction);
        const isExpired = String(payment.status || '').toUpperCase() === 'EXPIRED';

        if (isExpired) {
            await markExpired(connection, transaction.id);
            await releaseUnpaidBookingsOnExpiry(connection, pricedItems);
        } else {
            await markFailed(connection, transaction.id);
        }

        await connection.commit();

        logPaymentEvent('POS_PAYMENT_FAILED', {
            transaction_id: transaction.id,
            invoice_id: payment.id,
            status: payment.status,
        });

        try {
            await notifyDisplayPaymentResult({
                invoiceId: payment.id,
                status: isExpired ? 'EXPIRED' : 'FAILED',
                receiptNo: transaction.receipt_no,
                amount: payment.amount,
                message: isExpired ? 'Payment expired. Please try again.' : 'Payment failed.',
            });
        } catch (displayError) {
            console.warn('Display payment failure notification failed:', displayError.message);
        }

        return { handled: true, transactionId: transaction.id, status: payment.status };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const routeXenditInvoiceWebhook = async (payment) => {
    if (!isPosExternalId(payment?.external_id)) {
        return { handled: false, route: 'booking' };
    }

    const status = String(payment?.status || '').toUpperCase();

    if (status === 'PAID' || status === 'SETTLED') {
        const result = await processPaidPosInvoice(payment);
        return { handled: true, route: 'pos', ...result };
    }

    if (status === 'EXPIRED' || status === 'FAILED') {
        const result = await processFailedPosInvoice(payment);
        return { handled: true, route: 'pos', ...result };
    }

    return { handled: false, route: 'pos', reason: 'unhandled_status' };
};
