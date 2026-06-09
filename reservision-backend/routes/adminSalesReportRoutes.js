import express from 'express';
import {
    getSalesAnalytics,
    exportSalesAnalyticsCSV,
    getRefundSummary,
    getTopMenuItems
} from '../controllers/adminSalesReportController.js';

const router = express.Router();

router.get('/sales-analytics', getSalesAnalytics);
router.get('/sales-analytics/export', exportSalesAnalyticsCSV);
router.get('/sales-refund-summary', getRefundSummary);
router.get('/top-menu-items', getTopMenuItems);

export default router;
