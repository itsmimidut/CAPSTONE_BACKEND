const parseOrigins = (value = '') =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

const developmentOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const productionOrigins = [
  ...parseOrigins(process.env.FRONTEND_URL),
  ...parseOrigins(process.env.VITE_FRONTEND_URL),
].filter(Boolean);

export const allowedOrigins = isProduction
  ? [...new Set(productionOrigins)]
  : [...new Set([...developmentOrigins, ...productionOrigins])];

export const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
  optionsSuccessStatus: 204,
};

export const corsErrorHandler = (err, req, res, next) => {
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'Origin not allowed',
      code: 'CORS_FORBIDDEN',
    });
  }
  return next(err);
};
