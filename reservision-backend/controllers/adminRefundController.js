import db from "../config/db.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLogger.js";
import { processApprovedRefundViaXendit, getXenditPaymentContextForBooking } from "../services/xenditRefundService.js";
import {
    getRefundNotificationTarget,
    notifyRefundApproved,
    notifyRefundRejected,
} from "../services/customerNotificationService.js";
import { BOOKING_STATUS, REFUND_STATUS } from "../utils/paymentStatuses.js";
import { calculateRemainingRefundableAmount, canRejectRefundStatus, sanitizeSpreadsheetCell } from "../utils/refundPolicy.js";

const ALLOWED_REFUND_TYPES = ["Full", "Partial", "No Refund"];
const ALLOWED_REFUND_REASONS = [
    "Customer cancellation",
    "Duplicate payment",
    "Wrong booking date",
    "Unavailable room/cottage/event",
    "Admin cancellation",
    "Service issue",
    "Other",
    "Waiting for admin review"
];

const normalizeRefundType = (value) => {
    if (!value) return null;
    const normalized = String(value).trim();
    if (/^full(\s+refund)?$/i.test(normalized)) return "Full";
    if (/^partial(\s+refund)?$/i.test(normalized)) return "Partial";
    if (/^no\s*refund$/i.test(normalized)) return "No Refund";
    return normalized;
};

const getAdminName = (req) => {
    return req.user?.name || req.user?.email || "Admin";
};

const sendError = (res, status, message, code = "ERROR", errors = {}) => {
    return res.status(status).json({
        success: false,
        error: message,
        message,
        code,
        errors
    });
};

const toNumber = (value) => Number(value || 0);

const APPROVABLE_REFUND_STATUSES = [REFUND_STATUS.PENDING, REFUND_STATUS.FAILED];

const getRemainingRefundableAmount = async (bookingId, connection = db) => {
    const [rows] = await connection.query(
        `SELECT
           COALESCE((
             SELECT SUM(p.amount) FROM payments p
             WHERE p.booking_id = b.booking_id
               AND LOWER(COALESCE(p.status, '')) IN ('paid','settled','completed','success')
           ), b.total, 0) AS paid_amount,
           COALESCE((
             SELECT SUM(r.refund_amount) FROM refunds r
             WHERE r.booking_id = b.booking_id
               AND LOWER(COALESCE(r.refund_status, '')) IN ('completed','refunded','approved')
           ), 0) AS completed_refund_amount
         FROM bookings b WHERE b.booking_id = ? LIMIT 1`,
        [bookingId],
    );
    const row = rows[0] || {};
    return calculateRemainingRefundableAmount({
        paidAmount: row.paid_amount,
        completedRefundAmount: row.completed_refund_amount,
    });
};

const getRefundableAmountForRefund = async (refund) => {
    return getRemainingRefundableAmount(refund.booking_id);
};

const getBookingPaidAmount = (booking) => {
    return toNumber(
        booking.total_amount ??
        booking.total ??
        booking.totalAmount ??
        booking.amount_paid ??
        booking.paid_amount ??
        booking.payment_amount ??
        0
    );
};

const generateRefundReference = async () => {
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10).replace(/-/g, "");

    const [rows] = await db.query(
        `SELECT COUNT(*) AS count FROM refunds WHERE DATE(created_at) = CURDATE()`
    );

    const next = String(Number(rows[0]?.count || 0) + 1).padStart(3, "0");

    return `REF-${ymd}-${next}`;
};

const buildRefundFilters = (query) => {
    const whereClauses = [];
    const params = [];

    if (query.from_date) {
        whereClauses.push(`DATE(r.requested_at) >= ?`);
        params.push(query.from_date);
    }

    if (query.to_date) {
        whereClauses.push(`DATE(r.requested_at) <= ?`);
        params.push(query.to_date);
    }

    if (query.status) {
        whereClauses.push(`r.refund_status = ?`);
        params.push(query.status);
    }

    if (query.payment_method) {
        whereClauses.push(`COALESCE(p.payment_method, b.payment_method, '') = ?`);
        params.push(query.payment_method);
    }

    if (query.search) {
        const search = `%${query.search}%`;
        whereClauses.push(`(
      r.refund_reference LIKE ?
      OR b.booking_reference LIKE ?
      OR COALESCE(c.first_name, '') LIKE ?
      OR COALESCE(c.last_name, '') LIKE ?
      OR COALESCE(c.email, '') LIKE ?
      OR COALESCE(b.payment_method, '') LIKE ?
      OR COALESCE(p.payment_method, '') LIKE ?
      OR COALESCE(bi.item_name, '') LIKE ?
    )`);
        params.push(search, search, search, search, search, search, search, search);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    return { whereSql, params };
};

const serializeCsvRow = (row) => {
    return row.map((value) => {
        if (value === null || value === undefined) {
            return "";
        }

        const stringValue = sanitizeSpreadsheetCell(value);
        if (/[",\r\n]/.test(stringValue)) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    }).join(",");
};

export const getRefunds = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const perPage = Math.min(Math.max(Number(req.query.per_page) || 15, 1), 100);
        const offset = (page - 1) * perPage;

        const { whereSql, params } = buildRefundFilters(req.query);

        const listQuery = `
      SELECT
        r.refund_id,
        r.refund_reference,
        r.booking_id,
        b.booking_reference AS booking_code,
        CONCAT(COALESCE(u.first_name, c.first_name, ''), ' ', COALESCE(u.last_name, c.last_name, '')) AS customer_name,
        COALESCE(MAX(p.payment_method), b.payment_method, '') AS payment_method,
        r.original_amount,
        r.refund_amount,
        r.refund_type,
        r.refund_reason,
        r.refund_status,
        r.requested_at,
        r.requested_by,
        r.approved_at,
        r.approved_by,
        r.refunded_at,
        r.gateway_reference,
        r.refund_note,
        GROUP_CONCAT(DISTINCT bi.item_name SEPARATOR ', ') AS booked_item,
        b.check_in_date,
        b.check_out_date,
        COALESCE(MAX(p.status), b.payment_status, '') AS payment_status
      FROM refunds r
      LEFT JOIN bookings b ON b.booking_id = r.booking_id
      LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
      LEFT JOIN \`user\` u ON u.user_id = c.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      ${whereSql}
      GROUP BY r.refund_id
      ORDER BY r.requested_at DESC
      LIMIT ? OFFSET ?
    `;

        const listParams = [...params, perPage, offset];
        const [rows] = await db.query(listQuery, listParams);

        const countQuery = `
      SELECT COUNT(DISTINCT r.refund_id) AS total
      FROM refunds r
      LEFT JOIN bookings b ON b.booking_id = r.booking_id
      LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
      LEFT JOIN \`user\` u ON u.user_id = c.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      ${whereSql}
    `;
        const [countResult] = await db.query(countQuery, params);
        const total = Number(countResult[0]?.total || 0);

        const summaryQuery = `
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN refund_status = 'Pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN refund_status = 'Processing' THEN 1 ELSE 0 END) AS processing_count,
        SUM(CASE WHEN refund_status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN refund_status = 'Rejected' THEN 1 ELSE 0 END) AS rejected_count,
        SUM(CASE WHEN refund_status = 'Failed' THEN 1 ELSE 0 END) AS failed_count,
        COALESCE(SUM(CASE WHEN refund_status IN ('Completed','Refunded','Approved') THEN refund_amount ELSE 0 END), 0) AS total_refunded_amount
      FROM (
        SELECT DISTINCT
          r.refund_id,
          r.refund_status,
          r.refund_amount
        FROM refunds r
      LEFT JOIN bookings b ON b.booking_id = r.booking_id
      LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
      LEFT JOIN \`user\` u ON u.user_id = c.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      ${whereSql}
      ) AS summary_r
    `;
        const [summaryResult] = await db.query(summaryQuery, params);

        return res.json({
            success: true,
            data: rows,
            pagination: {
                total,
                per_page: perPage,
                current_page: page,
                last_page: Math.max(Math.ceil(total / perPage), 1)
            },
            summary: summaryResult[0] || {
                total_requests: 0,
                pending_count: 0,
                processing_count: 0,
                completed_count: 0,
                rejected_count: 0,
                failed_count: 0,
                total_refunded_amount: 0
            }
        });
    } catch (error) {
        console.error("getRefunds error", error);
        return sendError(res, 500, "Failed to fetch refunds.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    }
};

export const getRefundById = async (req, res) => {
    try {
        const refundId = Number(req.params.id);
        if (!refundId) {
            return sendError(res, 400, "Refund ID is required.", "VALIDATION_ERROR");
        }

        const query = `
      SELECT
        r.*,
        b.booking_id AS booking_id,
        b.booking_reference AS booking_code,
        b.check_in_date,
        b.check_out_date,
        b.booking_status AS booking_status,
        CONCAT(COALESCE(u.first_name, c.first_name, ''), ' ', COALESCE(u.last_name, c.last_name, '')) AS customer_name,
        COALESCE(u.email, c.email) AS customer_email,
        COALESCE(u.phone, c.phone) AS customer_phone,
        COALESCE(MAX(p.payment_method), b.payment_method, '') AS payment_method,
        COALESCE(MAX(p.status), b.payment_status, '') AS payment_status,
        COALESCE(r.original_amount, MAX(p.amount), b.total, 0) AS paid_amount,
        GROUP_CONCAT(DISTINCT bi.item_name SEPARATOR ', ') AS booked_item,
        GROUP_CONCAT(DISTINCT bi.item_type SEPARATOR ', ') AS item_type
      FROM refunds r
      LEFT JOIN bookings b ON b.booking_id = r.booking_id
      LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
      LEFT JOIN \`user\` u ON u.user_id = c.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      WHERE r.refund_id = ?
      GROUP BY r.refund_id
    `;

        const [rows] = await db.query(query, [refundId]);
        if (!rows || rows.length === 0) {
            return sendError(res, 404, "Refund not found.", "REFUND_NOT_FOUND");
        }

        const refund = rows[0];
        const paymentContext = await getXenditPaymentContextForBooking(refund.booking_id);

        const response = {
            refund_id: refund.refund_id,
            refund_reference: refund.refund_reference,
            booking: {
                booking_id: refund.booking_id,
                booking_code: refund.booking_code,
                customer_name: refund.customer_name,
                customer_email: refund.customer_email,
                check_in_date: refund.check_in_date,
                check_out_date: refund.check_out_date,
                booked_item: refund.booked_item,
                item_type: refund.item_type,
                booking_status: refund.booking_status
            },
            payment: {
                payment_method: refund.payment_method,
                payment_status: refund.payment_status,
                original_amount: refund.original_amount,
                paid_amount: toNumber(refund.paid_amount),
                xendit_refundable: paymentContext.refundable,
                xendit_message: paymentContext.message,
                payment_gateways: paymentContext.gateways,
            },
            refund: {
                refund_type: refund.refund_type,
                refund_reason: refund.refund_reason,
                refund_amount: refund.refund_amount,
                refund_method: refund.refund_method,
                refund_status: refund.refund_status,
                refund_note: refund.refund_note,
                gateway_reference: refund.gateway_reference,
                gateway_status: refund.gateway_status
            },
            timeline: {
                requested_at: refund.requested_at,
                requested_by: refund.requested_by,
                approved_at: refund.approved_at,
                approved_by: refund.approved_by,
                refunded_at: refund.refunded_at,
                rejected_at: refund.rejected_at,
                rejected_by: refund.rejected_by
            }
        };

        return res.json({ success: true, data: response });
    } catch (error) {
        console.error("getRefundById error", error);
        return sendError(res, 500, "Failed to fetch refund details.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    }
};

export const createRefund = async (req, res) => {
    let connection;
    try {
        connection = await db.getConnection();
        const { booking_id, refund_reason, refund_note } = req.body;
        const bookingId = Number(booking_id);

        if (!bookingId) {
            return sendError(res, 400, "Booking ID is required.", "VALIDATION_ERROR");
        }

        const [bookingRows] = await connection.query(
            `
      SELECT b.*, 
        b.payment_status AS booking_payment_status,
        MAX(p.status) AS latest_payment_status,
        COALESCE(MAX(p.status), b.payment_status) AS resolved_payment_status,
        COALESCE(SUM(p.amount), b.total, 0) AS resolved_paid_amount,
        COALESCE(MAX(p.payment_method), b.payment_method, '') AS resolved_payment_method
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      WHERE b.booking_id = ?
      GROUP BY b.booking_id
      `,
            [bookingId]
        );

        if (!bookingRows || bookingRows.length === 0) {
            return sendError(res, 404, "Booking not found.", "BOOKING_NOT_FOUND");
        }

        const booking = bookingRows[0];
        const paidAmount = toNumber(booking.resolved_paid_amount || booking.paid_amount || 0);
        const originalAmount = getBookingPaidAmount(booking);

        const paymentStatusCandidates = [booking.resolved_payment_status, booking.booking_payment_status, booking.payment_status]
            .filter(Boolean)
            .join(" ");

        const hasPositivePaidAmount = paidAmount > 0;
        const isPaid = /(paid|completed|success|settled)/i.test(paymentStatusCandidates);

        if (!hasPositivePaidAmount || !isPaid) {
            return sendError(res, 400, "Booking is not paid. Only paid bookings can be refunded.", "BOOKING_NOT_PAID");
        }

        await connection.beginTransaction();
        await connection.query(`SELECT booking_id FROM bookings WHERE booking_id = ? FOR UPDATE`, [bookingId]);

        const [duplicateRows] = await connection.query(
            `SELECT COUNT(*) AS count FROM refunds WHERE booking_id = ? AND refund_status IN ('Pending', 'Processing')`,
            [bookingId]
        );

        if (Number(duplicateRows[0]?.count || 0) > 0) {
            await connection.rollback();
            return sendError(res, 400, "An active refund already exists for this booking.", "DUPLICATE_REFUND");
        }

        const remainingRefundable = await getRemainingRefundableAmount(bookingId, connection);
        if (remainingRefundable <= 0) {
            await connection.rollback();
            return sendError(res, 409, "No refundable balance remains for this booking.", "NO_REFUNDABLE_BALANCE");
        }

        const refundReference = await generateRefundReference();
        const reason = refund_reason || "Waiting for admin review";
        const note = refund_note || "Waiting for admin to select refund type.";
        const refundMethod = req.body.refund_method || booking.resolved_payment_method || "Same as payment method";
        const customerId = booking.customer_id || null;

        const [insertResult] = await connection.query(
            `INSERT INTO refunds (
        booking_id,
        payment_id,
        customer_id,
        refund_reference,
        refund_type,
        refund_reason,
        refund_note,
        original_amount,
        refund_amount,
        refund_method,
        refund_status,
        requested_by,
        requested_at
      ) VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, 0, ?, 'Pending', ?, NOW())`,
            [
                bookingId,
                customerId,
                refundReference,
                reason,
                note,
                remainingRefundable,
                0,
                refundMethod,
                getAdminName(req)
            ]
        );

        await connection.query(
            `UPDATE bookings SET refund_status = 'Pending', refund_amount = 0 WHERE booking_id = ?`,
            [bookingId]
        );

        await logAudit({
            userId: req.user?.id || 0,
            action: AUDIT_ACTIONS.REFUND_REQUESTED,
            entityType: "refund",
            entityId: insertResult.insertId,
            newValue: {
                booking_id: bookingId,
                refund_reference: refundReference,
                original_amount: originalAmount,
            },
            req,
            connection,
        });

        await connection.commit();

        return res.json({
            success: true,
            message: "Refund request created successfully.",
            data: {
                refund_id: insertResult.insertId,
                refund_reference: refundReference,
                booking_reference: booking.booking_reference
            }
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("createRefund error", error);
        return sendError(res, 500, "Failed to create refund request.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    } finally {
        connection?.release();
    }
};

export const approveRefund = async (req, res) => {
    try {
        console.log('APPROVE REFUND PARAMS:', req.params);
        console.log('APPROVE REFUND BODY:', req.body);

        const refundId = Number(req.params.id);
        const { refund_type, refund_amount, refund_reason, refund_note } = req.body;

        if (!refundId) {
            return sendError(res, 400, "Refund ID is required.", "VALIDATION_ERROR");
        }

        const [refundRows] = await db.query(`SELECT * FROM refunds WHERE refund_id = ?`, [refundId]);
        if (!refundRows || refundRows.length === 0) {
            return sendError(res, 404, "Refund not found.", "REFUND_NOT_FOUND");
        }

        const refund = refundRows[0];
        if (!APPROVABLE_REFUND_STATUSES.includes(refund.refund_status)) {
            return sendError(
                res,
                400,
                `Only ${APPROVABLE_REFUND_STATUSES.join(' or ')} refunds can be approved. Current status: ${refund.refund_status}.`,
                "REFUND_NOT_APPROVABLE",
            );
        }

        const normalizedType = normalizeRefundType(refund_type);
        if (!normalizedType) {
            return sendError(res, 400, "Refund type is required.", "INVALID_REFUND_TYPE");
        }

        if (!ALLOWED_REFUND_TYPES.includes(normalizedType)) {
            return sendError(res, 400, "Invalid refund type.", "INVALID_REFUND_TYPE");
        }

        if (!refund_reason || !String(refund_reason).trim()) {
            return sendError(res, 400, "Refund reason is required.", "INVALID_REFUND_REASON");
        }

        const originalAmount = await getRefundableAmountForRefund(refund);
        const selectedAmount = toNumber(refund_amount);

        if (normalizedType === 'Full') {
            if (selectedAmount !== originalAmount || selectedAmount <= 0) {
                return sendError(res, 400, "Full refund amount must equal the original amount.", "INVALID_REFUND_AMOUNT");
            }
        }

        if (normalizedType === 'Partial') {
            if (selectedAmount <= 0 || selectedAmount >= originalAmount) {
                return sendError(res, 400, "Partial refund amount must be greater than 0 and less than the original amount.", "INVALID_REFUND_AMOUNT");
            }
        }

        if (normalizedType === 'No Refund') {
            if (selectedAmount !== 0) {
                return sendError(res, 400, "No Refund amount must be 0.", "INVALID_REFUND_AMOUNT");
            }
        }

        if (selectedAmount > originalAmount) {
            return sendError(res, 400, "Refund amount cannot exceed original amount.", "INVALID_REFUND_AMOUNT");
        }

        if (normalizedType !== 'No Refund' && selectedAmount > 0) {
            const paymentContext = await getXenditPaymentContextForBooking(refund.booking_id);
            if (!paymentContext.refundable) {
                return sendError(res, 400, paymentContext.message, "XENDIT_PAYMENT_NOT_FOUND");
            }
        }

        const processingRefund = {
            ...refund,
            refund_type: normalizedType,
            refund_amount: selectedAmount,
            refund_reason,
            refund_note: refund_note || '',
            refund_status: REFUND_STATUS.PROCESSING,
        };

        let gatewayResult = null;
        try {
            const [claimResult] = await db.query(
                `UPDATE refunds SET
        refund_type = ?,
        refund_amount = ?,
        refund_reason = ?,
        refund_note = ?,
        refund_status = ?,
        original_amount = ?,
        gateway_reference = NULL,
        gateway_status = NULL,
        approved_by = ?,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE refund_id = ? AND refund_status IN (?, ?)`,
                [
                    normalizedType,
                    selectedAmount,
                    refund_reason,
                    refund_note || '',
                    REFUND_STATUS.PROCESSING,
                    originalAmount,
                    getAdminName(req),
                    refundId,
                    REFUND_STATUS.PENDING,
                    REFUND_STATUS.FAILED,
                ],
            );
            if (claimResult.affectedRows !== 1) {
                return sendError(res, 409, "Refund status changed while it was being processed. Refresh and try again.", "REFUND_STATE_CONFLICT");
            }

            const bookingStatus = normalizedType === 'Partial'
                ? BOOKING_STATUS.PARTIALLY_REFUNDED
                : BOOKING_STATUS.CANCELLED;

            await db.query(
                `UPDATE bookings SET
        booking_status = ?,
        refund_status = ?,
        refund_amount = ?
      WHERE booking_id = ?`,
                [bookingStatus, REFUND_STATUS.PROCESSING, selectedAmount, refund.booking_id]
            );

            await logAudit({
                userId: req.user?.id || 0,
                action: AUDIT_ACTIONS.REFUND_APPROVED,
                entityType: "refund",
                entityId: refundId,
                oldValue: { refund_status: refund.refund_status },
                newValue: {
                    refund_status: REFUND_STATUS.PROCESSING,
                    refund_type: normalizedType,
                    refund_amount: selectedAmount,
                },
                req,
            });

            gatewayResult = await processApprovedRefundViaXendit({
                refund: processingRefund,
                req,
                userId: req.user?.id || 0,
            });
        } catch (gatewayError) {
            await db.query(
                `UPDATE refunds SET refund_status = ?, gateway_status = 'FAILED', updated_at = NOW() WHERE refund_id = ?`,
                [REFUND_STATUS.FAILED, refundId],
            );
            return sendError(
                res,
                502,
                `Refund processing failed: ${gatewayError.message}`,
                "XENDIT_REFUND_FAILED",
            );
        }

        const message = gatewayResult?.completed
            ? "Refund processed successfully via Xendit."
            : gatewayResult?.skipped
                ? "Refund request completed (no gateway refund required)."
                : "Refund is processing via Xendit and will complete via webhook.";

        try {
            const target = await getRefundNotificationTarget(refundId);
            if (target?.user_id) {
                await notifyRefundApproved({
                    userId: target.user_id,
                    customerId: target.customer_id,
                    bookingReference: target.booking_reference,
                });
            }
        } catch (notifyError) {
            console.warn('Refund approved notification failed:', notifyError.message);
        }

        return res.json({
            success: true,
            message,
            gateway: gatewayResult,
        });
    } catch (error) {
        console.error("approveRefund error", error);
        return sendError(res, 500, "Failed to approve refund.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    }
};

export const rejectRefund = async (req, res) => {
    try {
        const refundId = Number(req.params.id);
        const { rejection_reason } = req.body;

        if (!refundId) {
            return sendError(res, 400, "Refund ID is required.", "VALIDATION_ERROR");
        }

        if (!rejection_reason || !String(rejection_reason).trim()) {
            return sendError(res, 400, "Rejection reason is required.", "VALIDATION_ERROR");
        }

        const [refundRows] = await db.query(`SELECT * FROM refunds WHERE refund_id = ?`, [refundId]);
        if (!refundRows || refundRows.length === 0) {
            return sendError(res, 404, "Refund not found.", "REFUND_NOT_FOUND");
        }

        const refund = refundRows[0];
        if (!canRejectRefundStatus(refund.refund_status)) {
            return sendError(res, 409, `Only pending refunds can be rejected. Current status: ${refund.refund_status}.`, "REFUND_NOT_REJECTABLE");
        }

        const existingNote = refund.refund_note ? `${refund.refund_note} ` : "";
        const updatedNote = `${existingNote}Rejection reason: ${rejection_reason}`.trim();

        const [rejectResult] = await db.query(
            `UPDATE refunds SET
        refund_status = 'Rejected',
        rejected_by = ?,
        rejected_at = NOW(),
        refund_note = ?,
        updated_at = NOW()
      WHERE refund_id = ? AND refund_status = ?`,
            [getAdminName(req), updatedNote, refundId, REFUND_STATUS.PENDING]
        );
        if (rejectResult.affectedRows !== 1) {
            return sendError(res, 409, "Refund status changed while it was being rejected. Refresh and try again.", "REFUND_STATE_CONFLICT");
        }

        await db.query(
            `UPDATE bookings b SET
               refund_status = CASE WHEN EXISTS (
                 SELECT 1 FROM refunds completed_r
                 WHERE completed_r.booking_id = b.booking_id
                   AND LOWER(COALESCE(completed_r.refund_status, '')) IN ('completed','refunded','approved')
               ) THEN 'Completed' ELSE 'Rejected' END,
               refund_amount = COALESCE((
                 SELECT SUM(completed_r.refund_amount) FROM refunds completed_r
                 WHERE completed_r.booking_id = b.booking_id
                   AND LOWER(COALESCE(completed_r.refund_status, '')) IN ('completed','refunded','approved')
               ), 0)
             WHERE b.booking_id = ?`,
            [refund.booking_id]
        );

        await logAudit({
            userId: req.user?.id || 0,
            action: AUDIT_ACTIONS.REFUND_REJECTED,
            entityType: "refund",
            entityId: refundId,
            oldValue: { refund_status: refund.refund_status },
            newValue: { refund_status: 'Rejected', rejection_reason },
            req,
        });

        try {
            const target = await getRefundNotificationTarget(refundId);
            if (target?.user_id) {
                await notifyRefundRejected({
                    userId: target.user_id,
                    customerId: target.customer_id,
                    bookingReference: target.booking_reference,
                });
            }
        } catch (notifyError) {
            console.warn('Refund rejected notification failed:', notifyError.message);
        }

        return res.json({ success: true, message: "Refund rejected successfully." });
    } catch (error) {
        console.error("rejectRefund error", error);
        return sendError(res, 500, "Failed to reject refund.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    }
};

export const exportRefundsCSV = async (req, res) => {
    try {
        const { whereSql, params } = buildRefundFilters(req.query);

        const query = `
      SELECT
        r.refund_reference,
        b.booking_reference AS booking_code,
        CONCAT(COALESCE(u.first_name, c.first_name, ''), ' ', COALESCE(u.last_name, c.last_name, '')) AS customer_name,
        COALESCE(u.email, c.email) AS customer_email,
        COALESCE(MAX(p.payment_method), b.payment_method, '') AS payment_method,
        r.original_amount,
        r.refund_amount,
        r.refund_type,
        r.refund_reason,
        r.refund_status,
        r.requested_at,
        r.requested_by,
        r.approved_at,
        r.approved_by,
        r.refunded_at,
        r.gateway_reference,
        r.refund_note
      FROM refunds r
      LEFT JOIN bookings b ON b.booking_id = r.booking_id
      LEFT JOIN customers c ON c.customer_id = COALESCE(r.customer_id, b.customer_id)
      LEFT JOIN \`user\` u ON u.user_id = c.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      ${whereSql}
      GROUP BY r.refund_id
      ORDER BY r.requested_at DESC
      LIMIT 10000
    `;

        const [rows] = await db.query(query, params);

        const BOM = "\uFEFF";
        const headers = [
            "Refund Reference",
            "Booking Code",
            "Customer Name",
            "Customer Email",
            "Payment Method",
            "Original Amount (PHP)",
            "Refund Amount (PHP)",
            "Refund Type",
            "Refund Reason",
            "Refund Status",
            "Requested Date",
            "Requested By",
            "Approved Date",
            "Approved By",
            "Refunded Date",
            "Gateway Reference",
            "Admin Notes"
        ];

        const csvLines = [serializeCsvRow(headers)];
        for (const row of rows) {
            csvLines.push(serializeCsvRow([
                row.refund_reference,
                row.booking_code,
                row.customer_name,
                row.customer_email,
                row.payment_method,
                toNumber(row.original_amount).toFixed(2),
                toNumber(row.refund_amount).toFixed(2),
                row.refund_type,
                row.refund_reason,
                row.refund_status,
                row.requested_at,
                row.requested_by,
                row.approved_at,
                row.approved_by,
                row.refunded_at,
                row.gateway_reference,
                row.refund_note
            ]));
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=refunds-${Date.now()}.csv`);
        return res.send(BOM + csvLines.join("\r\n"));
    } catch (error) {
        console.error("exportRefundsCSV error", error);
        return sendError(res, 500, "Failed to export refunds CSV.", "INTERNAL_SERVER_ERROR", { detail: error.message });
    }
};
