import crypto from 'crypto';
import { logSecurityEvent } from '../utils/logger.js';

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

/**
 * Verify Xendit webhook callbacks via x-callback-token header.
 * Requires XENDIT_WEBHOOK_TOKEN to be configured.
 */
export const verifyXenditWebhook = (req, res, next) => {
  const expectedToken = process.env.XENDIT_WEBHOOK_TOKEN;
  const callbackToken = req.headers['x-callback-token'];

  if (!expectedToken) {
    return res.status(500).json({
      success: false,
      error: 'Webhook verification is not configured',
      code: 'WEBHOOK_NOT_CONFIGURED',
    });
  }

  if (!safeEqual(callbackToken, expectedToken)) {
    logSecurityEvent('INVALID_WEBHOOK', {
      provider: 'xendit',
      ip_address: req.ip,
      path: req.originalUrl,
    });
    return res.status(401).json({
      success: false,
      error: 'INVALID_WEBHOOK_SIGNATURE',
    });
  }

  return next();
};
