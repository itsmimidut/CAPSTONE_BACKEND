export const BOOKING_ITEM_TYPES = Object.freeze({
  ROOM: 'Room',
  COTTAGE: 'Cottage',
  EVENT: 'Event',
  SWIMMING: 'Swimming',
});

const TYPE_ALIASES = new Map([
  ['room', BOOKING_ITEM_TYPES.ROOM],
  ['rooms', BOOKING_ITEM_TYPES.ROOM],
  ['accommodation', BOOKING_ITEM_TYPES.ROOM],
  ['cottage', BOOKING_ITEM_TYPES.COTTAGE],
  ['cottages', BOOKING_ITEM_TYPES.COTTAGE],
  ['event', BOOKING_ITEM_TYPES.EVENT],
  ['events', BOOKING_ITEM_TYPES.EVENT],
  ['event area', BOOKING_ITEM_TYPES.EVENT],
  ['venue', BOOKING_ITEM_TYPES.EVENT],
  ['swimming', BOOKING_ITEM_TYPES.SWIMMING],
  ['swim', BOOKING_ITEM_TYPES.SWIMMING],
  ['pool', BOOKING_ITEM_TYPES.SWIMMING],
]);

const normalizedKey = (value) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

export const normalizeBookingItemType = (value, { bookingType, itemName, fallback = null } = {}) => {
  for (const candidate of [value, bookingType, fallback]) {
    const normalized = TYPE_ALIASES.get(normalizedKey(candidate));
    if (normalized) return normalized;
  }

  const name = normalizedKey(itemName);
  if (/\broom\b/.test(name)) return BOOKING_ITEM_TYPES.ROOM;
  if (/\bcottage\b/.test(name)) return BOOKING_ITEM_TYPES.COTTAGE;
  if (/\b(swimming|swim|pool)\b/.test(name)) return BOOKING_ITEM_TYPES.SWIMMING;
  if (/\b(event|hall|venue)\b/.test(name)) return BOOKING_ITEM_TYPES.EVENT;
  return null;
};

export const requireBookingItemType = (value, context = {}) => {
  const normalized = normalizeBookingItemType(value, context);
  if (!normalized) {
    const error = new Error(`Unsupported booking item type: ${String(value || context.bookingType || '').trim() || 'blank'}`);
    error.code = 'INVALID_BOOKING_ITEM_TYPE';
    throw error;
  }
  return normalized;
};
