import crypto from 'crypto';
import db from '../config/db.js';

const PAIR_CODE_TTL_MS = 5 * 60 * 1000;
const OFFLINE_THRESHOLD_MS = 60 * 1000;
const PAIR_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const hashDisplayToken = (token) =>
    crypto.createHash('sha256').update(String(token || '')).digest('hex');

const generatePairCode = () => {
    const part = () =>
        Array.from({ length: 4 }, () => PAIR_CODE_CHARS[Math.floor(Math.random() * PAIR_CODE_CHARS.length)]).join('');
    return `${part()}-${part()}`;
};

const generatePendingDeviceId = () => `pending-${crypto.randomBytes(6).toString('hex')}`;

export const ensureCustomerDisplaySchema = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS customer_display_devices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            device_id VARCHAR(100) NOT NULL UNIQUE,
            device_name VARCHAR(255) NOT NULL,
            station_name VARCHAR(100) NULL,
            pair_code VARCHAR(50) NULL,
            pair_code_expires DATETIME NULL,
            pair_token VARCHAR(255) NULL,
            status ENUM('ONLINE', 'OFFLINE', 'PAIRING') DEFAULT 'OFFLINE',
            last_seen DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cdd_pair_code (pair_code),
            INDEX idx_cdd_status (status),
            INDEX idx_cdd_last_seen (last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS customer_display_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            device_id VARCHAR(100) NOT NULL,
            receipt_no VARCHAR(50) NULL,
            invoice_id VARCHAR(255) NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            started_at DATETIME NULL,
            completed_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cds_device_id (device_id),
            INDEX idx_cds_invoice_id (invoice_id),
            INDEX idx_cds_receipt_no (receipt_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
};

const resolveDeviceStatus = (row) => {
    if (!row) return 'OFFLINE';
    if (row.status === 'PAIRING') return 'PAIRING';
    if (!row.last_seen) return row.status === 'ONLINE' ? 'OFFLINE' : (row.status || 'OFFLINE');
    const lastSeen = new Date(row.last_seen).getTime();
    if (Number.isNaN(lastSeen)) return row.status || 'OFFLINE';
    if (Date.now() - lastSeen > OFFLINE_THRESHOLD_MS) return 'OFFLINE';
    return 'ONLINE';
};

const mapDeviceRow = (row) => {
    const status = resolveDeviceStatus(row);
    return {
        id: row.id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        stationName: row.assigned_station_name || row.station_name || '',
        stationId: row.station_id ?? null,
        stationCode: row.station_code || null,
        status,
        lastSeen: row.last_seen,
        createdAt: row.created_at,
        isPaired: Boolean(row.pair_token) && !String(row.device_id).startsWith('pending-'),
    };
};

export const createPairRequest = async ({ deviceName = 'New Display Device', stationName = null } = {}) => {
    const pairCode = generatePairCode();
    const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
    const pendingDeviceId = generatePendingDeviceId();

    const [result] = await db.query(
        `INSERT INTO customer_display_devices
         (device_id, device_name, station_name, pair_code, pair_code_expires, status)
         VALUES (?, ?, ?, ?, ?, 'PAIRING')`,
        [pendingDeviceId, deviceName, stationName, pairCode, expiresAt]
    );

    return {
        id: result.insertId,
        pairCode,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: Math.floor(PAIR_CODE_TTL_MS / 1000),
    };
};

export const pairDeviceWithCode = async ({
    pairCode,
    deviceName = 'Customer Display',
    stationName = null,
}) => {
    const normalizedCode = String(pairCode || '').trim().toUpperCase();
    if (!normalizedCode) {
        throw Object.assign(new Error('Pair code is required'), { code: 'PAIR_CODE_REQUIRED', statusCode: 400 });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT * FROM customer_display_devices
             WHERE UPPER(pair_code) = ? AND status = 'PAIRING'
             FOR UPDATE`,
            [normalizedCode]
        );

        if (!rows.length) {
            throw Object.assign(new Error('Invalid or expired pair code'), { code: 'INVALID_PAIR_CODE', statusCode: 400 });
        }

        const row = rows[0];
        const expiresAt = row.pair_code_expires ? new Date(row.pair_code_expires).getTime() : 0;
        if (!expiresAt || expiresAt < Date.now()) {
            throw Object.assign(new Error('Pair code has expired'), { code: 'PAIR_CODE_EXPIRED', statusCode: 400 });
        }

        const [countRows] = await connection.query(
            `SELECT COUNT(*) AS total FROM customer_display_devices WHERE device_id LIKE 'display-%'`
        );
        const nextNum = Number(countRows[0]?.total || 0) + 1;
        const deviceId = `display-${String(nextNum).padStart(3, '0')}`;
        const plainToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashDisplayToken(plainToken);
        const finalName = String(deviceName || row.device_name || 'Customer Display').trim();
        const finalStation = stationName ?? row.station_name ?? null;

        await connection.query(
            `UPDATE customer_display_devices
             SET device_id = ?,
                 device_name = ?,
                 station_name = ?,
                 pair_code = NULL,
                 pair_code_expires = NULL,
                 pair_token = ?,
                 status = 'OFFLINE',
                 last_seen = NOW()
             WHERE id = ?`,
            [deviceId, finalName, finalStation, tokenHash, row.id]
        );

        await connection.commit();

        return {
            deviceId,
            token: plainToken,
            deviceName: finalName,
            stationName: finalStation || '',
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const findDeviceByToken = async (plainToken) => {
    const tokenHash = hashDisplayToken(plainToken);
    const [rows] = await db.query(
        `SELECT * FROM customer_display_devices WHERE pair_token = ? LIMIT 1`,
        [tokenHash]
    );
    return rows[0] || null;
};

export const listDevices = async () => {
    const [rows] = await db.query(
        `SELECT cdd.*, ps.station_name AS assigned_station_name, ps.station_code
         FROM customer_display_devices cdd
         LEFT JOIN pos_stations ps ON ps.id = cdd.station_id
         WHERE cdd.pair_token IS NOT NULL
           AND cdd.device_id NOT LIKE 'pending-%'
         ORDER BY cdd.created_at DESC`
    );

    return rows.map(mapDeviceRow);
};

export const getDeviceById = async (id) => {
    const [rows] = await db.query(
        `SELECT cdd.*, ps.station_name AS assigned_station_name, ps.station_code
         FROM customer_display_devices cdd
         LEFT JOIN pos_stations ps ON ps.id = cdd.station_id
         WHERE cdd.id = ?
         LIMIT 1`,
        [id]
    );
    return rows[0] ? mapDeviceRow(rows[0]) : null;
};

export const updateDevice = async (id, { deviceName, stationName }) => {
    const updates = [];
    const values = [];

    if (deviceName !== undefined) {
        updates.push('device_name = ?');
        values.push(String(deviceName).trim());
    }
    if (stationName !== undefined) {
        updates.push('station_name = ?');
        values.push(stationName ? String(stationName).trim() : null);
    }

    if (!updates.length) {
        return getDeviceById(id);
    }

    values.push(id);
    await db.query(`UPDATE customer_display_devices SET ${updates.join(', ')} WHERE id = ?`, values);
    return getDeviceById(id);
};

export const removeDevice = async (id) => {
    const [rows] = await db.query('SELECT device_id FROM customer_display_devices WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) {
        throw Object.assign(new Error('Device not found'), { code: 'NOT_FOUND', statusCode: 404 });
    }

    const deviceId = rows[0].device_id;
    await db.query('DELETE FROM customer_display_sessions WHERE device_id = ?', [deviceId]);
    await db.query('DELETE FROM customer_display_devices WHERE id = ?', [id]);
    return { success: true, deviceId };
};

export const recordHeartbeat = async (deviceId) => {
    const [result] = await db.query(
        `UPDATE customer_display_devices
         SET last_seen = NOW(), status = 'ONLINE'
         WHERE device_id = ?`,
        [deviceId]
    );

    if (!result.affectedRows) {
        throw Object.assign(new Error('Device not found'), { code: 'NOT_FOUND', statusCode: 404 });
    }

    return { online: true, lastSeen: new Date().toISOString() };
};

export const getDeviceStatus = async (deviceId) => {
    const [rows] = await db.query(
        'SELECT * FROM customer_display_devices WHERE device_id = ? LIMIT 1',
        [deviceId]
    );
    if (!rows.length) {
        throw Object.assign(new Error('Device not found'), { code: 'NOT_FOUND', statusCode: 404 });
    }

    const status = resolveDeviceStatus(rows[0]);
    return {
        online: status === 'ONLINE',
        status,
        lastSeen: rows[0].last_seen,
    };
};

export const createDisplaySession = async ({
    deviceId,
    receiptNo,
    invoiceId,
    status = 'PENDING',
}) => {
    const [result] = await db.query(
        `INSERT INTO customer_display_sessions
         (device_id, receipt_no, invoice_id, status, started_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [deviceId, receiptNo, invoiceId, status]
    );
    return result.insertId;
};

export const updateDisplaySessionStatus = async (invoiceId, status) => {
    await db.query(
        `UPDATE customer_display_sessions
         SET status = ?, completed_at = NOW()
         WHERE invoice_id = ?`,
        [status, invoiceId]
    );
};

export const findSessionByInvoiceId = async (invoiceId) => {
    const [rows] = await db.query(
        `SELECT * FROM customer_display_sessions WHERE invoice_id = ? ORDER BY id DESC LIMIT 1`,
        [invoiceId]
    );
    return rows[0] || null;
};

export const findSessionByReceiptNo = async (receiptNo) => {
    const normalized = String(receiptNo || '').trim();
    if (!normalized) return null;
    const [rows] = await db.query(
        `SELECT * FROM customer_display_sessions WHERE receipt_no = ? ORDER BY id DESC LIMIT 1`,
        [normalized]
    );
    return rows[0] || null;
};

export const getOnlineDevices = async () => {
    const devices = await listDevices();
    return devices.filter((d) => d.status === 'ONLINE');
};
