import fetch from 'node-fetch';
import QRCode from 'qrcode';

/** Payments API (not Invoice v2) — path has no `/v2` prefix. */
const PAYMENT_REQUEST_URL = 'https://api.xendit.co/payment_requests';
const PAYMENT_REQUEST_V3_URL = 'https://api.xendit.co/v3/payment_requests';
const PAYMENTS_API_VERSION = '2024-11-11';

const getXenditAuthHeader = (
  idempotencyKey = null,
  { includeApiVersion = false } = {},
) => {
  const apiKey = process.env.XENDIT_SECRET_KEY;
  if (!apiKey) {
    throw new Error('XENDIT_SECRET_KEY is not configured');
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };

  if (idempotencyKey) {
    headers['Idempotency-key'] = String(idempotencyKey);
  }
  if (includeApiVersion) {
    headers['api-version'] = PAYMENTS_API_VERSION;
  }

  return headers;
};

export const isPaymentRequestId = (id) => String(id || '').trim().startsWith('pr-');

export const createQrphPaymentRequest = async ({ bookingId, amount }) => {
  const roundedAmount = Math.round(Number(amount || 0));
  if (!roundedAmount || roundedAmount <= 0) {
    throw new Error('Invalid QR payment amount');
  }

  const referenceId = `booking-${bookingId}-${Date.now()}`;
  const response = await fetch(PAYMENT_REQUEST_URL, {
    method: 'POST',
    headers: getXenditAuthHeader(referenceId),
    body: JSON.stringify({
      reference_id: referenceId,
      amount: roundedAmount,
      currency: 'PHP',
      country: 'PH',
      payment_method: {
        type: 'QR_CODE',
        reusability: 'ONE_TIME_USE',
        qr_code: {
          channel_code: 'QRPH',
        },
      },
      metadata: {
        booking_id: String(bookingId),
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error_code ||
      'Failed to create Xendit QR payment'
    );
    error.status = response.status;
    error.details = data;
    error.code = data?.error_code || 'XENDIT_QR_CREATE_FAILED';
    throw error;
  }

  const qrAction = Array.isArray(data?.actions)
    ? data.actions.find((action) => (
        String(action?.type || '').toUpperCase() === 'PRESENT_TO_CUSTOMER'
        && String(action?.descriptor || '').toUpperCase() === 'QR_STRING'
      ))
    : null;
  const qrString = qrAction?.value
    || data?.payment_method?.qr_code?.channel_properties?.qr_string
    || null;
  if (!qrString) {
    throw new Error('Xendit did not return a QR code string for this payment');
  }

  return {
    paymentRequestId: data.payment_request_id || data.id,
    qr_string: qrString,
    status: data.status,
    expires_at: data?.channel_properties?.expires_at
      || data?.payment_method?.qr_code?.channel_properties?.expires_at
      || null,
    amount: roundedAmount,
  };
};

export const fetchPaymentRequest = async (paymentRequestId) => {
  let response = await fetch(`${PAYMENT_REQUEST_V3_URL}/${paymentRequestId}`, {
    method: 'GET',
    headers: getXenditAuthHeader(null, { includeApiVersion: true }),
  });

  let data = await response.json().catch(() => ({}));
  const shouldTryLegacyLookup = !response.ok && (
    response.status === 404
    || (
      response.status === 400
      && String(data?.message || '').includes("'undefined' channel code")
    )
  );
  if (shouldTryLegacyLookup) {
    response = await fetch(`${PAYMENT_REQUEST_URL}/${paymentRequestId}`, {
      method: 'GET',
      headers: getXenditAuthHeader(),
    });
    data = await response.json().catch(() => ({}));
  }
  if (response.status === 404 && data?.error_code === 'DATA_NOT_FOUND') {
    return {
      payment_request_id: paymentRequestId,
      status: 'NOT_FOUND',
      notFound: true,
    };
  }
  if (!response.ok) {
    const error = new Error(data?.message || 'Failed to fetch Xendit payment request');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
};

export const cancelPaymentRequest = async (paymentRequestId) => {
  const current = await fetchPaymentRequest(paymentRequestId);
  const status = String(current?.status || '').toUpperCase();
  if (['CANCELED', 'CANCELLED', 'EXPIRED', 'FAILED', 'SUCCEEDED', 'COMPLETED', 'PAID', 'NOT_FOUND'].includes(status)) {
    return { cancelled: false, alreadyTerminal: true, paymentRequest: current };
  }

  const response = await fetch(
    `${PAYMENT_REQUEST_V3_URL}/${encodeURIComponent(paymentRequestId)}/cancel`,
    {
      method: 'POST',
      headers: getXenditAuthHeader(null, { includeApiVersion: true }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.message || '');
    const shouldTryLegacyCancellation = response.status === 404 || (
      response.status === 400
      && data?.error_code === 'API_VALIDATION_ERROR'
      && message.includes("'undefined' channel code")
    );
    if (shouldTryLegacyCancellation) {
      const legacyResponse = await fetch(
        `${PAYMENT_REQUEST_URL}/${encodeURIComponent(paymentRequestId)}/cancel`,
        {
          method: 'POST',
          headers: getXenditAuthHeader(),
        },
      );
      const legacyData = await legacyResponse.json().catch(() => ({}));
      if (legacyResponse.ok) {
        return {
          cancelled: true,
          alreadyTerminal: false,
          legacyRequest: true,
          paymentRequest: legacyData,
        };
      }
      return {
        cancelled: false,
        alreadyTerminal: false,
        unsupportedLegacyRequest: true,
        paymentRequest: current,
      };
    }
    const error = new Error(data?.message || 'Failed to cancel previous QR payment request');
    error.status = response.status;
    error.details = data;
    error.code = data?.error_code || 'XENDIT_QR_CANCEL_FAILED';
    throw error;
  }

  return { cancelled: true, alreadyTerminal: false, paymentRequest: data };
};

export const isPaymentRequestPaid = (paymentRequest) => {
  const status = String(paymentRequest?.status || '').toUpperCase();
  return status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'PAID';
};

export const qrStringToDataUrl = async (qrString) => {
  return QRCode.toDataURL(String(qrString), {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 280,
    margin: 2,
    color: {
      dark: '#0E5FA8',
      light: '#FFFFFF',
    },
  });
};

export const paymentUrlToDataUrl = async (paymentUrl) => {
  return QRCode.toDataURL(String(paymentUrl), {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 280,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
};
