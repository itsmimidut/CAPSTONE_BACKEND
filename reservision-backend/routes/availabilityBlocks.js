import express from 'express';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireStaff } from '../middleware/authorize.js';
import {
  createBlockController,
  deleteBlockController,
  getBlockController,
  getBlockTypesController,
  listBlocksController,
  updateBlockController,
} from '../controllers/availabilityBlocksController.js';

const router = express.Router();

router.use(authenticateToken, requireStaff);

router.get('/types', getBlockTypesController);
router.get('/', listBlocksController);
router.get('/:id', getBlockController);
router.post('/', createBlockController);
router.put('/:id', updateBlockController);
router.delete('/:id', deleteBlockController);

export default router;
