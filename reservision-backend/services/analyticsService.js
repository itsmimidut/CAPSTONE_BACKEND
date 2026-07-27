import db from '../config/db.js';

const tableCache = new Map();
const columnCache = new Map();

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const toNumber = (value) => Number(value || 0);

const toDateString = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const PAID_BOOKING_EXPR = `
  (
    LOWER(COALESCE(b.payment_status, '')) IN ('paid', 'partially refunded', 'refunded')
    OR EXISTS (
      SELECT 1 FROM payments p
      WHERE p.booking_id = b.booking_id
        AND LOWER(COALESCE(p.status, '')) IN ('paid', 'settled', 'completed', 'success')
    )
  )
`;

const NON_CANCELLED_BOOKING_EXPR = `
  LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_')) NOT IN ('cancelled', 'voided')
`;

async function tableExists(tableName) {
  if (tableCache.has(tableName)) return tableCache.get(tableName);
  try {
    const [rows] = await db.query('SHOW TABLES LIKE ?', [tableName]);
    const exists = rows.length > 0;
    tableCache.set(tableName, exists);
    return exists;
  } catch {
    tableCache.set(tableName, false);
    return false;
  }
}

async function getColumns(tableName) {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  try {
    const [rows] = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const set = new Set(rows.map((row) => String(row.Field || '').toLowerCase()));
    columnCache.set(tableName, set);
    return set;
  } catch {
    const empty = new Set();
    columnCache.set(tableName, empty);
    return empty;
  }
}

export function parseAnalyticsFilters(query = {}) {
  const today = new Date();
  const dateTo = toDateString(query.date_to || query.dateTo || today);
  let dateFrom = toDateString(query.date_from || query.dateFrom);
  if (!dateFrom) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    dateFrom = toDateString(start);
  }
  return {
    dateFrom,
    dateTo,
    status: query.status ? String(query.status).trim() : null,
    categoryType: query.category_type || query.categoryType || null,
    module: query.module ? String(query.module).trim().toLowerCase() : null,
  };
}

export function getPreviousPeriod(dateFrom, dateTo) {
  const start = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  const diffMs = Math.max(0, end - start);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd.getTime() - diffMs);
  return {
    dateFrom: toDateString(prevStart),
    dateTo: toDateString(prevEnd),
  };
}

async function getBookingRevenueExpr() {
  const cols = await getColumns('bookings');
  if (cols.has('pricing_total')) return 'COALESCE(b.pricing_total, b.total, 0)';
  return 'COALESCE(b.total, 0)';
}

async function getBookingItemRevenueExpr() {
  const cols = await getColumns('booking_items');
  if (cols.has('final_subtotal')) return 'COALESCE(bi.final_subtotal, bi.total_price, 0)';
  return 'COALESCE(bi.total_price, 0)';
}

async function getPosDateExpr() {
  const cols = await getColumns('pos_transactions');
  if (cols.has('transaction_date')) return 'DATE(COALESCE(pt.transaction_date, pt.created_at))';
  return 'DATE(pt.created_at)';
}

async function getPosPaidFilter() {
  const cols = await getColumns('pos_transactions');
  if (!cols.has('payment_status')) return '';
  return "AND LOWER(COALESCE(pt.payment_status, 'paid')) NOT IN ('voided', 'cancelled', 'failed', 'pending')";
}

async function getRefundTotal(dateFrom, dateTo) {
  if (!(await tableExists('refunds'))) return 0;
  const cols = await getColumns('refunds');
  const dateCol = cols.has('refunded_at') ? 'refunded_at' : (cols.has('approved_at') ? 'approved_at' : 'created_at');
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(refund_amount), 0) AS total
     FROM refunds
     WHERE LOWER(COALESCE(refund_status, '')) IN ('approved', 'refunded', 'completed')
       AND DATE(${dateCol}) BETWEEN ? AND ?`,
    [dateFrom, dateTo]
  );
  return roundMoney(rows[0]?.total);
}

async function getBookingRevenue(dateFrom, dateTo, { swimmingOnly = false, excludeSwimming = false } = {}) {
  if (!(await tableExists('bookings'))) return 0;
  const revenueExpr = await getBookingRevenueExpr();
  const itemRevenueExpr = await getBookingItemRevenueExpr();
  const params = [dateFrom, dateTo];
  let swimmingClause = '';
  if (swimmingOnly) swimmingClause = "AND LOWER(COALESCE(bi.item_type, '')) = 'swimming'";
  if (excludeSwimming) swimmingClause = "AND LOWER(COALESCE(bi.item_type, '')) != 'swimming'";

  if (await tableExists('booking_items')) {
    const [rows] = await db.query(
      `SELECT COALESCE(SUM(${itemRevenueExpr}), 0) AS total
       FROM booking_items bi
       INNER JOIN bookings b ON b.booking_id = bi.booking_id
       WHERE DATE(b.created_at) BETWEEN ? AND ?
         AND ${NON_CANCELLED_BOOKING_EXPR}
         AND ${PAID_BOOKING_EXPR}
         ${swimmingClause}`,
      params
    );
    const lineTotal = roundMoney(rows[0]?.total);
    if (lineTotal > 0 || swimmingOnly || excludeSwimming) return lineTotal;
  }

  const [rows] = await db.query(
    `SELECT COALESCE(SUM(${revenueExpr}), 0) AS total
     FROM bookings b
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}
       AND ${PAID_BOOKING_EXPR}`,
    params
  );
  return roundMoney(rows[0]?.total);
}

async function getPosRevenue(dateFrom, dateTo, { shopOnly = false, posOnly = false } = {}) {
  if (!(await tableExists('pos_transactions'))) return 0;
  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const params = [dateFrom, dateTo];
  let typeClause = '';
  if (shopOnly) typeClause = "AND LOWER(COALESCE(pt.type, '')) IN ('e-shop', 'delivery')";
  if (posOnly) typeClause = "AND LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery')";

  if (await tableExists('pos_transaction_items')) {
    const [rows] = await db.query(
      `SELECT COALESCE(SUM(pti.line_total), 0) AS total
       FROM pos_transaction_items pti
       INNER JOIN pos_transactions pt ON pt.id = pti.transaction_id
       WHERE ${dateExpr} BETWEEN ? AND ?
         ${paidFilter}
         ${typeClause}`,
      params
    );
    const lineTotal = roundMoney(rows[0]?.total);
    if (lineTotal > 0) return lineTotal;
  }

  const [rows] = await db.query(
    `SELECT COALESCE(SUM(pt.total_amount), 0) AS total
     FROM pos_transactions pt
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       ${typeClause}`,
    params
  );
  return roundMoney(rows[0]?.total);
}

async function getSwimmingRevenue(dateFrom, dateTo) {
  const directRevenue = await getBookingRevenue(dateFrom, dateTo, { swimmingOnly: true });
  if (directRevenue > 0) return directRevenue;
  if (!(await tableExists('booking_items')) || !(await tableExists('bookings'))) return 0;

  const biCols = await getColumns('booking_items');
  const priceExpr = biCols.has('package_price')
    ? 'COALESCE(bi.package_price, bi.price, 0)'
    : biCols.has('price')
      ? 'COALESCE(bi.price, 0)'
      : '0';
  const qtyExpr = biCols.has('participants')
    ? 'COALESCE(NULLIF(bi.participants, 0), bi.total_guests, bi.guests, bi.quantity, 1)'
    : 'COALESCE(NULLIF(bi.total_guests, 0), bi.guests, bi.quantity, 1)';

  const [rows] = await db.query(
    `SELECT COALESCE(SUM((${priceExpr}) * (${qtyExpr})), 0) AS fallback_total
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND LOWER(COALESCE(bi.item_type, '')) = 'swimming'
       AND ${NON_CANCELLED_BOOKING_EXPR}`,
    [dateFrom, dateTo]
  );

  return roundMoney(rows[0]?.fallback_total);
}

async function getReservationRevenue(dateFrom, dateTo) {
  return getBookingRevenue(dateFrom, dateTo, { excludeSwimming: true });
}

async function getTotalBookings(dateFrom, dateTo) {
  if (!(await tableExists('bookings'))) return 0;
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM bookings b
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}`,
    [dateFrom, dateTo]
  );
  return toNumber(rows[0]?.total);
}

async function getTotalGuests(dateFrom, dateTo) {
  if (await tableExists('booking_items')) {
    const cols = await getColumns('booking_items');
    if (cols.has('total_guests')) {
      const [rows] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(bi.total_guests, bi.guests, 0)), 0) AS total
         FROM booking_items bi
         INNER JOIN bookings b ON b.booking_id = bi.booking_id
         WHERE DATE(b.created_at) BETWEEN ? AND ?
           AND ${NON_CANCELLED_BOOKING_EXPR}`,
        [dateFrom, dateTo]
      );
      const guestTotal = toNumber(rows[0]?.total);
      if (guestTotal > 0) return guestTotal;
    }
  }

  if (!(await tableExists('bookings'))) return 0;
  const bookingCols = await getColumns('bookings');
  const guestExpr = bookingCols.has('total_guests')
    ? 'COALESCE(b.total_guests, b.adults + b.children, 0)'
    : 'COALESCE(b.adults + b.children, 0)';
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(${guestExpr}), 0) AS total
     FROM bookings b
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}`,
    [dateFrom, dateTo]
  );
  return toNumber(rows[0]?.total);
}

async function getRevenueTrend(dateFrom, dateTo) {
  const trendMap = new Map();
  const ensureDay = (day) => {
    if (!trendMap.has(day)) {
      trendMap.set(day, { date: day, total: 0, booking: 0, pos: 0, shop: 0 });
    }
    return trendMap.get(day);
  };

  const start = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    ensureDay(toDateString(cursor));
  }

  if (await tableExists('booking_items')) {
    const itemRevenueExpr = await getBookingItemRevenueExpr();
    const [bookingRows] = await db.query(
      `SELECT DATE(b.created_at) AS day,
              COALESCE(SUM(${itemRevenueExpr}), 0) AS revenue
       FROM booking_items bi
       INNER JOIN bookings b ON b.booking_id = bi.booking_id
       WHERE DATE(b.created_at) BETWEEN ? AND ?
         AND ${NON_CANCELLED_BOOKING_EXPR}
         AND ${PAID_BOOKING_EXPR}
       GROUP BY day
       ORDER BY day`,
      [dateFrom, dateTo]
    );
    bookingRows.forEach((row) => {
      const day = toDateString(row.day);
      const point = ensureDay(day);
      const amount = roundMoney(row.revenue);
      point.booking = roundMoney(point.booking + amount);
      point.total = roundMoney(point.total + amount);
    });
  } else if (await tableExists('bookings')) {
    const revenueExpr = await getBookingRevenueExpr();
    const [bookingRows] = await db.query(
      `SELECT DATE(b.created_at) AS day,
              COALESCE(SUM(${revenueExpr}), 0) AS revenue
       FROM bookings b
       WHERE DATE(b.created_at) BETWEEN ? AND ?
         AND ${NON_CANCELLED_BOOKING_EXPR}
         AND ${PAID_BOOKING_EXPR}
       GROUP BY day
       ORDER BY day`,
      [dateFrom, dateTo]
    );
    bookingRows.forEach((row) => {
      const day = toDateString(row.day);
      const point = ensureDay(day);
      const amount = roundMoney(row.revenue);
      point.booking = roundMoney(point.booking + amount);
      point.total = roundMoney(point.total + amount);
    });
  }

  if (await tableExists('pos_transactions')) {
    const dateExpr = await getPosDateExpr();
    const paidFilter = await getPosPaidFilter();
    const [posRows] = await db.query(
      `SELECT ${dateExpr} AS day,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery') THEN pt.total_amount
                ELSE 0
              END), 0) AS pos_revenue,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(pt.type, '')) IN ('e-shop', 'delivery') THEN pt.total_amount
                ELSE 0
              END), 0) AS shop_revenue
       FROM pos_transactions pt
       WHERE ${dateExpr} BETWEEN ? AND ?
         ${paidFilter}
       GROUP BY day
       ORDER BY day`,
      [dateFrom, dateTo]
    );
    posRows.forEach((row) => {
      const day = toDateString(row.day);
      const point = ensureDay(day);
      point.pos = roundMoney(row.pos_revenue);
      point.shop = roundMoney(row.shop_revenue);
      point.total = roundMoney(point.total + point.pos + point.shop);
    });
  }

  return Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function getBookingsByCategory(dateFrom, dateTo) {
  if (!(await tableExists('booking_items'))) return [];
  const [rows] = await db.query(
    `SELECT
       CASE
         WHEN LOWER(COALESCE(bi.item_type, '')) IN ('room', 'rooms') THEN 'Rooms'
         WHEN LOWER(COALESCE(bi.item_type, '')) IN ('cottage', 'cottages') THEN 'Cottages'
         WHEN LOWER(COALESCE(bi.item_type, '')) IN ('event', 'events') THEN 'Event Areas'
         WHEN LOWER(COALESCE(bi.item_type, '')) IN ('swimming', 'swim') THEN 'Swimming'
         ELSE COALESCE(bi.item_type, 'Other')
       END AS category,
       COUNT(DISTINCT bi.booking_id) AS count
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}
     GROUP BY category
     ORDER BY count DESC`,
    [dateFrom, dateTo]
  );
  return rows.map((row) => ({
    category: row.category,
    count: toNumber(row.count),
    percentage: 0,
  })).map((row, _, arr) => {
    const total = arr.reduce((sum, item) => sum + item.count, 0);
    return {
      ...row,
      percentage: total > 0 ? roundMoney((row.count / total) * 100) : 0,
    };
  });
}

async function getGuestDemographics(dateFrom, dateTo) {
  if (!(await tableExists('booking_items'))) {
    return { available: false, total_guests: 0, breakdown: [] };
  }
  const cols = await getColumns('booking_items');
  if (!cols.has('guest_breakdown_provided')) {
    return { available: false, total_guests: await getTotalGuests(dateFrom, dateTo), breakdown: [] };
  }

  const [rows] = await db.query(
    `SELECT
       COALESCE(SUM(COALESCE(bi.total_guests, bi.guests, 0)), 0) AS total_guests,
       COALESCE(SUM(CASE WHEN bi.guest_breakdown_provided = 1 THEN bi.adults ELSE 0 END), 0) AS adults,
       COALESCE(SUM(CASE WHEN bi.guest_breakdown_provided = 1 THEN bi.children ELSE 0 END), 0) AS children,
       COALESCE(SUM(CASE WHEN bi.guest_breakdown_provided = 1 THEN bi.seniors ELSE 0 END), 0) AS seniors,
       COALESCE(SUM(CASE WHEN bi.guest_breakdown_provided = 1 THEN bi.infants ELSE 0 END), 0) AS infants
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}`,
    [dateFrom, dateTo]
  );

  const row = rows[0] || {};
  const breakdown = [
    { label: 'Adults (18-64)', value: toNumber(row.adults) },
    { label: 'Children (6-17)', value: toNumber(row.children) },
    { label: 'Seniors (65+)', value: toNumber(row.seniors) },
    { label: 'Infants (0-5)', value: toNumber(row.infants) },
  ].filter((item) => item.value > 0);

  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.value, 0);
  const breakdownWithPct = breakdown.map((item) => ({
    ...item,
    percentage: breakdownTotal > 0 ? roundMoney((item.value / breakdownTotal) * 100) : 0,
  }));

  return {
    available: breakdownWithPct.length > 0,
    total_guests: toNumber(row.total_guests),
    breakdown: breakdownWithPct,
  };
}

async function getTopPosItems(dateFrom, dateTo, limit = 5) {
  if (!(await tableExists('pos_transaction_items'))) return [];
  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [rows] = await db.query(
    `SELECT
       pti.item_name,
       COALESCE(mi.category, 'General') AS category,
       COALESCE(SUM(pti.quantity), 0) AS quantity_sold,
       COALESCE(SUM(pti.line_total), 0) AS revenue
     FROM pos_transaction_items pti
     INNER JOIN pos_transactions pt ON pt.id = pti.transaction_id
     LEFT JOIN menu_items mi ON LOWER(CONVERT(mi.name USING utf8mb4) COLLATE utf8mb4_unicode_ci)
       = LOWER(CONVERT(pti.item_name USING utf8mb4) COLLATE utf8mb4_unicode_ci)
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery')
     GROUP BY pti.item_name, category
     ORDER BY revenue DESC
     LIMIT ?`,
    [dateFrom, dateTo, limit]
  );
  return rows.map((row) => ({
    item_name: row.item_name,
    category: row.category,
    quantity_sold: toNumber(row.quantity_sold),
    revenue: roundMoney(row.revenue),
  }));
}

async function getTopShopItems(dateFrom, dateTo, limit = 5) {
  if (!(await tableExists('pos_transaction_items'))) return [];
  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [rows] = await db.query(
    `SELECT
       pti.item_name,
       'Shop' AS category,
       COALESCE(SUM(pti.quantity), 0) AS quantity_sold,
       COALESCE(SUM(pti.line_total), 0) AS revenue
     FROM pos_transaction_items pti
     INNER JOIN pos_transactions pt ON pt.id = pti.transaction_id
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) IN ('e-shop', 'delivery')
     GROUP BY pti.item_name
     ORDER BY revenue DESC
     LIMIT ?`,
    [dateFrom, dateTo, limit]
  );
  return rows.map((row) => ({
    item_name: row.item_name,
    category: row.category,
    quantity_sold: toNumber(row.quantity_sold),
    revenue: roundMoney(row.revenue),
  }));
}

async function getPromoSummary(dateFrom, dateTo) {
  if (!(await tableExists('bookings'))) {
    return { available: false, redemptions: 0, discount_total: 0, top_promos: [] };
  }
  const bookingCols = await getColumns('bookings');
  const hasPromoCode = bookingCols.has('promo_code');

  if (await tableExists('booking_items')) {
    const biCols = await getColumns('booking_items');
    if (biCols.has('promo_discount')) {
      const [rows] = await db.query(
        `SELECT
           COALESCE(NULLIF(TRIM(b.promo_code), ''), 'Legacy Discount') AS promo_code,
           COUNT(DISTINCT CASE WHEN COALESCE(bi.promo_discount, 0) > 0 THEN b.booking_id END) AS redemption_count,
           COALESCE(SUM(CASE WHEN COALESCE(bi.promo_discount, 0) > 0 THEN bi.promo_discount ELSE 0 END), 0) AS discount_total
         FROM booking_items bi
         INNER JOIN bookings b ON b.booking_id = bi.booking_id
         WHERE DATE(b.created_at) BETWEEN ? AND ?
           AND ${NON_CANCELLED_BOOKING_EXPR}
         GROUP BY promo_code
         HAVING discount_total > 0
         ORDER BY discount_total DESC, redemption_count DESC
         LIMIT 8`,
        [dateFrom, dateTo]
      );

      const topPromos = rows.map((row) => ({
        promo_code: row.promo_code,
        redemption_count: toNumber(row.redemption_count),
        discount_total: roundMoney(row.discount_total),
      }));
      const redemptions = topPromos.reduce((sum, row) => sum + row.redemption_count, 0);
      const discountTotal = topPromos.reduce((sum, row) => sum + toNumber(row.discount_total), 0);

      return {
        available: true,
        redemptions,
        discount_total: roundMoney(discountTotal),
        top_promos: topPromos,
      };
    }
  }

  if (hasPromoCode) {
    const [rows] = await db.query(
      `SELECT
         COALESCE(NULLIF(TRIM(b.promo_code), ''), 'Unknown Promo') AS promo_code,
         COUNT(*) AS redemption_count,
         COALESCE(SUM(COALESCE(b.discount, 0)), 0) AS discount_total
       FROM bookings b
       WHERE DATE(b.created_at) BETWEEN ? AND ?
         AND ${NON_CANCELLED_BOOKING_EXPR}
         AND (TRIM(COALESCE(b.promo_code, '')) != '' OR COALESCE(b.discount, 0) > 0)
       GROUP BY promo_code
       ORDER BY discount_total DESC, redemption_count DESC
       LIMIT 8`,
      [dateFrom, dateTo]
    );
    const topPromos = rows.map((row) => ({
      promo_code: row.promo_code,
      redemption_count: toNumber(row.redemption_count),
      discount_total: roundMoney(row.discount_total),
    }));
    return {
      available: true,
      redemptions: topPromos.reduce((sum, row) => sum + row.redemption_count, 0),
      discount_total: roundMoney(topPromos.reduce((sum, row) => sum + toNumber(row.discount_total), 0)),
      top_promos: topPromos,
    };
  }

  return { available: false, redemptions: 0, discount_total: 0, top_promos: [] };
}

async function getOccupancySnapshot(dateFrom, dateTo) {
  if (!(await tableExists('inventory_items'))) {
    return { available: false, categories: [] };
  }

  const categories = [];
  for (const [categoryType, label] of [
    ['room', 'Rooms'],
    ['cottage', 'Cottages'],
    ['event', 'Event Areas'],
  ]) {
    const [inventoryRows] = await db.query(
      `SELECT COUNT(*) AS total_units
       FROM inventory_items
       WHERE LOWER(COALESCE(category_type, category, '')) = ?
         AND LOWER(COALESCE(status, '')) NOT IN ('inactive', 'deleted')`,
      [categoryType]
    );
    const totalUnits = toNumber(inventoryRows[0]?.total_units);
    if (!totalUnits) continue;

    let occupied = 0;
    if (await tableExists('booking_items')) {
      const biCols = await getColumns('booking_items');
      const eventDateClause = biCols.has('booking_date')
        ? `OR (DATE(bi.booking_date) BETWEEN ? AND ?)`
        : '';
      const occupiedParams = biCols.has('booking_date')
        ? [dateTo, dateFrom, dateFrom, dateTo, categoryType]
        : [dateTo, dateFrom, categoryType];

      const [bookedRows] = await db.query(
        `SELECT COUNT(DISTINCT bi.inventory_item_id) AS occupied_units
         FROM booking_items bi
         INNER JOIN bookings b ON b.booking_id = bi.booking_id
         WHERE ${NON_CANCELLED_BOOKING_EXPR}
           AND LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_')) IN ('confirmed', 'checked_in', 'checked-in')
           AND (
             (DATE(b.check_in_date) <= ? AND DATE(b.check_out_date) > ?)
             ${eventDateClause}
           )
           AND bi.inventory_item_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM inventory_items ii
             WHERE ii.item_id = bi.inventory_item_id
               AND LOWER(COALESCE(ii.category_type, ii.category, '')) = ?
           )`,
        occupiedParams
      );
      occupied = toNumber(bookedRows[0]?.occupied_units);
    }

    let blocked = 0;
    if (await tableExists('availability_blocks')) {
      const [blockRows] = await db.query(
        `SELECT COUNT(DISTINCT inventory_item_id) AS blocked_units
         FROM availability_blocks
         WHERE LOWER(COALESCE(category_type, '')) = ?
           AND LOWER(COALESCE(status, 'active')) = 'active'
           AND start_date <= ? AND end_date >= ?`,
        [categoryType, dateTo, dateFrom]
      );
      blocked = toNumber(blockRows[0]?.blocked_units);
    }

    categories.push({
      category: label,
      total_units: totalUnits,
      occupied_units: occupied,
      blocked_units: blocked,
      occupancy_rate: totalUnits > 0 ? roundMoney((occupied / totalUnits) * 100) : 0,
    });
  }

  return { available: categories.length > 0, categories };
}

function buildKeyInsights(current, previous, extras = {}) {
  const insights = [];
  const pctChange = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return roundMoney(((curr - prev) / prev) * 100);
  };

  const revenueDelta = pctChange(current.total_revenue, previous.total_revenue);
  if (revenueDelta > 0) {
    insights.push({
      module: 'Revenue',
      message: `Revenue is up ${revenueDelta}% vs the previous period.`,
      type: 'positive',
    });
  } else if (revenueDelta < 0) {
    insights.push({
      module: 'Revenue',
      message: `Revenue is down ${Math.abs(revenueDelta)}% vs the previous period.`,
      type: 'warning',
    });
  }

  if (extras.weekendEventShare >= 50) {
    insights.push({
      module: 'Event Areas',
      message: `Event areas are most booked on weekends (${extras.weekendEventShare}% of event bookings).`,
      type: 'info',
    });
  }

  if (extras.swimmingSummerLift >= 10) {
    insights.push({
      module: 'Swimming',
      message: `Swimming demand is higher in the selected period (${extras.swimmingSummerLift}% lift vs previous period).`,
      type: 'info',
    });
  }

  if (extras.posPeakHour) {
    insights.push({
      module: 'POS',
      message: `POS sales peak around ${extras.posPeakHour}:00.`,
      type: 'info',
    });
  }

  if (current.most_active_module) {
    insights.push({
      module: current.most_active_module,
      message: `${current.most_active_module} is the most active revenue module in this period.`,
      type: 'info',
    });
  }

  return insights.slice(0, 4);
}

async function getWeekendEventShare(dateFrom, dateTo) {
  if (!(await tableExists('booking_items'))) return 0;
  const biCols = await getColumns('booking_items');
  const eventDateExpr = biCols.has('booking_date')
    ? 'COALESCE(bi.booking_date, b.check_in_date)'
    : 'b.check_in_date';
  const [rows] = await db.query(
    `SELECT
       COUNT(DISTINCT bi.booking_id) AS total_events,
       COUNT(DISTINCT CASE WHEN DAYOFWEEK(${eventDateExpr}) IN (1, 7) THEN bi.booking_id END) AS weekend_events
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND LOWER(COALESCE(bi.item_type, '')) IN ('event', 'events')
       AND ${NON_CANCELLED_BOOKING_EXPR}`,
    [dateFrom, dateTo]
  );
  const total = toNumber(rows[0]?.total_events);
  const weekend = toNumber(rows[0]?.weekend_events);
  return total > 0 ? roundMoney((weekend / total) * 100) : 0;
}

async function getPosPeakHour(dateFrom, dateTo) {
  if (!(await tableExists('pos_transactions'))) return null;
  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [rows] = await db.query(
    `SELECT HOUR(COALESCE(pt.transaction_time, pt.created_at)) AS hr,
            COALESCE(SUM(pt.total_amount), 0) AS revenue
     FROM pos_transactions pt
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery')
     GROUP BY hr
     ORDER BY revenue DESC
     LIMIT 1`,
    [dateFrom, dateTo]
  );
  return rows[0]?.hr != null ? String(rows[0].hr).padStart(2, '0') : null;
}

async function buildKpis(dateFrom, dateTo) {
  const bookingRevenue = await getReservationRevenue(dateFrom, dateTo);
  const swimmingRevenue = await getSwimmingRevenue(dateFrom, dateTo);
  const posRevenue = await getPosRevenue(dateFrom, dateTo, { posOnly: true });
  const shopRevenue = await getPosRevenue(dateFrom, dateTo, { shopOnly: true });
  const totalRefunds = await getRefundTotal(dateFrom, dateTo);
  const grossRevenue = roundMoney(bookingRevenue + swimmingRevenue + posRevenue + shopRevenue);
  const netRevenue = roundMoney(grossRevenue - totalRefunds);

  const modules = [
    { key: 'POS', value: posRevenue },
    { key: 'Bookings', value: bookingRevenue },
    { key: 'Shop', value: shopRevenue },
    { key: 'Swimming', value: swimmingRevenue },
  ].sort((a, b) => b.value - a.value);

  return {
    total_revenue: grossRevenue,
    booking_revenue: roundMoney(bookingRevenue + swimmingRevenue),
    pos_revenue: posRevenue,
    shop_revenue: shopRevenue,
    swimming_revenue: swimmingRevenue,
    total_bookings: await getTotalBookings(dateFrom, dateTo),
    total_guests: await getTotalGuests(dateFrom, dateTo),
    total_refunds: totalRefunds,
    net_revenue: netRevenue,
    most_active_module: modules[0]?.key || null,
  };
}

export async function getAnalyticsOverview(filters = {}) {
  const { dateFrom, dateTo } = filters;
  const previous = getPreviousPeriod(dateFrom, dateTo);
  const currentKpis = await buildKpis(dateFrom, dateTo);
  const previousKpis = await buildKpis(previous.dateFrom, previous.dateTo);

  const trend = (current, previousValue) => {
    if (!previousValue) return current > 0 ? 100 : 0;
    return roundMoney(((current - previousValue) / previousValue) * 100);
  };

  const kpis = {
    ...currentKpis,
    comparisons: {
      total_revenue: trend(currentKpis.total_revenue, previousKpis.total_revenue),
      total_bookings: trend(currentKpis.total_bookings, previousKpis.total_bookings),
      pos_revenue: trend(currentKpis.pos_revenue, previousKpis.pos_revenue),
      shop_revenue: trend(currentKpis.shop_revenue, previousKpis.shop_revenue),
      swimming_revenue: trend(currentKpis.swimming_revenue, previousKpis.swimming_revenue),
      total_guests: trend(currentKpis.total_guests, previousKpis.total_guests),
    },
    period: { date_from: dateFrom, date_to: dateTo },
    previous_period: previous,
  };

  const moduleBreakdown = [
    { module: 'Bookings', revenue: currentKpis.booking_revenue },
    { module: 'POS', revenue: currentKpis.pos_revenue },
    { module: 'Shop', revenue: currentKpis.shop_revenue },
    { module: 'Swimming', revenue: currentKpis.swimming_revenue },
  ].filter((row) => row.revenue > 0);

  const [guestDemo, promoSummary, occupancy, topPos, topShop] = await Promise.all([
    getGuestDemographics(dateFrom, dateTo),
    getPromoSummary(dateFrom, dateTo),
    getOccupancySnapshot(dateFrom, dateTo),
    getTopPosItems(dateFrom, dateTo),
    getTopShopItems(dateFrom, dateTo),
  ]);

  const weekendEventShare = await getWeekendEventShare(dateFrom, dateTo);
  const posPeakHour = await getPosPeakHour(dateFrom, dateTo);
  const swimmingLift = trend(currentKpis.swimming_revenue, previousKpis.swimming_revenue);

  return {
    kpis,
    revenue_trend: await getRevenueTrend(dateFrom, dateTo),
    bookings_by_category: await getBookingsByCategory(dateFrom, dateTo),
    module_breakdown: moduleBreakdown,
    guest_demographics: guestDemo,
    pos_top_items: topPos,
    shop_top_items: topShop,
    promo_performance: promoSummary,
    occupancy,
    key_insights: buildKeyInsights(currentKpis, previousKpis, {
      weekendEventShare,
      swimmingSummerLift: swimmingLift,
      posPeakHour,
    }),
  };
}

export async function getRevenueAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  const bookingRevenue = await getReservationRevenue(dateFrom, dateTo);
  const swimmingRevenue = await getSwimmingRevenue(dateFrom, dateTo);
  const posRevenue = await getPosRevenue(dateFrom, dateTo, { posOnly: true });
  const shopRevenue = await getPosRevenue(dateFrom, dateTo, { shopOnly: true });
  const grossRevenue = roundMoney(bookingRevenue + swimmingRevenue + posRevenue + shopRevenue);
  const refundTotal = await getRefundTotal(dateFrom, dateTo);

  return {
    available: true,
    gross_revenue: grossRevenue,
    refund_total: refundTotal,
    net_revenue: roundMoney(grossRevenue - refundTotal),
    by_module: [
      { module: 'booking', revenue: bookingRevenue },
      { module: 'swimming', revenue: swimmingRevenue },
      { module: 'pos', revenue: posRevenue },
      { module: 'shop', revenue: shopRevenue },
    ],
    by_day: await getRevenueTrend(dateFrom, dateTo),
    by_payment_method: await getRevenueByPaymentMethod(dateFrom, dateTo),
  };
}

async function getRevenueByPaymentMethod(dateFrom, dateTo) {
  const results = [];
  if (await tableExists('bookings')) {
    const [rows] = await db.query(
      `SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS method,
              COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue
       FROM bookings
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND ${NON_CANCELLED_BOOKING_EXPR.replace(/b\./g, '')}
       GROUP BY method`,
      [dateFrom, dateTo]
    );
    rows.forEach((row) => results.push({ module: 'booking', method: row.method, revenue: roundMoney(row.revenue) }));
  }
  if (await tableExists('pos_transactions')) {
    const dateExpr = await getPosDateExpr();
    const paidFilter = await getPosPaidFilter();
    const [rows] = await db.query(
      `SELECT COALESCE(NULLIF(TRIM(pt.payment_method), ''), 'Unknown') AS method,
              COALESCE(SUM(pt.total_amount), 0) AS revenue
       FROM pos_transactions pt
       WHERE ${dateExpr} BETWEEN ? AND ?
         ${paidFilter}
       GROUP BY method`,
      [dateFrom, dateTo]
    );
    rows.forEach((row) => results.push({ module: 'pos', method: row.method, revenue: roundMoney(row.revenue) }));
  }
  return results;
}

export async function getBookingAnalytics(filters = {}) {
  const { dateFrom, dateTo, categoryType } = filters;
  if (!(await tableExists('booking_items'))) {
    return { available: false, message: 'No booking item data available.' };
  }

  const params = [dateFrom, dateTo];
  let categoryClause = '';
  if (categoryType) {
    categoryClause = 'AND LOWER(COALESCE(bi.item_type, \'\')) = ?';
    params.push(String(categoryType).toLowerCase());
  }

  const itemRevenueExpr = await getBookingItemRevenueExpr();
  const [statusRows] = await db.query(
    `SELECT COALESCE(b.booking_status, 'Unknown') AS status, COUNT(*) AS count
     FROM bookings b
     WHERE DATE(b.created_at) BETWEEN ? AND ?
     GROUP BY status`,
    [dateFrom, dateTo]
  );

  const [categoryRows] = await db.query(
    `SELECT
       LOWER(COALESCE(bi.item_type, 'other')) AS category_type,
       COUNT(DISTINCT bi.booking_id) AS bookings,
       COALESCE(SUM(${itemRevenueExpr}), 0) AS revenue,
       COALESCE(AVG(${itemRevenueExpr}), 0) AS avg_value
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}
       ${categoryClause}
     GROUP BY category_type`,
    params
  );

  const [topItems] = await db.query(
    `SELECT bi.item_name, bi.item_type, COUNT(*) AS bookings,
            COALESCE(SUM(${itemRevenueExpr}), 0) AS revenue
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}
       ${categoryClause}
     GROUP BY bi.item_name, bi.item_type
     ORDER BY bookings DESC
     LIMIT 10`,
    params
  );

  const [cancelRows] = await db.query(
    `SELECT
       SUM(CASE WHEN LOWER(REPLACE(COALESCE(booking_status, ''), '-', '_')) = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       COUNT(*) AS total
     FROM bookings
     WHERE DATE(created_at) BETWEEN ? AND ?`,
    [dateFrom, dateTo]
  );
  const cancelled = toNumber(cancelRows[0]?.cancelled);
  const total = toNumber(cancelRows[0]?.total);

  return {
    available: true,
    total_reservations: await getTotalBookings(dateFrom, dateTo),
    by_category: categoryRows.map((row) => ({
      category_type: row.category_type,
      bookings: toNumber(row.bookings),
      revenue: roundMoney(row.revenue),
      average_value: roundMoney(row.avg_value),
    })),
    status_breakdown: statusRows.map((row) => ({ status: row.status, count: toNumber(row.count) })),
    top_items: topItems.map((row) => ({
      name: row.item_name,
      category_type: row.item_type,
      bookings: toNumber(row.bookings),
      revenue: roundMoney(row.revenue),
    })),
    cancellation_rate: total > 0 ? roundMoney((cancelled / total) * 100) : 0,
  };
}

export async function getGuestAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  const demographics = await getGuestDemographics(dateFrom, dateTo);
  return {
    available: true,
    total_guests: demographics.total_guests,
    demographics,
    average_guests_by_category: await getAverageGuestsByCategory(dateFrom, dateTo),
  };
}

async function getAverageGuestsByCategory(dateFrom, dateTo) {
  if (!(await tableExists('booking_items'))) return [];
  const guestExpr = (await getColumns('booking_items')).has('total_guests')
    ? 'COALESCE(bi.total_guests, bi.guests, 0)'
    : 'COALESCE(bi.guests, 0)';
  const [rows] = await db.query(
    `SELECT LOWER(COALESCE(bi.item_type, 'other')) AS category_type,
            COALESCE(AVG(${guestExpr}), 0) AS avg_guests
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND ${NON_CANCELLED_BOOKING_EXPR}
     GROUP BY category_type`,
    [dateFrom, dateTo]
  );
  return rows.map((row) => ({
    category_type: row.category_type,
    average_guests: roundMoney(row.avg_guests),
  }));
}

export async function getSwimmingAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  if (!(await tableExists('booking_items'))) {
    return { available: false, message: 'Swimming analytics not available.' };
  }

  const itemRevenueExpr = await getBookingItemRevenueExpr();
  const [packageRows] = await db.query(
    `SELECT bi.item_name AS package_name,
            COUNT(*) AS enrollments,
            COALESCE(SUM(${itemRevenueExpr}), 0) AS revenue
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE DATE(b.created_at) BETWEEN ? AND ?
       AND LOWER(COALESCE(bi.item_type, '')) = 'swimming'
       AND ${NON_CANCELLED_BOOKING_EXPR}
     GROUP BY bi.item_name
     ORDER BY enrollments DESC`,
    [dateFrom, dateTo]
  );

  let batchRows = [];
  if (await tableExists('swimming_batches')) {
    const [rows] = await db.query(
      `SELECT sb.batch_name, COUNT(bi.item_id) AS participants
       FROM booking_items bi
       INNER JOIN bookings b ON b.booking_id = bi.booking_id
       LEFT JOIN swimming_batches sb ON sb.batch_id = bi.batch_id
       WHERE DATE(b.created_at) BETWEEN ? AND ?
         AND LOWER(COALESCE(bi.item_type, '')) = 'swimming'
         AND ${NON_CANCELLED_BOOKING_EXPR}
       GROUP BY sb.batch_name
       ORDER BY participants DESC
       LIMIT 10`,
      [dateFrom, dateTo]
    );
    batchRows = rows;
  }

  return {
    available: true,
    total_enrollments: packageRows.reduce((sum, row) => sum + toNumber(row.enrollments), 0),
    swimming_revenue: await getSwimmingRevenue(dateFrom, dateTo),
    packages: packageRows.map((row) => ({
      package_name: row.package_name,
      enrollments: toNumber(row.enrollments),
      revenue: roundMoney(row.revenue),
    })),
    batches: batchRows.map((row) => ({
      batch_name: row.batch_name || 'Unassigned',
      participants: toNumber(row.participants),
    })),
  };
}

export async function getPosAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  if (!(await tableExists('pos_transactions'))) {
    return { available: false, message: 'POS analytics not available.' };
  }

  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [summaryRows] = await db.query(
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(pt.total_amount), 0) AS revenue,
            COALESCE(AVG(pt.total_amount), 0) AS avg_transaction
     FROM pos_transactions pt
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery')`,
    [dateFrom, dateTo]
  );

  return {
    available: true,
    total_revenue: roundMoney(summaryRows[0]?.revenue),
    total_transactions: toNumber(summaryRows[0]?.transactions),
    average_transaction_value: roundMoney(summaryRows[0]?.avg_transaction),
    top_items: await getTopPosItems(dateFrom, dateTo, 10),
    sales_by_hour: await getPosSalesByHour(dateFrom, dateTo),
  };
}

async function getPosSalesByHour(dateFrom, dateTo) {
  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [rows] = await db.query(
    `SELECT HOUR(COALESCE(pt.transaction_time, pt.created_at)) AS hour,
            COALESCE(SUM(pt.total_amount), 0) AS revenue
     FROM pos_transactions pt
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) NOT IN ('e-shop', 'delivery')
     GROUP BY hour
     ORDER BY hour`,
    [dateFrom, dateTo]
  );
  return rows.map((row) => ({ hour: toNumber(row.hour), revenue: roundMoney(row.revenue) }));
}

export async function getShopAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  if (!(await tableExists('pos_transactions'))) {
    return { available: false, message: 'Shop analytics is not available yet.', items: [] };
  }

  const shopRevenue = await getPosRevenue(dateFrom, dateTo, { shopOnly: true });
  if (shopRevenue <= 0) {
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM pos_transactions
       WHERE LOWER(COALESCE(type, '')) IN ('e-shop', 'delivery')
         AND DATE(COALESCE(transaction_date, created_at)) BETWEEN ? AND ?`,
      [dateFrom, dateTo]
    );
    if (toNumber(countRows[0]?.total) === 0) {
      return { available: false, message: 'No shop data available yet.', items: [] };
    }
  }

  const dateExpr = await getPosDateExpr();
  const paidFilter = await getPosPaidFilter();
  const [orderRows] = await db.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(pt.total_amount), 0) AS revenue
     FROM pos_transactions pt
     WHERE ${dateExpr} BETWEEN ? AND ?
       ${paidFilter}
       AND LOWER(COALESCE(pt.type, '')) IN ('e-shop', 'delivery')`,
    [dateFrom, dateTo]
  );

  return {
    available: true,
    total_shop_revenue: roundMoney(orderRows[0]?.revenue),
    total_shop_orders: toNumber(orderRows[0]?.orders),
    average_order_value: toNumber(orderRows[0]?.orders) > 0
      ? roundMoney(orderRows[0].revenue / orderRows[0].orders)
      : 0,
    top_products: await getTopShopItems(dateFrom, dateTo, 10),
  };
}

export async function getPromoAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  const summary = await getPromoSummary(dateFrom, dateTo);
  return { available: summary.available, ...summary };
}

export async function getOccupancyAnalytics(filters = {}) {
  const { dateFrom, dateTo } = filters;
  const snapshot = await getOccupancySnapshot(dateFrom, dateTo);
  return { available: snapshot.available, ...snapshot };
}
