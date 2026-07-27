import { db } from '../config/db.js';

export const PRINT_JOB_STATUS = {
    QUEUED: 'QUEUED',
    SENT: 'SENT',
    FAILED: 'FAILED',
};

const AUTO_SOURCE = 'auto';
const MANUAL_SOURCE_PREFIX = 'manual';

export const buildManualSource = () => `${MANUAL_SOURCE_PREFIX}-${Date.now()}`;

export const isAutoPrintSource = (source) => String(source || '').trim() === AUTO_SOURCE;

export const isManualPrintSource = (source) => (
    String(source || '').startsWith(MANUAL_SOURCE_PREFIX)
);

/**
 * Extract print job id embedded in queue filenames: pj-{id}-regular-....prn
 */
export const extractPrintJobIdFromFilename = (filename) => {
    const match = String(filename || '').match(/^pj-(\d+)-/i);
    if (!match) return null;
    const jobId = Number(match[1]);
    return Number.isFinite(jobId) && jobId > 0 ? jobId : null;
};

export async function ensurePrintJobsSchema() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS print_jobs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            receipt_no VARCHAR(50) NOT NULL,
            transaction_id INT NULL,
            print_type VARCHAR(30) NOT NULL,
            booking_reference VARCHAR(100) NULL,
            status ENUM('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'QUEUED',
            source VARCHAR(30) NOT NULL DEFAULT 'manual',
            requested_by INT NULL,
            job_file VARCHAR(255) NULL,
            printer_id INT NULL,
            printer_name VARCHAR(150) NULL,
            printer_interface ENUM('usb', 'ethernet', 'bluetooth') DEFAULT 'usb',
            printer_config JSON NULL,
            job_type VARCHAR(50) DEFAULT 'receipt',
            error_message TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            sent_at DATETIME NULL,
            failed_at DATETIME NULL,
            UNIQUE KEY uniq_auto_print (receipt_no, print_type, booking_reference, source)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensurePrintJobPrinterColumns();
}

async function ensurePrintJobPrinterColumns() {
    const columns = [
        { name: 'printer_id', definition: 'INT NULL' },
        { name: 'printer_name', definition: 'VARCHAR(150) NULL' },
        {
            name: 'printer_interface',
            definition: "ENUM('usb', 'ethernet', 'bluetooth') DEFAULT 'usb'",
        },
        { name: 'printer_config', definition: 'JSON NULL' },
        { name: 'job_type', definition: "VARCHAR(50) DEFAULT 'receipt'" },
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
            const afterClause = column.name === 'printer_id' ? ' AFTER job_file' : '';
            await db.query(
                `ALTER TABLE print_jobs ADD COLUMN ${column.name} ${column.definition}${afterClause}`
            );
        }
    }
}

function resolveJobType(printType, explicitJobType = null) {
    if (explicitJobType) return String(explicitJobType).trim().toLowerCase();
    const map = {
        regular: 'receipt',
        booking: 'receipt',
        kitchen_order: 'kitchen_order',
        bar_order: 'bar_order',
        test: 'test_print',
    };
    return map[String(printType || '').toLowerCase()] || 'receipt';
}

function parsePrinterConfig(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function mapPrintJobRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        receiptNo: row.receipt_no,
        transactionId: row.transaction_id,
        printType: row.print_type,
        bookingReference: row.booking_reference,
        status: row.status,
        source: row.source,
        requestedBy: row.requested_by,
        jobFile: row.job_file,
        printerId: row.printer_id ?? null,
        printerName: row.printer_name ?? null,
        printerInterface: row.printer_interface ?? 'usb',
        printerConfig: parsePrinterConfig(row.printer_config),
        jobType: row.job_type || resolveJobType(row.print_type),
        errorMessage: row.error_message,
        claimedByBridgeId: row.claimed_by_bridge_id ?? null,
        claimedAt: row.claimed_at ?? null,
        deliveredAt: row.delivered_at ?? null,
        createdAt: row.created_at,
        sentAt: row.sent_at,
        failedAt: row.failed_at,
    };
}

export async function findAutoPrintJob({ receiptNo, printType, bookingReference }) {
    const [rows] = await db.query(
        `SELECT *
         FROM print_jobs
         WHERE receipt_no = ?
           AND print_type = ?
           AND source = ?
           AND booking_reference <=> ?
         ORDER BY id DESC
         LIMIT 1`,
        [
            receiptNo,
            printType,
            AUTO_SOURCE,
            bookingReference || null,
        ]
    );

    return mapPrintJobRow(rows[0]);
}

export async function getPrintJobById(jobId) {
    const [rows] = await db.query(
        'SELECT * FROM print_jobs WHERE id = ? LIMIT 1',
        [jobId]
    );
    return mapPrintJobRow(rows[0]);
}

export async function listPrintJobsByReceipt(receiptNo) {
    const [rows] = await db.query(
        `SELECT *
         FROM print_jobs
         WHERE receipt_no = ?
         ORDER BY created_at DESC, id DESC`,
        [receiptNo]
    );
    return rows.map(mapPrintJobRow);
}

export async function createPrintJob({
    receiptNo,
    transactionId,
    printType,
    bookingReference = null,
    source = 'manual',
    requestedBy = null,
    printerId = null,
    printerName = null,
    printerInterface = 'usb',
    printerConfig = null,
    jobType = null,
}) {
    const normalizedPrintType = String(printType || '').trim().toLowerCase();
    const normalizedJobType = resolveJobType(normalizedPrintType, jobType);
    const normalizedReceiptNo = String(receiptNo || '').trim();
    const normalizedBookingRef = bookingReference
        ? String(bookingReference).trim()
        : null;
    const normalizedPrinterName = printerName ? String(printerName).trim() : null;
    const normalizedPrinterInterface = String(printerInterface || 'usb').toLowerCase();
    const serializedPrinterConfig = printerConfig
        ? JSON.stringify(printerConfig)
        : null;

    const resolvedSource = isAutoPrintSource(source)
        ? AUTO_SOURCE
        : buildManualSource();

    if (resolvedSource === AUTO_SOURCE) {
        const existing = await findAutoPrintJob({
            receiptNo: normalizedReceiptNo,
            printType: normalizedPrintType,
            bookingReference: normalizedBookingRef,
        });

        if (existing) {
            if (existing.status === PRINT_JOB_STATUS.FAILED) {
                await resetPrintJobForRetry(existing.id, {
                    printerId,
                    printerName: normalizedPrinterName,
                    printerInterface: normalizedPrinterInterface,
                    printerConfig: serializedPrinterConfig,
                });
                return {
                    job: await getPrintJobById(existing.id),
                    duplicateSkipped: false,
                    retriedFailedJob: true,
                };
            }

            return {
                job: existing,
                duplicateSkipped: true,
                retriedFailedJob: false,
            };
        }
    }

    try {
        const [result] = await db.query(
            `INSERT INTO print_jobs
             (receipt_no, transaction_id, print_type, booking_reference, status, source, requested_by,
              printer_id, printer_name, printer_interface, printer_config, job_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                normalizedReceiptNo,
                transactionId || null,
                normalizedPrintType,
                normalizedBookingRef,
                PRINT_JOB_STATUS.QUEUED,
                resolvedSource,
                requestedBy || null,
                printerId || null,
                normalizedPrinterName,
                normalizedPrinterInterface,
                serializedPrinterConfig,
                normalizedJobType,
            ]
        );

        const job = await getPrintJobById(result.insertId);
        return {
            job,
            duplicateSkipped: false,
            retriedFailedJob: false,
        };
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY' && resolvedSource === AUTO_SOURCE) {
            const existing = await findAutoPrintJob({
                receiptNo: normalizedReceiptNo,
                printType: normalizedPrintType,
                bookingReference: normalizedBookingRef,
            });
            if (existing) {
                return {
                    job: existing,
                    duplicateSkipped: true,
                    retriedFailedJob: false,
                };
            }
        }
        throw error;
    }
}

export async function resetPrintJobForRetry(jobId, printerFields = null) {
    if (printerFields) {
        await db.query(
            `UPDATE print_jobs
             SET status = ?,
                 job_file = NULL,
                 error_message = NULL,
                 sent_at = NULL,
                 failed_at = NULL,
                 claimed_by_bridge_id = NULL,
                 claimed_at = NULL,
                 delivered_at = NULL,
                 printer_id = COALESCE(?, printer_id),
                 printer_name = COALESCE(?, printer_name),
                 printer_interface = COALESCE(?, printer_interface),
                 printer_config = COALESCE(?, printer_config)
             WHERE id = ?`,
            [
                PRINT_JOB_STATUS.QUEUED,
                printerFields.printerId ?? null,
                printerFields.printerName ?? null,
                printerFields.printerInterface ?? null,
                printerFields.printerConfig ?? null,
                jobId,
            ]
        );
        return;
    }

    await db.query(
        `UPDATE print_jobs
         SET status = ?,
             job_file = NULL,
             error_message = NULL,
             sent_at = NULL,
             failed_at = NULL,
             claimed_by_bridge_id = NULL,
             claimed_at = NULL,
             delivered_at = NULL
         WHERE id = ?`,
        [PRINT_JOB_STATUS.QUEUED, jobId]
    );
}

export async function markPrintJobQueued(jobId, jobFile) {
    await db.query(
        `UPDATE print_jobs
         SET status = ?,
             job_file = ?,
             error_message = NULL,
             failed_at = NULL
         WHERE id = ?`,
        [PRINT_JOB_STATUS.QUEUED, jobFile || null, jobId]
    );
}

export async function markPrintJobSent(jobId) {
    await db.query(
        `UPDATE print_jobs
         SET status = ?,
             sent_at = NOW(),
             failed_at = NULL,
             error_message = NULL
         WHERE id = ?`,
        [PRINT_JOB_STATUS.SENT, jobId]
    );
}

export async function markPrintJobFailed(jobId, errorMessage = 'Print failed') {
    const message = String(errorMessage || 'Print failed').slice(0, 2000);
    await db.query(
        `UPDATE print_jobs
         SET status = ?,
             failed_at = NOW(),
             error_message = ?
         WHERE id = ?`,
        [PRINT_JOB_STATUS.FAILED, message, jobId]
    );
}

export async function getPrintJobPrinterTarget(jobId) {
    const job = await getPrintJobById(jobId);
    if (!job) return null;

    const fallbackName = process.env.PRINTER_NAME || 'POS-582';
    const targetName = job.printerName || fallbackName;

    return {
        jobId: job.id,
        printerId: job.printerId,
        printerName: targetName,
        printerInterface: job.printerInterface || 'usb',
        printerConfig: job.printerConfig,
        usedFallback: !job.printerName,
    };
}

function normalizeDaemonErrorMessage(errorMessage, targetPrinter) {
    const raw = String(errorMessage || '').trim();
    if (!raw) {
        return targetPrinter
            ? `Failed to send to printer: ${targetPrinter}`
            : 'No printer_name found in job';
    }

    if (/ethernet printer/i.test(raw)) {
        return raw;
    }
    if (/printer not found/i.test(raw)) {
        return `Printer not found: ${targetPrinter}`;
    }
    if (/offline|unavailable|cannot connect|unreachable|timeout|refused/i.test(raw)) {
        if (/ethernet/i.test(raw)) return raw;
        return `Printer offline: ${targetPrinter}`;
    }
    if (/write-failed|raw print failed/i.test(raw)) {
        return `Failed to send to Windows print queue: ${targetPrinter}`;
    }

    return raw;
}

export async function syncPrintJobFromDaemon({ filename, success, errorMessage = null, targetPrinter = null }) {
    const jobId = extractPrintJobIdFromFilename(filename);
    if (!jobId) {
        return { updated: false, reason: 'no_job_id' };
    }

    try {
        let resolvedPrinter = targetPrinter;
        if (!resolvedPrinter) {
            const target = await getPrintJobPrinterTarget(jobId);
            resolvedPrinter = target?.printerName || process.env.PRINTER_NAME || 'POS-582';
        }

        if (success) {
            await markPrintJobSent(jobId);
            return { updated: true, jobId, status: PRINT_JOB_STATUS.SENT, printerName: resolvedPrinter };
        }

        const normalizedError = normalizeDaemonErrorMessage(errorMessage, resolvedPrinter);
        await markPrintJobFailed(jobId, normalizedError);
        return { updated: true, jobId, status: PRINT_JOB_STATUS.FAILED, printerName: resolvedPrinter };
    } catch (error) {
        return { updated: false, jobId, reason: error.message };
    }
}
