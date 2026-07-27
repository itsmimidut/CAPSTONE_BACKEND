import dotenv from 'dotenv';
dotenv.config();

import { Resend } from 'resend';
import * as SibApiV3Sdk from '@getbrevo/brevo';

const testTo = process.argv[2] || process.env.EMAIL_TEST_TO || process.env.BREVO_FROM_EMAIL;

if (!testTo) {
  console.error('Usage: node scripts/test-email-services.mjs <recipient@email.com>');
  process.exit(1);
}

console.log('Testing email delivery to:', testTo);
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'set' : 'MISSING');
console.log('BREVO_API_KEY:', process.env.BREVO_API_KEY ? 'set' : 'MISSING');
console.log('BREVO_FROM_EMAIL:', process.env.BREVO_FROM_EMAIL || 'MISSING');

async function testResend() {
  if (!process.env.RESEND_API_KEY) {
    console.log('\n[Resend] SKIP - no API key');
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const result = await resend.emails.send({
      from: `Eduardo's Resort <${process.env.RESEND_FROM_EMAIL || 'bookings@resend.dev'}>`,
      to: testTo,
      subject: 'Reservision Resend test',
      html: '<p>Resend test from Reservision backend</p>',
    });
    console.log('\n[Resend] OK:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n[Resend] FAILED:', error.message);
    if (error.response?.data) console.error('  details:', error.response.data);
  }
}

async function testBrevo() {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_FROM_EMAIL) {
    console.log('\n[Brevo] SKIP - missing key or from email');
    return;
  }
  const api = new SibApiV3Sdk.TransactionalEmailsApi();
  api.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  try {
    const result = await api.sendTransacEmail({
      sender: {
        email: process.env.BREVO_FROM_EMAIL,
        name: process.env.BREVO_FROM_NAME || "Eduardo's Resort",
      },
      to: [{ email: testTo }],
      subject: 'Reservision Brevo test',
      htmlContent: '<p>Brevo test from Reservision backend</p>',
    });
    console.log('\n[Brevo] OK:', JSON.stringify(result, null, 2));
  } catch (error) {
    const msg = error?.response?.data?.message || error?.body?.message || error.message;
    console.error('\n[Brevo] FAILED:', msg);
    if (error?.response?.data) console.error('  details:', error.response.data);
  }
}

await testResend();
await testBrevo();
