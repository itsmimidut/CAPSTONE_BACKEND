import db from "../config/db.js";

const toNumber = (value) => Number(value || 0);

const parseImages = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const pickInventoryImage = (imagesValue, primaryIndex = 0) => {
  const images = parseImages(imagesValue);
  if (!images.length) return "";
  const index = Number.isInteger(Number(primaryIndex)) ? Number(primaryIndex) : 0;
  return images[index] || images[0] || "";
};

const formatPrice = (amount, suffix = "") => {
  const value = toNumber(amount);
  const formatted = value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return suffix ? `₱${formatted} ${suffix}` : `₱${formatted}`;
};

const mapTopRow = (row, options = {}) => {
  const name = row.name || row.item || row.title || "Unknown";
  const count = toNumber(row.count ?? row.quantity ?? row.bookings);
  const revenue = toNumber(row.revenue ?? row.sales ?? row.amount);
  const imageUrl =
    row.imageUrl ||
    row.image_url ||
    pickInventoryImage(row.images, row.primaryImageIndex) ||
    options.fallbackImage ||
    "";

  return {
    id: row.id ?? row.item_id ?? row.menu_id ?? name,
    name,
    title: name,
    price: row.price || (revenue > 0 ? formatPrice(revenue) : "View details"),
    imageUrl,
    count,
    sales: revenue,
  };
};

export const getCustomerTopPicks = async () => {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(endDate.getFullYear() - 1);

  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const dateParams = [start, end];

  const [topBookedRows] = await db.query(
    `
      SELECT
        bi.item_name AS name,
        COALESCE(bi.item_type, 'Unknown') AS category,
        COALESCE(SUM(bi.quantity), 0) AS count,
        COALESCE(SUM(bi.total_price), 0) AS revenue,
        MAX(ii.images) AS images,
        MAX(ii.primaryImageIndex) AS primaryImageIndex,
        MAX(ii.item_id) AS item_id
      FROM booking_items bi
      JOIN bookings b ON bi.booking_id = b.booking_id
      LEFT JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
      WHERE b.booking_status != 'Cancelled'
        AND DATE(b.created_at) BETWEEN ? AND ?
      GROUP BY bi.item_name, bi.item_type
      ORDER BY revenue DESC
      LIMIT 3
    `,
    dateParams,
  );

  const [topMenuRows] = await db.query(
    `
      SELECT
        COALESCE(mi.menu_id, 0) AS menu_id,
        COALESCE(mi.name, pti.item_name, 'Unknown') AS name,
        COALESCE(SUM(pti.quantity), 0) AS count,
        COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS revenue,
        MAX(mi.price) AS price,
        MAX(mi.image_url) AS image_url
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.transaction_id = pt.id
      LEFT JOIN menu_items mi ON mi.menu_id = pti.menu_id
      WHERE pti.menu_id IS NOT NULL
        AND DATE(COALESCE(pt.transaction_date, pt.created_at)) BETWEEN ? AND ?
      GROUP BY COALESCE(mi.menu_id, 0), COALESCE(mi.name, pti.item_name)
      ORDER BY revenue DESC
      LIMIT 3
    `,
    dateParams,
  );

  const [topShopRows] = await db.query(
    `
      SELECT
        COALESCE(pti.item_name, 'Unknown') AS name,
        COALESCE(SUM(pti.quantity), 0) AS count,
        COALESCE(SUM(COALESCE(pti.line_total, pti.quantity * COALESCE(pti.unit_price, 0))), 0) AS revenue
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.transaction_id = pt.id
      WHERE pt.type IN ('E-Shop', 'Delivery')
        AND pti.menu_id IS NULL
        AND DATE(COALESCE(pt.transaction_date, pt.created_at)) BETWEEN ? AND ?
      GROUP BY pti.item_name
      ORDER BY revenue DESC
      LIMIT 3
    `,
    dateParams,
  );

  const [topActivityRows] = await db.query(
    `
      SELECT
        bi.item_name AS name,
        COALESCE(SUM(bi.quantity), 0) AS count,
        COALESCE(SUM(bi.total_price), 0) AS revenue,
        MAX(ii.images) AS images,
        MAX(ii.primaryImageIndex) AS primaryImageIndex,
        MAX(ii.item_id) AS item_id
      FROM booking_items bi
      JOIN bookings b ON bi.booking_id = b.booking_id
      LEFT JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
      WHERE bi.item_type IN ('Swimming', 'Event')
        AND b.booking_status != 'Cancelled'
        AND DATE(b.created_at) BETWEEN ? AND ?
      GROUP BY bi.item_name
      ORDER BY revenue DESC
      LIMIT 3
    `,
    dateParams,
  );

  return {
    topBookedItems: topBookedRows.map((row) => mapTopRow(row)),
    topMenuItems: topMenuRows.map((row) => mapTopRow(row)),
    topShopItems: topShopRows.map((row) => mapTopRow(row)),
    topActivities: topActivityRows.map((row) => mapTopRow(row)),
  };
};
