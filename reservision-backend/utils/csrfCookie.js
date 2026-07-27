import crypto from 'crypto';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export const generateCsrfToken = () => crypto.randomBytes(32).toString('base64url');

export const getCsrfCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: false,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  };
};

export const setCsrfCookie = (res, token) => {
  res.cookie(CSRF_COOKIE_NAME, token, getCsrfCookieOptions());
};
