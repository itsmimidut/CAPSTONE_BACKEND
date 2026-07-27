import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireStaff } from '../middleware/authorize.js';
import {
    getPosStations,
    postPosStation,
    patchPosStation,
    deletePosStation,
} from '../controllers/posStationController.js';

const router = express.Router();

router.get('/', authenticateToken, requireStaff, getPosStations);
router.post('/', authenticateToken, requireStaff, postPosStation);
router.patch('/:id', authenticateToken, requireStaff, patchPosStation);
router.delete('/:id', authenticateToken, requireStaff, deletePosStation);

export default router;
