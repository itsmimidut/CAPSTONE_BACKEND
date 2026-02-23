import express from 'express';
import { getSalesReport } from '../../controllers/salesReportController.js';

const router = express.Router();

// GET sales report (summary, breakdown, top items, trends)
router.get('/report', getSalesReport);

export default router;
