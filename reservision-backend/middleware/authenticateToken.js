import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { ACCESS_TOKEN_COOKIE_NAME } from '../utils/accessTokenCookie.js';
import { logAuthEvent } from '../utils/logger.js';
import { requireAdmin, requireDashboardAccess, requireRole, requireStaff } from './authorize.js';

const normalizePath = (req) => {
  const raw = req.originalUrl || req.url || req.path || '';
  return raw.split('?')[0].replace(/\/+$/, '') || '/';
};

const PUBLIC_CUSTOMER_ROUTES = new Set([
  'POST /api/customers/signup',
  'POST /api/customers/login',
  'POST /api/customers/google-login',
  'POST /api/customers/reset-password',
]);

const isPublicCustomerRoute = (req) => {
  const path = normalizePath(req);
  const key = `${req.method.toUpperCase()} ${path}`;

  if (PUBLIC_CUSTOMER_ROUTES.has(key)) {
    return true;
  }

  if (req.method.toUpperCase() === 'GET' && /^\/api\/customers\/check-email\/[^/]+$/.test(path)) {
    return true;
  }

  return false;
};

const isPublicBookingRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'POST' && (
    path === '/api/bookings/confirm' ||
    path === '/api/bookings' ||
    path === '/api/bookings/with-auto-assign'
  )) {
    return true;
  }

  if (method === 'GET') {
    if (path === '/api/bookings/occupied-dates') return true;
    if (/^\/api\/bookings\/occupied-dates\/[^/]+$/.test(path)) return true;
  }

  return false;
};

const isStaffOnlyBookingRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'GET' && (
    path === '/api/bookings' ||
    path === '/api/bookings/admin/reservations' ||
    /^\/api\/bookings\/validate\/[^/]+$/.test(path)
  )) {
    return true;
  }

  if (method === 'PUT' && /^\/api\/bookings\/\d+$/.test(path)) return true;
  if (method === 'DELETE' && /^\/api\/bookings\/\d+$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/bookings\/\d+\/(check-in|check-out)$/.test(path)) return true;

  return false;
};

const isPublicSwimmingRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'GET' && (
    path === '/api/swimming/page-data' ||
    path === '/api/swimming/batches' ||
    path === '/api/swimming/batch-schedules' ||
    /^\/api\/swimming\/batches\/\d+\/sessions$/.test(path) ||
    path === '/api/swimming/coaches' ||
    /^\/api\/swimming\/coaches\/[^/]+$/.test(path) ||
    path === '/api/swimming/class-bookings'
  )) {
    return true;
  }

  if (method === 'POST' && (
    path === '/api/swimming/class-bookings'
  )) {
    return true;
  }

  return false;
};

const isPublicPosRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'GET' && (
    path === '/api/pos/items' ||
    /^\/api\/pos\/items\/category\/[^/]+$/.test(path)
  )) {
    return true;
  }

  // Android Bluetooth bridge — auth via deviceCode + pairingToken inside handlers
  if (method === 'POST' && path === '/api/pos/print-bridge/register') return true;
  if (method === 'POST' && path === '/api/pos/print-bridge/heartbeat') return true;
  if (method === 'POST' && path === '/api/pos/print-bridge/printers/report') return true;
  if (method === 'GET' && path === '/api/pos/print-bridge/jobs') return true;
  if (method === 'POST' && /^\/api\/pos\/print-bridge\/jobs\/[^/]+\/claim$/.test(path)) return true;
  if (method === 'GET' && /^\/api\/pos\/print-bridge\/jobs\/[^/]+\/payload$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/pos\/print-bridge\/jobs\/[^/]+\/completed$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/pos\/print-bridge\/jobs\/[^/]+\/failed$/.test(path)) return true;

  return false;
};

const isCustomerPosRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  return (
    (method === 'POST' && path === '/api/pos/eshop/order') ||
    (method === 'GET' && path === '/api/pos/orders/me') ||
    (method === 'GET' && /^\/api\/pos\/orders\/\d+\/fulfillment-timeline$/.test(path)) ||
    (method === 'GET' && /^\/api\/pos\/orders\/customer\/\d+$/.test(path))
  );
};

const isPublicRoomsRoute = (req) => {
  const path = normalizePath(req);
  return req.method.toUpperCase() === 'GET' && (
    path === '/api/rooms' ||
    path === '/api/rooms/grouped' ||
    /^\/api\/rooms\/[^/]+$/.test(path)
  );
};

const isPublicPromosRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();
  return (method === 'GET' && path === '/api/promos') ||
    (method === 'POST' && path === '/api/promos/validate');
};

const isPublicEntranceRatesRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'GET' && (
    path === '/api/entrance-rates' ||
    path === '/api/entrance-rates/by-date' ||
    path === '/api/entrance-rates/images' ||
    /^\/api\/entrance-rates\/[^/]+$/.test(path)
  )) {
    return true;
  }

  return false;
};

const isPublicWebsiteConfigRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (method === 'GET' && (
    path === '/api/website-config/amenities' ||
    /^\/api\/website-config\/pages\/[^/]+$/.test(path)
  )) {
    return true;
  }

  return false;
};

const isPublicRestaurantMenuRoute = (req) => {
  const path = normalizePath(req);
  const method = req.method.toUpperCase();

  if (!path.startsWith('/api/restaurant/menu')) {
    return false;
  }

  return method === 'GET';
};

/**
 * Read JWT from HttpOnly cookie or Authorization: Bearer (legacy compatibility).
 */
const extractAccessToken = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (authHeader && String(authHeader).startsWith('Bearer ')) {
    const bearerToken = String(authHeader).slice(7).trim();
    if (bearerToken) {
      return bearerToken;
    }
  }

  const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  if (cookieToken) {
    return cookieToken;
  }

  return null;
};

/**
 * Verify JWT from cookie or Authorization header.
 * - 401 when token is missing, invalid, or expired
 */
export const authenticateToken = (req, res, next) => {
  const token = extractAccessToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required',
      code: 'TOKEN_MISSING',
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name,
    };
    return next();
  } catch (error) {
    if (error.message?.includes('JWT_SECRET')) {
      console.error('JWT configuration error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Authentication service is not configured',
        code: 'AUTH_CONFIG_ERROR',
      });
    }

    if (error.name === 'TokenExpiredError') {
      logAuthEvent('TOKEN_EXPIRED', {
        ip_address: req.ip,
        path: req.originalUrl,
      });
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    logAuthEvent('TOKEN_INVALID', {
      ip_address: req.ip,
      path: req.originalUrl,
    });
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'TOKEN_INVALID',
    });
  }
};

export const requireCustomerAuth = (req, res, next) => {
  if (isPublicCustomerRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, next);
};

export const requireBookingAuth = (req, res, next) => {
  if (isPublicBookingRoute(req)) {
    return next();
  }

  return authenticateToken(req, res, () => {
    if (isStaffOnlyBookingRoute(req)) {
      return requireStaff(req, res, next);
    }
    return next();
  });
};

export const requireAdminAuth = [authenticateToken, requireAdmin];

export const requireNotificationAuth = [authenticateToken, requireDashboardAccess];

export const requireProfileAuth = authenticateToken;

export const requireAnalyticsAuth = [authenticateToken, requireDashboardAccess];

export const requireUsersAuth = [authenticateToken, requireAdmin];

export const requirePosAuth = (req, res, next) => {
  if (isPublicPosRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => {
    if (isCustomerPosRoute(req)) {
      return next();
    }
    return requireStaff(req, res, next);
  });
};

export const requireRoomsAuth = (req, res, next) => {
  if (isPublicRoomsRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => requireAdmin(req, res, next));
};

export const requirePromosAuth = (req, res, next) => {
  if (isPublicPromosRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => requireAdmin(req, res, next));
};

export const requireEntranceRatesAuth = (req, res, next) => {
  if (isPublicEntranceRatesRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => requireAdmin(req, res, next));
};

export const requireWebsiteConfigAuth = (req, res, next) => {
  if (isPublicWebsiteConfigRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => requireAdmin(req, res, next));
};

export const requireRestaurantAuth = [authenticateToken, requireStaff];

export const requireRestaurantMenuAuth = (req, res, next) => {
  if (isPublicRestaurantMenuRoute(req)) {
    return next();
  }
  return authenticateToken(req, res, () => requireStaff(req, res, next));
};

export const requireSeasonsAuth = [authenticateToken, requireAdmin];

export const requirePredictionAuth = [authenticateToken, requireDashboardAccess];

export const requireSwimmingAuth = (req, res, next) => {
  if (isPublicSwimmingRoute(req)) {
    return next();
  }

  const path = normalizePath(req);

  return authenticateToken(req, res, () => {
    if (path.includes('/admin/')) {
      return requireStaff(req, res, next);
    }

    if (/^\/api\/swimming\/batches\/\d+\/(generate-sessions|regenerate)$/.test(path)) {
      return requireStaff(req, res, next);
    }

    if (
      req.method.toUpperCase() !== 'GET' &&
      (path === '/api/swimming/coaches' || /^\/api\/swimming\/coaches\/[^/]+$/.test(path))
    ) {
      return requireStaff(req, res, next);
    }

    if (path.includes('/instructor/')) {
      return requireRole('admin', 'receptionist', 'swimming_instructor')(req, res, next);
    }

    return next();
  });
};

export const requireCustomerRefundAuth = [authenticateToken];
