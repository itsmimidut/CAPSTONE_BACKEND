import express from 'express';
import * as posPrinterSettingsController from '../controllers/posPrinterSettingsController.js';

const router = express.Router();

router.get('/', posPrinterSettingsController.listPrinters);
router.post('/', posPrinterSettingsController.createPrinterHandler);
router.get('/default', posPrinterSettingsController.getDefaultPrinterHandler);
router.get('/auto-print-status', posPrinterSettingsController.getAutoPrintStatus);
router.post('/test-print', posPrinterSettingsController.testPrinterPreviewHandler);
router.get('/:id', posPrinterSettingsController.getPrinterHandler);
router.patch('/:id', posPrinterSettingsController.updatePrinterHandler);
router.delete('/:id', posPrinterSettingsController.deletePrinterHandler);
router.post('/:id/set-default', posPrinterSettingsController.setDefaultPrinterHandler);
router.post('/:id/test-print', posPrinterSettingsController.testPrinterHandler);

export default router;
