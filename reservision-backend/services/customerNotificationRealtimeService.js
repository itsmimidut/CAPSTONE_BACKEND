import { getDisplayIo } from './displayWebSocketService.js';

export const emitCustomerNotification = (userId, notification) => {
    const io = getDisplayIo();
    const normalizedUserId = Number(userId);
    if (!io || !Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !notification) {
        return false;
    }

    io.to(`user:${normalizedUserId}`).emit('notification:new', notification);
    return true;
};
