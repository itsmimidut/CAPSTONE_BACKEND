import express from 'express';
import {
  getCurrentUser,
  listSessions,
  logout,
  logoutAllSessions,
  refreshAccessToken,
  revokeSession,
} from '../controllers/authController.js';
import { authenticateToken } from '../middleware/authenticateToken.js';

const router = express.Router();

router.get('/me', authenticateToken, getCurrentUser);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);
router.post('/logout-all', authenticateToken, logoutAllSessions);
router.get('/sessions', authenticateToken, listSessions);
router.post('/revoke-session/:id', authenticateToken, revokeSession);

export default router;
