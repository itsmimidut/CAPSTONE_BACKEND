import express from 'express';
import * as posController from '../controllers/posController.js';

const router = express.Router();

// GET all POS transactions
router.get('/transactions', posController.getAllTransactions);

// GET single transaction
router.get('/transactions/:id', posController.getTransaction);

// POST create new transaction
router.post('/transactions', posController.createTransaction);

// DELETE transaction
router.delete('/transactions/:id', posController.deleteTransaction);

// DELETE all transactions (clear history)
router.delete('/transactions', posController.clearAllTransactions);

// GET POS items/services catalog
router.get('/items', posController.getAllItems);

// GET items by category
router.get('/items/category/:category', posController.getItemsByCategory);

export default router;
