import db from '../config/db.js';
import {
  clearAuthCookies,
  getUserSessions,
  revokeAllUserRefreshTokens,
  revokeCurrentRefreshToken,
  revokeSessionById,
  rotateRefreshToken,
} from '../utils/tokenService.js';

/**
 * GET /api/auth/me
 * Return the authenticated user's profile from the access token cookie.
 */
export const getCurrentUser = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone, role
       FROM user
       WHERE user_id = ?
       LIMIT 1`,
      [req.user.id],
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = users[0];

    const [customerRows] = await db.query(
      'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
      [user.user_id],
    );

    return res.json({
      success: true,
      customer: {
        id: user.user_id,
        user_id: user.user_id,
        customerId: customerRows[0]?.customer_id ?? null,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load user profile',
      code: 'ME_ERROR',
    });
  }
};

/**
 * POST /api/auth/refresh
 * Rotate refresh token and issue a new access token cookie.
 */
export const refreshAccessToken = async (req, res) => {
  try {
    const result = await rotateRefreshToken(req, res);

    if (!result) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token',
        code: 'REFRESH_INVALID',
      });
    }

    return res.json({
      success: true,
      message: 'Token refreshed',
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh session',
      code: 'REFRESH_ERROR',
    });
  }
};

/**
 * POST /api/auth/logout
 * Revoke the current refresh token and clear auth cookies.
 */
export const logout = async (req, res) => {
  try {
    await revokeCurrentRefreshToken(req);
    clearAuthCookies(res);

    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    clearAuthCookies(res);
    return res.status(500).json({
      success: false,
      error: 'Failed to logout',
      code: 'LOGOUT_ERROR',
    });
  }
};

/**
 * POST /api/auth/logout-all
 * Revoke every refresh token for the authenticated user.
 */
export const logoutAllSessions = async (req, res) => {
  try {
    const revokedCount = await revokeAllUserRefreshTokens(req.user?.id);
    clearAuthCookies(res);

    return res.json({
      success: true,
      message: 'All sessions revoked',
      revokedCount,
    });
  } catch (error) {
    console.error('Logout-all error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to revoke all sessions',
      code: 'LOGOUT_ALL_ERROR',
    });
  }
};

/**
 * GET /api/auth/sessions
 * List active refresh-token sessions for the authenticated user.
 */
export const listSessions = async (req, res) => {
  try {
    const sessions = await getUserSessions(req.user.id);

    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    console.error('List sessions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load sessions',
      code: 'SESSIONS_ERROR',
    });
  }
};

/**
 * POST /api/auth/revoke-session/:id
 * Revoke a single session owned by the authenticated user.
 */
export const revokeSession = async (req, res) => {
  try {
    const sessionId = Number(req.params.id);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Valid session ID is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const revoked = await revokeSessionById(req.user.id, sessionId);

    if (!revoked) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      message: 'Session terminated',
    });
  } catch (error) {
    console.error('Revoke session error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to revoke session',
      code: 'REVOKE_SESSION_ERROR',
    });
  }
};
