import { validationResult } from 'express-validator';

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  const formatted = errors.array().map((error) => ({
    field: error.path || error.param,
    message: error.msg,
  }));

  return res.status(400).json({
    success: false,
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    errors: formatted,
  });
};
