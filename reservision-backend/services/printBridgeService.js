import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/db.js';
import {
  PRINT_JOB_STATUS,
  getPrintJobById,
  markPrintJobFailed,
  markPrintJobSent,
} from './printJobService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRINT_QUEUE_DIR = process.env.PRINT_QUEUE_DIR
  ? path.resolve(process.env.PRINT_QUEUE_DIR)
  : path.resolve(__dirname, '..', 'print-queue');

const BRIDGE_PAYLOAD_DIR = process.env.PRINT_BRIDGE_PAYLOAD_DIR
  ? path.resolve(process.env.PRINT_BRIDGE_PAYLOAD_DIR)
  : path.resolve(__dirname, '..', 'print-bridge-payloads');

const PRINTED_DIR = path.resolve(__dirname, '..', 'printed');
const FAILED_DIR = path.resolve(__dirname, '..', 'failed');

/** Bridge considered online if heartbeat within this window. */
export const BRIDGE_ONLINE_MS = Math.max(
  15000,
  Number(process.env.PRINT_BRIDGE_ONLINE_MS || 60000)
);

export async function ensurePrintBridgeSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS print_bridge_devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_name VARCHAR(150) NOT NULL,
      device_code VARCHAR(100) UNIQUE NOT NULL,
      pairing_token VARCHAR(255) DEFAULT NULL,
      station_id INT DEFAULT NULL,
      status ENUM('online', 'offline', 'unknown') DEFAULT 'unknown',
      last_seen_at DATETIME DEFAULT NULL,
      app_version VARCHAR(50) DEFAULT NULL,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureBridgeDeviceExtraColumns();
  await ensurePosPrinterBridgeColumns();
  await ensurePrintJobBridgeColumns();
  ensureBridgePayloadDir();
}

async function ensureBridgeDeviceExtraColumns() {
  const columns = [
    { name: 'installation_id', definition: 'VARCHAR(100) NULL' },
    { name: 'hostname', definition: 'VARCHAR(255) NULL' },
    { name: 'operating_system', definition: 'VARCHAR(150) NULL' },
    { name: 'registered_at', definition: 'DATETIME NULL' },
    { name: 'is_revoked', definition: 'TINYINT DEFAULT 0' },
    { name: 'device_type', definition: "ENUM('windows', 'android', 'unknown') DEFAULT 'unknown'" },
    { name: 'capabilities', definition: 'JSON NULL' },
    { name: 'reported_printers', definition: 'JSON NULL' },
    { name: 'reported_at', definition: 'DATETIME NULL' },
  ];
  for (const column of columns) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'print_bridge_devices'
         AND COLUMN_NAME = ?`,
      [column.name]
    );
    if (!rows.length) {
      await db.query(
        `ALTER TABLE print_bridge_devices ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
  const [indexes] = await db.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_bridge_devices'
       AND INDEX_NAME = 'uq_print_bridge_installation_id' LIMIT 1`
  );
  if (!indexes.length) {
    await db.query(
      'CREATE UNIQUE INDEX uq_print_bridge_installation_id ON print_bridge_devices (installation_id)'
    );
  }
}

async function ensurePosPrinterBridgeColumns() {
  const columns = [
    { name: 'bridge_device_id', definition: 'INT NULL' },
    { name: 'bluetooth_address', definition: 'VARCHAR(150) NULL' },
    { name: 'connector_device_id', definition: 'INT NULL' },
    {
      name: 'connection_method',
      definition:
        "ENUM('ethernet', 'windows_printer', 'bluetooth_serial', 'android_bluetooth') DEFAULT 'windows_printer'",
    },
    { name: 'com_port', definition: 'VARCHAR(50) NULL' },
    { name: 'baud_rate', definition: 'INT DEFAULT 9600' },
  ];
  for (const column of columns) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'pos_printers'
         AND COLUMN_NAME = ?`,
      [column.name]
    );
    if (!rows.length) {
      await db.query(
        `ALTER TABLE pos_printers ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
}

async function ensurePrintJobBridgeColumns() {
  const columns = [
    { name: 'claimed_by_bridge_id', definition: 'INT NULL' },
    { name: 'claimed_at', definition: 'DATETIME NULL' },
    { name: 'delivered_at', definition: 'DATETIME NULL' },
  ];
  for (const column of columns) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'print_jobs'
         AND COLUMN_NAME = ?`,
      [column.name]
    );
    if (!rows.length) {
      await db.query(
        `ALTER TABLE print_jobs ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
}

function ensureBridgePayloadDir() {
  if (!fs.existsSync(BRIDGE_PAYLOAD_DIR)) {
    fs.mkdirSync(BRIDGE_PAYLOAD_DIR, { recursive: true });
  }
}

function generateDeviceCode() {
  return `BRIDGE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function generatePairingToken() {
  return crypto.randomBytes(24).toString('hex');
}

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireRegistrationCredential(value) {
  const expected = process.env.PRINT_CONNECTOR_REGISTRATION_CREDENTIAL;
  if (!expected) {
    const err = new Error('Automatic connector registration is not configured.');
    err.status = 503;
    err.code = 'CONNECTOR_REGISTRATION_NOT_CONFIGURED';
    throw err;
  }
  if (!secureEquals(value, expected)) {
    const err = new Error('Invalid connector registration credential.');
    err.status = 401;
    err.code = 'INVALID_REGISTRATION_CREDENTIAL';
    throw err;
  }
}

function computeLiveStatus(row) {
  if (!row?.is_active) return 'offline';
  if (!row.last_seen_at) return row.status || 'unknown';
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen)) return 'unknown';
  if (Date.now() - lastSeen <= BRIDGE_ONLINE_MS) return 'online';
  return 'offline';
}

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function defaultCapabilitiesForType(deviceType) {
  const type = String(deviceType || 'unknown').toLowerCase();
  if (type === 'windows') {
    return { windows_printers: true, com_ports: true, android_bluetooth: false };
  }
  if (type === 'android') {
    return { windows_printers: false, com_ports: false, android_bluetooth: true };
  }
  return { windows_printers: false, com_ports: false, android_bluetooth: false };
}

function normalizeDeviceType(value) {
  const type = String(value || 'unknown').toLowerCase();
  return ['windows', 'android', 'unknown'].includes(type) ? type : 'unknown';
}

function normalizeCapabilities(input, deviceType) {
  if (Array.isArray(input)) {
    const values = new Set(input.map((value) => String(value).toLowerCase()));
    return {
      windows_printers: values.has('windows_printer') || values.has('windows_printers'),
      com_ports: values.has('bluetooth_serial') || values.has('com_ports'),
      android_bluetooth: values.has('android_bluetooth'),
    };
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      windows_printers: Boolean(input.windows_printers ?? input.windowsPrinters),
      com_ports: Boolean(input.com_ports ?? input.comPorts),
      android_bluetooth: Boolean(input.android_bluetooth ?? input.androidBluetooth),
    };
  }
  return defaultCapabilitiesForType(deviceType);
}

function mapBridgeDeviceRow(row, { includeToken = false } = {}) {
  if (!row) return null;
  const deviceType = normalizeDeviceType(row.device_type);
  const mapped = {
    id: row.id,
    deviceName: row.device_name,
    deviceCode: row.device_code,
    installationId: row.installation_id || null,
    hostname: row.hostname || null,
    operatingSystem: row.operating_system || null,
    deviceType,
    capabilities: parseJsonField(row.capabilities, defaultCapabilitiesForType(deviceType)),
    reportedPrinters: parseJsonField(row.reported_printers, []),
    reportedAt: row.reported_at || null,
    stationId: row.station_id ?? null,
    stationName: row.station_name || null,
    status: computeLiveStatus(row),
    lastSeenAt: row.last_seen_at,
    appVersion: row.app_version || null,
    isActive: Boolean(row.is_active),
    isRevoked: Boolean(row.is_revoked),
    state: row.is_revoked ? 'REVOKED' : !row.is_active ? 'DISABLED' : row.station_id ? (computeLiveStatus(row) === 'online' ? 'ACTIVE' : 'OFFLINE') : (computeLiveStatus(row) === 'online' ? 'UNASSIGNED' : 'OFFLINE'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeToken) {
    mapped.pairingToken = row.pairing_token || null;
  }
  return mapped;
}

export function isBridgeDeviceOnline(device) {
  if (!device) return false;
  return computeLiveStatus({
    is_active: device.isActive !== false ? 1 : 0,
    last_seen_at: device.lastSeenAt,
    status: device.status,
  }) === 'online';
}

export async function getBridgeDeviceByCode(deviceCode) {
  await ensurePrintBridgeSchema();
  const code = String(deviceCode || '').trim();
  if (!code) return null;
  const [rows] = await db.query(
    `SELECT d.*, ps.station_name
     FROM print_bridge_devices d
     LEFT JOIN pos_stations ps ON ps.id = d.station_id
     WHERE d.device_code = ?
     LIMIT 1`,
    [code]
  );
  return rows[0] ? mapBridgeDeviceRow(rows[0], { includeToken: true }) : null;
}

export async function getBridgeDeviceById(id) {
  await ensurePrintBridgeSchema();
  const [rows] = await db.query(
    `SELECT d.*, ps.station_name
     FROM print_bridge_devices d
     LEFT JOIN pos_stations ps ON ps.id = d.station_id
     WHERE d.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapBridgeDeviceRow(rows[0], { includeToken: false }) : null;
}

const tokenPreview = (token) => {
  const value = String(token || '');
  if (!value) return null;
  if (value.length <= 8) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

function logBridgeAuthFailure(reason, { deviceCode, pairingToken, device }) {
  console.warn('[PrintBridgeAuth]', {
    reason,
    receivedDeviceCode: deviceCode || null,
    deviceExists: !!device,
    active: device ? device.isActive : null,
    receivedTokenLength: pairingToken ? String(pairingToken).length : 0,
    storedTokenLength: device?.pairingToken ? String(device.pairingToken).length : 0,
    receivedTokenPreview: tokenPreview(pairingToken),
    storedTokenPreview: tokenPreview(device?.pairingToken),
  });
}

export async function authenticateBridgeDevice({ deviceCode, pairingToken }) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device) {
    logBridgeAuthFailure('DEVICE_NOT_FOUND', { deviceCode, pairingToken, device });
    const err = new Error('Invalid device code or pairing token.');
    err.status = 401;
    throw err;
  }
  if (!device.isActive) {
    logBridgeAuthFailure('DEVICE_INACTIVE', { deviceCode, pairingToken, device });
    const err = new Error('Print connector is deactivated.');
    err.status = 401;
    throw err;
  }
  const expected = String(device.pairingToken || '');
  const provided = String(pairingToken || '');
  if (!expected) {
    logBridgeAuthFailure('MISSING_STORED_PAIRING_TOKEN', { deviceCode, pairingToken, device });
    const err = new Error('Connector has no pairing token. Regenerate it in Admin > Print Connectors.');
    err.status = 401;
    throw err;
  }
  if (!provided || expected !== provided) {
    logBridgeAuthFailure(provided ? 'TOKEN_MISMATCH' : 'MISSING_PAIRING_TOKEN', {
      deviceCode,
      pairingToken,
      device,
    });
    const err = new Error('Invalid device code or pairing token.');
    err.status = 401;
    throw err;
  }
  return device;
}

export async function registerBridgeDevice(data = {}) {
  await ensurePrintBridgeSchema();

  const deviceName = String(data.deviceName || data.device_name || '').trim();
  if (!deviceName) {
    const err = new Error('deviceName is required.');
    err.status = 400;
    throw err;
  }

  let deviceCode = String(data.deviceCode || data.device_code || '').trim();
  if (!deviceCode) deviceCode = generateDeviceCode();

  const pairingToken = generatePairingToken();
  const stationId = data.stationId ?? data.station_id ?? null;
  if (stationId != null && stationId !== '') {
    const [stations] = await db.query('SELECT id FROM pos_stations WHERE id = ? AND active = 1 LIMIT 1', [stationId]);
    if (!stations.length) {
      const err = new Error('The selected station is inactive or does not exist.');
      err.status = 400;
      err.code = 'STATION_INACTIVE';
      throw err;
    }
  }
  const appVersion = data.appVersion || data.app_version || null;
  const deviceType = normalizeDeviceType(data.deviceType || data.device_type);
  const capabilities = normalizeCapabilities(data.capabilities, deviceType);

  try {
    const [result] = await db.query(
      `INSERT INTO print_bridge_devices
       (device_name, device_code, pairing_token, station_id, status, last_seen_at, app_version,
        device_type, capabilities, is_active)
       VALUES (?, ?, ?, ?, 'online', NOW(), ?, ?, ?, 1)`,
      [
        deviceName,
        deviceCode,
        pairingToken,
        stationId || null,
        appVersion,
        deviceType,
        JSON.stringify(capabilities),
      ]
    );
    const device = await getBridgeDeviceById(result.insertId);
    return {
      ...device,
      pairingToken,
      deviceCode,
    };
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      const err = new Error('deviceCode already registered. Use heartbeat or a new deviceCode.');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

/** First-start registration for an installed background connector. */
export async function automaticallyRegisterConnector(data = {}) {
  await ensurePrintBridgeSchema();
  requireRegistrationCredential(data.registrationCredential || data.registration_credential);
  const installationId = String(data.installationId || data.installation_id || '').trim();
  if (!installationId) {
    const err = new Error('installationId is required.');
    err.status = 400;
    err.code = 'INSTALLATION_ID_REQUIRED';
    throw err;
  }

  const [rows] = await db.query('SELECT * FROM print_bridge_devices WHERE installation_id = ? LIMIT 1', [installationId]);
  const existing = rows[0];
  if (existing?.is_revoked) {
    const err = new Error('This connector installation has been revoked.');
    err.status = 403;
    err.code = 'CONNECTOR_REVOKED';
    throw err;
  }

  const deviceName = String(data.deviceName || data.device_name || data.hostname || 'POS Device').trim();
  const deviceCode = String(data.deviceCode || data.device_code || '').trim() || generateDeviceCode();
  const appVersion = data.connectorVersion || data.connector_version || data.appVersion || null;
  const hostname = String(data.hostname || '').trim() || null;
  const operatingSystem = String(data.operatingSystem || data.operating_system || '').trim() || null;
  const deviceType = normalizeDeviceType(data.deviceType || (/windows/i.test(operatingSystem || '') ? 'windows' : 'unknown'));
  const capabilities = normalizeCapabilities(data.capabilities, deviceType);

  if (existing) {
    const providedToken = data.connectorToken || data.connector_token || data.pairingToken;
    if (!secureEquals(providedToken, existing.pairing_token)) {
      const err = new Error('The permanent connector credential is required to restore this installation.');
      err.status = 401;
      err.code = 'INVALID_CONNECTOR_CREDENTIAL';
      throw err;
    }
    await db.query(
      `UPDATE print_bridge_devices SET device_name = ?, hostname = ?, operating_system = ?,
       app_version = ?, device_type = ?, capabilities = ?, last_seen_at = NOW(), status = 'online'
       WHERE id = ?`,
      [deviceName, hostname, operatingSystem, appVersion, deviceType, JSON.stringify(capabilities), existing.id]
    );
    const device = await getBridgeDeviceById(existing.id);
    return { ...device, connectorToken: null, heartbeatIntervalSeconds: 20, configuredPrinterCount: 0 };
  }

  const connectorToken = generatePairingToken();
  const [result] = await db.query(
    `INSERT INTO print_bridge_devices
     (installation_id, device_name, device_code, pairing_token, status, last_seen_at, app_version,
      device_type, capabilities, hostname, operating_system, registered_at, is_active, is_revoked)
     VALUES (?, ?, ?, ?, 'online', NOW(), ?, ?, ?, ?, ?, NOW(), 1, 0)`,
    [installationId, deviceName, deviceCode, connectorToken, appVersion, deviceType, JSON.stringify(capabilities), hostname, operatingSystem]
  );
  const device = await getBridgeDeviceById(result.insertId);
  return { ...device, connectorToken, heartbeatIntervalSeconds: 20, configuredPrinterCount: 0 };
}

export async function heartbeat(deviceCode, data = {}) {
  await ensurePrintBridgeSchema();
  const code = String(deviceCode || data.deviceCode || '').trim();
  if (!code) {
    const err = new Error('deviceCode is required.');
    err.status = 400;
    throw err;
  }

  const appVersion = data.appVersion || data.app_version || null;
  const deviceType = data.deviceType || data.device_type;
  const capabilities = data.capabilities;

  let sql = `UPDATE print_bridge_devices
     SET status = 'online',
         last_seen_at = NOW(),
         app_version = COALESCE(?, app_version)`;
  const params = [appVersion];

  if (deviceType !== undefined) {
    sql += ', device_type = ?';
    params.push(normalizeDeviceType(deviceType));
  }
  if (capabilities !== undefined) {
    sql += ', capabilities = ?';
    params.push(JSON.stringify(normalizeCapabilities(capabilities, deviceType)));
  }

  sql += ' WHERE device_code = ? AND is_active = 1';
  params.push(code);

  const [result] = await db.query(sql, params);

  if (!result.affectedRows) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  return getBridgeDeviceByCode(code);
}

export async function getActiveBridgeDevices({ includeInactive = false } = {}) {
  await ensurePrintBridgeSchema();
  const where = includeInactive ? '' : 'WHERE d.is_active = 1';
  const [rows] = await db.query(
    `SELECT d.*, ps.station_name
     FROM print_bridge_devices d
     LEFT JOIN pos_stations ps ON ps.id = d.station_id
     ${where}
     ORDER BY d.device_name ASC`
  );
  return rows.map((row) => mapBridgeDeviceRow(row));
}

export async function updateBridgeDevice(id, data = {}) {
  await ensurePrintBridgeSchema();
  const existing = await getBridgeDeviceById(id);
  if (!existing) {
    const err = new Error('Bridge device not found.');
    err.status = 404;
    throw err;
  }

  const deviceName = data.deviceName !== undefined
    ? String(data.deviceName || '').trim()
    : existing.deviceName;
  if (!deviceName) {
    const err = new Error('deviceName is required.');
    err.status = 400;
    throw err;
  }

  const stationId = data.stationId !== undefined ? data.stationId : existing.stationId;
  if (stationId != null && stationId !== '') {
    const [stations] = await db.query('SELECT id FROM pos_stations WHERE id = ? AND active = 1 LIMIT 1', [stationId]);
    if (!stations.length) {
      const err = new Error('The selected station is inactive or does not exist.');
      err.status = 400;
      err.code = 'STATION_INACTIVE';
      throw err;
    }
  }
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing.isActive ? 1 : 0);
  const deviceType = data.deviceType !== undefined
    ? normalizeDeviceType(data.deviceType)
    : existing.deviceType;
  const capabilities = data.capabilities !== undefined
    ? normalizeCapabilities(data.capabilities, deviceType)
    : (existing.capabilities || defaultCapabilitiesForType(deviceType));

  await db.query(
    `UPDATE print_bridge_devices
     SET device_name = ?, station_id = ?, is_active = ?, device_type = ?, capabilities = ?
     WHERE id = ?`,
    [deviceName, stationId || null, isActive, deviceType, JSON.stringify(capabilities), id]
  );

  return getBridgeDeviceById(id);
}

export async function deactivateBridgeDevice(id) {
  return updateBridgeDevice(id, { isActive: false });
}

/**
 * Regenerate the pairing token for a connector. Returns the device WITH the
 * new token so the admin can copy it into the connector's .env. The old token
 * stops working immediately.
 */
export async function regenerateBridgeDeviceToken(id) {
  await ensurePrintBridgeSchema();
  const existing = await getBridgeDeviceById(id);
  if (!existing) {
    const err = new Error('Bridge device not found.');
    err.status = 404;
    throw err;
  }

  const newToken = generatePairingToken();
  await db.query(
    'UPDATE print_bridge_devices SET pairing_token = ? WHERE id = ?',
    [newToken, id]
  );

  const device = await getBridgeDeviceByCode(existing.deviceCode);
  return device; // includes pairingToken (getBridgeDeviceByCode uses includeToken: true)
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

function jobMatchesBridge(job, bridgeId) {
  const config = parseConfig(job.printerConfig || job.printer_config);
  const assigned = Number(
    config.connector_device_id ||
    config.connectorDeviceId ||
    config.bridge_device_id ||
    config.bridgeDeviceId ||
    0
  );
  return assigned === Number(bridgeId);
}

/** True when a print job is owned by a remote Print Connector (not backend daemon). */
export function jobHasConnectorOwner(config = {}) {
  const cfg = parseConfig(config);
  return Boolean(
    cfg.connector_device_id ||
    cfg.connectorDeviceId ||
    cfg.bridge_device_id ||
    cfg.bridgeDeviceId
  );
}

function resolvePayloadUrl(jobId) {
  return `/api/pos/print-bridge/jobs/${jobId}/payload`;
}

export async function reportConnectorPrinters(deviceCode, printers = []) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Print connector not found or inactive.');
    err.status = 404;
    throw err;
  }

  const list = Array.isArray(printers) ? printers : [];
  const normalized = list.map((item) => {
    const type = String(item.type || item.connection_method || 'unknown').toLowerCase();
    const name = item.name || item.printer_name || null;
    const comPort = item.com_port || item.comPort || null;
    const address = item.bluetooth_address || item.bluetoothAddress || null;
    const windowsName = item.windows_printer_name || item.windowsPrinterName || item.name || null;
    const identity = type === 'bluetooth_serial' ? comPort : type === 'android_bluetooth' ? address : windowsName;
    return {
      printer_key: String(item.printer_key || item.printerKey || `${type}:${identity || name || 'unknown'}`),
      type,
      name,
      com_port: comPort,
      baud_rate: item.baud_rate ?? item.baudRate ?? null,
      bluetooth_address: address,
      windows_printer_name: windowsName,
    };
  }).filter((item) => item.name || item.com_port || item.bluetooth_address);

  await db.query(
    `UPDATE print_bridge_devices
     SET reported_printers = ?,
         reported_at = NOW(),
         status = 'online',
         last_seen_at = NOW()
     WHERE id = ?`,
    [JSON.stringify(normalized), device.id]
  );

  return {
    deviceId: device.id,
    deviceCode: device.deviceCode,
    count: normalized.length,
    printers: normalized,
  };
}

export async function getPendingBridgeJobs(deviceCode) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  // Connector-owned jobs: any interface with matching connector/bridge id in printer_config.
  const [rows] = await db.query(
    `SELECT *
     FROM print_jobs
     WHERE status = ?
       AND (claimed_by_bridge_id IS NULL OR claimed_by_bridge_id = ?)
       AND job_file IS NOT NULL
     ORDER BY created_at ASC, id ASC
     LIMIT 80`,
    [PRINT_JOB_STATUS.QUEUED, device.id]
  );

  return rows
    .map((row) => ({
      id: row.id,
      jobType: row.job_type || row.print_type,
      printType: row.print_type,
      printerId: row.printer_id,
      printerName: row.printer_name,
      printerInterface: row.printer_interface,
      printerConfig: parseConfig(row.printer_config),
      status: row.claimed_at ? 'processing' : 'pending',
      claimedAt: row.claimed_at,
      createdAt: row.created_at,
      jobFile: row.job_file,
    }))
    .filter((job) => jobMatchesBridge(job, device.id))
    .map((job) => {
      const config = job.printerConfig || {};
      return {
        jobId: job.id,
        jobType: job.jobType,
        printerId: job.printerId,
        connectionMethod: config.connection_method || config.connectionMethod || null,
        windowsPrinterName: config.windows_printer_name || config.windowsPrinterName || null,
        comPort: config.com_port || config.comPort || null,
        baudRate: config.baud_rate ?? config.baudRate ?? null,
        bluetoothDeviceName: config.bluetooth_device_name || config.bluetoothDeviceName || null,
        bluetoothAddress:
          config.bluetooth_address ||
          config.bluetoothAddress ||
          config.bluetooth_device_id ||
          config.bluetoothDeviceId ||
          null,
        createdAt: job.createdAt,
        status: job.status,
        payloadUrl: resolvePayloadUrl(job.id),
      };
    });
}

export async function claimBridgeJob(jobId, deviceCode) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  const job = await getPrintJobById(jobId);
  if (!job) {
    const err = new Error('Print job not found.');
    err.status = 404;
    throw err;
  }
  if (!jobMatchesBridge(job, device.id)) {
    const err = new Error('Job is not assigned to this print connector.');
    err.status = 403;
    throw err;
  }
  if (job.status === PRINT_JOB_STATUS.SENT) {
    const err = new Error('Job already completed.');
    err.status = 409;
    throw err;
  }
  if (job.status === PRINT_JOB_STATUS.FAILED) {
    const err = new Error('Job already failed.');
    err.status = 409;
    throw err;
  }

  // Already claimed by another bridge?
  const [fresh] = await db.query(
    'SELECT claimed_by_bridge_id, claimed_at, status FROM print_jobs WHERE id = ? LIMIT 1',
    [jobId]
  );
  const claimedBy = fresh[0]?.claimed_by_bridge_id;
  if (claimedBy && Number(claimedBy) !== Number(device.id)) {
    const err = new Error('Job already claimed by another bridge device.');
    err.status = 409;
    throw err;
  }

  await db.query(
    `UPDATE print_jobs
     SET claimed_by_bridge_id = ?,
         claimed_at = COALESCE(claimed_at, NOW()),
         error_message = NULL
     WHERE id = ? AND status = ?`,
    [device.id, jobId, PRINT_JOB_STATUS.QUEUED]
  );

  return {
    jobId: Number(jobId),
    status: 'processing',
    claimedByBridgeId: device.id,
    payloadUrl: resolvePayloadUrl(jobId),
  };
}

function findJobPayloadPath(jobFile) {
  if (!jobFile) return null;
  const name = path.basename(String(jobFile));
  const candidates = [
    path.join(BRIDGE_PAYLOAD_DIR, name),
    path.join(PRINT_QUEUE_DIR, name),
    path.join(PRINT_QUEUE_DIR, `${name}.processing`),
    path.join(PRINTED_DIR, name),
    path.join(FAILED_DIR, name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function getBridgeJobPayload(jobId, deviceCode) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  const job = await getPrintJobById(jobId);
  if (!job) {
    const err = new Error('Print job not found.');
    err.status = 404;
    throw err;
  }
  if (!jobMatchesBridge(job, device.id)) {
    const err = new Error('Job is not assigned to this bridge device.');
    err.status = 403;
    throw err;
  }
  if (!job.jobFile) {
    const err = new Error('Print payload is not ready yet.');
    err.status = 404;
    throw err;
  }

  const filePath = findJobPayloadPath(job.jobFile);
  if (!filePath) {
    const err = new Error('Print payload file not found.');
    err.status = 404;
    throw err;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    filename: path.basename(job.jobFile),
    job,
  };
}

export async function markBridgeJobCompleted(jobId, deviceCode) {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  const job = await getPrintJobById(jobId);
  if (!job) {
    const err = new Error('Print job not found.');
    err.status = 404;
    throw err;
  }
  if (!jobMatchesBridge(job, device.id)) {
    const err = new Error('Job is not assigned to this bridge device.');
    err.status = 403;
    throw err;
  }

  await markPrintJobSent(jobId);
  await db.query(
    `UPDATE print_jobs
     SET delivered_at = NOW(),
         claimed_by_bridge_id = COALESCE(claimed_by_bridge_id, ?),
         claimed_at = COALESCE(claimed_at, NOW()),
         error_message = NULL,
         failed_at = NULL
     WHERE id = ?`,
    [device.id, jobId]
  );

  // Best-effort: move payload out of active dirs
  try {
    const filePath = findJobPayloadPath(job.jobFile);
    if (filePath && fs.existsSync(filePath)) {
      if (!fs.existsSync(PRINTED_DIR)) fs.mkdirSync(PRINTED_DIR, { recursive: true });
      const dest = path.join(PRINTED_DIR, path.basename(filePath).replace(/\.processing$/i, ''));
      fs.renameSync(filePath, dest);
    }
  } catch {
    /* ignore */
  }

  return { jobId: Number(jobId), status: PRINT_JOB_STATUS.SENT };
}

export async function markBridgeJobFailed(jobId, deviceCode, errorMessage = 'Bluetooth print failed') {
  const device = await getBridgeDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    const err = new Error('Bridge device not found or inactive.');
    err.status = 404;
    throw err;
  }

  const job = await getPrintJobById(jobId);
  if (!job) {
    const err = new Error('Print job not found.');
    err.status = 404;
    throw err;
  }
  if (!jobMatchesBridge(job, device.id)) {
    const err = new Error('Job is not assigned to this bridge device.');
    err.status = 403;
    throw err;
  }

  const message = String(errorMessage || 'Bluetooth print failed').slice(0, 2000);
  await markPrintJobFailed(jobId, message);
  await db.query(
    `UPDATE print_jobs
     SET claimed_by_bridge_id = COALESCE(claimed_by_bridge_id, ?),
         claimed_at = COALESCE(claimed_at, NOW())
     WHERE id = ?`,
    [device.id, jobId]
  );

  return { jobId: Number(jobId), status: PRINT_JOB_STATUS.FAILED, error: message };
}

export function getBridgePayloadDir() {
  ensureBridgePayloadDir();
  return BRIDGE_PAYLOAD_DIR;
}

export default {
  ensurePrintBridgeSchema,
  registerBridgeDevice,
  heartbeat,
  getActiveBridgeDevices,
  getBridgeDeviceById,
  getBridgeDeviceByCode,
  updateBridgeDevice,
  deactivateBridgeDevice,
  regenerateBridgeDeviceToken,
  authenticateBridgeDevice,
  reportConnectorPrinters,
  getPendingBridgeJobs,
  claimBridgeJob,
  getBridgeJobPayload,
  markBridgeJobCompleted,
  markBridgeJobFailed,
  isBridgeDeviceOnline,
  jobHasConnectorOwner,
  getBridgePayloadDir,
  defaultCapabilitiesForType,
  BRIDGE_ONLINE_MS,
};
