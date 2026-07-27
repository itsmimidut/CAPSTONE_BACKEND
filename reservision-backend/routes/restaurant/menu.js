import express from 'express';
import * as menuController from '../../controllers/menuController.js';

const router = express.Router();

// Multer for menu image uploads. Without this, multipart FormData leaves
// req.body empty under Express JSON/urlencoded parsers.
const handleMenuImageUpload = (req, res, next) => {
  menuController.menuImageUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid menu image upload.',
        error: err.message,
      });
    }
    req.body = req.body || {};
    next();
  });
};

// GET all menu items
router.get('/', menuController.getAllMenuItems);

// GET categories
router.get('/categories', menuController.getCategories);

// GET menu by category
router.get('/category/:category', menuController.getMenuByCategory);

// GET single menu item
router.get('/:id', menuController.getMenuItem);

// POST create menu item (supports multipart image upload)
router.post('/', handleMenuImageUpload, menuController.createMenuItem);

// PUT update menu item (supports multipart image upload)
router.put('/:id', handleMenuImageUpload, menuController.updateMenuItem);

// PATCH toggle menu item availability
router.patch('/:id/availability', menuController.toggleMenuItemAvailability);

// DELETE menu item
router.delete('/:id', menuController.deleteMenuItem);

export default router;
