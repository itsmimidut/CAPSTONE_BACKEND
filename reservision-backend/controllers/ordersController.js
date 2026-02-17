import { db } from '../config/db.js';

// Get all orders
export const getAllOrders = async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT o.*, rt.table_number
      FROM orders o
      JOIN restaurant_tables rt ON o.table_id = rt.table_id
      ORDER BY o.created_at DESC
    `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Error fetching orders' });
    }
};

// Get order with items
export const getOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const [order] = await db.query(
            'SELECT o.*, rt.table_number FROM orders o JOIN restaurant_tables rt ON o.table_id = rt.table_id WHERE o.order_id = ?',
            [id]
        );

        if (order.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const [items] = await db.query(
            'SELECT oi.*, m.name FROM order_items oi JOIN menu_items m ON oi.menu_id = m.menu_id WHERE oi.order_id = ?',
            [id]
        );

        res.json({
            ...order[0],
            items: items
        });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ error: 'Error fetching order' });
    }
};

// Create order
export const createOrder = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { table_id, items, special_requests = '' } = req.body;

        if (!table_id || !items || items.length === 0) {
            return res.status(400).json({ message: 'Table ID and items are required' });
        }

        await connection.beginTransaction();

        // Check ingredient availability for all menu items
        for (const item of items) {
            const [ingredients] = await connection.query(`
                SELECT 
                    mi.quantity_needed,
                    i.inventory_id,
                    i.item_name,
                    i.quantity as inventory_quantity,
                    i.unit
                FROM menu_ingredients mi
                JOIN inventory i ON mi.inventory_id = i.inventory_id
                WHERE mi.menu_id = ?
            `, [item.menu_id]);

            // Check if there are enough ingredients
            for (const ingredient of ingredients) {
                const requiredQuantity = ingredient.quantity_needed * item.quantity;
                if (ingredient.inventory_quantity < requiredQuantity) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient ${ingredient.item_name}. Required: ${requiredQuantity} ${ingredient.unit}, Available: ${ingredient.inventory_quantity} ${ingredient.unit}`,
                        insufficientIngredient: ingredient.item_name
                    });
                }
            }
        }

        // Create order
        const [orderResult] = await connection.query(
            'INSERT INTO orders (table_id, status, special_requests) VALUES (?, ?, ?)',
            [table_id, 'pending', special_requests]
        );

        const order_id = orderResult.insertId;

        // Add order items and deduct inventory
        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, menu_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [order_id, item.menu_id, item.quantity, item.unit_price]
            );

            // Deduct ingredients from inventory
            const [ingredients] = await connection.query(`
                SELECT inventory_id, quantity_needed
                FROM menu_ingredients
                WHERE menu_id = ?
            `, [item.menu_id]);

            for (const ingredient of ingredients) {
                const deductAmount = ingredient.quantity_needed * item.quantity;

                // Update inventory quantity
                await connection.query(`
                    UPDATE inventory 
                    SET quantity = quantity - ?,
                        status = CASE
                            WHEN (quantity - ?) <= threshold * 0.25 THEN 'critical'
                            WHEN (quantity - ?) <= threshold THEN 'low'
                            ELSE 'good'
                        END
                    WHERE inventory_id = ?
                `, [deductAmount, deductAmount, deductAmount, ingredient.inventory_id]);
            }
        }

        // Update table status to occupied
        await connection.query(
            'UPDATE restaurant_tables SET status = ?, guests = ? WHERE table_id = ?',
            ['occupied', items.reduce((sum, item) => sum + item.quantity, 0), table_id]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Order created successfully and inventory updated',
            order_id: order_id
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating order:', error);
        res.status(500).json({ success: false, error: 'Error creating order', message: error.message });
    } finally {
        connection.release();
    }
};

// Update order status
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const [result] = await db.query(
            'UPDATE orders SET status = ? WHERE order_id = ?',
            [status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.json({ message: 'Order status updated successfully' });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Error updating order status' });
    }
};

// Get orders by table
export const getOrdersByTable = async (req, res) => {
    try {
        const { tableId } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM orders WHERE table_id = ? ORDER BY created_at DESC',
            [tableId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching orders by table:', error);
        res.status(500).json({ error: 'Error fetching orders' });
    }
};

// Delete order
export const deleteOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            'DELETE FROM orders WHERE order_id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ error: 'Error deleting order' });
    }
};
