import db from '../config/db.js';
import { getDisplayIo } from './displayWebSocketService.js';
import { voidTransaction } from './transactionVoidService.js';
import {
    createCustomerNotification,
    emitPersistedCustomerNotification,
} from './customerNotificationService.js';
import {
    DELIVERY_TRANSITIONS,
    FULFILLMENT_LABELS,
    FULFILLMENT_METHOD,
    FULFILLMENT_STATUS,
    PICKUP_TRANSITIONS,
    TERMINAL_STATUSES,
} from '../utils/fulfillmentStatuses.js';

export class EshopFulfillmentError extends Error {
    constructor(message, code = 'FULFILLMENT_ERROR', statusCode = 400) {
        super(message);
        this.name = 'EshopFulfillmentError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const normalize = (value) => String(value || '').trim().toLowerCase();

export const resolveFulfillmentMethod = (order = {}) => {
    const explicit = normalize(order.fulfillment_method);
    if (explicit === FULFILLMENT_METHOD.DELIVERY || explicit === FULFILLMENT_METHOD.PICKUP) {
        return explicit;
    }
    return normalize(order.location_type) === 'room'
        ? FULFILLMENT_METHOD.DELIVERY
        : FULFILLMENT_METHOD.PICKUP;
};

const isPaymentEligibleForPreparation = (order) => {
    if (normalize(order.payment_status) === 'paid') return true;
    return [
        'cash',
        'cash on delivery',
        'cash on pickup',
        'cod',
    ].includes(normalize(order.payment_method));
};

export const validateFulfillmentTransition = ({ order, nextStatus }) => {
    if (!order) {
        throw new EshopFulfillmentError('Order not found', 'NOT_FOUND', 404);
    }
    if (normalize(order.type) !== 'e-shop') {
        throw new EshopFulfillmentError('Only E-Shop orders support fulfillment', 'NOT_ESHOP', 409);
    }
    if (normalize(order.status) === 'voided') {
        throw new EshopFulfillmentError('Voided orders cannot be updated', 'ORDER_VOIDED', 409);
    }

    const paymentStatus = normalize(order.payment_status);
    if (['failed', 'expired', 'voided'].includes(paymentStatus)) {
        throw new EshopFulfillmentError('The order payment is not eligible for fulfillment', 'PAYMENT_BLOCKED', 409);
    }

    const currentStatus = normalize(order.fulfillment_status) || FULFILLMENT_STATUS.RECEIVED;
    const requestedStatus = normalize(nextStatus);
    if (TERMINAL_STATUSES.includes(currentStatus)) {
        throw new EshopFulfillmentError('Completed or cancelled orders cannot be updated', 'TERMINAL_ORDER', 409);
    }

    const method = resolveFulfillmentMethod(order);
    const transitions = method === FULFILLMENT_METHOD.DELIVERY
        ? DELIVERY_TRANSITIONS
        : PICKUP_TRANSITIONS;
    const allowed = transitions[currentStatus] || [];

    if (!allowed.includes(requestedStatus)) {
        throw new EshopFulfillmentError(
            `Cannot move a ${method} order from ${currentStatus} to ${requestedStatus}`,
            'INVALID_TRANSITION',
            409,
        );
    }

    if (
        currentStatus === FULFILLMENT_STATUS.RECEIVED
        && requestedStatus === FULFILLMENT_STATUS.PREPARING
        && !isPaymentEligibleForPreparation(order)
    ) {
        throw new EshopFulfillmentError(
            'Online payment must be paid before preparation can start',
            'PAYMENT_REQUIRED',
            409,
        );
    }

    return { currentStatus, nextStatus: requestedStatus, method };
};

export const ensureEshopFulfillmentSchema = async () => {
    const [columns] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'pos_transactions'`,
    );
    const columnSet = new Set(columns.map((row) => row.COLUMN_NAME));
    const additions = [
        ['fulfillment_method', 'VARCHAR(20) NULL'],
        ['fulfillment_status', 'VARCHAR(30) NULL'],
        ['fulfillment_updated_at', 'DATETIME NULL'],
        ['fulfillment_updated_by', 'INT NULL'],
        ['fulfillment_cancel_reason', 'VARCHAR(255) NULL'],
    ];

    for (const [column, definition] of additions) {
        if (!columnSet.has(column)) {
            await db.query(`ALTER TABLE pos_transactions ADD COLUMN ${column} ${definition}`);
        }
    }

    for (const sql of [
        'CREATE INDEX idx_pos_fulfillment_status ON pos_transactions (fulfillment_status)',
        'CREATE INDEX idx_pos_type_fulfillment ON pos_transactions (type, fulfillment_status)',
    ]) {
        try {
            await db.query(sql);
        } catch (error) {
            if (error?.code !== 'ER_DUP_KEYNAME') throw error;
        }
    }

    await db.query(
        `CREATE TABLE IF NOT EXISTS pos_fulfillment_history (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            transaction_id INT NOT NULL,
            from_status VARCHAR(30) NULL,
            to_status VARCHAR(30) NOT NULL,
            changed_by INT NULL,
            change_reason VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_fulfillment_history_transaction (transaction_id, created_at),
            CONSTRAINT fk_fulfillment_history_transaction
                FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB`,
    );

    await db.query(
        `UPDATE pos_transactions
         SET fulfillment_method = CASE
                WHEN LOWER(TRIM(location_type)) = 'room' THEN 'delivery'
                ELSE 'pickup'
             END,
             fulfillment_status = 'received',
             fulfillment_updated_at = COALESCE(created_at, TIMESTAMP(transaction_date, transaction_time), NOW())
         WHERE LOWER(TRIM(type)) = 'e-shop'
           AND fulfillment_status IS NULL
           AND UPPER(COALESCE(status, 'ACTIVE')) <> 'VOIDED'`,
    );

    await db.query(
        `INSERT INTO pos_fulfillment_history (
            transaction_id, from_status, to_status, changed_by, change_reason, created_at
         )
         SELECT pt.id, NULL, pt.fulfillment_status, NULL,
                'Existing E-Shop order backfill',
                COALESCE(pt.fulfillment_updated_at, pt.created_at, NOW())
         FROM pos_transactions pt
         WHERE LOWER(TRIM(pt.type)) = 'e-shop'
           AND pt.fulfillment_status IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM pos_fulfillment_history h WHERE h.transaction_id = pt.id
           )`,
    );
};

export const getFulfillmentTimeline = async (transactionId, executor = db) => {
    const [rows] = await executor.query(
        `SELECT h.to_status AS status,
                h.created_at AS timestamp,
                h.changed_by,
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS changed_by_name,
                h.change_reason AS reason
         FROM pos_fulfillment_history h
         LEFT JOIN user u ON u.user_id = h.changed_by
         WHERE h.transaction_id = ?
         ORDER BY h.created_at ASC, h.id ASC`,
        [transactionId],
    );
    return rows.map((row) => ({
        ...row,
        label: FULFILLMENT_LABELS[row.status] || row.status,
    }));
};

const emitFulfillmentUpdated = (order) => {
    const io = getDisplayIo();
    if (!io || !order) return;
    const payload = {
        order_id: order.id,
        fulfillment_method: order.fulfillment_method,
        fulfillment_status: order.fulfillment_status,
        fulfillment_updated_at: order.fulfillment_updated_at,
    };
    // Customer sockets join `user:${userId}` (see customerSocketService.js).
    if (order.customer_user_id) {
        io.to(`user:${order.customer_user_id}`).emit('eshop:fulfillment-updated', payload);
    }
    io.to('staff:eshop-orders').emit('eshop:orders-updated', payload);
};

const notifyCustomerOfFulfillment = async (order) => {
    if (!order?.customer_user_id) return;
    const label = FULFILLMENT_LABELS[order.fulfillment_status] || order.fulfillment_status;
    try {
        await createCustomerNotification({
            userId: order.customer_user_id,
            customerId: order.customer_id,
            title: order.fulfillment_status === FULFILLMENT_STATUS.CANCELLED
                ? 'E-Shop Order Cancelled'
                : `Order ${label}`,
            message: order.fulfillment_status === FULFILLMENT_STATUS.CANCELLED
                ? `Your E-Shop order ${order.receipt_no} was cancelled.`
                : `Your E-Shop order ${order.receipt_no} is now ${label.toLowerCase()}.`,
            type: 'eshop_order',
            link: `/customer?section=activity&tab=orders&focus=${encodeURIComponent(order.receipt_no || order.id || '')}`,
        });
    } catch (error) {
        console.warn('Unable to create E-Shop fulfillment notification:', error.message);
    }
};

const loadOrderForUpdate = async (connection, transactionId) => {
    const [rows] = await connection.query(
        `SELECT pt.*, c.user_id AS customer_user_id
         FROM pos_transactions pt
         LEFT JOIN customers c ON c.customer_id = pt.customer_id
         WHERE pt.id = ?
         LIMIT 1
         FOR UPDATE`,
        [transactionId],
    );
    return rows[0] || null;
};

const loadUpdatedOrder = async (connection, transactionId) => {
    const [rows] = await connection.query(
        `SELECT pt.*, c.user_id AS customer_user_id
         FROM pos_transactions pt
         LEFT JOIN customers c ON c.customer_id = pt.customer_id
         WHERE pt.id = ?
         LIMIT 1`,
        [transactionId],
    );
    return rows[0] || null;
};

export const updateFulfillmentStatus = async ({
    transactionId,
    nextStatus,
    staffId,
    reason = null,
}) => {
    const connection = await db.getConnection();
    let invitationNotificationId = null;
    try {
        await connection.beginTransaction();
        const order = await loadOrderForUpdate(connection, transactionId);
        const transition = validateFulfillmentTransition({ order, nextStatus });

        await connection.query(
            `UPDATE pos_transactions
             SET fulfillment_method = ?,
                 fulfillment_status = ?,
                 fulfillment_updated_at = NOW(),
                 fulfillment_updated_by = ?,
                 fulfillment_cancel_reason = NULL
             WHERE id = ?`,
            [transition.method, transition.nextStatus, staffId || null, transactionId],
        );
        await connection.query(
            `INSERT INTO pos_fulfillment_history (
                transaction_id, from_status, to_status, changed_by, change_reason
             ) VALUES (?, ?, ?, ?, ?)`,
            [transactionId, transition.currentStatus, transition.nextStatus, staffId || null, reason],
        );

        const updatedOrder = await loadUpdatedOrder(connection, transactionId);
        const timeline = await getFulfillmentTimeline(transactionId, connection);
        if (
            [FULFILLMENT_STATUS.DELIVERED, FULFILLMENT_STATUS.PICKED_UP].includes(transition.nextStatus)
            && updatedOrder?.customer_user_id
            && updatedOrder?.customer_id
            && normalize(updatedOrder?.type) === 'e-shop'
            && normalize(updatedOrder?.status) !== 'voided'
            && !updatedOrder?.voided_at
        ) {
            invitationNotificationId = await createCustomerNotification({
                userId: updatedOrder.customer_user_id,
                customerId: updatedOrder.customer_id,
                title: 'Tell us what you thought',
                message: 'Your order has been completed. You can now review the products you purchased.',
                type: 'product_feedback_invitation',
                link: '/customer/orders',
                eventKey: `product_feedback_invitation:transaction:${transactionId}`,
                connection,
            });
        }
        await connection.commit();
        if (invitationNotificationId) {
            await emitPersistedCustomerNotification(invitationNotificationId);
        }
        emitFulfillmentUpdated(updatedOrder);
        await notifyCustomerOfFulfillment(updatedOrder);
        return { order: updatedOrder, timeline };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const cancelFulfillment = async ({
    transactionId,
    staffId,
    reason,
}) => {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
        throw new EshopFulfillmentError('Cancellation reason is required', 'REASON_REQUIRED', 400);
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const order = await loadOrderForUpdate(connection, transactionId);
        const transition = validateFulfillmentTransition({
            order,
            nextStatus: FULFILLMENT_STATUS.CANCELLED,
        });

        await connection.query(
            `UPDATE pos_transactions
             SET fulfillment_method = ?,
                 fulfillment_status = 'cancelled',
                 fulfillment_updated_at = NOW(),
                 fulfillment_updated_by = ?,
                 fulfillment_cancel_reason = ?
             WHERE id = ?`,
            [transition.method, staffId || null, cleanReason, transactionId],
        );
        await connection.query(
            `INSERT INTO pos_fulfillment_history (
                transaction_id, from_status, to_status, changed_by, change_reason
             ) VALUES (?, ?, 'cancelled', ?, ?)`,
            [transactionId, transition.currentStatus, staffId || null, cleanReason],
        );

        await voidTransaction({
            transactionId,
            voidedBy: staffId || null,
            voidReason: cleanReason,
            connection,
        });

        const updatedOrder = await loadUpdatedOrder(connection, transactionId);
        const timeline = await getFulfillmentTimeline(transactionId, connection);
        await connection.commit();
        emitFulfillmentUpdated(updatedOrder);
        await notifyCustomerOfFulfillment(updatedOrder);
        return { order: updatedOrder, timeline };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
