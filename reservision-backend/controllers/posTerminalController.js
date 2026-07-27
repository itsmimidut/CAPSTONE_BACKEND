import { getTerminalSettings, upsertTerminalSettings } from '../services/posTerminalService.js';
import { getDisplayForStation } from '../services/stationRoutingService.js';

export const getPosTerminalSettings = async (req, res) => {
    try {
        const terminalId = String(
            req.query?.terminalId || req.query?.terminal_id || req.body?.terminalId || ''
        ).trim();

        if (!terminalId) {
            return res.status(400).json({ success: false, error: 'Terminal ID is required' });
        }

        const settings = await getTerminalSettings(terminalId);
        let display = null;

        if (settings.stationId) {
            display = await getDisplayForStation(settings.stationId);
        }

        return res.json({
            success: true,
            data: {
                ...settings,
                display,
            },
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        console.error('getPosTerminalSettings error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch terminal settings' });
    }
};

export const patchPosTerminalSettings = async (req, res) => {
    try {
        const terminalId = String(req.body?.terminalId || req.body?.terminal_id || '').trim();
        const stationId = req.body?.stationId ?? req.body?.station_id ?? null;

        if (!terminalId) {
            return res.status(400).json({ success: false, error: 'Terminal ID is required' });
        }

        const settings = await upsertTerminalSettings(terminalId, stationId);
        let display = null;
        if (settings.stationId) {
            display = await getDisplayForStation(settings.stationId);
        }

        return res.json({
            success: true,
            data: {
                ...settings,
                display,
            },
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        console.error('patchPosTerminalSettings error:', error);
        return res.status(500).json({ success: false, error: 'Failed to update terminal settings' });
    }
};
