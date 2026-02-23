/**
 * ============================================================
 * POS (Point of Sale) Controller
 * ============================================================
 * 
 * Purpose:
 * - Manage POS transactions for walk-in payments
 * - Handle transaction history and receipts
 * - Provide items/services catalog for POS
 * 
 * Database Tables:
 * - pos_transactions: Store all POS transactions
 * - inventory_items: Catalog of services/items for sale
 * 
 * Features:
 * - Create and track transactions
 * - Transaction history management
 * - Multi-category item catalog (Restaurant, Rooms, Cottage, Events)
 */

import { db } from '../config/db.js';

const mapRestaurantItems = (rows) => rows.map(item => ({
    category: 'restaurant',
    name: item.name,
    price: parseFloat(item.price),
    description: item.description || 'Uncategorized',
    available: 1
}));

const fetchRestaurantItems = async () => {
    const [menuItems] = await db.query(
        `SELECT name, price, COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as description
         FROM menu_items
         WHERE available = 1
         ORDER BY name`
    );

    return mapRestaurantItems(menuItems);
};

// ============================================================
// GET ALL TRANSACTIONS
// ============================================================
/**
 * Handler: GET /api/pos/transactions
 * 
 * Purpose: Retrieve all POS transaction history
 * Response: Array of all transactions sorted by newest first
 */
export const getAllTransactions = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM pos_transactions ORDER BY created_at DESC'
        );

        // Parse items JSON string back to array
        const transactions = rows.map(row => ({
            ...row,
            items: JSON.parse(row.items || '[]')
        }));

        res.json(transactions);
    } catch (error) {
        console.error('Error fetching POS transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};

// ============================================================
// GET SINGLE TRANSACTION
// ============================================================
/**
 * Handler: GET /api/pos/transactions/:id
 * 
 * Purpose: Retrieve a specific transaction by ID
 * Params: id - Transaction ID
 */
export const getTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM pos_transactions WHERE transaction_id = ?',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const transaction = {
            ...rows[0],
            items: JSON.parse(rows[0].items || '[]')
        };

        res.json(transaction);
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Failed to fetch transaction' });
    }
};

// ============================================================
// CREATE NEW TRANSACTION
// ============================================================
/**
 * Handler: POST /api/pos/transactions
 * 
 * Purpose: Create a new POS transaction WITH INVENTORY DEDUCTION
 * 
 * Request Body:
 * {
 *   receiptNo: string,
 *   items: Array<{name: string, price: number, menu_id?: number, quantity?: number}>,
 *   type: string (e.g., "Walk-in"),
 *   payment: string (e.g., "Cash", "GCash"),
 *   total: number,
 *   date: string,
 *   time: string
 * }
 */
export const createTransaction = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const {
            receiptNo,
            items,
            type,
            payment,
            total,
            date,
            time,
            receipt_no,
            payment_method,
            total_amount,
            transaction_date,
            transaction_time
        } = req.body;

        const normalizedReceiptNo = receiptNo ?? receipt_no;
        const normalizedItems = items;
        const normalizedPayment = payment ?? payment_method;
        const normalizedTotal = total ?? total_amount;
        const normalizedDate = date ?? transaction_date;
        const normalizedTime = time ?? transaction_time;

        // Validate required fields
        if (!normalizedReceiptNo || !normalizedItems || !normalizedPayment || normalizedTotal === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: receiptNo, items, payment, total'
            });
        }

        // Start transaction for atomicity
        await connection.beginTransaction();

        // Deduct inventory for items that have menu_id
        for (const item of normalizedItems) {
            let menuId = item.menu_id;

            // If no menu_id provided, try to find by name
            if (!menuId && item.name) {
                const [menuResult] = await connection.query(
                    'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 1',
                    [item.name]
                );
                menuId = menuResult?.[0]?.menu_id;
            }

            // If we found a menu item, deduct its ingredients
            if (menuId) {
                const [ingredients] = await connection.query(`
                    SELECT inventory_id, quantity_needed
                    FROM menu_ingredients
                    WHERE menu_id = ?
                `, [menuId]);

                const quantity = item.quantity || 1;

                // Deduct each ingredient
                for (const ingredient of ingredients) {
                    const deductAmount = ingredient.quantity_needed * quantity;

                    await connection.query(`
                        UPDATE inventory 
                        SET quantity = quantity - ?,
                            status = CASE
                                WHEN (quantity - ?) <= threshold * 0.25 THEN 'critical'
                                WHEN (quantity - ?) <= threshold THEN 'low'
                                ELSE 'good'
                            END,
                            updated_at = NOW()
                        WHERE inventory_id = ?
                    `, [deductAmount, deductAmount, deductAmount, ingredient.inventory_id]);
                }
            }
        }

        // Convert items array to JSON string for storage
        const itemsJson = JSON.stringify(normalizedItems);

        const [result] = await connection.query(
            `INSERT INTO pos_transactions 
            (receipt_no, items, payment_method, total_amount, transaction_date, transaction_time) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                normalizedReceiptNo,
                itemsJson,
                normalizedPayment,
                normalizedTotal,
                normalizedDate,
                normalizedTime
            ]
        );

        // Commit the transaction
        await connection.commit();

        res.status(201).json({
            message: 'Transaction created successfully with inventory deduction',
            transactionId: result.insertId,
            receiptNo: normalizedReceiptNo
        });
    } catch (error) {
        // Rollback on error
        await connection.rollback();
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Failed to create transaction', details: error.message });
    } finally {
        connection.release();
    }
};

// ============================================================
// DELETE TRANSACTION
// ============================================================
/**
 * Handler: DELETE /api/pos/transactions/:id
 * 
 * Purpose: Delete a specific transaction
 * Params: id - Transaction ID
 */
export const deleteTransaction = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            'DELETE FROM pos_transactions WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
};

// ============================================================
// CLEAR ALL TRANSACTIONS
// ============================================================
/**
 * Handler: DELETE /api/pos/transactions
 * 
 * Purpose: Delete all transaction history
 */
export const clearAllTransactions = async (req, res) => {
    try {
        await db.query('DELETE FROM pos_transactions');
        res.json({ message: 'All transactions cleared successfully' });
    } catch (error) {
        console.error('Error clearing transactions:', error);
        res.status(500).json({ error: 'Failed to clear transactions' });
    }
};

// ============================================================
// CREATE E-SHOP ORDER
// ============================================================
/**
 * Handler: POST /api/pos/eshop/order
 * 
 * Purpose: Create a new e-shop order with delivery location
 * 
 * Request Body:
 * {
 *   cart: Array<{name: string, price: number, qty: number}>,
 *   locationType: string ("Room", "Cottage", "Day Guest"),
 *   locationNumber: string (optional for Day Guest),
 *   deliveryNotes: string (optional),
 *   totalAmount: number,
 *   customerId: number (optional - if user is logged in)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   orderId: number,
 *   receiptNo: string,
 *   message: string
 * }
 */
export const createEshopOrder = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const {
            cart,
            locationType,
            locationNumber,
            deliveryNotes,
            totalAmount,
            customerId
        } = req.body;

        // Validate required fields
        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({
                error: 'Cart is required and must contain at least one item'
            });
        }

        if (!locationType) {
            return res.status(400).json({
                error: 'Location type is required (Room, Cottage, or Day Guest)'
            });
        }

        if (locationType !== 'Day Guest' && !locationNumber) {
            return res.status(400).json({
                error: `Location number is required for ${locationType}`
            });
        }

        if (totalAmount === undefined || totalAmount <= 0) {
            return res.status(400).json({
                error: 'Total amount is required and must be greater than 0'
            });
        }

        // Generate unique receipt number: ESHOP-YYYYMMDD-####
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        const receiptNo = `ESHOP-${dateStr}-${randomNum}`;

        // Start transaction for atomicity
        await connection.beginTransaction();

        // Deduct inventory for restaurant items
        for (const item of cart) {
            // Try to find menu item by name
            const [menuResult] = await connection.query(
                'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 1',
                [item.name]
            );

            const menuId = menuResult?.[0]?.menu_id;

            // If we found a menu item, deduct its ingredients
            if (menuId) {
                const [ingredients] = await connection.query(`
                    SELECT inventory_id, quantity_needed
                    FROM menu_ingredients
                    WHERE menu_id = ?
                `, [menuId]);

                const quantity = item.qty || 1;

                // Deduct each ingredient
                for (const ingredient of ingredients) {
                    const deductAmount = ingredient.quantity_needed * quantity;

                    await connection.query(`
                        UPDATE inventory 
                        SET quantity = quantity - ?,
                            status = CASE
                                WHEN (quantity - ?) <= threshold * 0.25 THEN 'critical'
                                WHEN (quantity - ?) <= threshold THEN 'low'
                                ELSE 'good'
                            END,
                            updated_at = NOW()
                        WHERE inventory_id = ?
                    `, [deductAmount, deductAmount, deductAmount, ingredient.inventory_id]);
                }
            }
        }

        // Format items for storage
        const itemsFormatted = cart.map(item => ({
            name: item.name,
            price: parseFloat(item.price),
            quantity: item.qty,
            subtotal: parseFloat(item.price) * item.qty
        }));

        const itemsJson = JSON.stringify(itemsFormatted);

        // Get current date and time
        const transactionDate = now.toISOString().split('T')[0];
        const transactionTime = now.toTimeString().split(' ')[0];

        // Insert order into pos_transactions
        const [result] = await connection.query(
            `INSERT INTO pos_transactions 
            (receipt_no, items, type, payment_method, total_amount, transaction_date, transaction_time, 
             location_type, location_number, delivery_notes, customer_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                receiptNo,
                itemsJson,
                'E-Shop',
                'Cash on Delivery',
                totalAmount,
                transactionDate,
                transactionTime,
                locationType,
                locationNumber || null,
                deliveryNotes || null,
                customerId || null
            ]
        );

        // Commit the transaction
        await connection.commit();

        res.status(201).json({
            success: true,
            orderId: result.insertId,
            receiptNo: receiptNo,
            message: 'Order placed successfully! Your food will be delivered in 30-45 minutes.',
            estimatedDelivery: '30-45 minutes',
            deliveryLocation: locationType === 'Day Guest'
                ? 'Day Guest Area'
                : `${locationType} ${locationNumber}`
        });
    } catch (error) {
        // Rollback on error
        await connection.rollback();
        console.error('Error creating e-shop order:', error);
        res.status(500).json({
            error: 'Failed to create order',
            details: error.message
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// GET ALL ITEMS/SERVICES
// ============================================================
/**
 * Handler: GET /api/pos/items
 * 
 * Purpose: Retrieve all available items/services for POS
 * Response: Combined data from menu_items and inventory_items tables
 */
export const getAllItems = async (req, res) => {
    try {
        let allItems = [];

        console.log('🔍 Fetching POS items...');

        // Get restaurant items from menu_items table
        try {
            const restaurantItems = await fetchRestaurantItems();

            console.log('🍔 Found', restaurantItems.length, 'restaurant items from menu_items category');

            allItems.push(...restaurantItems);
        } catch (menuError) {
            console.log('⚠️ menu_items table not found, using pos_items for restaurant');
        }

        // Get rooms and cottages from inventory_items table
        try {
            const [inventoryItems] = await db.query(
                `SELECT name, price, category, category_type 
                 FROM inventory_items 
                 WHERE status = 'Available' AND (category LIKE '%Room%' OR category = 'Cottage')`
            );

            console.log('🏨 Found', inventoryItems.length, 'inventory items (rooms/cottages)');
            console.log('🏨 Inventory items:', inventoryItems);

            // Format rooms (any category containing "Room")
            const rooms = inventoryItems
                .filter(item => item.category && item.category.toLowerCase().includes('room'))
                .map(item => ({
                    category: 'rooms',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

            console.log('🛏️ Formatted', rooms.length, 'rooms');

            // Format cottages
            const cottages = inventoryItems
                .filter(item => item.category && item.category.toLowerCase().includes('cottage'))
                .map(item => ({
                    category: 'cottage',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

            console.log('🏡 Formatted', cottages.length, 'cottages');

            allItems.push(...rooms, ...cottages);
        } catch (inventoryError) {
            console.log('⚠️ inventory_items table not found, using pos_items for rooms/cottages');
            console.error('Inventory error:', inventoryError.message);
        }

        // Get event items from inventory_items
        const [eventItems] = await db.query(
            `SELECT name, price, category, category_type 
             FROM inventory_items 
             WHERE status = 'Available' AND category = 'Event'`
        );

        const formattedEventItems = eventItems.map(item => ({
            category: 'event',
            name: item.name,
            price: parseFloat(item.price),
            description: item.category_type,
            available: 1
        }));

        console.log('🎉 Found', formattedEventItems.length, 'event items from inventory_items');

        allItems.push(...formattedEventItems);

        console.log('✅ Total items to return:', allItems.length);
        console.log('📋 Items by category:', {
            restaurant: allItems.filter(i => i.category === 'restaurant').length,
            rooms: allItems.filter(i => i.category === 'rooms').length,
            cottage: allItems.filter(i => i.category === 'cottage').length,
            event: allItems.filter(i => i.category === 'event').length
        });

        res.json(allItems);
    } catch (error) {
        console.error('Error fetching POS items:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};

// ============================================================
// GET ITEMS BY CATEGORY
// ============================================================
/**
 * Handler: GET /api/pos/items/category/:category
 * 
 * Purpose: Retrieve items for a specific category from system tables
 */
export const getItemsByCategory = async (req, res) => {
    try {
        const { category } = req.params;

        // Restaurant items from menu_items table
        if (category === 'restaurant') {
            try {
                const restaurantItems = await fetchRestaurantItems();
                return res.json(restaurantItems);
            } catch (error) {
                console.log('Using pos_items for restaurant');
            }
        }

        // Rooms from inventory_items table
        if (category === 'rooms') {
            try {
                const [roomItems] = await db.query(
                    `SELECT name, price, category_type 
                     FROM inventory_items 
                     WHERE status = 'Available' AND category = 'Room' 
                     ORDER BY name`
                );

                const items = roomItems.map(item => ({
                    category: 'rooms',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

                return res.json(items);
            } catch (error) {
                console.log('Using pos_items for rooms');
            }
        }

        // Cottages from inventory_items table
        if (category === 'cottage') {
            try {
                const [cottageItems] = await db.query(
                    `SELECT name, price, category_type 
                     FROM inventory_items 
                     WHERE status = 'Available' AND category = 'Cottage' 
                     ORDER BY name`
                );

                const items = cottageItems.map(item => ({
                    category: 'cottage',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));

                return res.json(items);
            } catch (error) {
                console.log('Using pos_items for cottages');
            }
        }

        // Fallback to inventory_items for any category
        const [rows] = await db.query(
            `SELECT name, price, category, category_type 
             FROM inventory_items 
             WHERE status = 'Available' AND category = ? 
             ORDER BY name`,
            [category]
        );

        const items = rows.map(item => ({
            category: category.toLowerCase(),
            name: item.name,
            price: parseFloat(item.price),
            description: item.category_type,
            available: 1
        }));

        res.json(items);
    } catch (error) {
        console.error('Error fetching items by category:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};
