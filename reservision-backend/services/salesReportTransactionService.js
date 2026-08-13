import db from '../config/db.js';
import { MAX_TRANSACTION_EXPORT_ROWS, SUCCESSFUL_REFUND_STATUSES } from '../utils/salesReportConstants.js';

export { MAX_TRANSACTION_EXPORT_ROWS };

const paymentMethodClause = (field, value, params) => {
  if (!value || value === 'all') return null;
  if (value === 'cash') { params.push('Cash'); return `${field} = ?`; }
  if (value === 'gcash') { params.push('GCash'); return `${field} = ?`; }
  if (value === 'card') return `${field} IN ('Credit Card', 'Debit Card', 'Card')`;
  if (value === 'bank_transfer') { params.push('Bank Transfer'); return `${field} = ?`; }
  if (value === 'other') return `${field} NOT IN ('Cash', 'GCash', 'Maya', 'PayMaya', 'Credit Card', 'Debit Card', 'Card', 'Bank Transfer')`;
  return null;
};

const bookingPaymentClause = (value) => {
  if (value === 'all') return null;
  if (value === 'revenue') return `(LOWER(COALESCE(b.payment_status, '')) IN ('paid', 'partially refunded', 'refunded') OR EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.booking_id AND LOWER(COALESCE(p.status, '')) IN ('paid','settled','completed','success')))`;
  const map = {
    paid: "LOWER(COALESCE(b.payment_status, '')) = 'paid'",
    partially_refunded: "LOWER(COALESCE(b.payment_status, '')) = 'partially refunded'",
    refunded: "LOWER(COALESCE(b.payment_status, '')) = 'refunded'",
    pending: "LOWER(COALESCE(b.payment_status, '')) IN ('pending', 'unpaid', 'partially paid')",
    failed: "LOWER(COALESCE(b.payment_status, '')) = 'failed'",
    expired: "LOWER(COALESCE(b.payment_status, '')) = 'expired'",
  };
  return map[value] || null;
};

const posPaymentClause = (value) => {
  if (value === 'all') return null;
  if (value === 'revenue') return "UPPER(COALESCE(pt.payment_status, '')) IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PARTIAL_REFUND')";
  const map = {
    paid: "UPPER(COALESCE(pt.payment_status, '')) = 'PAID'",
    partially_refunded: "UPPER(COALESCE(pt.payment_status, '')) IN ('PARTIALLY_REFUNDED', 'PARTIAL_REFUND')",
    refunded: "UPPER(COALESCE(pt.payment_status, '')) = 'REFUNDED'",
    pending: "UPPER(COALESCE(pt.payment_status, '')) IN ('PENDING', 'UNPAID')",
    failed: "UPPER(COALESCE(pt.payment_status, '')) = 'FAILED'",
    expired: "UPPER(COALESCE(pt.payment_status, '')) = 'EXPIRED'",
  };
  return map[value] || null;
};

const bookingStatusClause = (value) => {
  if (value === 'all') return null;
  const expr = "LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_'))";
  const map = {
    pending: `${expr} = 'pending'`, confirmed: `${expr} = 'confirmed'`,
    in_progress: `${expr} IN ('checked_in', 'in_progress')`,
    completed: `${expr} IN ('checked_out', 'completed')`,
    cancelled: `${expr} = 'cancelled'`, no_show: `${expr} IN ('no_show', 'noshow')`,
    voided: `${expr} = 'voided'`,
  };
  return map[value] || null;
};

const posStatusClause = (value) => {
  if (value === 'all') return null;
  if (value === 'voided' || value === 'cancelled') return "UPPER(COALESCE(pt.status, '')) = 'VOIDED'";
  if (value === 'pending') return "UPPER(COALESCE(pt.status, 'ACTIVE')) = 'ACTIVE' AND UPPER(COALESCE(pt.payment_status, 'PENDING')) IN ('PENDING', 'UNPAID')";
  if (value === 'completed') return "UPPER(COALESCE(pt.status, 'ACTIVE')) = 'ACTIVE' AND UPPER(COALESCE(pt.payment_status, '')) = 'PAID'";
  if (value === 'in_progress') return "UPPER(COALESCE(pt.status, 'ACTIVE')) = 'ACTIVE'";
  return '0';
};

const bookingQuery = async (filters) => {
  if (!['all', 'reservation'].includes(filters.channel)) return [];
  const where = ['DATE(b.created_at) BETWEEN ? AND ?'];
  const params = [filters.dateFrom, filters.dateTo];
  if (filters.bookingSource === 'direct') where.push("COALESCE(b.booking_source, 'DIRECT') = 'DIRECT'");
  if (filters.bookingSource === 'legacy_import') where.push("COALESCE(b.booking_source, 'DIRECT') = 'LEGACY_IMPORT'");
  const clauses = [bookingStatusClause(filters.transactionStatus), bookingPaymentClause(filters.paymentStatus)];
  const method = paymentMethodClause('b.payment_method', filters.paymentMethod, params);
  if (method) clauses.push(method);
  where.push(...clauses.filter(Boolean));
  if (filters.search) {
    const term = `%${filters.search}%`;
    where.push(`(b.booking_reference LIKE ? OR CONCAT_WS(' ', b.first_name, b.last_name) LIKE ? OR COALESCE(NULLIF(c.full_name, ''), NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), '') LIKE ? OR COALESCE(items.description, '') LIKE ?)`);
    params.push(term, term, term, term);
  }
  const [rows] = await db.query(`
    SELECT CONCAT('booking:', b.booking_id) source_key, b.created_at transaction_date,
      b.booking_reference reference_number, 'reservation' sales_channel,
      CASE WHEN COALESCE(b.booking_source, 'DIRECT') = 'LEGACY_IMPORT' THEN 'legacy_import' ELSE 'direct' END record_source,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), NULLIF(c.full_name, ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', b.first_name, b.last_name)), ''), NULLIF(b.email, ''), 'Guest') customer_name,
      COALESCE(items.description, 'Reservation') description, b.payment_method,
      b.booking_status transaction_status, b.payment_status, COALESCE(b.total, 0) transaction_amount,
      CASE WHEN LOWER(COALESCE(b.payment_status, '')) IN ('paid','partially refunded','refunded') OR EXISTS (SELECT 1 FROM payments p_gross WHERE p_gross.booking_id = b.booking_id AND LOWER(COALESCE(p_gross.status, '')) IN ('paid','settled','completed','success')) THEN COALESCE(b.total, 0) ELSE 0 END gross_revenue,
      COALESCE(refunds.refunded_amount, 0) refunded_amount
    FROM bookings b
    LEFT JOIN customers c ON c.customer_id = b.customer_id
    LEFT JOIN user u ON u.user_id = c.user_id
    LEFT JOIN (SELECT booking_id, GROUP_CONCAT(DISTINCT COALESCE(NULLIF(item_name,''), item_type) ORDER BY item_id SEPARATOR '; ') description FROM booking_items GROUP BY booking_id) items ON items.booking_id = b.booking_id
    LEFT JOIN (SELECT booking_id, SUM(refund_amount) refunded_amount FROM refunds WHERE UPPER(TRIM(refund_status)) IN (${SUCCESSFUL_REFUND_STATUSES.map(() => '?').join(',')}) GROUP BY booking_id) refunds ON refunds.booking_id = b.booking_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.created_at, b.booking_id
    LIMIT ${MAX_TRANSACTION_EXPORT_ROWS + 1}`, [...SUCCESSFUL_REFUND_STATUSES, ...params]);
  return rows;
};

const posQuery = async (filters) => {
  if (filters.channel === 'reservation') return [];
  if (filters.bookingSource && filters.bookingSource !== 'all') return [];
  const where = ['DATE(COALESCE(pt.transaction_date, pt.created_at)) BETWEEN ? AND ?'];
  const params = [filters.dateFrom, filters.dateTo];
  const channelExpr = `CASE
    WHEN LOWER(TRIM(COALESCE(pt.type, ''))) IN ('e-shop','eshop','delivery') THEN 'eshop'
    ELSE 'restaurant_pos'
  END`;
  // A POS line linked to a booking is a payment/receipt for a reservation that is
  // already represented by the booking ledger. Excluding it here prevents the
  // same reservation revenue from being counted a second time.
  where.push(`NOT EXISTS (
    SELECT 1 FROM pos_transaction_items reservation_item
    WHERE reservation_item.transaction_id = pt.id
      AND NULLIF(TRIM(reservation_item.booking_reference), '') IS NOT NULL
  )`);
  if (filters.channel !== 'all') { where.push(`${channelExpr} = ?`); params.push(filters.channel); }
  const status = posStatusClause(filters.transactionStatus);
  const payment = posPaymentClause(filters.paymentStatus);
  const method = paymentMethodClause('pt.payment_method', filters.paymentMethod, params);
  where.push(...[status, payment, method].filter(Boolean));
  if (filters.search) {
    const term = `%${filters.search}%`;
    where.push(`(
      CONVERT(COALESCE(pt.receipt_no, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
      OR CAST(pt.id AS CHAR) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
      OR CONVERT(COALESCE(NULLIF(c.full_name, ''), NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), pt.pickup_name, pt.recipient_name, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
      OR CONVERT(COALESCE(items.description, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
    )`);
    params.push(term, term, term, term);
  }
  const [rows] = await db.query(`
    SELECT CONCAT('pos:', pt.id) source_key, COALESCE(pt.transaction_date, pt.created_at) transaction_date,
      COALESCE(NULLIF(pt.receipt_no, ''), CONCAT('POS-', pt.id)) reference_number, ${channelExpr} sales_channel,
      'pos' record_source,
      COALESCE(NULLIF(c.full_name,''), NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), NULLIF(pt.pickup_name,''), NULLIF(pt.recipient_name,''), 'Walk-in Customer') customer_name,
      COALESCE(items.description, 'POS Transaction') description, pt.payment_method,
      COALESCE(pt.fulfillment_status, pt.status, 'ACTIVE') transaction_status, pt.payment_status,
      COALESCE(pt.total_amount, 0) transaction_amount,
      CASE WHEN UPPER(REPLACE(COALESCE(pt.payment_status, ''), ' ', '_')) IN ('PAID','REFUNDED','PARTIALLY_REFUNDED','PARTIAL_REFUND') THEN COALESCE(pt.total_amount, 0) ELSE 0 END gross_revenue,
      CASE WHEN UPPER(COALESCE(pt.payment_status, '')) = 'REFUNDED' THEN COALESCE(pt.total_amount, 0) ELSE 0 END refunded_amount
    FROM pos_transactions pt
    LEFT JOIN customers c ON c.customer_id = pt.customer_id
    LEFT JOIN user u ON u.user_id = c.user_id
    LEFT JOIN (SELECT transaction_id, GROUP_CONCAT(DISTINCT item_name ORDER BY line_id SEPARATOR '; ') description FROM pos_transaction_items GROUP BY transaction_id) items ON items.transaction_id = pt.id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(pt.transaction_date, pt.created_at), pt.id
    LIMIT ${MAX_TRANSACTION_EXPORT_ROWS + 1}`, params);
  return rows;
};

export const getSalesReportTransactions = async (filters) => {
  const [bookings, pos] = await Promise.all([bookingQuery(filters), posQuery(filters)]);
  const unique = new Map();
  for (const row of [...bookings, ...pos]) unique.set(row.source_key, row);
  const rows = [...unique.values()].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
  if (rows.length > MAX_TRANSACTION_EXPORT_ROWS) {
    const error = new Error(`Export exceeds the ${MAX_TRANSACTION_EXPORT_ROWS.toLocaleString()} row limit. Narrow the filters and try again.`);
    error.statusCode = 413;
    throw error;
  }
  return rows.map((row) => ({
    ...row,
    transaction_amount: Number(row.transaction_amount || 0),
    gross_revenue: Number(row.gross_revenue || 0),
    refunded_amount: Number(row.refunded_amount || 0),
    net_revenue: Number(row.gross_revenue || 0) - Number(row.refunded_amount || 0),
  }));
};
