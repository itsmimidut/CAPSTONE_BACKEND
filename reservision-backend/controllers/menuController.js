/**
 * ============================================================
 * Menu Controller
 * ============================================================
 * 
 * Purpose:
 * - Manage all restaurant menu items
 * - Handle CRUD operations for menu items
 * - Support menu organization by category
 * - Toggle item availability for order management
 * 
 * Database Table: menu_items
 * Key Fields:
 * - menu_id: Unique identifier (auto-increment)
 * - name: Dish/item name
 * - price: Cost per item
 * - category: Menu category (Appetizer, Main, Dessert, etc.)
 * - available: Boolean - whether item can be ordered
 * - prep_time: Estimated preparation time in minutes
 * - description: Item description and ingredients
 * - image_url: Link to item image
 * - created_at: Timestamp of creation
 * 
 * Error Handling:
 * - All functions include try-catch blocks
 * - Database errors return 500 status
 * - Validation errors return 400 status
 * - Not found errors return 404 status
 */

import { db } from '../config/db.js';

// ============================================================
// GET ALL MENU ITEMS
// ============================================================
/**
 * Handler: GET /api/restaurant/menu
 * 
 * Purpose: Retrieve all menu items from database
 * 
 * Sorting:
 * - Primary: By category (A-Z)
 * - Secondary: By name (A-Z)
 * 
 * Response:
 * - Array of all menu items including unavailable ones
 * - Used by admin to manage entire menu
 * - Used by frontend to display menu to customers
 * 
 * Query: SELECT * FROM menu_items ORDER BY category, name
 * 
 * Error Response:
 * - Status 500: Database connection error
 */
export const getAllMenuItems = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM menu_items ORDER BY category, name');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching menu items:', error);
        res.status(500).json({ error: 'Error fetching menu items' });
    }
};

// ============================================================
// GET MENU ITEMS BY CATEGORY
// ============================================================
/**
 * Handler: GET /api/restaurant/menu/:category
 * 
 * Purpose: Get menu items for a specific category (public view)
 * 
 * Parameters:
 * - category: Menu category name (e.g., 'Appetizer', 'Main Course')
 * 
 * Filtering:
 * - Only shows available items (available = TRUE)
 * - Sorted alphabetically by name
 * 
 * Response:
 * - Array of available items in that category
 * - Empty array if no items in category
 * 
 * Usage in Frontend:
 * - Display menu by category on restaurant page
 * - Allow customers to browse specific categories
 * - Filter out unavailable items automatically
 * 
 * Query: SELECT * FROM menu_items WHERE category = ? AND available = TRUE ORDER BY name
 */
export const getMenuByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM menu_items WHERE category = ? AND available = TRUE ORDER BY name',
            [category]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching menu items by category:', error);
        res.status(500).json({ error: 'Error fetching menu items' });
    }
};

// ============================================================
// GET SINGLE MENU ITEM
// ============================================================
/**
 * Handler: GET /api/restaurant/menu/:id
 * 
 * Purpose: Retrieve a specific menu item by ID
 * 
 * Parameters:
 * - id: menu_id to fetch
 * 
 * Response:
 * - Single menu item object with all details
 * - Or 404 if not found
 * 
 * Usage:
 * - Load item details for editing
 * - Display full item info on detail page
 * - Fetch prep time before adding to order
 * 
 * Query: SELECT * FROM menu_items WHERE menu_id = ?
 */
export const getMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM menu_items WHERE menu_id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching menu item:', error);
        res.status(500).json({ error: 'Error fetching menu item' });
    }
};

// ============================================================
// CREATE MENU ITEM
// ============================================================
/**
 * Handler: POST /api/restaurant/menu
 * 
 * Purpose: Add a new menu item
 * 
 * Request Body:
 * {
 *   name: string (required) - Item name
 *   price: number (required) - Item price
 *   category: string (required) - Menu category
 *   available: boolean (optional, default: true) - Can be ordered
 *   prep_time: number (optional, default: 15) - Prep time in minutes
 *   description: string (optional) - Item description
 *   image_url: string (optional) - Image path/URL
 * }
 * 
 * Validation:
 * - name, price, category are required
 * - Returns 400 if any required field missing
 * 
 * Response:
 * {
 *   message: 'Menu item created successfully',
 *   menu_id: 42
 * }
 * 
 * Usage in Frontend:
 * - Called by admin form when adding menu item
 * - Form validates data before sending
 */
export const createMenuItem = async (req, res) => {
    try {
        const { name, price, category, available = true, prep_time = 15, description = '', image_url = '' } = req.body;

        if (!name || !price || !category) {
            return res.status(400).json({ message: 'Name, price, and category are required' });
        }

        const [result] = await db.query(
            'INSERT INTO menu_items (name, price, category, available, prep_time, description, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, price, category, available, prep_time, description, image_url]
        );

        res.status(201).json({
            message: 'Menu item created successfully',
            menu_id: result.insertId
        });
    } catch (error) {
        console.error('Error creating menu item:', error);
        res.status(500).json({ error: 'Error creating menu item' });
    }
};

// ============================================================
// UPDATE MENU ITEM
// ============================================================
/**
 * Handler: PUT /api/restaurant/menu/:id
 * 
 * Purpose: Update all fields of a menu item
 * 
 * Parameters:
 * - id: menu_id to update
 * 
 * Request Body:
 * - All fields of menu item (name, price, category, etc.)
 * - All fields are overwritten
 * 
 * Response:
 * - Status 200: { message: 'Menu item updated successfully' }
 * - Status 404: Menu item not found
 * - Status 500: Database error
 * 
 * Usage in Frontend:
 * - Called when editing menu item in admin panel
 * - Updates all visible fields
 * 
 * Note:
 * - affected_rows = 0 means item not found
 * - created_at timestamp is not updated
 */
export const updateMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, category, available, prep_time, description, image_url } = req.body;

        const [result] = await db.query(
            'UPDATE menu_items SET name = ?, price = ?, category = ?, available = ?, prep_time = ?, description = ?, image_url = ? WHERE menu_id = ?',
            [name, price, category, available, prep_time, description, image_url, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        res.json({ message: 'Menu item updated successfully' });
    } catch (error) {
        console.error('Error updating menu item:', error);
        res.status(500).json({ error: 'Error updating menu item' });
    }
};

// ============================================================
// TOGGLE MENU ITEM AVAILABILITY
// ============================================================
/**
 * Handler: PATCH /api/restaurant/menu/:id/availability
 * 
 * Purpose: Quickly toggle whether item can be ordered
 * 
 * Parameters:
 * - id: menu_id to toggle
 * 
 * Request Body:
 * {
 *   available: boolean - true (available for order) | false (out of stock)
 * }
 * 
 * Usage in Frontend:
 * - Quick toggle button in admin menu list
 * - No need to edit full item details
 * - Updates instantaneously
 * 
 * Response:
 * - Status 200: Item availability updated
 * - Status 404: Item not found
 * - Status 500: Database error
 */
export const toggleMenuItemAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const { available } = req.body;

        const [result] = await db.query(
            'UPDATE menu_items SET available = ? WHERE menu_id = ?',
            [available, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        res.json({ message: 'Menu item availability updated successfully' });
    } catch (error) {
        console.error('Error updating menu item availability:', error);
        res.status(500).json({ error: 'Error updating menu item availability' });
    }
};

// ============================================================
// GET ALL MENU CATEGORIES
// ============================================================
/**
 * Handler: GET /api/restaurant/menu/categories
 * 
 * Purpose: Retrieve all unique menu categories
 * 
 * Response:
 * - Array of category names, sorted A-Z
 * - Example: ['Appetizer', 'Main Course', 'Dessert', 'Beverage']
 * 
 * Usage in Frontend:
 * - Populate category dropdown in admin add/edit form
 * - Create category filter buttons for customers
 * - Display menu by category sections
 * 
 * Query: SELECT DISTINCT category FROM menu_items ORDER BY category
 * Transforms to: Extract category strings into array
 */
export const getCategories = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT category FROM menu_items ORDER BY category');
        const categories = rows.map(row => row.category);
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error fetching categories' });
    }
};

// ============================================================
// DELETE MENU ITEM
// ============================================================
/**
 * Handler: DELETE /api/restaurant/menu/:id
 * 
 * Purpose: Permanently remove a menu item
 * 
 * Parameters:
 * - id: menu_id to delete
 * 
 * Response:
 * - Status 200: Menu item deleted successfully
 * - Status 404: Item not found
 * - Status 500: Database error
 * 
 * Consequences:
 * - Item removed from all views
 * - Any orders referencing this item still exist (historical data)
 * - Action cannot be undone
 * 
 * Usage in Frontend:
 * - Admin clicks "Delete" button with confirmation
 * - Item removed from menu list
 * 
 * Note:
 * - Use availability toggle to temporarily hide items
 * - Use delete only for items that should be completely removed
 */
export const deleteMenuItem = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            'DELETE FROM menu_items WHERE menu_id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        res.json({ message: 'Menu item deleted successfully' });
    } catch (error) {
        console.error('Error deleting menu item:', error);
        res.status(500).json({ error: 'Error deleting menu item' });
    }
};
