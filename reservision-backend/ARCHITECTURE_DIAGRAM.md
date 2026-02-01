# 📊 Bookings System Architecture

## 🏗️ System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      RESERVATION SYSTEM                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend   │ ───► │   Backend    │ ───► │   Database   │
│  Vue.js App  │ ◄─── │  Express API │ ◄─── │    MySQL     │
└──────────────┘      └──────────────┘      └──────────────┘
  Port: 5173           Port: 8000           eduardos
```

---

## 📁 File Structure

```
cap2/CAPSTONE_BACKEND/reservision-backend/
│
├── server.js                      ← Main server file
├── config/
│   └── db.js                      ← Database connection
│
├── controllers/
│   └── bookingsController.js      ← Booking logic ⭐ NEW
│
├── routes/
│   └── bookings.js                ← API endpoints ⭐ NEW
│
└── schema/
    └── bookings.sql               ← Database schema ⭐ NEW

cap/CAPSTONE_FRONTEND/reservision/
│
└── src/
    └── views/
        └── website/
            └── Reservation.vue    ← Updated ⭐ MODIFIED
```

---

## 🔄 Data Flow Diagram

### Loading Reservation Page

```
┌─────────────────────┐
│  User Opens Page    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Reservation.vue    │
│  mounted()          │
└──────────┬──────────┘
           │
           ├──► fetchInventoryItems() ──────┐
           │                                  │
           └──► fetchOccupiedDates() ────┐   │
                                          │   │
           ┌──────────────────────────────┘   │
           │                                  │
           ▼                                  ▼
    GET /api/bookings/occupied-dates   GET /api/rooms
           │                                  │
           ▼                                  ▼
    ┌──────────────────┐           ┌──────────────────┐
    │ Backend API      │           │ Backend API      │
    │ getOccupiedDates │           │ getRooms         │
    └────────┬─────────┘           └────────┬─────────┘
             │                               │
             ▼                               ▼
    SELECT * FROM                   SELECT * FROM
    occupied_dates                  inventory_items
             │                               │
             └───────────┬───────────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │  JSON Data   │
                 │  Returns to  │
                 │  Frontend    │
                 └──────┬───────┘
                        │
                        ▼
                ┌──────────────┐
                │  Display on  │
                │  Page        │
                └──────────────┘
```

### Creating a Booking

```
┌─────────────────────┐
│  User Fills Form    │
│  - Selects items    │
│  - Picks dates      │
│  - Enters contact   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Click "Confirm"    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  submitContactForm()│
│  - Validates data   │
│  - Formats dates    │
└──────────┬──────────┘
           │
           ▼
    POST /api/bookings
    {
      customer: {...},
      contact: {...},
      items: [...],
      checkIn: "2026-02-15",
      checkOut: "2026-02-17"
    }
           │
           ▼
┌─────────────────────┐
│  Backend API        │
│  createBooking()    │
└──────────┬──────────┘
           │
           ▼
    BEGIN TRANSACTION
           │
           ├──► INSERT INTO bookings
           │    (customer info, dates, totals)
           │    Returns: booking_id
           │
           ├──► INSERT INTO booking_items
           │    (item details, prices)
           │    For each item in booking
           │
           ├──► INSERT INTO occupied_dates
           │    (prevent double bookings)
           │    For each date in range
           │
           └──► INSERT INTO booking_logs
                (audit trail)
           │
           ▼
    COMMIT TRANSACTION
           │
           ▼
    Return booking_reference
    "BK20260201001"
           │
           ▼
┌─────────────────────┐
│  Show Confirmation  │
│  Modal with         │
│  Booking Reference  │
└─────────────────────┘
```

---

## 🗄️ Database Schema

```
┌─────────────────────────────────────────┐
│              bookings                   │ Main table
├─────────────────────────────────────────┤
│ PK  booking_id                          │
│     booking_reference (UNIQUE)          │
│     first_name, last_name               │
│     email, phone                        │
│     address, city, country              │
│     check_in_date, check_out_date       │
│     nights, adults, children            │
│     subtotal, total                     │
│     booking_status, payment_status      │
└───────────────┬─────────────────────────┘
                │ 1
                │
                │ many
                ▼
┌─────────────────────────────────────────┐
│           booking_items                 │ Items in booking
├─────────────────────────────────────────┤
│ PK  item_id                             │
│ FK  booking_id                          │
│ FK  inventory_item_id (optional)        │
│     item_type (Room/Cottage/Food/Event) │
│     item_name, item_description         │
│     unit_price, quantity, nights        │
│     total_price, guests                 │
│     per_night (boolean)                 │
└─────────────────────────────────────────┘
                │ 1
                │
                │ many
                ▼
┌─────────────────────────────────────────┐
│          occupied_dates                 │ Prevent double booking
├─────────────────────────────────────────┤
│ PK  id                                  │
│ FK  inventory_item_id                   │
│ FK  booking_id                          │
│     occupied_date                       │
│     UNIQUE(inventory_item_id, date)     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           booking_logs                  │ Audit trail
├─────────────────────────────────────────┤
│ PK  log_id                              │
│ FK  booking_id                          │
│     action, old_status, new_status      │
│     description, performed_by           │
│     created_at                          │
└─────────────────────────────────────────┘
```

---

## 🔌 API Endpoints

```
┌──────────────────────────────────────────────────────────┐
│                     API Routes                           │
└──────────────────────────────────────────────────────────┘

GET    /api/bookings
       ├─ Query params: status, email, startDate, endDate
       └─ Returns: Array of all bookings

GET    /api/bookings/:id
       └─ Returns: Single booking with items

GET    /api/bookings/reference/:reference
       └─ Returns: Booking by reference number

POST   /api/bookings
       ├─ Body: customer, contact, items, dates
       └─ Returns: Created booking with reference

PUT    /api/bookings/:id
       ├─ Body: booking_status, payment_status
       └─ Returns: Updated booking

DELETE /api/bookings/:id
       └─ Returns: Success message

GET    /api/bookings/occupied-dates
       └─ Returns: All occupied dates

GET    /api/bookings/occupied-dates/:itemId
       └─ Returns: Occupied dates for specific item
```

---

## 🎯 Request/Response Examples

### Create Booking Request

```javascript
POST /api/bookings

{
  "customer": {
    "firstName": "Juan",
    "lastName": "Dela Cruz"
  },
  "contact": {
    "email": "juan@email.com",
    "phone": "+639171234567",
    "address": "123 Main St",
    "city": "Manila",
    "country": "Philippines",
    "postal": "1000"
  },
  "checkIn": "2026-02-15",
  "checkOut": "2026-02-17",
  "nights": 2,
  "adults": 2,
  "children": 0,
  "items": [
    {
      "item": {
        "item_id": 1,
        "name": "Deluxe Ocean View",
        "price": 3500,
        "category": "Room",
        "perNight": true
      },
      "qty": 1,
      "guests": 2
    }
  ],
  "total": 7000,
  "subtotal": 7000
}
```

### Create Booking Response

```javascript
{
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "booking_id": 1,
    "booking_reference": "BK20260201001",
    "first_name": "Juan",
    "last_name": "Dela Cruz",
    "email": "juan@email.com",
    "phone": "+639171234567",
    "total": 7000.00,
    "booking_status": "Pending",
    "payment_status": "Unpaid",
    "created_at": "2026-02-01T06:04:44.000Z",
    "items": [
      {
        "item_id": 1,
        "item_name": "Deluxe Ocean View",
        "unit_price": 3500.00,
        "quantity": 1,
        "nights": 2,
        "total_price": 7000.00
      }
    ]
  }
}
```

---

## 🔐 Data Integrity Features

```
┌────────────────────────────────────────┐
│     Transaction Management             │
│  ─────────────────────────────────────│
│  BEGIN TRANSACTION                     │
│    ├─ Insert booking                   │
│    ├─ Insert booking items             │
│    ├─ Insert occupied dates            │
│    └─ Insert logs                      │
│  COMMIT (if all succeed)               │
│  ROLLBACK (if any fails)               │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│     Unique Constraints                 │
│  ─────────────────────────────────────│
│  • booking_reference must be unique    │
│  • Can't book same item on same date   │
│    (inventory_item_id + date)          │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│     Foreign Key Constraints            │
│  ─────────────────────────────────────│
│  • booking_items → bookings            │
│  • occupied_dates → bookings           │
│  • booking_logs → bookings             │
│  CASCADE DELETE: Removing booking      │
│  removes all related items, dates, logs│
└────────────────────────────────────────┘
```

---

## 🚦 Status Flow

```
Booking Creation Flow:
┌─────────┐    ┌───────────┐    ┌────────────┐    ┌──────────────┐
│ Pending │ ──►│ Confirmed │ ──►│ Checked-In │ ──►│ Checked-Out  │
└─────────┘    └───────────┘    └────────────┘    └──────────────┘
     │
     │
     ▼
┌───────────┐
│ Cancelled │
└───────────┘

Payment Status Flow:
┌────────┐    ┌──────────────────┐    ┌──────┐
│ Unpaid │ ──►│ Partially Paid   │ ──►│ Paid │
└────────┘    └──────────────────┘    └──────┘
     │                                      │
     │                                      ▼
     │                              ┌───────────┐
     └─────────────────────────────►│ Refunded  │
                                    └───────────┘
```

---

## 📈 Performance Features

```
Indexes Created:
  bookings:
    ✓ booking_reference (UNIQUE)
    ✓ email
    ✓ booking_status
    ✓ check_in_date
    ✓ check_out_date
    ✓ created_at

  booking_items:
    ✓ booking_id
    ✓ item_type

  occupied_dates:
    ✓ inventory_item_id
    ✓ booking_id
    ✓ occupied_date
    ✓ (inventory_item_id, occupied_date) UNIQUE

  booking_logs:
    ✓ booking_id
    ✓ created_at
```

---

This architecture ensures:
- ✅ Data consistency through transactions
- ✅ No double bookings through unique constraints
- ✅ Fast queries through proper indexing
- ✅ Complete audit trail through logs
- ✅ Data integrity through foreign keys
