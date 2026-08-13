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
        `SELECT id, station_code, station_name, location, active, created_at
         FROM pos_stations
         ${conditions}
         ORDER BY station_name ASC`
    );

    return rows.map((row) => ({
        id: row.id,
        stationCode: row.station_code,
        stationName: row.station_name,
        location: row.location || '',
        active: Boolean(row.active),
        createdAt: row.created_at,
    }));
};

export const getStationById = async (id) => {
    const [rows] = await db.query(
        `SELECT id, station_code, station_name, location, active, created_at
         FROM pos_stations WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
        id: row.id,
        stationCode: row.station_code,
        stationName: row.station_name,
        location: row.location || '',
        active: Boolean(row.active),
        createdAt: row.created_at,
    };
};

export const createStation = async ({ stationCode, stationName, location = null, active = true }) => {
    const code = String(stationCode || '').trim().toUpperCase();
    const name = String(stationName || '').trim();
    if (!code || !name) {
        throw Object.assign(new Error('Station code and name are required'), { statusCode: 400 });
    }

    const [result] = await db.query(
        `INSERT INTO pos_stations (station_code, station_name, location, active)
         VALUES (?, ?, ?, ?)`,
        [code, name, location ? String(location).trim() : null, active ? 1 : 0]
    );

    return getStationById(result.insertId);
};

export const updateStation = async (id, { stationCode, stationName, location, active }) => {
    const updates = [];
    const values = [];

    if (stationCode !== undefined) {
        updates.push('station_code = ?');
        values.push(String(stationCode).trim().toUpperCase());
    }
    if (stationName !== undefined) {
        updates.push('station_name = ?');
        values.push(String(stationName).trim());
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
    const [assigned] = await db.query(
        `SELECT COUNT(*) AS total FROM customer_display_devices WHERE station_id = ?`,
        [id]
    );
    if (Number(assigned[0]?.total || 0) > 0) {
        throw Object.assign(
            new Error('Cannot delete station with assigned display devices'),
            { statusCode: 400, code: 'STATION_HAS_DEVICES' }
        );
    }

    await db.query('UPDATE pos_terminal_settings SET station_id = NULL WHERE station_id = ?', [id]);
    const [result] = await db.query('DELETE FROM pos_stations WHERE id = ?', [id]);
    if (!result.affectedRows) {
        throw Object.assign(new Error('Station not found'), { statusCode: 404 });
    }
    return { success: true };
};
