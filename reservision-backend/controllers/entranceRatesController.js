import { db } from '../config/db.js';

/**
 * Get all entrance rates with pagination and filtering
 * Query params: page, search, day_type, status
 */
export const getRates = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const search = req.query.search || '';
        const day_type = req.query.day_type || '';
        const status = req.query.status || '';
        const limit = 10;
        const offset = (page - 1) * limit;

        // Build WHERE clause dynamically
        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('name LIKE ?');
            params.push(`%${search}%`);
        }

        if (day_type && day_type !== '') {
            whereConditions.push('day_type = ?');
            params.push(day_type);
        }

        if (status && status !== '') {
            whereConditions.push('status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM entrance_rates ${whereClause}`;
        const [[{ total }]] = await db.query(countQuery, params);
        const totalPages = Math.ceil(total / limit);

        // Get paginated data
        const dataQuery = `
      SELECT * FROM entrance_rates 
      ${whereClause}
      ORDER BY day_type, age_min ASC
      LIMIT ? OFFSET ?
    `;
        const [rates] = await db.query(dataQuery, [...params, limit, offset]);

        res.json({
            success: true,
            data: rates,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching rates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch entrance rates',
            error: error.message
        });
    }
};

/**
 * Get single rate by ID
 */
export const getRateById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rates] = await db.query('SELECT * FROM entrance_rates WHERE id = ?', [id]);

        if (rates.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Entrance rate not found'
            });
        }

        res.json({
            success: true,
            data: rates[0]
        });
    } catch (error) {
        console.error('Error fetching rate:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch entrance rate',
            error: error.message
        });
    }
};

/**
 * Create new entrance rate
 */
export const createRate = async (req, res) => {
    try {
        const { name, price, age_min, age_max, day_type, start_time, end_time, status } = req.body;

        // Validation
        if (!name || price === undefined || !day_type) {
            return res.status(400).json({
                success: false,
                message: 'Name, price, and day_type are required'
            });
        }

        if (price < 0) {
            return res.status(400).json({
                success: false,
                message: 'Price cannot be negative'
            });
        }

        const [result] = await db.query(
            `INSERT INTO entrance_rates (name, price, age_min, age_max, day_type, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, price, age_min || null, age_max || null, day_type, start_time || null, end_time || null, status || 'active']
        );

        res.status(201).json({
            success: true,
            message: 'Entrance rate created successfully',
            data: { id: result.insertId, name, price, age_min, age_max, day_type, start_time, end_time, status: status || 'active' }
        });
    } catch (error) {
        console.error('Error creating rate:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create entrance rate',
            error: error.message
        });
    }
};

/**
 * Update entrance rate
 */
export const updateRate = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, age_min, age_max, day_type, start_time, end_time, status } = req.body;

        // Check if rate exists
        const [rateExists] = await db.query('SELECT id FROM entrance_rates WHERE id = ?', [id]);
        if (rateExists.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Entrance rate not found'
            });
        }

        // Validation
        if (!name || price === undefined || !day_type) {
            return res.status(400).json({
                success: false,
                message: 'Name, price, and day_type are required'
            });
        }

        if (price < 0) {
            return res.status(400).json({
                success: false,
                message: 'Price cannot be negative'
            });
        }

        await db.query(
            `UPDATE entrance_rates 
       SET name = ?, price = ?, age_min = ?, age_max = ?, day_type = ?, start_time = ?, end_time = ?, status = ?
       WHERE id = ?`,
            [name, price, age_min || null, age_max || null, day_type, start_time || null, end_time || null, status, id]
        );

        res.json({
            success: true,
            message: 'Entrance rate updated successfully'
        });
    } catch (error) {
        console.error('Error updating rate:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update entrance rate',
            error: error.message
        });
    }
};

/**
 * Delete entrance rate
 */
export const deleteRate = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if rate exists
        const [rateExists] = await db.query('SELECT id FROM entrance_rates WHERE id = ?', [id]);
        if (rateExists.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Entrance rate not found'
            });
        }

        await db.query('DELETE FROM entrance_rates WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Entrance rate deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting rate:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete entrance rate',
            error: error.message
        });
    }
};

/**
 * Toggle rate status (active/hidden)
 */
export const toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;

        // Get current status
        const [rates] = await db.query('SELECT status FROM entrance_rates WHERE id = ?', [id]);
        if (rates.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Entrance rate not found'
            });
        }

        const newStatus = rates[0].status === 'active' ? 'hidden' : 'active';

        await db.query('UPDATE entrance_rates SET status = ? WHERE id = ?', [newStatus, id]);

        res.json({
            success: true,
            message: `Status changed to ${newStatus}`,
            data: { id, status: newStatus }
        });
    } catch (error) {
        console.error('Error toggling status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to toggle entrance rate status',
            error: error.message
        });
    }
};

/**
 * Get rates for a specific date and count
 * Used for computing entrance fees
 */
export const getRatesByDate = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Date is required'
            });
        }

        // Detect day type (weekday/weekend/holiday)
        // TODO: Integrate with holiday calendar if available
        const dateObj = new Date(date);
        const day = dateObj.getDay();
        const dayType = day === 0 || day === 6 ? 'weekend' : 'weekday';

        // Get active rates for the day
        const [rates] = await db.query(
            `SELECT * FROM entrance_rates 
       WHERE day_type = ? AND status = 'active'
       ORDER BY age_min ASC`,
            [dayType]
        );

        res.json({
            success: true,
            data: rates,
            dayType,
            date
        });
    } catch (error) {
        console.error('Error fetching rates by date:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rates by date',
            error: error.message
        });
    }
};
