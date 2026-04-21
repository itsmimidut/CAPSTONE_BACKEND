import fetch from 'node-fetch';
import dotenv from 'dotenv';
import db from '../config/db.js';
import { sendBookingConfirmationWithQR } from '../services/emailService.js';
import { generateQRCode, formatBookingDataForQR } from '../services/qrCodeService.js';

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

    // Validate required fields
    if (!amount || !description || !bookingId) {
      return res.status(400).json({
        error: 'Missing required fields: amount, description, bookingId'
      });
    }

    console.log('🔑 Creating PayMongo payment link for:', bookingId);
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
    const selectedMethods = paymentMethod && paymentMethodMap[paymentMethod]
      ? [paymentMethodMap[paymentMethod]]
      : ['gcash', 'paymaya', 'card', 'grab_pay'];

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Create payment link with success/cancel redirects
    const paymentLinkData = {
      data: {
        attributes: {
          amount: amountInCentavos,
          description: description,
          remarks: bookingId,
          // Use customer's selected payment method
          payment_method_types: selectedMethods,
          // Redirect to payment verification page (will check status and auto-redirect to confirmation)
          success_url: `${frontendUrl}/payment-return?bookingId=${bookingId}`,
          cancel_url: `${frontendUrl}/booking-confirmation?cancelled=true&bookingId=${bookingId}`,
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

    const response = await fetch(`${PAYMONGO_API_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY).toString('base64')}`
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
      redirect_url: `${frontendUrl}/booking?bookingId=${bookingId}&reference=${data.data.attributes.reference_number}`
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
        'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY).toString('base64')}`
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
        'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY).toString('base64')}`
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
        // Update booking as paid and confirmed
        await db.query(
          'UPDATE bookings SET payment_status = ?, payment_method = ?, booking_status = ?, updated_at = NOW() WHERE booking_id = ?',
          ['Paid', paymentMethod, 'Confirmed', bookingId]
        );

        console.log('✅ Booking confirmed as paid:', bookingId, 'with method:', paymentMethod);

        // Log for swimming bookings
        const [swimmingItems] = await db.query(
          'SELECT * FROM booking_items WHERE booking_id = ? AND (item_type = ? OR item_type = ?)',
          [bookingId, 'Swimming', 'Swimming Lesson']
        );

        if (swimmingItems.length > 0) {
          console.log(`🏊 Swimming booking confirmed! Booking ID: ${bookingId}, Reference: ${referenceNumber}`);
        }

        // Send confirmation email with QR code
        try {
          const [bookings] = await db.query(
            `SELECT b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date, b.total,
                    u.first_name, u.last_name, u.email
             FROM bookings b
             LEFT JOIN customers c ON b.customer_id = c.customer_id
             LEFT JOIN user u ON c.user_id = u.user_id
             WHERE b.booking_id = ?`,
            [bookingId]
          );

          if (bookings.length > 0) {
            const booking = bookings[0];

            const [items] = await db.query(
              `SELECT bi.quantity AS qty, bi.unit_price AS price, i.name, i.category
               FROM booking_items bi
               LEFT JOIN inventory_items i ON bi.inventory_item_id = i.item_id
               WHERE bi.booking_id = ?`,
              [bookingId]
            );

            let qrCodeData = null;
            try {
              const formattedQRData = formatBookingDataForQR(
                {
                  booking_reference: booking.booking_reference,
                  first_name: booking.first_name,
                  last_name: booking.last_name
                },
                items.map(item => ({
                  item_name: item.name,
                  quantity: item.qty,
                  item_type: item.category || 'Room'
                }))
              );
              qrCodeData = await generateQRCode(formattedQRData);
            } catch (qrErr) {
              console.warn('⚠️ QR generation failed:', qrErr.message);
            }

            const emailData = {
              email: booking.email,
              firstName: booking.first_name,
              lastName: booking.last_name,
              bookingReference: booking.booking_reference,
              checkIn: booking.check_in_date,
              checkOut: booking.check_out_date,
              items: items.map(item => ({ name: item.name, qty: item.qty, price: item.price })),
              total: booking.total
            };

            await sendBookingConfirmationWithQR(emailData, qrCodeData?.base64 || null);
            console.log('✅ Confirmation email with QR sent for booking:', bookingId);
          }
        } catch (emailErr) {
          console.warn('⚠️ Email sending failed after payment:', emailErr.message);
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
