import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireStaff } from '../middleware/authorize.js';
import {
    getPosTerminalSettings,
    patchPosTerminalSettings,
} from '../controllers/posTerminalController.js';

const router = express.Router();

router.get('/settings', authenticateToken, requireStaff, getPosTerminalSettings);
router.patch('/settings', authenticateToken, requireStaff, patchPosTerminalSettings);

export default router;
