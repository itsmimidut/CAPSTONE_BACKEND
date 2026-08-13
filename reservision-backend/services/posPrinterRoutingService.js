import { db } from '../config/db.js';
import { getDefaultPrinter } from './posPrinterSettingsService.js';

function mapPrinterRow(row) {
  if (!row) return null;
  const connectorDeviceId =
    row.connector_device_id ?? row.bridge_device_id ?? null;
  const connectionMethod =
    row.connection_method ||
    (row.interface_type === 'ethernet'
      ? 'ethernet'
      : row.interface_type === 'bluetooth'
        ? 'android_bluetooth'
        : 'windows_printer');
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    interfaceType: row.interface_type,
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
    bridgeDeviceName: row.bridge_device_name || null,
    connectorDeviceName: row.bridge_device_name || null,
    bridgeStatus: row.bridge_status || null,
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
  };
}

async function findActivePrinter({ stationId = null, usageType }) {
  const normalizedUsage = String(usageType || 'receipt').toLowerCase();
  const station = stationId ? Number(stationId) : null;

  const selectSql = `SELECT p.*, ps.station_name,
            bd.device_name AS bridge_device_name,
            bd.status AS bridge_status,
            bd.last_seen_at AS bridge_last_seen_at
     FROM pos_printers p
     LEFT JOIN pos_stations ps ON ps.id = p.station_id
     LEFT JOIN print_bridge_devices bd
       ON bd.id = COALESCE(p.connector_device_id, p.bridge_device_id)`;

  if (station) {
    const [stationRows] = await db.query(
      `${selectSql}
       WHERE p.is_active = 1
         AND p.usage_type = ?
         AND p.station_id = ?
       ORDER BY p.is_default DESC, p.id ASC
       LIMIT 1`,
      [normalizedUsage, station]
    );
    if (stationRows[0]) {
      return { printer: mapPrinterRow(stationRows[0]), routingSource: 'station' };
    }
  }

  const [globalRows] = await db.query(
    `${selectSql}
     WHERE p.is_active = 1
       AND p.usage_type = ?
       AND p.station_id IS NULL
     ORDER BY p.is_default DESC, p.id ASC
     LIMIT 1`,
    [normalizedUsage]
  );
  if (globalRows[0]) {
    return { printer: mapPrinterRow(globalRows[0]), routingSource: 'global' };
  }

  return { printer: null, routingSource: null };
}

export async function resolvePrinterForJob({
  stationId = null,
  usageType = 'receipt',
  transactionType = null,
}) {
  const normalizedUsage = String(usageType || 'receipt').toLowerCase();
  const match = await findActivePrinter({ stationId, usageType: normalizedUsage });
  if (match.printer) {
    return {
      printer: match.printer,
      routingSource: match.routingSource,
      usageType: normalizedUsage,
      transactionType: transactionType || null,
    };
  }

  const defaultPrinter = await getDefaultPrinter();
  if (defaultPrinter) {
    return {
      printer: defaultPrinter,
      routingSource: 'default',
      usageType: normalizedUsage,
      transactionType: transactionType || null,
    };
  }

  return {
    printer: null,
    routingSource: 'none',
    usageType: normalizedUsage,
    transactionType: transactionType || null,
  };
}

export async function getPrinterForReceipt(stationId = null) {
  const result = await resolvePrinterForJob({ stationId, usageType: 'receipt' });
  return result.printer;
}

export async function getPrinterForKitchenOrder(stationId = null) {
  const kitchen = await resolvePrinterForJob({ stationId, usageType: 'kitchen' });
  if (kitchen.printer) return kitchen.printer;

  const bar = await resolvePrinterForJob({ stationId, usageType: 'bar' });
  return bar.printer;
}

export async function getPrinterForBarOrder(stationId = null) {
  const result = await resolvePrinterForJob({ stationId, usageType: 'bar' });
  return result.printer;
}

export function isPrinterInterfaceSupported(printer) {
  if (!printer) return false;
  const method = printer.connectionMethod || printer.connection_method;
  const type = printer.interfaceType || printer.interface_type;
  const connectorId =
    printer.connectorDeviceId ??
    printer.connector_device_id ??
    printer.bridgeDeviceId ??
    printer.bridge_device_id;

  if (method === 'ethernet' || type === 'ethernet') return true;
  if (method === 'windows_printer' || type === 'usb' || !type) {
    // Backend daemon can print when no remote connector is assigned.
    return true;
  }
  if (method === 'bluetooth_serial') {
    // Requires a Windows Print Connector (Phase 10B.2 will print).
    return Boolean(connectorId);
  }
  if (method === 'android_bluetooth' || type === 'bluetooth') {
    return Boolean(connectorId);
  }
  return false;
}

export function getPrinterRoutingWarning(printer, usageType = 'receipt') {
  if (!printer) {
    return 'Payment successful, but no matching printer is configured. Go to Settings > Printers to configure one.';
  }
  const method = printer.connectionMethod || printer.connection_method;
  const type = printer.interfaceType || printer.interface_type;
  const connectorId =
    printer.connectorDeviceId ??
    printer.connector_device_id ??
    printer.bridgeDeviceId ??
    printer.bridge_device_id;

  if (method === 'android_bluetooth' || type === 'bluetooth') {
    if (!connectorId) {
      return 'No Print Connector assigned. Assign a connector in Settings > Printers.';
    }
  }
  if (method === 'bluetooth_serial' && !connectorId) {
    return 'Bluetooth Serial / COM requires a Windows Print Connector.';
  }

  if (connectorId) {
    const lastSeen = printer.bridgeLastSeenAt || printer.bridge_last_seen_at;
    const liveStatus = printer.bridgeStatus || printer.bridge_status;
    let online = liveStatus === 'online';
    if (lastSeen) {
      const age = Date.now() - new Date(lastSeen).getTime();
      online = Number.isFinite(age) && age <= 60000;
    }
    if (!online) {
      return 'Payment successful. Print job queued, but the Print Connector appears offline.';
    }
  }

  if (method === 'ethernet' || type === 'ethernet') {
    const ip = printer.ipAddress || printer.ip_address;
    if (!ip) {
      return 'Payment successful, but Ethernet printer IP address is missing.';
    }
  }
  if (usageType === 'receipt' && !printer.autoPrintReceipt && !printer.printReceipts) {
    return 'Auto-print is disabled for the matched receipt printer.';
  }
  if (usageType !== 'receipt' && !printer.printOrders) {
    return 'Order printing is disabled for the matched printer.';
  }
  return null;
}
