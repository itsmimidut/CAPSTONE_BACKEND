import { db } from '../config/db.js';

// Get all ingredients for a specific menu item
export const getMenuIngredients = async (req, res) => {
    try {
        const { menuId } = req.params;
        const [rows] = await db.query(`
            SELECT 
                mi.id,
                mi.menu_id,
                mi.inventory_id,
                mi.quantity_needed,
                i.item_name,
                i.unit,
                i.quantity as inventory_quantity,
                i.status as inventory_status
            FROM menu_ingredients mi
            JOIN inventory i ON mi.inventory_id = i.inventory_id
            WHERE mi.menu_id = ?
            ORDER BY i.item_name
        `, [menuId]);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching menu ingredients:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch menu ingredients',
            error: error.message
        });
    }
};

// Get all menu items with their ingredients
export const getAllMenuWithIngredients = async (req, res) => {
    try {
        // Fetch all menu-ingredient relationships with inventory details
        const [rows] = await db.query(`
            SELECT 
                m.menu_id,
                m.name as menu_name,
                m.price,
                m.category,
                mi.id as ingredient_link_id,
                i.inventory_id,
                i.item_name,
                mi.quantity_needed,
                i.unit,
                i.quantity as inventory_quantity,
                i.status
            FROM menu_items m
            LEFT JOIN menu_ingredients mi ON m.menu_id = mi.menu_id
            LEFT JOIN inventory i ON mi.inventory_id = i.inventory_id
            ORDER BY m.menu_id, i.item_name
        `);

        // Group ingredients by menu item
        const menuMap = {};
        rows.forEach(row => {
            if (!menuMap[row.menu_id]) {
                menuMap[row.menu_id] = {
                    menu_id: row.menu_id,
                    menu_name: row.menu_name,
                    price: row.price,
                    category: row.category,
                    ingredients: []
                };
            }

            // Only add ingredient if it exists (not null from LEFT JOIN)
            if (row.inventory_id) {
                menuMap[row.menu_id].ingredients.push({
                    id: row.ingredient_link_id,
                    inventory_id: row.inventory_id,
                    item_name: row.item_name,
                    quantity_needed: row.quantity_needed,
                    unit: row.unit,
                    inventory_quantity: row.inventory_quantity,
                    status: row.status
                });
            }
        });

        const result = Object.values(menuMap);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error fetching menu with ingredients:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch menu with ingredients',
            error: error.message
        });
    }
};

// Add ingredient to a menu item
export const addMenuIngredient = async (req, res) => {
    try {
        const { menuId } = req.params;
        const { inventory_id, quantity_needed } = req.body;

        if (!inventory_id || !quantity_needed) {
            return res.status(400).json({
                success: false,
                message: 'inventory_id and quantity_needed are required'
            });
        }

        // Check if menu item exists
        const [menuExists] = await db.query('SELECT menu_id FROM menu_items WHERE menu_id = ?', [menuId]);
        if (menuExists.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menu item not found'
            });
        }

        // Check if inventory item exists
        const [inventoryExists] = await db.query('SELECT inventory_id FROM inventory WHERE inventory_id = ?', [inventory_id]);
        if (inventoryExists.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Inventory item not found'
            });
        }

        const [result] = await db.query(
            'INSERT INTO menu_ingredients (menu_id, inventory_id, quantity_needed) VALUES (?, ?, ?)',
            [menuId, inventory_id, quantity_needed]
        );

        res.status(201).json({
            success: true,
            message: 'Ingredient added to menu item',
            data: { id: result.insertId, menu_id: menuId, inventory_id, quantity_needed }
        });
    } catch (error) {
        console.error('Error adding menu ingredient:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'This ingredient is already linked to this menu item'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to add menu ingredient',
            error: error.message
        });
    }
};

// Update ingredient quantity for a menu item
export const updateMenuIngredient = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity_needed } = req.body;

        console.log(`[UPDATE] ID: ${id}, Type: ${typeof id}, Quantity: ${quantity_needed}`);

        if (!quantity_needed) {
            return res.status(400).json({
                success: false,
                message: 'quantity_needed is required'
            });
        }

        // Check if record exists first
        const [checkRow] = await db.query('SELECT id FROM menu_ingredients WHERE id = ?', [id]);
        console.log(`[CHECK] Record exists:`, checkRow.length > 0, `Rows:`, checkRow);

        const [result] = await db.query(
            'UPDATE menu_ingredients SET quantity_needed = ? WHERE id = ?',
            [quantity_needed, id]
        );

        console.log(`[UPDATE RESULT] Affected rows:`, result.affectedRows);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menu ingredient not found'
            });
        }

        res.json({
            success: true,
            message: 'Menu ingredient updated successfully'
        });
    } catch (error) {
        console.error('Error updating menu ingredient:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update menu ingredient',
            error: error.message
        });
    }
};

// Delete ingredient from a menu item
export const deleteMenuIngredient = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query('DELETE FROM menu_ingredients WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menu ingredient not found'
            });
        }

        res.json({
            success: true,
            message: 'Menu ingredient deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting menu ingredient:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete menu ingredient',
            error: error.message
        });
    }
};

// Check if menu item can be prepared (enough ingredients in inventory)
export const checkMenuAvailability = async (req, res) => {
    try {
        const { menuId } = req.params;
        const { quantity = 1 } = req.query;

        const [ingredients] = await db.query(`
            SELECT 
                mi.quantity_needed,
                i.inventory_id,
                i.item_name,
                i.quantity as inventory_quantity,
                i.unit,
                (i.quantity >= (mi.quantity_needed * ?)) as has_enough
            FROM menu_ingredients mi
            JOIN inventory i ON mi.inventory_id = i.inventory_id
            WHERE mi.menu_id = ?
        `, [quantity, menuId]);

        if (ingredients.length === 0) {
            return res.json({
                success: true,
                available: true,
                message: 'No ingredients required for this menu item',
                ingredients: []
            });
        }

        const allAvailable = ingredients.every(ing => ing.has_enough);
        const missingIngredients = ingredients.filter(ing => !ing.has_enough);

        res.json({
            success: true,
            available: allAvailable,
            ingredients,
            missing: missingIngredients
        });
    } catch (error) {
        console.error('Error checking menu availability:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check menu availability',
            error: error.message
        });
    }
};
