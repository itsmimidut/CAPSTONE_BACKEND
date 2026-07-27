import { db } from '../config/db.js';

export const TIMELINE_EVENTS = {
    PAYMENT_CREATED: 'PAYMENT_CREATED',
    QR_DISPLAYED: 'QR_DISPLAYED',
    CUSTOMER_SCANNED: 'CUSTOMER_SCANNED',
    PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
    WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED',
    INVENTORY_DEDUCTED: 'INVENTORY_DEDUCTED',
    BOOKING_FINALIZED: 'BOOKING_FINALIZED',
    PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
};

export const ensurePaymentTimelineSchema = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS payment_timelines (
            timeline_id INT AUTO_INCREMENT PRIMARY KEY,
            receipt_no VARCHAR(50) NOT NULL,
            event_type VARCHAR(100) NOT NULL,
            event_description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pt_receipt (receipt_no),
            INDEX idx_pt_event (event_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
};

export const addTimelineEvent = async (receiptNo, eventType, eventDescription = null) => {
    const normalizedReceipt = String(receiptNo || '').trim();
    const normalizedEvent = String(eventType || '').trim().toUpperCase();
    if (!normalizedReceipt || !normalizedEvent) return null;

    const [result] = await db.query(
        `INSERT INTO payment_timelines (receipt_no, event_type, event_description)
         VALUES (?, ?, ?)`,
        [normalizedReceipt, normalizedEvent, eventDescription]
    );

    return {
        timelineId: result.insertId,
        receiptNo: normalizedReceipt,
        eventType: normalizedEvent,
        eventDescription,
        createdAt: new Date().toISOString(),
    };
};

export const getTimelineByReceipt = async (receiptNo) => {
    const normalized = String(receiptNo || '').trim();
    if (!normalized) return [];

    const [rows] = await db.query(
        `SELECT timeline_id, receipt_no, event_type, event_description, created_at
         FROM payment_timelines
         WHERE receipt_no = ?
         ORDER BY created_at ASC, timeline_id ASC`,
        [normalized]
    );

    return rows.map((row) => ({
        timelineId: row.timeline_id,
        receiptNo: row.receipt_no,
        eventType: row.event_type,
        eventDescription: row.event_description,
        createdAt: row.created_at,
    }));
};
