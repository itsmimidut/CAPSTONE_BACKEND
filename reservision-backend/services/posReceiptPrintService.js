import { db } from '../config/db.js';
import { POS_PAYMENT_STATUS, POS_TRANSACTION_STATUS } from '../utils/paymentStatuses.js';
import {
    fetchXenditInvoice,
    syncPosTransactionByReceipt,
} from './posXenditSyncService.js';
import {
    printBookingReceipt,
    printKitchenOrder,
    printRegularReceipt,
    printTestReceipt,
} from './printerService.js';
import {
    evaluateAutoPrintEligibility,
    getPrinterById,
    resolvePrinterConfig,
    buildPrinterJobSnapshot,
    buildTransientPrinter,
    updatePrinterTestStatus,
} from './posPrinterSettingsService.js';
import {
    getPrinterForKitchenOrder,
    getPrinterForBarOrder,
    getPrinterRoutingWarning,
    isPrinterInterfaceSupported,
    resolvePrinterForJob,
} from './posPrinterRoutingService.js';
import { getStationById } from './posStationService.js';
import { getReceiptSettings } from './receiptSettingsService.js';
import {
    createPrintJob,
    getPrintJobById,
    markPrintJobFailed,
    markPrintJobQueued,
    markPrintJobSent,
    PRINT_JOB_STATUS,
} from './printJobService.js';

export class PosReceiptPrintError extends Error {
    constructor(message, statusCode = 400, code = 'PRINT_REJECTED') {
        super(message);
        this.name = 'PosReceiptPrintError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

const isGcashPayment = (method) => String(method || '').trim().toLowerCase() === 'gcash';

const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const normalizeReceiptNo = (input) => {
    let raw = String(input || '').trim();
    if (raw.toUpperCase().startsWith('POS-')) {
        raw = raw.slice(4);
    }
    return raw;
};

export const formatDisplayReceiptNo = (receiptNo) => {
    const raw = String(receiptNo || '').trim();
    if (!raw) return '';
    if (raw.toUpperCase().startsWith('ESHOP-')) return raw;
    if (/^\d+$/.test(raw)) return `POS-${raw}`;
    return raw;
};

async function loadTransactionByReceipt(receiptNo) {
    const normalized = normalizeReceiptNo(receiptNo);
    if (!normalized) {
        throw new PosReceiptPrintError('Receipt number is required', 400, 'MISSING_RECEIPT');
    }

    const [rows] = await db.query(
        `SELECT pt.*,
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS cashier_name
         FROM pos_transactions pt
         LEFT JOIN user u ON pt.user_id = u.user_id
         WHERE pt.receipt_no = ?
         LIMIT 1`,
        [normalized]
    );

    if (!rows.length) {
        throw new PosReceiptPrintError('Transaction not found', 404, 'NOT_FOUND');
    }

    return rows[0];
}

async function loadLineItems(transaction) {
    const transactionId = transaction.id;

    try {
        const [tableRows] = await db.query(
            `SELECT COUNT(*) AS total
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_transaction_items'`
        );

        if (Number(tableRows[0]?.total || 0) > 0) {
            const [rows] = await db.query(
                `SELECT item_name, quantity, unit_price, line_total, booking_reference
                 FROM pos_transaction_items
                 WHERE transaction_id = ?
                 ORDER BY id ASC`,
                [transactionId]
            );

            if (rows.length > 0) {
                const jsonItems = parseJsonArray(transaction.items);
                return rows.map((row, index) => {
                    const jsonItem = jsonItems[index] || jsonItems.find(
                        (item) => String(item?.bookingReference || '') === String(row.booking_reference || '')
                    ) || {};

                    return {
                        name: row.item_name,
                        quantity: Number(row.quantity || 1),
                        price: Number(row.unit_price || 0),
                        total: Number(row.line_total || 0),
                        bookingReference: row.booking_reference || null,
                        customization: jsonItem.customization ?? null,
                        category: jsonItem.category ?? jsonItem.category_type ?? (row.booking_reference ? 'booking' : 'restaurant'),
                        menuId: jsonItem.menu_id ?? jsonItem.menuId ?? null,
                    };
                });
            }
        }
    } catch {
        /* fall through to JSON items */
    }

    return parseJsonArray(transaction.items).map((item) => {
        const qty = Number(item.quantity ?? item.qty ?? 1);
        const lineTotal = Number(item.price ?? 0);
        const unitPrice = Number(item.unitPrice ?? (qty > 0 ? lineTotal / qty : lineTotal));

        return {
            name: item.name,
            quantity: qty,
            price: unitPrice,
            total: lineTotal,
            bookingReference: item.bookingReference ?? null,
            customization: item.customization ?? null,
            category: item.category ?? item.category_type ?? (item.bookingReference ? 'booking' : 'restaurant'),
            menuId: item.menu_id ?? item.menuId ?? null,
        };
    });
}

async function loadBookingFromDb(bookingReference) {
    const ref = String(bookingReference || '').trim();
    if (!ref) return null;

    try {
        const [rows] = await db.query(
            `SELECT *
             FROM bookings
             WHERE booking_reference = ?
             LIMIT 1`,
            [ref]
        );
        return rows[0] || null;
    } catch {
        return null;
    }
}

function findBookingDetailEntry(bookingDetails, bookingReference) {
    const ref = String(bookingReference || '').trim();
    return bookingDetails.find(
        (entry) => String(entry?.bookingReference || entry?.booking_reference || '').trim() === ref
    );
}

async function resolveTrustedPaymentUrl(transaction) {
    const paymentStatus = String(transaction.payment_status || '').toUpperCase();
    if (!isGcashPayment(transaction.payment_method)) {
        return null;
    }

    if (paymentStatus === POS_PAYMENT_STATUS.PAID) {
        return null;
    }

    if (paymentStatus !== POS_PAYMENT_STATUS.PENDING) {
        return null;
    }

    let paymentUrl = String(transaction.payment_url || '').trim();

    if (!paymentUrl && transaction.xendit_invoice_id) {
        try {
            await syncPosTransactionByReceipt(transaction.receipt_no);
            const [rows] = await db.query(
                `SELECT payment_url, payment_status, xendit_invoice_id
                 FROM pos_transactions
                 WHERE id = ?
                 LIMIT 1`,
                [transaction.id]
            );
            const refreshed = rows[0];
            if (refreshed) {
                paymentUrl = String(refreshed.payment_url || '').trim();
                transaction.payment_status = refreshed.payment_status;
                transaction.payment_url = refreshed.payment_url;
            }

            if (!paymentUrl && transaction.xendit_invoice_id) {
                const invoice = await fetchXenditInvoice(transaction.xendit_invoice_id);
                const invoiceStatus = String(invoice?.status || '').toUpperCase();
                if (invoice?.invoice_url && ['PENDING', 'ACTIVE'].includes(invoiceStatus)) {
                    paymentUrl = String(invoice.invoice_url).trim();
                }
            }
        } catch {
            /* ignore sync failures; QR omitted if URL unavailable */
        }
    }

    return paymentUrl || null;
}

function validatePrintableTransaction(transaction) {
    const txStatus = String(transaction.status || POS_TRANSACTION_STATUS.ACTIVE).toUpperCase();
    if (txStatus === POS_TRANSACTION_STATUS.VOIDED) {
        throw new PosReceiptPrintError('Cannot print a voided transaction.', 409, 'VOIDED');
    }

    const paymentStatus = String(transaction.payment_status || POS_PAYMENT_STATUS.PAID).toUpperCase();
    if (isGcashPayment(transaction.payment_method)) {
        if ([POS_PAYMENT_STATUS.FAILED, POS_PAYMENT_STATUS.EXPIRED].includes(paymentStatus)) {
            throw new PosReceiptPrintError(
                'Cannot print receipt for failed or expired GCash payment.',
                409,
                'PAYMENT_NOT_PRINTABLE'
            );
        }
    }
}

function buildPaymentContext(transaction) {
    const paymentStatus = String(transaction.payment_status || POS_PAYMENT_STATUS.PAID).toUpperCase();
    const paymentPending = isGcashPayment(transaction.payment_method)
        && paymentStatus === POS_PAYMENT_STATUS.PENDING;

    return {
        paymentMethod: transaction.payment_method,
        paymentStatus,
        paymentPending,
        paidAmount: Number(transaction.cash_received ?? transaction.total_amount ?? 0),
        changeAmount: Number(transaction.change_amount ?? 0),
    };
}

export async function buildRegularReceiptData(transaction) {
    validatePrintableTransaction(transaction);

    const paymentContext = buildPaymentContext(transaction);
    const paymentUrl = paymentContext.paymentPending
        ? await resolveTrustedPaymentUrl(transaction)
        : null;

    const items = await loadLineItems(transaction);

    return {
        receiptNo: formatDisplayReceiptNo(transaction.receipt_no),
        serviceOrderNumber: transaction.service_order_number ?? null,
        orderType: transaction.order_type ?? null,
        locationNumber: transaction.location_number ?? null,
        date: transaction.transaction_date,
        time: transaction.transaction_time,
        items,
        total: Number(transaction.total_amount || 0),
        paidAmount: paymentContext.paidAmount,
        changeAmount: paymentContext.changeAmount,
        paymentMethod: paymentContext.paymentMethod,
        paymentStatus: paymentContext.paymentStatus,
        paymentPending: paymentContext.paymentPending,
        paymentUrl,
        cashier: transaction.cashier_name || null,
    };
}

export async function buildBookingReceiptData(transaction, bookingReference) {
    validatePrintableTransaction(transaction);

    const ref = String(bookingReference || '').trim();
    if (!ref) {
        throw new PosReceiptPrintError(
            'bookingReference is required for booking receipts',
            400,
            'MISSING_BOOKING_REFERENCE'
        );
    }

    const bookingDetails = parseJsonArray(transaction.booking_details);
    const detailEntry = findBookingDetailEntry(bookingDetails, ref);
    const dbBooking = await loadBookingFromDb(ref);
    const lineItems = await loadLineItems(transaction);
    const lineItem = lineItems.find((item) => String(item.bookingReference || '') === ref);

    if (!detailEntry && !dbBooking && !lineItem) {
        throw new PosReceiptPrintError(
            'Booking reference not found for this transaction',
            404,
            'BOOKING_NOT_FOUND'
        );
    }

    const paymentContext = buildPaymentContext(transaction);
    const paymentUrl = paymentContext.paymentPending
        ? await resolveTrustedPaymentUrl(transaction)
        : null;

    const lineTotal = Number(lineItem?.total ?? transaction.total_amount ?? 0);
    const guestFirst = dbBooking?.first_name ?? detailEntry?.firstName ?? '';
    const guestLast = dbBooking?.last_name ?? detailEntry?.lastName ?? '';
    const nights = Number(dbBooking?.nights ?? detailEntry?.nights ?? 0);

    return {
        receiptNo: formatDisplayReceiptNo(transaction.receipt_no),
        serviceOrderNumber: transaction.service_order_number ?? null,
        orderType: transaction.order_type ?? null,
        locationNumber: transaction.location_number ?? null,
        date: transaction.transaction_date,
        time: transaction.transaction_time,
        guestName: `${guestFirst} ${guestLast}`.trim() || 'N/A',
        phone: dbBooking?.phone ?? detailEntry?.phone ?? 'N/A',
        email: dbBooking?.email ?? detailEntry?.email ?? 'N/A',
        roomName: detailEntry?.roomName ?? detailEntry?.name ?? 'N/A',
        checkInDate: dbBooking?.check_in_date ?? detailEntry?.checkInDate ?? detailEntry?.checkIn ?? 'N/A',
        checkOutDate: dbBooking?.check_out_date ?? detailEntry?.checkOutDate ?? detailEntry?.checkOut ?? 'N/A',
        nights,
        adults: Number(dbBooking?.adults ?? detailEntry?.adults ?? 0),
        children: Number(dbBooking?.children ?? detailEntry?.children ?? 0),
        seniors: Number(detailEntry?.seniors ?? 0),
        infants: Number(detailEntry?.infants ?? 0),
        payingGuests: Number(detailEntry?.payingGuests ?? 0),
        totalGuests: Number(detailEntry?.totalGuests ?? 0),
        subtotal: Number(dbBooking?.subtotal ?? detailEntry?.subtotal ?? lineTotal),
        entranceFee: Number(detailEntry?.entranceFee ?? 0),
        extraPersonFee: Number(detailEntry?.extraPersonFee ?? 0),
        totalDiscount: Number(dbBooking?.discount ?? detailEntry?.totalDiscount ?? 0),
        tax: Number(dbBooking?.tax ?? 0),
        pricePerNight: nights > 0 ? (lineTotal / nights).toFixed(2) : '0.00',
        total: lineTotal,
        paidAmount: paymentContext.paidAmount,
        changeAmount: paymentContext.changeAmount,
        paymentMethod: paymentContext.paymentMethod,
        paymentStatus: paymentContext.paymentStatus,
        paymentPending: paymentContext.paymentPending,
        paymentUrl,
        bookingReference: ref,
        cashier: transaction.cashier_name || null,
    };
}

function isMenuOrderItem(item) {
    if (!item || item.bookingReference) return false;
    const category = String(item.category || '').toLowerCase();
    if (category && category !== 'restaurant') return false;
    return true;
}

async function getMenuOrderItems(transaction) {
    const items = await loadLineItems(transaction);
    return items.filter(isMenuOrderItem);
}

async function resolveRoutedPrinterSnapshot({
    stationId = null,
    usageType = 'receipt',
    printerId = null,
    printerSnapshot = null,
}) {
    if (printerSnapshot) return printerSnapshot;
    if (printerId) {
        const printer = await resolvePrinterConfig(printerId);
        return buildPrinterJobSnapshot(printer);
    }

    const routed = await resolvePrinterForJob({ stationId, usageType });
    return buildPrinterJobSnapshot(routed.printer);
}

async function buildKitchenOrderData(transaction, items, { stationId = null, jobType = 'kitchen_order', printer = null } = {}) {
    const station = stationId ? await getStationById(stationId) : null;
    return {
        receiptNo: formatDisplayReceiptNo(transaction.receipt_no),
        serviceOrderNumber: transaction.service_order_number ?? null,
        orderType: transaction.order_type ?? null,
        locationNumber: transaction.location_number ?? null,
        date: transaction.transaction_date,
        time: transaction.transaction_time,
        cashier: transaction.cashier_name || null,
        stationName: station?.stationName || printer?.stationName || null,
        items,
        jobType,
        groupIdenticalItems: printer?.groupIdenticalItems !== false,
    };
}

export async function prepareAndQueuePrint({
    receiptNo,
    type,
    bookingReference,
    source = 'manual',
    requestedBy = null,
    printerId = null,
    printerSnapshot = null,
    stationId = null,
    usageType = null,
    orderItems = null,
}) {
    const transaction = await loadTransactionByReceipt(receiptNo);
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedBookingRef = bookingReference
        ? String(bookingReference).trim()
        : null;
    const routedUsageType = usageType
        || (normalizedType === 'kitchen_order' ? 'kitchen' : normalizedType === 'bar_order' ? 'bar' : 'receipt');

    const resolvedPrinter = await resolveRoutedPrinterSnapshot({
        stationId,
        usageType: routedUsageType,
        printerId,
        printerSnapshot,
    });

    const { job, duplicateSkipped, retriedFailedJob } = await createPrintJob({
        receiptNo: transaction.receipt_no,
        transactionId: transaction.id,
        printType: normalizedType,
        bookingReference: normalizedBookingRef,
        source,
        requestedBy,
        printerId: resolvedPrinter?.printerId ?? null,
        printerName: resolvedPrinter?.printerName ?? null,
        printerInterface: resolvedPrinter?.printerInterface ?? 'usb',
        printerConfig: resolvedPrinter?.printerConfig ?? null,
        jobType: normalizedType === 'kitchen_order'
            ? 'kitchen_order'
            : normalizedType === 'bar_order'
                ? 'bar_order'
                : undefined,
    });

    if (duplicateSkipped) {
        return {
            success: true,
            duplicateSkipped: true,
            jobId: job.id,
            jobStatus: job.status,
            transactionId: transaction.id,
            receiptNo: transaction.receipt_no,
            displayReceiptNo: formatDisplayReceiptNo(transaction.receipt_no),
            printType: normalizedType,
            bookingReference: normalizedBookingRef,
            jobFile: job.jobFile,
        };
    }

    // Connector-required methods without assigned connector cannot be printed.
    if (
      String(resolvedPrinter?.printerConfig?.connection_method || '').toLowerCase() === 'android_bluetooth' ||
      String(resolvedPrinter?.printerConfig?.connection_method || '').toLowerCase() === 'bluetooth_serial' ||
      String(resolvedPrinter?.printerInterface || '').toLowerCase() === 'bluetooth'
    ) {
      const connectorId =
        resolvedPrinter?.printerConfig?.connector_device_id ||
        resolvedPrinter?.printerConfig?.bridge_device_id ||
        resolvedPrinter?.printerConfig?.connectorDeviceId ||
        resolvedPrinter?.printerConfig?.bridgeDeviceId;
      if (!connectorId) {
        await markPrintJobFailed(job.id, 'No Print Connector assigned.');
        return {
            success: false,
            jobId: job.id,
            jobStatus: PRINT_JOB_STATUS.FAILED,
            message: 'No Print Connector assigned.',
            error: 'No Print Connector assigned.',
            transactionId: transaction.id,
            receiptNo: transaction.receipt_no,
            printType: normalizedType,
        };
      }
    }

    let receiptData;
    const paperWidth = resolvedPrinter?.printerConfig?.paper_width
      || resolvedPrinter?.printerConfig?.paperWidth
      || null;
    try {
        if (normalizedType === 'booking') {
            receiptData = await buildBookingReceiptData(transaction, bookingReference);
            const result = await printBookingReceipt(receiptData, { jobId: job.id, paperWidth });
            if (!result.success) {
                await markPrintJobFailed(job.id, result.message || 'Failed to queue booking receipt');
                throw new PosReceiptPrintError(
                    result.message || 'Failed to queue booking receipt',
                    500,
                    'PRINT_QUEUE_FAILED'
                );
            }
            await markPrintJobQueued(job.id, result.jobFile);
            return {
                success: true,
                duplicateSkipped: false,
                retriedFailedJob,
                jobId: job.id,
                jobStatus: PRINT_JOB_STATUS.QUEUED,
                transactionId: transaction.id,
                receiptNo: transaction.receipt_no,
                displayReceiptNo: receiptData.receiptNo,
                printType: 'booking',
                bookingReference: receiptData.bookingReference,
                jobFile: result.jobFile,
            };
        }

        if (normalizedType === 'regular') {
            receiptData = await buildRegularReceiptData(transaction);
            const result = await printRegularReceipt(receiptData, { jobId: job.id, paperWidth });
            if (!result.success) {
                await markPrintJobFailed(job.id, result.message || 'Failed to queue regular receipt');
                throw new PosReceiptPrintError(
                    result.message || 'Failed to queue regular receipt',
                    500,
                    'PRINT_QUEUE_FAILED'
                );
            }
            await markPrintJobQueued(job.id, result.jobFile);
            return {
                success: true,
                duplicateSkipped: false,
                retriedFailedJob,
                jobId: job.id,
                jobStatus: PRINT_JOB_STATUS.QUEUED,
                transactionId: transaction.id,
                receiptNo: transaction.receipt_no,
                displayReceiptNo: receiptData.receiptNo,
                printType: 'regular',
                jobFile: result.jobFile,
            };
        }

        if (normalizedType === 'kitchen_order' || normalizedType === 'bar_order') {
            const items = Array.isArray(orderItems) && orderItems.length
                ? orderItems
                : await getMenuOrderItems(transaction);
            if (!items.length) {
                await markPrintJobFailed(job.id, 'No kitchen/bar order items found');
                throw new PosReceiptPrintError('No kitchen/bar order items found', 400, 'NO_ORDER_ITEMS');
            }

            const printer = resolvedPrinter?.printerId
                ? await getPrinterById(resolvedPrinter.printerId)
                : null;
            const orderData = await buildKitchenOrderData(transaction, items, {
                stationId,
                jobType: normalizedType,
                printer,
            });
            const result = await printKitchenOrder(orderData, { jobId: job.id });
            if (!result.success) {
                await markPrintJobFailed(job.id, result.message || 'Failed to queue kitchen order');
                throw new PosReceiptPrintError(
                    result.message || 'Failed to queue kitchen order',
                    500,
                    'PRINT_QUEUE_FAILED'
                );
            }
            await markPrintJobQueued(job.id, result.jobFile);
            return {
                success: true,
                duplicateSkipped: false,
                retriedFailedJob,
                jobId: job.id,
                jobStatus: PRINT_JOB_STATUS.QUEUED,
                transactionId: transaction.id,
                receiptNo: transaction.receipt_no,
                displayReceiptNo: orderData.receiptNo,
                printType: normalizedType,
                jobFile: result.jobFile,
            };
        }

        await markPrintJobFailed(job.id, 'Invalid print type');
        throw new PosReceiptPrintError(
            'Invalid print type. Supported values: regular, booking, kitchen_order, bar_order',
            400,
            'INVALID_PRINT_TYPE'
        );
    } catch (error) {
        if (!(error instanceof PosReceiptPrintError)) {
            await markPrintJobFailed(job.id, error.message || 'Unexpected print error');
        }
        throw error;
    }
}

export async function retryFailedPrintJob(jobId, requestedBy = null, { routing = 'current' } = {}) {
    const job = await getPrintJobById(jobId);
    if (!job) {
        throw new PosReceiptPrintError('Print job not found', 404, 'JOB_NOT_FOUND');
    }

    if (job.status !== PRINT_JOB_STATUS.FAILED) {
        throw new PosReceiptPrintError(
            'Only failed print jobs can be retried.',
            409,
            'NOT_RETRYABLE'
        );
    }

    const config = job.printerConfig || {};
    const stationId = config.station_id ?? config.stationId ?? null;
    const usageType = config.usage_type ?? config.usageType ?? null;
    const useCurrentRouting = String(routing || 'current').toLowerCase() === 'current';
    if (useCurrentRouting && stationId != null) {
        const station = await getStationById(stationId);
        if (!station?.active) {
            throw new PosReceiptPrintError(
                'The original station is inactive. Select an explicit replacement route.',
                409,
                'STATION_INACTIVE'
            );
        }
    }

    return prepareAndQueuePrint({
        receiptNo: job.receiptNo,
        type: job.printType,
        bookingReference: job.bookingReference,
        source: 'manual',
        requestedBy,
        stationId: useCurrentRouting ? stationId : null,
        usageType: useCurrentRouting ? usageType : null,
        printerSnapshot: !useCurrentRouting && (job.printerId || job.printerName)
            ? {
                printerId: job.printerId,
                printerName: job.printerName,
                printerInterface: job.printerInterface,
                printerConfig: job.printerConfig,
            }
            : null,
    });
}

async function queueTestPrintForPrinter(printer) {
    if (!printer || !printer.isActive) {
        return {
            success: false,
            message: 'Printer not found or inactive.',
            error: 'Printer not found',
        };
    }

    const needsConnector =
        printer.connectionMethod === 'android_bluetooth' ||
        printer.connectionMethod === 'bluetooth_serial' ||
        printer.interfaceType === 'bluetooth';
    const connectorId = printer.connectorDeviceId || printer.bridgeDeviceId;

    if (needsConnector && !connectorId) {
        await updatePrinterTestStatus(printer.id, 'failed', 'No Print Connector assigned.');
        return {
            success: false,
            message: 'No Print Connector assigned.',
            interface: printer.interfaceType,
            connectionMethod: printer.connectionMethod,
            error: 'No Print Connector assigned.',
        };
    }

    const receiptSettings = await getReceiptSettings();
    const receiptNo = `TEST-${Date.now()}`;
    const printerSnapshot = buildPrinterJobSnapshot(printer);
    const { job } = await createPrintJob({
        receiptNo,
        transactionId: null,
        printType: 'test',
        source: 'manual',
        printerId: printerSnapshot?.printerId ?? null,
        printerName: printerSnapshot?.printerName ?? null,
        printerInterface: printerSnapshot?.printerInterface ?? 'usb',
        printerConfig: printerSnapshot?.printerConfig ?? null,
        jobType: 'test_print',
    });

    // Connector-owned: queue .prn for Print Connector (daemon parks payload).
    if (connectorId) {
        const result = await printTestReceipt({
            jobId: job.id,
            receiptSettings,
            paperWidth: printer.paperWidth || '58',
        });
        if (!result.success) {
            await markPrintJobFailed(job.id, result.message || 'Failed to queue test receipt');
            await updatePrinterTestStatus(printer.id, 'failed', result.error || result.message);
            return {
                success: false,
                message: 'Failed to queue connector test receipt',
                error: result.error || result.message,
                interface: printer.interfaceType,
                connectionMethod: printer.connectionMethod,
            };
        }

        await markPrintJobQueued(job.id, result.jobFile);
        await updatePrinterTestStatus(printer.id, 'success', null);

        return {
            success: true,
            message: `Test receipt queued for Print Connector (${printer.connectorDeviceName || printer.bridgeDeviceName || 'connector'}). Waiting for connector app.`,
            jobId: job.id,
            interface: printer.interfaceType,
            connectionMethod: printer.connectionMethod,
            printerName: printer.bluetoothDeviceName || printer.windowsPrinterName || printer.name,
            connectorDeviceId: connectorId,
            pendingBridge: true,
        };
    }

    // Ethernet: send ESC/POS buffer directly over TCP 9100 (immediate feedback).
    if (printer.interfaceType === 'ethernet' || printer.connectionMethod === 'ethernet') {
        const ipAddress = printer.ipAddress;
        const port = Number(printer.port || 9100) || 9100;

        if (!ipAddress) {
            await markPrintJobFailed(job.id, 'Ethernet printer IP address is missing.');
            await updatePrinterTestStatus(printer.id, 'failed', 'Missing IP address');
            return {
                success: false,
                message: 'Ethernet printer is unreachable',
                error: 'Ethernet printer IP address is missing.',
                interface: 'ethernet',
            };
        }

        const result = await printTestReceipt({
            jobId: job.id,
            receiptSettings,
            paperWidth: printer.paperWidth || '58',
        });
        if (!result.success) {
            await markPrintJobFailed(job.id, result.message || 'Failed to build test receipt');
            await updatePrinterTestStatus(printer.id, 'failed', result.error || result.message);
            return {
                success: false,
                message: 'Failed to print test receipt',
                error: result.error || result.message,
                interface: 'ethernet',
            };
        }

        try {
            const fs = await import('fs');
            const buffer = fs.readFileSync(result.filePath);
            const { sendToEthernetPrinter } = await import('./ethernetPrinterService.js');
            await sendToEthernetPrinter({ ipAddress, port, buffer });

            // Remove from print-queue so the daemon does not double-print.
            try {
                fs.unlinkSync(result.filePath);
            } catch {
                /* ignore */
            }

            await markPrintJobQueued(job.id, result.jobFile);
            await markPrintJobSent(job.id);
            await updatePrinterTestStatus(printer.id, 'success', null);

            return {
                success: true,
                message: `Test receipt sent to Ethernet printer ${ipAddress}:${port}`,
                jobId: job.id,
                interface: 'ethernet',
                printerName: `${ipAddress}:${port}`,
            };
        } catch (error) {
            const message = error.message || `Ethernet printer timeout: ${ipAddress}:${port}`;
            try {
                const fs = await import('fs');
                if (result.filePath && fs.existsSync(result.filePath)) {
                    fs.unlinkSync(result.filePath);
                }
            } catch {
                /* ignore */
            }
            await markPrintJobFailed(job.id, message);
            await updatePrinterTestStatus(printer.id, 'failed', message);
            return {
                success: false,
                message: 'Ethernet printer is unreachable',
                error: message,
                interface: 'ethernet',
            };
        }
    }

    // USB: queue .prn for Windows daemon.
    const result = await printTestReceipt({
        jobId: job.id,
        receiptSettings,
        paperWidth: printer.paperWidth || '58',
    });
    if (!result.success) {
        await markPrintJobFailed(job.id, result.message || 'Failed to queue test receipt');
        await updatePrinterTestStatus(printer.id, 'failed', result.error || result.message);
        return {
            success: false,
            message: 'Failed to print test receipt',
            error: result.error || result.message,
            interface: printer.interfaceType,
        };
    }

    await markPrintJobQueued(job.id, result.jobFile);
    await updatePrinterTestStatus(printer.id, 'success', null);

    return {
        success: true,
        message: `Test receipt sent to ${printer.name}`,
        jobId: job.id,
        interface: printer.interfaceType,
        printerName: printer.windowsPrinterName || printer.name,
    };
}

export async function queuePrinterTestPrint(printerId) {
    const printer = await getPrinterById(Number(printerId));
    return queueTestPrintForPrinter(printer);
}

export async function queuePrinterPreviewTestPrint(printerData) {
    const printer = buildTransientPrinter(printerData);
    return queueTestPrintForPrinter(printer);
}

export async function queueReceiptSettingsTestPrint() {
    const printer = await resolvePrinterConfig();
    if (!printer) {
        return {
            success: false,
            message: 'No active printer configured.',
            error: 'No printer configured',
        };
    }
    return queueTestPrintForPrinter(printer);
}

export async function queueCheckoutPrints({ receiptNo, stationId = null, requestedBy = null }) {
    const warnings = [];
    const results = [];

    const eligibility = await evaluateAutoPrintEligibility(stationId);
    if (!eligibility.allowed) {
        return {
            success: true,
            printed: false,
            warning: eligibility.message,
            code: eligibility.code,
            warnings: [{ type: 'receipt', message: eligibility.message, code: eligibility.code }],
            results,
        };
    }

    if (eligibility.warning) {
        warnings.push({
            type: 'receipt',
            message: eligibility.warning,
            code: 'BRIDGE_OFFLINE_WARNING',
        });
    }

    try {
        const receiptResult = await prepareAndQueuePrint({
            receiptNo,
            type: 'regular',
            source: 'auto',
            requestedBy,
            stationId,
            usageType: 'receipt',
            printerSnapshot: buildPrinterJobSnapshot(eligibility.printer),
        });
        results.push({ type: 'receipt', ...receiptResult });
    } catch (error) {
        warnings.push({
            type: 'receipt',
            message: error.message || 'Payment successful, but receipt printing failed.',
            code: error.code || 'PRINT_FAILED',
        });
    }

    try {
        const transaction = await loadTransactionByReceipt(receiptNo);
        const menuItems = await getMenuOrderItems(transaction);
        if (menuItems.length > 0) {
            let orderPrinter = await getPrinterForKitchenOrder(stationId);
            let orderType = 'kitchen_order';

            if (!orderPrinter) {
                orderPrinter = await getPrinterForBarOrder(stationId);
                orderType = 'bar_order';
            }

            if (!orderPrinter) {
                warnings.push({
                    type: 'kitchen_order',
                    message: 'Payment successful, but no kitchen or bar printer is configured for this station.',
                    code: 'NO_ORDER_PRINTER',
                });
            } else if (!orderPrinter.printOrders) {
                warnings.push({
                    type: 'kitchen_order',
                    message: 'Order printing is disabled for the matched kitchen/bar printer.',
                    code: 'ORDER_PRINT_DISABLED',
                });
            } else if (!isPrinterInterfaceSupported(orderPrinter)) {
                warnings.push({
                    type: orderType,
                    message: getPrinterRoutingWarning(orderPrinter, orderPrinter.usageType || 'kitchen'),
                    code: 'ORDER_PRINTER_NOT_SUPPORTED',
                });
            } else {
                const orderResult = await prepareAndQueuePrint({
                    receiptNo,
                    type: orderType,
                    source: 'auto',
                    requestedBy,
                    stationId,
                    printerSnapshot: buildPrinterJobSnapshot(orderPrinter),
                    orderItems: menuItems,
                });
                results.push({ type: orderType, ...orderResult });
            }
        }
    } catch (error) {
        warnings.push({
            type: 'kitchen_order',
            message: error.message || 'Payment successful, but kitchen order printing failed.',
            code: error.code || 'ORDER_PRINT_FAILED',
        });
    }

    const primaryWarning = warnings[0]?.message || null;
    return {
        success: true,
        printed: results.length > 0,
        warning: primaryWarning,
        warnings,
        results,
    };
}

export { evaluateAutoPrintEligibility };
