import { db } from '../config/db.js';
import { POS_PAYMENT_STATUS } from '../utils/paymentStatuses.js';
import { logSystemEvent } from '../utils/logger.js';

let inventoryColumnsCache = null;

const getInventoryColumns = async (executor) => {
    if (inventoryColumnsCache) return inventoryColumnsCache;
    const [rows] = await executor.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory'`
    );
    inventoryColumnsCache = new Set(rows.map((row) => row.COLUMN_NAME));
    return inventoryColumnsCache;
};

const computeStatus = (quantity, reorderLevel) => {
    const qty = Number(quantity || 0);
    const reorder = Math.max(0, Number(reorderLevel || 0));
    if (qty <= 0) return 'critical';
    if (qty <= reorder) return 'low';
    return 'good';
};

const parseItems = (transaction) => {
    if (!transaction?.items) return [];
    if (Array.isArray(transaction.items)) return transaction.items;
    try {
        const parsed = JSON.parse(transaction.items);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const deductMenuIngredients = async (connection, menuId, quantity) => {
    const [ingredients] = await connection.query(
        `SELECT inventory_id, quantity_needed
         FROM menu_ingredients
         WHERE menu_id = ?`,
        [menuId]
    );

    const columns = await getInventoryColumns(connection);
    const reorderExpr = columns.has('reorder_level')
        ? 'COALESCE(reorder_level, threshold)'
        : 'threshold';

    for (const ingredient of ingredients) {
        const deductAmount = Number(ingredient.quantity_needed || 0) * Number(quantity || 1);
        if (deductAmount <= 0) continue;

        const [rows] = await connection.query(
            `SELECT inventory_id, quantity, ${reorderExpr} AS reorder_level
             FROM inventory
             WHERE inventory_id = ?
             LIMIT 1`,
            [ingredient.inventory_id]
        );
        const inv = rows[0];
        if (!inv) continue;
        const nextQty = Number(inv.quantity || 0) - deductAmount;
        const nextStatus = computeStatus(nextQty, inv.reorder_level);

        await connection.query(
            `UPDATE inventory
             SET quantity = ?,
                 status = ?,
                 updated_at = NOW()
             WHERE inventory_id = ?`,
            [nextQty, nextStatus, ingredient.inventory_id]
        );
    }
};

const restoreMenuIngredients = async (connection, menuId, quantity) => {
    const [ingredients] = await connection.query(
        `SELECT inventory_id, quantity_needed
         FROM menu_ingredients
         WHERE menu_id = ?`,
        [menuId]
    );

    const columns = await getInventoryColumns(connection);
    const reorderExpr = columns.has('reorder_level')
        ? 'COALESCE(reorder_level, threshold)'
        : 'threshold';

    for (const ingredient of ingredients) {
        const restoreAmount = Number(ingredient.quantity_needed || 0) * Number(quantity || 1);
        if (restoreAmount <= 0) continue;

        const [rows] = await connection.query(
            `SELECT inventory_id, quantity, ${reorderExpr} AS reorder_level
             FROM inventory
             WHERE inventory_id = ?
             LIMIT 1`,
            [ingredient.inventory_id]
        );
        const inv = rows[0];
        if (!inv) continue;
        const nextQty = Number(inv.quantity || 0) + restoreAmount;
        const nextStatus = computeStatus(nextQty, inv.reorder_level);

        await connection.query(
            `UPDATE inventory
             SET quantity = ?,
                 status = ?,
                 updated_at = NOW()
             WHERE inventory_id = ?`,
            [nextQty, nextStatus, ingredient.inventory_id]
        );
    }
};

const resolveMenuIdFromItem = async (connection, item) => {
    const directId = item.menu_id || item.menuId || item.item_id;
    if (directId) return Number(directId);

    const name = String(item.name || item.item_name || '').trim();
    if (!name) return null;
    const [rows] = await connection.query(
        'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 1',
        [name]
    );
    return rows[0]?.menu_id ? Number(rows[0].menu_id) : null;
};

export const applyInventoryDeduction = async (connection, transactionOrId, pricedItems = null) => {
    const executor = connection?.query ? connection : db;
    let transaction = transactionOrId;
    let items = pricedItems;

    if (typeof transactionOrId === 'number' || typeof transactionOrId === 'string') {
        const [rows] = await executor.query(
            'SELECT * FROM pos_transactions WHERE id = ? LIMIT 1',
            [transactionOrId]
        );
        transaction = rows[0];
        items = parseItems(transaction);
    }

    if (!transaction) {
        throw new Error('Transaction not found for inventory deduction');
    }

    if (transaction.payment_status === POS_PAYMENT_STATUS.PENDING) {
        throw new Error('Inventory cannot be deducted while payment is pending');
    }

    if (Number(transaction.payment_processed) === 1 && !pricedItems) {
        return { skipped: true, reason: 'already_processed' };
    }

    const lines = items || parseItems(transaction);
    let appliedLines = 0;
    let skippedLines = 0;

    for (const item of lines) {
        const menuId = await resolveMenuIdFromItem(connection, item);
        if (!menuId) {
            skippedLines += 1;
            continue;
        }
        const quantity = Number(item.quantity ?? item.qty ?? 1);
        await deductMenuIngredients(connection, menuId, quantity);
        appliedLines += 1;
    }

    logSystemEvent('INVENTORY_DEDUCTION_RESULT', {
        receipt_no: transaction.receipt_no || null,
        transaction_id: transaction.id || null,
        applied_lines: appliedLines,
        skipped_lines: skippedLines,
        total_lines: lines.length,
    }, 'info');

    return { applied: true, lineCount: lines.length, appliedLines, skippedLines };
};

export const restoreInventory = async (connection, transactionOrId) => {
    const executor = connection?.query ? connection : db;
    let transaction = transactionOrId;

    if (typeof transactionOrId === 'number' || typeof transactionOrId === 'string') {
        const [rows] = await executor.query(
            'SELECT * FROM pos_transactions WHERE id = ? LIMIT 1',
            [transactionOrId]
        );
        transaction = rows[0];
    }

    if (!transaction) {
        throw new Error('Transaction not found for inventory restore');
    }

    const lines = parseItems(transaction);
    let restoredLines = 0;
    let skippedLines = 0;

    for (const item of lines) {
        const menuId = await resolveMenuIdFromItem(connection, item);
        if (!menuId) {
            skippedLines += 1;
            continue;
        }
        const quantity = Number(item.quantity ?? item.qty ?? 1);
        await restoreMenuIngredients(connection, menuId, quantity);
        restoredLines += 1;
    }

    logSystemEvent('INVENTORY_RESTORE_RESULT', {
        receipt_no: transaction.receipt_no || null,
        transaction_id: transaction.id || null,
        restored_lines: restoredLines,
        skipped_lines: skippedLines,
        total_lines: lines.length,
    }, 'info');

    return { restored: true, lineCount: lines.length, restoredLines, skippedLines };
};
