export class PosTransactionItemValidationError extends Error {
    constructor(message, { lineNumber = null, code = 'INVALID_TRANSACTION_ITEM' } = {}) {
        super(message);
        this.name = 'PosTransactionItemValidationError';
        this.code = code;
        this.lineNumber = lineNumber;
    }
}

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const finiteMoney = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
};

const positiveInteger = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
};

const nullablePositiveInteger = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    return positiveInteger(value);
};

export const normalizePosTransactionItem = (item, index) => {
    const lineNumber = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PosTransactionItemValidationError('Item must be an object', { lineNumber });
    }

    const productNameSnapshot = String(firstDefined(
        item.product_name_snapshot,
        item.productName,
        item.product_name,
        item.name,
        item.item_name,
    ) ?? '').trim();
    if (!productNameSnapshot) {
        throw new PosTransactionItemValidationError('Product name is required', {
            lineNumber,
            code: 'MISSING_PRODUCT_NAME',
        });
    }

    const quantity = positiveInteger(firstDefined(item.quantity, item.qty, 1));
    if (!quantity) {
        throw new PosTransactionItemValidationError('Quantity must be a positive integer', {
            lineNumber,
            code: 'INVALID_QUANTITY',
        });
    }

    const unitPriceSnapshot = finiteMoney(firstDefined(
        item.unit_price_snapshot,
        item.unitPrice,
        item.unit_price,
        item.price,
    ));
    if (unitPriceSnapshot === null || unitPriceSnapshot < 0) {
        throw new PosTransactionItemValidationError('Unit price must be a non-negative number', {
            lineNumber,
            code: 'INVALID_UNIT_PRICE',
        });
    }

    const rawLineTotal = firstDefined(
        item.line_total_snapshot,
        item.lineTotal,
        item.line_total,
        item.subtotal,
    );
    const lineTotalSnapshot = rawLineTotal === undefined || rawLineTotal === null || rawLineTotal === ''
        ? null
        : finiteMoney(rawLineTotal);
    if (rawLineTotal !== undefined && rawLineTotal !== null && rawLineTotal !== ''
        && (lineTotalSnapshot === null || lineTotalSnapshot < 0)) {
        throw new PosTransactionItemValidationError('Line total must be a non-negative number', {
            lineNumber,
            code: 'INVALID_LINE_TOTAL',
        });
    }

    const rawMenuId = firstDefined(item.menu_id, item.menuItemId, item.product_id, item.id);
    const menuId = nullablePositiveInteger(rawMenuId);
    const modifiersSnapshot = firstDefined(
        item.modifiers_snapshot,
        item.modifiers,
        item.customization,
        item.addons,
        null,
    );

    return {
        lineNumber,
        menuId,
        productNameSnapshot,
        unitPriceSnapshot,
        quantity,
        modifiersSnapshot,
        lineTotalSnapshot: lineTotalSnapshot ?? Math.round(unitPriceSnapshot * quantity * 100) / 100,
        imageUrlSnapshot: String(firstDefined(item.image_url_snapshot, item.image_url, item.image, '') ?? '').trim(),
        bookingReference: firstDefined(item.bookingReference, item.booking_reference, null),
    };
};

export const normalizePosTransactionItems = (items) => {
    if (!Array.isArray(items)) {
        throw new PosTransactionItemValidationError('Items payload must be an array', {
            code: 'INVALID_ITEMS_PAYLOAD',
        });
    }
    if (items.length === 0) {
        throw new PosTransactionItemValidationError('At least one item is required', {
            code: 'EMPTY_ITEMS_PAYLOAD',
        });
    }
    return items.map(normalizePosTransactionItem);
};

/**
 * Resolve menu_id by exact unique product name when the cart/order line omitted it.
 * Returns null when missing or ambiguous (duplicate names).
 */
export const resolveMenuIdByProductName = async (executor, productName) => {
    const name = String(productName || '').trim();
    if (!name) return null;
    const [rows] = await executor.query(
        'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 2',
        [name],
    );
    if (!rows.length || rows.length > 1) return null;
    return Number(rows[0].menu_id) || null;
};

export const insertNormalizedPosTransactionItems = async (
    connection,
    { transactionId, receiptNo, items, ignoreExisting = false },
) => {
    const normalizedItems = normalizePosTransactionItems(items);
    const insertPrefix = ignoreExisting ? 'INSERT IGNORE' : 'INSERT';

    for (const item of normalizedItems) {
        const menuId = item.menuId
            ?? await resolveMenuIdByProductName(connection, item.productNameSnapshot);

        await connection.query(
            `${insertPrefix} INTO pos_transaction_items (
                transaction_id,
                receipt_no,
                item_name,
                menu_id,
                quantity,
                unit_price,
                line_total,
                booking_reference,
                line_number,
                product_name_snapshot,
                unit_price_snapshot,
                modifiers_snapshot,
                line_total_snapshot,
                image_url_snapshot
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                transactionId,
                receiptNo,
                item.productNameSnapshot,
                menuId,
                item.quantity,
                item.unitPriceSnapshot,
                item.lineTotalSnapshot,
                item.bookingReference,
                item.lineNumber,
                item.productNameSnapshot,
                item.unitPriceSnapshot,
                item.modifiersSnapshot === null ? null : JSON.stringify(item.modifiersSnapshot),
                item.lineTotalSnapshot,
                item.imageUrlSnapshot || null,
            ],
        );
        item.menuId = menuId;
    }

    return normalizedItems;
};
