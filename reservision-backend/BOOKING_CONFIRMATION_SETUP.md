# Booking Confirmation Backend Setup

## 📋 Overview
Complete backend system for the Booking Confirmation page with:
- ✅ Customer information management
- ✅ Booking creation with items
- ✅ Payment tracking (PayMongo integration)
- ✅ Transaction management

## 🗄️ Database Setup

### 1. Run SQL Scripts (in order)
Open phpMyAdmin or MySQL client and run:

```sql
-- 1. Create customers table
SOURCE C:/xampp/htdocs/cap2/CAPSTONE_BACKEND/reservision-backend/schema/customers.sql;

-- 2. Add customer fields to bookings table
SOURCE C:/xampp/htdocs/cap2/CAPSTONE_BACKEND/reservision-backend/schema/bookings_customer_fields.sql;

-- 3. Create payments table
SOURCE C:/xampp/htdocs/cap2/CAPSTONE_BACKEND/reservision-backend/schema/payments.sql;
```

Or manually run each file in phpMyAdmin → SQL tab

## 📡 API Endpoints

### Create Booking Confirmation
```
POST /api/bookings/confirm
```

**Request Body:**
```json
{
  "guest": {
    "firstName": "Juan",
    "lastName": "Dela Cruz",
    "email": "juan@example.com",
    "phone": "+639123456789",
    "address": "123 Resort St.",
    "city": "Calapan",
    "country": "Philippines",
    "postal": "5200",
    "adults": 2,
    "children": 0,
    "arrivalTime": "3 PM",
    "specialRequests": "Late check-in"
  },
  "checkIn": "2026-02-15",
  "checkOut": "2026-02-17",
  "items": [
    {
      "item_id": 29,
      "qty": 1,
      "guests": 2,
      "price": 3500,
      "perNight": true
    }
  ],
  "paymentMethod": "gcash",
  "total": 7000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "bookingId": 123,
    "bookingReference": "EDU12345678",
    "customerId": 45,
    "paymentId": 67,
    "paymentReference": "PAY123456",
    "total": 7000,
    "status": "pending"
  }
}
```

### Update Payment Status
```
POST /api/bookings/update-payment
```

**Request Body:**
```json
{
  "bookingId": 123,
  "paymentReference": "PAY123456",
  "status": "paid",
  "paymentIntentId": "pi_xxxxx",
  "checkoutUrl": "https://checkout.paymongo.com/..."
}
```

### Get Booking Details
```
GET /api/bookings/:id/details
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "booking_reference": "EDU12345678",
    "first_name": "Juan",
    "last_name": "Dela Cruz",
    "email": "juan@example.com",
    "phone": "+639123456789",
    "payment_reference": "PAY123456",
    "payment_method": "gcash",
    "payment_amount": 7000,
    "payment_status": "paid",
    "items": [...]
  }
}
```

## 🔄 Frontend Integration

The BookingConfirmation.vue has been updated to:
1. ✅ Create booking in database with customer info
2. ✅ Create payment record
3. ✅ Generate PayMongo checkout link
4. ✅ Update payment status
5. ✅ Store booking reference in localStorage

## 🧪 Testing

### 1. Start Backend Server
```bash
cd C:\xampp\htdocs\cap2\CAPSTONE_BACKEND\reservision-backend
npm start
```

### 2. Test Booking Creation
Use Postman or browser:
```javascript
fetch('http://localhost:8000/api/bookings/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guest: { firstName: "Test", lastName: "User", email: "test@test.com", ... },
    checkIn: "2026-03-01",
    checkOut: "2026-03-03",
    items: [{ item_id: 29, qty: 1, guests: 2, price: 3500, perNight: true }],
    paymentMethod: "gcash",
    total: 7000
  })
})
```

### 3. Verify in Database
Check phpMyAdmin:
- `customers` table - new customer created
- `bookings` table - booking with customer_id
- `booking_items` table - items added
- `occupied_dates` table - dates blocked
- `payments` table - payment record created

## 📊 Database Schema

### customers
- `customer_id` - Auto increment
- `first_name`, `last_name`, `email`, `phone`
- `address`, `city`, `country`, `postal_code`
- `created_at`, `updated_at`

### bookings (enhanced)
- `customer_id` - Foreign key to customers
- `adults`, `children`, `arrival_time`
- `special_requests` - Text field for guest notes

### payments
- `payment_id` - Auto increment
- `booking_id` - Foreign key to bookings
- `customer_id` - Foreign key to customers
- `payment_reference` - Unique payment ref
- `payment_method` - Enum (paymaya, gcash, bank, card, cash)
- `amount`, `status`, `paid_at`
- `checkout_url`, `payment_intent_id` - PayMongo fields

## 🚀 Next Steps

1. Run SQL scripts to create tables ✅
2. Restart backend server ✅
3. Test booking creation endpoint ✅
4. Integrate PayMongo webhook for automatic status updates
5. Add email confirmation (future enhancement)

## 💡 Notes

- All operations are wrapped in database transactions
- If booking creation fails, everything rolls back
- Customer info is reused if email already exists
- Payment status can be: `pending`, `paid`, `failed`, `refunded`, `expired`
- Booking status updates to `confirmed` when payment is `paid`
