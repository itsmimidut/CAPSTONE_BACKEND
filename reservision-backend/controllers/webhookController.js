import db from '../config/db.js';
import { sendBookingConfirmationEmail } from '../services/emailService.js';

/**
 * ============================================================
 * PAYMONGO WEBHOOK HANDLER
 * ============================================================
 * 
 * Receives webhook events from PayMongo when:
 * - Payment link is paid
 * - Payment is completed
 * - Payment fails
 * 
 * Updates booking status in database based on payment outcome
 */

export const handlePayMongoWebhook = async (req, res) => {
    try {
        const event = req.body;

        // Log webhook event for debugging
        console.log('🪝 PayMongo Webhook Received:', {
            type: event.type,
            data_type: event.data?.type,
            id: event.data?.id
        });

        // Verify webhook signature (optional but recommended)
        // For now, we'll process all events - add signature verification later

        const data = event.data?.attributes;

        if (!data) {
            console.warn('⚠️  No event data found in webhook');
            return res.json({ received: true });
        }

        // Handle different event types
        if (event.type === 'link.payment.paid' || event.type === 'payment.paid') {
            await handlePaymentSuccess(data, event);
        } else if (event.type === 'payment.failed') {
            await handlePaymentFailed(data, event);
        } else {
            console.log('ℹ️  Unhandled event type:', event.type);
        }

        // Always return 200 to acknowledge receipt
        res.json({ received: true });

    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
};

/**
 * Handle successful payment
 */
async function handlePaymentSuccess(data, event) {
    try {
        const remarks = data.remarks || event.data?.id;
        const amount = data.amount ? data.amount / 100 : null; // Convert from centavos
        const paymentMethod = data.source?.type || data.payment_method_type || 'unknown';

        console.log('✅ Payment Successful:');
        console.log('   Remarks (Booking/Transaction ID):', remarks);
        console.log('   Amount: ₱' + (amount || 'unknown'));
        console.log('   Payment Method:', paymentMethod);

        // Update booking status to "paid"
        const [bookings] = await db.query(
            `SELECT b.*, u.email FROM bookings b
       JOIN user u ON b.user_id = u.user_id
       WHERE b.booking_reference = ? OR b.id = ?`,
            [remarks, remarks]
        );

        if (bookings.length > 0) {
            const booking = bookings[0];

            // Update booking status to 'confirmed'
            await db.query(
                `UPDATE bookings 
         SET booking_status = 'confirmed', 
             payment_status = 'paid',
             updated_at = NOW()
         WHERE id = ?`,
                [booking.id]
            );

            console.log('✅ Booking confirmed:', booking.id, booking.booking_reference);

            // Send confirmation email
            try {
                await sendBookingConfirmationEmail({
                    email: booking.email,
                    firstName: booking.first_name || '',
                    lastName: booking.last_name || '',
                    bookingReference: booking.booking_reference,
                    checkIn: booking.check_in_date,
                    checkOut: booking.check_out_date,
                    items: [],
                    total: booking.total_amount || booking.total || 0
                });
                console.log('📧 Confirmation email sent to:', booking.email);
            } catch (emailError) {
                console.warn('⚠️  Failed to send confirmation email:', emailError.message);
            }
        } else {
            console.log('⚠️  No booking found for remarks:', remarks);
        }

    } catch (error) {
        console.error('❌ Error handling payment success:', error);
    }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(data, event) {
    try {
        const remarks = data.remarks || event.data?.id;
        const failureReason = data.failure_reason || 'Unknown reason';

        console.log('❌ Payment Failed:');
        console.log('   Remarks (Booking/Transaction ID):', remarks);
        console.log('   Reason:', failureReason);

        // Update booking status to "payment_failed"
        const [bookings] = await db.query(
            `SELECT b.* FROM bookings b
       WHERE b.booking_reference = ? OR b.id = ?`,
            [remarks, remarks]
        );

        if (bookings.length > 0) {
            const booking = bookings[0];

            // Update booking status to 'payment_failed'
            await db.query(
                `UPDATE bookings 
         SET booking_status = 'payment_failed',
             payment_status = 'failed',
             updated_at = NOW()
         WHERE id = ?`,
                [booking.id]
            );

            console.log('📝 Booking marked as payment failed:', booking.id);
        }

    } catch (error) {
        console.error('❌ Error handling payment failure:', error);
    }
}
