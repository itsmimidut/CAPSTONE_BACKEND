import { db } from '../config/db.js';

const DEFAULT_ESC_COMMANDS = {
  initial_commands: '1B 40',
  cutter_commands: '1D 56 00',
  drawer_commands: '1B 70 00 19 FA',
};

function resolveConnectorDeviceId(rowOrPrinter) {
  const id =
    rowOrPrinter.connector_device_id ??
    rowOrPrinter.connectorDeviceId ??
    rowOrPrinter.bridge_device_id ??
    rowOrPrinter.bridgeDeviceId ??
    null;
  return id == null || id === '' ? null : Number(id);
}

function resolveConnectionMethod(row) {
  const explicit = row.connection_method || row.connectionMethod;
  if (explicit) return String(explicit).toLowerCase();

  const iface = String(row.interface_type || row.interfaceType || 'usb').toLowerCase();
  if (iface === 'ethernet') return 'ethernet';
  if (iface === 'bluetooth') return 'android_bluetooth';
  return 'windows_printer';
}

function interfaceTypeFromConnectionMethod(method) {
  switch (String(method || '').toLowerCase()) {
    case 'ethernet':
      return 'ethernet';
    case 'android_bluetooth':
    case 'bluetooth_serial':
      return 'bluetooth';
    case 'windows_printer':
    default:
      return 'usb';
  }
}

function mapPrinterRow(row) {
  if (!row) return null;
  const connectorDeviceId = resolveConnectorDeviceId(row);
  const connectionMethod = resolveConnectionMethod(row);
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    interfaceType: row.interface_type || interfaceTypeFromConnectionMethod(connectionMethod),
    connectionMethod,
    windowsPrinterName: row.windows_printer_name,
    ipAddress: row.ip_address,
    port: row.port,
    bluetoothDeviceName: row.bluetooth_device_name,
    bluetoothDeviceId: row.bluetooth_device_id,
    bluetoothAddress: row.bluetooth_address || row.bluetooth_device_id || null,
    comPort: row.com_port || null,
    baudRate: row.baud_rate != null ? Number(row.baud_rate) : 9600,
    bridgeDeviceId: row.bridge_device_id ?? connectorDeviceId,
    connectorDeviceId,
    connectorDeviceName: row.bridge_device_name || row.connector_device_name || null,
    bridgeDeviceName: row.bridge_device_name || row.connector_device_name || null,
    bridgeStatus: resolveBridgeLiveStatus({ ...row, bridge_device_id: connectorDeviceId }),
    bridgeLastSeenAt: row.bridge_last_seen_at || null,
    paperWidth: row.paper_width,
    printMode: row.print_mode,
    printResolution: row.print_resolution,
    initialCommands: row.initial_commands,
    cutterCommands: row.cutter_commands,
    drawerCommands: row.drawer_commands,
    printReceipts: Boolean(row.print_receipts),
    printOrders: Boolean(row.print_orders),
    autoPrintReceipt: Boolean(row.auto_print_receipt),
    singleItemPerOrderTicket: Boolean(row.single_item_per_order_ticket),
    groupIdenticalItems: Boolean(row.group_identical_items),
    usageType: row.usage_type,
    stationId: row.station_id,
    stationName: row.station_name || null,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    lastTestAt: row.last_test_at,
    lastTestStatus: row.last_test_status || 'unknown',
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connectionLabel: buildConnectionLabel({
      ...row,
      connection_method: connectionMethod,
      bridge_device_id: connectorDeviceId,
    }),
  };
}

function buildConnectionLabel(row) {
  const method = resolveConnectionMethod(row);
  const connector = row.bridge_device_name || row.connector_device_name;
  const connectorSuffix = connector ? ` • Connector: ${connector}` : '';

  if (method === 'ethernet') {
    return `Ethernet • ${row.ip_address || '—'}:${row.port || 9100}`;
  }
  if (method === 'bluetooth_serial') {
    return `Bluetooth Serial • ${row.com_port || 'COM?'}${row.baud_rate ? ` @ ${row.baud_rate}` : ''}${connectorSuffix}`;
  }
  if (method === 'android_bluetooth') {
    return `Android Bluetooth • ${row.bluetooth_device_name || 'Not paired'}${connectorSuffix}`;
  }
  // windows_printer
  return `Windows Printer • ${row.windows_printer_name || '—'}${connectorSuffix}`;
}

function resolveBridgeLiveStatus(row) {
  const connectorId = resolveConnectorDeviceId(row);
  if (!connectorId) return null;
  if (!row.bridge_last_seen_at) return row.bridge_status || 'unknown';
  const age = Date.now() - new Date(row.bridge_last_seen_at).getTime();
  if (Number.isFinite(age) && age <= 60000) return 'online';
  return 'offline';
}

function validatePrinterPayload(data, { partial = false } = {}) {
  const connectionMethod = resolveConnectionMethod({
    connection_method: data.connectionMethod ?? data.connection_method,
    interface_type: data.interfaceType ?? data.interface_type,
  });

  if (!partial || data.connectionMethod !== undefined || data.connection_method !== undefined || data.interfaceType !== undefined) {
    if (!['ethernet', 'windows_printer', 'bluetooth_serial', 'android_bluetooth'].includes(connectionMethod)) {
      throw new Error('Invalid connection method.');
    }

    if (connectionMethod === 'ethernet') {
      const ip = data.ipAddress ?? data.ip_address;
      if (!partial && !String(ip || '').trim()) {
        throw new Error('IP address is required for Ethernet printers.');
      }
      const port = Number(data.port ?? 9100);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error('Ethernet printer port must be between 1 and 65535.');
      }
    }

    if (connectionMethod === 'windows_printer') {
      const windowsName = data.windowsPrinterName ?? data.windows_printer_name;
      if (!partial && !String(windowsName || '').trim()) {
        throw new Error('Windows printer name is required.');
      }
    }

    if (connectionMethod === 'bluetooth_serial') {
      const comPort = data.comPort ?? data.com_port;
      if (!partial && !String(comPort || '').trim()) {
        throw new Error('COM port is required for Bluetooth Serial printers.');
      }
      const connectorId = resolveConnectorDeviceId(data);
      if (!partial && !connectorId) {
        throw new Error('Print Connector is required for Bluetooth Serial / COM.');
      }
    }

    if (connectionMethod === 'android_bluetooth') {
      const name = data.bluetoothDeviceName ?? data.bluetooth_device_name;
      if (!partial && !String(name || '').trim()) {
        throw new Error('Bluetooth printer name is required.');
      }
      const connectorId = resolveConnectorDeviceId(data);
      if (!partial && !connectorId) {
        throw new Error('Print Connector is required for Android Bluetooth.');
      }
    }
  }

  if (!partial && !String(data.name || '').trim()) {
    throw new Error('Printer name is required.');
  }
}

function toDbPayload(data = {}) {
  const connectionMethod = resolveConnectionMethod(data);
  const interfaceType = interfaceTypeFromConnectionMethod(connectionMethod);
  const connectorId = resolveConnectorDeviceId(data);

  return {
    name: data.name,
    model: data.model ?? null,
    interface_type: interfaceType,
    connection_method: connectionMethod,
    windows_printer_name: data.windowsPrinterName ?? data.windows_printer_name ?? null,
    ip_address: data.ipAddress ?? data.ip_address ?? null,
    port: Number(data.port ?? 9100) || 9100,
    bluetooth_device_name: data.bluetoothDeviceName ?? data.bluetooth_device_name ?? null,
    bluetooth_device_id: data.bluetoothDeviceId ?? data.bluetooth_device_id ?? data.bluetoothAddress ?? data.bluetooth_address ?? null,
    bluetooth_address: data.bluetoothAddress ?? data.bluetooth_address ?? data.bluetoothDeviceId ?? data.bluetooth_device_id ?? null,
    bridge_device_id: connectorId,
    connector_device_id: connectorId,
    com_port: data.comPort ?? data.com_port ?? null,
    baud_rate: Number(data.baudRate ?? data.baud_rate ?? 9600) || 9600,
    paper_width: data.paperWidth ?? data.paper_width ?? '58',
    print_mode: data.printMode ?? data.print_mode ?? 'escpos',
    print_resolution: data.printResolution ?? data.print_resolution ?? '203dpi',
    initial_commands: data.initialCommands ?? data.initial_commands ?? DEFAULT_ESC_COMMANDS.initial_commands,
    cutter_commands: data.cutterCommands ?? data.cutter_commands ?? DEFAULT_ESC_COMMANDS.cutter_commands,
    drawer_commands: data.drawerCommands ?? data.drawer_commands ?? DEFAULT_ESC_COMMANDS.drawer_commands,
    print_receipts: (data.printReceipts ?? data.print_receipts ?? true) ? 1 : 0,
    print_orders: (data.printOrders ?? data.print_orders ?? true) ? 1 : 0,
    auto_print_receipt: (data.autoPrintReceipt ?? data.auto_print_receipt ?? true) ? 1 : 0,
    single_item_per_order_ticket: (data.singleItemPerOrderTicket ?? data.single_item_per_order_ticket ?? false) ? 1 : 0,
    group_identical_items: (data.groupIdenticalItems ?? data.group_identical_items ?? true) ? 1 : 0,
    usage_type: data.usageType ?? data.usage_type ?? 'receipt',
    station_id: data.stationId ?? data.station_id ?? null,
    is_default: (data.isDefault ?? data.is_default ?? false) ? 1 : 0,
    is_active: (data.isActive ?? data.is_active ?? true) ? 1 : 0,
  };
}

/**
 * Build a normalized, non-persisted printer object for setup-wizard test
 * prints. It follows the exact same validation/mapping path as createPrinter,
 * but does not insert a pos_printers row.
 */
export function buildTransientPrinter(data = {}) {
  validatePrinterPayload(data);
  const payload = toDbPayload(data);
  return mapPrinterRow({
    id: null,
    ...payload,
    station_name: null,
    bridge_device_name: null,
    bridge_status: null,
    bridge_last_seen_at: null,
    last_test_at: null,
    last_test_status: 'unknown',
    last_error: null,
    created_at: null,
    updated_at: null,
  });
}

export async function ensurePosPrinterSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_printers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      model VARCHAR(100) DEFAULT NULL,
      interface_type ENUM('usb', 'ethernet', 'bluetooth') NOT NULL DEFAULT 'usb',
      windows_printer_name VARCHAR(150) DEFAULT NULL,
      ip_address VARCHAR(100) DEFAULT NULL,
      port INT DEFAULT 9100,
      bluetooth_device_name VARCHAR(150) DEFAULT NULL,
      bluetooth_device_id VARCHAR(150) DEFAULT NULL,
      paper_width ENUM('58', '72', '80') DEFAULT '58',
      print_mode ENUM('escpos', 'graphic') DEFAULT 'escpos',
      print_resolution VARCHAR(50) DEFAULT '203dpi',
      initial_commands TEXT DEFAULT NULL,
      cutter_commands TEXT DEFAULT NULL,
      drawer_commands TEXT DEFAULT NULL,
      print_receipts TINYINT DEFAULT 1,
      print_orders TINYINT DEFAULT 1,
      auto_print_receipt TINYINT DEFAULT 1,
      single_item_per_order_ticket TINYINT DEFAULT 0,
      group_identical_items TINYINT DEFAULT 1,
      usage_type ENUM('receipt', 'kitchen', 'bar', 'general') DEFAULT 'receipt',
      station_id INT DEFAULT NULL,
      is_default TINYINT DEFAULT 0,
      is_active TINYINT DEFAULT 1,
      last_test_at DATETIME DEFAULT NULL,
      last_test_status ENUM('success', 'failed', 'unknown') DEFAULT 'unknown',
      last_error TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await seedDefaultPrinterFromEnv();
  await ensurePrinterBridgeColumns();
}

async function ensurePrinterBridgeColumns() {
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

export async function seedDefaultPrinterFromEnv() {
  const [rows] = await db.query(
    'SELECT id FROM pos_printers WHERE is_active = 1 LIMIT 1'
  );
  if (rows.length) return;

  const printerName = process.env.PRINTER_NAME || 'POS-582';
  await db.query(
    `INSERT INTO pos_printers (
      name, model, interface_type, windows_printer_name, paper_width,
      print_receipts, print_orders, auto_print_receipt, usage_type, is_default, is_active
    ) VALUES (?, ?, 'usb', ?, '58', 1, 1, 1, 'receipt', 1, 1)`,
    ['Default Receipt Printer', printerName, printerName]
  );
}

export async function getPrinters({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE p.is_active = 1';
  const [rows] = await db.query(
    `SELECT p.*, ps.station_name,
            bd.device_name AS bridge_device_name,
            bd.status AS bridge_status,
            bd.last_seen_at AS bridge_last_seen_at
     FROM pos_printers p
     LEFT JOIN pos_stations ps ON ps.id = p.station_id
     LEFT JOIN print_bridge_devices bd
       ON bd.id = COALESCE(p.connector_device_id, p.bridge_device_id)
     ${where}
     ORDER BY p.is_default DESC, p.name ASC`
  );
  return rows.map(mapPrinterRow);
}

export async function getPrinterById(id) {
  const [rows] = await db.query(
    `SELECT p.*, ps.station_name,
            bd.device_name AS bridge_device_name,
            bd.status AS bridge_status,
            bd.last_seen_at AS bridge_last_seen_at
     FROM pos_printers p
     LEFT JOIN pos_stations ps ON ps.id = p.station_id
     LEFT JOIN print_bridge_devices bd
       ON bd.id = COALESCE(p.connector_device_id, p.bridge_device_id)
     WHERE p.id = ?
     LIMIT 1`,
    [id]
  );
  return mapPrinterRow(rows[0]);
}

export async function getDefaultPrinter() {
  const [rows] = await db.query(
    `SELECT * FROM pos_printers
     WHERE is_active = 1 AND is_default = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  if (rows[0]) return mapPrinterRow(rows[0]);

  const [fallbackRows] = await db.query(
    `SELECT * FROM pos_printers
     WHERE is_active = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  return mapPrinterRow(fallbackRows[0]);
}

export async function createPrinter(data) {
  validatePrinterPayload(data);
  const payload = toDbPayload(data);

  const [result] = await db.query(
    `INSERT INTO pos_printers (
      name, model, interface_type, windows_printer_name, ip_address, port,
      bluetooth_device_name, bluetooth_device_id, bluetooth_address, bridge_device_id,
      connector_device_id, connection_method, com_port, baud_rate,
      paper_width, print_mode, print_resolution,
      initial_commands, cutter_commands, drawer_commands,
      print_receipts, print_orders, auto_print_receipt, single_item_per_order_ticket,
      group_identical_items, usage_type, station_id, is_default, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.name,
      payload.model,
      payload.interface_type,
      payload.windows_printer_name,
      payload.ip_address,
      payload.port,
      payload.bluetooth_device_name,
      payload.bluetooth_device_id,
      payload.bluetooth_address,
      payload.bridge_device_id,
      payload.connector_device_id,
      payload.connection_method,
      payload.com_port,
      payload.baud_rate,
      payload.paper_width,
      payload.print_mode,
      payload.print_resolution,
      payload.initial_commands,
      payload.cutter_commands,
      payload.drawer_commands,
      payload.print_receipts,
      payload.print_orders,
      payload.auto_print_receipt,
      payload.single_item_per_order_ticket,
      payload.group_identical_items,
      payload.usage_type,
      payload.station_id,
      payload.is_default,
      payload.is_active,
    ]
  );

  if (payload.is_default) {
    await setDefaultPrinter(result.insertId);
  }

  return getPrinterById(result.insertId);
}

export async function updatePrinter(id, data) {
  const existing = await getPrinterById(id);
  if (!existing || !existing.isActive) {
    throw new Error('Printer not found.');
  }

  validatePrinterPayload({ ...existing, ...data }, { partial: true });
  const payload = toDbPayload({ ...existing, ...data });

  await db.query(
    `UPDATE pos_printers SET
      name = ?, model = ?, interface_type = ?, windows_printer_name = ?, ip_address = ?, port = ?,
      bluetooth_device_name = ?, bluetooth_device_id = ?, bluetooth_address = ?, bridge_device_id = ?,
      connector_device_id = ?, connection_method = ?, com_port = ?, baud_rate = ?,
      paper_width = ?, print_mode = ?, print_resolution = ?,
      initial_commands = ?, cutter_commands = ?, drawer_commands = ?,
      print_receipts = ?, print_orders = ?, auto_print_receipt = ?, single_item_per_order_ticket = ?,
      group_identical_items = ?, usage_type = ?, station_id = ?, is_default = ?, is_active = ?
     WHERE id = ?`,
    [
      payload.name,
      payload.model,
      payload.interface_type,
      payload.windows_printer_name,
      payload.ip_address,
      payload.port,
      payload.bluetooth_device_name,
      payload.bluetooth_device_id,
      payload.bluetooth_address,
      payload.bridge_device_id,
      payload.connector_device_id,
      payload.connection_method,
      payload.com_port,
      payload.baud_rate,
      payload.paper_width,
      payload.print_mode,
      payload.print_resolution,
      payload.initial_commands,
      payload.cutter_commands,
      payload.drawer_commands,
      payload.print_receipts,
      payload.print_orders,
      payload.auto_print_receipt,
      payload.single_item_per_order_ticket,
      payload.group_identical_items,
      payload.usage_type,
      payload.station_id,
      payload.is_default,
      payload.is_active,
      id,
    ]
  );

  if (payload.is_default) {
    await setDefaultPrinter(id);
  }

  return getPrinterById(id);
}

export async function deletePrinter(id) {
  const existing = await getPrinterById(id);
  if (!existing) throw new Error('Printer not found.');

  await db.query('UPDATE pos_printers SET is_active = 0, is_default = 0 WHERE id = ?', [id]);

  const [defaults] = await db.query(
    'SELECT id FROM pos_printers WHERE is_active = 1 AND is_default = 1 LIMIT 1'
  );
  if (!defaults.length) {
    const [nextRows] = await db.query(
      'SELECT id FROM pos_printers WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
    );
    if (nextRows[0]) {
      await setDefaultPrinter(nextRows[0].id);
    }
  }

  return { success: true };
}

export async function setDefaultPrinter(id) {
  const printer = await getPrinterById(id);
  if (!printer || !printer.isActive) throw new Error('Printer not found.');

  await db.query('UPDATE pos_printers SET is_default = 0 WHERE is_active = 1');
  await db.query('UPDATE pos_printers SET is_default = 1 WHERE id = ?', [id]);
  return getPrinterById(id);
}

export async function updatePrinterTestStatus(id, status, error = null) {
  await db.query(
    `UPDATE pos_printers
     SET last_test_at = NOW(), last_test_status = ?, last_error = ?
     WHERE id = ?`,
    [status, error, id]
  );
  return getPrinterById(id);
}

export async function resolvePrinterConfig(printerId = null) {
  const printer = printerId ? await getPrinterById(printerId) : await getDefaultPrinter();
  if (!printer || !printer.isActive) return null;

  return {
    ...printer,
    envPrinterName: process.env.PRINTER_NAME || printer.windowsPrinterName || 'POS-582',
  };
}

/**
 * Snapshot printer settings onto a print job so later edits do not change queued jobs.
 */
export function buildPrinterJobSnapshot(printer) {
  if (!printer) return null;

  const connectionMethod = resolveConnectionMethod(printer);
  const interfaceType =
    printer.interfaceType ||
    printer.interface_type ||
    interfaceTypeFromConnectionMethod(connectionMethod);
  const windowsPrinterName = printer.windowsPrinterName || printer.windows_printer_name || null;
  const fallbackName = process.env.PRINTER_NAME || 'POS-582';
  const connectorDeviceId = resolveConnectorDeviceId(printer);

  let printerName = windowsPrinterName || fallbackName;
  if (connectionMethod === 'bluetooth_serial') {
    printerName = printer.comPort || printer.com_port || printer.name || fallbackName;
  } else if (connectionMethod === 'android_bluetooth') {
    printerName = printer.bluetoothDeviceName || printer.name || fallbackName;
  } else if (connectionMethod === 'ethernet') {
    printerName = `${printer.ipAddress || printer.ip_address || 'ethernet'}:${printer.port || 9100}`;
  } else if (interfaceType !== 'usb' && !windowsPrinterName) {
    printerName = printer.name || fallbackName;
  }

  return {
    printerId: printer.id,
    printerName,
    printerInterface: interfaceType,
    printerConfig: {
      paper_width: printer.paperWidth || printer.paper_width || '58',
      usage_type: printer.usageType || printer.usage_type || 'receipt',
      connection_method: connectionMethod,
      connector_device_id: connectorDeviceId,
      bridge_device_id: connectorDeviceId,
      ip_address: printer.ipAddress || printer.ip_address || null,
      port: printer.port || 9100,
      windows_printer_name: windowsPrinterName,
      com_port: printer.comPort || printer.com_port || null,
      baud_rate: printer.baudRate ?? printer.baud_rate ?? 9600,
      model: printer.model || null,
      name: printer.name,
      bluetooth_device_name: printer.bluetoothDeviceName || printer.bluetooth_device_name || null,
      bluetooth_device_id: printer.bluetoothDeviceId || printer.bluetooth_device_id || null,
      bluetooth_address:
        printer.bluetoothAddress ||
        printer.bluetooth_address ||
        printer.bluetoothDeviceId ||
        printer.bluetooth_device_id ||
        null,
    },
  };
}

export async function evaluateAutoPrintEligibility(stationId = null) {
  const {
    resolvePrinterForJob,
    isPrinterInterfaceSupported,
    getPrinterRoutingWarning,
  } = await import('./posPrinterRoutingService.js');

  const routed = await resolvePrinterForJob({ stationId, usageType: 'receipt' });
  const printer = routed.printer;

  if (!printer) {
    return {
      allowed: false,
      code: 'NO_PRINTER_CONFIGURED',
      message: 'Payment successful, but no matching printer is configured. Go to Settings > Printers to configure one.',
      routingSource: routed.routingSource,
    };
  }

  if (!printer.autoPrintReceipt) {
    return {
      allowed: false,
      code: 'AUTO_PRINT_DISABLED',
      message: 'Auto-print is disabled for the matched receipt printer.',
      printer,
      routingSource: routed.routingSource,
    };
  }

  if (!isPrinterInterfaceSupported(printer)) {
    const warning = getPrinterRoutingWarning(printer, 'receipt');
    const code = ['android_bluetooth', 'bluetooth_serial'].includes(printer.connectionMethod)
      || (printer.interfaceType || printer.interface_type) === 'bluetooth'
      ? 'NO_PRINT_CONNECTOR'
      : 'PRINTER_NOT_SUPPORTED';
    return {
      allowed: false,
      code,
      message: warning,
      printer,
      routingSource: routed.routingSource,
    };
  }

  const warning = getPrinterRoutingWarning(printer, 'receipt');
  return {
    allowed: true,
    printer,
    routingSource: routed.routingSource,
    warning: warning || null,
  };
}
