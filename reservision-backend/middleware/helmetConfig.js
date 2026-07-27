import helmet from 'helmet';

const isProduction = process.env.NODE_ENV === 'production';

const frontendOrigins = [
  process.env.FRONTEND_URL,
  process.env.VITE_FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);

export const helmetMiddleware = helmet({
  contentSecurityPolicy: isProduction
    ? {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", ...frontendOrigins, 'https://api.xendit.co'],
          frameSrc: ["'self'", 'https://checkout.xendit.co'],
          formAction: ["'self'", ...frontendOrigins],
          upgradeInsecureRequests: [],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: isProduction
    ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
