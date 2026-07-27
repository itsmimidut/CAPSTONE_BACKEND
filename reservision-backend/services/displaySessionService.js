import { db } from '../config/db.js';

const parseItemsJson = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const mapSessionRow = (row) => {
    if (!row) return null;
    return {
        sessionId: row.session_id,
        receiptNo: row.receipt_no,
        invoiceId: row.invoice_id,
        deviceId: row.device_id,
        stationId: row.station_id,
        amount: Number(row.amount || 0),
        qrCode: row.qr_code || null,
        paymentUrl: row.payment_url || null,
        items: parseItemsJson(row.items_json),
        status: row.status,
        paymentStatus: row.status,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        paidAt: row.paid_at,
        clearedAt: row.cleared_at,
        stationName: row.station_name || null,
        serviceOrderNumber: row.service_order_number || null,
        orderType: row.order_type || null,
        locationNumber: row.location_number || null,
    };
};

export const ensureDisplaySessionSchema = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS display_payment_sessions (
            session_id INT AUTO_INCREMENT PRIMARY KEY,
            receipt_no VARCHAR(50) NOT NULL,
            invoice_id VARCHAR(255) NULL,
            device_id VARCHAR(100) NOT NULL,
            station_id INT NULL,
            amount DECIMAL(10,2) NOT NULL,
            qr_code MEDIUMTEXT NULL,
            payment_url TEXT NULL,
            items_json TEXT NULL,
            service_order_number INT NULL,
            order_type VARCHAR(30) NULL,
            location_number VARCHAR(50) NULL,
            status ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED') DEFAULT 'PENDING',
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            paid_at DATETIME NULL,
            cleared_at DATETIME NULL,
            INDEX idx_dps_device (device_id),
            INDEX idx_dps_status (status),
            INDEX idx_dps_receipt (receipt_no),
            INDEX idx_dps_invoice (invoice_id),
            INDEX idx_dps_active (device_id, is_active, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const [columns] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'display_payment_sessions'`
    );
    const columnSet = new Set(columns.map((row) => row.COLUMN_NAME));
    for (const [name, definition] of [
        ['service_order_number', 'INT NULL'],
        ['order_type', 'VARCHAR(30) NULL'],
        ['location_number', 'VARCHAR(50) NULL'],
    ]) {
        if (!columnSet.has(name)) {
            await db.query(`ALTER TABLE display_payment_sessions ADD COLUMN ${name} ${definition}`);
        }
    }
};

export const createDisplaySession = async ({
    deviceId,
    receiptNo,
    invoiceId,
    amount,
    qrCode = null,
    paymentUrl = null,
    items = [],
    stationId = null,
    serviceOrderNumber = null,
    orderType = null,
    locationNumber = null,
}) => {
    const normalizedDevice = String(deviceId || '').trim();
    const normalizedReceipt = String(receiptNo || '').trim();
    if (!normalizedDevice || !normalizedReceipt) {
        throw new Error('deviceId and receiptNo are required');
    }

    await db.query(
        `UPDATE display_payment_sessions
         SET is_active = 0, cleared_at = COALESCE(cleared_at, NOW())
         WHERE device_id = ? AND is_active = 1`,
        [normalizedDevice]
    );

    const [result] = await db.query(
        `INSERT INTO display_payment_sessions
         (receipt_no, invoice_id, device_id, station_id, amount, qr_code, payment_url, items_json,
          service_order_number, order_type, location_number, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 1)`,
        [
            normalizedReceipt,
            invoiceId || null,
            normalizedDevice,
            stationId || null,
            Number(amount || 0),
            qrCode || null,
            paymentUrl || null,
            JSON.stringify(Array.isArray(items) ? items : []),
            serviceOrderNumber || null,
            orderType || null,
            locationNumber || null,
        ]
    );

    return getSessionById(result.insertId);
};

export const getSessionById = async (sessionId) => {
    const [rows] = await db.query(
        `SELECT dps.*, ps.station_name
         FROM display_payment_sessions dps
         LEFT JOIN pos_stations ps ON ps.id = dps.station_id
         WHERE dps.session_id = ?
         LIMIT 1`,
        [sessionId]
    );
    return mapSessionRow(rows[0]);
};

export const getSessionByReceipt = async (receiptNo) => {
    const normalized = String(receiptNo || '').trim();
    if (!normalized) return null;

    const [rows] = await db.query(
        `SELECT dps.*, ps.station_name
         FROM display_payment_sessions dps
         LEFT JOIN pos_stations ps ON ps.id = dps.station_id
         WHERE dps.receipt_no = ?
         ORDER BY dps.session_id DESC
         LIMIT 1`,
        [normalized]
    );
    return mapSessionRow(rows[0]);
};

export const getSessionByInvoiceId = async (invoiceId) => {
    if (!invoiceId) return null;
    const [rows] = await db.query(
        `SELECT dps.*, ps.station_name
         FROM display_payment_sessions dps
         LEFT JOIN pos_stations ps ON ps.id = dps.station_id
         WHERE dps.invoice_id = ?
         ORDER BY dps.session_id DESC
         LIMIT 1`,
        [invoiceId]
    );
    return mapSessionRow(rows[0]);
};

export const getCurrentSessionForDevice = async (deviceId) => {
    const normalized = String(deviceId || '').trim();
    if (!normalized) return null;

    const [rows] = await db.query(
        `SELECT dps.*, ps.station_name
         FROM display_payment_sessions dps
         LEFT JOIN pos_stations ps ON ps.id = dps.station_id
         WHERE dps.device_id = ?
           AND dps.is_active = 1
           AND dps.status = 'PENDING'
         ORDER BY dps.session_id DESC
         LIMIT 1`,
        [normalized]
    );
    return mapSessionRow(rows[0]);
};

export const getActiveSessions = async ({ status = null } = {}) => {
    const conditions = ['(dps.is_active = 1 OR dps.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))'];
    const params = [];

    if (status) {
        conditions.push('dps.status = ?');
        params.push(String(status).toUpperCase());
    }

    const [rows] = await db.query(
        `SELECT dps.*, ps.station_name
         FROM display_payment_sessions dps
         LEFT JOIN pos_stations ps ON ps.id = dps.station_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY dps.created_at DESC
         LIMIT 100`,
        params
    );

    return rows.map(mapSessionRow);
};

export const markSessionPaid = async (invoiceId, { receiptNo = null, paidAt = new Date() } = {}) => {
    const session = invoiceId
        ? await getSessionByInvoiceId(invoiceId)
        : await getSessionByReceipt(receiptNo);

    if (!session) return null;

    await db.query(
        `UPDATE display_payment_sessions
         SET status = 'PAID', paid_at = ?, is_active = 1
         WHERE session_id = ?`,
        [paidAt, session.sessionId]
    );

    return getSessionById(session.sessionId);
};

export const markSessionFailed = async (invoiceId, { receiptNo = null } = {}) => {
    const session = invoiceId
        ? await getSessionByInvoiceId(invoiceId)
        : await getSessionByReceipt(receiptNo);

    if (!session) return null;

    await db.query(
        `UPDATE display_payment_sessions SET status = 'FAILED', is_active = 1 WHERE session_id = ?`,
        [session.sessionId]
    );

    return getSessionById(session.sessionId);
};

export const markSessionExpired = async (invoiceId, { receiptNo = null } = {}) => {
    const session = invoiceId
        ? await getSessionByInvoiceId(invoiceId)
        : await getSessionByReceipt(receiptNo);

    if (!session) return null;

    await db.query(
        `UPDATE display_payment_sessions SET status = 'EXPIRED', is_active = 1 WHERE session_id = ?`,
        [session.sessionId]
    );

    return getSessionById(session.sessionId);
};

export const clearDisplaySession = async (deviceId) => {
    const normalized = String(deviceId || '').trim();
    if (!normalized) return { cleared: false };

    const [result] = await db.query(
        `UPDATE display_payment_sessions
         SET is_active = 0, cleared_at = NOW()
         WHERE device_id = ? AND is_active = 1`,
        [normalized]
    );

    return { cleared: result.affectedRows > 0, deviceId: normalized };
};
