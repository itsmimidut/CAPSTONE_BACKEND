import db from '../config/db.js';
import {
    ESHOP_FEEDBACK_CODE,
    ESHOP_FEEDBACK_ELIGIBLE_STATUSES,
    ESHOP_FEEDBACK_LIMITS,
    ESHOP_FEEDBACK_MODERATION_STATUS,
    ESHOP_FEEDBACK_MODERATION_TRANSITIONS,
    getEshopFeedbackEditDeadline,
    getEshopFeedbackSubmissionDeadline,
    isWithinEshopFeedbackEditWindow,
    isWithinEshopFeedbackSubmissionWindow,
    normalizeEshopValue,
    ESHOP_PUBLIC_SORT_SQL,
} from '../constants/eshopFeedbackRules.js';
import { logAudit } from '../utils/auditLogger.js';
import { getPublicCustomerName } from '../utils/feedbackDisplay.js';
import {
    createCustomerNotification,
    emitPersistedCustomerNotification,
} from './customerNotificationService.js';
import { resolveMenuIdByProductName } from './posTransactionItemService.js';

export class EshopFeedbackServiceError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'EshopFeedbackServiceError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const toIso = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getCustomer = async (userId, executor = db) => {
    const [rows] = await executor.query(
        'SELECT customer_id, user_id FROM customers WHERE user_id = ? LIMIT 1',
        [userId],
    );
    return rows[0] || null;
};

export const findPurchasedLine = async (transactionItemId, executor = db, lock = false) => {
    const [rows] = await executor.query(
        `SELECT
            pti.line_id AS transaction_item_id,
            pti.transaction_id,
            pti.menu_id,
            pti.product_name_snapshot,
            pti.quantity,
            pt.id AS existing_transaction_id,
            pt.customer_id,
            pt.type,
            pt.fulfillment_status,
            pt.status AS transaction_status,
            pt.voided_at,
            (
                SELECT MAX(pfh.created_at)
                FROM pos_fulfillment_history pfh
                WHERE pfh.transaction_id = pt.id
                  AND LOWER(TRIM(pfh.to_status)) IN ('delivered', 'picked_up')
            ) AS fulfilled_at
         FROM pos_transaction_items pti
         LEFT JOIN pos_transactions pt ON pt.id = pti.transaction_id
         WHERE pti.line_id = ?
         LIMIT 1
         ${lock ? 'FOR UPDATE' : ''}`,
        [transactionItemId],
    );
    return rows[0] || null;
};

const findFeedbackByLine = async (transactionItemId, executor = db, lock = false) => {
    const [rows] = await executor.query(
        `SELECT *
         FROM eshop_item_feedback
         WHERE transaction_item_id = ?
         LIMIT 1
         ${lock ? 'FOR UPDATE' : ''}`,
        [transactionItemId],
    );
    return rows[0] || null;
};

const findFeedbackById = async (feedbackId, executor = db, lock = false) => {
    const [rows] = await executor.query(
        `SELECT *
         FROM eshop_item_feedback
         WHERE feedback_id = ?
         LIMIT 1
         ${lock ? 'FOR UPDATE' : ''}`,
        [feedbackId],
    );
    return rows[0] || null;
};

const assertCustomer = (customer) => {
    if (!customer) {
        throw new EshopFeedbackServiceError(403, ESHOP_FEEDBACK_CODE.NOT_OWNER, 'A linked customer account is required.');
    }
};

const assertPurchaseOwnership = (purchase, customer) => {
    if (!purchase) {
        throw new EshopFeedbackServiceError(404, ESHOP_FEEDBACK_CODE.ITEM_NOT_FOUND, 'Purchased item was not found.');
    }
    if (!purchase.existing_transaction_id) {
        throw new EshopFeedbackServiceError(404, ESHOP_FEEDBACK_CODE.TRANSACTION_NOT_FOUND, 'Transaction was not found.');
    }
    assertCustomer(customer);
    if (!purchase.customer_id || Number(purchase.customer_id) !== Number(customer.customer_id)) {
        throw new EshopFeedbackServiceError(403, ESHOP_FEEDBACK_CODE.NOT_OWNER, 'This purchased item does not belong to the customer.');
    }
};

const assertFeedbackOwnership = (feedback, customer) => {
    assertCustomer(customer);
    if (!feedback) {
        throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback was not found.');
    }
    if (Number(feedback.customer_id) !== Number(customer.customer_id)) {
        throw new EshopFeedbackServiceError(403, ESHOP_FEEDBACK_CODE.NOT_OWNER, 'This feedback does not belong to the customer.');
    }
};

export const isReviewablePurchase = (purchase) => (
    normalizeEshopValue(purchase?.type) === 'e-shop'
    && ESHOP_FEEDBACK_ELIGIBLE_STATUSES.has(normalizeEshopValue(purchase?.fulfillment_status))
    && normalizeEshopValue(purchase?.transaction_status) !== 'voided'
    && !purchase?.voided_at
    && Boolean(purchase?.fulfilled_at)
);

const feedbackState = (feedback, now = new Date()) => {
    if (!feedback) return null;
    const withinEditWindow = isWithinEshopFeedbackEditWindow(feedback.created_at, now);
    return {
        feedbackId: feedback.feedback_id,
        deleted: Boolean(feedback.deleted_at),
        moderationStatus: feedback.moderation_status,
        canEdit: !feedback.deleted_at && withinEditWindow,
        canDelete: !feedback.deleted_at && withinEditWindow,
        canRestore: Boolean(feedback.deleted_at) && withinEditWindow,
        editDeadline: toIso(getEshopFeedbackEditDeadline(feedback.created_at)),
    };
};

export const evaluateEshopFeedbackEligibility = ({ purchase, feedback = null, now = new Date() }) => {
    if (!isReviewablePurchase(purchase)) {
        return { eligible: false, code: ESHOP_FEEDBACK_CODE.NOT_ELIGIBLE };
    }

    if (feedback) {
        const state = feedbackState(feedback, now);
        if (state.deleted && state.canRestore) {
            return {
                eligible: false,
                code: ESHOP_FEEDBACK_CODE.FEEDBACK_DELETED_RESTORABLE,
                feedback: state,
            };
        }
        if (!state.canEdit && !state.canRestore) {
            return {
                eligible: false,
                code: ESHOP_FEEDBACK_CODE.EDIT_WINDOW_EXPIRED,
                feedback: state,
            };
        }
        if (!state.deleted && state.canEdit) {
            return {
                eligible: false,
                code: ESHOP_FEEDBACK_CODE.FEEDBACK_EDITABLE,
                feedback: state,
            };
        }
        return {
            eligible: false,
            code: ESHOP_FEEDBACK_CODE.FEEDBACK_EXISTS,
            feedback: state,
        };
    }

    const submissionDeadline = getEshopFeedbackSubmissionDeadline(purchase.fulfilled_at);
    if (!isWithinEshopFeedbackSubmissionWindow(purchase.fulfilled_at, now)) {
        return {
            eligible: false,
            code: ESHOP_FEEDBACK_CODE.SUBMISSION_WINDOW_EXPIRED,
            submissionDeadline: toIso(submissionDeadline),
        };
    }
    return {
        eligible: true,
        code: ESHOP_FEEDBACK_CODE.ELIGIBLE,
        fulfilledAt: toIso(purchase.fulfilled_at),
        submissionDeadline: toIso(submissionDeadline),
    };
};

const mapFeedback = (feedback, now = new Date()) => ({
    feedbackId: feedback.feedback_id,
    transactionId: feedback.transaction_id,
    transactionItemId: feedback.transaction_item_id,
    menuId: feedback.menu_id,
    productName: feedback.product_name_snapshot,
    overallRating: Number(feedback.overall_rating),
    title: feedback.title,
    comment: feedback.comment,
    isAnonymous: Boolean(feedback.is_anonymous),
    moderationStatus: feedback.moderation_status,
    rejectionReason: feedback.rejection_reason,
    adminReply: feedback.admin_reply,
    replyVersion: Number(feedback.reply_version || 0),
    repliedAt: toIso(feedback.replied_at),
    deleted: Boolean(feedback.deleted_at),
    createdAt: toIso(feedback.created_at),
    updatedAt: toIso(feedback.updated_at),
    ...feedbackState(feedback, now),
});

export async function getEligibility({ transactionItemId, userId, now = new Date() }) {
    const [customer, purchase] = await Promise.all([
        getCustomer(userId),
        findPurchasedLine(transactionItemId),
    ]);
    assertPurchaseOwnership(purchase, customer);
    const feedback = await findFeedbackByLine(transactionItemId);
    return evaluateEshopFeedbackEligibility({ purchase, feedback, now });
}

export async function createFeedback({
    userId,
    input,
    req = null,
    auditLogger = logAudit,
    now = new Date(),
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const customer = await getCustomer(userId, connection);
        const purchase = await findPurchasedLine(input.transactionItemId, connection, true);
        assertPurchaseOwnership(purchase, customer);
        const existing = await findFeedbackByLine(input.transactionItemId, connection, true);
        const eligibility = evaluateEshopFeedbackEligibility({ purchase, feedback: existing, now });
        if (!eligibility.eligible) {
            const duplicate = [
                ESHOP_FEEDBACK_CODE.FEEDBACK_EXISTS,
                ESHOP_FEEDBACK_CODE.FEEDBACK_EDITABLE,
                ESHOP_FEEDBACK_CODE.FEEDBACK_DELETED_RESTORABLE,
            ].includes(eligibility.code);
            throw new EshopFeedbackServiceError(
                duplicate ? 409 : 422,
                eligibility.code === ESHOP_FEEDBACK_CODE.FEEDBACK_EDITABLE
                    ? ESHOP_FEEDBACK_CODE.FEEDBACK_EXISTS
                    : eligibility.code,
                'This purchased item is not eligible for new feedback.',
            );
        }

        let menuId = purchase.menu_id ?? null;
        if (menuId == null) {
            menuId = await resolveMenuIdByProductName(connection, purchase.product_name_snapshot);
            if (menuId != null) {
                await connection.query(
                    'UPDATE pos_transaction_items SET menu_id = ? WHERE line_id = ? AND menu_id IS NULL',
                    [menuId, purchase.transaction_item_id],
                );
            }
        }

        const [result] = await connection.query(
            `INSERT INTO eshop_item_feedback (
                transaction_id, transaction_item_id, menu_id, customer_id,
                product_name_snapshot, overall_rating, title, comment,
                is_anonymous, moderation_status, reply_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
            [
                purchase.transaction_id,
                purchase.transaction_item_id,
                menuId,
                customer.customer_id,
                purchase.product_name_snapshot,
                input.overallRating,
                input.title,
                input.comment,
                input.isAnonymous ? 1 : 0,
            ],
        );

        await auditLogger({
            userId,
            action: 'ESHOP_FEEDBACK_CREATED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: result.insertId,
            oldValue: null,
            newValue: {
                transactionId: purchase.transaction_id,
                transactionItemId: purchase.transaction_item_id,
                overallRating: input.overallRating,
                isAnonymous: input.isAnonymous,
                moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING,
            },
            req,
            connection,
        });
        await connection.commit();
        return {
            feedbackId: result.insertId,
            moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING,
        };
    } catch (error) {
        await connection.rollback();
        if (error?.code === 'ER_DUP_ENTRY') {
            throw new EshopFeedbackServiceError(409, ESHOP_FEEDBACK_CODE.FEEDBACK_EXISTS, 'Feedback already exists.');
        }
        throw error;
    } finally {
        connection.release();
    }
}

export async function getCustomerHistory({ userId, page: rawPage, limit: rawLimit, now = new Date() }) {
    const customer = await getCustomer(userId);
    assertCustomer(customer);
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);
    const limit = Math.min(
        ESHOP_FEEDBACK_LIMITS.MAX_PAGE_SIZE,
        Math.max(1, Number.parseInt(rawLimit, 10) || ESHOP_FEEDBACK_LIMITS.DEFAULT_PAGE_SIZE),
    );
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
        `SELECT *
         FROM eshop_item_feedback
         WHERE customer_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [customer.customer_id, limit, offset],
    );
    const [countRows] = await db.query(
        'SELECT COUNT(*) AS total FROM eshop_item_feedback WHERE customer_id = ?',
        [customer.customer_id],
    );
    const total = Number(countRows[0]?.total || 0);
    return {
        feedback: rows.map((row) => mapFeedback(row, now)),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function getFeedback({ transactionItemId, userId, now = new Date() }) {
    const [customer, purchase] = await Promise.all([
        getCustomer(userId),
        findPurchasedLine(transactionItemId),
    ]);
    assertPurchaseOwnership(purchase, customer);
    const feedback = await findFeedbackByLine(transactionItemId);
    if (!feedback) {
        throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback was not found.');
    }
    return mapFeedback(feedback, now);
}

export async function updateFeedback({
    feedbackId,
    userId,
    input,
    req = null,
    auditLogger = logAudit,
    now = new Date(),
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const customer = await getCustomer(userId, connection);
        const existing = await findFeedbackById(feedbackId, connection, true);
        assertFeedbackOwnership(existing, customer);
        if (existing.deleted_at) {
            throw new EshopFeedbackServiceError(409, 'FEEDBACK_DELETED', 'Restore feedback before editing it.');
        }
        if (!isWithinEshopFeedbackEditWindow(existing.created_at, now)) {
            throw new EshopFeedbackServiceError(422, ESHOP_FEEDBACK_CODE.EDIT_WINDOW_EXPIRED, 'The edit window has expired.');
        }

        await connection.query(
            `UPDATE eshop_item_feedback
             SET overall_rating = ?, title = ?, comment = ?, is_anonymous = ?,
                 moderation_status = 'pending', rejection_reason = NULL,
                 moderated_by = NULL, moderated_at = NULL, updated_at = NOW()
             WHERE feedback_id = ?`,
            [input.overallRating, input.title, input.comment, input.isAnonymous ? 1 : 0, feedbackId],
        );
        await auditLogger({
            userId,
            action: 'ESHOP_FEEDBACK_UPDATED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: {
                overallRating: Number(existing.overall_rating),
                isAnonymous: Boolean(existing.is_anonymous),
                moderationStatus: existing.moderation_status,
            },
            newValue: {
                overallRating: input.overallRating,
                isAnonymous: input.isAnonymous,
                moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING,
            },
            req,
            connection,
        });
        await connection.commit();
        return { feedbackId, moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function deleteFeedback({
    feedbackId,
    userId,
    req = null,
    auditLogger = logAudit,
    now = new Date(),
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const customer = await getCustomer(userId, connection);
        const existing = await findFeedbackById(feedbackId, connection, true);
        assertFeedbackOwnership(existing, customer);
        if (existing.deleted_at) {
            await connection.commit();
            return { feedbackId, alreadyDeleted: true };
        }
        if (!isWithinEshopFeedbackEditWindow(existing.created_at, now)) {
            throw new EshopFeedbackServiceError(422, ESHOP_FEEDBACK_CODE.EDIT_WINDOW_EXPIRED, 'The deletion window has expired.');
        }

        await connection.query(
            'UPDATE eshop_item_feedback SET deleted_at = NOW(), deleted_by = ?, updated_at = NOW() WHERE feedback_id = ?',
            [userId, feedbackId],
        );
        await auditLogger({
            userId,
            action: 'ESHOP_FEEDBACK_DELETED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: { deleted: false },
            newValue: { deleted: true },
            req,
            connection,
        });
        await connection.commit();
        return { feedbackId, alreadyDeleted: false };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function restoreFeedback({
    feedbackId,
    userId,
    req = null,
    auditLogger = logAudit,
    now = new Date(),
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const customer = await getCustomer(userId, connection);
        const existing = await findFeedbackById(feedbackId, connection, true);
        assertFeedbackOwnership(existing, customer);
        if (!existing.deleted_at) {
            await connection.commit();
            return { feedbackId, alreadyRestored: true };
        }
        if (!isWithinEshopFeedbackEditWindow(existing.created_at, now)) {
            throw new EshopFeedbackServiceError(422, ESHOP_FEEDBACK_CODE.EDIT_WINDOW_EXPIRED, 'The restoration window has expired.');
        }

        await connection.query(
            `UPDATE eshop_item_feedback
             SET deleted_at = NULL, deleted_by = NULL,
                 moderation_status = 'pending', rejection_reason = NULL,
                 moderated_by = NULL, moderated_at = NULL, updated_at = NOW()
             WHERE feedback_id = ?`,
            [feedbackId],
        );
        await auditLogger({
            userId,
            action: 'ESHOP_FEEDBACK_RESTORED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: { deleted: true, moderationStatus: existing.moderation_status },
            newValue: { deleted: false, moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING },
            req,
            connection,
        });
        await connection.commit();
        return {
            feedbackId,
            alreadyRestored: false,
            moderationStatus: ESHOP_FEEDBACK_MODERATION_STATUS.PENDING,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

const publicSummary = (row = {}) => ({
    averageRating: Number(row.average_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
    ratingDistribution: {
        5: Number(row.five_star || 0),
        4: Number(row.four_star || 0),
        3: Number(row.three_star || 0),
        2: Number(row.two_star || 0),
        1: Number(row.one_star || 0),
    },
});

export async function getPublicFeedback({ menuItemId, page, limit, rating, sort }) {
    const [productLookup] = await db.query(
        'SELECT menu_id, name FROM menu_items WHERE menu_id = ? LIMIT 1',
        [menuItemId],
    );
    const productRow = productLookup[0] || null;
    const productName = productRow?.name || null;

    // Include legacy approved rows saved with NULL menu_id that still match this product name.
    const where = [
        productName
            ? `(f.menu_id = ? OR (f.menu_id IS NULL AND f.product_name_snapshot = ?))`
            : 'f.menu_id = ?',
        "f.moderation_status = 'approved'",
        'f.deleted_at IS NULL',
    ];
    const params = productName ? [menuItemId, productName] : [menuItemId];
    if (rating) {
        where.push('f.overall_rating = ?');
        params.push(rating);
    }
    const offset = (page - 1) * limit;
    const orderBy = ESHOP_PUBLIC_SORT_SQL[sort] || ESHOP_PUBLIC_SORT_SQL.newest;
    const summaryParams = productName ? [menuItemId, productName] : [menuItemId];
    const summaryMenuMatch = productName
        ? '(menu_id = ? OR (menu_id IS NULL AND product_name_snapshot = ?))'
        : 'menu_id = ?';
    const [rows] = await db.query(
        `SELECT f.feedback_id, f.product_name_snapshot, f.overall_rating,
                f.title, f.comment, f.is_anonymous, f.admin_reply,
                f.replied_at, f.created_at,
                CONCAT_WS(' ', u.first_name, u.last_name) AS customer_name
         FROM eshop_item_feedback f
         JOIN customers c ON c.customer_id = f.customer_id
         JOIN user u ON u.user_id = c.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
    );
    const [countResult, summaryResult] = await Promise.all([
        db.query(`SELECT COUNT(*) AS total FROM eshop_item_feedback f WHERE ${where.join(' AND ')}`, params),
        db.query(
            `SELECT ROUND(AVG(overall_rating), 2) AS average_rating,
                    COUNT(*) AS total_reviews,
                    SUM(overall_rating = 5) AS five_star,
                    SUM(overall_rating = 4) AS four_star,
                    SUM(overall_rating = 3) AS three_star,
                    SUM(overall_rating = 2) AS two_star,
                    SUM(overall_rating = 1) AS one_star
             FROM eshop_item_feedback
             WHERE ${summaryMenuMatch}
               AND moderation_status = 'approved'
               AND deleted_at IS NULL`,
            summaryParams,
        ),
    ]);
    const count = countResult[0][0] || {};
    const summaryRow = summaryResult[0][0] || {};
    const totalItems = Number(count?.total || 0);
    return {
        product: {
            menuItemId,
            productName: productRow?.name || rows[0]?.product_name_snapshot || null,
        },
        reviews: rows.map((row) => ({
            feedbackId: row.feedback_id,
            productName: row.product_name_snapshot,
            customerName: getPublicCustomerName({
                isAnonymous: row.is_anonymous,
                customerName: row.customer_name,
            }),
            verifiedPurchase: true,
            overallRating: Number(row.overall_rating),
            title: row.title,
            comment: row.comment,
            adminReply: row.admin_reply,
            repliedAt: toIso(row.replied_at),
            createdAt: toIso(row.created_at),
        })),
        summary: publicSummary(summaryRow),
        pagination: {
            page,
            limit,
            totalPages: Math.ceil(totalItems / limit),
            totalItems,
        },
    };
}

const adminSelect = `
    SELECT f.*, pt.receipt_no AS receipt_reference,
           pt.fulfillment_method,
           CONCAT_WS(' ', u.first_name, u.last_name) AS customer_name,
           (
             SELECT MAX(pfh.created_at) FROM pos_fulfillment_history pfh
             WHERE pfh.transaction_id = f.transaction_id
               AND LOWER(TRIM(pfh.to_status)) IN ('delivered', 'picked_up')
           ) AS fulfilled_at
    FROM eshop_item_feedback f
    JOIN pos_transactions pt ON pt.id = f.transaction_id
    JOIN customers c ON c.customer_id = f.customer_id
    JOIN user u ON u.user_id = c.user_id`;

const mapAdminFeedback = (row) => ({
    feedbackId: row.feedback_id,
    transactionId: row.transaction_id,
    transactionItemId: row.transaction_item_id,
    receiptReference: row.receipt_reference,
    productNameSnapshot: row.product_name_snapshot,
    menuId: row.menu_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    overallRating: Number(row.overall_rating),
    title: row.title,
    comment: row.comment,
    isAnonymous: Boolean(row.is_anonymous),
    moderationStatus: row.moderation_status,
    rejectionReason: row.rejection_reason,
    adminReply: row.admin_reply,
    replyVersion: Number(row.reply_version || 0),
    fulfilledAt: toIso(row.fulfilled_at),
    fulfillmentMethod: row.fulfillment_method,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deleted: Boolean(row.deleted_at),
});

export async function getAdminFeedback(query) {
    const where = [];
    const params = [];
    if (query.status === 'deleted') where.push('f.deleted_at IS NOT NULL');
    else {
        if (query.status !== 'all') {
            where.push('f.moderation_status = ?');
            params.push(query.status);
        }
        where.push('f.deleted_at IS NULL');
    }
    if (query.rating) { where.push('f.overall_rating = ?'); params.push(query.rating); }
    if (query.menuItemId) { where.push('f.menu_id = ?'); params.push(query.menuItemId); }
    if (query.dateFrom) { where.push('f.created_at >= ?'); params.push(`${query.dateFrom} 00:00:00`); }
    if (query.dateTo) { where.push('f.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${query.dateTo} 00:00:00`); }
    if (query.search) {
        const term = `%${query.search}%`;
        where.push(`(f.product_name_snapshot LIKE ? OR f.title LIKE ? OR f.comment LIKE ?
                     OR pt.receipt_no LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`);
        params.push(term, term, term, term, term, term);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.limit;
    const [rows] = await db.query(
        `${adminSelect} ${whereSql}
         ORDER BY ${ESHOP_PUBLIC_SORT_SQL[query.sort] || ESHOP_PUBLIC_SORT_SQL.newest}
         LIMIT ? OFFSET ?`,
        [...params, query.limit, offset],
    );
    const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
         FROM eshop_item_feedback f
         JOIN pos_transactions pt ON pt.id = f.transaction_id
         JOIN customers c ON c.customer_id = f.customer_id
         JOIN user u ON u.user_id = c.user_id
         ${whereSql}`,
        params,
    );
    const [statsRows] = await db.query(
        `SELECT COUNT(*) AS total,
                SUM(deleted_at IS NULL AND moderation_status = 'pending') AS pending,
                SUM(deleted_at IS NULL AND moderation_status = 'approved') AS approved,
                SUM(deleted_at IS NULL AND moderation_status = 'rejected') AS rejected,
                SUM(deleted_at IS NULL AND moderation_status = 'hidden') AS hidden,
                SUM(deleted_at IS NOT NULL) AS deleted
         FROM eshop_item_feedback`,
    );
    const total = Number(countRows[0]?.total || 0);
    const stats = statsRows[0] || {};
    return {
        feedback: rows.map(mapAdminFeedback),
        stats: Object.fromEntries(['total', 'pending', 'approved', 'rejected', 'hidden', 'deleted']
            .map((key) => [key, Number(stats[key] || 0)])),
        pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
        },
    };
}

export async function getAdminFeedbackById({ feedbackId }) {
    const [rows] = await db.query(`${adminSelect} WHERE f.feedback_id = ? LIMIT 1`, [feedbackId]);
    if (!rows.length) throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Product feedback was not found.');
    return mapAdminFeedback(rows[0]);
}

const findAdminFeedbackForUpdate = async (feedbackId, connection) => {
    const [rows] = await connection.query(
        `SELECT f.*, c.user_id AS customer_user_id
         FROM eshop_item_feedback f
         JOIN customers c ON c.customer_id = f.customer_id
         WHERE f.feedback_id = ?
         LIMIT 1 FOR UPDATE`,
        [feedbackId],
    );
    return rows[0] || null;
};

export async function moderateFeedback({
    feedbackId,
    adminUserId,
    status,
    reason = null,
    req = null,
    auditLogger = logAudit,
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const existing = await findAdminFeedbackForUpdate(feedbackId, connection);
        if (!existing) throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Product feedback was not found.');
        if (existing.deleted_at) throw new EshopFeedbackServiceError(409, 'FEEDBACK_DELETED', 'Deleted feedback cannot be moderated.');
        if (!ESHOP_FEEDBACK_MODERATION_TRANSITIONS[existing.moderation_status]?.has(status)) {
            throw new EshopFeedbackServiceError(409, 'INVALID_MODERATION_TRANSITION', `Cannot move feedback from ${existing.moderation_status} to ${status}.`);
        }
        await connection.query(
            `UPDATE eshop_item_feedback
             SET moderation_status = ?, rejection_reason = ?,
                 moderated_by = ?, moderated_at = ?, updated_at = NOW()
             WHERE feedback_id = ?`,
            [
                status,
                status === 'rejected' ? reason : null,
                status === 'pending' ? null : adminUserId,
                status === 'pending' ? null : new Date(),
                feedbackId,
            ],
        );
        const action = {
            approved: 'ESHOP_FEEDBACK_APPROVED',
            rejected: 'ESHOP_FEEDBACK_REJECTED',
            hidden: 'ESHOP_FEEDBACK_HIDDEN',
            pending: 'ESHOP_FEEDBACK_RESET_PENDING',
        }[status];
        await auditLogger({
            userId: adminUserId,
            action,
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: { moderationStatus: existing.moderation_status },
            newValue: { moderationStatus: status, menuId: existing.menu_id },
            req,
            connection,
        });
        await connection.commit();
        return { feedbackId, moderationStatus: status };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function replyToFeedback({
    feedbackId,
    adminUserId,
    reply,
    req = null,
    auditLogger = logAudit,
}) {
    const connection = await db.getConnection();
    let notificationId = null;
    try {
        await connection.beginTransaction();
        const existing = await findAdminFeedbackForUpdate(feedbackId, connection);
        if (!existing) throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Product feedback was not found.');
        if (existing.deleted_at) throw new EshopFeedbackServiceError(409, 'FEEDBACK_DELETED', 'Deleted feedback cannot receive a reply.');
        if (String(existing.admin_reply || '').trim() === reply.trim()) {
            await connection.commit();
            return { feedbackId, replyVersion: Number(existing.reply_version || 0), idempotent: true };
        }
        const replyVersion = Number(existing.reply_version || 0) + 1;
        await connection.query(
            `UPDATE eshop_item_feedback
             SET admin_reply = ?, replied_by = ?, replied_at = NOW(),
                 reply_version = ?, updated_at = NOW()
             WHERE feedback_id = ?`,
            [reply, adminUserId, replyVersion, feedbackId],
        );
        notificationId = await createCustomerNotification({
            userId: existing.customer_user_id,
            customerId: existing.customer_id,
            title: 'Management replied to your product review',
            message: `The resort has replied to your review of ${existing.product_name_snapshot}.`,
            type: 'product_feedback_reply',
            link: '/customer/eshop-feedback',
            eventKey: `product_feedback_reply:${feedbackId}:${replyVersion}`,
            connection,
        });
        await auditLogger({
            userId: adminUserId,
            action: 'ESHOP_FEEDBACK_REPLIED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: { replyVersion: Number(existing.reply_version || 0) },
            newValue: { replyVersion, menuId: existing.menu_id },
            req,
            connection,
        });
        await connection.commit();
        if (notificationId) await emitPersistedCustomerNotification(notificationId);
        return { feedbackId, replyVersion, idempotent: false };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function restoreFeedbackAsAdmin({
    feedbackId,
    adminUserId,
    req = null,
    auditLogger = logAudit,
}) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const existing = await findAdminFeedbackForUpdate(feedbackId, connection);
        if (!existing) throw new EshopFeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Product feedback was not found.');
        if (!existing.deleted_at) throw new EshopFeedbackServiceError(409, 'FEEDBACK_NOT_DELETED', 'Feedback is not deleted.');
        await connection.query(
            `UPDATE eshop_item_feedback
             SET deleted_at = NULL, deleted_by = NULL,
                 moderation_status = 'pending', rejection_reason = NULL,
                 moderated_by = NULL, moderated_at = NULL, updated_at = NOW()
             WHERE feedback_id = ?`,
            [feedbackId],
        );
        await auditLogger({
            userId: adminUserId,
            action: 'ESHOP_FEEDBACK_ADMIN_RESTORED',
            entityType: 'ESHOP_ITEM_FEEDBACK',
            entityId: feedbackId,
            oldValue: { deleted: true, moderationStatus: existing.moderation_status },
            newValue: { deleted: false, moderationStatus: 'pending', menuId: existing.menu_id },
            req,
            connection,
        });
        await connection.commit();
        return { feedbackId, moderationStatus: 'pending' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}
