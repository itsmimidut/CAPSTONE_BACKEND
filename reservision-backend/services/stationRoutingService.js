import { db } from '../config/db.js';
import { getStationById } from './posStationService.js';
import { listDevices } from './customerDisplayService.js';

export const ensureStationRoutingSchema = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_stations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            station_code VARCHAR(50) UNIQUE,
            station_name VARCHAR(100) NOT NULL,
            description TEXT NULL,
            location VARCHAR(255) NULL,
            active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_pos_stations_active (active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    for (const column of [
        { name: 'description', definition: 'TEXT NULL' },
        { name: 'updated_at', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
    ]) {
        const [rows] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_stations' AND COLUMN_NAME = ?`,
            [column.name]
        );
        if (!rows.length) await db.query(`ALTER TABLE pos_stations ADD COLUMN ${column.name} ${column.definition}`);
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS pos_terminal_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            terminal_id VARCHAR(100) UNIQUE,
            station_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pts_station_id (station_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [columns] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'customer_display_devices'
           AND COLUMN_NAME = 'station_id'`
    );

    if (!columns.length) {
        await db.query('ALTER TABLE customer_display_devices ADD COLUMN station_id INT NULL');
        await db.query(
            'ALTER TABLE customer_display_devices ADD INDEX idx_cdd_station_id (station_id)'
        ).catch(() => {});
    }

    const { seedDefaultStations } = await import('./posStationService.js');
    await seedDefaultStations();
};

export const getDisplayForStation = async (stationId) => {
    const parsedId = Number(stationId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
        return {
            available: false,
            reason: 'invalid_station',
            warning: 'POS station is not configured.',
        };
    }

    const station = await getStationById(parsedId);
    if (!station || !station.active) {
        return {
            available: false,
            reason: 'station_not_found',
            stationId: parsedId,
            warning: 'Assigned POS station was not found or is inactive.',
        };
    }

    const devices = await listDevices();
    const assigned = devices.filter((device) => Number(device.stationId) === parsedId);

    if (!assigned.length) {
        return {
            available: false,
            reason: 'no_display_assigned',
            stationId: parsedId,
            stationName: station.stationName,
            warning: `No customer display assigned to ${station.stationName}.`,
        };
    }

    const device = assigned[0];
    if (device.status !== 'ONLINE') {
        return {
            available: false,
            reason: 'display_offline',
            stationId: parsedId,
            stationName: station.stationName,
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceStatus: device.status,
            warning: `Assigned display for ${station.stationName} is offline.`,
        };
    }

    return {
        available: true,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        stationId: parsedId,
        stationName: station.stationName,
    };
};

export const assignDeviceToStation = async (deviceDbId, stationId) => {
    const parsedDeviceId = Number(deviceDbId);
    if (!Number.isFinite(parsedDeviceId) || parsedDeviceId <= 0) {
        throw Object.assign(new Error('Invalid device ID'), { statusCode: 400 });
    }

    const parsedStationId = stationId === null || stationId === undefined || stationId === ''
        ? null
        : Number(stationId);

    if (parsedStationId !== null && (!Number.isFinite(parsedStationId) || parsedStationId <= 0)) {
        throw Object.assign(new Error('Invalid station ID'), { statusCode: 400 });
    }

    const [deviceRows] = await db.query(
        'SELECT id, device_name FROM customer_display_devices WHERE id = ? LIMIT 1',
        [parsedDeviceId]
    );
    if (!deviceRows.length) {
        throw Object.assign(new Error('Device not found'), { statusCode: 404 });
    }

    if (parsedStationId) {
        const station = await getStationById(parsedStationId);
        if (!station) {
            throw Object.assign(new Error('Station not found'), { statusCode: 404 });
        }

        const [conflicts] = await db.query(
            `SELECT id, device_name FROM customer_display_devices
             WHERE station_id = ?
               AND id != ?
               AND pair_token IS NOT NULL
               AND device_id NOT LIKE 'pending-%'
             LIMIT 1`,
            [parsedStationId, parsedDeviceId]
        );

        if (conflicts.length) {
            throw Object.assign(
                new Error(`Station already has display "${conflicts[0].device_name}" assigned`),
                { statusCode: 409, code: 'STATION_DISPLAY_CONFLICT' }
            );
        }
    }

    await db.query(
        'UPDATE customer_display_devices SET station_id = ? WHERE id = ?',
        [parsedStationId, parsedDeviceId]
    );

    const devices = await listDevices();
    return devices.find((device) => device.id === parsedDeviceId) || null;
};

export const resolveDisplayForPayment = async ({ stationId, terminalId = null }) => {
    let resolvedStationId = stationId ? Number(stationId) : null;

    if ((!resolvedStationId || !Number.isFinite(resolvedStationId)) && terminalId) {
        const { getStationIdForTerminal } = await import('./posTerminalService.js');
        resolvedStationId = await getStationIdForTerminal(terminalId);
    }

    if (!resolvedStationId) {
        return {
            routed: false,
            reason: 'no_station',
            warning: 'POS station is not configured. Assign a station in POS Settings.',
        };
    }

    const display = await getDisplayForStation(resolvedStationId);
    if (!display.available) {
        return {
            routed: false,
            reason: display.reason,
            stationId: display.stationId,
            stationName: display.stationName,
            deviceId: display.deviceId || null,
            deviceName: display.deviceName || null,
            warning: display.warning || 'No customer display available for this station.',
        };
    }

    return {
        routed: true,
        deviceId: display.deviceId,
        deviceName: display.deviceName,
        stationId: display.stationId,
        stationName: display.stationName,
    };
};
