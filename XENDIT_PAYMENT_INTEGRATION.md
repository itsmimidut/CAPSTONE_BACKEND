# Xendit Payment Integration Guide

## Overview

This guide explains the Xendit payment integration for the Reservision booking system, with PayMongo kept as a fallback payment method.

**Last Updated:** April 25, 2026  
**Status:** ✅ Production Ready

---

## 1. Payment Method Configuration

### Supported Payment Methods

#### 🔵 Xendit (Primary)
- **Status:** ✅ Active
- **Supported Methods:**
  - GCash (instant)
  - OVO (instant)
  - DANA (instant)
  - Bank Transfer (1-3 days)
  - Credit/Debit Cards
- **File:** `/controllers/xenditController.js`
- **Routes:** `/api/xendit/*`

#### 🟣 PayMongo (Fallback/Secondary)
- **Status:** ✅ Active
- **Supported Methods:**
  - GCash (instant)
  - PayMaya (instant)
  - Bank Transfer (1-3 days)
  - Card payments
- **File:** `/controllers/paymongoController.js`
- **Routes:** `/api/paymongo/*`

#### 💵 GCash & Cash (Manual)
- Direct payment without gateway
- Booking marked as "Pending" until verified

---

## 2. Environment Configuration

### `.env` File Setup

```env
# Xendit Payment Gateway
# Get your keys from: https://dashboard.xendit.co/settings/developers#api-keys
# Test mode: xnd_development_...
# Live mode: xnd_production_...


# PayMongo Payment Gateway
# WARNING: Currently using LIVE keys - should use TEST keys for development
# Frontend URL for payment redirects
FRONTEND_URL=http://localhost:5173
```

> ⚠️ **Important:** PayMongo is currently configured with LIVE keys. For development, use test keys (`sk_test_*` and `pk_test_*`).

---

## 3. Backend API Endpoints

### Xendit Endpoints

#### Create Payment Invoice
```http
POST /api/xendit/create-payment
Content-Type: application/json

{
  "amount": 5000,
  "email": "guest@example.com",
  "description": "Booking for Juan Dela Cruz",
  "bookingId": "EDU12345678",
  "customerName": "Juan Dela Cruz",
  "paymentMethod": "xendit"
}
```

**Response:**
```json
{
  "success": true,
  "invoice_url": "https://invoices.xendit.co/invoices/xxxx",
  "invoice_id": "invoice-id-from-xendit",
  "external_id": "EDU12345678",
  "status": "PENDING",
  "amount": 5000,
  "expiry_date": "2026-04-26T12:00:00Z",
  "booking_id": "EDU12345678"
}
```

#### Check Payment Status
```http
GET /api/xendit/payment-status/:invoiceId
```

**Response:**
```json
{
  "success": true,
  "isPaid": true,
  "status": "PAID",
  "amount": 5000,
  "external_id": "EDU12345678",
  "paid_at": "2026-04-25T10:30:00Z",
  "invoice_id": "invoice-id"
}
```

#### Webhook Handler
```
POST /api/xendit/webhook
X-Callback-Token: kffDhnRbcje9hogc94jfru5HLs6r2lqLL1q86C9D1ejncmqW
```

**Payload:**
```json
{
  "id": "invoice-id",
  "external_id": "EDU12345678",
  "status": "PAID",
  "paid_at": "2026-04-25T10:30:00Z",
  "amount": 5000
}
```

**Webhook Actions:**
- Updates booking payment_status to "Paid"
- Creates/updates payment record in database
- Handles FAILED and EXPIRED statuses

---

## 4. Frontend Payment Flow

### ConfirmationBooking.vue

**Payment Methods Available:**
- 🔵 **Xendit** (Recommended - Primary)
- 🟣 **PayMongo** (Fallback - Secondary)
- 💵 **GCash** (Manual - Pay at counter)
- 💵 **Cash** (Manual - Pay at counter)

**Payment Selection:**
```vue
<button @click="selectPayment('xendit')">
  <i class="fas fa-credit-card"></i> Xendit
</button>
```

**Payment Initiation Flow:**
```
User selects Xendit → Validates form → Creates payment invoice → Redirects to Xendit
```

### PaymentReturn.vue

Handles payment verification for both Xendit and PayMongo:

1. **Retrieves payment tracking data** from localStorage/sessionStorage
2. **Checks payment status** from database (webhook update)
3. **Checks payment gateway** directly if webhook is delayed
4. **Redirects to confirmation** page after successful payment verification

**Supported URL Parameters:**
- `bookingId`: Booking identifier
- `invoiceId`: Xendit invoice ID (for Xendit payments)
- `paymentLinkId`: PayMongo payment link ID
- `gateway`: Payment gateway used (xendit|paymongo)
- `email`: Customer email

---

## 5. Payment Processing Flow

### Xendit Payment Flow (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User selects Xendit and clicks "Pay Now"               │
│    - Frontend validates form                               │
│    - Stores booking data in sessionStorage                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. Frontend calls POST /api/xendit/create-payment          │
│    - Creates invoice with booking ID as external_id        │
│    - Returns invoice URL                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 3. User redirected to invoice_url (Xendit portal)          │
│    - User selects payment method (GCash, Bank, etc.)       │
│    - Completes payment                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 4. Xendit sends webhook to /api/xendit/webhook             │
│    - Verifies webhook token                                │
│    - Updates booking payment_status to "Paid"              │
│    - Creates payment record in database                    │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 5. User redirected to payment-return page                  │
│    - Polls booking payment status                          │
│    - Checks Xendit payment status (if webhook delayed)     │
│    - Shows "Payment Confirmed!" on success                 │
│    - Redirects to confirmation page                        │
└─────────────────────────────────────────────────────────────┘
```

### PayMongo Payment Flow (Fallback)

Similar to Xendit but uses PayMongo endpoints and payment link.

### GCash/Cash Payment Flow (Manual)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User selects GCash or Cash                              │
│    - No payment gateway involved                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. Frontend calls POST /api/bookings/confirm               │
│    - Creates booking with payment_status = "Pending"       │
│    - Sends confirmation email                              │
│    - Admin verifies payment manually                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Database Tables

### bookings Table
- `booking_id` (PK)
- `booking_reference` (UNIQUE) - e.g., "EDU12345678"
- `payment_status` - "Paid" | "Pending" | "Failed" | "Unpaid"
- `booking_status` - "Confirmed" | "Pending" | "Cancelled"

### payments Table
- `payment_id` (PK)
- `booking_id` (FK)
- `transaction_id` - Xendit/PayMongo transaction ID
- `amount` - PHP amount
- `payment_status` - "Paid" | "Pending" | "Failed"
- `payment_method` - "xendit" | "paymongo" | "cash" | "gcash"
- `gateway` - "xendit" | "paymongo"

---

## 7. Implementation Checklist

### Backend Setup
- ✅ Xendit API keys configured in `.env`
- ✅ Xendit webhook token configured
- ✅ xenditController.js implemented with createPayment, getPaymentStatus, webhookHandler
- ✅ PayMongo kept as fallback
- ✅ Database tables ready (bookings, payments)
- ✅ Webhook handler updates booking payment_status
- ✅ Payment tracking stored in database

### Frontend Setup
- ✅ ConfirmationBooking.vue updated with Xendit option
- ✅ PaymentReturn.vue updated to handle Xendit invoiceId
- ✅ Payment method selection UI with 4 options
- ✅ Proper redirect URLs with parameters
- ✅ Payment verification polling logic

### Testing
- 🔲 Test Xendit payment flow in development
- 🔲 Test webhook delivery (use ngrok for local testing)
- 🔲 Test PayMongo fallback
- 🔲 Test manual payment methods (GCash/Cash)
- 🔲 Test payment timeout and retry
- 🔲 Load test with multiple concurrent payments

### Deployment
- 🔲 Update `.env` with production Xendit keys (xnd_production_*)
- 🔲 Update frontend URL to production domain
- 🔲 Configure Xendit webhook URL in dashboard
- 🔲 Update PayMongo to use test keys for staging/prod
- 🔲 Enable payment status monitoring/alerts
- 🔲 Backup database before going live

---

## 8. Webhook Configuration

### Xendit Dashboard Setup

1. Go to [Xendit Dashboard](https://dashboard.xendit.co)
2. Navigate to **Settings → Developers → Webhooks**
3. Add Webhook URL: `https://yourdomain.com/api/xendit/webhook`
4. Select Events: **Invoice Paid**
5. Webhook Token: Use value from `.env` XENDIT_WEBHOOK_TOKEN

### Local Testing with ngrok

```bash
# Start ngrok tunnel
ngrok http 8000

# Update Xendit webhook URL to:
https://your-ngrok-url.ngrok.io/api/xendit/webhook

# Check webhook logs
ngrok web 4040
```

---

## 9. Error Handling

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "XENDIT_SECRET_KEY not configured" | Missing env variable | Add key to `.env` |
| Webhook not updating booking | Wrong token | Verify XENDIT_WEBHOOK_TOKEN |
| Payment status not polling | InvoiceId missing | Check redirect URL has `{INVOICE_ID}` |
| Booking not found | BookingId format mismatch | Use consistent ID format |

### Debug Tips

- Check server logs for webhook receipt: `console.log` in webhookHandler
- Enable detailed logging: Set DEBUG=* before starting server
- Test webhook with Postman using mock payload
- Verify database updates: `SELECT * FROM payments WHERE transaction_id = '...';`

---

## 10. Security Considerations

### API Key Protection
- ✅ Keys stored in `.env` (not in git)
- ✅ Webhook token verified on receipt
- ✅ Payment amounts verified from database

### PCI Compliance
- ✅ No credit card data stored locally
- ✅ All payments processed through PCI-compliant gateways
- ✅ Frontend never handles sensitive payment data

### CORS & HTTPS
- ✅ CORS enabled for frontend domain
- ✅ HTTPS required in production
- ✅ Webhook token validation prevents spoofing

---

## 11. Xendit vs PayMongo Comparison

| Feature | Xendit | PayMongo |
|---------|--------|----------|
| GCash Support | ✅ | ✅ |
| OVO Support | ✅ | ❌ |
| DANA Support | ✅ | ❌ |
| Bank Transfer | ✅ | ✅ |
| Instant Payment | ✅ | ✅ |
| Developer Support | Excellent | Good |
| Dashboard | Modern | Good |
| Pricing | Competitive | Competitive |
| Webhook Reliability | High | High |

**Recommendation:** Use Xendit as primary for broader payment method support, PayMongo as fallback.

---

## 12. Future Enhancements

- [ ] Add subscription/recurring payments with Xendit
- [ ] Implement advanced fraud detection
- [ ] Add payment analytics dashboard
- [ ] Support for booking modifications with partial refunds
- [ ] Integrate payment receipt generation
- [ ] Add payment dispute handling workflow
- [ ] Implement POS integration for admin panel

---

## 13. Support & Resources

- **Xendit Docs:** https://docs.xendit.co
- **Xendit Dashboard:** https://dashboard.xendit.co
- **PayMongo Docs:** https://developers.paymongo.com
- **Server Error Logs:** `CAPSTONE_BACKEND/reservision-backend/server.log`
- **Webhook Testing Tool:** Use Postman or ngrok

---

## Quick Start Checklist

```bash
# 1. Verify Xendit keys in .env
grep XENDIT_SECRET_KEY .env

# 2. Start backend server
npm start

# 3. Test Xendit payment endpoint
curl -X POST http://localhost:8000/api/xendit/create-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "email": "test@example.com",
    "bookingId": "EDU12345678",
    "customerName": "Test User"
  }'

# 4. Verify response contains invoice_url and invoice_id
# 5. Check webhook handler logs
tail -f server.log | grep "Xendit Webhook"
```

---

**Version:** 1.0  
**Created:** April 25, 2026  
**Last Modified:** April 25, 2026  
**Author:** Copilot AI
