import express from 'express';
import {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    changeUserRole,
    getUserStats
} from '../controllers/userManagementController.js';

const router = express.Router();

/**
 * ============================================================
 * USER MANAGEMENT ROUTES
 * ============================================================
 * Base URL: /api/users
 * 
 * All routes should be protected with admin authentication middleware
 * Example: router.get('/', authenticateAdmin, getAllUsers);
 */

// Get user statistics
router.get('/stats', getUserStats);

// Get all users with filtering and pagination
// GET /api/users?page=1&limit=10&role=customer&search=john
router.get('/', getAllUsers);

// Get single user by ID
router.get('/:id', getUserById);

// Create new user
router.post('/', createUser);

// Update user
router.put('/:id', updateUser);

// Delete user
router.delete('/:id', deleteUser);

// Change user role
router.patch('/:id/role', changeUserRole);

export default router;
