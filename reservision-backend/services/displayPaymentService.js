import QRCode from 'qrcode';
import { listDevices } from './customerDisplayService.js';
import { resolveDisplayForPayment } from './stationRoutingService.js';
import {
    createDisplaySession,
    getSessionByInvoiceId,
    markSessionPaid,
    markSessionFailed,
    markSessionExpired,
} from './displaySessionService.js';
import { addTimelineEvent, TIMELINE_EVENTS } from './paymentTimelineService.js';
import {
    broadcastPaymentCreated,
    broadcastPaymentPaid,
    broadcastPaymentFailed,
    broadcastPaymentExpired,
} from './displayWebSocketService.js';

const buildDisplayItems = (items = []) =>
    (Array.isArray(items) ? items : []).map((item) => ({
        name: item.name || item.item_name || 'Item',
        quantity: Number(item.quantity ?? item.qty ?? 1),
    }));

export const pushPaymentToDisplay = async ({
    stationId = null,
    terminalId = null,
    receiptNo,
    amount,
    invoiceId,
    paymentUrl,
    items = [],
    serviceOrderNumber = null,
    orderType = null,
    locationNumber = null,
}) => {
    const routing = await resolveDisplayForPayment({ stationId, terminalId });

    if (!routing.routed) {
        return {
            pushed: false,
            reason: routing.reason || 'no_display_device',
            warning: routing.warning,
            stationId: routing.stationId || null,
            stationName: routing.stationName || null,
        };
    }

    const targetDeviceId = routing.deviceId;
    const device = (await listDevices()).find((d) => d.deviceId === targetDeviceId);
    if (!device) {
        return {
            pushed: false,
            reason: 'device_not_found',
            warning: routing.warning,
        };
    }

    let qrCode = null;
    if (paymentUrl) {
        try {
            qrCode = await QRCode.toDataURL(paymentUrl, { margin: 1, width: 280 });
        } catch {
            qrCode = null;
        }
    }

    const displayItems = buildDisplayItems(items);

    await createDisplaySession({
        deviceId: targetDeviceId,
        receiptNo,
        invoiceId,
        amount,
        qrCode,
        paymentUrl,
        items: displayItems,
        stationId: routing.stationId,
        serviceOrderNumber,
        orderType,
        locationNumber,
    });

    await addTimelineEvent(
        receiptNo,
        TIMELINE_EVENTS.PAYMENT_CREATED,
        `GCash invoice ${invoiceId || 'n/a'} created for ₱${Number(amount || 0).toFixed(2)}`
    );

    const payload = {
        receiptNo,
        amount: Number(amount),
        invoiceId,
        paymentUrl,
        qrCode,
        items: displayItems,
        status: 'PENDING',
        stationId: routing.stationId,
        stationName: routing.stationName,
        serviceOrderNumber,
        orderType,
        locationNumber,
    };

    broadcastPaymentCreated(targetDeviceId, payload);

    await addTimelineEvent(
        receiptNo,
        TIMELINE_EVENTS.QR_DISPLAYED,
        `QR pushed to ${targetDeviceId} (${routing.stationName || 'station'})`
    );

    return {
        pushed: true,
        deviceId: targetDeviceId,
        deviceName: routing.deviceName,
        stationId: routing.stationId,
        stationName: routing.stationName,
        payload,
    };
};

export const notifyDisplayPaymentResult = async ({
    invoiceId,
    status,
    receiptNo = null,
    amount = null,
    message = null,
}) => {
    let session = null;
    if (invoiceId) {
        session = await getSessionByInvoiceId(invoiceId);
    }
    if (!session && receiptNo) {
        const { getSessionByReceipt } = await import('./displaySessionService.js');
        session = await getSessionByReceipt(receiptNo);
    }

    const deviceId = session?.deviceId;
    if (!deviceId) {
        return { notified: false, reason: 'no_session' };
    }

    const resolvedReceipt = receiptNo || session.receiptNo;
    const payload = {
        status,
        receiptNo: resolvedReceipt,
        amount,
        invoiceId,
        message,
    };

    const normalized = String(status || '').toUpperCase();

    if (normalized === 'PAID') {
        await markSessionPaid(invoiceId, { receiptNo: resolvedReceipt });
        await addTimelineEvent(
            resolvedReceipt,
            TIMELINE_EVENTS.PAYMENT_COMPLETED,
            `Payment confirmed for invoice ${invoiceId || 'n/a'}`
        );
        broadcastPaymentPaid(deviceId, payload);
    } else if (normalized === 'EXPIRED') {
        await markSessionExpired(invoiceId, { receiptNo: resolvedReceipt });
        await addTimelineEvent(
            resolvedReceipt,
            TIMELINE_EVENTS.PAYMENT_EXPIRED,
            message || 'Payment session expired'
        );
        broadcastPaymentExpired(deviceId, payload);
    } else if (normalized === 'FAILED') {
        await markSessionFailed(invoiceId, { receiptNo: resolvedReceipt });
        await addTimelineEvent(
            resolvedReceipt,
            TIMELINE_EVENTS.PAYMENT_FAILED,
            message || 'Payment failed'
        );
        broadcastPaymentFailed(deviceId, payload);
    }

    return { notified: true, deviceId, status: normalized };
};
