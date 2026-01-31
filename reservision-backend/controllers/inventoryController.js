/**
 * ============================================================
 * INVENTORY CONTROLLER
 * ============================================================
 * 
 * PURPOSE:
 * - Manage restaurant inventory items (food, supplies, ingredients)
 * - Track stock levels and alert when items are low
 * - Handle CRUD operations for inventory management
 * - Calculate status based on quantity thresholds
 * 
 * DATABASE TABLE: inventory
 * - inventory_id: Primary key (auto-increment)
 * - item_name: Name of inventory item (UNIQUE)
 * - quantity: Current stock quantity (decimal)
 * - unit: Unit of measurement (kg, liters, pieces, etc.)
 * - threshold: Low stock alert level
 * - status: 'good' | 'low' | 'critical'
 * - last_restocked: Timestamp of last restock
 * - created_at: Record creation timestamp
 * - updated_at: Record last update timestamp
 * 
 * STATUS LOGIC:
 * - 'critical': quantity <= threshold/2
 * - 'low': threshold/2 < quantity <= threshold
 * - 'good': quantity > threshold
 * 
 * DEPENDENCIES:
 * - db: MySQL connection pool from config/db.js
 */

import { db } from '../config/db.js';

// ============================================================
// GET ALL INVENTORY ITEMS
// ============================================================
/**
 * ENDPOINT: GET /api/restaurant/inventory
 * 
 * PURPOSE:
 * - Retrieve all inventory items from database
 * - Display full inventory list in admin dashboard
 * - Used for inventory reports and analysis
 * 
 * QUERY PARAMETERS (optional):
 * - status: Filter by status ('good', 'low', 'critical')
 * - search: Search by item name (partial match)
 * 
 * RESPONSE:
 * [
 *   {
 *     inventory_id: 1,
 *     item_name: "Chicken Breast",
 *     quantity: 25.5,
 *     unit: "kg",
 *     threshold: 10,
 *     status: "good",
 *     last_restocked: "2024-01-25T10:30:00Z",
 *     created_at: "2024-01-01T08:00:00Z",
 *     updated_at: "2024-01-25T10:30:00Z"
 *   },
 *   ...
 * ]
 * 
 * ERROR RESPONSES:
 * - 500: Database query error
 */
export const getAllInventory = async (req, res) => {
    try {
        // Get optional filter parameters from query string
        const { status, search } = req.query;
        let query = 'SELECT * FROM inventory WHERE 1=1';
        const params = [];

        // Filter by status if provided
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        // Search by item name if provided
        if (search) {
            query += ' AND item_name LIKE ?';
            params.push(`%${search}%`);
        }

        // Sort by item name for consistent ordering
        query += ' ORDER BY item_name ASC';

        const [rows] = await db.query(query, params);

        res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch inventory',
            details: error.message
        });
    }
};

// ============================================================
// GET SINGLE INVENTORY ITEM
// ============================================================
/**
 * ENDPOINT: GET /api/restaurant/inventory/:id
 * 
 * PURPOSE:
 * - Retrieve detailed information for a specific inventory item
 * - Used when editing item details in admin
 * - Populate forms for item updates
 * 
 * URL PARAMETERS:
 * - id (required): inventory_id of item to retrieve
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: {
 *     inventory_id: 1,
 *     item_name: "Chicken Breast",
 *     quantity: 25.5,
 *     unit: "kg",
 *     threshold: 10,
 *     status: "good",
 *     last_restocked: "2024-01-25T10:30:00Z"
 *   }
 * }
 * 
 * ERROR RESPONSES:
 * - 400: Invalid or missing ID
 * - 404: Item not found
 * - 500: Database error
 */
export const getInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inventory ID'
            });
        }

        const [rows] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);

        // Return 404 if item not found
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Error fetching inventory item:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch inventory item',
            details: error.message
        });
    }
};

// ============================================================
// CREATE NEW INVENTORY ITEM
// ============================================================
/**
 * ENDPOINT: POST /api/restaurant/inventory
 * 
 * PURPOSE:
 * - Add a new item to the inventory system
 * - Initialize tracking for new food/supply items
 * - Set up stock monitoring thresholds
 * 
 * REQUEST BODY:
 * {
 *   item_name: "Chicken Breast",        // string (required, unique)
 *   quantity: 25.5,                     // number (required)
 *   unit: "kg",                         // string (required)
 *   threshold: 10                       // number (required)
 * }
 * 
 * VALIDATION:
 * - item_name: Must be provided and unique
 * - quantity: Must be a number >= 0
 * - unit: Must be provided (kg, g, liters, pieces, etc.)
 * - threshold: Must be a number > 0
 * 
 * STATUS ASSIGNMENT:
 * - Automatically calculated on creation based on quantity vs threshold
 * - 'good': quantity > threshold
 * - 'low': quantity <= threshold
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   message: "Inventory item created successfully",
 *   inventory_id: 42,
 *   data: {
 *     inventory_id: 42,
 *     item_name: "Chicken Breast",
 *     quantity: 25.5,
 *     unit: "kg",
 *     threshold: 10,
 *     status: "good",
 *     created_at: "2024-01-30T14:25:00Z"
 *   }
 * }
 * 
 * ERROR RESPONSES:
 * - 400: Validation error (missing fields, duplicate name)
 * - 500: Database error
 * 
 * USAGE EXAMPLE:
 * POST http://localhost:8000/api/restaurant/inventory
 * {
 *   "item_name": "Salmon Fillet",
 *   "quantity": 50,
 *   "unit": "pieces",
 *   "threshold": 15
 * }
 */
export const createInventoryItem = async (req, res) => {
    try {
        const { item_name, quantity, unit, threshold } = req.body;

        // Validation: Check all required fields are provided
        if (!item_name || quantity === undefined || !unit || !threshold) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'item_name, quantity, unit, and threshold are required'
            });
        }

        // Validation: Ensure quantity and threshold are numbers
        if (isNaN(quantity) || isNaN(threshold)) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'quantity and threshold must be numbers'
            });
        }

        // Validation: Ensure quantity is not negative
        if (parseFloat(quantity) < 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'quantity cannot be negative'
            });
        }

        // Validation: Ensure threshold is positive
        if (parseFloat(threshold) <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'threshold must be greater than 0'
            });
        }

        // Calculate status based on quantity vs threshold
        const status = parseFloat(quantity) <= parseFloat(threshold) ? 'low' : 'good';

        // Insert into database with prepared statement (prevents SQL injection)
        const [result] = await db.query(
            'INSERT INTO inventory (item_name, quantity, unit, threshold, status) VALUES (?, ?, ?, ?, ?)',
            [item_name.trim(), parseFloat(quantity), unit.trim(), parseFloat(threshold), status]
        );

        // Fetch the newly created item to return complete data
        const [newItem] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Inventory item created successfully',
            inventory_id: result.insertId,
            data: newItem[0]
        });
    } catch (error) {
        console.error('Error creating inventory item:', error);

        // Handle duplicate item name error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'Item already exists',
                message: 'An inventory item with this name already exists'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to create inventory item',
            details: error.message
        });
    }
};

// ============================================================
// UPDATE INVENTORY ITEM (Full Update)
// ============================================================
/**
 * ENDPOINT: PUT /api/restaurant/inventory/:id
 * 
 * PURPOSE:
 * - Update all details of an inventory item
 * - Used when editing item information in admin dashboard
 * - Recalculates status based on new quantity
 * 
 * URL PARAMETERS:
 * - id (required): inventory_id to update
 * 
 * REQUEST BODY:
 * {
 *   item_name: "Chicken Breast Premium",  // optional
 *   quantity: 30,                         // optional
 *   unit: "kg",                           // optional
 *   threshold: 12                         // optional
 * }
 * 
 * STATUS RECALCULATION:
 * - 'critical': quantity <= threshold / 2
 * - 'low': threshold / 2 < quantity <= threshold
 * - 'good': quantity > threshold
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   message: "Inventory item updated successfully",
 *   data: {
 *     inventory_id: 1,
 *     item_name: "Chicken Breast Premium",
 *     quantity: 30,
 *     unit: "kg",
 *     threshold: 12,
 *     status: "good"
 *   }
 * }
 * 
 * ERROR RESPONSES:
 * - 400: Invalid ID or validation failed
 * - 404: Item not found
 * - 500: Database error
 */
export const updateInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { item_name, quantity, unit, threshold } = req.body;

        // Validate ID format
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inventory ID'
            });
        }

        // Check if item exists before updating
        const [existingItem] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);
        if (existingItem.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        // Use existing values if new values not provided (partial update support)
        const updatedName = item_name || existingItem[0].item_name;
        const updatedQuantity = quantity !== undefined ? quantity : existingItem[0].quantity;
        const updatedUnit = unit || existingItem[0].unit;
        const updatedThreshold = threshold !== undefined ? threshold : existingItem[0].threshold;

        // Validation: Ensure quantity is not negative
        if (parseFloat(updatedQuantity) < 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'quantity cannot be negative'
            });
        }

        // Validation: Ensure threshold is positive
        if (parseFloat(updatedThreshold) <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'threshold must be greater than 0'
            });
        }

        // Calculate new status based on updated quantity and threshold
        const qtyNum = parseFloat(updatedQuantity);
        const thresholdNum = parseFloat(updatedThreshold);
        let newStatus = 'good';

        if (qtyNum <= thresholdNum / 2) {
            newStatus = 'critical';
        } else if (qtyNum <= thresholdNum) {
            newStatus = 'low';
        }

        // Update database record
        const [result] = await db.query(
            'UPDATE inventory SET item_name = ?, quantity = ?, unit = ?, threshold = ?, status = ?, updated_at = NOW() WHERE inventory_id = ?',
            [updatedName.trim(), updatedQuantity, updatedUnit.trim(), updatedThreshold, newStatus, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        // Fetch updated item to return complete data
        const [updatedItem] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);

        res.status(200).json({
            success: true,
            message: 'Inventory item updated successfully',
            data: updatedItem[0]
        });
    } catch (error) {
        console.error('Error updating inventory item:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update inventory item',
            details: error.message
        });
    }
};

// ============================================================
// UPDATE INVENTORY QUANTITY (Partial Update)
// ============================================================
/**
 * ENDPOINT: PATCH /api/restaurant/inventory/:id/quantity
 * 
 * PURPOSE:
 * - Quick update of stock quantity only
 * - Handle stock increases (restocking) and decreases (usage)
 * - Support three operations: add, remove, set
 * - Automatically update last_restocked timestamp
 * 
 * URL PARAMETERS:
 * - id (required): inventory_id to update
 * 
 * REQUEST BODY:
 * {
 *   quantity: 10,              // number (required)
 *   operation: "add"           // "add" | "remove" | "set" (optional, default: "set")
 * }
 * 
 * OPERATIONS:
 * 1. "add" - Increases current quantity by amount
 *    Current: 20, Quantity: 5, Result: 25
 *    Use case: Receiving new stock delivery
 * 
 * 2. "remove" - Decreases current quantity by amount
 *    Current: 20, Quantity: 5, Result: 15 (never goes below 0)
 *    Use case: Items used in kitchen
 * 
 * 3. "set" - Sets quantity to exact value
 *    Current: 20, Quantity: 25, Result: 25
 *    Use case: Physical inventory count/adjustment
 * 
 * STATUS RECALCULATION:
 * - 'critical': quantity <= threshold / 2
 * - 'low': threshold / 2 < quantity <= threshold
 * - 'good': quantity > threshold
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   message: "Inventory quantity updated successfully",
 *   operation: "add",
 *   previousQuantity: 20,
 *   newQuantity: 25,
 *   newStatus: "good",
 *   data: {
 *     inventory_id: 1,
 *     item_name: "Chicken Breast",
 *     quantity: 25,
 *     status: "good",
 *     last_restocked: "2024-01-30T14:30:00Z"
 *   }
 * }
 * 
 * ERROR RESPONSES:
 * - 400: Invalid ID, invalid operation, or negative quantity attempt
 * - 404: Item not found
 * - 500: Database error
 * 
 * USAGE EXAMPLES:
 * 
 * Add 10kg of chicken (restocking):
 * PATCH http://localhost:8000/api/restaurant/inventory/1/quantity
 * { "quantity": 10, "operation": "add" }
 * 
 * Remove 3kg of chicken (kitchen usage):
 * PATCH http://localhost:8000/api/restaurant/inventory/1/quantity
 * { "quantity": 3, "operation": "remove" }
 * 
 * Physical count adjustment to 25kg:
 * PATCH http://localhost:8000/api/restaurant/inventory/1/quantity
 * { "quantity": 25, "operation": "set" }
 */
export const updateInventoryQuantity = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, operation = 'set' } = req.body;

        // Validate ID and quantity
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inventory ID'
            });
        }

        if (quantity === undefined || isNaN(quantity)) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be a number'
            });
        }

        // Validate operation is one of allowed values
        const validOperations = ['add', 'remove', 'set'];
        if (!validOperations.includes(operation)) {
            return res.status(400).json({
                success: false,
                error: `Invalid operation. Must be one of: ${validOperations.join(', ')}`
            });
        }

        // Fetch current item
        const [item] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);
        if (item.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        const currentItem = item[0];
        const currentQuantity = parseFloat(currentItem.quantity);
        const thresholdNum = parseFloat(currentItem.threshold);
        let newQuantity;

        // Calculate new quantity based on operation
        if (operation === 'add') {
            // Restocking: Add to current quantity
            newQuantity = currentQuantity + parseFloat(quantity);
        } else if (operation === 'remove') {
            // Usage: Subtract from current quantity (never go below 0)
            newQuantity = Math.max(0, currentQuantity - parseFloat(quantity));
        } else {
            // Set: Use exact value
            newQuantity = parseFloat(quantity);
        }

        // Validate new quantity is not negative
        if (newQuantity < 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity cannot be negative'
            });
        }

        // Calculate status based on new quantity
        let newStatus = 'good';
        if (newQuantity <= thresholdNum / 2) {
            newStatus = 'critical';
        } else if (newQuantity <= thresholdNum) {
            newStatus = 'low';
        }

        // Update quantity and status, also update last_restocked timestamp
        // (even on removals, to track last inventory change)
        await db.query(
            'UPDATE inventory SET quantity = ?, status = ?, last_restocked = NOW(), updated_at = NOW() WHERE inventory_id = ?',
            [newQuantity, newStatus, id]
        );

        // Fetch updated item to return complete data
        const [updatedItem] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);

        res.status(200).json({
            success: true,
            message: 'Inventory quantity updated successfully',
            operation: operation,
            previousQuantity: currentQuantity,
            newQuantity: newQuantity,
            newStatus: newStatus,
            data: updatedItem[0]
        });
    } catch (error) {
        console.error('Error updating inventory quantity:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update inventory quantity',
            details: error.message
        });
    }
};

// ============================================================
// GET LOW STOCK ITEMS
// ============================================================
/**
 * ENDPOINT: GET /api/restaurant/inventory/status/low
 * 
 * PURPOSE:
 * - Retrieve all items with low or critical stock levels
 * - Used to alert staff about items needing restocking
 * - Displayed in admin dashboard alerts/notifications
 * - Help prioritize purchasing/ordering
 * 
 * QUERY PARAMETERS (optional):
 * - critical: true - Only return critical items (quantity <= threshold/2)
 * - limit: number - Limit results (e.g., top 10 items)
 * 
 * STATUS FILTERING:
 * - Returns items with status: 'low' OR 'critical'
 * - Excludes items with status: 'good'
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   count: 3,
 *   data: [
 *     {
 *       inventory_id: 1,
 *       item_name: "Chicken Breast",
 *       quantity: 8,
 *       unit: "kg",
 *       threshold: 10,
 *       status: "low",
 *       last_restocked: "2024-01-25T10:30:00Z"
 *     },
 *     ...
 *   ]
 * }
 * 
 * ERROR RESPONSES:
 * - 500: Database error
 * 
 * USAGE EXAMPLES:
 * 
 * Get all low/critical items:
 * GET http://localhost:8000/api/restaurant/inventory/status/low
 * 
 * Get only critical items:
 * GET http://localhost:8000/api/restaurant/inventory/status/low?critical=true
 * 
 * Get top 5 low stock items:
 * GET http://localhost:8000/api/restaurant/inventory/status/low?limit=5
 */
export const getLowStockItems = async (req, res) => {
    try {
        const { critical, limit } = req.query;

        let query = 'SELECT * FROM inventory WHERE status IN (?, ?)';
        const params = ['low', 'critical'];
        const statusFilter = critical === 'true' ? ['critical'] : ['low', 'critical'];

        query = 'SELECT * FROM inventory WHERE status IN (';
        for (let i = 0; i < statusFilter.length; i++) {
            if (i > 0) query += ', ';
            query += '?';
        }
        query += ')';

        // Sort by status priority (critical first, then low) and quantity ascending
        query += ' ORDER BY CASE WHEN status = "critical" THEN 1 WHEN status = "low" THEN 2 ELSE 3 END, quantity ASC';

        // Add limit if provided
        if (limit && !isNaN(limit)) {
            query += ' LIMIT ?';
            statusFilter.push(parseInt(limit));
        }

        const [rows] = await db.query(query, statusFilter);

        res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch low stock items',
            details: error.message
        });
    }
};

// ============================================================
// GET INVENTORY STATISTICS
// ============================================================
/**
 * ENDPOINT: GET /api/restaurant/inventory/stats
 * 
 * PURPOSE:
 * - Get overview statistics of inventory
 * - Used for dashboard analytics
 * - Monitor inventory health at a glance
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   stats: {
 *     total_items: 45,
 *     good_status: 42,
 *     low_status: 2,
 *     critical_status: 1,
 *     total_unique_units: 8
 *   }
 * }
 * 
 * ERROR RESPONSES:
 * - 500: Database error
 */
export const getInventoryStats = async (req, res) => {
    try {
        const [stats] = await db.query(`
            SELECT 
                COUNT(*) as total_items,
                SUM(CASE WHEN status = 'good' THEN 1 ELSE 0 END) as good_status,
                SUM(CASE WHEN status = 'low' THEN 1 ELSE 0 END) as low_status,
                SUM(CASE WHEN status = 'critical' THEN 1 ELSE 0 END) as critical_status,
                COUNT(DISTINCT unit) as total_unique_units
            FROM inventory
        `);

        res.status(200).json({
            success: true,
            stats: stats[0]
        });
    } catch (error) {
        console.error('Error fetching inventory stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch inventory statistics',
            details: error.message
        });
    }
};

// ============================================================
// DELETE INVENTORY ITEM
// ============================================================
/**
 * ENDPOINT: DELETE /api/restaurant/inventory/:id
 * 
 * PURPOSE:
 * - Remove an item from inventory system
 * - Delete items that are no longer stocked
 * - Permanent removal from database
 * 
 * URL PARAMETERS:
 * - id (required): inventory_id to delete
 * 
 * WARNING:
 * - This action is permanent and cannot be undone
 * - Consider adding soft delete (status flag) for audit trail
 * - In production, implement admin confirmation
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   message: "Inventory item deleted successfully",
 *   deleted_id: 42
 * }
 * 
 * ERROR RESPONSES:
 * - 400: Invalid ID
 * - 404: Item not found
 * - 500: Database error
 * 
 * USAGE EXAMPLE:
 * DELETE http://localhost:8000/api/restaurant/inventory/42
 */
export const deleteInventoryItem = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid inventory ID'
            });
        }

        // Check if item exists before attempting deletion
        const [existingItem] = await db.query('SELECT * FROM inventory WHERE inventory_id = ?', [id]);
        if (existingItem.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        const [result] = await db.query(
            'DELETE FROM inventory WHERE inventory_id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Inventory item not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Inventory item deleted successfully',
            deleted_id: id
        });
    } catch (error) {
        console.error('Error deleting inventory item:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete inventory item',
            details: error.message
        });
    }
};
