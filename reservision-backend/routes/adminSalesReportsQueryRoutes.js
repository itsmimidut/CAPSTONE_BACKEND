import express from 'express';
import { getSalesReports, exportSalesReportTransactionsCsv } from '../controllers/adminSalesReportController.js';

const router = express.Router();

router.get('/', getSalesReports);
router.get('/export/csv', exportSalesReportTransactionsCsv);

export default router;
