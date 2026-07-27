const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const ACCESS_TOKEN_COOKIE_NAME = 'access_token';

export const getAccessTokenCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    maxAge: FIFTEEN_MINUTES_MS,
    path: '/',
  };
};

export const setAccessTokenCookie = (res, token) => {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, token, getAccessTokenCookieOptions());
};

export const clearAccessTokenCookie = (res) => {
  const { maxAge, ...options } = getAccessTokenCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, options);
};
