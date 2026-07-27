import express from 'express';
import * as receiptSettingsController from '../controllers/receiptSettingsController.js';

const router = express.Router();

router.get('/', receiptSettingsController.getReceiptSettingsHandler);
router.patch('/', receiptSettingsController.updateReceiptSettingsHandler);
router.post('/reset', receiptSettingsController.resetReceiptSettingsHandler);
router.post(
  '/logo',
  (req, res, next) => {
    receiptSettingsController.receiptLogoUpload.single('logo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Failed to upload logo.',
        });
      }
      return next();
    });
  },
  receiptSettingsController.uploadReceiptLogoHandler
);
router.delete('/logo/:logoType', receiptSettingsController.removeReceiptLogoHandler);
router.post('/test-print', receiptSettingsController.testReceiptSettingsPrintHandler);

export default router;
