import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { ACCESS_TOKEN_COOKIE_NAME } from '../utils/accessTokenCookie.js';

const parseCookieHeader = (cookieHeader = '') => {
    if (!cookieHeader) return {};
    return Object.fromEntries(
        cookieHeader
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const separator = part.indexOf('=');
                if (separator === -1) return [part, ''];
                const key = part.slice(0, separator).trim();
                const value = part.slice(separator + 1).trim();
                try {
                    return [key, decodeURIComponent(value)];
                } catch {
                    return [key, value];
                }
            }),
    );
};

const extractSocketAccessToken = (socket) => {
    const authToken = socket.handshake.auth?.token;
    if (authToken) {
        return String(authToken).trim();
    }

    const authHeader = socket.handshake.headers?.authorization || socket.handshake.headers?.Authorization;
    if (authHeader && String(authHeader).startsWith('Bearer ')) {
        return String(authHeader).slice(7).trim();
    }

    const cookies = parseCookieHeader(socket.handshake.headers?.cookie || '');
    return cookies[ACCESS_TOKEN_COOKIE_NAME] || null;
};

export const authenticateCustomerSocket = async (socket) => {
    const token = extractSocketAccessToken(socket);
    if (!token) {
        return null;
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        const userId = Number(decoded?.id);
        if (!Number.isFinite(userId) || userId <= 0) {
            return null;
        }

        return {
            id: userId,
            email: decoded.email || null,
            role: decoded.role || 'customer',
        };
    } catch {
        return null;
    }
};

export const joinCustomerRoom = (socket, userId) => {
    const normalized = Number(userId);
    if (!socket || !Number.isFinite(normalized) || normalized <= 0) {
        return null;
    }

    const room = `user:${normalized}`;
    socket.join(room);
    socket.customerUserId = normalized;
    return room;
};

export const leaveCustomerRoom = (socket, userId = socket?.customerUserId) => {
    const normalized = Number(userId);
    if (!socket || !Number.isFinite(normalized) || normalized <= 0) {
        return null;
    }

    const room = `user:${normalized}`;
    socket.leave(room);
    return room;
};
