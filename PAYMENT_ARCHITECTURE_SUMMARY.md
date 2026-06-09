# 💳 Payment Architecture Summary - CAPSTONE_BACKEND

## Overview
Eduardo's Resort has a **dual payment gateway integration** supporting both **Xendit** and **PayMongo**. Currently, Xendit is the primary integration with full webhook support.

---

## 📂 Payment-Related Files

### Backend Controllers
- **[controllers/paymongoController.js](controllers/paymongoController.js)** - PayMongo payment gateway integration
- **[controllers/xenditController.js](controllers/xenditController.js)** - Xendit payment gateway integration  
- **[controllers/bookingConfirmationController.js](controllers/bookingConfirmationController.js)** - Booking & payment creation flow
- **[controllers/posController.js](controllers/posController.js)** - POS transaction handling with payment tracking

### Backend Routes
- **[routes/paymongo.js](routes/paymongo.js)** - PayMongo API endpoints
- **[routes/xendit.js](routes/xendit.js)** - Xendit API endpoints
- **[routes/bookings.js](routes/bookings.js)** - Booking endpoints (includes payment confirmation)

### Database Schema Files
- **[ADD_PAYMENT_URL_TO_POS_TRANSACTIONS.sql](ADD_PAYMENT_URL_TO_POS_TRANSACTIONS.sql)** - Adds `payment_url` column for QR codes
- **[ADD_USER_ID_TO_POS_TRANSACTIONS.sql](ADD_USER_ID_TO_POS_TRANSACTIONS.sql)** - Links transactions to users

### Configuration & Documentation
- **[.env](.env)** - Contains API keys for both payment gateways
- **[PAYMONGO_QUICK_START.md](PAYMONGO_QUICK_START.md)** - PayMongo setup guide
- **[XENDIT_QUICK_START.md](XENDIT_QUICK_START.md)** - Xendit quick setup
- **[XENDIT_INTEGRATION_COMPLETE.md](XENDIT_INTEGRATION_COMPLETE.md)** - Full Xendit integration documentation
- **[XENDIT_SETUP_GUIDE.md](XENDIT_SETUP_GUIDE.md)** - Detailed Xendit setup
- **[test-xendit-payment.html](test-xendit-payment.html)** - Interactive payment testing page

---

## 🔧 Current Configuration

### Environment Variables (.env)
```env
# PayMongo - Currently LIVE Key!


# Xendit - Development Mode


# Frontend URL
FRONTEND_URL=http://localhost:5173
```

**⚠️ SECURITY NOTE:** PayMongo is using a LIVE SECRET KEY (sk_live_*), not a test key!

---

## 🏗️ Payment Processing Architecture

### 1. **Booking Creation with Payment**

**Flow:**
```
Customer fills booking form
    ↓
Clicks "Pay Now"
    ↓
POST /api/bookings/confirm
    ↓
Backend creates:
  - Customer record (if new)
  - Booking record (with payment_status = 'pending')
  - Booking items
  - Payment record
    ↓
Returns bookingId & bookingReference
```

**Controller:** `bookingConfirmationController.js` → `createBookingConfirmation()`

**Database Tables Involved:**
- `customers` - Customer information
- `bookings` - Booking details (check-in, check-out, status)
- `booking_items` - Items in booking (rooms, swimming, etc.)
- `payments` - Payment records with status tracking
- `booking_logs` - Audit trail

### 2. **Xendit Payment Flow** (PRIMARY)

**Endpoints:**
```
POST /api/xendit/create-payment
GET  /api/xendit/payment-status/:invoiceId
POST /api/xendit/webhook
```

**Create Payment Request:**
```javascript
{
  "amount": 18500,                    // Total in PHP
  "email": "customer@example.com",
  "bookingId": "EDU12345678",        // Unique booking reference
  "customerName": "Juan Dela Cruz",
  "paymentMethod": "gcash"           // gcash, paymaya, bank
}
```

**Create Payment Response:**
```javascript
{
  "success": true,
  "invoice_url": "https://checkout.xendit.co/web/...",
  "invoice_id": "abc123...",
  "external_id": "EDU12345678",      // Links back to booking
  "status": "PENDING",
  "amount": 18500,
  "expiry_date": "2026-02-28T..."
}
```

**Payment Flow Diagram:**
```
┌─────────────────────────────────────────────────┐
│ 1. POST /api/xendit/create-payment              │
│    Frontend sends booking + amount details      │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│ 2. Backend calls Xendit API                      │
│    Creates invoice with external_id=bookingId   │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│ 3. Frontend redirects to invoice_url             │
│    Customer scans QR / selects payment method   │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│ 4. Customer pays via GCash/PayMaya/Bank         │
│    Xendit processes payment                     │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│ 5. Xendit sends webhook to backend              │
│    POST /api/xendit/webhook                     │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│ 6. Backend updates:                             │
│    bookings.payment_status = 'Paid'             │
│    Sends confirmation email with QR code       │
└─────────────────────────────────────────────────┘
```

**Controller:** `xenditController.js`
- `createPayment()` - Creates invoice
- `getPaymentStatus()` - Checks payment status
- `webhookHandler()` - Receives payment notifications

---

### 3. **PayMongo Payment Flow** (SECONDARY)

**Endpoints:**
```
POST /api/paymongo/create-payment-link
POST /api/paymongo/create-payment-intent
GET  /api/paymongo/payment-status/:paymentLinkId
POST /api/paymongo/webhook
```

**Create Payment Link Request:**
```javascript
{
  "amount": 5000,
  "description": "Resort Booking - 2 nights",
  "bookingId": "EDU12345678",
  "email": "customer@example.com",
  "paymentMethod": "gcash"
}
```

**Create Payment Link Response:**
```javascript
{
  "success": true,
  "checkout_url": "https://checkout.paymongo.com/pay/...",
  "reference_number": "EDU-REF-123456",
  "payment_id": "link_abc123...",
  "status": "unpaid",
  "redirect_url": "http://localhost:5173/booking?bookingId=..."
}
```

**Payment Methods Supported:**
- GCash (`gcash`)
- PayMaya (`paymaya`)
- Card (`card`)
- BillEase (`billease`)

**Controller:** `paymongoController.js`
- `createPaymentLink()` - Creates checkout page (recommended)
- `createPaymentIntent()` - Advanced payment intent (for custom checkout)
- `getPaymentStatus()` - Checks payment status
- `webhookHandler()` - Receives payment notifications

---

## 📊 Database Schema

### Payments Table
```sql
CREATE TABLE payments (
  payment_id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  payment_reference VARCHAR(50) UNIQUE,
  payment_method VARCHAR(50),           -- 'gcash', 'paymaya', 'card'
  amount DECIMAL(10, 2),
  status ENUM('pending', 'paid', 'failed', 'cancelled'),
  payment_intent_id VARCHAR(255),       -- Xendit invoice_id or PayMongo link_id
  checkout_url LONGTEXT,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  INDEX idx_booking (booking_id),
  INDEX idx_status (status)
);
```

### Bookings Table (Payment-Related Fields)
```sql
CREATE TABLE bookings (
  booking_id INT PRIMARY KEY AUTO_INCREMENT,
  booking_reference VARCHAR(50) UNIQUE,
  customer_id INT NOT NULL,
  payment_status ENUM('Pending', 'Paid', 'Partially Paid') DEFAULT 'Pending',
  payment_method VARCHAR(50),
  total DECIMAL(10, 2),
  booking_status ENUM('Pending', 'Confirmed', 'Cancelled') DEFAULT 'Pending',
  check_in_date DATE,
  check_out_date DATE,
  -- ... other fields
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  INDEX idx_payment_status (payment_status),
  INDEX idx_booking_reference (booking_reference)
);
```

### POS Transactions Table
```sql
CREATE TABLE pos_transactions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,                    -- Links to user who made order
  receipt_no VARCHAR(50),
  items JSON,
  type ENUM('E-Shop', 'Dine-In', 'Takeout'),
  payment_method VARCHAR(50),     -- 'Cash', 'GCash', 'Card'
  payment_url LONGTEXT,           -- Stores QR code URL or payment link
  total_amount DECIMAL(10, 2),
  transaction_date DATE,
  transaction_time TIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE,
  INDEX idx_pos_user_id (user_id),
  INDEX idx_payment_method (payment_method)
);
```

---

## 🚀 API Endpoints Reference

### Xendit Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/xendit/create-payment` | Create Xendit invoice |
| GET | `/api/xendit/payment-status/:invoiceId` | Check payment status |
| POST | `/api/xendit/webhook` | Receive payment notifications |

### PayMongo Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/paymongo/create-payment-link` | Create payment checkout page |
| POST | `/api/paymongo/create-payment-intent` | Create payment intent (advanced) |
| GET | `/api/paymongo/payment-status/:paymentLinkId` | Check payment status |
| POST | `/api/paymongo/webhook` | Receive payment notifications |

### Booking Endpoints (Payment-Related)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/bookings/confirm` | Create booking with payment |
| POST | `/api/bookings/update-payment` | Update payment status after completion |

---

## 💳 Supported Payment Methods

| Method | Min Amount | Max Amount | Processing Time | Fee |
|--------|-----------|-----------|-----------------|-----|
| **GCash** | ₱1 | ₱50,000 | Instant | 2.5% |
| **PayMaya** | ₱1 | ₱50,000 | Instant | 2.5% |
| **Bank Transfer** | ₱1 | No limit | 1-3 days | Free |
| **Card (via PayMongo)** | ₱1 | ₱100,000 | Instant | 2.5-3.5% |

---

## 🔐 Security Implementation

### Current Security Features
✅ API keys stored in `.env` (not in code)
✅ `.env` in `.gitignore` (not committed to GitHub)
✅ Payment details never stored on server
✅ Webhook token verification available
✅ All payments processed through PCI-compliant gateways

### Webhook Verification
```javascript
// Xendit webhook verification
const callbackToken = req.headers['x-callback-token'];
if (process.env.XENDIT_WEBHOOK_TOKEN && 
    callbackToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
  return res.status(401).json({ error: 'Unauthorized webhook' });
}
```

---

## 📝 Payment Status Flow

### Booking Payment Status
- **Pending** (initial) → Customer filling booking form
- **Paid** → Payment completed via Xendit/PayMongo
- **Partially Paid** → For split payments (if applicable)

### Booking Status (Admin Approval)
- **Pending** → Payment received, awaiting admin approval
- **Confirmed** → Admin approved, booking is active
- **Cancelled** → Booking cancelled by admin or customer

### Payment Webhook Events

**Xendit Webhook Events:**
- `PAID` - Payment successfully received
- `EXPIRED` - Invoice expired without payment
- `PENDING` - Invoice created, awaiting payment

**PayMongo Webhook Events:**
- `link.payment.paid` - Payment link payment received
- `payment_intent.succeeded` - Payment intent successful

---

## 🧪 Testing Payment Flows

### Test Credentials Available
**PayMongo Test Cards:**
```
Success:
  Card: 4343434343434345
  Expiry: 12/25
  CVC: 123

3D Secure (requires auth):
  Card: 4571736000000075
  Expiry: 12/25
  CVC: 123

Decline:
  Card: 4571736000000067
  Expiry: 12/25
  CVC: 123
```

**GCash (Both Xendit & PayMongo):**
- In test mode, shows simulated GCash screen
- Click "Authorize" to complete test payment
- No real money charged

### Test Payment Page
Access: `test-xendit-payment.html` in browser
- Interactive form to test payment creation
- Shows response from backend
- Links to actual payment checkout

---

## ⚡ Key Implementation Details

### Payment Initiation (from Controller)
```javascript
export const createPaymentLink = async (req, res) => {
  const { amount, description, bookingId, email, paymentMethod } = req.body;
  
  // Validate API key
  if (!PAYMONGO_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment service not configured' });
  }
  
  // Convert to centavos (₱ to ¢)
  const amountInCentavos = Math.round(amount * 100);
  
  // Create payment link with PayMongo
  const response = await fetch(`${PAYMONGO_API_URL}/links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
    },
    body: JSON.stringify(paymentLinkData)
  });
  
  const data = await response.json();
  
  // Return checkout URL to frontend
  res.json({
    success: true,
    checkout_url: data.data.attributes.checkout_url,
    reference_number: data.data.attributes.reference_number
  });
};
```

### Payment Confirmation (After Webhook)
```javascript
export const updatePaymentStatus = async (req, res) => {
  const { bookingId, status, paymentIntentId } = req.body;
  
  // Update payment status
  await db.query(
    `UPDATE payments SET status = ?, payment_intent_id = ? WHERE booking_id = ?`,
    [status, paymentIntentId, bookingId]
  );
  
  // Update booking if paid
  if (status === 'paid') {
    await db.query(
      'UPDATE bookings SET payment_status = ? WHERE booking_id = ?',
      ['Paid', bookingId]
    );
    
    // Send confirmation email with QR code
    await sendBookingConfirmationWithQR(bookingData);
  }
};
```

---

## 📧 Email Confirmation

**Triggered:** After payment confirmation (webhook received)

**Email Contains:**
- Booking reference
- Guest information
- Booking items & dates
- QR code for check-in
- Total amount paid
- Booking instructions

**Service:** `emailService.js` → `sendBookingConfirmationWithQR()`

---

## 🎯 Outstanding Issues & Improvements

### Current Limitations
1. **PayMongo using LIVE key** - Should switch to test key for development
2. **No refund handling** - Refund system not implemented
3. **Manual webhook setup required** - Need to configure webhook URLs in Xendit/PayMongo dashboards
4. **Limited error handling** - Some edge cases not fully handled
5. **No payment retry logic** - Failed payments cannot be retried

### Recommended Improvements
- [ ] Implement refund processing
- [ ] Add payment timeout handling
- [ ] Implement automatic payment status reconciliation
- [ ] Add logging/analytics for payment metrics
- [ ] Implement PCI compliance audit
- [ ] Add fraud detection

---

## 📞 Support & Documentation

- **Xendit Docs:** https://developers.xendit.co/
- **PayMongo Docs:** https://developers.paymongo.com/
- **Payment Setup Guides:** `XENDIT_SETUP_GUIDE.md`, `PAYMONGO_QUICK_START.md`
- **Test Page:** `test-xendit-payment.html`

---

## 🔗 Related Components

### Frontend Integration
- **Component:** `confirmationbooking.vue` (in CAPSTONE_FRONTEND)
- **Payment Method Selection:** GCash, PayMaya, Bank Transfer
- **Flow:** Form → Validate → Create Booking → Create Payment → Redirect to Checkout

### E-Shop POS Integration
- **Controller:** `posController.js`
- **Payment URL Storage:** Stores GCash QR code URLs for receipts
- **Transactions Table:** Tracks all POS transactions with payment method

---

**Last Updated:** April 25, 2026
**Status:** Both Xendit and PayMongo integrated and functional
**Primary Gateway:** Xendit (production-ready with webhooks)
**Secondary Gateway:** PayMongo (available as alternative)
