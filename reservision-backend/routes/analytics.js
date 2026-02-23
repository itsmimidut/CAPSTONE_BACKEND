/**
 * ============================================================
 * Analytics Routes
 * ============================================================
 * 
 * Purpose: Define API endpoints for analytics data
 * Base Path: /api/analytics
 * 
 * Endpoints:
 * - GET /stats - Dashboard statistics
 * - GET /revenue-chart - Revenue trend chart data  
 * - GET /bookings-by-type - Bookings breakdown by type
 */

import express from 'express';
import {
    getStats,
    getRevenueChart,
    getBookingsByType
} from '../controllers/analyticsController.js';

const router = express.Router();

// Get dashboard statistics
router.get('/stats', getStats);

// Get revenue chart data
router.get('/revenue-chart', getRevenueChart);

// Get bookings by type chart data
router.get('/bookings-by-type', getBookingsByType);

export default router;
