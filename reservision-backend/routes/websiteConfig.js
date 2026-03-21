import express from 'express';
import {
    getAmenitiesConfig,
    getPageConfig,
    saveAmenitiesConfig,
    savePageConfig,
    uploadWebsiteConfigImage
} from '../controllers/websiteConfigController.js';

const router = express.Router();

router.get('/amenities', getAmenitiesConfig);
router.put('/amenities', saveAmenitiesConfig);
router.get('/pages/:pageKey', getPageConfig);
router.put('/pages/:pageKey', savePageConfig);
router.post('/upload-image', uploadWebsiteConfigImage);

export default router;
