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

        // Create order
        const [orderResult] = await connection.query(
            'INSERT INTO orders (table_id, status, special_requests) VALUES (?, ?, ?)',
            [table_id, 'pending', special_requests]
        );

        const order_id = orderResult.insertId;

        // Add order items
        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, menu_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [order_id, item.menu_id, item.quantity, item.unit_price]
            );
        }

        // Update table status to occupied
        await connection.query(
            'UPDATE restaurant_tables SET status = ?, guests = ? WHERE table_id = ?',
            ['occupied', items.reduce((sum, item) => sum + item.quantity, 0), table_id]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Order created successfully',
            order_id: order_id
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Error creating order' });
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
