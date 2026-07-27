import { Resend } from 'resend';
import * as SibApiV3Sdk from '@getbrevo/brevo';
import db from '../config/db.js';

/**
 * ============================================================
 * EMAIL SERVICE - BREVO (primary) & RESEND (fallback)
 * ============================================================
 * Brevo is preferred when BREVO_API_KEY + BREVO_FROM_EMAIL are set.
 * Resend is used only as fallback; its sandbox sender cannot reach arbitrary inboxes.
 */

let resend = null;
let brevoApi = null;

function getResendClient() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const isBrevoConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);

function getBrevoApi() {
  if (!brevoApi) {
    brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();
    brevoApi.setApiKey(
      SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY,
    );
  }
  return brevoApi;
}

const getSender = () => ({
  email: process.env.BREVO_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'bookings@resend.dev',
  name: process.env.BREVO_FROM_NAME || "Eduardo's Resort",
});

/**
 * Unified transactional email sender.
 */
export async function sendTransactionalEmail({ to, subject, html, text = undefined }) {
  if (!to) {
    throw new Error('Recipient email is required');
  }

  const sender = getSender();

  if (isBrevoConfigured()) {
    const result = await getBrevoApi().sendTransacEmail({
      sender: { email: sender.email, name: sender.name },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    });

    const messageId = result?.body?.messageId || result?.messageId;
    console.log(`✅ Email sent via Brevo to ${to} — ${subject} (${messageId || 'ok'})`);
    return { provider: 'brevo', messageId };
  }

  const resendClient = getResendClient();
  if (!resendClient) {
    throw new Error(
      'No email provider configured. Set BREVO_API_KEY + BREVO_FROM_EMAIL or RESEND_API_KEY in .env',
    );
  }

  const result = await resendClient.emails.send({
    from: `${sender.name} <${process.env.RESEND_FROM_EMAIL || 'bookings@resend.dev'}>`,
    to,
    subject,
    html,
    text,
  });

  if (result?.error) {
    throw new Error(result.error.message || 'Resend email failed');
  }

  console.log(`✅ Email sent via Resend to ${to} — ${subject}`);
  return { provider: 'resend', id: result?.data?.id };
}

/**
 * Resolve the best customer email for a booking.
 */
export async function resolveCustomerEmailForBooking(bookingId) {
  const [rows] = await db.query(
    `SELECT
      b.booking_id,
      b.booking_reference,
      b.check_in_date,
      b.check_out_date,
      b.total,
      COALESCE(NULLIF(TRIM(u.email), ''), NULLIF(TRIM(c.email), ''), NULLIF(TRIM(b.email), '')) AS email,
      COALESCE(u.first_name, c.first_name, 'Guest') AS first_name,
      COALESCE(u.last_name, c.last_name, '') AS last_name
     FROM bookings b
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     LEFT JOIN \`user\` u ON u.user_id = c.user_id
     WHERE b.booking_id = ?
     LIMIT 1`,
    [bookingId],
  );

  return rows[0] || null;
}

/**
 * Send OTP Verification Email
 * @param {string} email - Recipient email
 * @param {string} otpCode - 6-digit OTP code
 * @param {string} firstName - User's first name
 */
export async function sendOTPEmail(email, otpCode, firstName = 'Guest') {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2B6CB0 0%, #1D4A7A 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
              <div style="width: 60px; height: 60px; margin: 0 auto 16px; background-color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; color: #2B6CB0;">
                Ed
              </div>
              <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Eduardo's Resort</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Email Verification</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 16px; color: #1a202c; font-size: 24px; font-weight: 600;">Hi ${firstName}! 👋</h2>
              <p style="margin: 0 0 24px; color: #4a5568; font-size: 16px; line-height: 1.6;">
                Thank you for choosing Eduardo's Resort. To complete your booking, please verify your email address using the code below:
              </p>
              
              <!-- OTP Box -->
              <div style="background: linear-gradient(135deg, #EBF4FF 0%, #E0F2FE 100%); border: 2px solid #2B6CB0; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <p style="margin: 0 0 8px; color: #4a5568; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
                <div style="font-size: 36px; font-weight: 700; color: #2B6CB0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                  ${otpCode}
                </div>
                <p style="margin: 12px 0 0; color: #718096; font-size: 13px;">
                  <strong>⏰ Valid for 10 minutes</strong>
                </p>
              </div>
              
              <div style="background-color: #FFF7ED; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 8px; margin: 0 0 24px;">
                <p style="margin: 0; color: #92400E; font-size: 14px; line-height: 1.6;">
                  <strong>🔒 Security Note:</strong> Never share this code with anyone. Eduardo's Resort will never ask for your verification code via phone or email.
                </p>
              </div>
              
              <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
                If you didn't request this code, please ignore this email or contact us immediately.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F7FAFC; padding: 30px; border-radius: 0 0 16px 16px; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 12px; color: #718096; font-size: 13px; text-align: center;">
                Need help? Contact us at <a href="mailto:support@eduardos.com" style="color: #2B6CB0; text-decoration: none;">support@eduardos.com</a>
              </p>
              <p style="margin: 0; color: #A0AEC0; font-size: 12px; text-align: center;">
                © 2026 Eduardo's Resort. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    return await sendTransactionalEmail({
      to: email,
      subject: `${otpCode} is your verification code`,
      html: htmlContent,
      text: `Hi ${firstName}, Your verification code is: ${otpCode}. This code expires in 10 minutes. Never share this code with anyone.`,
    });
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw error;
  }
}

/**
 * Send Booking Confirmation Email
 * @param {Object} bookingData - Complete booking information
 */
export async function sendBookingConfirmationEmail(bookingData) {
  const {
    email,
    firstName = '',
    lastName = '',
    bookingReference = '',
    checkIn = '',
    checkOut = '',
    items = [],
    total = 0
  } = bookingData || {};

  const formatDate = (date) => date ? new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '';

  const itemsList = items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">
        <strong style="color: #2D3748;">${item.name}</strong><br>
        <span style="color: #718096; font-size: 13px;">Qty: ${item.qty} | Guests: ${item.guests || 0}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #2D3748; font-weight: 600;">
        ₱${(Number(item.price || 0) * Number(item.qty || 0)).toLocaleString()}
      </td>
    </tr>
  `).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Success Badge -->
          <tr>
            <td style="text-align: center; padding: 30px 30px 0;">
              <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 40px;">✓</span>
              </div>
            </td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px 30px 40px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #1a202c; font-size: 32px; font-weight: 700;">Booking Confirmed!</h1>
              <p style="margin: 0; color: #10B981; font-size: 16px; font-weight: 600;">Reference: ${bookingReference}</p>
            </td>
          </tr>
          
          <!-- Guest Info -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background: linear-gradient(135deg, #EBF4FF 0%, #E0F2FE 100%); border-radius: 12px; padding: 24px;">
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>Guest Name:</strong> ${firstName} ${lastName}
                </p>
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>Check-in:</strong> ${formatDate(checkIn)}
                </p>
                <p style="margin: 0; color: #4a5568; font-size: 14px;">
                  <strong>Check-out:</strong> ${formatDate(checkOut)}
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Booking Items -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <h3 style="margin: 0 0 16px; color: #1a202c; font-size: 18px;">Booking Details</h3>
              <table style="width: 100%; border-collapse: collapse; background-color: #F7FAFC; border-radius: 8px; overflow: hidden;">
                ${itemsList}
                <tr>
                  <td style="padding: 16px; text-align: right; font-weight: 700; color: #2B6CB0; font-size: 18px;" colspan="2">
                    Total: ₱${Number(total || 0).toLocaleString()}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Next Steps -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background-color: #FFF7ED; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 8px;">
                <p style="margin: 0 0 8px; color: #92400E; font-weight: 600;">📋 What's Next?</p>
                <ul style="margin: 0; padding-left: 20px; color: #92400E; font-size: 14px; line-height: 1.8;">
                  <li>Complete your payment to confirm this reservation</li>
                  <li>You'll receive a payment receipt via email</li>
                  <li>Check-in time: 2:00 PM | Check-out time: 12:00 PM</li>
                </ul>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F7FAFC; padding: 30px; border-radius: 0 0 16px 16px; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 12px; color: #718096; font-size: 13px; text-align: center;">
                Questions? Contact us at <a href="mailto:support@eduardos.com" style="color: #2B6CB0; text-decoration: none;">support@eduardos.com</a>
              </p>
              <p style="margin: 0; color: #A0AEC0; font-size: 12px; text-align: center;">
                © 2026 Eduardo's Resort. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    console.log('📤 Sending booking confirmation to:', email);
    return await sendTransactionalEmail({
      to: email,
      subject: `Booking Confirmed - ${bookingReference}`,
      html: htmlContent,
    });
  } catch (error) {
    console.error('Error sending booking confirmation email:', error);
    throw error;
  }
}

/**
 * Send Booking Approval Email (When Admin Confirms)
 * @param {string} email - Customer email
 * @param {object} bookingData - Booking details
 */
export async function sendBookingApprovalEmail(email, bookingData) {
  if (!email) {
    console.warn('⚠️ Approval email skipped: no recipient email');
    return null;
  }

  const {
    bookingReference,
    firstName,
    lastName,
    checkIn,
    checkOut,
    items = [],
    total
  } = bookingData;

  const formatDate = (date) => new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const itemsList = items.map(item => `
    <li style="color: #4a5568; font-size: 14px; line-height: 1.8;">
      <strong>${item.name}</strong> - Qty: ${item.qty}${item.guests ? ` | Guests: ${item.guests}` : ''}
    </li>
  `).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Approved</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Success Badge -->
          <tr>
            <td style="text-align: center; padding: 30px 30px 0;">
              <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                <span style="font-size: 40px; color: white;">✓</span>
              </div>
            </td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px 30px 40px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #1a202c; font-size: 32px; font-weight: 700;">Booking Approved!</h1>
              <p style="margin: 0; color: #10B981; font-size: 16px; font-weight: 600;">Reference: ${bookingReference}</p>
            </td>
          </tr>
          
          <!-- Welcome Message -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background: linear-gradient(135deg, #EBF4FF 0%, #E0F2FE 100%); border-radius: 12px; padding: 24px; text-align: center;">
                <h2 style="margin: 0 0 12px; color: #2B6CB0; font-size: 24px; font-weight: 700;">Welcome to Eduardo's Resort! 🏖️</h2>
                <p style="margin: 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                  Dear ${firstName} ${lastName},<br><br>
                  Your booking has been <strong>confirmed and approved</strong> by our team! We're excited to host you and can't wait to make your stay memorable.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Booking Details -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <h3 style="margin: 0 0 16px; color: #1a202c; font-size: 18px;">📅 Your Reservation</h3>
              <div style="background-color: #F7FAFC; border-radius: 8px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>Check-in:</strong> ${formatDate(checkIn)} at 2:00 PM
                </p>
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>Check-out:</strong> ${formatDate(checkOut)} at 12:00 PM
                </p>
                <p style="margin: 0; color: #4a5568; font-size: 14px;">
                  <strong>Total Amount:</strong> <span style="color: #2B6CB0; font-size: 18px; font-weight: 700;">₱${total ? total.toLocaleString() : 'N/A'}</span>
                </p>
              </div>
            </td>
          </tr>
          
          ${items.length > 0 ? `
          <!-- Items List -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <h3 style="margin: 0 0 16px; color: #1a202c; font-size: 18px;">🏠 What You Booked</h3>
              <ul style="margin: 0; padding-left: 20px;">
                ${itemsList}
              </ul>
            </td>
          </tr>
          ` : ''}
          
          <!-- Important Info -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background-color: #DBEAFE; border-left: 4px solid #2B6CB0; padding: 16px; border-radius: 8px;">
                <p style="margin: 0 0 8px; color: #1E40AF; font-weight: 600;">📋 Important Information</p>
                <ul style="margin: 0; padding-left: 20px; color: #1E40AF; font-size: 14px; line-height: 1.8;">
                  <li>Please bring a valid ID for check-in</li>
                  <li>Early check-in subject to availability</li>
                  <li>Cancellation policy: 24 hours before check-in</li>
                </ul>
              </div>
            </td>
          </tr>
          
          <!-- See You Soon -->
          <tr>
            <td style="padding: 0 30px 30px; text-align: center;">
              <div style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 12px; padding: 24px;">
                <p style="margin: 0; color: #92400E; font-size: 20px; font-weight: 700;">
                  ✨ See you soon! ✨
                </p>
                <p style="margin: 8px 0 0; color: #92400E; font-size: 14px;">
                  We're preparing everything to make your stay perfect!
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F7FAFC; padding: 30px; border-radius: 0 0 16px 16px; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 12px; color: #718096; font-size: 13px; text-align: center;">
                Need assistance? Contact us at <a href="mailto:support@eduardos.com" style="color: #2B6CB0; text-decoration: none;">support@eduardos.com</a>
              </p>
              <p style="margin: 0; color: #A0AEC0; font-size: 12px; text-align: center;">
                © 2026 Eduardo's Resort. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    console.log('📤 Sending booking approval email to:', email);
    return await sendTransactionalEmail({
      to: email,
      subject: `✓ Booking Approved - Welcome to Eduardo's Resort! (${bookingReference})`,
      html: htmlContent,
    });
  } catch (error) {
    const errorMsg = error?.response?.data?.message || error?.message || 'Unknown error';
    console.error('❌ Error sending booking approval email:', errorMsg);
    return null;
  }
}

/**
 * Send Booking Confirmation Email with QR Code
 * @param {Object} bookingData - Complete booking information
 * @param {string} qrCodeBase64 - Base64 encoded QR code image
 */
export async function sendBookingConfirmationWithQR(bookingData, qrCodeBase64) {
  const {
    email,
    firstName,
    lastName,
    bookingReference,
    checkIn,
    checkOut,
    items,
    total
  } = bookingData;

  const formatDate = (date) => new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const itemsList = items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">
        <strong style="color: #2D3748;">${item.name}</strong><br>
        <span style="color: #718096; font-size: 13px;">Qty: ${item.qty} | Guests: ${item.guests}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #2D3748; font-weight: 600;">
        ₱${(item.price * item.qty).toLocaleString()}
      </td>
    </tr>
  `).join('');

  const qrCodeSection = qrCodeBase64 ? `
          <!-- QR Code Section -->
          <tr>
            <td style="padding: 0 30px 30px; text-align: center;">
              <div style="background: linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%); border-radius: 12px; padding: 24px; border: 2px solid #0EA5E9;">
                <h3 style="margin: 0 0 16px; color: #0369A1; font-size: 16px; font-weight: 600;">📱 Your Booking QR Code</h3>
                <img src="${qrCodeBase64}" alt="Booking QR Code" style="width: 220px; height: 220px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);" />
                <p style="margin: 12px 0 0; color: #0369A1; font-size: 12px; line-height: 1.6;">
                  <strong>📷 Save or screenshot this QR code</strong><br>
                  Show this at check-in or scan to view your booking details
                </p>
              </div>
            </td>
          </tr>
  ` : '';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Success Badge -->
          <tr>
            <td style="text-align: center; padding: 30px 30px 0;">
              <div style="width: 80px; height: 80px; margin: 0 auto; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 40px;">✓</span>
              </div>
            </td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px 30px 40px; text-align: center;">
              <h1 style="margin: 0 0 8px; color: #1a202c; font-size: 32px; font-weight: 700;">Payment Received!</h1>
              <p style="margin: 0; color: #10B981; font-size: 16px; font-weight: 600;">Reference: ${bookingReference}</p>
              <p style="margin: 12px 0 0; color: #4a5568; font-size: 14px;">Your reservation is pending admin approval. You will receive another email once confirmed.</p>
            </td>
          </tr>
          
          <!-- Guest Info -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background: linear-gradient(135deg, #EBF4FF 0%, #E0F2FE 100%); border-radius: 12px; padding: 24px;">
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>👤 Guest Name:</strong> ${firstName} ${lastName}
                </p>
                <p style="margin: 0 0 12px; color: #4a5568; font-size: 14px;">
                  <strong>📅 Check-in:</strong> ${checkIn ? formatDate(checkIn) : 'N/A'}
                </p>
                <p style="margin: 0; color: #4a5568; font-size: 14px;">
                  <strong>📅 Check-out:</strong> ${checkOut ? formatDate(checkOut) : 'N/A'}
                </p>
              </div>
            </td>
          </tr>

          ${qrCodeSection}
          
          <!-- Booking Items -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <h3 style="margin: 0 0 16px; color: #1a202c; font-size: 18px;">📋 Booking Details</h3>
              <table style="width: 100%; border-collapse: collapse; background-color: #F7FAFC; border-radius: 8px; overflow: hidden;">
                ${itemsList}
                <tr>
                  <td style="padding: 16px; text-align: right; font-weight: 700; color: #2B6CB0; font-size: 18px;" colspan="2">
                    Total: ₱${total.toLocaleString()}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Important Info -->
          <tr>
            <td style="padding: 0 30px 30px;">
              <div style="background-color: #FFF7ED; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 8px;">
                <p style="margin: 0 0 8px; color: #92400E; font-weight: 600;">✨ Important Information</p>
                <ul style="margin: 0; padding-left: 20px; color: #92400E; font-size: 14px; line-height: 1.8;">
                  <li>Complete your payment to finalize the reservation</li>
                  <li>Standard check-in: 2:00 PM | Check-out: 12:00 PM</li>
                  <li>Cancellation allowed up to 24 hours before arrival</li>
                  <li>Bring a valid ID for check-in</li>
                </ul>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F7FAFC; padding: 30px; border-radius: 0 0 16px 16px; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 12px; color: #718096; font-size: 13px; text-align: center;">
                Questions? Contact us at <a href="mailto:support@eduardos.com" style="color: #2B6CB0; text-decoration: none;">support@eduardos.com</a>
              </p>
              <p style="margin: 0; color: #A0AEC0; font-size: 12px; text-align: center;">
                © 2026 Eduardo's Resort. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const result = await sendTransactionalEmail({
      to: email,
      subject: `Payment Received - ${bookingReference}`,
      html: htmlContent,
    });

    console.log(`✅ Booking confirmation email with QR sent to ${email}`);
    return result;
  } catch (error) {
    console.error('Error sending booking confirmation email with QR:', error);
    throw error;
  }
}

/**
 * Send refund processed email (Sprint 4.5)
 */
export async function sendRefundProcessedEmail({
  email,
  firstName = 'Guest',
  bookingReference,
  refundAmount,
  gatewayReference,
}) {
  if (!email) {
    console.warn('Refund email skipped: no recipient email');
    return null;
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background:#f3f4f6; padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="color:#0369a1;margin-top:0;">Your Refund Has Been Processed</h2>
    <p>Hi ${firstName},</p>
    <p>We have successfully processed your refund for Eduardo's Resort.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr><td style="padding:8px 0;color:#64748b;">Booking Reference</td><td style="padding:8px 0;"><strong>${bookingReference || 'N/A'}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Amount</td><td style="padding:8px 0;"><strong>₱${Number(refundAmount || 0).toLocaleString()}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Refund Reference</td><td style="padding:8px 0;"><strong>${gatewayReference || 'N/A'}</strong></td></tr>
    </table>
    <p style="color:#64748b;font-size:14px;">Funds may take a few business days to appear in your account depending on your payment provider.</p>
  </div>
</body>
</html>`;

  try {
    const result = await sendTransactionalEmail({
      to: email,
      subject: 'Your Refund Has Been Processed',
      html: htmlContent,
    });
    console.log(`✅ Refund processed email sent to ${email}`);
    return result;
  } catch (error) {
    console.error('Refund processed email failed:', error.message);
    return null;
  }
}

export default {
  sendTransactionalEmail,
  resolveCustomerEmailForBooking,
  sendOTPEmail,
  sendBookingConfirmationEmail,
  sendBookingConfirmationWithQR,
  sendBookingApprovalEmail,
  sendRefundProcessedEmail,
};
