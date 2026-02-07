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
 * - pos_items: Catalog of services/items for sale
 * 
 * Features:
 * - Create and track transactions
 * - Transaction history management
 * - Multi-category item catalog (Restaurant, Rooms, Cottage, Events)
 */

import { db } from '../config/db.js';

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
 * Purpose: Create a new POS transaction
 * 
 * Request Body:
 * {
 *   receiptNo: string,
 *   items: Array<{name: string, price: number}>,
 *   type: string (e.g., "Walk-in"),
 *   payment: string (e.g., "Cash", "GCash"),
 *   total: number,
 *   date: string,
 *   time: string
 * }
 */
export const createTransaction = async (req, res) => {
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
        
        // Convert items array to JSON string for storage
        const itemsJson = JSON.stringify(normalizedItems);
        
        const [result] = await db.query(
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
        
        res.status(201).json({
            message: 'Transaction created successfully',
            transactionId: result.insertId,
            receiptNo: normalizedReceiptNo
        });
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Failed to create transaction' });
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
            'DELETE FROM pos_transactions WHERE transaction_id = ?',
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
        
        // Get restaurant items from menu_items table
        try {
            const [menuItems] = await db.query(
                'SELECT name, price, category as description FROM menu_items WHERE available = 1'
            );
            
            const restaurantItems = menuItems.map(item => ({
                category: 'restaurant',
                name: item.name,
                price: parseFloat(item.price),
                description: item.description,
                available: 1
            }));
            
            allItems.push(...restaurantItems);
        } catch (menuError) {
            console.log('menu_items table not found, using pos_items for restaurant');
        }
        
        // Get rooms and cottages from inventory_items table
        try {
            const [inventoryItems] = await db.query(
                `SELECT name, price, category, category_type 
                 FROM inventory_items 
                 WHERE status = 'Available' AND category IN ('Room', 'Cottage')`
            );
            
            // Format rooms
            const rooms = inventoryItems
                .filter(item => item.category === 'Room')
                .map(item => ({
                    category: 'rooms',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));
            
            // Format cottages
            const cottages = inventoryItems
                .filter(item => item.category === 'Cottage')
                .map(item => ({
                    category: 'cottage',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.category_type,
                    available: 1
                }));
            
            allItems.push(...rooms, ...cottages);
        } catch (inventoryError) {
            console.log('inventory_items table not found, using pos_items for rooms/cottages');
        }
        
        // Get event items from pos_items (or add Events table later)
        const [eventItems] = await db.query(
            'SELECT * FROM pos_items WHERE category = "event" AND available = 1'
        );
        allItems.push(...eventItems);
        
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
                const [menuItems] = await db.query(
                    'SELECT name, price, category as description FROM menu_items WHERE available = 1 ORDER BY name'
                );
                
                const items = menuItems.map(item => ({
                    category: 'restaurant',
                    name: item.name,
                    price: parseFloat(item.price),
                    description: item.description,
                    available: 1
                }));
                
                return res.json(items);
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
        
        // Fallback to pos_items for any category
        const [rows] = await db.query(
            'SELECT * FROM pos_items WHERE category = ? AND available = 1 ORDER BY name',
            [category]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching items by category:', error);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
};
