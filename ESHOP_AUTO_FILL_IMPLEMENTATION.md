# E-Shop Auto-Fill Room Number Implementation

**Date:** May 8, 2026  
**Goal:** Automatically fill the delivery location (room number) from the logged-in customer's current checked-in booking.

---

## Overview

When a logged-in customer with an active checked-in booking opens the E-Shop checkout, the delivery location (room number) is automatically fetched and filled, preventing the need for manual entry.

### Key Features:
- ✅ Auto-detect currently checked-in room/cottage
- ✅ Lock delivery location to prevent manual changes
- ✅ Show loading state while fetching room data
- ✅ Show success message when room is auto-detected
- ✅ Track delivery source (`checked_in_room` vs `manual`) in orders
- ✅ Fallback to manual entry if no active room found

---

## Implementation Details

### 1. Backend Endpoint

**New Endpoint:** `GET /api/bookings/customer/:userId/current-room`

**Location:** `reservision-backend/routes/bookings.js` & `controllers/bookingsController.js`

**Function:** `getCustomerCurrentRoom()`

**SQL Query:**
```sql
SELECT ii.room_number
FROM bookings b
JOIN customers c ON c.customer_id = b.customer_id
JOIN booking_items bi ON bi.booking_id = b.booking_id
JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
WHERE c.user_id = ?
  AND LOWER(REPLACE(b.booking_status, '-', '_')) = 'checked_in'
  AND LOWER(ii.category_type) = 'room'
ORDER BY b.actual_check_in_time DESC, b.check_in_date DESC
LIMIT 1;
```

**Response (Success):**
```json
{
  "success": true,
  "room_number": "101"
}
```

**Response (No Active Room):**
```json
{
  "success": false,
  "room_number": null,
  "message": "No current checked-in room found."
}
```

**Error Response:**
```json
{
  "success": false,
  "room_number": null,
  "message": "Failed to fetch current room number",
  "error": "error message"
}
```

---

### 2. Frontend Component Updates

**File:** `CAPSTONE_FRONTEND/reservision/src/components/Customer/ResortEShop.vue`

#### State Management
```javascript
const activeStayLoading = ref(false)  // Loading indicator
const activeStayError   = ref('')    // Error message
const locationLocked    = ref(false) // Lock delivery location when auto-filled
const locationNumber    = ref('')    // Room/Cottage number
const currentLocType    = ref('Room') // Type: Room, Cottage, or Day Guest
```

#### Fetch Function
```javascript
const fetchCurrentCheckedInRoom = async () => {
  // Calls /api/bookings/customer/:userId/current-room
  // On success:
  //   - Sets currentLocType = 'Room'
  //   - Sets locationNumber = room_number
  //   - Sets locationSaved = true
  //   - Sets locationLocked = true
}
```

#### Component Lifecycle
- Called in `onMounted()` automatically when component loads
- Shows loading spinner while fetching
- Displays success message when room is detected
- Locks input fields to prevent changes

---

### 3. Template Changes

#### Delivery Location Input
- **Readonly State:** When `locationLocked = true`, input is disabled
- **Loading State:** Shows "Checking current room..." with spinner icon
- **Success State:** Shows "Room number automatically detected from your current checked-in booking."

#### Location Type Selection
- **Disabled When Locked:** Room/Cottage buttons are disabled when auto-filled
- **Visual Feedback:** `.disabled` class applied when locked

#### Confirm Location Button
- **Text Changes:**
  - Normal: "Confirm Location"
  - Confirmed: "✓ Location Confirmed"  
  - Locked (Auto-filled): "Current Location Confirmed"
- **Disabled When Locked:** Button is disabled and styled differently

#### Removed Features
- Removed active-stay card that previously showed booking details
- Simplified to show only room number auto-fill

---

### 4. Order Payload Changes

When placing order, the payload now includes:
```javascript
{
  cart: [...],
  locationType: 'Room',        // Auto-set if room found
  locationNumber: '101',       // Auto-filled from endpoint
  deliveryNotes: '...',        // Optional special instructions
  totalAmount: 1500,           // Order total
  customerId: 1,               // Logged-in user's ID
  deliverySource: 'checked_in_room' // or 'manual' if user entered manually
}
```

**Key Field:** `deliverySource`
- `'checked_in_room'` - Auto-filled from checked-in booking
- `'manual'` - Manually entered by customer

---

### 5. Database Columns

**Table:** `pos_transactions`

New columns added (via migration):
- `delivery_source` - Track origin of delivery location
- `active_booking_id` - Reference to bookings table (optional)
- `booking_reference` - Booking reference number (optional)

**Migration File:** `ADD_ACTIVE_BOOKING_TO_POS_TRANSACTIONS.sql`

---

### 6. CSS Styling

#### Auto-Location Note
```css
.auto-location-note {
  margin-top: 0.35rem;
  font-size: 0.72rem;
  color: #059669;           /* Green for success state */
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.auto-location-note.loading {
  color: #0369a1;           /* Blue for loading state */
}
```

#### Disabled State
```css
.disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
```

#### Button States
```css
.confirm-loc-btn.locked {
  opacity: 0.7;
  cursor: default;
}
.confirm-loc-btn.locked:hover {
  background: #059669;
  transform: none;
}
```

---

## User Flow

### Scenario 1: Customer Has Active Checked-In Room

1. **Load E-Shop:** Customer opens E-Shop checkout
2. **Auto-Fetch:** `fetchCurrentCheckedInRoom()` is called
3. **Loading:** Shows "Checking current room..." with spinner
4. **Success:** Room number auto-fills (e.g., "101")
5. **Location Locked:** Input becomes readonly, buttons disabled
6. **Ready to Order:** Shows "Current Location Confirmed"
7. **Place Order:** Sends `deliverySource: 'checked_in_room'`

### Scenario 2: Customer Has No Active Checked-In Room

1. **Load E-Shop:** Customer opens E-Shop checkout
2. **Auto-Fetch:** `fetchCurrentCheckedInRoom()` is called
3. **No Room Found:** Endpoint returns `success: false`
4. **Manual Entry:** Location stays unlocked, customer enters manually
5. **Confirm:** Customer clicks "Confirm Location"
6. **Place Order:** Sends `deliverySource: 'manual'`

---

## Files Modified

### Backend
1. **`reservision-backend/controllers/bookingsController.js`**
   - Added: `getCustomerCurrentRoom()` function

2. **`reservision-backend/routes/bookings.js`**
   - Added: Import for `getCustomerCurrentRoom`
   - Added: `GET /api/bookings/customer/:userId/current-room` route

3. **`reservision-backend/ADD_ACTIVE_BOOKING_TO_POS_TRANSACTIONS.sql`**
   - Created: Database migration for new columns

### Frontend
1. **`CAPSTONE_FRONTEND/reservision/src/components/Customer/ResortEShop.vue`**
   - Updated: `fetchCurrentCheckedInRoom()` function (replaced old `fetchActiveCheckedInLocation`)
   - Updated: `onMounted()` hook
   - Updated: `placeOrder()` payload
   - Updated: `saveLocation()` logic
   - Updated: Template - removed activeStay card, updated loading/success messages
   - Updated: CSS - added `.auto-location-note` and `.disabled` styles

---

## Testing Checklist

- [ ] Run SQL migration to add new columns
- [ ] Start backend server
- [ ] Verify endpoint: `GET http://localhost:8000/api/bookings/customer/1/current-room`
- [ ] Login with customer that has active checked-in booking
- [ ] Open E-Shop and go to checkout
- [ ] Verify room number auto-fills
- [ ] Verify location is locked
- [ ] Verify "Checking current room..." message appears briefly
- [ ] Verify "Room number automatically detected..." message displays
- [ ] Verify location type buttons are disabled
- [ ] Verify confirm button shows "Current Location Confirmed"
- [ ] Place order and verify `deliverySource: 'checked_in_room'` is sent
- [ ] Login with customer with NO active booking
- [ ] Verify location remains manual
- [ ] Manually enter room number and place order
- [ ] Verify `deliverySource: 'manual'` is sent

---

## API Reference

### Get Current Room Number
```
GET /api/bookings/customer/:userId/current-room

Headers: None required
Params: userId (from logged-in user)

Success Response (200):
{
  "success": true,
  "room_number": "101"
}

Not Found Response (200):
{
  "success": false,
  "room_number": null,
  "message": "No current checked-in room found."
}

Error Response (500):
{
  "success": false,
  "room_number": null,
  "message": "Failed to fetch current room number",
  "error": "database error details"
}
```

---

## Relationship Map

```
users.user_id
  ↓
customers.user_id
  ↓
bookings.customer_id
  ↓
booking_items.booking_id
  ↓
booking_items.inventory_item_id → inventory_items.item_id
  ↓
inventory_items.room_number (THE FINAL VALUE)
```

---

## Notes

- Endpoint only returns `room_number`, keeping it lightweight
- SQL uses exact relationship path specified by user
- Filters for `booking_status = 'checked_in'` to get only active stays
- Filters for `category_type = 'room'` to exclude cottages
- Orders by check-in time to get most recent booking
- Frontend gracefully falls back to manual entry if no room found
- Delivery source tracking helps restaurant staff identify auto-filled orders

---

## Future Enhancements

- [ ] Support for cottages (currently only fetches rooms)
- [ ] Allow editing of auto-filled room number with confirmation
- [ ] Show booking reference and check-out date
- [ ] Add notification when customer checks out (updates auto-fill)
