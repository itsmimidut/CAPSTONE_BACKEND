# 📌 Code Reference - Date Conflict Fix

## Backend Implementation

### Backend Validation (bookingConfirmationController.js)

**For Regular Rooms/Cottages:**
```javascript
// Add occupied dates for rooms/cottages (skip for swimming - already handled above)
if (item.perNight && checkIn && checkOut && !item.swimmingDetails) {
  const dates = [];
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const itemId = item.item_id || item.id;

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    dates.push([
      itemId,
      bookingId,
      d.toISOString().split('T')[0]
    ]);
  }

  if (dates.length > 0) {
    // ✅ VALIDATION: Check if any dates are already occupied BEFORE inserting
    const dateStrings = dates.map(d => d[2]);
    const [conflictingDates] = await connection.query(
      `SELECT DISTINCT occupied_date FROM occupied_dates 
       WHERE inventory_item_id = ? AND occupied_date IN (?)`,
      [itemId, dateStrings]
    );

    // 🛑 IF CONFLICT FOUND - REJECT BOOKING
    if (conflictingDates.length > 0) {
      await connection.rollback();
      const conflictDates = conflictingDates.map(d => d.occupied_date).join(', ');
      console.error(`❌ Date conflict for item ${itemId}: ${conflictDates}`);
      return res.status(409).json({
        success: false,
        error: 'Some dates have already been booked',
        conflict_dates: conflictingDates.map(d => d.occupied_date),
        item_id: itemId,
        item_name: itemName
      });
    }

    // ✅ ALL DATES AVAILABLE - PROCEED WITH INSERT
    await connection.query(
      'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES ?',
      [dates]
    );
    console.log(`✅ Added ${dates.length} dates to occupied_dates for item ${itemId}`);
  }
}
```

**For Swimming Sessions:**
```javascript
// Add swimming session dates as occupied dates
if (item.swimmingDetails && item.swimmingDetails.dates && item.swimmingDetails.dates.length > 0) {
  if (numericItemId) {
    const swimmingDates = item.swimmingDetails.dates.map(date => [
      numericItemId,
      bookingId,
      date
    ]);

    // ✅ VALIDATION: Check if any swimming dates are already occupied
    const dateStrings = swimmingDates.map(d => d[2]);
    const [conflictingDates] = await connection.query(
      `SELECT DISTINCT occupied_date FROM occupied_dates 
       WHERE inventory_item_id = ? AND occupied_date IN (?)`,
      [numericItemId, dateStrings]
    );

    // 🛑 IF CONFLICT FOUND - REJECT BOOKING  
    if (conflictingDates.length > 0) {
      await connection.rollback();
      const conflictDates = conflictingDates.map(d => d.occupied_date).join(', ');
      console.error(`❌ Swimming date conflict for item ${numericItemId}: ${conflictDates}`);
      return res.status(409).json({
        success: false,
        error: 'Some swimming session dates have already been booked',
        conflict_dates: conflictingDates.map(d => d.occupied_date),
        item_id: numericItemId,
        item_name: itemName
      });
    }

    // ✅ ALL DATES AVAILABLE - PROCEED WITH INSERT
    await connection.query(
      'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES ?',
      [swimmingDates]
    );
    console.log(`🏊 Added ${swimmingDates.length} swimming session dates to occupied_dates`);
  } else {
    console.warn(`⚠️ No numeric item ID found for swimming, skipping occupied_dates`);
  }
}
```

---

## Frontend Implementation

### 1. Fetch Occupied Dates for Specific Item (Reservation.vue)

```javascript
async fetchOccupiedDatesForItem(itemId) {
  // Fetch occupied dates for a SPECIFIC item (for calendar blocking)
  try {
    console.log(`📅 Fetching occupied dates for item ${itemId}...`)
    const response = await fetch(`${this.apiBaseUrl}/bookings/occupied-dates/${itemId}`)
    const data = await response.json()
    if (data.success) {
      // Update occupiedDates to show only this item's occupied dates
      this.occupiedDates = data.data.map(dateStr => ({
        inventoryItemId: itemId,
        occupiedDate: dateStr
      }))
      console.log(`✅ Loaded ${this.occupiedDates.length} occupied dates for item ${itemId}`)
    }
  } catch (error) {
    console.error(`Error fetching occupied dates for item ${itemId}:`, error)
    // Don't clear occupiedDates on error - keep showing all dates as safe
  }
}
```

### 2. Call Fetch When Item is Added (Reservation.vue)

```javascript
addToBooking(item, qty, guests) {
  // Check if it's a swimming item
  if (item.category === 'Swimming') {
    this.selectedSwimmingProgram = item
    this.swimmingFormData = {
      participants: 1,
      dates: [],
      time: '',
      newDate: ''
    }
    this.showSwimmingForm = true
    return
  }

  const existing = this.booking.find(b => b.item.id === item.id)
  if (existing) {
    existing.qty += qty
    existing.guests = guests
    this.showNotification(`Updated: ${item.name} (Qty: ${existing.qty})`, 'success')
  } else {
    this.booking.push({ item, qty, guests })
    this.showNotification(`Added: ${item.name} to booking`, 'success')
  }

  // ✅ NEW: Fetch occupied dates for this specific item
  if (item.perNight && item.item_id) {
    this.fetchOccupiedDatesForItem(item.item_id)
  }

  // ... rest of existing code
}
```

### 3. Validate Dates Before Checkout (Reservation.vue)

```javascript
/**
 * Validate that booked dates don't conflict with occupied dates
 * @returns {Array} Array of conflicts with {itemId, itemName, date}
 */
validateBookingDates() {
  if (!this.checkIn || !this.checkOut) return []
  
  const conflicts = []
  const selectedDates = this.getDateRange(this.checkIn, this.checkOut)
  
  // For each booked item, check if selected dates are occupied
  this.booking.forEach(bookingItem => {
    if (!bookingItem.item.perNight) return // Skip items without dates
    
    const itemId = bookingItem.item.item_id || bookingItem.item.id
    
    selectedDates.forEach(selectedDate => {
      const occupied = this.occupiedDates.some(occ => {
        const occupiedItemId = occ.inventoryItemId || occ.inventory_item_id
        const occupiedDateStr = (occ.occupiedDate || occ.occupied_date).split('T')[0]
        const selectedDateStr = selectedDate.toISOString().split('T')[0]
        return occupiedItemId == itemId && occupiedDateStr === selectedDateStr
      })
      
      if (occupied) {
        conflicts.push({
          itemId,
          itemName: bookingItem.item.name,
          date: selectedDate
        })
      }
    })
  })
  
  return conflicts
}

/**
 * Get all dates between check-in and check-out (exclusive of check-out)
 */
getDateRange(start, end) {
  const dates = []
  const current = new Date(start)
  const checkOut = new Date(end)
  
  while (current < checkOut) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  
  return dates
}
```

### 4. Call Validation in Proceed to Checkout (Reservation.vue)

```javascript
proceedToCheckout() {
  // Validate booking
  if (this.booking.length === 0) {
    this.showNotification('Please add items to your booking first', 'error')
    return
  }

  // Validate dates for items that require them
  const hasPerNightItems = this.booking.some(b => b.item.perNight)
  if (hasPerNightItems && (!this.checkIn || !this.checkOut)) {
    this.showNotification('Please select check-in and check-out dates', 'error')
    return
  }

  // ✅ NEW: Validate that selected dates are not occupied for any items
  const dateConflicts = this.validateBookingDates()
  if (dateConflicts.length > 0) {
    const conflictInfo = dateConflicts.map(c => 
      `${c.itemName} on ${new Date(c.date).toLocaleDateString()}`
    ).join('<br>')
    this.showNotification(
      `❌ Date Conflict! The following dates are already booked:<br>${conflictInfo}`,
      'error'
    )
    return
  }

  // Prepare booking data for the confirmation page
  const bookingData = {
    items: this.booking,
    checkIn: this.checkIn,
    checkOut: this.checkOut,
    nights: this.nights,
    adults: this.adults,
    children: this.children,
    total: this.total,
    subtotal: this.subtotal
  }

  // Save to localStorage and navigate
  localStorage.setItem('pendingBooking', JSON.stringify(bookingData))
  this.$router.push('/booking-confirmation')
}
```

### 5. Handle 409 Errors from Backend (BookingConfirmation.vue)

```javascript
async payNow() {
  this.loading = true;
  const bookingData = JSON.parse(localStorage.getItem('pendingBooking') || '{}');
  const customerName = this.guest.firstName + ' ' + this.guest.lastName;
  
  try {
    // ... existing code for creating booking
    
    const bookingResponse = await fetch('http://localhost:8000/api/bookings/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* booking data */ })
    });

    const bookingResult = await bookingResponse.json();

    // ✅ NEW: Handle 409 Conflict Error
    if (bookingResponse.status === 409) {
      console.error('❌ Date conflict detected:', bookingResult);
      this.loading = false;
      
      const conflictDates = bookingResult.conflict_dates 
        ? bookingResult.conflict_dates
            .map(d => new Date(d).toLocaleDateString())
            .join(', ')
        : 'selected dates';
      
      const message = `⚠️ ${bookingResult.error}\n\nItem: ${bookingResult.item_name}\nConflict Dates: ${conflictDates}\n\nPlease select different dates and try again.`;
      
      alert(message);
      return;
    }

    if (!bookingResponse.ok || !bookingResult.success) {
      throw new Error(bookingResult.error || 'Failed to create booking');
    }

    // ... rest of existing code
    
  } catch (err) {
    console.error('Booking error:', err);
    this.loading = false;
    
    // ✅ NEW: Provide specific error messages
    if (err.message.includes('date')) {
      alert('❌ Date Conflict Error\n\nOne or more selected dates are already fully booked. Please select different dates.');
    } else if (err.message.includes('Failed to create booking')) {
      alert('Failed to create booking. Please check your information and try again.');
    } else if (err.message.includes('payment')) {
      alert('Payment processing error. Please try again.');
    } else {
      alert(err.message || 'An error occurred. Please try again.');
    }
  }
}
```

---

## API Endpoints Used

### Get Occupied Dates for an Item
```
GET /api/bookings/occupied-dates/:itemId

Example:
GET /api/bookings/occupied-dates/4

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

### Create Booking (with built-in validation)
```
POST /api/bookings/confirm

Success Response:
{
  success: true,
  data: {
    bookingId: 73,
    bookingReference: "EDU20260228001234",
    paymentReference: "PAY123456",
    total: 5000
  }
}

Conflict Response (409):
{
  success: false,
  error: "Some dates have already been booked",
  conflict_dates: ["2026-02-28"],
  item_id: 4,
  item_name: "Family Room"
}
```

---

## Error Flow

```
User Action → Frontend Validation → Backend Validation → Error Response
     ↓              ↓                    ↓                    ↓
Selects     Calendar blocks       API checks DB      409 Conflict
 dates       booked dates         before insert      ← Clean error
                ↓                       ↓
            If OK, shows       If OK, inserts
            available dates    and creates booking
```

---

**Last Updated:** February 28, 2026
