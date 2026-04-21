# Grouped Room Listing - Quick Integration Guide

## 📌 Files Created/Modified

### New Files
1. **`services/roomAssignmentService.js`** - Core business logic for room grouping and auto-assignment
2. **`GROUPED_ROOM_LISTING_SOLUTION.md`** - Comprehensive documentation (SQL, API, examples)
3. **`SETUP_GROUPED_ROOMS.sql`** - Database setup and indexes

### Modified Files
1. **`controllers/roomsController.js`**
   - Added import for `roomAssignmentService`
   - Added `getGroupedRooms()` endpoint

2. **`controllers/bookingsController.js`**
   - Added imports for `roomAssignmentService`
   - Added `createBookingWithAutoAssign()` endpoint

3. **`routes/rooms.js`**
   - Added import and route for `getGroupedRooms`
   - Route: `GET /api/rooms/grouped`

4. **`routes/bookings.js`**
   - Added import for `createBookingWithAutoAssign`
   - Added route: `POST /api/bookings/with-auto-assign`

---

## 🚀 Quick Start

### 1. Database Setup
```bash
# Run the setup SQL script
# Option A: Use phpMyAdmin
1. Go to phpMyAdmin > Select 'eduardos' database
2. SQL tab
3. Copy SETUP_GROUPED_ROOMS.sql content
4. Click "Go"

# Option B: Command line
mysql -u root -p eduardos < SETUP_GROUPED_ROOMS.sql
```

### 2. Test Grouped Rooms Endpoint
```bash
curl -X GET http://localhost:5000/api/rooms/grouped

# Expected Response:
# {
#   "success": true,
#   "data": [
#     {
#       "room_type": "FAMILY ROOM",
#       "price": 4500,
#       "available_count": 2,
#       "total_rooms": 3,
#       ...
#     }
#   ]
# }
```

### 3. Test Auto-Assign Booking
```bash
curl -X POST http://localhost:5000/api/bookings/with-auto-assign \
  -H "Content-Type: application/json" \
  -d '{
    "customer": {
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "09123456789",
      "address": "123 Main St",
      "city": "Manila",
      "postal_code": "1000"
    },
    "checkInDate": "2026-05-01",
    "checkOutDate": "2026-05-03",
    "roomType": "FAMILY ROOM",
    "paymentMethod": "GCash",
    "subtotal": 9000,
    "discount": 0,
    "tax": 900,
    "total": 9900
  }'

# Expected Response:
# {
#   "success": true,
#   "message": "Booking created successfully with auto-assigned room",
#   "data": {
#     "booking_id": 1,
#     "booking_reference": "BK20260421001",
#     "room_assigned": "FAMILY ROOM 1",
#     "item_id": 1,
#     "check_in_date": "2026-05-01",
#     "check_out_date": "2026-05-03",
#     "nights": 2,
#     "total": 9900
#   }
# }
```

---

## 📋 API Endpoints

### GET /api/rooms/grouped
**Purpose:** Get grouped room types for customer display

**Query Parameters:** None

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "room_type": "FAMILY ROOM",
      "price": 4500,
      "max_guests": 4,
      "description": "...",
      "available_count": 2,
      "total_rooms": 3,
      "primary_item_id": 1,
      "images": ["..."],
      "all_rooms": [...]
    }
  ]
}
```

---

### POST /api/bookings/with-auto-assign
**Purpose:** Create booking with automatic room assignment

**Request Body:**
```json
{
  "customer": {
    "first_name": "string",
    "last_name": "string",
    "email": "string",
    "phone": "string",
    "address": "string",
    "city": "string",
    "postal_code": "string"
  },
  "checkInDate": "2026-05-01",
  "checkOutDate": "2026-05-03",
  "roomType": "FAMILY ROOM",
  "paymentMethod": "Cash|GCash|PayMaya|etc",
  "subtotal": 9000,
  "discount": 0,
  "tax": 900,
  "total": 9900,
  "promoCode": "OPTIONAL"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Booking created successfully with auto-assigned room",
  "data": {
    "booking_id": 1,
    "booking_reference": "BK20260421001",
    "room_assigned": "FAMILY ROOM 1",
    "item_id": 1,
    "check_in_date": "2026-05-01",
    "check_out_date": "2026-05-03",
    "nights": 2,
    "total": 9900
  }
}
```

**Error Responses:**
- `400 Bad Request` - Missing required fields
- `409 Conflict` - No available rooms for date range
- `503 Service Unavailable` - System busy (lock timeout)

---

## 🔧 Configuration

### Transaction Isolation Level
The auto-assign function uses **SERIALIZABLE** isolation level for maximum safety:
```javascript
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE
```

This ensures:
- ✓ No dirty reads
- ✓ No non-repeatable reads
- ✓ No phantom reads
- ✓ Prevents double-booking race conditions

### Retry Logic (Recommended)
If you get a `503 Service Unavailable` error (lock timeout):
```javascript
async function bookWithRetry(bookingData, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await api.post('/api/bookings/with-auto-assign', bookingData);
    } catch (error) {
      if (error.status === 503 && attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
        continue;
      }
      throw error;
    }
  }
}
```

---

## 🧪 Testing

### Test 1: Verify Grouped Display Works
```sql
SELECT 
  SUBSTRING(name, 1, CHAR_LENGTH(name) - 2) AS room_type,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'Available' THEN 1 END) as available
FROM inventory_items
WHERE category_type = 'room'
GROUP BY SUBSTRING(name, 1, CHAR_LENGTH(name) - 2);
```

### Test 2: Verify No Double Booking
```sql
SELECT 
  ii.name,
  od.occupied_date,
  COUNT(*) as booking_count
FROM occupied_dates od
JOIN inventory_items ii ON od.inventory_item_id = ii.item_id
GROUP BY ii.name, od.occupied_date
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

### Test 3: Create Multiple Bookings Simultaneously
```javascript
const roomType = "FAMILY ROOM";
const requests = Array(5).fill(null).map(() => ({
  customer: { /* ... */ },
  checkInDate: "2026-05-01",
  checkOutDate: "2026-05-03",
  roomType: roomType,
  /* ... */
}));

// Fire all requests at once
Promise.all(requests.map(r => api.post('/api/bookings/with-auto-assign', r)))
  .then(results => {
    // Should assign FAMILY ROOM 1, 2, 3 to different bookings
    // and fail on 4th & 5th requests (no rooms available)
  });
```

---

## 📊 Performance Considerations

### Database Indexes
The solution uses indexes on:
- `inventory_items` (status, category_type, name)
- `occupied_dates` (inventory_item_id, occupied_date)
- `booking_items` (inventory_item_id, booking_id)

**Index Creation Time:** < 1 second per table
**Query Performance:** < 100ms for typical operations

### Scaling Notes
- Solution supports concurrent bookings via row-level locking
- Lock timeout default: 50 seconds (configurable via `innodb_lock_wait_timeout`)
- Recommended: 1-3 seconds for customer-facing operations
- Set via: `SET innodb_lock_wait_timeout = 3;`

---

## 🐛 Troubleshooting

### Issue: "Lock acquisition timeout" (503)
**Cause:** Too many concurrent bookings competing for same room
**Solution:**
1. Implement exponential backoff retry (see above)
2. Increase `innodb_lock_wait_timeout` in MySQL config
3. Add more available rooms of that type

### Issue: "No available rooms" (409)
**Cause:** All rooms of that type are booked for those dates
**Solution:**
1. Check occupied_dates table to confirm dates are booked
2. Offer alternative dates to customer
3. Suggest alternative room type

### Issue: Room shows as "Available" but can't book it
**Cause:** Occupied_dates entries exist without a booking_id
**Solution:**
```sql
-- Check for orphaned occupied_dates
SELECT * FROM occupied_dates WHERE booking_id IS NULL;

-- Clean up if needed (carefully!)
DELETE FROM occupied_dates WHERE booking_id IS NULL;
```

---

## 📚 Additional Resources

- **Full Documentation:** `GROUPED_ROOM_LISTING_SOLUTION.md`
- **Database Setup:** `SETUP_GROUPED_ROOMS.sql`
- **Service Code:** `services/roomAssignmentService.js`
- **Controller Code:** `controllers/roomsController.js`, `controllers/bookingsController.js`

---

## ✅ Implementation Checklist

- [ ] Run `SETUP_GROUPED_ROOMS.sql` in database
- [ ] Deploy `services/roomAssignmentService.js`
- [ ] Deploy updated `roomsController.js`
- [ ] Deploy updated `bookingsController.js`
- [ ] Update routes in `rooms.js` and `bookings.js`
- [ ] Test `GET /api/rooms/grouped` endpoint
- [ ] Test `POST /api/bookings/with-auto-assign` endpoint
- [ ] Create frontend component for grouped room display
- [ ] Implement retry logic in frontend booking form
- [ ] Load test with concurrent bookings
- [ ] Monitor error logs in production

---

## 🎯 Next Steps

1. **Frontend Component:** Create Vue component to display grouped rooms
2. **Booking Form:** Integrate auto-assign endpoint with existing form
3. **Availability Calendar:** Add date picker to show booked dates
4. **Confirmation Page:** Display assigned room details after booking
5. **Admin Dashboard:** Show room status and occupancy by type
