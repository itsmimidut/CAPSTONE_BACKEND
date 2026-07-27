import {
  createPrinter,
  deletePrinter,
  evaluateAutoPrintEligibility,
  getDefaultPrinter,
  getPrinterById,
  getPrinters,
  setDefaultPrinter,
  updatePrinter,
} from '../services/posPrinterSettingsService.js';
import {
  queuePrinterPreviewTestPrint,
  queuePrinterTestPrint,
} from '../services/posReceiptPrintService.js';

export async function listPrinters(req, res) {
  try {
    const printers = await getPrinters({ includeInactive: false });
    return res.json({ success: true, printers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load printers.' });
  }
}

export async function getDefaultPrinterHandler(req, res) {
  try {
    const printer = await getDefaultPrinter();
    return res.json({ success: true, printer });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load default printer.' });
  }
}

export async function getPrinterHandler(req, res) {
  try {
    const printer = await getPrinterById(Number(req.params.id));
    if (!printer || !printer.isActive) {
      return res.status(404).json({ success: false, message: 'Printer not found.' });
    }
    return res.json({ success: true, printer });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load printer.' });
  }
}

export async function createPrinterHandler(req, res) {
  try {
    const printer = await createPrinter(req.body || {});
    return res.status(201).json({ success: true, printer });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Failed to create printer.' });
  }
}

export async function updatePrinterHandler(req, res) {
  try {
    const printer = await updatePrinter(Number(req.params.id), req.body || {});
    return res.json({ success: true, printer });
  } catch (error) {
    const status = error.message === 'Printer not found.' ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message || 'Failed to update printer.' });
  }
}

export async function deletePrinterHandler(req, res) {
  try {
    await deletePrinter(Number(req.params.id));
    return res.json({ success: true, message: 'Printer removed.' });
  } catch (error) {
    const status = error.message === 'Printer not found.' ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message || 'Failed to delete printer.' });
  }
}

export async function setDefaultPrinterHandler(req, res) {
  try {
    const printer = await setDefaultPrinter(Number(req.params.id));
    return res.json({ success: true, printer });
  } catch (error) {
    const status = error.message === 'Printer not found.' ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message || 'Failed to set default printer.' });
  }
}

export async function testPrinterHandler(req, res) {
  try {
    const result = await queuePrinterTestPrint(Number(req.params.id));
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

export async function testPrinterPreviewHandler(req, res) {
  try {
    const result = await queuePrinterPreviewTestPrint(req.body || {});
    const status = result.success ? 200 : 400;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to test printer configuration.',
    });
  }
}

export async function getAutoPrintStatus(req, res) {
  try {
    const eligibility = await evaluateAutoPrintEligibility();
    return res.json({ success: true, ...eligibility });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to evaluate auto-print.' });
  }
}
