import {
  registerBridgeDevice,
  heartbeat,
  getActiveBridgeDevices,
  updateBridgeDevice,
  deactivateBridgeDevice,
  authenticateBridgeDevice,
  getPendingBridgeJobs,
  claimBridgeJob,
  getBridgeJobPayload,
  markBridgeJobCompleted,
  markBridgeJobFailed,
  getBridgeDeviceByCode,
  reportConnectorPrinters,
  regenerateBridgeDeviceToken,
} from '../services/printBridgeService.js';

function extractBridgeCredentials(req) {
  const body = req.body || {};
  const query = req.query || {};
  const deviceCode =
    body.deviceCode ||
    body.device_code ||
    query.deviceCode ||
    query.device_code ||
    req.headers['x-bridge-device-code'] ||
    null;
  const pairingToken =
    body.pairingToken ||
    body.pairing_token ||
    query.pairingToken ||
    query.pairing_token ||
    req.headers['x-bridge-token'] ||
    null;
  return {
    deviceCode: deviceCode ? String(deviceCode).trim() : '',
    pairingToken: pairingToken ? String(pairingToken).trim() : '',
  };
}

async function requireBridgeAuth(req) {
  const { deviceCode, pairingToken } = extractBridgeCredentials(req);
  if (!deviceCode || !pairingToken) {
    const err = new Error('deviceCode and pairingToken are required.');
    err.status = 401;
    throw err;
  }
  return authenticateBridgeDevice({ deviceCode, pairingToken });
}

function sendError(res, error, fallback = 'Bridge request failed.') {
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    message: error.message || fallback,
  });
}

export async function registerBridgeDeviceHandler(req, res) {
  try {
    const device = await registerBridgeDevice(req.body || {});
    return res.status(201).json({
      success: true,
      device,
      message: 'Bridge device registered. Store pairingToken securely on the Android app.',
    });
  } catch (error) {
    return sendError(res, error, 'Failed to register bridge device.');
  }
}

export async function heartbeatHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const device = await heartbeat(deviceCode, req.body || {});
    // Strip token from response
    const { pairingToken, ...safe } = device || {};
    return res.json({ success: true, device: safe });
  } catch (error) {
    return sendError(res, error, 'Heartbeat failed.');
  }
}

export async function listBridgeJobsHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const jobs = await getPendingBridgeJobs(deviceCode);
    return res.json({ success: true, jobs });
  } catch (error) {
    return sendError(res, error, 'Failed to list bridge jobs.');
  }
}

export async function claimBridgeJobHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const result = await claimBridgeJob(req.params.id, deviceCode);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Failed to claim job.');
  }
}

export async function getBridgeJobPayloadHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const { buffer, filename } = await getBridgeJobPayload(req.params.id, deviceCode);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    return sendError(res, error, 'Failed to download job payload.');
  }
}

export async function completeBridgeJobHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const result = await markBridgeJobCompleted(req.params.id, deviceCode);
    return res.json({ success: true, ...result, message: 'Print job marked completed.' });
  } catch (error) {
    return sendError(res, error, 'Failed to complete job.');
  }
}

export async function failBridgeJobHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const errorMessage =
      req.body?.error ||
      req.body?.errorMessage ||
      req.body?.message ||
      'Bluetooth print failed';
    const result = await markBridgeJobFailed(req.params.id, deviceCode, errorMessage);
    return res.json({ success: true, ...result, message: 'Print job marked failed.' });
  } catch (error) {
    return sendError(res, error, 'Failed to mark job failed.');
  }
}

export async function reportConnectorPrintersHandler(req, res) {
  try {
    await requireBridgeAuth(req);
    const { deviceCode } = extractBridgeCredentials(req);
    const printers = req.body?.printers || [];
    const result = await reportConnectorPrinters(deviceCode, printers);
    return res.json({
      success: true,
      ...result,
      message: `Reported ${result.count} local printer target(s).`,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to report connector printers.');
  }
}

export async function listBridgeDevicesHandler(req, res) {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1';
    const requestedStatus = String(req.query.status || '').trim().toLowerCase();
    let devices = await getActiveBridgeDevices({ includeInactive });
    if (requestedStatus) {
      devices = devices.filter(
        (device) => String(device.status || '').toLowerCase() === requestedStatus
      );
    }
    return res.json({ success: true, devices });
  } catch (error) {
    return sendError(res, error, 'Failed to list bridge devices.');
  }
}

export async function updateBridgeDeviceHandler(req, res) {
  try {
    const device = await updateBridgeDevice(req.params.id, req.body || {});
    return res.json({ success: true, device });
  } catch (error) {
    return sendError(res, error, 'Failed to update bridge device.');
  }
}

export async function regenerateBridgeDeviceTokenHandler(req, res) {
  try {
    const device = await regenerateBridgeDeviceToken(req.params.id);
    return res.json({
      success: true,
      device,
      message:
        'Pairing token regenerated. Update the connector .env with the new token — the old token no longer works.',
    });
  } catch (error) {
    return sendError(res, error, 'Failed to regenerate pairing token.');
  }
}

export async function deactivateBridgeDeviceHandler(req, res) {
  try {
    const device = await deactivateBridgeDevice(req.params.id);
    return res.json({ success: true, device, message: 'Bridge device deactivated.' });
  } catch (error) {
    return sendError(res, error, 'Failed to deactivate bridge device.');
  }
}

export async function createAdminBridgeDeviceHandler(req, res) {
  try {
    const device = await registerBridgeDevice(req.body || {});
    return res.status(201).json({
      success: true,
      device,
      message: 'Bridge device created. Copy the pairing token into the Android app.',
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create bridge device.');
  }
}

export async function getBridgeDeviceCodeHandler(req, res) {
  try {
    const device = await getBridgeDeviceByCode(req.params.code);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Bridge device not found.' });
    }
    const { pairingToken, ...safe } = device;
    return res.json({ success: true, device: safe });
  } catch (error) {
    return sendError(res, error, 'Failed to load bridge device.');
  }
}
