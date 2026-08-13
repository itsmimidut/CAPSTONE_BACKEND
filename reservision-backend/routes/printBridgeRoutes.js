import express from 'express';
import * as printBridgeController from '../controllers/printBridgeController.js';

const router = express.Router();

// Android bridge device routes (auth via deviceCode + pairingToken)
router.post('/register', printBridgeController.registerBridgeDeviceHandler);
router.post('/heartbeat', printBridgeController.heartbeatHandler);
router.post('/printers/report', printBridgeController.reportConnectorPrintersHandler);
router.get('/jobs', printBridgeController.listBridgeJobsHandler);
router.post('/jobs/:id/claim', printBridgeController.claimBridgeJobHandler);
router.get('/jobs/:id/payload', printBridgeController.getBridgeJobPayloadHandler);
router.post('/jobs/:id/completed', printBridgeController.completeBridgeJobHandler);
router.post('/jobs/:id/failed', printBridgeController.failBridgeJobHandler);

// Admin routes (staff JWT via requirePosAuth on /api/pos)
router.get('/devices', printBridgeController.listBridgeDevicesHandler);
router.post('/devices', printBridgeController.createAdminBridgeDeviceHandler);
router.patch('/devices/:id', printBridgeController.updateBridgeDeviceHandler);
router.post('/devices/:id/deactivate', printBridgeController.deactivateBridgeDeviceHandler);
router.post('/devices/:id/regenerate-token', printBridgeController.regenerateBridgeDeviceTokenHandler);

export default router;
