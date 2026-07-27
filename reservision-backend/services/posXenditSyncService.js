import fetch from 'node-fetch';
import { db } from '../config/db.js';
import { POS_PAYMENT_STATUS } from '../utils/paymentStatuses.js';
import { buildPosExternalId } from './posXenditService.js';
import { routeXenditInvoiceWebhook } from './xenditWebhookService.js';
import { notifyDisplayPaymentResult } from './displayPaymentService.js';
import { logPaymentEvent } from '../utils/logger.js';

const XENDIT_API_KEY = process.env.XENDIT_SECRET_KEY;

export const fetchXenditInvoice = async (invoiceId) => {
    if (!XENDIT_API_KEY || !invoiceId) {
        return null;
    }

    const response = await fetch(`https://api.xendit.co/v2/invoices/${invoiceId}`, {
        headers: {
            Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
        },
    });

    if (!response.ok) {
        return null;
    }

    return response.json();
};

const buildWebhookPaymentPayload = (invoice, receiptNo) => ({
    id: invoice.id,
    external_id: invoice.external_id || buildPosExternalId(receiptNo),
    amount: invoice.amount,
    status: invoice.status,
    paid_at: invoice.paid_at,
});

/**
 * When Xendit webhook cannot reach localhost, reconcile a pending POS row
 * against the Xendit invoice API and run the same webhook handlers.
 */
export const syncPosTransactionByReceipt = async (receiptNo) => {
    const normalized = String(receiptNo || '').trim();
    if (!normalized) {
        return { synced: false, reason: 'missing_receipt' };
    }

    const [rows] = await db.query(
        `SELECT id, receipt_no, payment_status, xendit_invoice_id
         FROM pos_transactions
         WHERE receipt_no = ?
         LIMIT 1`,
        [normalized]
    );

    const tx = rows[0];
    if (!tx) {
        return { synced: false, reason: 'not_found' };
    }

    const paymentStatus = String(tx.payment_status || '').toUpperCase();
    if (paymentStatus === POS_PAYMENT_STATUS.PAID) {
        try {
            await notifyDisplayPaymentResult({
                invoiceId: tx.xendit_invoice_id,
                status: 'PAID',
                receiptNo: normalized,
            });
        } catch (displayError) {
            console.warn('Display re-notify for paid POS transaction failed:', displayError.message);
        }
        return { synced: false, reason: 'already_paid', payment_status: paymentStatus };
    }

    if (paymentStatus !== POS_PAYMENT_STATUS.PENDING) {
        return { synced: false, reason: 'not_pending', payment_status: paymentStatus };
    }

    const invoiceId = tx.xendit_invoice_id;
    if (!invoiceId) {
        return { synced: false, reason: 'no_invoice_id' };
    }

    const invoice = await fetchXenditInvoice(invoiceId);
    if (!invoice?.id) {
        return { synced: false, reason: 'xendit_fetch_failed' };
    }

    const xenditStatus = String(invoice.status || '').toUpperCase();
    if (!['PAID', 'SETTLED', 'EXPIRED', 'FAILED'].includes(xenditStatus)) {
        return {
            synced: false,
            reason: 'still_pending_on_xendit',
            xendit_status: xenditStatus,
        };
    }

    const payment = buildWebhookPaymentPayload(invoice, normalized);
    const result = await routeXenditInvoiceWebhook(payment);

    if (result?.handled) {
        logPaymentEvent('POS_PAYMENT_SYNCED_FROM_XENDIT', {
            receipt_no: normalized,
            invoice_id: invoice.id,
            xendit_status: xenditStatus,
            duplicate: Boolean(result.duplicate),
        });
    }

    return {
        synced: Boolean(result?.handled),
        xendit_status: xenditStatus,
        ...result,
    };
};

export const syncRecentPendingPosTransactions = async (limit = 15) => {
    const [rows] = await db.query(
        `SELECT receipt_no
         FROM pos_transactions
         WHERE payment_status = ?
           AND xendit_invoice_id IS NOT NULL
           AND xendit_invoice_id != ''
         ORDER BY id DESC
         LIMIT ?`,
        [POS_PAYMENT_STATUS.PENDING, limit]
    );

    const results = [];
    for (const row of rows) {
        try {
            results.push({
                receiptNo: row.receipt_no,
                ...(await syncPosTransactionByReceipt(row.receipt_no)),
            });
        } catch (error) {
            results.push({
                receiptNo: row.receipt_no,
                synced: false,
                error: error.message,
            });
        }
    }

    return results;
};
