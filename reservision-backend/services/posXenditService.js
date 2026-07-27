import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const XENDIT_API_KEY = process.env.XENDIT_SECRET_KEY;
const XENDIT_API_URL = 'https://api.xendit.co/v2/invoices';

export const buildPosExternalId = (receiptNo) => `pos:${receiptNo}`;

export const isPosExternalId = (externalId) => String(externalId || '').startsWith('pos:');

export const createPosGcashInvoice = async ({
    receiptNo,
    amount,
    email = 'pos@eduardos.com',
    description,
    customerName = 'POS Walk-in',
    successRedirectUrl,
    failureRedirectUrl,
}) => {
    if (!XENDIT_API_KEY) {
        throw new Error('Payment service not configured');
    }

    const roundedAmount = Math.round(Number(amount || 0));
    if (!roundedAmount || roundedAmount <= 0) {
        throw new Error('Invalid invoice amount');
    }

    const trimmedEmail = String(email || 'pos@eduardos.com').trim();
    const trimmedCustomerName = String(customerName || 'POS Walk-in').trim();
    const [givenName, ...otherNameParts] = trimmedCustomerName.split(' ').filter(Boolean);
    const surname = otherNameParts.join(' ');

    const invoiceData = {
        external_id: buildPosExternalId(receiptNo),
        amount: roundedAmount,
        payer_email: trimmedEmail,
        description: description || `Eduardo's Resort POS - ${receiptNo}`,
        currency: 'PHP',
        customer: {
            given_names: givenName || 'POS',
            ...(surname ? { surname } : {}),
            email: trimmedEmail,
        },
        payment_methods: ['GCASH'],
        success_redirect_url: successRedirectUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pos-payment-thank-you?posReceipt=${receiptNo}`,
        failure_redirect_url: failureRedirectUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pos-payment-thank-you?posReceipt=${receiptNo}&status=failed`,
    };

    const response = await fetch(XENDIT_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(invoiceData),
    });

    const invoice = await response.json();
    if (!response.ok) {
        throw new Error(invoice?.message || 'Failed to create Xendit invoice');
    }

    return {
        invoiceId: invoice.id,
        paymentReference: invoice.external_id,
        paymentUrl: invoice.invoice_url || invoice.checkout_url,
        amount: roundedAmount,
        status: invoice.status,
    };
};
