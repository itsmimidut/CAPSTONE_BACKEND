import { findDeviceByToken } from '../services/customerDisplayService.js';

export const authenticateDisplay = async (req, res, next) => {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

        if (!token) {
            return res.status(401).json({ success: false, error: 'Display token required', code: 'DISPLAY_TOKEN_MISSING' });
        }

        const device = await findDeviceByToken(token);
        if (!device) {
            return res.status(401).json({ success: false, error: 'Invalid display token', code: 'DISPLAY_TOKEN_INVALID' });
        }

        req.displayDevice = device;
        req.displayDeviceId = device.device_id;
        return next();
    } catch (error) {
        console.error('authenticateDisplay error:', error);
        return res.status(500).json({ success: false, error: 'Display authentication failed' });
    }
};
