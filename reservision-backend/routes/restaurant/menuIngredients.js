import express from 'express';
import * as menuIngredientsController from '../../controllers/menuIngredientsController.js';

const router = express.Router();

// Get all ingredients for a specific menu item
router.get('/menu/:menuId/ingredients', menuIngredientsController.getMenuIngredients);

// Get all menu items with their ingredients
router.get('/menu-with-ingredients', menuIngredientsController.getAllMenuWithIngredients);

// Check if menu item can be prepared
router.get('/menu/:menuId/check-availability', menuIngredientsController.checkMenuAvailability);

// Add ingredient to a menu item
router.post('/menu/:menuId/ingredients', menuIngredientsController.addMenuIngredient);

// Update ingredient quantity for a menu item
router.put('/menu-ingredients/:id', menuIngredientsController.updateMenuIngredient);

// Delete ingredient from a menu item
router.delete('/menu-ingredients/:id', menuIngredientsController.deleteMenuIngredient);

export default router;
