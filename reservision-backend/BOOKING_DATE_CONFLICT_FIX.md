# 📅 Booking Date Conflict Prevention Guide

## 🔴 The Problem

When a user selected a date that was already fully booked for an item, the system would crash with:
```
Booking confirmation error: Error: Duplicate entry '4-2026-02-28' for key 'unique_item_date'
```

This happened because the **occupied_dates table has a UNIQUE constraint** on `(inventory_item_id, occupied_date)`, preventing duplicate date bookings.

---

## 🔄 The Flow of Occupied Dates

### **1. What is `occupied_dates` Table?**
- Stores which dates are booked for which items
- **Unique Constraint**: `(inventory_item_id, occupied_date)` - one booking per item per date
- Used to prevent double-booking

```sql
CREATE TABLE occupied_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventory_item_id INT NOT NULL,
  booking_id INT NOT NULL,
  occupied_date DATE NOT NULL,
  UNIQUE KEY unique_item_date (inventory_item_id, occupied_date),
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
);
```

### **2. How Dates Get Added**
When a booking is created with check-in/checkout dates:
- System generates a row for **each day** of the stay
- Each row = 1 item + 1 date combination
- Prevents multiple people from booking the same item on the same day

**Example:**
```
Item: Family Room (ID: 4)
Check-in: 2026-02-27
Check-out: 2026-03-01

Creates these occupied_dates:
- (4, 2026-02-27)
- (4, 2026-02-28)
- (4, 2026-03-01) ← Wait, this is checkout day. Should not be included
```

---

## ✅ The Solution (3-Layer Validation)

### **Layer 1: Frontend Calendar Validation**
**File:** `Reservation.vue`

When user selects an item to book:
```javascript
// When item is added to booking
addToBooking(item, qty, guests) {
  // ... existing code
  
  // NEW: Fetch occupied dates for THIS SPECIFIC item
  if (item.perNight && item.item_id) {
    this.fetchOccupiedDatesForItem(item.item_id)
  }
}
```

The calendar then **disabled unavailable dates**:
```javascript
isDisabled(date) {
  // Disable past dates
  if (date < today) return true
  
  // Disable if this specific date is occupied
  return this.occupiedDates.some(occ => 
    occ.inventoryItemId === currentItemId && 
    occ.occupiedDate === selectedDate
  )
}
```

---

### **Layer 2: Frontend Checkout Validation**
**File:** `Reservation.vue`

Before submitting to backend, validate dates:
```javascript
proceedToCheckout() {
  // NEW: Validate selected dates against occupied dates
  const conflicts = this.validateBookingDates()
  
  if (conflicts.length > 0) {
    alert("❌ Conflict! These dates are already booked:\n" + conflicts)
    return // Stop before sending to backend
  }
  
  // All good - proceed to confirmation page
}
```

---

### **Layer 3: Backend Date Conflict Check**
**File:** `bookingConfirmationController.js`

**Before inserting occupied dates, check for conflicts:**

```javascript
// Add occupied dates for rooms/cottages
if (item.perNight && checkIn && checkOut && !item.swimmingDetails) {
  const dates = [] // Generate all dates
  const itemId = item.item_id || item.id
  
  // ✅ NEW: Check if ANY dates are already occupied
  const [conflictingDates] = await connection.query(
    `SELECT DISTINCT occupied_date FROM occupied_dates 
     WHERE inventory_item_id = ? AND occupied_date IN (?)`,
    [itemId, dateStrings]
  )
  
  // If conflicts found, reject the booking
  if (conflictingDates.length > 0) {
    await connection.rollback()
    return res.status(409).json({
      success: false,
      error: 'Some dates have already been booked',
      conflict_dates: conflictingDates.map(d => d.occupied_date),
      item_id: itemId,
      item_name: itemName
    })
  }
  
  // All good - insert occupied dates safely
  await connection.query(
    'INSERT INTO occupied_dates (...) VALUES ?',
    [dates]
  )
}
```

---

### **Layer 4: Frontend Error Handling**
**File:** `BookingConfirmation.vue`

If backend returns 409 conflict error:
```javascript
async payNow() {
  try {
    const bookingResponse = await fetch('.../api/bookings/confirm')
    const bookingResult = await bookingResponse.json()
    
    // Handle 409 Conflict
    if (bookingResponse.status === 409) {
      const conflictDates = bookingResult.conflict_dates
        .map(d => new Date(d).toLocaleDateString())
        .join(', ')
      
      alert(`⚠️ Date Conflict!\n\nItem: ${bookingResult.item_name}\nConflict Dates: ${conflictDates}\n\nPlease select different dates.`)
      return
    }
    
    // Process booking...
  } catch (err) {
    // Handle other errors
  }
}
```

---

## 🔌 Backend API Endpoints

### **Get Occupied Dates for Specific Item**
```
GET /api/bookings/occupied-dates/:itemId

Response:
{
  success: true,
  data: [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01"
  ]
}
```

### **Create Booking with Validation**
```
POST /api/bookings/confirm

If conflict detected:
Status: 409 Conflict
{
  success: false,
  error: "Some dates have already been booked",
  conflict_dates: ["2026-02-28"],
  item_id: 4,
  item_name: "Family Room"
}
```

---

## 📊 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: User Selects Item                                 │
│ - calls addToBooking(item)                                  │
│ - calls fetchOccupiedDatesForItem(item.item_id)            │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND: Fetch Occupied Dates                               │
│ GET /api/bookings/occupied-dates/:itemId                    │
│ Returns: ["2026-02-27", "2026-02-28"]                       │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: Calendar Display                                  │
│ - Disables dates: 2026-02-27, 2026-02-28                   │
│ - User can only select available dates                      │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: Proceed to Checkout                               │
│ - validateBookingDates() checks selected dates              │
│ - If conflict found → Show error, stop                      │
│ - If OK → Send to backend                                   │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND: Create Booking Confirmation                        │
│ - Generate occupied dates for booking                       │
│ - Check for conflicts BEFORE inserting                      │
│ - If conflict → Return 409 error                            │
│ - If OK → Insert dates + Create booking                     │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND: Handle Response                                   │
│ - If 409 error → Show user-friendly conflict message        │
│ - If success → Proceed to payment                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧪 Testing the Fix

### **Test Case 1: Calendar Date Blocking**
1. Add "Family Room" to booking
2. Open calendar
3. ✅ Previously booked dates should be disabled (strikethrough)
4. ✅ Only available dates are clickable

### **Test Case 2: Frontend Validation**
1. Select item with occupied date range (e.g., 2026-02-27 to 2026-02-28)
2. Click "Proceed to Checkout"
3. ✅ Error message: "Date Conflict! These dates are already booked..."
4. ✅ Booking doesn't proceed to confirmation page

### **Test Case 3: Backend Validation**
1. Somehow bypass frontend (or another user books same date simultaneously)
2. POST to `/api/bookings/confirm` with conflicting dates
3. ✅ Backend returns 409 error with conflict details
4. ✅ No duplicate entry error, database stays clean

---

## 📝 Changes Made

### **Backend Files**
- ✏️ `controllers/bookingConfirmationController.js` - Added occupied date validation before INSERT
- ✏️ `controllers/bookingsController.js` - Added `getBookingQRCode` function

### **Frontend Files**
- ✏️ `views/website/Reservation.vue`:
  - Added `fetchOccupiedDatesForItem()` method
  - Added `validateBookingDates()` method
  - Added `getDateRange()` helper
  - Updated `addToBooking()` to fetch specific item dates
  - Updated `proceedToCheckout()` to validate before sending
  
- ✏️ `components/BookingConfirmation.vue`:
  - Added 409 conflict error handling in `payNow()`
  - Improved error messages

---

## 🚀 Result

✅ **No more duplicate entry errors**  
✅ **Better user experience** - users see conflicts early  
✅ **Prevents race conditions** - backend validates too  
✅ **Clean error messages** - users understand what went wrong  
✅ **Data integrity** - database stays clean  

---

## 🔍 SQL Query to Check Occupied Dates

```sql
-- See all booked dates for an item
SELECT * FROM occupied_dates 
WHERE inventory_item_id = 4 
ORDER BY occupied_date;

-- See all bookings + occupied dates
SELECT 
  b.booking_id,
  b.booking_reference,
  b.check_in_date,
  b.check_out_date,
  od.inventory_item_id,
  od.occupied_date
FROM bookings b
LEFT JOIN occupied_dates od ON b.booking_id = od.booking_id
WHERE b.booking_id = 73
ORDER BY od.occupied_date;
```

---

**Last Updated:** February 28, 2026
