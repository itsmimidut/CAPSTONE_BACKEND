import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { getJwtSecret } from './jwtSecret.js';
import { clearAccessTokenCookie, setAccessTokenCookie } from './accessTokenCookie.js';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './refreshTokenCookie.js';
import { parseUserAgent } from './userAgentParser.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const createAccessToken = (user) => {
  const userId = user.id ?? user.user_id;

  return jwt.sign(
    {
      id: userId,
      email: user.email,
      role: user.role,
      name: user.name ?? `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    },
    getJwtSecret(),
    { expiresIn: '15m' },
  );
};

export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');

const getClientMeta = (req) => ({
  userAgent: req.headers['user-agent'] || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
});

export const storeRefreshToken = async (userId, plainToken, req) => {
  const tokenHash = hashRefreshToken(plainToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const { userAgent, ipAddress } = getClientMeta(req);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, last_used_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [userId, tokenHash, expiresAt, userAgent, ipAddress],
  );

  return plainToken;
};

export const issueAuthSession = async (res, user, req, { rememberMe = true } = {}) => {
  const userId = user.id ?? user.user_id;
  const accessToken = createAccessToken({ ...user, id: userId });
  const refreshToken = generateRefreshToken();

  await storeRefreshToken(userId, refreshToken, req);
  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, refreshToken, rememberMe);
};

export const clearAuthCookies = (res) => {
  clearAccessTokenCookie(res);
  clearRefreshTokenCookie(res);
};

export const revokeRefreshTokenByPlain = async (plainToken) => {
  if (!plainToken) {
    return false;
  }

  const tokenHash = hashRefreshToken(plainToken);
  const [result] = await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = ? AND revoked_at IS NULL`,
    [tokenHash],
  );

  return result.affectedRows > 0;
};

export const revokeCurrentRefreshToken = async (req) => {
  const plainToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  return revokeRefreshTokenByPlain(plainToken);
};

export const revokeAllUserRefreshTokens = async (userId) => {
  if (!userId) {
    return 0;
  }

  const [result] = await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );

  return result.affectedRows;
};

export const rotateRefreshToken = async (req, res) => {
  const plainToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (!plainToken) {
    return null;
  }

  const tokenHash = hashRefreshToken(plainToken);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    );

    if (rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const record = rows[0];
    const isExpired = new Date(record.expires_at) <= new Date();

    if (record.revoked_at || isExpired) {
      await connection.rollback();
      return null;
    }

    await connection.query(
      'UPDATE refresh_tokens SET last_used_at = NOW() WHERE id = ?',
      [record.id],
    );

    await connection.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?',
      [record.id],
    );

    const [users] = await connection.query(
      `SELECT user_id, first_name, last_name, email, role
       FROM user
       WHERE user_id = ?
       LIMIT 1`,
      [record.user_id],
    );

    if (users.length === 0) {
      await connection.commit();
      return null;
    }

    const dbUser = users[0];
    const newPlainToken = generateRefreshToken();
    const newHash = hashRefreshToken(newPlainToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const { userAgent, ipAddress } = getClientMeta(req);

    await connection.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, last_used_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [record.user_id, newHash, expiresAt, userAgent, ipAddress],
    );

    await connection.commit();

    const accessToken = createAccessToken({
      id: dbUser.user_id,
      email: dbUser.email,
      role: dbUser.role,
      name: `${dbUser.first_name} ${dbUser.last_name}`,
    });

    setAccessTokenCookie(res, accessToken);
    setRefreshTokenCookie(res, newPlainToken);

    return { userId: record.user_id };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getUserSessions = async (userId) => {
  const [rows] = await db.query(
    `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at, revoked_at
     FROM refresh_tokens
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY COALESCE(last_used_at, created_at) DESC`,
    [userId],
  );

  return rows.map((row) => {
    const { device, browser } = parseUserAgent(row.user_agent);
    return {
      id: row.id,
      device,
      browser,
      ip_address: row.ip_address,
      location: null,
      created_at: row.created_at,
      last_used: row.last_used_at || row.created_at,
    };
  });
};

export const revokeSessionById = async (userId, sessionId) => {
  const [result] = await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE id = ?
       AND user_id = ?
       AND revoked_at IS NULL`,
    [sessionId, userId],
  );

  return result.affectedRows > 0;
};
