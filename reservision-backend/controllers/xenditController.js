import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const XENDIT_API_KEY = process.env.XENDIT_SECRET_KEY;
const XENDIT_API_URL = 'https://api.xendit.co/v2/invoices';

export const createPayment = async (req, res) => {
  try {
    // Validate API key is configured
    if (!XENDIT_API_KEY) {
      console.error('❌ XENDIT_SECRET_KEY is not configured in .env file');
      return res.status(500).json({
        error: 'Payment service not configured. Please contact administrator.'
      });
    }

    const {
      amount,
      email,
      description,
      bookingId,
      customerName,
      paymentMethod
    } = req.body;

    const selectedPaymentMethod = paymentMethod ? String(paymentMethod).trim() : 'xendit';

    // Validate required fields
    if (!amount || !email || !bookingId || !customerName) {
      return res.status(400).json({
        error: 'Missing required fields: amount, email, bookingId, customerName'
      });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount value. Amount must be a positive number.'
      });
    }

    const trimmedEmail = String(email).trim();
    const trimmedCustomerName = String(customerName).trim();
    const [givenName, ...otherNameParts] = trimmedCustomerName.split(' ').filter(Boolean);
    const surname = otherNameParts.join(' ');

    console.log('🔑 Using API key:', XENDIT_API_KEY?.substring(0, 20) + '...');

    // Create invoice with Xendit
    const invoiceData = {
      external_id: String(bookingId),
      amount: Math.round(parsedAmount),
      payer_email: trimmedEmail,
      description: description || `Booking Payment - ${bookingId}`,
      currency: 'PHP',
      customer: {
        given_names: givenName,
        ...(surname ? { surname } : {}),
        email: trimmedEmail
      },
      success_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-return?bookingId=${bookingId}&invoiceId={INVOICE_ID}&gateway=xendit`,
      failure_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-return?bookingId=${bookingId}&status=failed&gateway=xendit`
    };

    console.log('🔧 Xendit invoice payload:', JSON.stringify(invoiceData, null, 2));

    const response = await fetch(XENDIT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(XENDIT_API_KEY + ':').toString('base64')}`
      },
      body: JSON.stringify(invoiceData)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Xendit API Error:', JSON.stringify(data, null, 2));
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        console.error('Xendit validation details:', JSON.stringify(data.errors, null, 2));
      }
      return res.status(response.status).json({
        error: data.message || 'Failed to create payment',
        details: data
      });
    }

    console.log('✅ Xendit Invoice Created:', {
      invoice_id: data.id,
      external_id: data.external_id,
      status: data.status,
      amount: data.amount
    });

    // Update booking payment fields so booking row stays aligned with Xendit invoice
    try {
      import('../config/db.js').then(async (dbModule) => {
        const db = dbModule.default;

        await db.query(
          `UPDATE bookings
           SET payment_status = 'Pending',
               payment_method = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE booking_id = ?`,
          [selectedPaymentMethod, bookingId]
        );

        const [bookingRows] = await db.query(
          `SELECT booking_id, customer_id FROM bookings WHERE booking_id = ? LIMIT 1`,
          [bookingId]
        );

        if (bookingRows.length === 0) {
          throw new Error(`Booking not found for booking_id=${bookingId}`);
        }

        const booking = bookingRows[0];

        await db.query(
          `INSERT INTO payments (
              booking_id,
              customer_id,
              payment_reference,
              amount,
              payment_method,
              payment_gateway,
              status,
              currency,
              checkout_url,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              payment_gateway = VALUES(payment_gateway),
              payment_method = VALUES(payment_method),
              updated_at = CURRENT_TIMESTAMP`,
          [
            booking.booking_id,
            booking.customer_id,
            data.id,
            parsedAmount,
            selectedPaymentMethod,
            'xendit',
            'pending',
            'PHP',
            data.invoice_url || null
          ]
        );

        console.log('💾 Payment record created in database');
      }).catch(err => console.error('Error storing payment record:', err));
    } catch (dbError) {
      console.warn('⚠️ Warning: Could not store payment record:', dbError);
      // Don't fail the request - still return payment info
    }

    // Return payment URL and invoice details
    res.json({
      success: true,
      checkout_url: data.invoice_url,
      invoice_id: data.id,
      external_id: data.external_id,
      status: data.status,
      amount: data.amount,
      expiry_date: data.expiry_date,
      booking_id: bookingId
    });

  } catch (error) {
    console.error('Xendit Payment Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

export const getPaymentMethods = async (req, res) => {
  try {
    const methods = [
      { code: 'GCASH', label: 'GCash', description: 'Pay using GCash via Xendit' },
      { code: 'MAYA', label: 'Maya', description: 'Pay using Maya e-wallet' },
      { code: 'CARD', label: 'Credit / Debit Card', description: 'Pay using Visa, Mastercard, or JCB' },
      { code: 'QRPH', label: 'QRPH', description: 'Scan QRPH using your banking app' },
      { code: 'BANK_TRANSFER', label: 'Bank Transfer', description: 'Pay through bank transfer' }
    ];

    res.json({ success: true, data: methods });
  } catch (error) {
    console.error('Xendit Payment Methods Error:', error);
    res.status(500).json({ success: false, error: 'Failed to load payment methods' });
  }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const response = await fetch(`${XENDIT_API_URL}/${invoiceId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(XENDIT_API_KEY + ':').toString('base64')}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.warn('⚠️ Xendit status request failed:', {
        invoiceId,
        statusCode: response.status,
        body: data
      });
      return res.status(response.status).json({
        success: false,
        error: 'Failed to get payment status',
        details: data
      });
    }

    const isPaid = data.status === 'PAID';
    console.log('🔍 Xendit payment status fetched:', {
      invoiceId: data.id,
      external_id: data.external_id,
      status: data.status,
      isPaid,
      paid_at: data.paid_at
    });

    if (isPaid) {
      console.log('✅ Xendit payment confirmed for invoice:', data.id, 'booking external_id:', data.external_id);
    }

    res.json({
      success: true,
      isPaid,
      status: data.status,
      paid_at: data.paid_at,
      amount: data.amount,
      external_id: data.external_id,
      invoice_id: data.id
    });

  } catch (error) {
    console.error('Get Payment Status Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};

export const webhookHandler = async (req, res) => {
  try {
    const callbackToken = req.headers['x-callback-token'];

    // Verify webhook token (optional but recommended)
    if (process.env.XENDIT_WEBHOOK_TOKEN && callbackToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
      console.warn('⚠️ Xendit Webhook - Invalid token');
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const payment = req.body;

    console.log('🔔 Xendit Webhook Received:', {
      external_id: payment.external_id,
      status: payment.status,
      paid_at: payment.paid_at,
      amount: payment.amount,
      invoice_id: payment.id,
      external_id_type: typeof payment.external_id
    });

    // Update booking status in database based on payment status
    if (payment.status === 'PAID' && payment.external_id) {
      try {
        // Import db connection
        import('../config/db.js').then(async (dbModule) => {
          const db = dbModule.default;

          // Update booking payment status
          const [result] = await db.query(
            `UPDATE bookings SET 
              payment_status = ?, 
              booking_status = 'Confirmed',
              updated_at = CURRENT_TIMESTAMP 
            WHERE booking_reference = ? OR booking_id = ?`,
            ['Paid', payment.external_id, payment.external_id]
          );

          if (result.affectedRows === 0) {
            console.warn('⚠️ Xendit Webhook - No booking rows matched external_id or booking_id:', payment.external_id);
          } else {
            console.log('✅ Xendit Webhook - Booking marked Paid and Confirmed:', {
              external_id: payment.external_id,
              status: payment.status,
              invoice_id: payment.id,
              affected_rows: result.affectedRows
            });
          }

          // Also update or create payment record
          await db.query(
            `INSERT INTO payments (
                booking_id,
                customer_id,
                payment_reference,
                amount,
                payment_method,
                payment_gateway,
                status,
                currency,
                checkout_url,
                paid_at,
                created_at
              )
              SELECT booking_id, customer_id, ?, ?, payment_method, ?, ?, ?, ?, NOW(), NOW()
              FROM bookings
              WHERE booking_reference = ? OR booking_id = ?
              LIMIT 1
              ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                paid_at = VALUES(paid_at),
                payment_method = VALUES(payment_method),
                updated_at = CURRENT_TIMESTAMP`,
            [
              payment.id,
              payment.amount,
              'xendit',
              'paid',
              'PHP',
              null,
              payment.external_id,
              payment.external_id
            ]
          );

        }).catch(err => {
          console.error('❌ Error updating booking from Xendit webhook:', err);
        });
      } catch (dbError) {
        console.error('❌ Database error in Xendit webhook:', dbError);
        // Still return 200 to acknowledge webhook receipt
      }
    } else if (payment.status === 'EXPIRED' || payment.status === 'FAILED') {
      // Update booking status to payment failed
      try {
        import('../config/db.js').then(async (dbModule) => {
          const db = dbModule.default;

          const [result] = await db.query(
            `UPDATE bookings SET 
              payment_status = ?, 
              updated_at = CURRENT_TIMESTAMP 
            WHERE booking_reference = ? OR booking_id = ?`,
            ['Failed', payment.external_id, payment.external_id]
          );

          console.warn('⚠️ Xendit Payment Failed - Booking updated:', {
            external_id: payment.external_id,
            status: payment.status,
            affected_rows: result.affectedRows
          });

        }).catch(err => {
          console.error('❌ Error updating booking from Xendit webhook:', err);
        });
      } catch (dbError) {
        console.error('❌ Database error in Xendit webhook:', dbError);
      }
    } else {
      console.log('ℹ️ Xendit Webhook - Received unhandled payment status:', payment.status);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};
