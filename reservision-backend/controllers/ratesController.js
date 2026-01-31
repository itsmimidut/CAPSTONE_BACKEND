/**
 * ============================================================
 * RATES CONTROLLER
 * ============================================================
 * 
 * PURPOSE:
 * - Provide rates data for RatesPage UI
 * - Support table-based entries (entrance, cottages, packages)
 * - Support card-based sections (function hall)
 * 
 * DATABASE TABLES:
 * - rate_entries: { rate_id, category, label, value }
 * - rate_cards: { card_id, category, title, price, capacity, features, note, icon, cta_text, cta_link, cta_icon, image }
 */

import { db } from '../config/db.js';

/**
 * GET /api/rates/entries
 * Optional query: ?category=entrance|cottages|packages
 */
export const getRateEntries = async (req, res) => {
    try {
        const { category } = req.query;

        let query = 'SELECT rate_id, category, label, value FROM rate_entries';
        const params = [];

        if (category) {
            query += ' WHERE category = ?';
            params.push(category);
        }

        query += ' ORDER BY rate_id ASC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching rate entries:', error);
        res.status(500).json({ message: 'Failed to fetch rate entries' });
    }
};

/**
 * GET /api/rates/cards
 * Optional query: ?category=function
 */
export const getRateCards = async (req, res) => {
    try {
        const { category } = req.query;

        let query = 'SELECT card_id, category, title, price, capacity, features, note, icon, cta_text, cta_link, cta_icon, image FROM rate_cards';
        const params = [];

        if (category) {
            query += ' WHERE category = ?';
            params.push(category);
        }

        query += ' ORDER BY card_id ASC';

        const [rows] = await db.query(query, params);

        const parsed = rows.map(row => ({
            ...row,
            features: row.features ? JSON.parse(row.features) : []
        }));

        res.json(parsed);
    } catch (error) {
        console.error('Error fetching rate cards:', error);
        res.status(500).json({ message: 'Failed to fetch rate cards' });
    }
};
