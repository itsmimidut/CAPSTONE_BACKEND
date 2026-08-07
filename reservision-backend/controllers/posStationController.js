import {
    listStations,
    createStation,
    updateStation,
    deleteStation,
} from '../services/posStationService.js';

export const getPosStations = async (req, res) => {
    try {
        const stations = await listStations({ activeOnly: ['1', 'true'].includes(String(req.query?.activeOnly || '').toLowerCase()) });
        return res.json({ success: true, data: stations });
    } catch (error) {
        console.error('getPosStations error:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch POS stations' });
    }
};

export const postPosStation = async (req, res) => {
    try {
        const station = await createStation({
            stationCode: req.body?.stationCode || req.body?.station_code,
            stationName: req.body?.stationName || req.body?.station_name,
            description: req.body?.description,
            location: req.body?.location,
            active: req.body?.active,
        });
        return res.status(201).json({ success: true, data: station });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Station code already exists' });
        }
        console.error('postPosStation error:', error);
        return res.status(500).json({ success: false, error: 'Failed to create station' });
    }
};

export const patchPosStation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const station = await updateStation(id, {
            stationCode: req.body?.stationCode ?? req.body?.station_code,
            stationName: req.body?.stationName ?? req.body?.station_name,
            description: req.body?.description,
            location: req.body?.location,
            active: req.body?.active,
        });
        if (!station) {
            return res.status(404).json({ success: false, error: 'Station not found' });
        }
        return res.json({ success: true, data: station });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code, dependencies: error.dependencies });
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Station code already exists' });
        }
        console.error('patchPosStation error:', error);
        return res.status(500).json({ success: false, error: 'Failed to update station' });
    }
};

export const deletePosStation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const result = await deleteStation(id);
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code, dependencies: error.dependencies });
        }
        console.error('deletePosStation error:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete station' });
    }
};
