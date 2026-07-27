import crypto from 'crypto';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  generateCsrfToken,
  setCsrfCookie,
} from '../utils/csrfCookie.js';
import { logSecurityEvent } from '../utils/logger.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const normalizePath = (req) => {
  const raw = req.originalUrl || req.url || req.path || '';
  return raw.split('?')[0].replace(/\/+$/, '') || '/';
};

const CSRF_EXCLUDED_PATHS = [
  '/api/xendit/webhook',
  '/api/customer-display/pair',
  '/api/customer-display/heartbeat',
  // Print Connector (Windows/Android) machine-to-machine endpoints.
  // These authenticate via deviceCode + pairingToken, not browser cookies,
  // so the CSRF double-submit check cannot apply. Admin /devices routes
  // are NOT excluded and keep JWT + CSRF protection.
  '/api/pos/print-bridge/register',
  '/api/pos/print-bridge/heartbeat',
  '/api/pos/print-bridge/printers/report',
  '/api/pos/print-bridge/jobs',
];

const isCsrfExcluded = (path) =>
  CSRF_EXCLUDED_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

const safeEqual = (left, right) => {
  if (!left || !right) {
    return false;
  }

  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const ensureCsrfCookie = (req, res, next) => {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token) {
    token = generateCsrfToken();
    setCsrfCookie(res, token);
  }

  // Expose token in response header so cross-origin frontends (e.g. localhost:5173
  // vs localhost:8000, or ngrok) can read it — document.cookie cannot see cookies
  // set by a different origin/port in those setups.
  res.setHeader('X-CSRF-Token', token);
  next();
};

export const validateCsrf = (req, res, next) => {
  const method = req.method.toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) {
    return next();
  }

  const path = normalizePath(req);
  if (isCsrfExcluded(path)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers['X-CSRF-Token'];

  if (!cookieToken || !headerToken) {
    logSecurityEvent('CSRF_FAILED', {
      reason: 'CSRF_MISSING',
      path,
      method,
      ip_address: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: 'CSRF token missing',
      code: 'CSRF_MISSING',
    });
  }

  if (!safeEqual(cookieToken, headerToken)) {
    logSecurityEvent('CSRF_FAILED', {
      reason: 'CSRF_INVALID',
      path,
      method,
      ip_address: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: 'CSRF token invalid',
      code: 'CSRF_INVALID',
    });
  }

  return next();
};
