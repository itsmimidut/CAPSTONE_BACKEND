import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireStaff } from '../middleware/authorize.js';
import { authenticateDisplay } from '../middleware/authenticateDisplay.js';
import {
    postPairRequest,
    postPairDevice,
    getDevices,
    patchDevice,
    patchDeviceStation,
    deleteDevice,
    postHeartbeat,
    getDisplayStatus,
    getCurrentSession,
    getDisplaySessions,
    getPaymentTimeline,
} from '../controllers/customerDisplayController.js';

const router = express.Router();

router.post('/pair-request', authenticateToken, requireStaff, postPairRequest);
router.get('/devices', authenticateToken, requireStaff, getDevices);
router.get('/sessions', authenticateToken, requireStaff, getDisplaySessions);
router.get('/timeline/:receiptNo', authenticateToken, requireStaff, getPaymentTimeline);
router.patch('/devices/:id', authenticateToken, requireStaff, patchDevice);
router.patch('/devices/:id/station', authenticateToken, requireStaff, patchDeviceStation);
router.delete('/devices/:id', authenticateToken, requireStaff, deleteDevice);

router.post('/pair', postPairDevice);
router.get('/current-session', authenticateDisplay, getCurrentSession);
router.post('/heartbeat', authenticateDisplay, postHeartbeat);
router.get('/status', authenticateDisplay, getDisplayStatus);

export default router;
