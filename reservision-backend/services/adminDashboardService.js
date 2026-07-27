import db from "../config/db.js";

const toDateString = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const toNumber = (value) => Number(value || 0);
let bookingColumnSetPromise = null;

const normalizePeriod = (period = "day") => {
  const allowed = new Set(["day", "week", "month", "year"]);
  const normalized = String(period).toLowerCase();
  return allowed.has(normalized) ? normalized : "day";
};

const isActiveBookingStatusExpr = "LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_')) IN ('confirmed','checked_in')";
const isActiveOrCompletedBookingStatusExpr =
  "LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_')) IN ('confirmed','checked_in','checked_out')";
const isPendingPaymentExpr =
  "LOWER(COALESCE(b.payment_status, '')) IN ('pending','unpaid')";
const isPendingRefundExpr =
  "LOWER(COALESCE(r.refund_status, '')) = 'pending'";
const isPaidBookingExpr = `
  (
    LOWER(COALESCE(b.payment_status, '')) IN ('paid','partially refunded','refunded')
    OR EXISTS (
      SELECT 1
      FROM payments p
      WHERE p.booking_id = b.booking_id
        AND LOWER(COALESCE(p.status, '')) IN ('paid','settled','completed','success')
    )
  )
`;
const isNonCancelledBookingExpr =
  "LOWER(REPLACE(COALESCE(b.booking_status, ''), '-', '_')) NOT IN ('cancelled','voided')";

const occupancyCategoryValueSql = `
  LOWER(
    CONVERT(
      COALESCE(ii.category_type, ii.category, '')
      USING utf8mb4
    ) COLLATE utf8mb4_unicode_ci
  )
`;

const salesCategoryValueSql = `
  LOWER(
    CONVERT(
      COALESCE(ii.category_type, ii.category, bi.item_type, '')
      USING utf8mb4
    ) COLLATE utf8mb4_unicode_ci
  )
`;

const occupancyCategoryExpr = `
  CASE
    WHEN ${occupancyCategoryValueSql} IN ('room', 'rooms') THEN 'room'
    WHEN ${occupancyCategoryValueSql} IN ('cottage', 'cottages') THEN 'cottage'
    WHEN ${occupancyCategoryValueSql} IN ('event', 'events') THEN 'event'
    WHEN ${occupancyCategoryValueSql} IN ('swimming', 'swim') THEN 'swimming'
    ELSE NULL
  END
`;

const salesCategoryExpr = `
  CASE
    WHEN ${salesCategoryValueSql} IN ('room', 'rooms') THEN 'Rooms'
    WHEN ${salesCategoryValueSql} IN ('cottage', 'cottages') THEN 'Cottages'
    WHEN ${salesCategoryValueSql} IN ('event', 'events') THEN 'Events'
    WHEN ${salesCategoryValueSql} IN ('swimming', 'swim') THEN 'Swimming'
    ELSE NULL
  END
`;

const getBookingColumns = async () => {
  if (!bookingColumnSetPromise) {
    bookingColumnSetPromise = db
      .query("SHOW COLUMNS FROM bookings")
      .then(([rows]) => new Set(rows.map((row) => String(row.Field || "").toLowerCase())));
  }
  return bookingColumnSetPromise;
};

const hasBookingColumn = async (columnName) => {
  const columns = await getBookingColumns();
  return columns.has(String(columnName || "").toLowerCase());
};

export const getPeriodRange = (period = "day") => {
  const normalized = normalizePeriod(period);
  const now = new Date();
  const endDate = toDateString(now);
  let startDate = endDate;

  if (normalized === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    startDate = toDateString(start);
  } else if (normalized === "month") {
    startDate = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (normalized === "year") {
    startDate = toDateString(new Date(now.getFullYear(), 0, 1));
  }

  return { period: normalized, startDate, endDate };
};

export const getDashboardKpis = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
      SELECT
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE DATE(b.created_at) BETWEEN ? AND ?
        ) AS totalBookings,
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE DATE(b.check_in_date) BETWEEN ? AND ?
            AND ${isActiveBookingStatusExpr}
        ) AS checkIns,
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE DATE(b.check_out_date) BETWEEN ? AND ?
            AND ${isActiveOrCompletedBookingStatusExpr}
        ) AS checkOuts,
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE ${isPendingPaymentExpr}
        ) AS pendingPayments,
        (
          SELECT COUNT(*)
          FROM refunds r
          WHERE ${isPendingRefundExpr}
        ) AS pendingRefunds
    `,
    [startDate, endDate, startDate, endDate, startDate, endDate],
  );

  return {
    totalBookings: toNumber(rows[0]?.totalBookings),
    checkIns: toNumber(rows[0]?.checkIns),
    checkOuts: toNumber(rows[0]?.checkOuts),
    pendingPayments: toNumber(rows[0]?.pendingPayments),
    pendingRefunds: toNumber(rows[0]?.pendingRefunds),
  };
};

const getInventoryTotals = async () => {
  const [rows] = await db.query(`
    SELECT
      ${occupancyCategoryExpr} AS category_key,
      COUNT(*) AS total
    FROM inventory_items ii
    WHERE ${occupancyCategoryExpr} IS NOT NULL
    GROUP BY ${occupancyCategoryExpr}
  `);

  const totals = {
    room: 0,
    cottage: 0,
    event: 0,
    swimming: 0,
  };

  for (const row of rows) {
    const type = String(row.category_key || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(totals, type)) {
      totals[type] += toNumber(row.total);
    }
  }

  return totals;
};

const getOccupiedInventoryCounts = async () => {
  const [rows] = await db.query(`
    SELECT
      ${occupancyCategoryExpr} AS category_key,
      COUNT(DISTINCT bi.inventory_item_id) AS occupied
    FROM bookings b
    JOIN booking_items bi ON bi.booking_id = b.booking_id
    LEFT JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
    WHERE CURDATE() >= DATE(b.check_in_date)
      AND CURDATE() < DATE(b.check_out_date)
      AND ${isActiveBookingStatusExpr}
      AND bi.inventory_item_id IS NOT NULL
      AND ${occupancyCategoryExpr} IS NOT NULL
    GROUP BY ${occupancyCategoryExpr}
  `);

  const occupied = {
    room: 0,
    cottage: 0,
    event: 0,
    swimming: 0,
  };

  for (const row of rows) {
    const type = String(row.category_key || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(occupied, type)) {
      occupied[type] += toNumber(row.occupied);
    }
  }

  return occupied;
};

const buildOccupancyUnit = (total, occupied) => {
  const safeTotal = Math.max(toNumber(total), 0);
  const safeOccupied = Math.min(Math.max(toNumber(occupied), 0), safeTotal);
  return {
    occupied: safeOccupied,
    total: safeTotal,
    available: Math.max(safeTotal - safeOccupied, 0),
  };
};

export const getOccupancyOverview = async (_startDate = null, _endDate = null) => {
  const [totals, occupied] = await Promise.all([
    getInventoryTotals(),
    getOccupiedInventoryCounts(),
  ]);

  const rooms = buildOccupancyUnit(totals.room, occupied.room);
  const cottages = buildOccupancyUnit(totals.cottage, occupied.cottage);
  const events = buildOccupancyUnit(totals.event, occupied.event);
  const swimming = buildOccupancyUnit(totals.swimming, occupied.swimming);

  const overallTotal = rooms.total + cottages.total + events.total + swimming.total;
  const overallOccupied = rooms.occupied + cottages.occupied + events.occupied + swimming.occupied;
  const percent = overallTotal > 0 ? Math.round((overallOccupied / overallTotal) * 100) : 0;

  return {
    percent,
    rooms,
    cottages,
    events,
    swimming,
  };
};

const formatTimeValue = (value) => {
  if (!value) return "N/A";
  const raw = String(value);
  const normalized = raw.length >= 5 ? raw.slice(0, 5) : raw;
  const parsed = new Date(`1970-01-01T${normalized}`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const normalizeTypeLabel = (value) => {
  const type = String(value || "").toLowerCase();
  if (type.includes("room")) return "Room";
  if (type.includes("cottage")) return "Cottage";
  if (type.includes("event")) return "Event";
  if (type.includes("swimming")) return "Swimming";
  return "Booking";
};

const mapTodayRow = (row) => ({
  id: toNumber(row.booking_id),
  time: formatTimeValue(row.display_time),
  guest: `${String(row.first_name || "").trim()} ${String(row.last_name || "").trim()}`.trim() || "Guest",
  location: row.primary_item_name || "N/A",
  type: normalizeTypeLabel(row.primary_item_type),
  status: row.booking_status || "N/A",
});

const getScheduleTimeExpression = async (movement) => {
  const normalized = String(movement || "").toLowerCase();
  const actualColumn = normalized === "check_out" ? "actual_check_out_time" : "actual_check_in_time";
  const scheduleTimeColumn = normalized === "check_out" ? "check_out_time" : "check_in_time";
  const scheduleDateColumn = normalized === "check_out" ? "check_out_date" : "check_in_date";

  const hasActual = await hasBookingColumn(actualColumn);
  const hasScheduleTime = await hasBookingColumn(scheduleTimeColumn);

  if (hasActual && hasScheduleTime) {
    return `COALESCE(TIME(b.${actualColumn}), TIME(b.${scheduleTimeColumn}), TIME(b.${scheduleDateColumn}), '00:00:00')`;
  }
  if (hasActual) {
    return `COALESCE(TIME(b.${actualColumn}), TIME(b.${scheduleDateColumn}), '00:00:00')`;
  }
  if (hasScheduleTime) {
    return `COALESCE(TIME(b.${scheduleTimeColumn}), TIME(b.${scheduleDateColumn}), '00:00:00')`;
  }
  return `COALESCE(TIME(b.${scheduleDateColumn}), '00:00:00')`;
};

const getTodayMovementRows = async ({ movement, statusExpr, limit = 5 }) => {
  const isCheckOut = String(movement).toLowerCase() === "check_out";
  const dateColumn = isCheckOut ? "check_out_date" : "check_in_date";
  const timeExpression = await getScheduleTimeExpression(movement);

  const [rows] = await db.query(`
    SELECT
      b.booking_id,
      b.first_name,
      b.last_name,
      b.booking_status,
      ${timeExpression} AS display_time,
      (
        SELECT bi.item_name
        FROM booking_items bi
        WHERE bi.booking_id = b.booking_id
        ORDER BY bi.item_id ASC
        LIMIT 1
      ) AS primary_item_name,
      (
        SELECT bi.item_type
        FROM booking_items bi
        WHERE bi.booking_id = b.booking_id
        ORDER BY bi.item_id ASC
        LIMIT 1
      ) AS primary_item_type
    FROM bookings b
    WHERE DATE(b.${dateColumn}) = CURDATE()
      AND ${statusExpr}
    ORDER BY display_time ASC
    LIMIT ?
  `, [limit]);

  return rows;
};

export const getTodayCheckIns = async (_startDate = null, _endDate = null) => {
  const rows = await getTodayMovementRows({
    movement: "check_in",
    statusExpr: isActiveBookingStatusExpr,
  });

  return rows.map(mapTodayRow);
};

export const getTodayCheckOuts = async (_startDate = null, _endDate = null) => {
  const rows = await getTodayMovementRows({
    movement: "check_out",
    statusExpr: isActiveOrCompletedBookingStatusExpr,
  });

  return rows.map(mapTodayRow);
};

export const getRecentBookings = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
      SELECT
        b.booking_id,
        b.booking_reference,
        COALESCE(NULLIF(TRIM(c.first_name), ''), NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(b.first_name), '')) AS first_name,
        COALESCE(NULLIF(TRIM(c.last_name), ''), NULLIF(TRIM(u.last_name), ''), NULLIF(TRIM(b.last_name), '')) AS last_name,
        b.booking_status,
        b.payment_status,
        b.total,
        b.created_at,
        GROUP_CONCAT(DISTINCT bi.item_name ORDER BY bi.item_id ASC SEPARATOR ', ') AS items_summary
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN user u ON c.user_id = u.user_id
      LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
      WHERE DATE(b.created_at) BETWEEN ? AND ?
        AND ${isNonCancelledBookingExpr}
      GROUP BY b.booking_id
      ORDER BY b.created_at DESC
      LIMIT 5
    `,
    [startDate, endDate],
  );

  return rows.map((row) => ({
    booking_id: toNumber(row.booking_id),
    booking_reference: row.booking_reference,
    first_name: row.first_name,
    last_name: row.last_name,
    items_summary: row.items_summary || "N/A",
    booking_status: row.booking_status,
    payment_status: row.payment_status,
    total: toNumber(row.total),
    created_at: row.created_at,
  }));
};

export const getRevenueSummary = async (startDate, endDate) => {
  const [grossRows] = await db.query(
    `
      SELECT
        COALESCE(SUM(COALESCE(b.total, 0)), 0) AS grossSales,
        COUNT(*) AS transactions
      FROM bookings b
      WHERE DATE(b.created_at) BETWEEN ? AND ?
        AND ${isNonCancelledBookingExpr}
        AND ${isPaidBookingExpr}
    `,
    [startDate, endDate],
  );

  const [refundRows] = await db.query(
    `
      SELECT
        COALESCE(SUM(COALESCE(r.refund_amount, 0)), 0) AS refunds
      FROM refunds r
      WHERE DATE(COALESCE(r.refunded_at, r.approved_at, r.updated_at, r.created_at)) BETWEEN ? AND ?
        AND LOWER(COALESCE(r.refund_status, '')) IN ('approved','completed','refunded')
    `,
    [startDate, endDate],
  );

  const grossSales = toNumber(grossRows[0]?.grossSales);
  const refunds = toNumber(refundRows[0]?.refunds);
  const netSales = grossSales - refunds;

  return {
    grossSales,
    refunds,
    netSales,
    transactions: toNumber(grossRows[0]?.transactions),
  };
};

export const getSalesByChannel = async (startDate, endDate) => {
  const [rows] = await db.query(
    `
      SELECT
        ${salesCategoryExpr} AS label,
        COALESCE(SUM(COALESCE(bi.total_price, bi.quantity * bi.unit_price, 0)), 0) AS amount
      FROM bookings b
      JOIN booking_items bi ON bi.booking_id = b.booking_id
      LEFT JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
      WHERE DATE(b.created_at) BETWEEN ? AND ?
        AND ${isNonCancelledBookingExpr}
        AND ${isPaidBookingExpr}
        AND ${salesCategoryExpr} IS NOT NULL
      GROUP BY ${salesCategoryExpr}
    `,
    [startDate, endDate],
  );

  const fixedOrder = ["Rooms", "Cottages", "Events", "Swimming"];
  const amountByLabel = new Map(rows.map((row) => [row.label, toNumber(row.amount)]));
  const totalAmount = fixedOrder.reduce((sum, label) => sum + (amountByLabel.get(label) || 0), 0);

  return fixedOrder.map((label) => {
    const amount = amountByLabel.get(label) || 0;
    const percentage = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
    return { label, amount, percentage };
  });
};
