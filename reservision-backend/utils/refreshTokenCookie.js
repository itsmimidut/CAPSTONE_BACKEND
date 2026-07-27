const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

export const getRefreshTokenCookieOptions = (rememberMe = true) => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    ...(rememberMe ? { maxAge: THIRTY_DAYS_MS } : {}),
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
};

export const setRefreshTokenCookie = (res, token, rememberMe = true) => {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, getRefreshTokenCookieOptions(rememberMe));
};

export const clearRefreshTokenCookie = (res) => {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    path: REFRESH_TOKEN_COOKIE_PATH,
  });
};
