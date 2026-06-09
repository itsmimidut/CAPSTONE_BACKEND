# 💳 Payment Implementation - Code Reference

## Quick Navigation
- **[Xendit Integration](#xendit-integration)** - Primary payment gateway
- **[PayMongo Integration](#paymongo-integration)** - Secondary payment gateway
- **[Booking Flow](#booking-payment-flow)** - End-to-end flow
- **[Database Operations](#database-operations)** - Payment data management

---

## Xendit Integration

### 1. Create Payment (Invoice)

**File:** `controllers/xenditController.js`

```javascript
export const createPayment = async (req, res) => {
  try {
    if (!XENDIT_API_KEY) {
      return res.status(500).json({ 
        error: 'Payment service not configured' 
      });
    }

    const {
      amount,              // Total in PHP (e.g., 18500)
      email,              // Customer email
      description,        // Payment description
      bookingId,          // Unique booking reference (used as external_id)
      customerName,       // Customer name
      paymentMethod      // 'gcash', 'paymaya', 'bank'
    } = req.body;

    // Validation
    if (!amount || !email || !bookingId || !customerName) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    console.log('🔑 Creating Xendit invoice for:', bookingId);

    // Create Xendit invoice
    const invoiceData = {
      external_id: bookingId,           // Links back to our booking
      amount: amount,
      payer_email: email,
      description: description || `Booking Payment - ${bookingId}`,
      customer: {
        given_names: customerName,
        email: email
      },
      currency: 'PHP',
      success_redirect_url: `${FRONTEND_URL}/booking?bookingId=${bookingId}&status=success`,
      failure_redirect_url: `${FRONTEND_URL}/booking-confirmation?status=failed`
    };

    const response = await fetch('https://api.xendit.co/v2/invoices', {
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

    console.log('✅ Payment link created:', data.invoice_url);

    // Return to frontend
    res.json({
      success: true,
      invoice_url: data.invoice_url,        // Redirect customer here
      invoice_id: data.id,                  // For status checking
      external_id: data.external_id,        // Should match bookingId
      status: data.status,                  // 'PENDING'
      amount: data.amount
    });

  } catch (error) {
    console.error('Xendit Payment Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
```

### 2. Check Payment Status

```javascript
export const getPaymentStatus = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const response = await fetch(
      `https://api.xendit.co/v2/invoices/${invoiceId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(XENDIT_API_KEY + ':').toString('base64')}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to get payment status',
        details: data
      });
    }

    res.json({
      success: true,
      status: data.status,        // 'PAID', 'PENDING', 'EXPIRED'
      paid_at: data.paid_at,      // Timestamp when paid
      amount: data.amount,
      external_id: data.external_id  // Original bookingId
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

### 3. Webhook Handler

```javascript
export const webhookHandler = async (req, res) => {
  try {
    const callbackToken = req.headers['x-callback-token'];
    
    // Verify webhook token (recommended for security)
    if (process.env.XENDIT_WEBHOOK_TOKEN && 
        callbackToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const payment = req.body;
    
    console.log('Xendit Webhook Received:', {
      external_id: payment.external_id,
      status: payment.status,
      paid_at: payment.paid_at
    });

    const bookingId = payment.external_id;  // Our booking ID

    // Handle PAID status
    if (payment.status === 'PAID') {
      // Update booking payment status
      await db.query(
        'UPDATE bookings SET payment_status = ? WHERE booking_id = ?',
        ['Paid', bookingId]
      );

      // Update payment record
      await db.query(
        `UPDATE payments SET status = ?, paid_at = ? WHERE booking_id = ?`,
        ['paid', payment.paid_at, bookingId]
      );

      console.log('💰 Payment confirmed for booking:', bookingId);

      // Send confirmation email, generate QR code, etc.
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

### 4. Routes Setup

**File:** `routes/xendit.js`

```javascript
import express from 'express';
import { 
  createPayment, 
  getPaymentStatus, 
  webhookHandler 
} from '../controllers/xenditController.js';

const router = express.Router();

// Create Xendit invoice/payment
router.post('/create-payment', createPayment);

// Get payment status
router.get('/payment-status/:invoiceId', getPaymentStatus);

// Webhook endpoint for Xendit callbacks
router.post('/webhook', webhookHandler);

export default router;
```

### 5. Server Mount

**File:** `server.js`

```javascript
import xenditRoutes from "./routes/xendit.js";

// ... in middleware setup ...

app.use('/api/xendit', xenditRoutes);
```

---

## PayMongo Integration

### 1. Create Payment Link (Recommended)

**File:** `controllers/paymongoController.js`

```javascript
export const createPaymentLink = async (req, res) => {
  try {
    if (!PAYMONGO_SECRET_KEY) {
      return res.status(500).json({
        error: 'Payment service not configured'
      });
    }

    const {
      amount,           // Total in PHP (e.g., 5000)
      description,      // Invoice description
      bookingId,        // Unique booking reference
      email,           // Customer email
      paymentMethod    // 'gcash', 'paymaya', 'card'
    } = req.body;

    if (!amount || !description) {
      return res.status(400).json({
        error: 'Missing required fields: amount, description'
      });
    }

    // Convert to centavos (₱100 = 10000 centavos)
    const amountInCentavos = Math.round(amount * 100);

    console.log('🔑 Creating PayMongo payment link for:', bookingId);
    console.log('💳 Selected payment method:', paymentMethod);

    // Map frontend payment methods to PayMongo codes
    const selectedMethods = ['gcash', 'paymaya', 'card'];

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Create payment link data
    const paymentLinkData = {
      data: {
        attributes: {
          amount: amountInCentavos,
          description: description,
          remarks: bookingId,  // Store booking ID for webhook reference
          payment_method_types: selectedMethods,
          success_url: `${frontendUrl}/payment-return?bookingId=${bookingId}`,
          cancel_url: `${frontendUrl}/booking-confirmation?cancelled=true`,
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

    const response = await fetch('https://api.paymongo.com/v1/links', {
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

    res.json({
      success: true,
      checkout_url: data.data.attributes.checkout_url,  // Customer goes here
      reference_number: data.data.attributes.reference_number,
      payment_id: data.data.id,
      amount: amount,
      status: data.data.attributes.status
    });

  } catch (error) {
    console.error('❌ PayMongo Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
```

### 2. Get Payment Status

```javascript
export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const response = await fetch(
      `https://api.paymongo.com/v1/links/${paymentId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to get payment status',
        details: data
      });
    }

    const status = data.data.attributes.status;
    const payments = data.data.attributes.payments || [];
    const isPaid = payments.length > 0 && 
                   payments[0].attributes.status === 'paid';

    res.json({
      success: true,
      status: status,           // 'unpaid', 'paid', 'expired'
      isPaid: isPaid,
      amount: data.data.attributes.amount / 100,  // Back to PHP
      reference_number: data.data.attributes.reference_number,
      payments: payments
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

### 3. Webhook Handler

```javascript
export const webhookHandler = async (req, res) => {
  try {
    const event = req.body;

    console.log('📨 PayMongo Webhook Received:', {
      type: event.data?.attributes?.type,
      status: event.data?.attributes?.data?.attributes?.status
    });

    const eventType = event.data?.attributes?.type;

    // Check if payment was completed
    if (eventType === 'link.payment.paid') {
      const paymentLink = event.data.attributes.data.attributes;
      const bookingId = paymentLink.remarks;  // Our booking ID
      const referenceNumber = paymentLink.reference_number;
      const amount = paymentLink.amount / 100;  // Convert back to PHP

      // Extract payment method from payments array
      const payments = paymentLink.payments || [];
      let paymentMethod = 'Online Payment';

      if (payments.length > 0) {
        const paymentAttributes = payments[0].data?.attributes || {};
        const paymentType = paymentAttributes.source?.type || 'unknown';

        // Map PayMongo types to readable names
        const methodMap = {
          'gcash': 'GCash',
          'paymaya': 'PayMaya',
          'grab_pay': 'GrabPay',
          'card': 'Card Payment'
        };
        paymentMethod = methodMap[paymentType.toLowerCase()] || paymentType;
      }

      console.log('💰 Payment successful:', {
        bookingId: bookingId,
        amount: amount,
        method: paymentMethod
      });

      // Update booking payment status
      await db.query(
        'UPDATE bookings SET payment_status = ?, payment_method = ? WHERE booking_id = ?',
        ['Paid', paymentMethod, bookingId]
      );

      // Update payment record
      await db.query(
        'UPDATE payments SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
        ['paid', bookingId]
      );

      console.log('✅ Payment recorded for booking:', bookingId);
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ error: error.message });
  }
};
```

---

## Booking Payment Flow

### Complete Booking Creation with Payment

**File:** `controllers/bookingConfirmationController.js`

```javascript
export const createBookingConfirmation = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { 
      guest,              // Customer info
      checkIn,           // Check-in date
      checkOut,          // Check-out date
      items,             // Rooms/services to book
      paymentMethod,     // 'gcash', 'paymaya', etc.
      total,             // Total amount
      userId,            // Logged-in user ID (optional)
      isSwimmingOnly     // Flag for swimming-only bookings
    } = req.body;

    console.log('🔍 Booking request received for:', guest?.email);

    // Step 1: Validate guest info
    if (!guest?.firstName || !guest?.lastName || 
        !guest?.email || !guest?.phone) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: 'Guest information is required' 
      });
    }

    // Step 2: Get or create customer
    let customerId;

    if (userId) {
      // Check if customer exists for this user
      const [userCustomer] = await connection.query(
        'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
        [userId]
      );

      if (userCustomer.length > 0) {
        customerId = userCustomer[0].customer_id;
      } else {
        // Create new customer
        const [customerResult] = await connection.query(
          `INSERT INTO customers (user_id, address, city, country, postal_code)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, guest.address, guest.city, 'Philippines', guest.postal]
        );
        customerId = customerResult.insertId;
      }
    } else {
      // Guest booking - create minimal user first
      const [newUser] = await connection.query(
        `INSERT INTO user (first_name, last_name, email, phone, password, role)
         VALUES (?, ?, ?, ?, 'GUEST', 'customer')`,
        [guest.firstName, guest.lastName, guest.email, guest.phone]
      );
      const userId = newUser.insertId;

      // Create customer linked to user
      const [customerResult] = await connection.query(
        `INSERT INTO customers (user_id, address, city, country, postal_code)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, guest.address, guest.city, 'Philippines', guest.postal]
      );
      customerId = customerResult.insertId;
    }

    // Step 3: Generate booking reference
    const bookingReference = 'EDU' + Date.now().toString().slice(-8);
    
    console.log(`📖 Generated booking reference: ${bookingReference}`);

    // Step 4: Create booking record
    const [bookingResult] = await connection.query(
      `INSERT INTO bookings (
        booking_reference, 
        customer_id, 
        check_in_date, 
        check_out_date, 
        adults, 
        children, 
        arrival_time, 
        special_requests,
        total,
        booking_status,
        payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingReference,
        customerId,
        checkIn,
        checkOut,
        guest.adults || 2,
        guest.children || 0,
        guest.arrivalTime || '3 PM',
        guest.specialRequests || '',
        total,
        'Pending',
        'Pending'  // Payment status starts as Pending
      ]
    );

    const bookingId = bookingResult.insertId;
    console.log(`✅ Created booking ID: ${bookingId}`);

    // Step 5: Add booking items
    for (const item of items) {
      const requestedQty = Math.max(1, Number(item.qty || 1));
      const nights = (checkIn && checkOut)
        ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000)
        : 1;

      const totalPrice = item.price * requestedQty * (item.perNight ? nights : 1);

      // Get inventory item ID
      const [inventoryItem] = await connection.query(
        'SELECT item_id FROM inventory_items WHERE name = ? LIMIT 1',
        [item.name]
      );

      const inventoryItemId = inventoryItem.length > 0 
        ? inventoryItem[0].item_id 
        : null;

      // Insert booking item
      await connection.query(
        `INSERT INTO booking_items (
          booking_id,
          inventory_item_id,
          item_type,
          item_name,
          unit_price,
          quantity,
          guests,
          nights,
          total_price,
          per_night
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          inventoryItemId,
          item.category || 'Room',
          item.name,
          item.price,
          requestedQty,
          item.guests || 0,
          nights,
          totalPrice,
          item.perNight || false
        ]
      );
    }

    console.log(`📦 Added ${items.length} item(s) to booking`);

    // Step 6: Create payment record
    const paymentReference = 'PAY' + Date.now().toString().slice(-6);
    const [paymentResult] = await connection.query(
      `INSERT INTO payments (
        booking_id, 
        customer_id, 
        payment_reference, 
        payment_method, 
        amount, 
        status
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        bookingId, 
        customerId, 
        paymentReference, 
        paymentMethod, 
        total,
        'pending'  // Initial payment status
      ]
    );

    console.log(`💳 Created payment record: ${paymentReference}`);

    // Step 7: Commit transaction
    await connection.commit();

    // Return booking details to frontend
    res.json({
      success: true,
      message: 'Booking created successfully',
      data: {
        bookingId,
        bookingReference,
        customerId,
        paymentId: paymentResult.insertId,
        paymentReference,
        total,
        status: 'pending'
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking',
      details: error.message
    });
  } finally {
    connection.release();
  }
};
```

### Update Payment Status (After Payment)

```javascript
export const updatePaymentStatus = async (req, res) => {
  try {
    const { bookingId, status, paymentIntentId, checkoutUrl } = req.body;

    console.log('📝 Updating payment status:', {
      bookingId,
      status,
      paymentIntentId
    });

    // Update payment record
    const [result] = await db.query(
      `UPDATE payments SET 
        status = ?, 
        payment_intent_id = ?, 
        checkout_url = ?,
        paid_at = IF(? = 'paid', CURRENT_TIMESTAMP, paid_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE booking_id = ?`,
      [status, paymentIntentId, checkoutUrl, status, bookingId]
    );

    // If payment is complete, update booking
    if (status === 'paid') {
      await db.query(
        'UPDATE bookings SET payment_status = ? WHERE booking_id = ?',
        ['Paid', bookingId]
      );

      // Log the payment
      await db.query(
        'INSERT INTO booking_logs (booking_id, action, description) VALUES (?, ?, ?)',
        [bookingId, 'payment_received', 'Payment completed and verified']
      );

      console.log('✅ Payment confirmed for booking:', bookingId);

      // Send confirmation email (async)
      // sendBookingConfirmationEmail(bookingId);
    }

    res.json({ 
      success: true, 
      message: 'Payment status updated',
      affectedRows: result.affectedRows
    });

  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
```

---

## Database Operations

### Create Payment Record

```javascript
// Insert initial payment record
const [paymentResult] = await db.query(
  `INSERT INTO payments (
    booking_id, 
    customer_id, 
    payment_reference, 
    payment_method, 
    amount, 
    status
  ) VALUES (?, ?, ?, ?, ?, ?)`,
  [
    bookingId,
    customerId,
    paymentReference,
    'gcash',
    5000.00,
    'pending'
  ]
);

const paymentId = paymentResult.insertId;
```

### Update Payment After Webhook

```javascript
// Update payment after successful payment
await db.query(
  `UPDATE payments SET 
    status = ?, 
    payment_intent_id = ?, 
    paid_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE booking_id = ? AND payment_reference = ?`,
  ['paid', xendit_invoice_id, bookingId, paymentReference]
);
```

### Get Payment Status

```javascript
// Check if booking is paid
const [payments] = await db.query(
  `SELECT status, amount, payment_method FROM payments 
   WHERE booking_id = ?`,
  [bookingId]
);

if (payments.length > 0 && payments[0].status === 'paid') {
  console.log('✅ Booking is paid');
} else {
  console.log('⏳ Payment pending');
}
```

### Query Bookings with Payment Info

```javascript
// Get bookings with payment status
const [bookings] = await db.query(
  `SELECT 
    b.booking_id,
    b.booking_reference,
    b.total,
    b.payment_status,
    p.status as payment_gateway_status,
    p.payment_method,
    p.paid_at
  FROM bookings b
  LEFT JOIN payments p ON b.booking_id = p.booking_id
  WHERE b.customer_id = ?
  ORDER BY b.created_at DESC`,
  [customerId]
);
```

---

## Environment Configuration

### Xendit Setup

```env
# Xendit - Development (Test Mode)
XENDIT_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
XENDIT_WEBHOOK_TOKEN=YOUR_STRIPE_SECRET_KEY

# Xendit - Production (Use when live)
# XENDIT_SECRET_KEY=xnd_production_YOUR_LIVE_KEY
```

### PayMongo Setup

```env
# PayMongo - Test Mode (START HERE!)


# PayMongo - Live Mode (USE WITH CAUTION!)

```

### Frontend URL

```env
# Used for success/failure redirects after payment
FRONTEND_URL=http://localhost:5173
```

---

## Testing Payment

### Manual Xendit Test via HTML

**File:** `test-xendit-payment.html`

```html
<!-- Test form to create Xendit invoice -->
<form id="paymentForm">
  <input type="number" id="amount" placeholder="Amount (PHP)" value="5000">
  <input type="email" id="email" placeholder="Email" value="test@example.com">
  <input type="text" id="customerName" placeholder="Name" value="Juan Dela Cruz">
  
  <select id="paymentMethod">
    <option value="gcash">GCash</option>
    <option value="paymaya">PayMaya</option>
    <option value="bank">Bank Transfer</option>
  </select>
  
  <button type="button" onclick="createPayment()">Create Payment</button>
</form>

<script>
async function createPayment() {
  const response = await fetch('http://localhost:8000/api/xendit/create-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: parseFloat(document.getElementById('amount').value),
      email: document.getElementById('email').value,
      bookingId: 'TEST-' + Date.now(),
      customerName: document.getElementById('customerName').value,
      paymentMethod: document.getElementById('paymentMethod').value
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Redirect to payment page
    window.location.href = data.invoice_url;
  } else {
    alert('Error: ' + data.error);
  }
}
</script>
```

---

## Common Issues & Solutions

### Issue: "Payment service not configured"
**Cause:** API key not set in `.env`
**Solution:** Add `XENDIT_SECRET_KEY` or `PAYMONGO_SECRET_KEY` to `.env` and restart server

### Issue: Payment link created but customer sees error
**Cause:** Frontend URL incorrect in .env
**Solution:** Update `FRONTEND_URL` in `.env` to match your frontend URL

### Issue: Webhook not received
**Cause:** Webhook URL not configured in payment gateway dashboard
**Solution:** 
1. Go to Xendit/PayMongo dashboard → Settings → Webhooks
2. Add webhook URL: `https://yourserver.com/api/xendit/webhook`
3. For testing locally: Use ngrok to expose local server
   ```bash
   ngrok http 8000
   # Use ngrok URL + /api/xendit/webhook in dashboard
   ```

### Issue: Currency mismatch errors
**Cause:** Sending amount in wrong format (should be PHP, not centavos to backend)
**Solution:** 
- Frontend sends: `{ amount: 5000 }` (in PHP)
- Backend converts: `amount * 100` = centavos for API
- PayMongo API expects centavos, backend returns PHP to frontend

---

**Document Generated:** April 25, 2026
**Status:** Both Xendit and PayMongo implementations are functional
