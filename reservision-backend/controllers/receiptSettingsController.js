import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import {
  getReceiptSettings,
  updateReceiptSettings,
  resetReceiptSettingsToDefault,
  setReceiptLogo,
  clearReceiptLogo,
} from '../services/receiptSettingsService.js';
import { queueReceiptSettingsTestPrint } from '../services/posReceiptPrintService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECEIPT_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'receipts');

if (!fs.existsSync(RECEIPT_UPLOAD_DIR)) {
  fs.mkdirSync(RECEIPT_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECEIPT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

export const receiptLogoUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Allowed: PNG, JPG, WEBP.'));
  },
});

function deleteLocalLogoIfOwned(logoPath) {
  if (!logoPath || typeof logoPath !== 'string') return;
  if (!logoPath.startsWith('/uploads/receipts/')) return;
  const absolute = path.join(__dirname, '..', 'public', logoPath.replace(/^\//, ''));
  try {
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  } catch {
    /* ignore cleanup errors */
  }
}

export async function getReceiptSettingsHandler(req, res) {
  try {
    const settings = await getReceiptSettings();
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load receipt settings.' });
  }
}

export async function updateReceiptSettingsHandler(req, res) {
  try {
    const settings = await updateReceiptSettings(req.body || {});
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Failed to update receipt settings.' });
  }
}

export async function resetReceiptSettingsHandler(req, res) {
  try {
    const previous = await getReceiptSettings();
    deleteLocalLogoIfOwned(previous.printedLogo);
    deleteLocalLogoIfOwned(previous.emailedLogo);
    const settings = await resetReceiptSettingsToDefault();
    try {
      const { clearEscPosLogoCache } = await import('../services/escposLogoService.js');
      clearEscPosLogoCache();
    } catch {
      /* ignore */
    }
    return res.json({ success: true, settings, message: 'Receipt settings reset to defaults.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to reset receipt settings.' });
  }
}

export async function uploadReceiptLogoHandler(req, res) {
  try {
    const logoType = String(req.body?.logoType || req.query?.logoType || 'printed').toLowerCase();
    if (!['printed', 'emailed'].includes(logoType)) {
      return res.status(400).json({ success: false, message: 'logoType must be printed or emailed.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }

    const previous = await getReceiptSettings();
    const previousPath = logoType === 'emailed' ? previous.emailedLogo : previous.printedLogo;
    const relativePath = `/uploads/receipts/${req.file.filename}`;
    const settings = await setReceiptLogo(logoType, relativePath);
    deleteLocalLogoIfOwned(previousPath);

    try {
      const { clearEscPosLogoCache } = await import('../services/escposLogoService.js');
      clearEscPosLogoCache();
    } catch {
      /* ignore */
    }

    return res.json({
      success: true,
      settings,
      logoType,
      url: relativePath,
      message: `${logoType === 'emailed' ? 'Emailed' : 'Printed'} receipt logo uploaded.`,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to upload receipt logo.',
    });
  }
}

export async function removeReceiptLogoHandler(req, res) {
  try {
    const logoType = String(req.params.logoType || '').toLowerCase();
    if (!['printed', 'emailed'].includes(logoType)) {
      return res.status(400).json({ success: false, message: 'logoType must be printed or emailed.' });
    }

    const previous = await getReceiptSettings();
    const previousPath = logoType === 'emailed' ? previous.emailedLogo : previous.printedLogo;
    const settings = await clearReceiptLogo(logoType);
    deleteLocalLogoIfOwned(previousPath);

    try {
      const { clearEscPosLogoCache } = await import('../services/escposLogoService.js');
      clearEscPosLogoCache();
    } catch {
      /* ignore */
    }

    return res.json({
      success: true,
      settings,
      message: `${logoType === 'emailed' ? 'Emailed' : 'Printed'} logo removed.`,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Failed to remove logo.' });
  }
}

export async function testReceiptSettingsPrintHandler(req, res) {
  try {
    const result = await queueReceiptSettingsTestPrint();
    const status = result.success ? 200 : 400;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to print test receipt',
      error: error.message || 'Unexpected error',
    });
  }
}
