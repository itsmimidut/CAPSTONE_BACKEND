import {
    getCurrentSessionForDevice,
    clearDisplaySession,
} from './displaySessionService.js';

export const restoreDisplaySession = async (deviceId) => {
    const session = await getCurrentSessionForDevice(deviceId);
    if (!session) {
        return { restored: false, reason: 'no_active_session' };
    }

    return {
        restored: true,
        session: {
            receipt_no: session.receiptNo,
            invoice_id: session.invoiceId,
            amount: session.amount,
            payment_status: session.status,
            qr_code: session.qrCode,
            payment_url: session.paymentUrl,
            items: session.items,
            station_id: session.stationId,
            station_name: session.stationName,
            device_id: session.deviceId,
            created_at: session.createdAt,
        },
    };
};

export { getCurrentSessionForDevice, clearDisplaySession };
