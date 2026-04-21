// --- Centralized Image Management ---
import { db } from '../config/db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_UPLOAD_DIR = path.join(__dirname, '../public/uploads/entrance-rates');

// Ensure upload directory exists
await fs.mkdir(IMAGE_UPLOAD_DIR, { recursive: true });

// GET /api/entrance-rates/images
export const getImages = async (req, res) => {
    try {
        const files = await fs.readdir(IMAGE_UPLOAD_DIR);
        const imageFiles = files.filter(f => !f.startsWith('.'));
        const images = imageFiles.map(filename => ({
            filename,
            url: `/uploads/entrance-rates/${filename}`
        }));
        res.json({ success: true, data: images });
    } catch (err) {
        console.error('Error reading images:', err);
        res.status(500).json({ success: false, message: 'Failed to list images', error: err.message });
    }
};

// POST /api/entrance-rates/images
export const uploadImage = async (req, res) => {
    try {
        const { image, filename } = req.body;
        if (!image || !filename) {
            return res.status(400).json({ success: false, message: 'Image and filename are required.' });
        }
        // Validate file type
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(filename).toLowerCase();
        if (!allowed.includes(ext)) {
            return res.status(400).json({ success: false, message: 'Invalid file type.' });
        }
        // Decode base64
        const base64Data = image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
        const savePath = path.join(IMAGE_UPLOAD_DIR, filename);

        // Use async writeFile instead of writeFileSync
        await fs.writeFile(savePath, Buffer.from(base64Data, 'base64'));

        const imageUrl = `/uploads/entrance-rates/${filename}`;
        res.json({ success: true, data: { filename, url: imageUrl } });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload image', error: err.message });
    }
};

// DELETE /api/entrance-rates/images/:filename
export const deleteImage = async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(IMAGE_UPLOAD_DIR, filename);

        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ success: false, message: 'Image not found.' });
        }

        await fs.unlink(filePath);
        res.json({ success: true, message: 'Image deleted.' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete image', error: err.message });
    }
};

// Helper function to save base64 image
const saveImage = async (base64Image, filename) => {
    try {
        // Remove data URL prefix if present
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(__dirname, '../public/uploads/entrance-rates');
        await fs.mkdir(uploadsDir, { recursive: true });

        // Save file
        const filepath = path.join(uploadsDir, filename);
        await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));

        // Return relative URL
        return `/uploads/entrance-rates/${filename}`;
    } catch (error) {
        console.error('Image save error:', error);
        return null;
    }
};

// Helper function to delete old image
const deleteImageFile = async (imageUrl) => {
    if (!imageUrl) return;
    try {
        const filepath = path.join(__dirname, '../public', imageUrl);
        await fs.unlink(filepath);
    } catch (error) {
        console.error('Image delete error:', error);
    }
};

// POST /api/entrance-rates/images/assign/:rateId
// Assign an uploaded image to a specific entrance rate
export const assignImageToRate = async (req, res) => {
    try {
        const { rateId } = req.params;
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, message: 'Image URL is required.' });
        }

        // Check if rate exists
        const [rateExists] = await db.query('SELECT id, image_url FROM entrance_rates WHERE id = ?', [rateId]);
        if (rateExists.length === 0) {
            return res.status(404).json({ success: false, message: 'Entrance rate not found.' });
        }

        // Delete old image if it exists
        if (rateExists[0].image_url) {
            await deleteImageFile(rateExists[0].image_url);
        }

        // Update rate with new image
        await db.query('UPDATE entrance_rates SET image_url = ? WHERE id = ?', [imageUrl, rateId]);

        // Fetch and return updated rate
        const [updatedRate] = await db.query('SELECT * FROM entrance_rates WHERE id = ?', [rateId]);

        res.json({
            success: true,
            message: 'Image assigned to rate successfully',
            data: updatedRate[0]
        });
    } catch (err) {
        console.error('Assign image error:', err);
        res.status(500).json({ success: false, message: 'Failed to assign image', error: err.message });
    }
};

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
        const { name, price, age_min, age_max, day_type, start_time, end_time, status, image } = req.body;

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

        // Handle image upload
        let imageUrl = null;
        if (image) {
            const timestamp = Date.now();
            const imageFilename = `rate-${timestamp}.jpg`;
            imageUrl = await saveImage(image, imageFilename);
        }

        const [result] = await db.query(
            `INSERT INTO entrance_rates (name, price, age_min, age_max, day_type, start_time, end_time, status, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, price, age_min || null, age_max || null, day_type, start_time || null, end_time || null, status || 'active', imageUrl]
        );

        // Fetch the created rate
        const [createdRows] = await db.query('SELECT * FROM entrance_rates WHERE id = ?', [result.insertId]);
        const createdRate = createdRows[0];

        res.status(201).json({
            success: true,
            message: 'Entrance rate created successfully',
            data: createdRate
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
        const { name, price, age_min, age_max, day_type, start_time, end_time, status, image } = req.body;

        // Check if rate exists
        const [rateExists] = await db.query('SELECT id, image_url FROM entrance_rates WHERE id = ?', [id]);
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

        // Handle image upload
        let imageUrl = rateExists[0].image_url;
        if (image && image !== rateExists[0].image_url) {
            // Delete old image if it exists
            if (rateExists[0].image_url) {
                await deleteImage(rateExists[0].image_url);
            }

            // Save new image
            if (image.startsWith('data:') || image.length > 100) {
                const timestamp = Date.now();
                const imageFilename = `rate-${timestamp}.jpg`;
                const newImageUrl = await saveImage(image, imageFilename);
                if (newImageUrl) {
                    imageUrl = newImageUrl;
                }
            }
        }

        await db.query(
            `UPDATE entrance_rates 
       SET name = ?, price = ?, age_min = ?, age_max = ?, day_type = ?, start_time = ?, end_time = ?, status = ?, image_url = ?
       WHERE id = ?`,
            [name, price, age_min || null, age_max || null, day_type, start_time || null, end_time || null, status, imageUrl, id]
        );

        // Fetch the updated rate
        const [updatedRows] = await db.query('SELECT * FROM entrance_rates WHERE id = ?', [id]);
        const updatedRate = updatedRows[0];

        res.json({
            success: true,
            message: 'Entrance rate updated successfully',
            data: updatedRate
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
        const [rateExists] = await db.query('SELECT id, image_url FROM entrance_rates WHERE id = ?', [id]);
        if (rateExists.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Entrance rate not found'
            });
        }

        // Delete image if it exists
        if (rateExists[0].image_url) {
            await deleteImageFile(rateExists[0].image_url);
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

        // Fetch the updated rate
        const [updatedRows] = await db.query('SELECT * FROM entrance_rates WHERE id = ?', [id]);
        const updatedRate = updatedRows[0];

        res.json({
            success: true,
            message: `Status changed to ${newStatus}`,
            data: updatedRate
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
