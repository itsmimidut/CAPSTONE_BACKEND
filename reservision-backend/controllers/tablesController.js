import { db } from '../config/db.js';

// Get all tables
export const getAllTables = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM restaurant_tables ORDER BY table_number');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ error: 'Error fetching tables' });
    }
};

// Get single table
export const getTable = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM restaurant_tables WHERE table_id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Table not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching table:', error);
        res.status(500).json({ error: 'Error fetching table' });
    }
};

// Create table
export const createTable = async (req, res) => {
    try {
        const { number, table_number, capacity, status = 'available', notes = '' } = req.body;
        const tableNum = number || table_number;

        if (!tableNum || !capacity) {
            return res.status(400).json({ message: 'Table number and capacity are required' });
        }

        const [result] = await db.query(
            'INSERT INTO restaurant_tables (table_number, capacity, status, notes) VALUES (?, ?, ?, ?)',
            [tableNum, capacity, status, notes]
        );

        res.status(201).json({
            message: 'Table created successfully',
            table_id: result.insertId
        });
    } catch (error) {
        console.error('Error creating table:', error);
        res.status(500).json({ error: 'Error creating table' });
    }
};

// Update table
export const updateTable = async (req, res) => {
    try {
        const { id } = req.params;
        const { number, table_number, capacity, status, notes } = req.body;
        const tableNum = number || table_number;

        if (!tableNum || !capacity) {
            return res.status(400).json({ message: 'Table number and capacity are required' });
        }

        const [result] = await db.query(
            'UPDATE restaurant_tables SET table_number = ?, capacity = ?, status = ?, notes = ? WHERE table_id = ?',
            [tableNum, capacity, status || 'available', notes || '', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Table not found' });
        }

        res.json({ message: 'Table updated successfully' });
    } catch (error) {
        console.error('Error updating table:', error);
        res.status(500).json({ error: 'Error updating table' });
    }
};

// Update table status
export const updateTableStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['available', 'occupied', 'reserved', 'maintenance'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const [result] = await db.query(
            'UPDATE restaurant_tables SET status = ?, ordered_time = ? WHERE table_id = ?',
            [status, status === 'occupied' ? new Date() : null, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Table not found' });
        }

        res.json({ message: 'Table status updated successfully' });
    } catch (error) {
        console.error('Error updating table status:', error);
        res.status(500).json({ error: 'Error updating table status' });
    }
};

// Delete table
export const deleteTable = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await db.query(
            'DELETE FROM restaurant_tables WHERE table_id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Table not found' });
        }

        res.json({ message: 'Table deleted successfully' });
    } catch (error) {
        console.error('Error deleting table:', error);
        res.status(500).json({ error: 'Error deleting table' });
    }
};
