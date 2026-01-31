import express from 'express';
import * as ordersController from '../../controllers/ordersController.js';

const router = express.Router();

// GET all orders
router.get('/', ordersController.getAllOrders);

// GET single order with items
router.get('/:id', ordersController.getOrder);

// GET orders by table
router.get('/table/:tableId', ordersController.getOrdersByTable);

// POST create order
router.post('/', ordersController.createOrder);

// PATCH update order status
router.patch('/:id/status', ordersController.updateOrderStatus);

// DELETE order
router.delete('/:id', ordersController.deleteOrder);

export default router;
