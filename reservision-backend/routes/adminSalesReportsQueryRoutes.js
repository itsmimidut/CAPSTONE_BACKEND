import express from 'express';
import { getSalesReports, exportSalesReportTransactionsCsv, getSalesReportExportData, getSalesReportDetails } from '../controllers/adminSalesReportController.js';

const router = express.Router();

router.get('/', getSalesReports);
router.get('/export/csv', exportSalesReportTransactionsCsv);
router.get('/export/data', getSalesReportExportData);
router.get('/details', getSalesReportDetails);

export default router;
