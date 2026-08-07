import { db } from '../config/db.js';

const DEFAULT_STATIONS = [
    { station_code: 'RESTO', station_name: 'Restaurant Counter', location: 'Restaurant' },
    { station_code: 'FRONTDESK', station_name: 'Front Desk', location: 'Lobby' },
    { station_code: 'POOL', station_name: 'Pool Bar', location: 'Pool Area' },
    { station_code: 'EVENT', station_name: 'Event Hall', location: 'Events' },
];

export const seedDefaultStations = async () => {
    const [rows] = await db.query('SELECT COUNT(*) AS total FROM pos_stations');
    if (Number(rows[0]?.total || 0) > 0) return;

    for (const station of DEFAULT_STATIONS) {
        await db.query(
            `INSERT INTO pos_stations (station_code, station_name, location, active)
             VALUES (?, ?, ?, 1)`,
            [station.station_code, station.station_name, station.location]
        );
    }
};

export const listStations = async ({ activeOnly = false } = {}) => {
    const conditions = activeOnly ? 'WHERE active = 1' : '';
    const [rows] = await db.query(
        `SELECT id, station_code, station_name, description, location, active, created_at, updated_at
         FROM pos_stations
         ${conditions}
         ORDER BY station_name ASC`
    );

    return rows.map((row) => ({
        id: row.id,
        stationCode: row.station_code,
        stationName: row.station_name,
        description: row.description || '',
        location: row.location || '',
        active: Boolean(row.active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
};

export const getStationById = async (id) => {
    const [rows] = await db.query(
        `SELECT id, station_code, station_name, description, location, active, created_at, updated_at
         FROM pos_stations WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
        id: row.id,
        stationCode: row.station_code,
        stationName: row.station_name,
        description: row.description || '',
        location: row.location || '',
        active: Boolean(row.active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

export const createStation = async ({ stationCode, stationName, description = null, location = null, active = true }) => {
    const code = String(stationCode || '').trim().toUpperCase();
    const name = String(stationName || '').trim();
    if (!code || !name) {
        throw Object.assign(new Error('Station code and name are required'), { statusCode: 400 });
    }

    const [result] = await db.query(
        `INSERT INTO pos_stations (station_code, station_name, description, location, active)
         VALUES (?, ?, ?, ?, ?)`,
        [code, name, description ? String(description).trim() : null, location ? String(location).trim() : null, active ? 1 : 0]
    );

    return getStationById(result.insertId);
};

export const updateStation = async (id, { stationCode, stationName, description, location, active }) => {
    const updates = [];
    const values = [];

    if (stationCode !== undefined) {
        const current = await getStationById(id);
        if (!current) throw Object.assign(new Error('Station not found'), { statusCode: 404 });
        const nextCode = String(stationCode).trim().toUpperCase();
        if (nextCode !== current.stationCode) {
            throw Object.assign(new Error('Station code cannot be changed after creation.'), { statusCode: 409, code: 'STATION_CODE_IMMUTABLE' });
        }
    }
    if (stationName !== undefined) {
        updates.push('station_name = ?');
        values.push(String(stationName).trim());
    }
    if (description !== undefined) {
        updates.push('description = ?');
        values.push(description ? String(description).trim() : null);
    }
    if (location !== undefined) {
        updates.push('location = ?');
        values.push(location ? String(location).trim() : null);
    }
    if (active !== undefined) {
        updates.push('active = ?');
        values.push(active ? 1 : 0);
    }

    if (!updates.length) return getStationById(id);

    values.push(id);
    const [result] = await db.query(
        `UPDATE pos_stations SET ${updates.join(', ')} WHERE id = ?`,
        values
    );

    if (!result.affectedRows) {
        throw Object.assign(new Error('Station not found'), { statusCode: 404 });
    }

    return getStationById(id);
};

export const deleteStation = async (id) => {
    const station = await getStationById(id);
    if (!station) throw Object.assign(new Error('Station not found'), { statusCode: 404 });
    const dependencyQueries = {
        terminals: 'SELECT COUNT(*) AS total FROM pos_terminal_settings WHERE station_id = ?',
        connectors: 'SELECT COUNT(*) AS total FROM print_bridge_devices WHERE station_id = ? AND is_active = 1',
        printers: 'SELECT COUNT(*) AS total FROM pos_printers WHERE station_id = ? AND is_active = 1',
        displays: 'SELECT COUNT(*) AS total FROM customer_display_devices WHERE station_id = ?',
    };
    const dependencies = {};
    for (const [name, sql] of Object.entries(dependencyQueries)) {
        const [rows] = await db.query(sql, [id]);
        dependencies[name] = Number(rows[0]?.total || 0);
    }
    if (Object.values(dependencies).some((count) => count > 0)) {
        throw Object.assign(
            new Error('Reassign or deactivate the station dependencies before deactivation.'),
            { statusCode: 409, code: 'STATION_HAS_DEPENDENCIES', dependencies }
        );
    }
    await db.query('UPDATE pos_stations SET active = 0 WHERE id = ?', [id]);
    return { success: true, deactivated: true, station: await getStationById(id), dependencies };
};
