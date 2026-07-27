import db from '../config/db.js';
import {
    cancelFulfillment,
    EshopFulfillmentError,
    getFulfillmentTimeline,
    updateFulfillmentStatus,
} from '../services/eshopFulfillmentService.js';
import { TAB_STATUS_MAP } from '../utils/fulfillmentStatuses.js';

const normalizeTab = (value) => {
    const tab = String(value || 'all').trim().toLowerCase();
    return tab === 'all' || TAB_STATUS_MAP[tab] ? tab : 'all';
};

const parsePositiveInt = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const parseItems = (value) => {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const sendError = (res, error, fallback) => {
    if (error instanceof EshopFulfillmentError) {
        return res.status(error.statusCode).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }
    console.error(fallback, error);
    return res.status(500).json({ success: false, error: fallback });
};

const baseOrderSelect = `
    SELECT pt.id,
           pt.receipt_no,
           pt.receipt_no AS order_number,
           pt.customer_id,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS customer_name,
           u.phone AS customer_phone,
           pt.type,
           pt.status,
           pt.payment_status,
           pt.payment_method,
           pt.total_amount AS total,
           pt.total_amount,
           pt.location_type,
           pt.location_number,
           pt.delivery_notes,
           pt.fulfillment_method,
           pt.fulfillment_status,
           pt.fulfillment_updated_at,
           pt.fulfillment_cancel_reason,
           pt.transaction_date,
           pt.transaction_time,
           pt.created_at,
           pt.items,
           COALESCE(JSON_LENGTH(pt.items), 0) AS item_count
    FROM pos_transactions pt
    LEFT JOIN customers c ON c.customer_id = pt.customer_id
    LEFT JOIN user u ON u.user_id = c.user_id
`;

const buildFilters = (query, { includeTab = true } = {}) => {
    const conditions = [
        "LOWER(TRIM(pt.type)) = 'e-shop'",
        'pt.fulfillment_status IS NOT NULL',
    ];
    const params = [];
    const tab = normalizeTab(query.tab);

    if (includeTab && tab !== 'all') {
        const statuses = TAB_STATUS_MAP[tab];
        conditions.push(`pt.fulfillment_status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }

    const search = String(query.search || '').trim();
    if (search) {
        conditions.push(`(
            pt.receipt_no LIKE ?
            OR CONCAT_WS(' ', u.first_name, u.last_name) LIKE ?
            OR u.phone LIKE ?
            OR CAST(pt.items AS CHAR) LIKE ?
        )`);
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern, pattern);
    }

    const paymentStatus = String(query.payment_status || '').trim().toUpperCase();
    if (paymentStatus && paymentStatus !== 'ALL') {
        conditions.push('UPPER(COALESCE(pt.payment_status, ?)) = ?');
        params.push('PENDING', paymentStatus);
    }

    const method = String(query.fulfillment_method || '').trim().toLowerCase();
    if (['delivery', 'pickup'].includes(method)) {
        conditions.push('pt.fulfillment_method = ?');
        params.push(method);
    }

    const location = String(query.location_type || '').trim().toLowerCase();
    if (location && location !== 'all') {
        if (location === 'pickup area') {
            conditions.push("LOWER(COALESCE(pt.location_type, '')) NOT IN ('room', 'cottage')");
        } else {
            conditions.push('LOWER(pt.location_type) = ?');
            params.push(location);
        }
    }

    return { conditions, params, tab };
};

const fetchCounts = async (query) => {
    const { conditions, params } = buildFilters(query, { includeTab: false });
    const [rows] = await db.query(
        `SELECT
            COUNT(*) AS all_count,
            SUM(pt.fulfillment_status = 'received') AS received,
            SUM(pt.fulfillment_status = 'preparing') AS preparing,
            SUM(pt.fulfillment_status IN ('out_for_delivery', 'ready_for_pickup')) AS dispatch_pickup,
            SUM(pt.fulfillment_status IN ('delivered', 'picked_up')) AS completed,
            SUM(pt.fulfillment_status = 'cancelled') AS cancelled
         FROM pos_transactions pt
         LEFT JOIN customers c ON c.customer_id = pt.customer_id
         LEFT JOIN user u ON u.user_id = c.user_id
         WHERE ${conditions.join(' AND ')}`,
        params,
    );
    const row = rows[0] || {};
    return {
        all: Number(row.all_count || 0),
        received: Number(row.received || 0),
        preparing: Number(row.preparing || 0),
        dispatch_pickup: Number(row.dispatch_pickup || 0),
        completed: Number(row.completed || 0),
        cancelled: Number(row.cancelled || 0),
    };
};

export const listEshopOrders = async (req, res) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = parsePositiveInt(req.query.limit, 20, 100);
        const offset = (page - 1) * limit;
        const { conditions, params } = buildFilters(req.query);
        const sort = String(req.query.sort || 'newest').toLowerCase();
        const orderBy = sort === 'oldest'
            ? 'pt.created_at ASC'
            : sort === 'recently_updated'
                ? 'COALESCE(pt.fulfillment_updated_at, pt.created_at) DESC'
                : 'pt.created_at DESC';
        const where = conditions.join(' AND ');

        const [[countRow], [orders], counts] = await Promise.all([
            db.query(
                `SELECT COUNT(*) AS total
                 FROM pos_transactions pt
                 LEFT JOIN customers c ON c.customer_id = pt.customer_id
                 LEFT JOIN user u ON u.user_id = c.user_id
                 WHERE ${where}`,
                params,
            ).then(([rows]) => rows),
            db.query(
                `${baseOrderSelect}
                 WHERE ${where}
                 ORDER BY ${orderBy}
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset],
            ),
            fetchCounts(req.query),
        ]);

        const total = Number(countRow?.total || 0);
        return res.json({
            success: true,
            data: {
                orders: orders.map((order) => ({ ...order, items: parseItems(order.items) })),
                counts,
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: Math.max(1, Math.ceil(total / limit)),
                },
            },
        });
    } catch (error) {
        return sendError(res, error, 'Failed to fetch E-Shop orders');
    }
};

const loadEshopOrder = async (transactionId) => {
    const [rows] = await db.query(
        `${baseOrderSelect}
         WHERE pt.id = ? AND LOWER(TRIM(pt.type)) = 'e-shop'
         LIMIT 1`,
        [transactionId],
    );
    return rows[0] || null;
};

export const getEshopOrder = async (req, res) => {
    try {
        const order = await loadEshopOrder(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, error: 'E-Shop order not found' });
        }
        const items = parseItems(order.items);
        const timeline = await getFulfillmentTimeline(order.id);
        const subtotal = items.reduce(
            (sum, item) => sum + Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || item.qty || 1)),
            0,
        );
        const total = Number(order.total_amount || 0);
        return res.json({
            success: true,
            data: {
                order: { ...order, items: undefined },
                items,
                timeline,
                summary: {
                    subtotal,
                    delivery_fee: Math.max(0, total - subtotal),
                    discount: 0,
                    total,
                },
            },
        });
    } catch (error) {
        return sendError(res, error, 'Failed to fetch E-Shop order');
    }
};

export const patchFulfillmentStatus = async (req, res) => {
    try {
        const result = await updateFulfillmentStatus({
            transactionId: req.params.id,
            nextStatus: req.body?.fulfillment_status,
            staffId: req.user?.id || req.user?.user_id || null,
        });
        return res.json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error, 'Failed to update fulfillment status');
    }
};

export const cancelEshopOrder = async (req, res) => {
    try {
        const result = await cancelFulfillment({
            transactionId: req.params.id,
            staffId: req.user?.id || req.user?.user_id || null,
            reason: req.body?.reason,
        });
        return res.json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error, 'Failed to cancel E-Shop order');
    }
};

export const getMyOrderTimeline = async (req, res) => {
    try {
        const userId = Number(req.user?.id || req.user?.user_id || 0);
        const [rows] = await db.query(
            `SELECT pt.id
             FROM pos_transactions pt
             JOIN customers c ON c.customer_id = pt.customer_id
             WHERE pt.id = ?
               AND c.user_id = ?
               AND LOWER(TRIM(pt.type)) = 'e-shop'
             LIMIT 1`,
            [req.params.id, userId],
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'E-Shop order not found' });
        }
        const timeline = await getFulfillmentTimeline(req.params.id);
        return res.json({ success: true, data: { timeline } });
    } catch (error) {
        return sendError(res, error, 'Failed to fetch fulfillment timeline');
    }
};
