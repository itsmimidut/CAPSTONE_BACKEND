/**
 * ============================================================
 * Admin Sales Report Analytics Controller
 * ============================================================
 *
 * Purpose:
 * - Provide a consolidated sales analytics report for admin dashboards
 * - Use existing bookings, booking_items, orders, pos_transactions, and pos_transaction_items tables
 * - Support period/date filtering, payment method filtering, and channel classification
 *
 * Endpoints:
 * - GET /api/admin/reports/sales-analytics
 * - GET /api/admin/reports/sales-analytics/export
 */

import db from '../config/db.js';
import { validateSalesReportQuery, inferChartPeriod } from '../utils/salesReportQueryValidation.js';
import { getSalesReportTransactions } from '../services/salesReportTransactionService.js';
import { buildTransactionCsv } from '../services/salesReportCsvService.js';

const formatDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
};

const formatCurrency = (value) => {
    return `₱${Number(value || 0).toFixed(2)}`;
};

const getDateRange = (period, date, from_date, to_date) => {
    const today = new Date();
    let startDate;
    let endDate;

    if (date) {
        startDate = formatDate(date);
        endDate = formatDate(date);
    } else if (from_date && to_date) {
        startDate = formatDate(from_date);
        endDate = formatDate(to_date);
    } else {
        endDate = formatDate(today);

        switch ((period || 'month').toLowerCase()) {
            case 'day':
                startDate = formatDate(today);
                break;
            case 'week': {
                const weekStart = new Date(today);
                weekStart.setDate(weekStart.getDate() - 6);
                startDate = formatDate(weekStart);
                break;
            }
            case 'year':
                startDate = formatDate(new Date(today.getFullYear(), 0, 1));
                break;
            case 'month':
            default:
                startDate = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
                break;
        }
    }

    if (!startDate || !endDate) {
        throw new Error('Invalid date range provided');
    }

    const resolvedPeriod = (period || '').toLowerCase()
        || (from_date && to_date ? inferChartPeriod(startDate, endDate) : 'month');

    return {
        start: startDate,
        end: endDate,
        period: resolvedPeriod
    };
};

const getPreviousDateRange = (start, end) => {
    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    const diff = endDate.getTime() - startDate.getTime();

    const prevEnd = new Date(startDate);
    prevEnd.setDate(prevEnd.getDate() - 1);

    const prevStart = new Date(prevEnd.getTime() - diff);

    return {
        start: formatDate(prevStart),
        end: formatDate(prevEnd),
    };
};

const calcPercentTrend = (current, previous) => {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (previousValue <= 0) return null;
    return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
};

const getChannelClauses = (channel, target) => {
    const normalized = (channel || '').toLowerCase();
    let where = [];

    if (target === 'bookings') {
        if (normalized === 'website') {
            where.push("(TRIM(email) != '' OR payment_method IN ('Credit Card','Debit Card','Bank Transfer','GCash','PayMaya'))");
        } else if (normalized === 'walk-in' || normalized === 'walkin') {
            where.push("(TRIM(email) = '' OR payment_method = 'Cash')");
        } else if (normalized === 'admin') {
            // No dedicated admin channel in bookings schema; use a restrictive filter so admin-only reporting returns no booking revenue.
            where.push('0');
        }
    }

    if (target === 'pos') {
        if (normalized === 'website') {
            where.push("type IN ('E-Shop','Delivery')");
        } else if (normalized === 'walk-in' || normalized === 'walkin') {
            where.push("type = 'Walk-in'");
        } else if (normalized === 'admin') {
            where.push("type IN ('Admin','Internal','Back-Office')");
        }
    }

    return where;
};

const normalizeReportChannel = (channel) => {
    const normalized = (channel || 'all').toLowerCase();
    if (normalized === 'reservations' || normalized === 'reservation') return 'reservation';
    if (normalized === 'pos' || normalized === 'restaurant' || normalized === 'restaurant_pos') return 'restaurant_pos';
    if (normalized === 'restaurant_online') return 'restaurant_online';
    if (normalized === 'e-shop' || normalized === 'eshop') return 'eshop';
    return normalized || 'all';
};

const buildBookingPaymentStatusClause = (payment_status, legacy = false) => {
    const normalized = (payment_status || (legacy ? 'paid' : 'revenue')).toLowerCase();
    if (normalized === 'all') return null;

    if (normalized === 'revenue' || (legacy && normalized === 'paid')) {
        return `(
            LOWER(COALESCE(b.payment_status, '')) IN ('paid', 'partially refunded', 'refunded')
            OR EXISTS (
                SELECT 1
                FROM payments p
                WHERE p.booking_id = b.booking_id
                  AND LOWER(COALESCE(p.status, '')) IN ('paid', 'settled', 'completed', 'success')
            )
        )`;
    }

    const statusMap = {
        paid: "LOWER(COALESCE(b.payment_status, '')) = 'paid'",
        partially_refunded: "LOWER(COALESCE(b.payment_status, '')) = 'partially refunded'",
        refunded: "LOWER(COALESCE(b.payment_status, '')) = 'refunded'",
        pending: "LOWER(COALESCE(b.payment_status, '')) IN ('pending', 'unpaid', 'partially paid')",
        failed: "LOWER(COALESCE(b.payment_status, '')) = 'failed'",
        expired: "LOWER(COALESCE(b.payment_status, '')) = 'expired'",
    };

    return statusMap[normalized] || null;
};

const buildPosPaymentStatusClause = (payment_status, legacy = false) => {
    const normalized = (payment_status || (legacy ? 'paid' : 'revenue')).toLowerCase();
    if (normalized === 'all') return null;

    if (normalized === 'revenue' || (legacy && normalized === 'paid')) {
        return "UPPER(COALESCE(pt.payment_status, 'PAID')) IN ('PAID')";
    }

    const statusMap = {
        paid: "UPPER(COALESCE(pt.payment_status, '')) = 'PAID'",
        partially_refunded: "UPPER(COALESCE(pt.payment_status, '')) IN ('PARTIALLY_REFUNDED', 'PARTIAL_REFUND')",
        refunded: "UPPER(COALESCE(pt.payment_status, '')) = 'REFUNDED'",
        pending: "UPPER(COALESCE(pt.payment_status, '')) = 'PENDING'",
        failed: "UPPER(COALESCE(pt.payment_status, '')) = 'FAILED'",
        expired: "UPPER(COALESCE(pt.payment_status, '')) = 'EXPIRED'",
        voided: "UPPER(COALESCE(pt.payment_status, '')) = 'VOIDED'",
    };

    return statusMap[normalized] || null;
};

const buildBookingTransactionStatusClause = (transaction_status) => {
    const normalized = (transaction_status || 'all').toLowerCase();
    if (normalized === 'all') return null;

    const statusExpr = "LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_'))";
    const statusMap = {
        pending: `${statusExpr} = 'pending'`,
        confirmed: `${statusExpr} = 'confirmed'`,
        in_progress: `${statusExpr} IN ('checked_in', 'in_progress')`,
        completed: `${statusExpr} IN ('checked_out', 'completed')`,
        cancelled: `${statusExpr} = 'cancelled'`,
        no_show: `${statusExpr} IN ('no_show', 'noshow')`,
        voided: `${statusExpr} = 'voided'`,
    };

    return statusMap[normalized] || null;
};

const buildPosTransactionStatusClause = (transaction_status) => {
    const normalized = (transaction_status || 'all').toLowerCase();
    if (normalized === 'all') return null;

    if (normalized === 'voided') {
        return "UPPER(COALESCE(pt.transaction_status, '')) = 'VOIDED' OR UPPER(COALESCE(pt.payment_status, '')) = 'VOIDED'";
    }

    if (normalized === 'cancelled') {
        return "UPPER(COALESCE(pt.transaction_status, '')) = 'VOIDED'";
    }

    if (normalized === 'pending') {
        return "UPPER(COALESCE(pt.transaction_status, 'ACTIVE')) = 'ACTIVE' AND UPPER(COALESCE(pt.payment_status, 'PENDING')) = 'PENDING'";
    }

    if (normalized === 'completed') {
        return "UPPER(COALESCE(pt.transaction_status, 'ACTIVE')) = 'ACTIVE' AND UPPER(COALESCE(pt.payment_status, 'PAID')) = 'PAID'";
    }

    if (normalized === 'in_progress') {
        return "UPPER(COALESCE(pt.transaction_status, 'ACTIVE')) = 'ACTIVE'";
    }

    return null;
};

const buildCanonicalPaymentMethodClause = (field, payment_method, params) => {
    const normalized = (payment_method || 'all').toLowerCase();
    if (!normalized || normalized === 'all') return null;

    if (normalized === 'cash') {
        params.push('Cash');
        return `${field} = ?`;
    }

    if (normalized === 'gcash') {
        params.push('GCash');
        return `${field} = ?`;
    }

    if (normalized === 'card') {
        return `${field} IN ('Credit Card', 'Debit Card', 'Card')`;
    }

    if (normalized === 'bank_transfer') {
        params.push('Bank Transfer');
        return `${field} = ?`;
    }

    if (normalized === 'other') {
        return `${field} NOT IN ('Cash', 'GCash', 'Maya', 'PayMaya', 'Credit Card', 'Debit Card', 'Card', 'Bank Transfer')`;
    }

    return buildPaymentClause(field, payment_method, params);
};

const buildBookingSearchClause = (search, params) => {
    if (!search) return null;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    return `(
        b.booking_reference LIKE ?
        OR COALESCE(c.first_name, '') LIKE ?
        OR COALESCE(c.last_name, '') LIKE ?
        OR COALESCE(c.email, '') LIKE ?
        OR COALESCE(u.email, '') LIKE ?
        OR EXISTS (
            SELECT 1
            FROM booking_items bi_search
            WHERE bi_search.booking_id = b.booking_id
              AND bi_search.item_name LIKE ?
        )
    )`;
};

const buildPosSearchClause = (search, params) => {
    if (!search) return null;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    return `(
        COALESCE(pt.receipt_no, '') LIKE ?
        OR CAST(pt.id AS CHAR) LIKE ?
        OR COALESCE(u.first_name, '') LIKE ?
        OR COALESCE(u.last_name, '') LIKE ?
        OR COALESCE(u.email, '') LIKE ?
        OR EXISTS (
            SELECT 1
            FROM pos_transaction_items pti_search
            WHERE pti_search.transaction_id = pt.id
              AND COALESCE(pti_search.item_name, '') LIKE ?
        )
    )`;
};

const buildFilter = ({ channel, payment_method, target }) => {
    const where = [];
    const params = [];

    where.push("1 = 1");

    if (target === 'bookings') {
        where.push("booking_status != 'Cancelled'");
        where.push(...getChannelClauses(channel, 'bookings'));
        if (payment_method) {
            where.push('payment_method = ?');
            params.push(payment_method);
        }
    }

    if (target === 'pos') {
        where.push('total_amount IS NOT NULL');
        where.push(...getChannelClauses(channel, 'pos'));
        if (payment_method) {
            where.push('payment_method = ?');
            params.push(payment_method);
        }
    }

    return {
        clause: where.filter(Boolean).join(' AND '),
        params
    };
};

const buildCsv = (data) => {
    const lines = [];
    const escape = (value) => {
        const normalized = String(value === null || value === undefined ? '' : value);
        if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
            return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
    };

    lines.push('Eduardo\'s Resort');
    lines.push('Sales Reports & Analytics');
    lines.push(`Date Range,${escape(`${data.filter.startDate} to ${data.filter.endDate}`)}`);
    lines.push(`Generated Date,${escape(new Date().toISOString().split('T')[0])}`);
    lines.push(`Applied Filters,${escape([data.filter.period || 'all', data.filter.channel || 'all', data.filter.payment_method || 'all'].join(' | '))}`);
    lines.push('');

    lines.push('Summary');
    lines.push('Metric,Value');
    lines.push(`Gross Sales,${escape(formatCurrency(data.summary.grossSales))}`);
    lines.push(`Refunded Amount,${escape(formatCurrency(data.summary.refundedAmount))}`);
    lines.push(`Net Sales,${escape(formatCurrency(data.summary.netSales))}`);
    lines.push(`Reservation Sales,${escape(formatCurrency(data.summary.reservationSales))}`);
    lines.push(`POS Sales,${escape(formatCurrency(data.summary.posSales))}`);
    lines.push(`Restaurant/Menu Sales,${escape(formatCurrency(data.summary.restaurantSales))}`);
    lines.push(`E-Shop Sales,${escape(formatCurrency(data.summary.eshopSales))}`);
    lines.push(`Total Transactions,${escape(data.summary.totalTransactions)}`);
    lines.push(`Refund Count,${escape(data.summary.refundCount)}`);
    lines.push('');

    lines.push('Sales Over Time');
    lines.push('Period,Sales');
    (data.salesOverTime || []).forEach((row) => lines.push(`${escape(row.period)},${escape(formatCurrency(row.sales))}`));
    lines.push('');

    lines.push('Category Breakdown');
    lines.push('Category,Revenue,Count,Percent');
    (data.categoryBreakdown || []).forEach((row) => {
        lines.push(`${escape(row.category)},${escape(formatCurrency(row.revenue))},${escape(row.count)},${escape(`${row.percent}%`)}`);
    });
    lines.push('');

    lines.push('Payment Method Summary');
    lines.push('Payment Method,Revenue,Count');
    (data.paymentSummary || []).forEach((row) => {
        lines.push(`${escape(row.payment_method || row.paymentMethod)},${escape(formatCurrency(row.amount || row.sales || 0))},${escape(row.count)}`);
    });
    lines.push('');

    lines.push('Top Booked Items');
    lines.push('Item,Category,Quantity,Revenue');
    (data.topBookedItems || []).forEach((row) => {
        lines.push(`${escape(row.item)},${escape(row.category)},${escape(row.quantity)},${escape(formatCurrency(row.revenue))}`);
    });
    lines.push('');

    lines.push('Top POS Items');
    lines.push('Item,Quantity,Revenue');
    (data.topPosItems || []).forEach((row) => {
        lines.push(`${escape(row.item)},${escape(row.quantity)},${escape(formatCurrency(row.revenue))}`);
    });
    lines.push('');

    lines.push('Top Selling Menu Items');
    lines.push('Item,Quantity,Revenue');
    (data.topMenuItems || []).forEach((row) => {
        lines.push(`${escape(row.item)},${escape(row.quantity)},${escape(formatCurrency(row.revenue))}`);
    });
    lines.push('');

    lines.push('Sales Channel Summary');
    lines.push('Channel,Revenue,Count,Percent');
    (data.channelSummary || []).forEach((row) => {
        lines.push(`${escape(row.channel || row.name)},${escape(formatCurrency(row.revenue || row.sales || 0))},${escape(row.count)},${escape(`${row.percent || row.percentage || 0}%`)}`);
    });

    return lines.join('\n');
};

const normalizePaymentQueryValues = (payment_method) => {
    if (!payment_method) return null;

    const normalized = payment_method.toString().trim().toLowerCase();
    if (normalized === 'maya' || normalized === 'paymaya') return ['Maya', 'PayMaya'];
    if (normalized === 'gcash') return ['GCash'];
    if (normalized === 'cash') return ['Cash'];
    if (normalized === 'bank transfer') return ['Bank Transfer'];
    return [payment_method];
};

const buildPaymentClause = (field, payment_method, params) => {
    const values = normalizePaymentQueryValues(payment_method);
    if (!values) return null;
    if (values.length === 1) {
        params.push(values[0]);
        return `${field} = ?`;
    }
    values.forEach((value) => params.push(value));
    return `${field} IN (${values.map(() => '?').join(', ')})`;
};

const buildDateClause = (alias) => {
    return `DATE(COALESCE(${alias}.transaction_date, ${alias}.created_at)) BETWEEN ? AND ?`;
};

const buildSalesAnalyticsFilters = ({
    channel,
    payment_method,
    payment_status = 'revenue',
    transaction_status = 'all',
    search = '',
    type,
    legacy = false,
}) => {
    const where = ['1 = 1'];
    const params = [];
    const normalizedChannel = normalizeReportChannel(channel);

    if (type === 'bookings') {
        if (normalizedChannel !== 'reservation' && normalizedChannel !== 'all') {
            where.push('0');
        }

        if (!legacy || transaction_status === 'all') {
            const bookingStatusClause = buildBookingTransactionStatusClause(transaction_status);
            if (bookingStatusClause) where.push(bookingStatusClause);
        } else {
            where.push("b.booking_status != 'Cancelled'");
        }

        const paymentStatusClause = buildBookingPaymentStatusClause(payment_status, legacy);
        if (paymentStatusClause) where.push(paymentStatusClause);

        const paymentClause = buildCanonicalPaymentMethodClause('b.payment_method', payment_method, params);
        if (paymentClause) where.push(paymentClause);

        const searchClause = buildBookingSearchClause(search, params);
        if (searchClause) where.push(searchClause);
    }

    if (type === 'pos') {
        where.push('COALESCE(pt.type, "") NOT IN ("E-Shop","Delivery")');
        where.push('pti.menu_id IS NULL');

        if (normalizedChannel !== 'restaurant_pos' && normalizedChannel !== 'all') {
            where.push('0');
        }

        const posStatusClause = buildPosTransactionStatusClause(transaction_status);
        if (posStatusClause) where.push(posStatusClause);

        const paymentStatusClause = buildPosPaymentStatusClause(payment_status, legacy);
        if (paymentStatusClause) where.push(paymentStatusClause);

        const paymentClause = buildCanonicalPaymentMethodClause('pt.payment_method', payment_method, params);
        if (paymentClause) where.push(paymentClause);

        const searchClause = buildPosSearchClause(search, params);
        if (searchClause) where.push(searchClause);
    }

    if (type === 'restaurant') {
        where.push('pti.menu_id IS NOT NULL');

        if (normalizedChannel !== 'restaurant_pos' && normalizedChannel !== 'all') {
            where.push('0');
        }

        const posStatusClause = buildPosTransactionStatusClause(transaction_status);
        if (posStatusClause) where.push(posStatusClause);

        const paymentStatusClause = buildPosPaymentStatusClause(payment_status, legacy);
        if (paymentStatusClause) where.push(paymentStatusClause);

        const paymentClause = buildCanonicalPaymentMethodClause('pt.payment_method', payment_method, params);
        if (paymentClause) where.push(paymentClause);

        const searchClause = buildPosSearchClause(search, params);
        if (searchClause) where.push(searchClause);
    }

    if (type === 'eshop') {
        where.push('pt.type IN ("E-Shop","Delivery")');

        if (normalizedChannel !== 'eshop' && normalizedChannel !== 'all') {
            where.push('0');
        }

        const posStatusClause = buildPosTransactionStatusClause(transaction_status);
        if (posStatusClause) where.push(posStatusClause);

        const paymentStatusClause = buildPosPaymentStatusClause(payment_status, legacy);
        if (paymentStatusClause) where.push(paymentStatusClause);

        const paymentClause = buildCanonicalPaymentMethodClause('pt.payment_method', payment_method, params);
        if (paymentClause) where.push(paymentClause);

        const searchClause = buildPosSearchClause(search, params);
        if (searchClause) where.push(searchClause);
    }

    return {
        clause: where.filter(Boolean).join(' AND '),
        params,
        requiresCustomerJoin: Boolean(search),
        requiresUserJoin: Boolean(search),
    };
};

const getPeriodExpression = (period, alias) => {
    switch (period) {
        case 'day':
            return `DATE_FORMAT(DATE(COALESCE(${alias}.transaction_date, ${alias}.created_at)), '%Y-%m-%d %H:00')`;
        case 'year':
            return `DATE_FORMAT(DATE(COALESCE(${alias}.transaction_date, ${alias}.created_at)), '%Y-%m')`;
        default:
            return `DATE_FORMAT(DATE(COALESCE(${alias}.transaction_date, ${alias}.created_at)), '%Y-%m-%d')`;
    }
};

const querySalesAnalytics = async ({
    period,
    date,
    from_date,
    to_date,
    channel,
    payment_method,
    transaction_status = 'all',
    payment_status = 'revenue',
    search = '',
    legacy = false,
}) => {
    const dateRange = getDateRange(period, date, from_date, to_date);
    const normalizedChannel = normalizeReportChannel(channel);
    const filterOptions = {
        channel: normalizedChannel,
        payment_method,
        payment_status,
        transaction_status,
        search,
        legacy,
    };

    const bookingFilter = buildSalesAnalyticsFilters({ ...filterOptions, type: 'bookings' });
    const posFilter = buildSalesAnalyticsFilters({ ...filterOptions, type: 'pos' });
    const restaurantFilter = buildSalesAnalyticsFilters({ ...filterOptions, type: 'restaurant' });
    const eshopFilter = buildSalesAnalyticsFilters({ ...filterOptions, type: 'eshop' });

    const bookingJoins = [
        bookingFilter.requiresCustomerJoin ? 'LEFT JOIN customers c ON c.customer_id = b.customer_id' : '',
        bookingFilter.requiresUserJoin ? 'LEFT JOIN users u ON u.user_id = b.user_id' : '',
    ].filter(Boolean).join('\n');

    const posJoins = posFilter.requiresUserJoin || restaurantFilter.requiresUserJoin || eshopFilter.requiresUserJoin
        ? 'LEFT JOIN users u ON u.user_id = pt.user_id'
        : '';

    const dateParams = [dateRange.start, dateRange.end];
    const transactionDateClause = buildDateClause('pt');
    const bookingDateClause = 'DATE(b.created_at) BETWEEN ? AND ?';

    const [bookingSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(b.total), 0) AS reservation_sales, COUNT(*) AS reservation_count
       FROM bookings b
       ${bookingJoins}
       WHERE ${bookingFilter.clause}
         AND ${bookingDateClause}`,
        [...bookingFilter.params, ...dateParams]
    );

    const [posSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS pos_sales,
              COUNT(DISTINCT pt.id) AS pos_transactions
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             ${posJoins}
             WHERE ${posFilter.clause}
                 AND ${transactionDateClause}`,
        [...posFilter.params, ...dateParams]
    );

    const [restaurantSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS restaurant_sales,
              COUNT(DISTINCT pt.id) AS restaurant_orders
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             JOIN menu_items mi ON mi.menu_id = pti.menu_id
             ${posJoins}
             WHERE ${restaurantFilter.clause}
                 AND ${transactionDateClause}`,
        [...restaurantFilter.params, ...dateParams]
    );

    const [eShopSummaryRows] = await db.query(
        `SELECT 
            COALESCE(SUM(pt.total_amount), 0) AS eshop_sales,
            COUNT(DISTINCT pt.id) AS eshop_orders
        FROM pos_transactions pt
        ${posJoins}
        WHERE ${eshopFilter.clause}
        AND ${transactionDateClause}`,
        [...eshopFilter.params, ...dateParams]
    );

    const reservationSales = Number(bookingSummaryRows[0]?.reservation_sales || 0);
    const reservationCount = Number(bookingSummaryRows[0]?.reservation_count || 0);
    const posSales = Number(posSummaryRows[0]?.pos_sales || 0);
    const totalPosTransactions = Number(posSummaryRows[0]?.pos_transactions || 0);
    const restaurantSales = Number(restaurantSummaryRows[0]?.restaurant_sales || 0);
    const restaurantOrders = Number(restaurantSummaryRows[0]?.restaurant_orders || 0);
    const eshopSales = Number(eShopSummaryRows[0]?.eshop_sales || 0);
    const eshopOrders = Number(eShopSummaryRows[0]?.eshop_orders || 0);
    const grossSales = reservationSales + posSales + restaurantSales + eshopSales;

    const previousRange = getPreviousDateRange(dateRange.start, dateRange.end);
    const previousDateParams = [previousRange.start, previousRange.end];

    const [prevRestaurantSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS restaurant_sales
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             JOIN menu_items mi ON mi.menu_id = pti.menu_id
             ${posJoins}
             WHERE ${restaurantFilter.clause}
                 AND ${transactionDateClause}`,
        [...restaurantFilter.params, ...previousDateParams]
    );

    const [prevPosSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS pos_sales
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             ${posJoins}
             WHERE ${posFilter.clause}
                 AND ${transactionDateClause}`,
        [...posFilter.params, ...previousDateParams]
    );

    const [prevEshopSummaryRows] = await db.query(
        `SELECT COALESCE(SUM(pt.total_amount), 0) AS eshop_sales
        FROM pos_transactions pt
        ${posJoins}
        WHERE ${eshopFilter.clause}
        AND ${transactionDateClause}`,
        [...eshopFilter.params, ...previousDateParams]
    );

    const prevRestaurantSales = Number(prevRestaurantSummaryRows[0]?.restaurant_sales || 0);
    const prevPosSales = Number(prevPosSummaryRows[0]?.pos_sales || 0);
    const prevEshopSales = Number(prevEshopSummaryRows[0]?.eshop_sales || 0);

    const [refundRows] = await db.query(
        `SELECT COUNT(*) AS refund_count,
                COALESCE(SUM(r.refund_amount), 0) AS refunded_amount
       FROM refunds r
       WHERE r.refund_status IN ('Approved', 'Refunded')
         AND DATE(COALESCE(r.refunded_at, r.approved_at, r.updated_at)) BETWEEN ? AND ?`,
        dateParams
    );

    const refundCount = Number(refundRows[0]?.refund_count || 0);
    const refundedAmount = Number(refundRows[0]?.refunded_amount || 0);
    const netSales = grossSales - refundedAmount;

    const periodExpr = getPeriodExpression(dateRange.period, 'pt');
    const bookingPeriodExpr = dateRange.period === 'day'
        ? `DATE_FORMAT(b.created_at, '%Y-%m-%d %H:00')`
        : dateRange.period === 'year'
            ? `DATE_FORMAT(b.created_at, '%Y-%m')`
            : `DATE_FORMAT(b.created_at, '%Y-%m-%d')`;

    const [bookingTrendRows] = await db.query(
        `SELECT ${bookingPeriodExpr} AS period,
                COALESCE(SUM(b.total), 0) AS sales
       FROM bookings b
       ${bookingJoins}
       WHERE ${bookingFilter.clause}
         AND ${bookingDateClause}
       GROUP BY period
       ORDER BY period`,
        [...bookingFilter.params, ...dateParams]
    );

    const [posTrendRows] = await db.query(
        `SELECT ${periodExpr} AS period,
                COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS sales
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             ${posJoins}
             WHERE ${posFilter.clause}
                 AND ${transactionDateClause}
       GROUP BY period
       ORDER BY period`,
        [...posFilter.params, ...dateParams]
    );

    const [restaurantTrendRows] = await db.query(
        `SELECT ${periodExpr} AS period,
                COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS sales
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             JOIN menu_items mi ON mi.menu_id = pti.menu_id
             ${posJoins}
             WHERE ${restaurantFilter.clause}
                 AND ${transactionDateClause}
       GROUP BY period
       ORDER BY period`,
        [...restaurantFilter.params, ...dateParams]
    );

    const [eShopTrendRows] = await db.query(
        `SELECT ${periodExpr} AS period,
                COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS sales
             FROM pos_transaction_items pti
             JOIN pos_transactions pt ON pti.transaction_id = pt.id
             ${posJoins}
             WHERE ${eshopFilter.clause}
                 AND ${transactionDateClause}
       GROUP BY period
       ORDER BY period`,
        [...eshopFilter.params, ...dateParams]
    );

    const trendMap = new Map();
    const addTrendRows = (rows) => rows.forEach((row) => {
        const key = row.period || 'Unknown';
        trendMap.set(key, (trendMap.get(key) || 0) + Number(row.sales || 0));
    });

    addTrendRows(bookingTrendRows);
    addTrendRows(posTrendRows);
    addTrendRows(restaurantTrendRows);
    addTrendRows(eShopTrendRows);

    const salesOverTime = [...trendMap.entries()]
        .map(([periodKey, sales]) => ({ period: periodKey, sales }))
        .sort((a, b) => new Date(a.period) - new Date(b.period));

    const [categoryRows] = await db.query(
        `SELECT bi.item_type AS category,
                COALESCE(SUM(bi.total_price), 0) AS revenue,
                COUNT(*) AS count
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.booking_id
       ${bookingJoins}
       WHERE ${bookingFilter.clause}
         AND ${bookingDateClause}
       GROUP BY bi.item_type`,
        [...bookingFilter.params, ...dateParams]
    );

    const categoryMap = new Map();
    categoryRows.forEach((row) => {
        const categoryKey = (row.category || 'Unknown').trim();
        categoryMap.set(categoryKey.toLowerCase(), {
            category: categoryKey,
            revenue: Number(row.revenue || 0),
            count: Number(row.count || 0)
        });
    });

    const categoryBreakdown = [
        {
            category: 'Rooms',
            revenue: Number(categoryMap.get('room')?.revenue || categoryMap.get('rooms')?.revenue || 0),
            count: Number(categoryMap.get('room')?.count || categoryMap.get('rooms')?.count || 0)
        },
        {
            category: 'Cottages',
            revenue: Number(categoryMap.get('cottage')?.revenue || categoryMap.get('cottages')?.revenue || 0),
            count: Number(categoryMap.get('cottage')?.count || categoryMap.get('cottages')?.count || 0)
        },
        {
            category: 'Events',
            revenue: Number(categoryMap.get('event')?.revenue || categoryMap.get('events')?.revenue || 0),
            count: Number(categoryMap.get('event')?.count || categoryMap.get('events')?.count || 0)
        },
        {
            category: 'Swimming',
            revenue: Number(categoryMap.get('swimming')?.revenue || 0),
            count: Number(categoryMap.get('swimming')?.count || 0)
        },
        {
            category: 'Restaurant POS',
            revenue: posSales + restaurantSales,
            count: totalPosTransactions + restaurantOrders
        },
        {
            category: 'E-Shop',
            revenue: eshopSales,
            count: eshopOrders
        }
    ];

    const totalCategoryRevenue = categoryBreakdown.reduce((sum, item) => sum + item.revenue, 0) || 1;
    categoryBreakdown.forEach((item) => {
        item.percent = Number(((item.revenue / totalCategoryRevenue) * 100).toFixed(1));
    });

    const [bookingPaymentRows] = await db.query(
        `SELECT b.payment_method AS payment_method,
                COALESCE(SUM(b.total), 0) AS amount,
                COUNT(*) AS count
       FROM bookings b
       ${bookingJoins}
       WHERE ${bookingFilter.clause}
         AND ${bookingDateClause}
       GROUP BY b.payment_method`,
        [...bookingFilter.params, ...dateParams]
    );

    // Payment summaries aggregate at transaction level, so the line-item alias
    // used by the POS detail queries is not available here. Use EXISTS instead
    // of joining items, which would multiply pt.total_amount for multi-item sales.
    const posPaymentFilterClause = posFilter.clause.replace(
        'pti.menu_id IS NULL',
        `EXISTS (
            SELECT 1
            FROM pos_transaction_items pti_payment
            WHERE pti_payment.transaction_id = pt.id
              AND pti_payment.menu_id IS NULL
        )`
    );

    const [posPaymentRows] = await db.query(
        `SELECT pt.payment_method AS payment_method,
                COALESCE(SUM(pt.total_amount), 0) AS amount,
                COUNT(*) AS count
             FROM pos_transactions pt
             ${posJoins}
             WHERE ${posPaymentFilterClause}
                 AND ${transactionDateClause}
             GROUP BY pt.payment_method`,
        [...posFilter.params, ...dateParams]
    );

    const [restaurantPaymentRows] = await db.query(
        `SELECT pt.payment_method AS payment_method,
                COALESCE(SUM(pt.total_amount), 0) AS amount,
                COUNT(*) AS count
             FROM pos_transactions pt
             JOIN pos_transaction_items pti ON pti.transaction_id = pt.id
             JOIN menu_items mi ON mi.menu_id = pti.menu_id
             ${posJoins}
             WHERE ${restaurantFilter.clause}
                 AND ${transactionDateClause}
             GROUP BY pt.payment_method`,
        [...restaurantFilter.params, ...dateParams]
    );

    const [eshopPaymentRows] = await db.query(
        `SELECT pt.payment_method AS payment_method,
                COALESCE(SUM(pt.total_amount), 0) AS amount,
                COUNT(*) AS count
             FROM pos_transactions pt
             ${posJoins}
             WHERE ${eshopFilter.clause}
                 AND ${transactionDateClause}
             GROUP BY pt.payment_method`,
        [...eshopFilter.params, ...dateParams]
    );

    const paymentMap = new Map();
    bookingPaymentRows.forEach((row) => {
        const method = row.payment_method || 'Unknown';
        paymentMap.set(method, {
            payment_method: method,
            amount: Number(row.amount || 0),
            count: Number(row.count || 0)
        });
    });
    posPaymentRows.forEach((row) => {
        const method = row.payment_method || 'Unknown';
        const existing = paymentMap.get(method) || { payment_method: method, amount: 0, count: 0 };
        existing.amount += Number(row.amount || 0);
        existing.count += Number(row.count || 0);
        paymentMap.set(method, existing);
    });
    restaurantPaymentRows.forEach((row) => {
        const method = row.payment_method || 'Unknown';
        const existing = paymentMap.get(method) || { payment_method: method, amount: 0, count: 0 };
        existing.amount += Number(row.amount || 0);
        existing.count += Number(row.count || 0);
        paymentMap.set(method, existing);
    });
    eshopPaymentRows.forEach((row) => {
        const method = row.payment_method || 'Unknown';
        const existing = paymentMap.get(method) || { payment_method: method, amount: 0, count: 0 };
        existing.amount += Number(row.amount || 0);
        existing.count += Number(row.count || 0);
        paymentMap.set(method, existing);
    });

    const paymentSummary = [...paymentMap.values()].sort((a, b) => b.amount - a.amount);

    const [topBookedRows] = await db.query(
        `SELECT bi.item_name AS item,
                COALESCE(bi.item_type, 'Unknown') AS category,
                COALESCE(SUM(bi.quantity), 0) AS quantity,
                COALESCE(SUM(bi.total_price), 0) AS revenue
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.booking_id
       ${bookingJoins}
       WHERE ${bookingFilter.clause}
         AND ${bookingDateClause}
       GROUP BY bi.item_name, bi.item_type
       ORDER BY revenue DESC
       LIMIT 10`,
        [...bookingFilter.params, ...dateParams]
    );

    const [topPosRows] = await db.query(
        `SELECT COALESCE(pti.item_name, 'Unknown') AS item,
                COALESCE(SUM(pti.quantity), 0) AS quantity,
                COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS revenue
       FROM pos_transaction_items pti
       JOIN pos_transactions pt ON pti.transaction_id = pt.id
       ${posJoins}
       WHERE ${posFilter.clause}
         AND ${transactionDateClause}
       GROUP BY pti.item_name
       ORDER BY revenue DESC
       LIMIT 10`,
        [...posFilter.params, ...dateParams]
    );

    const [topMenuRows] = await db.query(
        `SELECT COALESCE(mi.name, pti.item_name, 'Unknown') AS item,
                COALESCE(SUM(pti.quantity), 0) AS quantity,
                COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS revenue
       FROM pos_transaction_items pti
       JOIN pos_transactions pt ON pti.transaction_id = pt.id
    JOIN menu_items mi ON mi.menu_id = pti.menu_id
       ${posJoins}
       WHERE ${restaurantFilter.clause}
         AND ${transactionDateClause}
       GROUP BY mi.menu_id, mi.name
       ORDER BY revenue DESC
       LIMIT 10`,
        [...restaurantFilter.params, ...dateParams]
    );

    const restaurantPosSales = posSales + restaurantSales;
    const restaurantPosTransactions = totalPosTransactions + restaurantOrders;

    const channelSummary = [
        {
            channel: 'Reservations',
            revenue: reservationSales,
            count: reservationCount
        },
        {
            channel: 'Restaurant POS',
            revenue: restaurantPosSales,
            count: restaurantPosTransactions
        },
        {
            channel: 'E-Shop',
            revenue: eshopSales,
            count: eshopOrders
        }
    ];

    const totalChannelRevenue = channelSummary.reduce((sum, item) => sum + item.revenue, 0) || 1;
    channelSummary.forEach((item) => {
        item.percent = Number(((item.revenue / totalChannelRevenue) * 100).toFixed(1));
    });

    console.log('Sales analytics summary:', {
        grossSales,
        refundedAmount,
        netSales,
        reservationSales,
        posSales,
        restaurantSales,
        eshopSales,
        reservationCount,
        totalPosTransactions,
        restaurantOrders,
        eshopOrders,
        refundCount
    });

    console.log('TOP MENU ROWS:', topMenuRows);
    console.log('TOP POS ROWS:', topPosRows);

    return {
        filter: {
            period: dateRange.period,
            startDate: dateRange.start,
            endDate: dateRange.end,
            channel: normalizedChannel || null,
            payment_method: payment_method || null,
            payment_status: payment_status || null,
            transaction_status: transaction_status || null,
            search: search || null,
        },
        summary: {
            grossSales,
            refundedAmount,
            netSales,
            reservationSales,
            posSales,
            restaurantSales,
            eshopSales,
            restaurantSalesTrend: calcPercentTrend(restaurantSales, prevRestaurantSales),
            posSalesTrend: calcPercentTrend(posSales, prevPosSales),
            eshopSalesTrend: calcPercentTrend(eshopSales, prevEshopSales),
            totalTransactions: reservationCount + totalPosTransactions + eshopOrders,
            refundCount,
            reservationCount,
            totalPosTransactions,
            eshopOrders
        },
        salesOverTime,
        categoryBreakdown,
        paymentSummary,
        topBookedItems: topBookedRows,
        topPosItems: topPosRows,
        topMenuItems: topMenuRows,
        channelSummary
    };
};

const queryRefundSummary = async ({ from_date, to_date, status, search, startDate, endDate }) => {
    const where = [];
    const params = [];
    const start = from_date || startDate;
    const end = to_date || endDate;

    where.push("r.refund_status IN ('Approved', 'Refunded')");

    if (start) {
        where.push('DATE(COALESCE(r.refunded_at, r.approved_at, r.updated_at)) >= ?');
        params.push(start);
    }

    if (end) {
        where.push('DATE(COALESCE(r.refunded_at, r.approved_at, r.updated_at)) <= ?');
        params.push(end);
    }

    if (status && status !== 'all') {
        where.push('r.refund_status = ?');
        params.push(status);
    }

    if (search) {
        const searchTerm = `%${search}%`;
        where.push(`(
            r.refund_reference LIKE ?
            OR b.booking_reference LIKE ?
            OR COALESCE(c.first_name, '') LIKE ?
            OR COALESCE(c.last_name, '') LIKE ?
        )`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = where.length > 0 ? where.join(' AND ') : '1 = 1';

    const [rows] = await db.query(
        `SELECT
            COUNT(*) AS refund_count,
            COALESCE(SUM(r.refund_amount), 0) AS refunded_amount
        FROM refunds r
        LEFT JOIN bookings b ON b.booking_id = r.booking_id
        LEFT JOIN customers c ON c.customer_id = b.customer_id
        WHERE ${whereClause}`,
        params
    );

    return {
        refund_count: Number(rows[0]?.refund_count || 0),
        refunded_amount: Number(rows[0]?.refunded_amount || 0)
    };
};

const queryTopMenuItems = async ({ period, date, from_date, to_date, startDate, endDate, search }) => {
    const range = getDateRange(period || 'month', date, from_date || startDate, to_date || endDate);
    const where = ['pt.total_amount IS NOT NULL'];
    const params = [];

    if (range.start) {
        where.push('DATE(pt.transaction_date) >= ?');
        params.push(range.start);
    }
    if (range.end) {
        where.push('DATE(pt.transaction_date) <= ?');
        params.push(range.end);
    }
    where.push('pti.menu_id IS NOT NULL');
    if (search) {
        where.push('COALESCE(pti.item_name, "") LIKE ?');
        params.push(`%${search}%`);
    }

    const whereClause = where.length > 0 ? where.join(' AND ') : '1 = 1';

    const [rows] = await db.query(
        `SELECT
            COALESCE(pti.item_name, 'N/A') AS name,
            COALESCE(SUM(pti.quantity), 0) AS quantity,
            COALESCE(SUM(pti.quantity * COALESCE(pti.unit_price, 0)), 0) AS sales
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.transaction_id = pt.id
        WHERE ${whereClause}
        GROUP BY COALESCE(pti.item_name, 'N/A')
        ORDER BY sales DESC, quantity DESC
        LIMIT 10`,
        params
    );

    return rows.map((row) => ({
        name: row.name,
        quantity: Number(row.quantity || 0),
        sales: Number(row.sales || 0)
    }));
};

export const getRefundSummary = async (req, res) => {
    try {
        const { from_date, to_date, startDate, endDate, status, search } = req.query;
        const data = await queryRefundSummary({ from_date, to_date, startDate, endDate, status, search });
        res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Error fetching refund summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch refund summary',
            details: error.message
        });
    }
};

export const getTopMenuItems = async (req, res) => {
    try {
        const { period, date, from_date, to_date, startDate, endDate, search } = req.query;
        const data = await queryTopMenuItems({ period, date, from_date, to_date, startDate, endDate, search });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching top menu items:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch top menu items', error: error.message });
    }
};

export const getSalesAnalytics = async (req, res) => {
    try {
        const { period, date, from_date, to_date, channel, payment_method } = req.query;
        const result = await querySalesAnalytics({
            period,
            date,
            from_date,
            to_date,
            channel,
            payment_method,
            legacy: true,
            payment_status: 'paid',
        });
        res.json(result);
    } catch (error) {
        console.error('Error fetching sales analytics:', error);
        res.status(500).json({ error: 'Failed to fetch sales analytics', details: error.message });
    }
};

export const getSalesReports = async (req, res) => {
    try {
        const validation = validateSalesReportQuery(req.query);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message,
            });
        }

        const { filters } = validation;
        const result = await querySalesAnalytics({
            period: filters.period,
            from_date: filters.dateFrom,
            to_date: filters.dateTo,
            channel: filters.channel,
            payment_method: filters.paymentMethod,
            transaction_status: filters.transactionStatus,
            payment_status: filters.paymentStatus,
            search: filters.search,
            legacy: false,
        });

        const hasRecords = Number(result.summary?.totalTransactions || 0) > 0
            || Number(result.summary?.grossSales || 0) > 0;

        res.json({
            success: true,
            data: result,
            meta: {
                hasRecords,
                appliedFilters: filters,
            },
        });
    } catch (error) {
        console.error('Error fetching sales reports:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to load the sales report. Please check your connection and try again.',
            details: error.message,
        });
    }
};

export const exportSalesReportTransactionsCsv = async (req, res) => {
    try {
        const validation = validateSalesReportQuery(req.query);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        const rows = await getSalesReportTransactions(validation.filters);
        const { dateFrom, dateTo } = validation.filters;
        const filename = `sales-transactions_${dateFrom}_to_${dateTo}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(buildTransactionCsv(rows));
    } catch (error) {
        console.error('Error exporting sales report transactions:', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : 'Unable to export sales transactions. Please try again.',
            details: error.message,
        });
    }
};

export const exportSalesAnalyticsCSV = async (req, res) => {
    try {
        const {
            period,
            date,
            from_date,
            to_date,
            channel,
            payment_method,
            payment_status,
            transaction_status,
            search,
        } = req.query;
        const reportData = await querySalesAnalytics({
            period,
            date,
            from_date,
            to_date,
            channel,
            payment_method,
            payment_status,
            transaction_status,
            search,
        });
        const csv = buildCsv(reportData);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="sales-analytics-report.csv"');
        res.send(csv);
    } catch (error) {
        console.error('Error exporting sales analytics CSV:', error);
        res.status(500).json({ error: 'Failed to export sales analytics report', details: error.message });
    }
};
