import express from 'express';
import * as menuController from '../../controllers/menuController.js';

const router = express.Router();

// GET all menu items
router.get('/', menuController.getAllMenuItems);

// GET categories
router.get('/categories', menuController.getCategories);

// GET menu by category
router.get('/category/:category', menuController.getMenuByCategory);

// GET single menu item
router.get('/:id', menuController.getMenuItem);

// POST create menu item
router.post('/', menuController.createMenuItem);

// PUT update menu item
router.put('/:id', menuController.updateMenuItem);

// PATCH toggle menu item availability
router.patch('/:id/availability', menuController.toggleMenuItemAvailability);

// DELETE menu item
router.delete('/:id', menuController.deleteMenuItem);

export default router;
