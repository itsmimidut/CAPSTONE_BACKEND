import db from '../config/db.js';

const CHILD_EXTRA_RATE = 500;
const ADULT_EXTRA_RATE = 1000;
const SENIOR_EXTRA_RATE = 1000;

export const calculateExtraPersonFee = ({
  adults = 0,
  children = 0,
  seniors = 0,
  infants = 0,
  capacity = 0,
} = {}) => {
  const counts = {
    adults: Math.max(0, Number(adults || 0)),
    children: Math.max(0, Number(children || 0)),
    seniors: Math.max(0, Number(seniors || 0)),
    infants: Math.max(0, Number(infants || 0)),
  };
  const totalGuests = counts.adults + counts.children + counts.seniors + counts.infants;
  let remainingExtras = Math.max(0, totalGuests - Math.max(0, Number(capacity || 0)));
  const breakdown = {
    infants: { count: Math.min(counts.infants, remainingExtras), rate: 0, subtotal: 0 },
    children: { count: 0, rate: CHILD_EXTRA_RATE, subtotal: 0 },
    seniors: { count: 0, rate: SENIOR_EXTRA_RATE, subtotal: 0 },
    adults: { count: 0, rate: ADULT_EXTRA_RATE, subtotal: 0 },
  };

  remainingExtras -= breakdown.infants.count;
  for (const category of ['children', 'seniors', 'adults']) {
    const count = Math.min(counts[category], remainingExtras);
    breakdown[category].count = count;
    breakdown[category].subtotal = count * breakdown[category].rate;
    remainingExtras -= count;
  }

  return {
    extraPersonCount: Math.max(0, totalGuests - Math.max(0, Number(capacity || 0))),
    total: Object.values(breakdown).reduce((sum, row) => sum + row.subtotal, 0),
    breakdown,
  };
};

export const computeExtraPersonFeeForBookingItems = async ({
  items = [],
  connection = null,
} = {}) => {
  const conn = connection || db;
  let total = 0;
  const itemsBreakdown = [];

  for (const item of Array.isArray(items) ? items : []) {
    const bookingType = String(
      item.booking_type || item.bookingType || item.category_type || item.category || 'room'
    ).toLowerCase();
    if (!['room', 'cottage'].includes(bookingType)) continue;

    const itemId = Number(item.item_id || item.inventory_item_id || item.item?.item_id || item.item?.id);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;

    const [rows] = await conn.query(
      'SELECT max_guests FROM inventory_items WHERE item_id = ? LIMIT 1',
      [itemId],
    );
    const unitCapacity = Number(rows[0]?.max_guests || 0);
    const quantity = Math.max(1, Number(item.qty || item.quantity || 1));
    const nested = item.guest_breakdown || item.guestBreakdown || {};
    const result = calculateExtraPersonFee({
      adults: item.adults ?? nested.adults,
      children: item.children ?? nested.children,
      seniors: item.seniors ?? nested.seniors,
      infants: item.infants ?? nested.infants,
      capacity: unitCapacity * quantity,
    });

    total += result.total;
    itemsBreakdown.push({ itemId, capacity: unitCapacity * quantity, ...result });
  }

  return { success: true, total, items: itemsBreakdown };
};

