import express from 'express';
import {
  getStats,
  getRevenueChart,
  getBookingsByType,
  getOverview,
  getRevenue,
  getBookingsAnalytics,
  getGuests,
  getSwimming,
  getPos,
  getShop,
  getPromos,
  getOccupancy,
} from '../controllers/analyticsController.js';

const router = express.Router();

// Phase 7A system-wide analytics
router.get('/overview', getOverview);
router.get('/revenue', getRevenue);
router.get('/bookings', getBookingsAnalytics);
router.get('/guests', getGuests);
router.get('/swimming', getSwimming);
router.get('/pos', getPos);
router.get('/shop', getShop);
router.get('/promos', getPromos);
router.get('/occupancy', getOccupancy);

// Legacy dashboard analytics (AdminDashboard)
router.get('/stats', getStats);
router.get('/revenue-chart', getRevenueChart);
router.get('/bookings-by-type', getBookingsByType);

export default router;
