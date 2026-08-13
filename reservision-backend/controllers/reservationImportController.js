import {
  confirmReservationImport,
  listReservationImportBatches,
  previewReservationImport,
  rollbackReservationImport,
} from '../services/reservationImportService.js';
import { invalidateReservationCache } from './bookingsController.js';
import { generateReservationImportTemplate } from '../services/reservationImportTemplateService.js';

const actor = (req) => req.user?.email || req.user?.username || req.user?.user_id || 'admin';
const failure = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Reservation import failed.' });

export const downloadImportTemplate = async (_req, res) => {
  try {
    const buffer = await generateReservationImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reservation-import-template.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(Buffer.from(buffer));
  } catch (error) { return failure(res, error); }
};

export const previewImport = async (req, res) => {
  try {
    return res.json({ success: true, data: await previewReservationImport(req.body || {}) });
  } catch (error) { return failure(res, error); }
};

export const confirmImport = async (req, res) => {
  try {
    const data = await confirmReservationImport({ ...(req.body || {}), createdBy: actor(req) });
    invalidateReservationCache();
    return res.status(201).json({ success: true, data });
  } catch (error) { return failure(res, error); }
};

export const listImports = async (req, res) => {
  try { return res.json({ success: true, data: await listReservationImportBatches(req.query.limit) }); }
  catch (error) { return failure(res, error); }
};

export const rollbackImport = async (req, res) => {
  try {
    const data = await rollbackReservationImport(Number(req.params.id), actor(req));
    invalidateReservationCache();
    return res.json({ success: true, data });
  }
  catch (error) { return failure(res, error); }
};
