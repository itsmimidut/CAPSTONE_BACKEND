/**
 * ============================================================
 * POS (Point of Sale) Controller
 * ============================================================
 * 
 * Purpose:
 * - Manage POS transactions for walk-in payments
 * - Handle transaction history and receipts
 * - Provide items/services catalog for POS
 * 
 * Database Tables:
 * - pos_transactions: Store all POS transactions
 * - inventory_items: Catalog of services/items for sale
 * 
 * Features:
 * - Create and track transactions
 * - Transaction history management
 * - Multi-category item catalog (Restaurant, Rooms, Cottage, Events)
 */

import { db } from '../config/db.js';
import { assertCustomerIdAccess } from '../middleware/ownership.js';
import { calculateTransactionTotal, PosPricingError } from '../services/posPricingService.js';
import { generateReceiptNumber } from '../services/receiptService.js';
import { POS_PAYMENT_STATUS, POS_TRANSACTION_STATUS } from '../utils/paymentStatuses.js';
import { markPending, markPaid } from '../services/paymentStatusService.js';
import { applyInventoryDeduction } from '../services/inventorySettlementService.js';
import { finalizeBookingsForPaidTransaction } from '../services/bookingCheckoutService.js';
import { createPosGcashInvoice } from '../services/posXenditService.js';
import { voidTransaction, TransactionVoidError } from '../services/transactionVoidService.js';
import { getPosTransactionColumnSet } from '../services/paymentStatusService.js';
import { pushPaymentToDisplay } from '../services/displayPaymentService.js';
import {
    syncPosTransactionByReceipt,
    syncRecentPendingPosTransactions,
} from '../services/posXenditSyncService.js';
import {
    PosReceiptPrintError,
    prepareAndQueuePrint,
    normalizeReceiptNo,
    retryFailedPrintJob,
} from '../services/posReceiptPrintService.js';
import { getPrintJobById, listPrintJobsByReceipt } from '../services/printJobService.js';
import {
    completeOrderSession,
    lockActiveOrderSession,
    PosOrderSessionError,
} from '../services/posOrderSessionService.js';
import { logSystemEvent } from '../utils/logger.js';

const getAuthenticatedUserId = (req) => Number(req.user?.id ?? req.user?.user_id ?? 0) || null;

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const isCashPayment = (method) => String(method || '').trim().toLowerCase() === 'cash';
const isGcashPayment = (method) => String(method || '').trim().toLowerCase() === 'gcash';

const resolveCustomerIdForUser = async (userId) => {
    const [customerRows] = await db.query(
        'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
        [userId],
    );

    return customerRows.length > 0 ? customerRows[0].customer_id : null;
};

const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const normalizeSizeOption = (size, index) => {
    const rawLabel = size?.label ?? size?.name ?? size?.size ?? `Option ${index + 1}`;
    const rawDelta = size?.priceDelta ?? size?.price ?? size?.additionalPrice ?? 0;
    return {
        id: String(size?.id ?? rawLabel ?? `size-${index + 1}`)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-'),
        label: String(rawLabel || `Option ${index + 1}`).trim(),
        priceDelta: Number(rawDelta || 0)
    };
};

const normalizeAddOnOption = (addon, index) => {
    const rawName = addon?.name ?? addon?.label ?? addon?.title ?? `Add-on ${index + 1}`;
    const rawPrice = addon?.price ?? addon?.amount ?? addon?.additionalPrice ?? 0;
    return {
        id: String(addon?.id ?? rawName ?? `addon-${index + 1}`)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-'),
        name: String(rawName || `Add-on ${index + 1}`).trim(),
        price: Number(rawPrice || 0)
    };
};

const mapRestaurantItems = (rows) => rows.map(item => ({
    id: item.menu_id,
    menu_id: item.menu_id,
    item_id: item.menu_id,
    category: 'restaurant',
    name: item.name,
    price: parseFloat(item.price),
    description: item.description || 'Uncategorized',
    image_url: item.image_url || '',
    sizes: parseJsonArray(item.sizes).map((size, index) => normalizeSizeOption(size, index)),
    addons: parseJsonArray(item.addons).map((addon, index) => normalizeAddOnOption(addon, index)),
    available: 1
}));

const fetchRestaurantItems = async () => {
    /**
     * FEATURE: Automatic filtering of items with critical inventory ingredients
     * 
     * When an ingredient for a menu item has 'critical' status in the inventory,
     * that menu item is automatically excluded from the POS list.
     * 
     * STATUS LEVELS:
     * - critical: quantity <= threshold/2 (ITEM HIDDEN FROM POS)
     * - low: threshold/2 < quantity <= threshold
     * - good: quantity > threshold
     */

    const [columnRows] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'menu_items'
           AND COLUMN_NAME IN ('sizes', 'addons')`
    );

    const columnSet = new Set(columnRows.map(row => row.COLUMN_NAME));
    const selectColumns = [
        'menu_id',
        'name',
        'price',
        'image_url',
        "COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as description"
    ];

    if (columnSet.has('sizes')) selectColumns.push('sizes');
    if (columnSet.has('addons')) selectColumns.push('addons');

    const [menuItems] = await db.query(
        `SELECT ${selectColumns.join(', ')}
         FROM menu_items
         WHERE available = 1
         ORDER BY name`
    );

    // Filter out items with critical inventory ingredients
    const filteredItems = [];

    for (const item of menuItems) {
        try {
            // Check if this menu item has any ingredients with critical status
            const [ingredients] = await db.query(`
                SELECT i.status
                FROM menu_ingredients mi
                JOIN inventory i ON mi.inventory_id = i.inventory_id
                WHERE mi.menu_id = ? AND i.status = 'critical'
                LIMIT 1
            `, [item.menu_id]);

            // Only include item if it has no critical ingredients
            if (ingredients.length === 0) {
                filteredItems.push(item);
            }
        } catch (error) {
            // If there's an error checking ingredients, include the item (fail-safe)
            console.log(`⚠️ Error checking ingredients for menu_id ${item.menu_id}:`, error.message);
            filteredItems.push(item);
        }
    }

    return mapRestaurantItems(filteredItems);
};

// ============================================================
// GET ALL TRANSACTIONS
// ============================================================
/**
 * Handler: GET /api/pos/transactions
 * Query Params: ?userId=1 (optional - filters to specific user)
 * 
 * Purpose: Retrieve POS transaction history (filtered by user if provided)
 * Response: Array of transactions sorted by newest first
 */
export const getAllTransactions = async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        console.log('[posController] getAllTransactions called with query:', req.query);

        try {
            await syncRecentPendingPosTransactions(10);
        } catch (syncError) {
            console.warn('[posController] Pending POS Xendit sync skipped:', syncError.message);
        }

        let query = `
            SELECT pt.*,
                   NULLIF(TRIM(CONCAT(vu.first_name, ' ', vu.last_name)), '') AS voided_by_name
            FROM pos_transactions pt
            LEFT JOIN user vu ON pt.voided_by = vu.user_id
        `;
        const conditions = [];
        const params = [];

        if (userId) {
            conditions.push('pt.user_id = ?');
            params.push(userId);
        }
        if (startDate) {
            conditions.push('DATE(pt.transaction_date) >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('DATE(pt.transaction_date) <= ?');
            params.push(endDate);
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ' ORDER BY pt.created_at DESC';

        console.log('[posController] getAllTransactions - final query:', query, 'params:', params);
        const [rows] = await db.query(query, params);

        // Parse items JSON string back to array
        const transactions = rows.map(row => ({
            ...row,
            items: JSON.parse(row.items || '[]'),
            bookingDetails: parseJsonArray(row.booking_details || row.bookingDetails)
        }));

        res.json(transactions);
    } catch (error) {
        console.error('Error fetching POS transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};

// ============================================================
// GET SINGLE TRANSACTION
// ============================================================
/**
 * Handler: GET /api/pos/transactions/:id
 * 
 * Purpose: Retrieve a specific transaction by ID
 * Params: id - Transaction ID
 */
export const getTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM pos_transactions WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const transaction = {
            ...rows[0],
            items: JSON.parse(rows[0].items || '[]'),
            bookingDetails: parseJsonArray(rows[0].booking_details || rows[0].bookingDetails)
        };

        res.json(transaction);
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Failed to fetch transaction' });
    }
};

/**
 * Handler: GET /api/pos/payment-status/:receiptNo
 * Public read-only status for GCash return URL after POS payment.
 */
export const getPosPaymentStatusByReceipt = async (req, res) => {
    try {
        const receiptNo = String(req.params.receiptNo || '').trim();
        if (!receiptNo) {
            return res.status(400).json({ success: false, error: 'Receipt number is required' });
        }

        let [rows] = await db.query(
            `SELECT receipt_no, payment_status, status, total_amount, transaction_date, transaction_time, xendit_invoice_id
             FROM pos_transactions
             WHERE receipt_no = ?
             LIMIT 1`,
            [receiptNo]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'POS transaction not found' });
        }

        let tx = rows[0];
        let paymentStatus = String(tx.payment_status || '').toUpperCase();

        if (paymentStatus === 'PENDING' && tx.xendit_invoice_id) {
            try {
                await syncPosTransactionByReceipt(receiptNo);
                [rows] = await db.query(
                    `SELECT receipt_no, payment_status, status, total_amount, transaction_date, transaction_time, xendit_invoice_id
                     FROM pos_transactions
                     WHERE receipt_no = ?
                     LIMIT 1`,
                    [receiptNo]
                );
                tx = rows[0] || tx;
                paymentStatus = String(tx.payment_status || '').toUpperCase();
            } catch (syncError) {
                console.warn('getPosPaymentStatusByReceipt sync failed:', syncError.message);
            }
        }

        return res.json({
            success: true,
            receiptNo: tx.receipt_no,
            payment_status: paymentStatus,
            transaction_status: String(tx.status || 'ACTIVE').toUpperCase(),
            isPaid: paymentStatus === 'PAID',
            isPending: paymentStatus === 'PENDING',
            isFailed: ['FAILED', 'EXPIRED', 'VOIDED'].includes(paymentStatus),
            total_amount: Number(tx.total_amount || 0),
            transaction_date: tx.transaction_date,
            transaction_time: tx.transaction_time,
            invoiceId: tx.xendit_invoice_id || null,
        });
    } catch (error) {
        console.error('getPosPaymentStatusByReceipt error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch POS payment status' });
    }
};

export const getTopPosItems = async (req, res) => {
    try {
        const { startDate, endDate, from_date, to_date } = req.query;
        console.log('[posController] getTopPosItems called with query:', req.query);
        const conditions = ['pt.total_amount IS NOT NULL', 'COALESCE(pt.type, "") NOT IN ("E-Shop","Delivery")'];
        const params = [];
        const start = startDate || from_date;
        const end = endDate || to_date;

        if (start) {
            conditions.push('DATE(pt.transaction_date) >= ?');
            params.push(start);
        }
        if (end) {
            conditions.push('DATE(pt.transaction_date) <= ?');
            params.push(end);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `SELECT
                             COALESCE(pti.item_name, 'N/A') AS item,
                             SUM(COALESCE(pti.quantity, 0)) AS quantity,
                             SUM(COALESCE(pti.quantity, 0) * COALESCE(pti.unit_price, 0)) AS sales
                         FROM pos_transaction_items pti
                         JOIN pos_transactions pt ON pt.id = pti.transaction_id
                         ${whereClause}
                         GROUP BY pti.item_name
                         ORDER BY sales DESC, quantity DESC
                         LIMIT 10`;

        console.log('[posController] getTopPosItems - final query:', sql, 'params:', params);

        const [rows] = await db.query(
            sql,
            params
        );

        // If debug flag provided, also return the matching transaction count and SQL for troubleshooting
        if (req.query && String(req.query.debug) === '1') {
            try {
                const countSql = `SELECT COUNT(DISTINCT pt.id) AS cnt FROM pos_transactions pt ${whereClause}`
                const [countRows] = await db.query(countSql, params)
                const transactionCount = Number(countRows[0]?.cnt || 0)
                return res.json({ success: true, data: rows, debug: { sql, params, transactionCount, countSql } })
            } catch (err) {
                console.warn('[posController] getTopPosItems debug count failed:', err.message)
                return res.json({ success: true, data: rows, debug: { sql, params } })
            }
        }

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching top POS items:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch top POS items', error: error.message });
    }
};

// ============================================================
// CREATE NEW TRANSACTION
// ============================================================
/**
 * Handler: POST /api/pos/transactions
 * 
 * Purpose: Create a new POS transaction WITH INVENTORY DEDUCTION
 * 
 * Request Body:
 * {
 *   receiptNo: string,
 *   items: Array<{name: string, price: number, menu_id?: number, quantity?: number}>,
 *   type: string (e.g., "Walk-in"),
 *   payment: string (e.g., "Cash", "GCash"),
 *   total: number,
 *   date: string,
 *   time: string
 * }
 */
export const createTransaction = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const {
            items,
            type,
            payment,
            payment_method,
            cash_received: cashReceivedSnake,
            cashReceived,
            paid_amount,
            paidAmount,
            transaction_date,
            transaction_time,
            date,
            time,
            paymentUrl,
            payment_url,
            order_session_id: orderSessionIdSnake,
            orderSessionId,
            station_id: stationIdSnake,
            stationId,
            terminal_id: terminalIdSnake,
            terminalId,
        } = req.body;

        const authenticatedUserId = getAuthenticatedUserId(req);
        if (!authenticatedUserId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'UNAUTHORIZED',
            });
        }

        const normalizedType = type ?? 'Walk-in';
        const normalizedPayment = payment ?? payment_method;
        const normalizedPaymentUrl = paymentUrl ?? payment_url ?? null;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one item is required',
            });
        }

        if (!normalizedPayment) {
            return res.status(400).json({
                success: false,
                error: 'Payment method is required',
            });
        }

        await connection.beginTransaction();

        const requestedOrderSessionId = orderSessionIdSnake ?? orderSessionId ?? null;
        const normalizedStationId = stationIdSnake ?? stationId ?? null;
        const normalizedTerminalId = terminalIdSnake ?? terminalId ?? null;
        const orderSession = requestedOrderSessionId
            ? await lockActiveOrderSession(connection, {
                sessionId: requestedOrderSessionId,
                userId: authenticatedUserId,
                stationId: normalizedStationId,
                terminalId: normalizedTerminalId,
            })
            : null;

        // Always stamp walk-in POS sales with MySQL server date/time so they
        // stay aligned with station-day service order numbers in PH timezones.
        const [[serverClock]] = await connection.query(
            'SELECT CURDATE() AS transaction_date, CURTIME() AS transaction_time'
        );
        const normalizedDate = orderSession?.service_order_date
            ?? serverClock.transaction_date;
        const normalizedTime = serverClock.transaction_time;

        const { items: pricedItems, totalAmount } = await calculateTransactionTotal(items, connection);
        const normalizedReceiptNo = await generateReceiptNumber(connection);

        let normalizedPaidAmount = totalAmount;
        let normalizedChangeAmount = 0;

        if (isCashPayment(normalizedPayment)) {
            const tendered = Number(cashReceivedSnake ?? cashReceived ?? paid_amount ?? paidAmount);
            if (!Number.isFinite(tendered) || tendered < totalAmount) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: 'Cash received must be greater than or equal to the computed total',
                    total_amount: totalAmount,
                });
            }
            normalizedPaidAmount = roundMoney(tendered);
            normalizedChangeAmount = roundMoney(tendered - totalAmount);
        }

        const paymentStatus = isCashPayment(normalizedPayment)
            ? POS_PAYMENT_STATUS.PAID
            : POS_PAYMENT_STATUS.PENDING;
        const paymentProcessed = isCashPayment(normalizedPayment) ? 1 : 0;
        const paidAtValue = isCashPayment(normalizedPayment) ? new Date() : null;

        const itemsJson = JSON.stringify(pricedItems);

        const columnSet = await getPosTransactionColumnSet(connection);

        const insertColumns = [
            'receipt_no',
            'items',
            'payment_method',
            'total_amount',
            'transaction_date',
            'transaction_time'
        ];
        const insertValues = [
            normalizedReceiptNo,
            itemsJson,
            normalizedPayment,
            totalAmount,
            normalizedDate,
            normalizedTime
        ];

        if (columnSet.has('type')) {
            insertColumns.push('type');
            insertValues.push(normalizedType);
        }
        if (columnSet.has('cash_received')) {
            insertColumns.push('cash_received');
            insertValues.push(normalizedPaidAmount);
        }
        if (columnSet.has('change_amount')) {
            insertColumns.push('change_amount');
            insertValues.push(normalizedChangeAmount);
        }
        if (columnSet.has('payment_url') && normalizedPaymentUrl) {
            insertColumns.push('payment_url');
            insertValues.push(normalizedPaymentUrl);
        }
        if (columnSet.has('booking_details')) {
            insertColumns.push('booking_details');
            insertValues.push(JSON.stringify(req.body.bookingDetails || req.body.booking_details || []));
        }
        if (columnSet.has('user_id')) {
            insertColumns.push('user_id');
            insertValues.push(authenticatedUserId);
        }
        if (columnSet.has('payment_status')) {
            insertColumns.push('payment_status');
            insertValues.push(paymentStatus);
        }
        if (columnSet.has('payment_processed')) {
            insertColumns.push('payment_processed');
            insertValues.push(paymentProcessed);
        }
        if (columnSet.has('status')) {
            insertColumns.push('status');
            insertValues.push(POS_TRANSACTION_STATUS.ACTIVE);
        }
        if (columnSet.has('paid_at') && paidAtValue) {
            insertColumns.push('paid_at');
            insertValues.push(paidAtValue);
        }
        if (orderSession && columnSet.has('service_order_number')) {
            insertColumns.push('service_order_number');
            insertValues.push(orderSession.service_order_number);
        }
        if (orderSession && columnSet.has('service_order_date')) {
            insertColumns.push('service_order_date');
            insertValues.push(orderSession.service_order_date);
        }
        if (orderSession && columnSet.has('order_type')) {
            insertColumns.push('order_type');
            insertValues.push(orderSession.order_type);
        }
        if (orderSession && columnSet.has('station_id')) {
            insertColumns.push('station_id');
            insertValues.push(orderSession.station_id);
        }
        if (orderSession && columnSet.has('terminal_id')) {
            insertColumns.push('terminal_id');
            insertValues.push(orderSession.terminal_id);
        }
        if (orderSession && columnSet.has('location_type')) {
            insertColumns.push('location_type');
            insertValues.push(orderSession.location_type);
        }
        if (orderSession && columnSet.has('location_number')) {
            insertColumns.push('location_number');
            insertValues.push(orderSession.location_number);
        }
        if (orderSession && columnSet.has('delivery_notes')) {
            insertColumns.push('delivery_notes');
            insertValues.push(orderSession.delivery_notes);
        }
        if (orderSession && columnSet.has('pickup_name')) {
            insertColumns.push('pickup_name');
            insertValues.push(orderSession.pickup_name);
        }
        if (orderSession && columnSet.has('recipient_name')) {
            insertColumns.push('recipient_name');
            insertValues.push(orderSession.recipient_name);
        }

        const placeholders = insertColumns.map(() => '?').join(', ');
        const [result] = await connection.query(
            `INSERT INTO pos_transactions (${insertColumns.join(', ')}) VALUES (${placeholders})`,
            insertValues
        );

        const transactionId = result.insertId;
        let invoicePayload = null;

        if (isCashPayment(normalizedPayment)) {
            await applyInventoryDeduction(connection, { payment_status: paymentStatus, items: pricedItems }, pricedItems);
            await finalizeBookingsForPaidTransaction(connection, pricedItems, authenticatedUserId);
            await markPaid(connection, transactionId, { paidAt: paidAtValue || new Date() });
        } else if (isGcashPayment(normalizedPayment)) {
            const payerEmail = String(req.body.payer_email || req.body.email || 'pos@eduardos.com').trim();
            const payerName = String(req.body.payer_name || req.body.customerName || 'POS Walk-in').trim();
            invoicePayload = await createPosGcashInvoice({
                receiptNo: normalizedReceiptNo,
                amount: totalAmount,
                email: payerEmail,
                customerName: payerName,
                description: `Eduardo's Resort POS - ${normalizedReceiptNo}`,
            });
            await markPending(connection, transactionId, {
                invoiceId: invoicePayload.invoiceId,
                paymentReference: invoicePayload.paymentReference,
                paymentUrl: invoicePayload.paymentUrl,
            });
        }

        const [detailTableRows] = await connection.query(
            `SELECT COUNT(*) AS total
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_transaction_items'`
        );

        if (detailTableRows[0]?.total > 0) {
            for (const item of pricedItems) {
                const quantity = Number(item.quantity ?? item.qty ?? 1);
                const lineTotal = Number(item.price ?? 0);
                const unitPrice = Number(item.unitPrice ?? (quantity > 0 ? lineTotal / quantity : lineTotal));

                await connection.query(
                    `INSERT INTO pos_transaction_items
                    (transaction_id, receipt_no, item_name, quantity, unit_price, line_total, booking_reference)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        result.insertId,
                        normalizedReceiptNo,
                        item.name ?? null,
                        quantity,
                        unitPrice,
                        lineTotal,
                        item.bookingReference ?? null
                    ]
                );
            }
        }

        if (orderSession) {
            await completeOrderSession(connection, orderSession.id, transactionId);
        }

        await connection.commit();

        let displayPush = null;
        if (isGcashPayment(normalizedPayment) && invoicePayload) {
            try {
                displayPush = await pushPaymentToDisplay({
                    stationId: req.body?.station_id || req.body?.stationId,
                    terminalId: req.body?.terminal_id || req.body?.terminalId,
                    receiptNo: normalizedReceiptNo,
                    amount: totalAmount,
                    invoiceId: invoicePayload.invoiceId,
                    paymentUrl: invoicePayload.paymentUrl,
                    items: pricedItems,
                    serviceOrderNumber: orderSession?.service_order_number ?? null,
                    orderType: orderSession?.order_type ?? null,
                    locationNumber: orderSession?.location_number ?? null,
                });
            } catch (displayError) {
                console.warn('Customer display push failed:', displayError.message);
            }
        }

        res.status(201).json({
            success: true,
            message: isGcashPayment(normalizedPayment)
                ? 'POS transaction created. Awaiting GCash payment confirmation.'
                : 'Transaction created successfully with inventory deduction',
            transactionId,
            receiptNo: normalizedReceiptNo,
            receipt_no: normalizedReceiptNo,
            total_amount: totalAmount,
            paid_amount: normalizedPaidAmount,
            change_amount: normalizedChangeAmount,
            payment_status: paymentStatus,
            payment_url: invoicePayload?.paymentUrl || normalizedPaymentUrl || null,
            xendit_invoice_id: invoicePayload?.invoiceId || null,
            items: pricedItems,
            display_push: displayPush,
            service_order_number: orderSession?.service_order_number ?? null,
            service_order_date: orderSession?.service_order_date ?? null,
            order_type: orderSession?.order_type ?? null,
            location_type: orderSession?.location_type ?? null,
            location_number: orderSession?.location_number ?? null,
            pickup_name: orderSession?.pickup_name ?? null,
            recipient_name: orderSession?.recipient_name ?? null,
            delivery_notes: orderSession?.delivery_notes ?? null,
        });
    } catch (error) {
        await connection.rollback();

        if (error instanceof PosPricingError) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }

        if (error instanceof PosOrderSessionError) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }

        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                error: 'Receipt number conflict. Please retry checkout.',
                code: 'DUPLICATE_RECEIPT',
            });
        }

        console.error('Error creating transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to create transaction', details: error.message });
    } finally {
        connection.release();
    }
};

// ============================================================
// DELETE TRANSACTION
// ============================================================
/**
 * Handler: DELETE /api/pos/transactions/:id
 * 
 * Purpose: Delete a specific transaction
 * Params: id - Transaction ID
 */
export const deleteTransaction = async (req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Transaction deletion is disabled. Use POST /api/pos/transactions/:id/void instead.',
        code: 'DELETE_DISABLED',
    });
};

export const voidPosTransaction = async (req, res) => {
    try {
        const transactionId = Number(req.params.id);
        const voidReason = String(req.body?.reason || req.body?.void_reason || '').trim();

        if (!voidReason) {
            return res.status(400).json({ success: false, error: 'Void reason is required' });
        }
        const voidedBy = getAuthenticatedUserId(req);

        if (!transactionId) {
            return res.status(400).json({ success: false, error: 'Transaction id is required' });
        }

        if (!voidedBy) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const result = await voidTransaction({
            transactionId,
            voidedBy,
            voidReason,
        });

        return res.json(result);
    } catch (error) {
        if (error instanceof TransactionVoidError) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }

        console.error('voidPosTransaction error:', error);
        return res.status(500).json({ success: false, error: 'Failed to void transaction' });
    }
};

// ============================================================
// CLEAR ALL TRANSACTIONS
// ============================================================
/**
 * Handler: DELETE /api/pos/transactions
 * 
 * Purpose: Delete all transaction history
 */
export const clearAllTransactions = async (req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Clearing transaction history is disabled. Void individual transactions instead.',
        code: 'CLEAR_DISABLED',
    });
};

const normalizeEshopPaymentMethod = (body) => {
    const raw = body?.paymentMethod ?? body?.payment_method ?? 'cash';
    const key = String(raw).trim().toLowerCase();
    if (key === 'gcash') return { key: 'gcash', label: 'GCash' };
    if (key === 'maya') return { key: 'maya', label: 'Maya' };
    return { key: 'cash', label: 'Cash on Delivery' };
};

const resolveInitialFulfillmentMethod = (locationType) => (
    String(locationType || '').trim().toLowerCase() === 'room'
        ? 'delivery'
        : 'pickup'
);

const deductEshopInventory = async (connection, cart) => {
    const [columnRows] = await connection.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory'
           AND COLUMN_NAME IN ('reorder_level', 'threshold')`
    );
    const hasReorderLevel = columnRows.some((row) => row.COLUMN_NAME === 'reorder_level');
    const reorderExpr = hasReorderLevel ? 'COALESCE(reorder_level, threshold)' : 'threshold';

    for (const item of cart) {
        const [menuResult] = await connection.query(
            'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 1',
            [item.name]
        );

        const menuId = menuResult?.[0]?.menu_id;
        if (!menuId) continue;

        const [ingredients] = await connection.query(`
            SELECT inventory_id, quantity_needed
            FROM menu_ingredients
            WHERE menu_id = ?
        `, [menuId]);

        const quantity = item.qty || 1;

        for (const ingredient of ingredients) {
            const deductAmount = ingredient.quantity_needed * quantity;

            const [invRows] = await connection.query(
                `SELECT inventory_id, quantity, ${reorderExpr} AS reorder_level
                 FROM inventory
                 WHERE inventory_id = ?
                 LIMIT 1`,
                [ingredient.inventory_id]
            );
            const inv = invRows[0];
            if (!inv) continue;
            const nextQty = Number(inv.quantity || 0) - Number(deductAmount || 0);
            const reorderLevel = Math.max(0, Number(inv.reorder_level || 0));
            const nextStatus = nextQty <= 0 ? 'critical' : (nextQty <= reorderLevel ? 'low' : 'good');

            await connection.query(`
                UPDATE inventory 
                SET quantity = ?,
                    status = ?,
                    updated_at = NOW()
                WHERE inventory_id = ?
            `, [nextQty, nextStatus, ingredient.inventory_id]);
        }
    }
};
/**
 * Handler: POST /api/pos/eshop/order
 * 
 * Purpose: Create a new e-shop order with delivery location
 * 
 * Request Body:
 * {
 *   cart: Array<{name: string, price: number, qty: number}>,
 *   locationType: string ("Room", "Cottage", "Day Guest"),
 *   locationNumber: string (optional for Day Guest),
 *   deliveryNotes: string (optional),
 *   totalAmount: number
 * }
 *
 * customer_id and user_id are derived from the authenticated session (not req.body).
 * 
 * Response:
 * {
 *   success: true,
 *   orderId: number,
 *   receiptNo: string,
 *   message: string
 * }
 */
export const createEshopOrder = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const {
            cart,
            locationType,
            locationNumber,
            deliveryNotes,
            totalAmount,
            serviceFee,
            grandTotal,
            email,
            customerName,
        } = req.body;

        const payment = normalizeEshopPaymentMethod(req.body);
        if (payment.key === 'maya') {
            return res.status(400).json({
                success: false,
                error: 'Maya payments are not available yet. Please choose Cash or GCash.',
            });
        }

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'UNAUTHORIZED',
            });
        }

        const customerId = await resolveCustomerIdForUser(userId);
        if (!customerId) {
            return res.status(400).json({
                success: false,
                error: 'CUSTOMER_NOT_FOUND',
            });
        }

        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({
                error: 'Cart is required and must contain at least one item'
            });
        }

        if (!locationType) {
            return res.status(400).json({
                error: 'Location type is required (Room, Cottage, or Day Guest)'
            });
        }

        if (locationType === 'Room' && !locationNumber) {
            return res.status(400).json({
                error: 'Delivery location is required for room delivery'
            });
        }

        const feeAmount = roundMoney(serviceFee || 0);
        const computedGrandTotal = roundMoney(
            grandTotal > 0 ? grandTotal : Number(totalAmount || 0) + feeAmount
        );

        if (!computedGrandTotal || computedGrandTotal <= 0) {
            return res.status(400).json({
                error: 'Total amount is required and must be greater than 0'
            });
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        const receiptNo = `ESHOP-${dateStr}-${randomNum}`;

        await connection.beginTransaction();

        const itemsFormatted = cart.map(item => ({
            menu_id: item.menu_id || item.id || null,
            name: item.name,
            price: parseFloat(item.price),
            quantity: item.qty,
            subtotal: parseFloat(item.price) * item.qty,
            image_url: String(item.image_url || item.image || '').trim(),
            customization: item.customization || null,
        }));

        const itemsJson = JSON.stringify(itemsFormatted);
        const transactionDate = now.toISOString().split('T')[0];
        const transactionTime = now.toTimeString().split(' ')[0];
        const columnSet = await getPosTransactionColumnSet(connection);
        const fulfillmentMethod = resolveInitialFulfillmentMethod(locationType);
        const isCash = payment.key === 'cash';
        const isGcash = payment.key === 'gcash';
        const paymentStatus = POS_PAYMENT_STATUS.PENDING;

        if (isCash) {
            await deductEshopInventory(connection, cart);
        }

        const insertColumns = [
            'receipt_no',
            'items',
            'payment_method',
            'total_amount',
            'transaction_date',
            'transaction_time',
        ];
        const insertValues = [
            receiptNo,
            itemsJson,
            payment.label,
            computedGrandTotal,
            transactionDate,
            transactionTime,
        ];

        const optionalFields = [
            ['type', 'E-Shop'],
            ['location_type', locationType],
            ['location_number', locationNumber || null],
            ['delivery_notes', deliveryNotes || null],
            ['customer_id', customerId],
            ['user_id', userId],
            ['fulfillment_method', fulfillmentMethod],
            ['fulfillment_status', 'received'],
        ];

        for (const [column, value] of optionalFields) {
            if (columnSet.has(column)) {
                insertColumns.push(column);
                insertValues.push(value);
            }
        }

        if (columnSet.has('payment_status')) {
            insertColumns.push('payment_status');
            insertValues.push(paymentStatus);
        }
        if (columnSet.has('payment_processed')) {
            insertColumns.push('payment_processed');
            insertValues.push(0);
        }
        if (columnSet.has('status')) {
            insertColumns.push('status');
            insertValues.push(POS_TRANSACTION_STATUS.ACTIVE);
        }
        if (columnSet.has('fulfillment_updated_at')) {
            insertColumns.push('fulfillment_updated_at');
            insertValues.push(now);
        }

        const placeholders = insertColumns.map(() => '?').join(', ');
        const [result] = await connection.query(
            `INSERT INTO pos_transactions (${insertColumns.join(', ')}) VALUES (${placeholders})`,
            insertValues
        );

        const transactionId = result.insertId;
        let invoicePayload = null;

        if (columnSet.has('fulfillment_status')) {
            await connection.query(
                `INSERT INTO pos_fulfillment_history (
                    transaction_id, from_status, to_status, changed_by, change_reason
                 ) VALUES (?, NULL, 'received', NULL, 'Order placed')`,
                [transactionId],
            );
        }

        if (isGcash) {
            const payerEmail = String(email || req.user?.email || 'eshop@eduardos.com').trim();
            const payerName = String(customerName || req.user?.name || 'E-Shop Customer').trim();
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

            invoicePayload = await createPosGcashInvoice({
                receiptNo,
                amount: computedGrandTotal,
                email: payerEmail,
                customerName: payerName,
                description: `Eduardo's E-Shop Order - ${receiptNo}`,
                successRedirectUrl: `${frontendUrl}/customer?activeSection=esop&eshopPayment=success&order=${receiptNo}`,
                failureRedirectUrl: `${frontendUrl}/customer?activeSection=esop&eshopPayment=failed&order=${receiptNo}`,
            });

            await markPending(connection, transactionId, {
                invoiceId: invoicePayload.invoiceId,
                paymentReference: invoicePayload.paymentReference,
                paymentUrl: invoicePayload.paymentUrl,
            });
        }

        await connection.commit();

        const responseBody = {
            success: true,
            orderId: transactionId,
            order_number: receiptNo,
            receiptNo,
            receipt_no: receiptNo,
            payment_method: payment.key,
            payment_status: isCash ? 'CASH_ON_DELIVERY' : paymentStatus,
            message: isGcash
                ? 'Order created. Complete GCash payment to confirm your order.'
                : 'Order placed successfully! Your food will be delivered in 30-45 minutes.',
            estimatedDelivery: '30-45 minutes',
            deliveryLocation: locationType === 'Day Guest'
                ? 'Day Guest Area'
                : locationType === 'Cottage'
                    ? 'Restaurant Pickup'
                    : `${locationType} ${locationNumber || ''}`.trim(),
            service_fee: feeAmount,
            grand_total: computedGrandTotal,
        };

        if (invoicePayload) {
            responseBody.invoice_url = invoicePayload.paymentUrl;
            responseBody.payment_url = invoicePayload.paymentUrl;
            responseBody.xendit_invoice_id = invoicePayload.invoiceId;
            responseBody.qr_code = invoicePayload.paymentUrl;
        }

        res.status(201).json(responseBody);
    } catch (error) {
        await connection.rollback();
        console.error('Error creating e-shop order:', error);
        res.status(500).json({
            error: 'Failed to create order',
            details: error.message
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// GET CUSTOMER ORDER HISTORY
// ============================================================
/**
 * Handler: GET /api/pos/orders/customer/:customerId
 * 
 * Purpose: Get order history for a specific customer
 * Params: customerId - customers.customer_id (not user_id)
 * Response: Array of customer's E-Shop orders
 */
const fetchEshopOrdersForCustomer = async (customerId) => {
    const [orders] = await db.query(
        `SELECT * FROM pos_transactions 
         WHERE type = 'E-Shop' AND customer_id = ?
         ORDER BY transaction_date DESC, transaction_time DESC
         LIMIT 50`,
        [customerId],
    );

    const parsedOrders = orders.map((order) => ({
        ...order,
        items: parseJsonArray(order.items),
    }));

    const itemNames = [...new Set(parsedOrders
        .flatMap((order) => order.items)
        .map((item) => String(item?.name || item?.item_name || '').trim())
        .filter(Boolean))];

    const menuByName = new Map();
    if (itemNames.length) {
        const placeholders = itemNames.map(() => '?').join(', ');
        const [menuRows] = await db.query(
            `SELECT menu_id, name, image_url FROM menu_items WHERE name IN (${placeholders})`,
            itemNames,
        );
        menuRows.forEach((menuItem) => {
            menuByName.set(String(menuItem.name || '').trim().toLowerCase(), menuItem);
        });
    }

    return parsedOrders.map((order) => ({
        ...order,
        items: order.items.map((item) => {
            const menuItem = menuByName.get(String(item?.name || item?.item_name || '').trim().toLowerCase());
            return {
                ...item,
                menu_id: item?.menu_id || menuItem?.menu_id || null,
                image_url: item?.image_url || item?.image || menuItem?.image_url || '',
            };
        }),
    }));
};

/**
 * Handler: GET /api/pos/orders/me
 * Returns E-Shop orders for the authenticated user (customer_id resolved server-side).
 */
export const getMyEshopOrders = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'UNAUTHORIZED',
            });
        }

        const customerId = await resolveCustomerIdForUser(userId);
        if (!customerId) {
            return res.status(400).json({
                success: false,
                error: 'CUSTOMER_NOT_FOUND',
            });
        }

        const orders = await fetchEshopOrdersForCustomer(customerId);
        return res.json(orders);
    } catch (error) {
        console.error('Error fetching my e-shop orders:', error);
        return res.status(500).json({ error: 'Failed to fetch order history' });
    }
};

export const getCustomerOrders = async (req, res) => {
    try {
        const { customerId } = req.params;

        if (!(await assertCustomerIdAccess(req, res, customerId))) {
            return;
        }

        const orders = await fetchEshopOrdersForCustomer(customerId);
        res.json(orders);
    } catch (error) {
        console.error('Error fetching customer orders:', error);
        res.status(500).json({ error: 'Failed to fetch order history' });
    }
};

// ============================================================
// GET ALL ITEMS/SERVICES
// ============================================================
/**
 * Handler: GET /api/pos/items
 * 
 * Purpose: Retrieve all available items/services for POS
 * Response: Combined data from menu_items and inventory_items tables
 */
export const getAllItems = async (req, res) => {
    try {
        let allItems = [];

        console.log('🔍 Fetching POS items...');

        // Get restaurant items from menu_items table
        try {
            const restaurantItems = await fetchRestaurantItems();

            console.log('🍔 Found', restaurantItems.length, 'restaurant items from menu_items category');

            allItems.push(...restaurantItems);
        } catch (menuError) {
            console.log('⚠️ menu_items table not found, using pos_items for restaurant');
        }

        // Get rooms and cottages from inventory_items table
        try {
            const [inventoryItems] = await db.query(
                `SELECT name, price, category, category_type 
                 FROM inventory_items 
                 WHERE status = 'Available' AND (category LIKE '%Room%' OR category = 'Cottage')`
            );

            console.log('🏨 Found', inventoryItems.length, 'inventory items (rooms/cottages)');
            console.log('🏨 Inventory items:', inventoryItems);

            // Format rooms (any category containing "Room")
            const rooms = inventoryItems
                .filter(item => item.category && item.category.toLowerCase().includes('room'))
                .map(item => ({
                    category: 'rooms',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

            console.log('🛏️ Formatted', rooms.length, 'rooms');

            // Format cottages
            const cottages = inventoryItems
                .filter(item => item.category && item.category.toLowerCase().includes('cottage'))
                .map(item => ({
                    category: 'cottage',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

            console.log('🏡 Formatted', cottages.length, 'cottages');

            allItems.push(...rooms, ...cottages);
        } catch (inventoryError) {
            console.log('⚠️ inventory_items table not found, using pos_items for rooms/cottages');
            console.error('Inventory error:', inventoryError.message);
        }

        // Get event items from inventory_items
        const [eventItems] = await db.query(
            `SELECT name, price, category, category_type 
             FROM inventory_items 
             WHERE status = 'Available' AND category = 'Event'`
        );

        const formattedEventItems = eventItems.map(item => ({
            category: 'event',
            name: item.name,
            price: parseFloat(item.price),
            description: item.category_type,
            available: 1
        }));

        console.log('🎉 Found', formattedEventItems.length, 'event items from inventory_items');

        allItems.push(...formattedEventItems);

        console.log('✅ Total items to return:', allItems.length);
        console.log('📋 Items by category:', {
            restaurant: allItems.filter(i => i.category === 'restaurant').length,
            rooms: allItems.filter(i => i.category === 'rooms').length,
            cottage: allItems.filter(i => i.category === 'cottage').length,
            event: allItems.filter(i => i.category === 'event').length
        });

        res.json(allItems);
    } catch (error) {
        console.error('Error fetching POS items:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};

// ============================================================
// GET ITEMS BY CATEGORY
// ============================================================
/**
 * Handler: GET /api/pos/items/category/:category
 * 
 * Purpose: Retrieve items for a specific category from system tables
 */
export const getItemsByCategory = async (req, res) => {
    try {
        const { category } = req.params;

        // Restaurant items from menu_items table
        if (category === 'restaurant') {
            try {
                const restaurantItems = await fetchRestaurantItems();
                return res.json(restaurantItems);
            } catch (error) {
                console.log('Using pos_items for restaurant');
            }
        }

        // Rooms from inventory_items table
        if (category === 'rooms') {
            try {
                const [roomItems] = await db.query(
                    `SELECT name, price, category_type 
                     FROM inventory_items 
                     WHERE status = 'Available' AND category = 'Room' 
                     ORDER BY name`
                );

                const items = roomItems.map(item => ({
                    category: 'rooms',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

                return res.json(items);
            } catch (error) {
                console.log('Using pos_items for rooms');
            }
        }

        // Cottages from inventory_items table
        if (category === 'cottage') {
            try {
                const [cottageItems] = await db.query(
                    `SELECT name, price, category_type 
                     FROM inventory_items 
                     WHERE status = 'Available' AND category = 'Cottage' 
                     ORDER BY name`
                );

                const items = cottageItems.map(item => ({
                    category: 'cottage',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

                return res.json(items);
            } catch (error) {
                console.log('Using pos_items for cottages');
            }
        }

        // Fallback to inventory_items for any category
        const [rows] = await db.query(
            `SELECT name, price, category, category_type 
             FROM inventory_items 
             WHERE status = 'Available' AND category = ? 
             ORDER BY name`,
            [category]
        );

        const items = rows.map(item => ({
            category: category.toLowerCase(),
            name: item.name,
            price: parseFloat(item.price),
            description: item.category_type,
            available: 1
        }));

        res.json(items);
    } catch (error) {
        console.error('Error fetching items by category:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};

// ============================================================
// THERMAL PRINTER ENDPOINTS
// ============================================================

const DEPRECATED_PRINT_MESSAGE =
    'This endpoint is deprecated. Use POST /api/pos/print/:receiptNo with { type: "regular" | "booking" }.';

/**
 * Handler: POST /api/pos/print/:receiptNo
 * Secure print — backend rebuilds receipt data from the database.
 */
export const printReceiptSecure = async (req, res) => {
    try {
        const receiptNo = String(req.params.receiptNo || '').trim();
        const { type, bookingReference, source } = req.body || {};
        const stationId = req.body?.stationId ?? req.body?.station_id ?? null;
        const requestedBy = Number(req.user?.id ?? req.user?.user_id ?? 0) || null;
        const printSource = String(source || 'manual').trim().toLowerCase() === 'auto'
            ? 'auto'
            : 'manual';

        if (!receiptNo) {
            return res.status(400).json({
                success: false,
                message: 'Receipt number is required',
                code: 'MISSING_RECEIPT',
            });
        }

        if (printSource === 'auto') {
            const { queueCheckoutPrints } = await import('../services/posReceiptPrintService.js');
            const checkoutResult = await queueCheckoutPrints({
                receiptNo,
                stationId,
                requestedBy,
            });

            if (!checkoutResult.printed) {
                return res.json({
                    success: false,
                    printed: false,
                    warning: checkoutResult.warning,
                    code: checkoutResult.code || 'PRINT_SKIPPED',
                    warnings: checkoutResult.warnings || [],
                });
            }

            const primary = checkoutResult.results?.[0] || {};
            return res.json({
                success: true,
                message: checkoutResult.results?.length > 1
                    ? 'Receipt and order tickets sent to printer'
                    : 'Receipt sent to printer',
                receiptNo: primary.displayReceiptNo || receiptNo,
                printType: primary.printType || 'regular',
                jobId: primary.jobId || null,
                jobStatus: primary.jobStatus || null,
                jobFile: primary.jobFile || null,
                duplicateSkipped: Boolean(primary.duplicateSkipped),
                warnings: checkoutResult.warnings || [],
                results: checkoutResult.results || [],
            });
        }

        const result = await prepareAndQueuePrint({
            receiptNo,
            type,
            bookingReference,
            source: printSource,
            requestedBy,
            stationId,
        });

        logSystemEvent('POS_RECEIPT_PRINT', {
            receipt_no: result.receiptNo,
            transaction_id: result.transactionId,
            print_type: result.printType,
            booking_reference: result.bookingReference || null,
            print_job_id: result.jobId,
            job_status: result.jobStatus,
            duplicate_skipped: Boolean(result.duplicateSkipped),
            source: printSource,
            status: result.duplicateSkipped ? 'duplicate_skipped' : 'queued',
        }, 'info');

        return res.json({
            success: true,
            message: result.duplicateSkipped
                ? 'Print job already exists for this auto-print request'
                : 'Receipt sent to printer',
            receiptNo: result.displayReceiptNo,
            printType: result.printType,
            jobId: result.jobId,
            jobStatus: result.jobStatus,
            jobFile: result.jobFile || null,
            duplicateSkipped: Boolean(result.duplicateSkipped),
            retriedFailedJob: Boolean(result.retriedFailedJob),
        });
    } catch (error) {
        if (error instanceof PosReceiptPrintError) {
            logSystemEvent('POS_RECEIPT_PRINT_REJECTED', {
                receipt_no: String(req.params.receiptNo || '').trim(),
                print_type: req.body?.type || null,
                code: error.code,
                reason: error.message,
            }, 'warn');

            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }

        logSystemEvent('POS_RECEIPT_PRINT_ERROR', {
            receipt_no: String(req.params.receiptNo || '').trim(),
            print_type: req.body?.type || null,
            error: error.message,
        }, 'error');

        return res.status(500).json({
            success: false,
            message: 'Printer service error',
            error: error.message,
        });
    }
};

/**
 * @deprecated Use POST /api/pos/print/:receiptNo
 */
export const printBookingReceipt = async (req, res) => {
    return res.status(410).json({
        success: false,
        message: DEPRECATED_PRINT_MESSAGE,
        code: 'ENDPOINT_DEPRECATED',
    });
};

/**
 * @deprecated Use POST /api/pos/print/:receiptNo
 */
export const printRegularReceipt = async (req, res) => {
    return res.status(410).json({
        success: false,
        message: DEPRECATED_PRINT_MESSAGE,
        code: 'ENDPOINT_DEPRECATED',
    });
};

/**
 * Handler: GET /api/pos/print-jobs/:jobId
 */
export const getPrintJobStatus = async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);
        if (!Number.isFinite(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid print job id is required',
            });
        }

        const job = await getPrintJobById(jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Print job not found',
                code: 'JOB_NOT_FOUND',
            });
        }

        return res.json({
            success: true,
            job,
        });
    } catch (error) {
        logSystemEvent('POS_PRINT_JOB_STATUS_ERROR', {
            job_id: req.params.jobId,
            error: error.message,
        }, 'error');

        return res.status(500).json({
            success: false,
            message: 'Failed to load print job',
            error: error.message,
        });
    }
};

/**
 * Handler: POST /api/pos/print-jobs/:jobId/retry
 */
export const retryPrintJob = async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);
        if (!Number.isFinite(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid print job id is required',
            });
        }

        const requestedBy = Number(req.user?.id ?? req.user?.user_id ?? 0) || null;
        const result = await retryFailedPrintJob(jobId, requestedBy);

        logSystemEvent('POS_PRINT_JOB_RETRY', {
            original_job_id: jobId,
            new_job_id: result.jobId,
            receipt_no: result.receiptNo,
            print_type: result.printType,
            booking_reference: result.bookingReference || null,
            status: result.jobStatus,
        }, 'info');

        return res.json({
            success: true,
            jobId: result.jobId,
            jobStatus: result.jobStatus,
            message: 'Print retry queued.',
            receiptNo: result.displayReceiptNo,
            printType: result.printType,
            bookingReference: result.bookingReference || null,
        });
    } catch (error) {
        if (error instanceof PosReceiptPrintError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }

        logSystemEvent('POS_PRINT_JOB_RETRY_ERROR', {
            job_id: req.params.jobId,
            error: error.message,
        }, 'error');

        return res.status(500).json({
            success: false,
            message: 'Failed to retry print job',
            error: error.message,
        });
    }
};

/**
 * Handler: GET /api/pos/print/:receiptNo/jobs
 * List tracked print jobs for a receipt.
 */
export const getPrintJobsByReceipt = async (req, res) => {
    try {
        const receiptNo = normalizeReceiptNo(req.params.receiptNo);
        if (!receiptNo) {
            return res.status(400).json({
                success: false,
                message: 'Receipt number is required',
            });
        }

        const jobs = await listPrintJobsByReceipt(receiptNo);
        return res.json({
            success: true,
            receiptNo,
            jobs,
        });
    } catch (error) {
        logSystemEvent('POS_PRINT_JOBS_LIST_ERROR', {
            receipt_no: String(req.params.receiptNo || '').trim(),
            error: error.message,
        }, 'error');

        return res.status(500).json({
            success: false,
            message: 'Failed to load print jobs',
            error: error.message,
        });
    }
};

/**
 * Handler: GET /api/pos/printer/test
 * 
 * Purpose: Test if thermal printer is connected and ready
 * Response: Connection status
 */
export const testPrinter = async (req, res) => {
    try {
        const { testPrinterConnection } = await import('../services/printerService.js');
        const result = await testPrinterConnection();

        res.json(result);

    } catch (error) {
        console.error('Printer test error:', error);
        res.status(500).json({
            connected: false,
            message: 'Printer test failed',
            error: error.message
        });
    }
};

/**
 * Handler: GET /api/pos/printer/queue
 * 
 * Purpose: Get list of pending print jobs in queue
 * Response: Array of pending print files
 */
export const getPrintJobsQueue = async (req, res) => {
    try {
        const { getPendingPrintJobs } = await import('../services/printerService.js');
        const result = await getPendingPrintJobs();

        res.json(result);

    } catch (error) {
        console.error('Print queue error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get print queue',
            error: error.message
        });
    }
};
