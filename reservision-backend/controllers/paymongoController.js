import fetch from 'node-fetch';
import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API_URL = 'https://api.paymongo.com/v1';

export const createPaymentLink = async (req, res) => {
  try {
    // Validate API key
    if (!PAYMONGO_SECRET_KEY) {
      console.error('❌ PAYMONGO_SECRET_KEY is not configured in .env file');
      return res.status(500).json({
        error: 'Payment service not configured. Please contact administrator.'
      });
    }

    const {
      amount,
      description,
      bookingId,
      email,
      paymentMethod
    } = req.body;

    // Validate required fields (bookingId is optional for POS transactions)
    if (!amount || !description) {
      return res.status(400).json({
        error: 'Missing required fields: amount, description'
      });
    }

    // Use bookingId if provided, otherwise generate a reference for POS transactions
    const referenceId = bookingId ? String(bookingId) : `POS-${Date.now()}`;

    console.log('🔑 Creating PayMongo payment link for:', referenceId);
    console.log('💳 Selected payment method:', paymentMethod);

    // PayMongo uses centavos (amount * 100)
    const amountInCentavos = Math.round(amount * 100);

    // Map frontend payment method to PayMongo codes
    const paymentMethodMap = {
      'gcash': 'gcash',
      'paymaya': 'paymaya',
      'bank': 'billease',  // or use 'dob' for direct online banking
      'card': 'card'
    };

    // Get selected payment method or default to all
    // Always allow all payment methods - let customer choose on PayMongo page
    const selectedMethods = ['gcash', 'paymaya', 'card'];

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Create payment link with success/cancel redirects
    const paymentLinkData = {
      data: {
        attributes: {
          amount: amountInCentavos,
          description: description,
          remarks: referenceId,
          // Use customer's selected payment method
          payment_method_types: selectedMethods,
          // Redirect to payment verification page (will check status and auto-redirect to confirmation)
          success_url: `${frontendUrl}/payment-return?bookingId=${referenceId}`,
          cancel_url: `${frontendUrl}/booking-confirmation?cancelled=true&bookingId=${referenceId}`,
          line_items: [
            {
              name: description,
              amount: amountInCentavos,
              currency: 'PHP',
              quantity: 1
            }
          ]
        }
      }
    };

    console.log('🔐 PayMongo Secret Key Length:', PAYMONGO_SECRET_KEY?.length, 'Key starts with:', PAYMONGO_SECRET_KEY?.substring(0, 15));

    const response = await fetch(`${PAYMONGO_API_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
      },
      body: JSON.stringify(paymentLinkData)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ PayMongo API Error:', data);
      return res.status(response.status).json({
        error: data.errors?.[0]?.detail || 'Failed to create payment link',
        details: data
      });
    }

    console.log('✅ Payment link created successfully');

    // Return payment link details with custom redirect instruction
    res.json({
      success: true,
      checkout_url: data.data.attributes.checkout_url,
      reference_number: data.data.attributes.reference_number,
      payment_id: data.data.id,
      amount: amount,
      status: data.data.attributes.status,
      // Add redirect URL for frontend to use after payment
      redirect_url: `${frontendUrl}/booking?bookingId=${referenceId}&reference=${data.data.attributes.reference_number}`
    });

  } catch (error) {
    console.error('❌ PayMongo Payment Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

export const createPaymentIntent = async (req, res) => {
  try {
    if (!PAYMONGO_SECRET_KEY) {
      return res.status(500).json({
        error: 'Payment service not configured.'
      });
    }

    const {
      amount,
      description,
      paymentMethod,
      email
    } = req.body;

    if (!amount || !description) {
      return res.status(400).json({
        error: 'Missing required fields: amount, description'
      });
    }

    const amountInCentavos = Math.round(amount * 100);

    // Create payment intent
    const paymentIntentData = {
      data: {
        attributes: {
          amount: amountInCentavos,
          payment_method_allowed: [paymentMethod || 'card'],
          payment_method_options: {
            card: {
              request_three_d_secure: 'any'
            }
          },
          currency: 'PHP',
          description: description,
          statement_descriptor: 'Eduardo\'s Resort'
        }
      }
    };

    const response = await fetch(`${PAYMONGO_API_URL}/payment_intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
      },
      body: JSON.stringify(paymentIntentData)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.errors?.[0]?.detail || 'Failed to create payment intent',
        details: data
      });
    }

    res.json({
      success: true,
      payment_intent_id: data.data.id,
      client_key: data.data.attributes.client_key,
      status: data.data.attributes.status
    });

  } catch (error) {
    console.error('Payment Intent Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const response = await fetch(`${PAYMONGO_API_URL}/links/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to get payment status',
        details: data
      });
    }

    const status = data.data.attributes.status;
    const payments = data.data.attributes.payments || [];
    const isPaid = payments.length > 0 && payments[0].attributes.status === 'paid';

    res.json({
      success: true,
      status: status,
      isPaid: isPaid,
      amount: data.data.attributes.amount / 100,
      reference_number: data.data.attributes.reference_number,
      payments: payments
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
    const event = req.body;

    console.log('📨 PayMongo Webhook Received:', {
      type: event.data?.attributes?.type,
      status: event.data?.attributes?.data?.attributes?.status
    });

    // Log full event data for debugging
    console.log('🔍 Full webhook data:', JSON.stringify(event, null, 2));

    const eventType = event.data?.attributes?.type;

    if (eventType === 'link.payment.paid') {
      const paymentLink = event.data.attributes.data.attributes;
      const bookingId = paymentLink.remarks;
      const referenceNumber = paymentLink.reference_number;
      const amount = paymentLink.amount / 100;

      // Get actual payment method from payments array
      const payments = paymentLink.payments || [];
      console.log('💳 Payments array:', JSON.stringify(payments, null, 2));

      let paymentMethod = 'Online Payment';

      if (payments.length > 0) {
        // Correct path: payments[0].data.attributes.source.type
        const paymentAttributes = payments[0].data?.attributes || {};
        const paymentType = paymentAttributes.source?.type || 'unknown';

        console.log('💳 Detected payment type:', paymentType);

        // Map PayMongo payment types to readable names
        const methodMap = {
          'gcash': 'GCash',
          'paymaya': 'PayMaya',
          'grab_pay': 'GrabPay',
          'grab': 'GrabPay',
          'card': 'Card Payment',
          'billease': 'BillEase'
        };
        paymentMethod = methodMap[paymentType.toLowerCase()] || paymentType;
      }

      console.log('💰 Payment successful:', {
        bookingId: bookingId,
        reference: referenceNumber,
        amount: amount,
        method: paymentMethod
      });

      try {
        // Mark payment as paid; booking stays pending until admin approval.
        await db.query(
          'UPDATE bookings SET payment_status = ?, payment_method = ?, updated_at = NOW() WHERE booking_id = ?',
          ['Paid', paymentMethod, bookingId]
        );

        await db.query(
          `INSERT INTO booking_logs (booking_id, action, description, performed_by)
           VALUES (?, 'Payment Received', ?, 'PayMongo Webhook')`,
          [bookingId, `Payment settled via ${paymentMethod}. Awaiting admin approval.`]
        );

        console.log('✅ Booking payment marked as paid (awaiting admin approval):', bookingId, 'with method:', paymentMethod);

        // Log for swimming bookings
        const [swimmingItems] = await db.query(
          'SELECT * FROM booking_items WHERE booking_id = ? AND (item_type = ? OR item_type = ?)',
          [bookingId, 'Swimming', 'Swimming Lesson']
        );

        if (swimmingItems.length > 0) {
          console.log(`🏊 Swimming booking paid and pending approval. Booking ID: ${bookingId}, Reference: ${referenceNumber}`);
        }

      } catch (dbError) {
        console.error('❌ Error updating booking:', dbError);
      }

    } else if (eventType === 'payment.paid') {
      const payment = event.data.attributes.data.attributes;
      console.log('✅ Payment confirmed:', {
        amount: payment.amount / 100,
        payment_id: payment.id
      });
    } else if (eventType === 'source.chargeable') {
      // Legacy Sources flow (kept for backwards compatibility)
      const source = event.data.attributes.data;
      const sourceId = source.id;
      const amountCentavos = source.attributes.amount;
      const metadata = source.attributes.metadata || {};
      const bookingId = metadata.booking_id;

      console.log(`💳 source.chargeable: ${sourceId} → booking ${bookingId}`);

      if (!bookingId) {
        console.log('⚠️ source.chargeable received without booking_id in metadata');
      } else {
        try {
          // Create a PayMongo payment from the chargeable source
          const paymentPayload = {
            data: {
              attributes: {
                amount: amountCentavos,
                source: { id: sourceId, type: 'source' },
                currency: 'PHP',
                description: `QR Ph – Booking ${bookingId}`
              }
            }
          };

          const payRes = await fetch(`${PAYMONGO_API_URL}/payments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
            },
            body: JSON.stringify(paymentPayload)
          });

          const payResult = await payRes.json();
          if (!payRes.ok) {
            console.error('❌ Failed to create payment from QR Ph source:', payResult);
          } else {
            console.log('✅ Payment created from QR Ph source:', payResult.data?.id);
          }

          // Mark booking as paid regardless (source chargeable = user authorized)
          await db.query(
            'UPDATE bookings SET payment_status = ?, payment_method = ?, updated_at = NOW() WHERE booking_id = ?',
            ['Paid', 'QR Ph', bookingId]
          );

          await db.query(
            `INSERT INTO booking_logs (booking_id, action, description, performed_by)
             VALUES (?, 'Payment Received', ?, 'PayMongo Webhook')`,
            [bookingId, `QR Ph payment authorized. Source: ${sourceId}. Awaiting admin approval.`]
          );

          console.log(`✅ QR Ph booking ${bookingId} marked as Paid`);
        } catch (dbError) {
          console.error('❌ Error processing source.chargeable:', dbError);
        }
      }

    } else if (eventType === 'payment.failed') {
      console.log('❌ Payment failed');
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook Error:', error);
    // Still return 200 to prevent retries
    res.status(200).json({ received: false, error: error.message });
  }
};


