import db from '../config/db.js';
import { normalizeDateValue, normalizeTimeValue } from './availabilityService.js';

const CATEGORY_PLURAL_MAP = {
  room: 'rooms',
  cottage: 'cottages',
  event: 'events',
};

const SEASONAL_PRICING_TYPES = new Set([
  'fixed_price',
  'percentage_increase',
  'percentage_decrease',
  'amount_increase',
  'amount_decrease',
]);

let seasonalColumnsCache = null;
let bookingItemsPricingColumnsCache = null;
let bookingsPricingColumnsCache = null;

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toMinutes = (value) => {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return (h * 60) + m;
};

const differenceInDays = (startDate, endDate) => {
  const start = normalizeDateValue(startDate);
  const end = normalizeDateValue(endDate);
  if (!start || !end) return 0;
  const ms = new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`);
  return Math.max(0, Math.ceil(ms / 86400000));
};

export const calculateDuration = (itemPayload = {}) => {
  const categoryType = String(itemPayload.category_type || itemPayload.booking_type || itemPayload.bookingType || 'room').toLowerCase();
  const qty = Math.max(1, Number(itemPayload.qty || itemPayload.quantity || 1));

  if (categoryType === 'room') {
    const checkIn = normalizeDateValue(itemPayload.check_in_date || itemPayload.check_in || itemPayload.checkIn);
    const checkOut = normalizeDateValue(itemPayload.check_out_date || itemPayload.check_out || itemPayload.checkOut);
    const nights = differenceInDays(checkIn, checkOut);
    return {
      categoryType,
      qty,
      nights: Math.max(1, nights),
      hours: 0,
      days: Math.max(1, nights),
      checkIn,
      checkOut,
      bookingDate: checkIn,
      rateType: null,
      durationLabel: `${Math.max(1, nights)} night(s)`,
    };
  }

  if (categoryType === 'cottage') {
    const bookingDate = normalizeDateValue(
      itemPayload.booking_date || itemPayload.bookingDate || itemPayload.check_in_date || itemPayload.check_in
    );
    const checkIn = normalizeDateValue(itemPayload.check_in_date || itemPayload.check_in);
    const checkOut = normalizeDateValue(itemPayload.check_out_date || itemPayload.check_out);
    const days = (checkIn && checkOut) ? Math.max(1, differenceInDays(checkIn, checkOut)) : 1;
    return {
      categoryType,
      qty,
      nights: 0,
      hours: 0,
      days,
      bookingDate: bookingDate || checkIn,
      checkIn,
      checkOut,
      rateType: null,
      durationLabel: `${days} day(s)`,
    };
  }

  if (categoryType === 'event') {
    const bookingDate = normalizeDateValue(itemPayload.booking_date || itemPayload.bookingDate);
    const startTime = normalizeTimeValue(itemPayload.start_time || itemPayload.startTime);
    const endTime = normalizeTimeValue(itemPayload.end_time || itemPayload.endTime);
    const rateType = String(itemPayload.rate_type || itemPayload.rateType || 'per_event').toLowerCase();
    const startMinutes = toMinutes(startTime);
    const endMinutes = toMinutes(endTime);
    const hours = (startMinutes != null && endMinutes != null && endMinutes > startMinutes)
      ? (endMinutes - startMinutes) / 60
      : 0;

    return {
      categoryType,
      qty,
      nights: 0,
      hours,
      days: 1,
      bookingDate,
      startTime,
      endTime,
      rateType,
      durationLabel: rateType === 'per_hour'
        ? `${hours} hour(s)`
        : (rateType === 'per_day' ? '1 day' : '1 event'),
    };
  }

  return {
    categoryType,
    qty,
    nights: 0,
    hours: 0,
    days: 1,
    bookingDate: null,
    rateType: null,
    durationLabel: '1 unit',
  };
};

async function getSeasonalColumns(connection) {
  if (seasonalColumnsCache) return seasonalColumnsCache;
  const conn = connection || db;
  try {
    const [rows] = await conn.query('SHOW COLUMNS FROM seasonal_pricing');
    seasonalColumnsCache = new Set(rows.map((row) => row.Field));
  } catch {
    seasonalColumnsCache = new Set();
  }
  return seasonalColumnsCache;
}

async function getInventoryItem(connection, inventoryItemId) {
  const conn = connection || db;
  const [rows] = await conn.query(
    `SELECT item_id, name, category, category_type, price, rate_type
     FROM inventory_items
     WHERE item_id = ?
     LIMIT 1`,
    [inventoryItemId]
  );
  return rows[0] || null;
}

function resolveBookingDateForSeason(itemPayload, duration) {
  if (duration.categoryType === 'room') {
    return duration.checkIn;
  }
  if (duration.categoryType === 'cottage') {
    return duration.bookingDate;
  }
  return duration.bookingDate;
}

function mapLegacyApplyTo(categoryType) {
  return CATEGORY_PLURAL_MAP[categoryType] || categoryType;
}

function applySeasonalPricingToUnitPrice(baseUnitPrice, rule) {
  const base = Number(baseUnitPrice || 0);
  if (!rule) return { unitPrice: base, adjustment: 0, note: null, seasonName: null };

  const pricingType = String(rule.pricing_type || '').toLowerCase();
  const value = Number(rule.value ?? rule.multiplier ?? 0);
  const seasonName = rule.season_name || rule.name || 'Seasonal rate';

  if (pricingType && SEASONAL_PRICING_TYPES.has(pricingType)) {
    let unitPrice = base;
    if (pricingType === 'fixed_price') unitPrice = value;
    else if (pricingType === 'percentage_increase') unitPrice = base * (1 + (value / 100));
    else if (pricingType === 'percentage_decrease') unitPrice = base * (1 - (value / 100));
    else if (pricingType === 'amount_increase') unitPrice = base + value;
    else if (pricingType === 'amount_decrease') unitPrice = base - value;
    unitPrice = Math.max(0, roundMoney(unitPrice));
    return {
      unitPrice,
      adjustment: roundMoney(unitPrice - base),
      note: `${seasonName} applied`,
      seasonName,
      rule,
    };
  }

  if (rule.multiplier != null && Number(rule.multiplier) > 0) {
    const unitPrice = roundMoney(base * Number(rule.multiplier));
    return {
      unitPrice,
      adjustment: roundMoney(unitPrice - base),
      note: `${seasonName} applied`,
      seasonName,
      rule,
    };
  }

  return { unitPrice: base, adjustment: 0, note: null, seasonName: null, rule: null };
}

export async function applySeasonalPricing(item, bookingDate, connection = null) {
  const conn = connection || db;
  const columns = await getSeasonalColumns(conn);
  if (!columns.size) {
    const base = Number(item.price || 0);
    return { unitPrice: base, adjustment: 0, note: null, seasonName: null, rule: null };
  }

  const date = normalizeDateValue(bookingDate);
  const inventoryItemId = Number(item.item_id || item.inventory_item_id);
  const categoryType = String(item.category_type || '').toLowerCase();
  const base = Number(item.price || 0);

  if (!date) {
    return { unitPrice: base, adjustment: 0, note: null, seasonName: null, rule: null };
  }

  let rows = [];

  if (columns.has('pricing_type') || columns.has('inventory_item_id')) {
    const useNewDates = columns.has('start_date') && columns.has('end_date');
    const startCol = useNewDates ? 'start_date' : 'startDate';
    const endCol = useNewDates ? 'end_date' : 'endDate';
    const params = [date, date];
    let where = `WHERE ${startCol} <= ? AND ${endCol} >= ?`;

    if (columns.has('status')) {
      where += ` AND (status IS NULL OR status = 'Active')`;
    }

    const scopeParts = [];
    if (Number.isFinite(inventoryItemId) && inventoryItemId > 0 && columns.has('inventory_item_id')) {
      scopeParts.push('inventory_item_id = ?');
      params.push(inventoryItemId);
    }
    if (categoryType && columns.has('category_type')) {
      scopeParts.push('(inventory_item_id IS NULL AND category_type = ?)');
      params.push(categoryType);
    }
    if (columns.has('applyTo')) {
      scopeParts.push('(inventory_item_id IS NULL AND category_type IS NULL AND (applyTo = ? OR applyTo = ? OR applyTo = ?))');
      params.push('all', mapLegacyApplyTo(categoryType), String(inventoryItemId));
    }

    if (!scopeParts.length) {
      return { unitPrice: base, adjustment: 0, note: null, seasonName: null, rule: null };
    }

    where += ` AND (${scopeParts.join(' OR ')})`;

    const orderBy = columns.has('priority')
      ? 'ORDER BY (inventory_item_id IS NOT NULL) DESC, priority DESC, id DESC'
      : 'ORDER BY (inventory_item_id IS NOT NULL) DESC, id DESC';

  const [resultRows] = await conn.query(
      `SELECT * FROM seasonal_pricing ${where} ${orderBy} LIMIT 1`,
      params
    );
    rows = resultRows;
  } else if (columns.has('multiplier')) {
    const [legacyRows] = await conn.query(
      `SELECT *, name AS season_name
       FROM seasonal_pricing
       WHERE startDate <= ? AND endDate >= ?
         AND (applyTo = 'all' OR applyTo = ? OR applyTo = ?)
       ORDER BY id DESC
       LIMIT 1`,
      [date, date, mapLegacyApplyTo(categoryType), String(inventoryItemId)]
    );
    rows = legacyRows;
  }

  return applySeasonalPricingToUnitPrice(base, rows[0] || null);
}

function mapPromoRow(row) {
  if (!row) return null;
  const itemIds = String(row.promo_item_ids || row.item_ids || '')
    .split(',')
    .map((v) => String(v).trim())
    .filter(Boolean);

  return {
    promo_id: row.promo_id || row.id,
    code: row.code,
    name: row.name || row.code,
    discount_type: String(row.discount_type || row.type || 'percent').toLowerCase(),
    discount_value: Number(row.discount_value ?? row.value ?? 0),
    applies_to_category: String(row.applies_to_category || 'all').toLowerCase(),
    item_ids: itemIds,
    min_subtotal: Number(row.min_subtotal || 0),
    start_date: row.start_date || row.startDate || null,
    end_date: row.end_date || row.endDate || null,
    usage_limit: row.usage_limit ?? row.usageLimit ?? null,
    times_used: Number(row.times_used || 0),
    is_active: Number(row.is_active ?? 1),
  };
}

function isPromoActive(promo, referenceDate = new Date()) {
  if (!promo || !promo.is_active) return false;
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  if (promo.start_date) {
    const start = new Date(`${normalizeDateValue(promo.start_date)}T00:00:00`);
    if (today < start) return false;
  }
  if (promo.end_date) {
    const end = new Date(`${normalizeDateValue(promo.end_date)}T23:59:59`);
    if (today > end) return false;
  }
  if (promo.usage_limit != null && Number(promo.times_used || 0) >= Number(promo.usage_limit)) {
    return false;
  }
  return true;
}

function promoMatchesItem(promo, item, inventoryItemId, categoryType, seasonalSubtotal) {
  if (!isPromoActive(promo)) return false;

  const scope = String(promo.applies_to_category || 'all').toLowerCase();
  const plural = mapLegacyApplyTo(categoryType);
  let eligible = false;

  if (scope === 'all') eligible = true;
  if (scope === plural) eligible = true;
  if (promo.item_ids?.includes(String(inventoryItemId))) eligible = true;

  if (!eligible) return false;
  if (promo.min_subtotal > 0 && seasonalSubtotal < promo.min_subtotal) return false;
  return true;
}

export function applyPromoDiscount(subtotal, promo) {
  const amount = Number(subtotal || 0);
  if (!promo || amount <= 0) {
    return { discount: 0, finalSubtotal: amount, note: null };
  }

  const discountType = String(promo.discount_type || 'percent').toLowerCase();
  const discountValue = Number(promo.discount_value || 0);
  let discount = 0;

  if (discountType === 'percent' || discountType === 'percentage') {
    const pct = Math.min(100, Math.max(0, discountValue));
    discount = amount * (pct / 100);
  } else {
    discount = discountValue;
  }

  discount = Math.min(roundMoney(discount), amount);
  const finalSubtotal = roundMoney(amount - discount);

  return {
    discount,
    finalSubtotal,
    note: `${discountType === 'percent' || discountType === 'percentage'
      ? `${discountValue}%`
      : `₱${discountValue}`} promo applied`,
    promo,
  };
}

async function loadPromoById(conn, promoId) {
  const [rows] = await conn.query(
    `SELECT p.*, GROUP_CONCAT(DISTINCT pi.inventory_item_id ORDER BY pi.inventory_item_id SEPARATOR ',') AS promo_item_ids
     FROM promos p
     LEFT JOIN promo_items pi ON pi.promo_id = p.promo_id
     WHERE p.promo_id = ?
     GROUP BY p.promo_id
     LIMIT 1`,
    [promoId]
  );
  return mapPromoRow(rows[0]);
}

async function loadPromoByCode(conn, promoCode) {
  const [rows] = await conn.query(
    `SELECT p.*, GROUP_CONCAT(DISTINCT pi.inventory_item_id ORDER BY pi.inventory_item_id SEPARATOR ',') AS promo_item_ids
     FROM promos p
     LEFT JOIN promo_items pi ON pi.promo_id = p.promo_id
     WHERE UPPER(p.code) = ?
     GROUP BY p.promo_id
     LIMIT 1`,
    [String(promoCode || '').trim().toUpperCase()]
  );
  return mapPromoRow(rows[0]);
}

async function loadActivePromos(conn) {
  const [rows] = await conn.query(
    `SELECT p.*, GROUP_CONCAT(DISTINCT pi.inventory_item_id ORDER BY pi.inventory_item_id SEPARATOR ',') AS promo_item_ids
     FROM promos p
     LEFT JOIN promo_items pi ON pi.promo_id = p.promo_id
     WHERE p.is_active = 1
     GROUP BY p.promo_id`
  );
  return rows.map(mapPromoRow).filter(isPromoActive);
}

async function resolvePromoForItem(conn, {
  promoId,
  promoCode,
  item,
  inventoryItemId,
  categoryType,
  seasonalSubtotal,
}) {
  if (promoId) {
    const promo = await loadPromoById(conn, promoId);
    return promoMatchesItem(promo, item, inventoryItemId, categoryType, seasonalSubtotal) ? promo : null;
  }

  if (promoCode) {
    const promo = await loadPromoByCode(conn, promoCode);
    return promoMatchesItem(promo, item, inventoryItemId, categoryType, seasonalSubtotal) ? promo : null;
  }

  const activePromos = await loadActivePromos(conn);
  const matches = activePromos.filter((promo) => promoMatchesItem(
    promo,
    item,
    inventoryItemId,
    categoryType,
    seasonalSubtotal
  ));

  if (!matches.length) return null;

  let best = null;
  let bestDiscount = 0;
  matches.forEach((promo) => {
    const { discount } = applyPromoDiscount(seasonalSubtotal, promo);
    if (discount > bestDiscount) {
      best = promo;
      bestDiscount = discount;
    }
  });

  return best;
}

function calculateBaseSubtotal(unitPrice, duration) {
  const price = Number(unitPrice || 0);
  const qty = duration.qty;

  if (duration.categoryType === 'room') {
    return roundMoney(price * duration.nights * qty);
  }

  if (duration.categoryType === 'cottage') {
    return roundMoney(price * duration.days * qty);
  }

  if (duration.categoryType === 'event') {
    if (duration.rateType === 'per_hour') {
      return roundMoney(price * duration.hours * qty);
    }
    if (duration.rateType === 'per_day') {
      return roundMoney(price * duration.days * qty);
    }
    return roundMoney(price * qty);
  }

  return roundMoney(price * qty);
}

export async function calculateBookingItemPrice(itemPayload = {}, options = {}, connection = null) {
  const conn = connection || db;
  const inventoryItemId = Number(itemPayload.inventory_item_id || itemPayload.item_id || itemPayload.id);
  const isSwimming = Boolean(itemPayload.swimmingDetails || itemPayload.swimming_details);

  if (isSwimming) {
    const packagePrice = Number(
      itemPayload.swimmingDetails?.packagePrice
      || itemPayload.swimming_details?.packagePrice
      || 0
    );
    return {
      success: true,
      inventory_item_id: inventoryItemId || null,
      name: itemPayload.name || 'Swimming Lesson Package',
      category_type: 'swimming',
      base_price: packagePrice,
      seasonal_price: packagePrice,
      seasonal_adjustment: 0,
      promo_discount: 0,
      final_subtotal: packagePrice,
      unit_price: packagePrice,
      quantity: 1,
      pricing_notes: [],
      duration: calculateDuration({ ...itemPayload, category_type: 'swimming' }),
    };
  }

  if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
    return { success: false, message: 'Inventory item is required.' };
  }

  const inventory = await getInventoryItem(conn, inventoryItemId);
  if (!inventory) {
    return { success: false, message: 'Inventory item not found.' };
  }

  const categoryType = String(inventory.category_type || '').toLowerCase();
  if (!categoryType) {
    return { success: false, message: 'Inventory item category is not configured.' };
  }

  const requestedCategory = String(
    itemPayload.category_type
    || itemPayload.booking_type
    || itemPayload.bookingType
    || ''
  ).trim().toLowerCase();

  if (requestedCategory && requestedCategory !== categoryType) {
    return {
      success: false,
      reason: 'CATEGORY_MISMATCH',
      message: `Category type mismatch. Selected item is ${categoryType}, but request used ${requestedCategory}.`,
    };
  }

  const dbRateType = inventory.rate_type
    ? String(inventory.rate_type).toLowerCase()
    : (categoryType === 'event' ? 'per_event' : null);

  const duration = calculateDuration({
    ...itemPayload,
    category_type: categoryType,
    rate_type: dbRateType,
  });
  duration.categoryType = categoryType;
  duration.rateType = categoryType === 'event' ? dbRateType : null;

  if (categoryType === 'room') {
    if (!duration.checkIn || !duration.checkOut || duration.checkOut <= duration.checkIn) {
      return { success: false, message: 'Check-out date must be after check-in date.' };
    }
    if (duration.nights < 1) {
      return { success: false, message: 'Room bookings require at least 1 night.' };
    }
  }

  if (categoryType === 'event') {
    if (!duration.bookingDate) {
      return { success: false, message: 'Event booking date is required.' };
    }
    if (!duration.startTime || !duration.endTime) {
      return { success: false, message: 'Event start and end time are required.' };
    }
    if (duration.rateType === 'per_hour' && duration.hours <= 0) {
      return { success: false, message: 'Event hours must be greater than 0.' };
    }
  }

  const baseUnitPrice = Number(inventory.price || 0);
  if (!(baseUnitPrice > 0)) {
    return { success: false, message: 'A valid item price is required.' };
  }

  const bookingDateForSeason = resolveBookingDateForSeason(itemPayload, duration);
  const seasonal = await applySeasonalPricing(
    {
      item_id: inventoryItemId,
      category_type: categoryType,
      price: baseUnitPrice,
    },
    bookingDateForSeason,
    conn
  );

  const baseSubtotal = calculateBaseSubtotal(baseUnitPrice, duration);
  const seasonalSubtotal = calculateBaseSubtotal(seasonal.unitPrice, duration);
  const seasonalAdjustment = roundMoney(seasonalSubtotal - baseSubtotal);

  const promo = await resolvePromoForItem(conn, {
    promoId: itemPayload.promo_id || options.promo_id || null,
    promoCode: itemPayload.promo_code || options.promo_code || null,
    item: itemPayload,
    inventoryItemId,
    categoryType,
    seasonalSubtotal,
  });

  const promoResult = applyPromoDiscount(seasonalSubtotal, promo);
  const pricingNotes = [];
  if (seasonal.note) pricingNotes.push(seasonal.note);
  if (promoResult.note) pricingNotes.push(promoResult.note);

  return {
    success: true,
    inventory_item_id: inventoryItemId,
    name: inventory.name || 'Booked Item',
    category_type: categoryType,
    rate_type: duration.rateType,
    base_price: baseSubtotal,
    seasonal_price: seasonalSubtotal,
    seasonal_adjustment: seasonalAdjustment,
    promo_discount: promoResult.discount,
    final_subtotal: promoResult.finalSubtotal,
    unit_price: seasonal.unitPrice,
    quantity: duration.qty,
    pricing_notes: pricingNotes,
    promo_id: promo?.promo_id || null,
    promo_code: promo?.code || null,
    duration,
  };
}

export async function calculateBookingTotal(items = [], options = {}, connection = null) {
  const conn = connection || db;
  const list = Array.isArray(items) ? items : [];

  if (!list.length) {
    return { success: false, message: 'At least one item is required.' };
  }

  const pricedItems = [];
  let subtotal = 0;
  let promoDiscountTotal = 0;
  let seasonalAdjustmentTotal = 0;

  for (const item of list) {
    const priced = await calculateBookingItemPrice(item, options, conn);
    if (!priced.success) {
      return priced;
    }
    pricedItems.push(priced);
    subtotal += priced.final_subtotal;
    promoDiscountTotal += priced.promo_discount;
    seasonalAdjustmentTotal += priced.seasonal_adjustment;
  }

  const entranceFee = roundMoney(Number(options.entrance_fee || options.entranceFee || 0));
  const extraPersonFee = roundMoney(Number(options.extra_person_fee || options.extraPersonFee || 0));
  const total = roundMoney(subtotal + entranceFee + extraPersonFee);

  return {
    success: true,
    data: {
      items: pricedItems,
      subtotal: roundMoney(subtotal),
      promo_discount_total: roundMoney(promoDiscountTotal),
      seasonal_adjustment_total: roundMoney(seasonalAdjustmentTotal),
      entrance_fee: entranceFee,
      extra_person_fee: extraPersonFee,
      total,
    },
  };
}

export function mapCheckoutItemToPricingPayload(item, bookingContext = {}) {
  const bookingType = String(item.booking_type || item.bookingType || 'room').toLowerCase();
  return {
    inventory_item_id: item.inventory_item_id || item.item_id || item.id,
    category_type: bookingType,
    booking_type: bookingType,
    qty: item.qty || item.quantity || 1,
    price: item.price,
    check_in_date: item.check_in || item.checkIn || bookingContext.checkIn,
    check_out_date: item.check_out || item.checkOut || bookingContext.checkOut,
    booking_date: item.booking_date || item.bookingDate,
    start_time: item.start_time || item.startTime,
    end_time: item.end_time || item.endTime,
    rate_type: item.rate_type || item.rateType,
    promo_id: item.promo_id || bookingContext.promo_id || null,
    promo_code: item.promo_code || bookingContext.promo_code || null,
    name: item.name,
    swimmingDetails: item.swimmingDetails || item.swimming_details || null,
  };
}

export async function getBookingPricingColumnSets(connection = null) {
  const conn = connection || db;

  if (!bookingItemsPricingColumnsCache) {
    const [itemCols] = await conn.query(
      `SHOW COLUMNS FROM booking_items WHERE Field IN
        ('base_price', 'seasonal_price', 'seasonal_adjustment', 'promo_discount', 'final_subtotal', 'pricing_notes')`
    );
    bookingItemsPricingColumnsCache = new Set(itemCols.map((row) => row.Field));
  }

  if (!bookingsPricingColumnsCache) {
    const [bookingCols] = await conn.query(
      `SHOW COLUMNS FROM bookings WHERE Field IN ('pricing_total')`
    );
    bookingsPricingColumnsCache = new Set(bookingCols.map((row) => row.Field));
  }

  return {
    bookingItems: bookingItemsPricingColumnsCache,
    bookings: bookingsPricingColumnsCache,
  };
}

export function buildBookingItemPricingFields(pricedItem, columnSet) {
  if (!columnSet || !columnSet.size) return { fields: [], values: [] };

  const fields = [];
  const values = [];
  const mapping = {
    base_price: pricedItem?.base_price,
    seasonal_price: pricedItem?.seasonal_price,
    seasonal_adjustment: pricedItem?.seasonal_adjustment,
    promo_discount: pricedItem?.promo_discount,
    final_subtotal: pricedItem?.final_subtotal,
    pricing_notes: pricedItem?.pricing_notes?.length
      ? JSON.stringify(pricedItem.pricing_notes)
      : null,
  };

  Object.entries(mapping).forEach(([field, value]) => {
    if (columnSet.has(field)) {
      fields.push(field);
      values.push(value);
    }
  });

  return { fields, values };
}
