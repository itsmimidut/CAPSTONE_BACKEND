import express from 'express';
import * as tablesController from '../../controllers/tablesController.js';

const router = express.Router();

// GET all tables
router.get('/', tablesController.getAllTables);

// GET single table
router.get('/:id', tablesController.getTable);

// POST create table
router.post('/', tablesController.createTable);

// PUT update table
router.put('/:id', tablesController.updateTable);

// PATCH update table status
router.patch('/:id/status', tablesController.updateTableStatus);

// DELETE table
router.delete('/:id', tablesController.deleteTable);

export default router;
