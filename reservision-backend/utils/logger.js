import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: { service: 'reservision-backend' },
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logsDir, 'security.log'), level: 'warn' }),
    new winston.transports.File({ filename: path.join(logsDir, 'combined.log') }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }));
}

export const logSecurityEvent = (action, meta = {}) => {
  logger.warn({
    category: 'security',
    action,
    ...meta,
  });
};

export const logAuthEvent = (action, meta = {}) => {
  logger.info({
    category: 'authentication',
    action,
    ...meta,
  });
};

export const logPaymentEvent = (action, meta = {}) => {
  logger.info({
    category: 'payment',
    action,
    ...meta,
  });
};

export const logSystemEvent = (action, meta = {}, level = 'error') => {
  logger.log(level, {
    category: 'system',
    action,
    ...meta,
  });
};

export const morganStream = {
  write: (message) => {
    logger.info({ category: 'http', message: message.trim() });
  },
};

export default logger;
