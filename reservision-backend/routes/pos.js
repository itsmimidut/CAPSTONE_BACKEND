import express from 'express';
import * as posController from '../controllers/posController.js';
import * as eshopFulfillmentController from '../controllers/eshopFulfillmentController.js';
import * as posOrderSessionController from '../controllers/posOrderSessionController.js';
import posPrinterSettingsRoutes from '../routes/posPrinterSettingsRoutes.js';
import receiptSettingsRoutes from '../routes/receiptSettingsRoutes.js';
import printBridgeRoutes from '../routes/printBridgeRoutes.js';
import { requireStaff } from '../middleware/authorize.js';

const router = express.Router();

// GET all POS transactions
router.get('/transactions', posController.getAllTransactions);

// GET single transaction
router.get('/transactions/:id', posController.getTransaction);

// POST create new transaction
router.post('/transactions', posController.createTransaction);

// Start/cancel a cashier order before items and payment are submitted.
router.post('/orders/start', requireStaff, posOrderSessionController.startOrder);
router.patch('/orders/:id/cancel', requireStaff, posOrderSessionController.cancelOrder);

// POST void transaction (replaces delete)
router.post('/transactions/:id/void', posController.voidPosTransaction);

// POST create e-shop order (with delivery location)
router.post('/eshop/order', posController.createEshopOrder);

// Dedicated staff E-Shop fulfillment workspace
router.get('/eshop/orders', requireStaff, eshopFulfillmentController.listEshopOrders);
router.get('/eshop/orders/:id', requireStaff, eshopFulfillmentController.getEshopOrder);
router.patch('/eshop/orders/:id/fulfillment-status', requireStaff, eshopFulfillmentController.patchFulfillmentStatus);
router.patch('/eshop/orders/:id/cancel', requireStaff, eshopFulfillmentController.cancelEshopOrder);

// GET authenticated customer's E-Shop order history (preferred)
router.get('/orders/me', posController.getMyEshopOrders);
router.get('/orders/:id/fulfillment-timeline', eshopFulfillmentController.getMyOrderTimeline);

// GET customer order history by customer_id (staff or ownership check)
router.get('/orders/customer/:customerId', posController.getCustomerOrders);

// DELETE transaction
router.delete('/transactions/:id', posController.deleteTransaction);

// DELETE all transactions (clear history)
router.delete('/transactions', posController.clearAllTransactions);

// GET POS items/services catalog
router.get('/items', posController.getAllItems);

// GET items by category
router.get('/items/category/:category', posController.getItemsByCategory);

// GET top POS items for reporting
router.get('/top-items', posController.getTopPosItems);

// ============================================================
// THERMAL PRINTER ROUTES
// ============================================================

// Print job tracking
router.get('/print-jobs/:jobId', posController.getPrintJobStatus);
router.post('/print-jobs/:jobId/retry', posController.retryPrintJob);

// Secure print — receipt data rebuilt server-side from database
// Deprecated literal routes must be registered before /print/:receiptNo
router.post('/print/booking', posController.printBookingReceipt);
router.post('/print/regular', posController.printRegularReceipt);
router.get('/print/:receiptNo/jobs', posController.getPrintJobsByReceipt);
router.post('/print/:receiptNo', posController.printReceiptSecure);

// GET test printer connection
router.get('/printer/test', posController.testPrinter);

// GET pending print jobs in queue
router.get('/printer/queue', posController.getPrintJobsQueue);

// Printer & receipt settings (MVP)
router.use('/printers', posPrinterSettingsRoutes);
router.use('/receipt-settings', receiptSettingsRoutes);
router.use('/print-bridge', printBridgeRoutes);

export default router;
