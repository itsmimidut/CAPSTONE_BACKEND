import { db } from '../config/db.js';
import { getStationById } from './posStationService.js';

export const getTerminalSettings = async (terminalId) => {
    const normalized = String(terminalId || '').trim();
    if (!normalized) {
        throw Object.assign(new Error('Terminal ID is required'), { statusCode: 400 });
    }

    const [rows] = await db.query(
        `SELECT pts.id, pts.terminal_id, pts.station_id, pts.created_at,
                ps.station_code, ps.station_name, ps.location
         FROM pos_terminal_settings pts
         LEFT JOIN pos_stations ps ON ps.id = pts.station_id
         WHERE pts.terminal_id = ?
         LIMIT 1`,
        [normalized]
    );

    if (!rows.length) {
        return {
            terminalId: normalized,
            stationId: null,
            station: null,
        };
    }

    const row = rows[0];
    return {
        terminalId: row.terminal_id,
        stationId: row.station_id,
        station: row.station_id
            ? {
                  id: row.station_id,
                  stationCode: row.station_code,
                  stationName: row.station_name,
                  location: row.location || '',
              }
            : null,
        createdAt: row.created_at,
    };
};

export const upsertTerminalSettings = async (terminalId, stationId) => {
    const normalizedTerminal = String(terminalId || '').trim();
    if (!normalizedTerminal) {
        throw Object.assign(new Error('Terminal ID is required'), { statusCode: 400 });
    }

    const parsedStationId = stationId === null || stationId === undefined || stationId === ''
        ? null
        : Number(stationId);

    if (parsedStationId !== null && (!Number.isFinite(parsedStationId) || parsedStationId <= 0)) {
        throw Object.assign(new Error('Invalid station ID'), { statusCode: 400 });
    }

    if (parsedStationId) {
        const station = await getStationById(parsedStationId);
        if (!station) {
            throw Object.assign(new Error('Station not found'), { statusCode: 404 });
        }
        if (!station.active) {
            throw Object.assign(new Error('Station is inactive'), { statusCode: 400 });
        }
    }

    const [existing] = await db.query(
        'SELECT id FROM pos_terminal_settings WHERE terminal_id = ? LIMIT 1',
        [normalizedTerminal]
    );

    if (existing.length) {
        await db.query(
            'UPDATE pos_terminal_settings SET station_id = ? WHERE terminal_id = ?',
            [parsedStationId, normalizedTerminal]
        );
    } else {
        await db.query(
            'INSERT INTO pos_terminal_settings (terminal_id, station_id) VALUES (?, ?)',
            [normalizedTerminal, parsedStationId]
        );
    }

    return getTerminalSettings(normalizedTerminal);
};

export const getStationIdForTerminal = async (terminalId) => {
    const settings = await getTerminalSettings(terminalId);
    return settings.stationId || null;
};
