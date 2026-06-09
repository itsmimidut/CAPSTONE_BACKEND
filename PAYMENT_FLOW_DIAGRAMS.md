# 🎯 Payment Integration Checklist & Flow Diagrams

## Quick Status Check

### ✅ What's Implemented
- [x] **Xendit Integration** - Full implementation with webhooks
- [x] **PayMongo Integration** - Full implementation with webhooks
- [x] **Booking Payment Flow** - Complete end-to-end
- [x] **Payment Status Tracking** - Database schema ready
- [x] **Email Confirmation** - QR code generation
- [x] **E-Shop POS Integration** - Payment URL storage
- [x] **Multiple Payment Methods** - GCash, PayMaya, Bank Transfer, Card

### ⚠️ Things to Review
- [ ] **PayMongo using LIVE key** - Should be test key during development
- [ ] **Webhook URLs configured** - Need to set in payment dashboard
- [ ] **Error handling edge cases** - Some scenarios not covered
- [ ] **Refund system** - Not yet implemented
- [ ] **Payment retry logic** - Needs implementation

### 📋 Setup Checklist

#### Backend Setup
- [x] Node.js/Express server running
- [x] MySQL database configured
- [x] Dependencies installed (node-fetch, etc.)
- [x] Payment controllers created
- [x] Routes mounted in server.js
- [ ] **TODO:** Configure Xendit webhook URL in dashboard
- [ ] **TODO:** Configure PayMongo webhook URL in dashboard
- [ ] **TODO:** Test payment flow end-to-end

#### API Configuration
- [x] Xendit API key in .env
- [x] PayMongo API key in .env
- [x] Frontend URL configured
- [ ] **TODO:** Switch PayMongo to test key (currently LIVE!)
- [ ] **TODO:** Webhook tokens configured

#### Database
- [x] `payments` table created
- [x] `bookings` table payment columns added
- [x] `booking_logs` table for audit trail
- [x] `pos_transactions` payment columns added
- [x] Indexes created for performance

#### Frontend (Vue.js)
- [x] BookingConfirmation.vue integration ready
- [ ] **TODO:** Wire up actual payment button to API
- [ ] **TODO:** Handle success/failure redirects
- [ ] **TODO:** Display payment status to user

---

## 🔄 Complete Payment Flow Diagrams

### Flow 1: Room Booking with Xendit Payment

```
┌─────────────────────────────────────────────────────────────┐
│                   CUSTOMER JOURNEY                          │
└─────────────────────────────────────────────────────────────┘

1. BROWSING & SELECTION
   ┌──────────────────────────────┐
   │ Customer browses available   │
   │ rooms for dates              │
   └──────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────┐
   │ Selects rooms & services     │
   │ (e.g., 2 rooms for 3 nights) │
   └──────────────────────────────┘
              │
              ▼

2. PROCEED TO CHECKOUT
   ┌──────────────────────────────┐
   │ Clicks "Proceed to Checkout" │
   │ Frontend displays:           │
   │ - Items                      │
   │ - Total price                │
   │ - Payment methods            │
   └──────────────────────────────┘
              │
              ▼

3. FILL GUEST INFORMATION
   ┌──────────────────────────────┐
   │ Guest Form:                  │
   │ - Name, Email, Phone         │
   │ - Address, City, Postal      │
   │ - Adults, Children           │
   │ - Special Requests           │
   └──────────────────────────────┘
              │
              ▼

4. SELECT PAYMENT METHOD
   ┌──────────────────────────────┐
   │ Choose:                      │
   │ ☐ GCash                      │
   │ ☐ PayMaya                    │
   │ ☐ Bank Transfer              │
   │ ☑ [Selected]                 │
   └──────────────────────────────┘
              │
              ▼

5. CLICK "PAY NOW"
   ┌──────────────────────────────┐
   │ Frontend validates form      │
   │ Shows loading spinner...     │
   └──────────────────────────────┘
              │
              ▼

┌─────────────────────────────────────────────────────────────┐
│                   BACKEND PROCESSING                        │
└─────────────────────────────────────────────────────────────┘

6. POST /api/bookings/confirm
   ┌──────────────────────────────────────────────────────┐
   │ Backend receives:                                    │
   │ {                                                    │
   │   guest: { name, email, phone, address, ... },      │
   │   checkIn: "2026-02-15",                            │
   │   checkOut: "2026-02-17",                           │
   │   items: [ { name, qty, price, ... } ],            │
   │   paymentMethod: "gcash",                           │
   │   total: 18500                                       │
   │ }                                                    │
   └──────────────────────────────────────────────────────┘
              │
              ▼

7. CREATE CUSTOMER & BOOKING
   ┌──────────────────────────────────────────────────────┐
   │ Database transactions:                               │
   │ 1. Get/Create customer                              │
   │ 2. Create booking record                            │
   │ 3. Add booking items                                │
   │ 4. Create payment record (status='pending')         │
   │ 5. Log actions in booking_logs                      │
   └──────────────────────────────────────────────────────┘
              │
              ▼
   ✅ Booking created with ID: 12345
   ✅ Payment created with status: 'pending'

8. RETURN BOOKING DETAILS
   ┌──────────────────────────────────────────────────────┐
   │ Response: {                                          │
   │   bookingId: 12345,                                  │
   │   bookingReference: "EDU12345678",                   │
   │   paymentReference: "PAY123456",                     │
   │   total: 18500,                                      │
   │   status: 'pending'                                  │
   │ }                                                    │
   └──────────────────────────────────────────────────────┘
              │
              ▼

┌─────────────────────────────────────────────────────────────┐
│                   PAYMENT PROCESSING                        │
└─────────────────────────────────────────────────────────────┘

9. POST /api/xendit/create-payment
   ┌──────────────────────────────────────────────────────┐
   │ Backend calls Xendit API:                            │
   │ {                                                    │
   │   external_id: "EDU12345678",                        │
   │   amount: 18500,                                     │
   │   payer_email: "customer@example.com",              │
   │   description: "Resort Booking",                     │
   │   currency: "PHP"                                    │
   │ }                                                    │
   └──────────────────────────────────────────────────────┘
              │
              ▼
   ✅ Xendit creates invoice
   ✅ Returns invoice_url

10. RETURN CHECKOUT URL
    ┌──────────────────────────────────────────────────────┐
    │ Response: {                                          │
    │   success: true,                                     │
    │   invoice_url: "https://checkout.xendit.co/...",    │
    │   invoice_id: "inv_abc123",                         │
    │   status: "PENDING",                                │
    │   amount: 18500                                      │
    │ }                                                    │
    └──────────────────────────────────────────────────────┘
              │
              ▼

┌─────────────────────────────────────────────────────────────┐
│                   CUSTOMER PAYMENT                          │
└─────────────────────────────────────────────────────────────┘

11. REDIRECT TO PAYMENT PAGE
    ┌──────────────────────────────────────────────────────┐
    │ window.location.href = invoice_url                   │
    │ Customer redirected to Xendit checkout page          │
    └──────────────────────────────────────────────────────┘
              │
              ▼

12. SELECT PAYMENT METHOD ON XENDIT
    ┌──────────────────────────────────────────────────────┐
    │ Xendit shows:                                        │
    │ ☐ GCash - Scan QR or use app                         │
    │ ☐ PayMaya - Scan or click                            │
    │ ☐ Bank Transfer - Get account details               │
    └──────────────────────────────────────────────────────┘
              │
              ▼

13. COMPLETE PAYMENT
    ┌──────────────────────────────────────────────────────┐
    │ Customer:                                            │
    │ 1. Scans QR with GCash app                          │
    │ 2. Confirms payment in GCash app                     │
    │ 3. Transaction sent to Xendit                        │
    │ 4. Xendit processes payment                          │
    └──────────────────────────────────────────────────────┘
              │
              ▼

14. PAYMENT CONFIRMATION
    ┌──────────────────────────────────────────────────────┐
    │ Xendit verifies payment received                     │
    │ Generates webhook event: "PAID"                      │
    └──────────────────────────────────────────────────────┘
              │
              ▼

┌─────────────────────────────────────────────────────────────┐
│                   WEBHOOK CALLBACK                          │
└─────────────────────────────────────────────────────────────┘

15. XENDIT → BACKEND WEBHOOK
    ┌──────────────────────────────────────────────────────┐
    │ Xendit sends POST to:                                │
    │ /api/xendit/webhook                                  │
    │ Headers: X-Callback-Token: [token]                   │
    │ Body: {                                              │
    │   status: "PAID",                                    │
    │   external_id: "EDU12345678",                        │
    │   paid_at: "2026-02-15T10:30:00Z",                  │
    │   amount: 18500                                      │
    │ }                                                    │
    └──────────────────────────────────────────────────────┘
              │
              ▼

16. BACKEND PROCESSES WEBHOOK
    ┌──────────────────────────────────────────────────────┐
    │ 1. Verify webhook token                              │
    │ 2. Extract bookingId from external_id                │
    │ 3. Update payments table:                            │
    │    status = 'paid'                                   │
    │    paid_at = [timestamp]                             │
    │ 4. Update bookings table:                            │
    │    payment_status = 'Paid'                           │
    │ 5. Log action in booking_logs                        │
    └──────────────────────────────────────────────────────┘
              │
              ▼

17. SEND CONFIRMATION EMAIL
    ┌──────────────────────────────────────────────────────┐
    │ Generate QR code with booking details                │
    │ Send email:                                          │
    │ - Subject: "Booking Confirmed!"                      │
    │ - Body: Guest info, booking items, QR code          │
    │ - To: customer@example.com                           │
    └──────────────────────────────────────────────────────┘
              │
              ▼

┌─────────────────────────────────────────────────────────────┐
│                   CUSTOMER NOTIFICATION                     │
└─────────────────────────────────────────────────────────────┘

18. SUCCESS REDIRECT
    ┌──────────────────────────────────────────────────────┐
    │ After payment, Xendit redirects to:                  │
    │ http://localhost:5173/booking?bookingId=EDU...&status=success
    └──────────────────────────────────────────────────────┘
              │
              ▼

19. DISPLAY CONFIRMATION PAGE
    ┌──────────────────────────────────────────────────────┐
    │ Frontend shows:                                      │
    │ ✅ Payment Confirmed!                                │
    │ Booking Reference: EDU12345678                       │
    │ Amount Paid: ₱18,500                                 │
    │ Guest: Juan Dela Cruz                                │
    │ Check-in: Feb 15, 2026                              │
    │ Check-out: Feb 17, 2026                             │
    │ [Download Booking] [Print]                           │
    └──────────────────────────────────────────────────────┘
              │
              ▼

✅ END: Booking Complete & Paid
   Customer receives email confirmation
   Admin receives notification to approve booking
```

---

### Flow 2: E-Shop Order with POS Payment

```
CUSTOMER: Browses e-shop items
          │
          ▼
       Add to cart
          │
          ▼
       Proceed to checkout
          │
          ▼
      Select payment method
      (Cash / GCash / Card)
          │
          ▼

BACKEND: Process order
         │
         ▼
    Create POS transaction
    Store payment method
         │
         ▼
    If payment method = 'GCash':
         │
         ├─→ Create Xendit invoice
         │       │
         │       ▼
         │   Generate GCash QR code
         │   Store QR URL in payment_url
         │       │
         │       ▼
         │   Return QR code to frontend
         │
         └─→ Generate receipt with QR
              Print receipt with QR code
              Customer scans to pay

    If payment method = 'Cash':
         │
         ├─→ Mark as cash payment
         │   Generate receipt
         │   Print without QR

RESULT: Order created, payment method recorded
```

---

### Flow 3: Payment Status Monitoring

```
┌─────────────────────────────────┐
│ Booking created with            │
│ payment_status = 'Pending'      │
└─────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ POST /api/xendit/create-payment │
│ Generates invoice               │
│ Payment record created          │
└─────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Frontend polls payment status   │
│ GET /api/xendit/payment-status  │
│ Every 5 seconds                 │
└─────────────────────────────────┘
           │
           ├─→ PENDING: Show "Waiting for payment..."
           │   (customer has not completed)
           │
           ├─→ PAID: Show "Payment Confirmed!"
           │   (customer paid, webhook received)
           │
           └─→ EXPIRED: Show "Payment link expired"
               (customer took too long, need new link)

```

---

## 📋 Implementation Checklist

### Phase 1: Initial Setup (✅ DONE)
- [x] Create payment controllers (Xendit & PayMongo)
- [x] Create payment routes
- [x] Mount routes in server.js
- [x] Create database schema
- [x] Add API keys to .env
- [x] Install dependencies (node-fetch)

### Phase 2: Core Integration (✅ DONE)
- [x] Booking creation with payment record
- [x] Payment link generation (Xendit)
- [x] Payment link generation (PayMongo)
- [x] Payment status checking
- [x] Webhook handling (Xendit)
- [x] Webhook handling (PayMongo)

### Phase 3: Frontend Integration (⏳ IN PROGRESS)
- [ ] Wire up payment button in Vue component
- [ ] Implement checkout redirect
- [ ] Handle success/failure pages
- [ ] Display payment status
- [ ] Add error messages

### Phase 4: Testing & Validation (📋 TODO)
- [ ] Test Xendit payment flow end-to-end
- [ ] Test PayMongo payment flow end-to-end
- [ ] Test webhook handling
- [ ] Test error scenarios
- [ ] Test edge cases (timeout, network errors)

### Phase 5: Production Readiness (📋 TODO)
- [ ] Switch PayMongo to production key
- [ ] Configure webhook URLs in dashboards
- [ ] Set up payment monitoring/alerts
- [ ] Implement payment reconciliation
- [ ] Document runbook for admin
- [ ] Train support team

### Phase 6: Enhanced Features (📋 FUTURE)
- [ ] Implement refund system
- [ ] Add payment retry logic
- [ ] Implement payment plans/installments
- [ ] Add 3D Secure verification
- [ ] Implement fraud detection
- [ ] Add payment analytics

---

## 🧪 Testing Scenarios

### Scenario 1: Successful GCash Payment
```
1. Start backend: npm start
2. Open frontend: http://localhost:5173
3. Add 2 rooms for 3 nights
4. Proceed to checkout
5. Fill guest info
6. Select GCash
7. Click "Pay Now"
8. On Xendit page: Click "Authorize" (test mode)
9. Verify redirect to success page
10. Check email for confirmation
11. Verify database: bookings.payment_status = 'Paid'
```

### Scenario 2: Payment Timeout
```
1. Create payment via API
2. Don't complete payment
3. Wait for payment link to expire (usually 24 hours)
4. Try to pay on expired link
5. Should show: "Payment link expired"
6. Create new payment link
```

### Scenario 3: Webhook Failure
```
1. Payment processed successfully
2. Simulate webhook failure (don't receive callback)
3. Use GET /api/xendit/payment-status to check status
4. Status should show: PAID
5. Manual webhook can be triggered for reconciliation
```

---

## 🔍 Debugging Tips

### Enable Verbose Logging
```javascript
// In controllers
console.log('🔑 Creating Xendit invoice...');
console.log('💳 Payment method:', paymentMethod);
console.log('✅ Success:', data);
console.log('❌ Error:', error);
```

### Monitor Database
```sql
-- Check all payments
SELECT * FROM payments ORDER BY created_at DESC LIMIT 10;

-- Check payment status
SELECT booking_id, status, paid_at, amount 
FROM payments 
WHERE booking_id = 12345;

-- Check booking with payment
SELECT b.booking_id, b.booking_reference, b.payment_status, p.status
FROM bookings b
LEFT JOIN payments p ON b.booking_id = p.booking_id
ORDER BY b.created_at DESC;
```

### Test via Postman
```
POST http://localhost:8000/api/xendit/create-payment
Headers: Content-Type: application/json
Body: {
  "amount": 5000,
  "email": "test@example.com",
  "bookingId": "TEST-123",
  "customerName": "Test User",
  "paymentMethod": "gcash"
}
```

### Use ngrok for Webhook Testing
```bash
# Terminal 1: Start ngrok
ngrok http 8000

# Terminal 2: Configure webhook in payment dashboard
# Use ngrok URL: https://xxxxx.ngrok.io/api/xendit/webhook

# Now webhooks from Xendit will reach your local server!
```

---

## ✅ Pre-Launch Checklist

Before going live, verify:

- [ ] **API Keys Configured**
  - [ ] Xendit key is set
  - [ ] PayMongo key is set (should be LIVE for production)
  - [ ] Webhook tokens are secure

- [ ] **Webhooks Registered**
  - [ ] Xendit webhook URL configured
  - [ ] PayMongo webhook URL configured
  - [ ] Webhook tokens verified

- [ ] **Database Ready**
  - [ ] All migration scripts run
  - [ ] Tables created and indexed
  - [ ] Foreign keys in place

- [ ] **Frontend Updated**
  - [ ] Payment button wired to API
  - [ ] Redirect URLs configured
  - [ ] Error handling implemented
  - [ ] Loading states added

- [ ] **Testing Complete**
  - [ ] Test payment successful
  - [ ] Test payment failed
  - [ ] Test payment timeout
  - [ ] Webhook verified

- [ ] **Security Verified**
  - [ ] .env not committed to Git
  - [ ] API keys rotated
  - [ ] HTTPS enabled
  - [ ] Input validation in place

- [ ] **Documentation**
  - [ ] Admin runbook written
  - [ ] Customer support guide ready
  - [ ] API documentation complete
  - [ ] Incident response plan created

- [ ] **Monitoring**
  - [ ] Payment alerts configured
  - [ ] Error logging enabled
  - [ ] Analytics tracking added
  - [ ] Backup payment method ready

---

## 📞 Support Contacts

**Xendit Support:** https://support.xendit.co/
- Email: support@xendit.co
- Chat: Available in Xendit dashboard

**PayMongo Support:** https://developers.paymongo.com/
- Email: hello@paymongo.com
- Docs: https://developers.paymongo.com/

**Resort Admin Contact:**
- Email: admin@eduardosresort.com
- Phone: [Your phone number]

---

**Document Status:** Ready for Implementation
**Last Updated:** April 25, 2026
**Next Review:** After first live payment test
