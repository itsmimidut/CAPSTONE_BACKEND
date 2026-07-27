import { db } from '../config/db.js';

export class PosPricingError extends Error {
    constructor(message, code = 'POS_PRICING_ERROR') {
        super(message);
        this.name = 'PosPricingError';
        this.code = code;
        this.statusCode = 400;
    }
}

const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const normalizeKey = (value) =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const resolveMenuId = (item) => {
    const raw = item?.id ?? item?.menu_id ?? item?.menuId ?? null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const resolveQuantity = (item) => {
    const qty = Number(item?.quantity ?? item?.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new PosPricingError('Quantity must be greater than 0');
    }
    return qty;
};

const getAddOnIds = (customization = {}) => {
    if (Array.isArray(customization.addOnIds)) {
        return customization.addOnIds.map((id) => normalizeKey(id)).filter(Boolean);
    }
    if (Array.isArray(customization.addOns)) {
        return customization.addOns
            .map((addon) => normalizeKey(addon?.id ?? addon?.name))
            .filter(Boolean);
    }
    return [];
};

const resolveUnitPrice = (menuRow, customization = null) => {
    const basePrice = Number(menuRow.price || 0);
    if (!customization) return basePrice;

    const sizes = parseJsonArray(menuRow.sizes).map((size, index) => ({
        id: normalizeKey(size?.id ?? size?.label ?? size?.name ?? `size-${index + 1}`),
        priceDelta: Number(size?.priceDelta ?? size?.price ?? 0),
    }));
    const addons = parseJsonArray(menuRow.addons).map((addon, index) => ({
        id: normalizeKey(addon?.id ?? addon?.name ?? addon?.label ?? `addon-${index + 1}`),
        price: Number(addon?.price ?? addon?.amount ?? 0),
    }));

    const sizeId = customization.sizeId ? normalizeKey(customization.sizeId) : '';
    const selectedSize = sizeId ? sizes.find((size) => size.id === sizeId) : null;
    const sizePrice = selectedSize ? Number(selectedSize.priceDelta || 0) : 0;

    const addOnsExtra = getAddOnIds(customization).reduce((sum, addonId) => {
        const addon = addons.find((entry) => entry.id === addonId);
        return sum + (addon ? Number(addon.price || 0) : 0);
    }, 0);

    if (customization.sizeId) {
        return roundMoney((sizePrice || basePrice) + addOnsExtra);
    }

    return roundMoney(basePrice + addOnsExtra);
};

const fetchMenuItem = async (connection, menuId) => {
    const executor = connection?.query ? connection : db;
    const [columnRows] = await executor.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'menu_items'
           AND COLUMN_NAME IN ('sizes', 'addons')`
    );
    const columnSet = new Set(columnRows.map((row) => row.COLUMN_NAME));
    const selectColumns = ['menu_id', 'name', 'price', 'available'];
    if (columnSet.has('sizes')) selectColumns.push('sizes');
    if (columnSet.has('addons')) selectColumns.push('addons');

    const [rows] = await executor.query(
        `SELECT ${selectColumns.join(', ')}
         FROM menu_items
         WHERE menu_id = ?
         LIMIT 1`,
        [menuId]
    );

    return rows[0] || null;
};

const priceMenuLine = async (connection, rawItem) => {
    const menuId = resolveMenuId(rawItem);
    if (!menuId) {
        throw new PosPricingError('Each menu item must include a valid id');
    }

    const quantity = resolveQuantity(rawItem);
    const menuRow = await fetchMenuItem(connection, menuId);

    if (!menuRow) {
        throw new PosPricingError(`Menu item not found: ${menuId}`);
    }

    if (Number(menuRow.available) !== 1) {
        throw new PosPricingError(`Menu item is not available: ${menuRow.name}`);
    }

    const unitPrice = resolveUnitPrice(menuRow, rawItem.customization || null);
    const lineTotal = roundMoney(unitPrice * quantity);

    return {
        menu_id: menuId,
        name: menuRow.name,
        quantity,
        qty: quantity,
        unitPrice,
        price: lineTotal,
        customization: rawItem.customization || null,
    };
};

const priceBookingLine = async (connection, rawItem) => {
    const bookingId = Number(rawItem?.bookingId ?? rawItem?.booking_id ?? 0);
    const bookingReference = String(rawItem?.bookingReference ?? rawItem?.booking_reference ?? '').trim();

    if (!bookingId && !bookingReference) {
        throw new PosPricingError('Booking line items require bookingId or bookingReference');
    }

    const executor = connection?.query ? connection : db;
    const [rows] = bookingId
        ? await executor.query(
              `SELECT booking_id, booking_reference, total, booking_status
               FROM bookings
               WHERE booking_id = ?
               LIMIT 1`,
              [bookingId]
          )
        : await executor.query(
              `SELECT booking_id, booking_reference, total, booking_status
               FROM bookings
               WHERE booking_reference = ?
               LIMIT 1`,
              [bookingReference]
          );

    const booking = rows[0];
    if (!booking) {
        throw new PosPricingError('Booking not found for checkout line item');
    }

    const lineTotal = roundMoney(booking.total);
    if (lineTotal <= 0) {
        throw new PosPricingError(`Booking ${booking.booking_reference} has an invalid total`);
    }

    return {
        bookingId: booking.booking_id,
        bookingReference: booking.booking_reference,
        name: rawItem.name || `Booking ${booking.booking_reference}`,
        quantity: 1,
        qty: 1,
        unitPrice: lineTotal,
        price: lineTotal,
        isBooking: true,
    };
};

const isBookingLine = (item) =>
    Boolean(item?.bookingId || item?.booking_id || item?.bookingReference || item?.booking_reference || item?.isBooking);

/**
 * Recalculate POS transaction totals from trusted database sources.
 * Client-supplied price, subtotal, discount, and total fields are ignored.
 */
export const calculateTransactionTotal = async (rawItems, connection = null) => {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new PosPricingError('At least one item is required');
    }

    const pricedItems = [];
    let totalAmount = 0;

    for (const rawItem of rawItems) {
        const pricedLine = isBookingLine(rawItem)
            ? await priceBookingLine(connection, rawItem)
            : await priceMenuLine(connection, rawItem);

        pricedItems.push(pricedLine);
        totalAmount += pricedLine.price;
    }

    return {
        items: pricedItems,
        totalAmount: roundMoney(totalAmount),
    };
};
