import db from '../config/db.js';

const VALID_ORDER_TYPES = new Set(['dine_in', 'takeout', 'room_delivery']);

export class PosOrderSessionError extends Error {
    constructor(message, code = 'POS_ORDER_SESSION_ERROR', statusCode = 400) {
        super(message);
        this.name = 'PosOrderSessionError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const normalizeText = (value, maxLength = 255) => {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : null;
};

export const ensurePosOrderSessionSchema = async () => {
    const columnDefinitions = [
        ['service_order_number', 'INT NULL'],
        ['service_order_date', 'DATE NULL'],
        ['order_type', 'VARCHAR(30) NULL'],
        ['station_id', 'INT NULL'],
        ['terminal_id', 'VARCHAR(100) NULL'],
        ['pickup_name', 'VARCHAR(80) NULL'],
        ['recipient_name', 'VARCHAR(100) NULL'],
    ];

    const [existingColumns] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'pos_transactions'`
    );
    const columnSet = new Set(existingColumns.map((row) => row.COLUMN_NAME));
    for (const [name, definition] of columnDefinitions) {
        if (!columnSet.has(name)) {
            await db.query(`ALTER TABLE pos_transactions ADD COLUMN ${name} ${definition}`);
        }
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_order_number_counters (
            counter_date DATE NOT NULL,
            station_id INT NOT NULL,
            last_number INT NOT NULL DEFAULT 99,
            PRIMARY KEY (counter_date, station_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_order_sessions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            station_id INT NOT NULL,
            terminal_id VARCHAR(100) NOT NULL,
            order_type VARCHAR(30) NOT NULL,
            service_order_number INT NOT NULL,
            service_order_date DATE NOT NULL,
            location_type VARCHAR(50) NULL,
            location_number VARCHAR(50) NULL,
            pickup_name VARCHAR(80) NULL,
            recipient_name VARCHAR(100) NULL,
            delivery_notes VARCHAR(150) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            transaction_id INT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME NULL,
            cancelled_at DATETIME NULL,
            UNIQUE KEY uq_pos_order_session_number (
                service_order_date,
                station_id,
                service_order_number
            ),
            INDEX idx_pos_order_session_terminal (terminal_id, status),
            INDEX idx_pos_order_session_user (user_id, status),
            INDEX idx_pos_order_session_transaction (transaction_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [indexes] = await db.query(
        `SELECT INDEX_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'pos_transactions'
           AND INDEX_NAME = 'uq_pos_service_order_per_station_day'`
    );
    if (!indexes.length) {
        await db.query(
            `CREATE UNIQUE INDEX uq_pos_service_order_per_station_day
             ON pos_transactions (service_order_date, station_id, service_order_number)`
        );
    }
};

const validateStartPayload = (payload = {}) => {
    const orderType = normalizeText(payload.order_type ?? payload.orderType, 30);
    const stationId = Number(payload.station_id ?? payload.stationId);
    const terminalId = normalizeText(payload.terminal_id ?? payload.terminalId, 100);
    const roomNumber = normalizeText(payload.location_number ?? payload.room_number, 50);
    const recipientName = normalizeText(payload.recipient_name ?? payload.recipientName, 100);

    if (!VALID_ORDER_TYPES.has(orderType)) {
        throw new PosOrderSessionError('Choose a valid order type.', 'INVALID_ORDER_TYPE');
    }
    if (!Number.isInteger(stationId) || stationId <= 0) {
        throw new PosOrderSessionError(
            'Assign this terminal to a POS station before starting an order.',
            'STATION_REQUIRED',
            409,
        );
    }
    if (!terminalId) {
        throw new PosOrderSessionError('Terminal ID is required.', 'TERMINAL_REQUIRED');
    }
    if (orderType === 'room_delivery' && (!roomNumber || !recipientName)) {
        throw new PosOrderSessionError(
            'Room number and recipient name are required for room delivery.',
            'ROOM_DELIVERY_DETAILS_REQUIRED',
        );
    }

    return {
        orderType,
        stationId,
        terminalId,
        locationType: orderType === 'room_delivery' ? 'Room' : null,
        locationNumber: orderType === 'room_delivery' ? roomNumber : null,
        pickupName: orderType === 'takeout'
            ? normalizeText(payload.pickup_name ?? payload.pickupName, 80)
            : null,
        recipientName: orderType === 'room_delivery' ? recipientName : null,
        deliveryNotes: orderType === 'room_delivery'
            ? normalizeText(payload.delivery_notes ?? payload.deliveryNotes, 150)
            : null,
    };
};

const nextServiceOrderNumber = async (connection, stationId) => {
    const [[dateRow]] = await connection.query('SELECT CURDATE() AS counter_date');
    const counterDate = dateRow.counter_date;

    await connection.query(
        `INSERT INTO pos_order_number_counters (counter_date, station_id, last_number)
         VALUES (?, ?, 99)
         ON DUPLICATE KEY UPDATE last_number = last_number`,
        [counterDate, stationId],
    );

    const [[counter]] = await connection.query(
        `SELECT last_number
         FROM pos_order_number_counters
         WHERE counter_date = ? AND station_id = ?
         FOR UPDATE`,
        [counterDate, stationId],
    );
    const current = Number(counter?.last_number || 99);
    if (current >= 999) {
        throw new PosOrderSessionError(
            'This station has reached its daily order-number capacity.',
            'ORDER_NUMBER_CAPACITY_REACHED',
            409,
        );
    }
    const orderNumber = Math.max(100, current + 1);
    await connection.query(
        `UPDATE pos_order_number_counters
         SET last_number = ?
         WHERE counter_date = ? AND station_id = ?`,
        [orderNumber, counterDate, stationId],
    );
    return { orderNumber, orderDate: counterDate };
};

export const startPosOrderSession = async ({ userId, payload }) => {
    const normalized = validateStartPayload(payload);
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [[station]] = await connection.query(
            'SELECT id FROM pos_stations WHERE id = ? AND active = 1 LIMIT 1',
            [normalized.stationId],
        );
        if (!station) {
            throw new PosOrderSessionError(
                'The assigned POS station is unavailable.',
                'STATION_NOT_FOUND',
                409,
            );
        }

        const { orderNumber, orderDate } = await nextServiceOrderNumber(
            connection,
            normalized.stationId,
        );
        const [result] = await connection.query(
            `INSERT INTO pos_order_sessions (
                user_id, station_id, terminal_id, order_type,
                service_order_number, service_order_date,
                location_type, location_number, pickup_name,
                recipient_name, delivery_notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                normalized.stationId,
                normalized.terminalId,
                normalized.orderType,
                orderNumber,
                orderDate,
                normalized.locationType,
                normalized.locationNumber,
                normalized.pickupName,
                normalized.recipientName,
                normalized.deliveryNotes,
            ],
        );
        await connection.commit();
        return {
            order_session_id: result.insertId,
            transaction_id: null,
            service_order_number: orderNumber,
            service_order_date: orderDate,
            order_type: normalized.orderType,
            station_id: normalized.stationId,
            terminal_id: normalized.terminalId,
            location_type: normalized.locationType,
            location_number: normalized.locationNumber,
            pickup_name: normalized.pickupName,
            recipient_name: normalized.recipientName,
            delivery_notes: normalized.deliveryNotes,
            status: 'ACTIVE',
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const lockActiveOrderSession = async (connection, {
    sessionId,
    userId,
    stationId,
    terminalId,
}) => {
    const parsedId = Number(sessionId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
        throw new PosOrderSessionError(
            'Start a new order before checkout.',
            'ORDER_SESSION_REQUIRED',
            409,
        );
    }
    const [[session]] = await connection.query(
        `SELECT *
         FROM pos_order_sessions
         WHERE id = ?
         FOR UPDATE`,
        [parsedId],
    );
    if (!session || session.status !== 'ACTIVE') {
        throw new PosOrderSessionError(
            'This order is no longer active. Start a new order.',
            'ORDER_SESSION_INACTIVE',
            409,
        );
    }
    if (Number(session.user_id) !== Number(userId)) {
        throw new PosOrderSessionError('Order access denied.', 'ORDER_SESSION_FORBIDDEN', 403);
    }
    if (
        Number(session.station_id) !== Number(stationId)
        || String(session.terminal_id) !== String(terminalId)
    ) {
        throw new PosOrderSessionError(
            'The active order belongs to a different station or terminal.',
            'ORDER_SESSION_TERMINAL_MISMATCH',
            409,
        );
    }
    return session;
};

export const completeOrderSession = async (connection, sessionId, transactionId) => {
    await connection.query(
        `UPDATE pos_order_sessions
         SET status = 'COMPLETED', transaction_id = ?, completed_at = NOW()
         WHERE id = ? AND status = 'ACTIVE'`,
        [transactionId, sessionId],
    );
};

export const cancelPosOrderSession = async ({ sessionId, userId }) => {
    const [result] = await db.query(
        `UPDATE pos_order_sessions
         SET status = 'CANCELLED', cancelled_at = NOW()
         WHERE id = ? AND user_id = ? AND status = 'ACTIVE'`,
        [Number(sessionId), Number(userId)],
    );
    if (!result.affectedRows) {
        throw new PosOrderSessionError(
            'Active order not found.',
            'ORDER_SESSION_NOT_FOUND',
            404,
        );
    }
};
