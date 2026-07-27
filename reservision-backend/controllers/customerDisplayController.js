import {
    createPairRequest,
    pairDeviceWithCode,
    listDevices,
    updateDevice,
    removeDevice,
    recordHeartbeat,
    getDeviceStatus,
} from '../services/customerDisplayService.js';
import { assignDeviceToStation } from '../services/stationRoutingService.js';
import { restoreDisplaySession } from '../services/displayRecoveryService.js';
import { getActiveSessions } from '../services/displaySessionService.js';
import { getTimelineByReceipt } from '../services/paymentTimelineService.js';

export const postPairRequest = async (req, res) => {
    try {
        const deviceName = String(req.body?.deviceName || req.body?.device_name || 'New Display Device').trim();
        const stationName = req.body?.stationName || req.body?.station_name || null;
        const result = await createPairRequest({ deviceName, stationName });
        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('postPairRequest error:', error);
        return res.status(500).json({ success: false, error: 'Failed to generate pair code' });
    }
};

export const postPairDevice = async (req, res) => {
    try {
        const pairCode = req.body?.pairCode || req.body?.pair_code;
        const deviceName = req.body?.deviceName || req.body?.device_name;
        const stationName = req.body?.stationName || req.body?.station_name;

        const result = await pairDeviceWithCode({ pairCode, deviceName, stationName });
        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
        console.error('postPairDevice error:', error);
        return res.status(500).json({ success: false, error: 'Failed to pair device' });
    }
};

export const getDevices = async (_req, res) => {
    try {
        const devices = await listDevices();
        return res.json({ success: true, data: devices });
    } catch (error) {
        console.error('getDevices error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch devices' });
    }
};

export const patchDevice = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const device = await updateDevice(id, {
            deviceName: req.body?.deviceName ?? req.body?.device_name,
            stationName: req.body?.stationName ?? req.body?.station_name,
        });

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        return res.json({ success: true, data: device });
    } catch (error) {
        console.error('patchDevice error:', error);
        return res.status(500).json({ success: false, error: 'Failed to update device' });
    }
};

export const deleteDevice = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const result = await removeDevice(id);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('deleteDevice error:', error);
        return res.status(500).json({ success: false, error: 'Failed to remove device' });
    }
};

export const patchDeviceStation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const stationId = req.body?.stationId ?? req.body?.station_id ?? null;
        const device = await assignDeviceToStation(id, stationId);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        return res.json({ success: true, data: device });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
        console.error('patchDeviceStation error:', error);
        return res.status(500).json({ success: false, error: 'Failed to assign station' });
    }
};

export const getCurrentSession = async (req, res) => {
    try {
        const deviceId = String(req.displayDeviceId || '').trim();
        const result = await restoreDisplaySession(deviceId);

        if (!result.restored) {
            return res.json({ success: true, session: null });
        }

        return res.json({ success: true, session: result.session });
    } catch (error) {
        console.error('getCurrentSession error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load current session' });
    }
};

export const getDisplaySessions = async (req, res) => {
    try {
        const status = req.query?.status ? String(req.query.status).toUpperCase() : null;
        const sessions = await getActiveSessions({ status });

        const data = sessions.map((session) => ({
            sessionId: session.sessionId,
            receipt_no: session.receiptNo,
            receiptNo: session.receiptNo,
            station: session.stationName || 'Unassigned',
            stationId: session.stationId,
            device_id: session.deviceId,
            deviceId: session.deviceId,
            amount: session.amount,
            status: session.status,
            createdAt: session.createdAt,
        }));

        return res.json({ success: true, data });
    } catch (error) {
        console.error('getDisplaySessions error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch display sessions' });
    }
};

export const getPaymentTimeline = async (req, res) => {
    try {
        const receiptNo = String(req.params.receiptNo || '').trim();
        if (!receiptNo) {
            return res.status(400).json({ success: false, error: 'Receipt number is required' });
        }

        const timeline = await getTimelineByReceipt(receiptNo);
        return res.json({ success: true, data: timeline });
    } catch (error) {
        console.error('getPaymentTimeline error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch payment timeline' });
    }
};

export const postHeartbeat = async (req, res) => {
    try {
        const deviceId = String(req.body?.deviceId || req.body?.device_id || req.displayDeviceId || '').trim();
        if (!deviceId || deviceId !== req.displayDeviceId) {
            return res.status(400).json({ success: false, error: 'Device ID mismatch' });
        }

        const result = await recordHeartbeat(deviceId);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('postHeartbeat error:', error);
        return res.status(500).json({ success: false, error: 'Heartbeat failed' });
    }
};

export const getDisplayStatus = async (req, res) => {
    try {
        const deviceId = String(req.query?.deviceId || req.query?.device_id || req.displayDeviceId || '').trim();
        const result = await getDeviceStatus(deviceId);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode === 404) {
            return res.status(404).json({ success: false, error: error.message });
        }
        console.error('getDisplayStatus error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch status' });
    }
};
