import rateLimit from 'express-rate-limit';
import { logSecurityEvent } from '../utils/logger.js';

const isProduction = process.env.NODE_ENV === 'production';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const jsonMessage = (error, code = 'RATE_LIMITED') => ({
  success: false,
  error,
  code,
});

const createLimiter = ({
  windowMs,
  max,
  devMax,
  error,
  skipSuccessfulRequests = false,
}) => {
  const resolvedMax = isProduction
    ? max
    : parsePositiveInt(process.env.RATE_LIMIT_DEV_MAX, devMax ?? max * 10);

  return rateLimit({
    windowMs,
    max: resolvedMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: jsonMessage(error),
    handler: (req, res, _next, options) => {
      logSecurityEvent('RATE_LIMIT_TRIGGERED', {
        ip_address: req.ip,
        path: req.originalUrl,
        method: req.method,
      });
      res.status(429).json(options.message);
    },
  });
};

export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  devMax: 100,
  skipSuccessfulRequests: true,
  error: 'Too many login attempts. Please wait 15 minutes and try again.',
});

export const googleLoginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  devMax: 100,
  skipSuccessfulRequests: true,
  error: 'Too many Google sign-in attempts. Please wait 15 minutes and try again.',
});

export const otpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 3,
  devMax: 30,
  error: 'Too many OTP requests. Please try again later.',
});

export const signupLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  error: 'Too many signup attempts. Please try again later.',
});

export const passwordResetLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  error: 'Too many password reset attempts. Please try again later.',
});

export const bookingConfirmLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  error: 'Too many booking requests. Please try again later.',
});

export const paymentCreateLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  devMax: 100,
  error: 'Too many payment requests. Please try again later.',
});

/** Polling fallback after checkout — higher limit than create-payment */
export const paymentConfirmLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  devMax: 300,
  error: 'Too many payment confirmation attempts. Please wait a moment and try again.',
});

export const bookingLookupLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  devMax: 200,
  error: 'Too many booking lookup requests. Please try again later.',
});

export const paymentStatusLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  devMax: 300,
  error: 'Too many payment status requests. Please try again later.',
});

export const adminNotificationsLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 60,
  devMax: 300,
  error: 'Too many notification requests. Please try again later.',
});

export const customerNotificationsLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 80,
  devMax: 400,
  error: 'Too many notification requests. Please try again later.',
});

export const chatbotGroqLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  devMax: 200,
  error: 'Too many chat requests. Please wait a few minutes and try again.',
});

export const chatbotChatLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  devMax: 300,
  error: 'Too many chat requests. Please wait a few minutes and try again.',
});
