import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireAdmin, requireStaff } from '../middleware/authorize.js';
import {
    getPosStations,
    postPosStation,
    patchPosStation,
    deletePosStation,
} from '../controllers/posStationController.js';

const router = express.Router();

router.get('/', authenticateToken, requireStaff, getPosStations);
router.post('/', authenticateToken, requireAdmin, postPosStation);
router.patch('/:id', authenticateToken, requireAdmin, patchPosStation);
router.delete('/:id', authenticateToken, requireAdmin, deletePosStation);

export default router;
