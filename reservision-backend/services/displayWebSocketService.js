import { Server } from 'socket.io';
import { allowedOrigins } from '../middleware/corsConfig.js';
import { findDeviceByToken, recordHeartbeat } from './customerDisplayService.js';
import { clearDisplaySession } from './displaySessionService.js';
import {
    authenticateCustomerSocket,
    joinCustomerRoom,
    leaveCustomerRoom,
} from './customerSocketService.js';

const isStaffRole = (role) => [
    'admin',
    'manager',
    'receptionist',
    'staff',
    'restaurantstaff',
    'restaurant_staff',
    'delivery_staff',
].includes(String(role || '').toLowerCase());

let io = null;
const deviceSockets = new Map();

export const initDisplayWebSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            credentials: true,
        },
        path: '/socket.io',
    });

    io.use(async (socket, next) => {
        try {
            const clientType = String(socket.handshake.auth?.client || '').toLowerCase();

            if (clientType === 'customer') {
                const user = await authenticateCustomerSocket(socket);
                if (!user) {
                    return next(new Error('Customer authentication required'));
                }
                socket.clientType = 'customer';
                socket.customerUserId = user.id;
                socket.customerUser = user;
                return next();
            }

            if (clientType === 'admin' || clientType === 'staff') {
                const user = await authenticateCustomerSocket(socket);
                if (!user || !isStaffRole(user.role)) {
                    return next(new Error('Staff authentication required'));
                }
                socket.clientType = 'admin';
                socket.adminUser = user;
                return next();
            }

            const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
            if (!token) {
                return next(new Error('Display token required'));
            }

            const device = await findDeviceByToken(token);
            if (!device) {
                return next(new Error('Invalid display token'));
            }

            socket.clientType = 'display';
            socket.displayDevice = device;
            socket.displayDeviceId = device.device_id;
            return next();
        } catch (error) {
            return next(error);
        }
    });

    io.on('connection', (socket) => {
        if (socket.clientType === 'customer') {
            joinCustomerRoom(socket, socket.customerUserId);

            socket.on('customer:register', (payload = {}) => {
                const requestedId = Number(payload.userId || payload.user_id || socket.customerUserId);
                if (requestedId === Number(socket.customerUserId)) {
                    joinCustomerRoom(socket, socket.customerUserId);
                }
            });

            socket.on('disconnect', () => {
                leaveCustomerRoom(socket, socket.customerUserId);
            });

            return;
        }

        if (socket.clientType === 'admin') {
            socket.join('staff:reservations');
            socket.join('staff:eshop-orders');
            socket.on('disconnect', () => {
                socket.leave('staff:reservations');
                socket.leave('staff:eshop-orders');
            });
            return;
        }

        const deviceId = socket.displayDeviceId;
        const room = `display:${deviceId}`;
        socket.join(room);
        deviceSockets.set(deviceId, socket.id);

        recordHeartbeat(deviceId).catch(() => {});

        socket.on('display:register', (payload = {}) => {
            const requestedId = String(payload.deviceId || deviceId);
            if (requestedId !== deviceId) return;
            socket.join(`display:${requestedId}`);
        });

        socket.on('display:heartbeat', async () => {
            try {
                await recordHeartbeat(deviceId);
                socket.emit('display:heartbeat:ack', { online: true });
            } catch {
                socket.emit('display:heartbeat:ack', { online: false });
            }
        });

        socket.on('display:disconnect', () => {
            if (deviceSockets.get(deviceId) === socket.id) {
                deviceSockets.delete(deviceId);
            }
        });

        socket.on('disconnect', () => {
            if (deviceSockets.get(deviceId) === socket.id) {
                deviceSockets.delete(deviceId);
            }
        });
    });

    return io;
};

export const getDisplayIo = () => io;

export const emitToDisplay = (deviceId, event, payload) => {
    if (!io || !deviceId) return false;
    io.to(`display:${deviceId}`).emit(event, payload);
    return true;
};

const scheduleReset = (deviceId, delayMs = 5000) => {
    setTimeout(() => {
        emitToDisplay(deviceId, 'payment:reset', { status: 'RESET' });
        clearDisplaySession(deviceId).catch(() => {});
    }, delayMs);
};

export const broadcastPaymentCreated = (deviceId, payload) => {
    emitToDisplay(deviceId, 'payment:created', payload);
};

export const broadcastPaymentPaid = (deviceId, payload) => {
    emitToDisplay(deviceId, 'payment:paid', payload);
    scheduleReset(deviceId);
};

export const broadcastPaymentFailed = (deviceId, payload) => {
    emitToDisplay(deviceId, 'payment:failed', payload);
    scheduleReset(deviceId);
};

export const broadcastPaymentExpired = (deviceId, payload) => {
    emitToDisplay(deviceId, 'payment:expired', payload);
    scheduleReset(deviceId);
};
