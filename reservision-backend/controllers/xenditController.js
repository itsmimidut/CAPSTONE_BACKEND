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

    // Validate required fields
    if (!amount || !email || !bookingId || !customerName) {
      return res.status(400).json({ 
        error: 'Missing required fields: amount, email, bookingId, customerName' 
      });
    }

    console.log('🔑 Using API key:', XENDIT_API_KEY?.substring(0, 20) + '...');

    // Create invoice with Xendit (simplified for test accounts)
    const invoiceData = {
      external_id: bookingId,
      amount: amount,
      payer_email: email,
      description: description || `Booking Payment - ${bookingId}`,
      customer: {
        given_names: customerName,
        email: email
      },
      currency: 'PHP',
      success_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/booking?bookingId=${bookingId}&status=success`,
      failure_redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/booking-confirmation?status=failed`
    };

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
      console.error('Xendit API Error:', data);
      return res.status(response.status).json({
        error: data.message || 'Failed to create payment',
        details: data
      });
    }

    // Return payment URL and invoice details
    res.json({
      success: true,
      invoice_url: data.invoice_url,
      invoice_id: data.id,
      external_id: data.external_id,
      status: data.status,
      amount: data.amount,
      expiry_date: data.expiry_date
    });

  } catch (error) {
    console.error('Xendit Payment Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
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
      return res.status(response.status).json({
        error: 'Failed to get payment status',
        details: data
      });
    }

    res.json({
      success: true,
      status: data.status,
      paid_at: data.paid_at,
      amount: data.amount,
      external_id: data.external_id
    });

  } catch (error) {
    console.error('Get Payment Status Error:', error);
    res.status(500).json({
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
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const payment = req.body;
    
    console.log('Xendit Webhook Received:', {
      external_id: payment.external_id,
      status: payment.status,
      paid_at: payment.paid_at
    });

    // TODO: Update booking status in database based on payment status
    // Example:
    // if (payment.status === 'PAID') {
    //   await db.query('UPDATE bookings SET payment_status = ? WHERE booking_id = ?', 
    //     ['paid', payment.external_id]);
    // }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};
