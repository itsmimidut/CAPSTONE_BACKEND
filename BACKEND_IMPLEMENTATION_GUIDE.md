/**
 * IMPLEMENTATION GUIDE: Backend Date Normalization & New Endpoints
 * ==================================================================
 * 
 * This guide provides the code changes needed to fix date handling,
 * add entrance fee storage, and implement check-in/check-out flows.
 */

// ================================================================
// 1. UPDATE BOOKINGS CONTROLLER (bookingsController.js)
// ================================================================

/*
At the top of the file, add the import:

import { normalizeYMD, calculateNightsBetweenDates } from '../helpers/dateHelper.js';

Then, in the createBookingConfirmation function, replace the date normalization section with:

  // ✅ FIXED: Safe local date normalization (no timezone conversion)
  let normalizedCheckIn = null;
  let normalizedCheckOut = null;

  if (!isSwimmingOnly && checkIn && checkOut) {
    normalizedCheckIn = normalizeYMD(checkIn);
    normalizedCheckOut = normalizeYMD(checkOut);

    if (!normalizedCheckIn || !normalizedCheckOut) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid date format. Please use YYYY-MM-DD format.' 
      });
    }

    console.log(`📅 Normalized dates - Check-in: ${normalizedCheckIn}, Check-out: ${normalizedCheckOut}`);
  }

Also, update the booking INSERT to include entrance_fee field:

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
      subtotal,
      entrance_fee,
      total,
      booking_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
    [
      bookingReference,
      customerId,
      normalizedCheckIn,
      normalizedCheckOut,
      guest.adults || 2,
      guest.children || 0,
      guest.arrivalTime || null,
      guest.specialRequests || '',
      req.body.subtotal || total,
      req.body.entranceFee || 0,
      total
    ]
  );

In the booking_items INSERT, add guest_breakdown and entrance_fee:

  await connection.query(
    `INSERT INTO booking_items (
      booking_id,
      inventory_item_id,
      item_type,
      item_name,
      batch_id,
      schedule_id,
      coach_id,
      unit_price,
      quantity,
      guests,
      guest_breakdown,
      paying_guests,
      entrance_fee,
      nights,
      total_price,
      per_night,
      item_description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingId,
      unit.item_id,
      itemType,
      itemName,
      null,
      null,
      null,
      item.price,
      1,
      guestsPerUnit,
      JSON.stringify(item.guest_breakdown || {}),
      item.paying_guests || 0,
      item.entrance_fee || 0,
      nights,
      item.price * (item.perNight ? nights : 1),
      true,
      item.description || null
    ]
  );

Also update the non-room item INSERT similarly.

Also, calculate nights using the helper:

  const nights = item.perNight && normalizedCheckIn && normalizedCheckOut
    ? calculateNightsBetweenDates(normalizedCheckIn, normalizedCheckOut)
    : 0;
*/

// ================================================================
// 2. UPDATE ROUTES FILE (routes/bookings.js)
// ================================================================

/*
Add these imports at the top:

import {
  getBookingByQRCode,
  checkInGuest,
  checkOutGuest
} from '../controllers/checkInCheckOutController.js';

Then add these route definitions:

// QR Scanner - get booking details
router.get('/qr/:code', getBookingByQRCode);

// Check-in endpoint
router.post('/:bookingId/check-in', checkInGuest);

// Check-out endpoint
router.post('/:bookingId/check-out', checkOutGuest);

// Validate booking for check-in (existing but verify it exists)
router.get('/validate/:bookingReference', validateBookingForCheckIn);

Note: These routes should be added BEFORE the generic /:id routes to avoid conflicts.
*/

// ================================================================
// 3. DATABASE MIGRATIONS NEEDED
// ================================================================

/*
The following columns may need to be added to your tables if they don't exist:

ALTER TABLE bookings ADD COLUMN (
  entrance_fee DECIMAL(10, 2) DEFAULT 0,
  actual_check_in_time DATETIME NULL,
  actual_check_out_time DATETIME NULL
);

ALTER TABLE booking_items ADD COLUMN (
  guest_breakdown JSON NULL,
  paying_guests INT DEFAULT 0,
  entrance_fee DECIMAL(10, 2) DEFAULT 0
);

Run these migrations on your database before deploying the changes.
*/

// ================================================================
// 4. AVAILABILITY ENDPOINT (Optional but Recommended)
// ================================================================

/*
Create a new endpoint GET /api/bookings/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
to allow frontend to check availability before showing book button.

Export this function in checkInCheckOutController.js or a new controller:

export const getAvailability = async (req, res) => {
  try {
    const { checkIn, checkOut } = req.query;
    
    const normalCheckIn = normalizeYMD(checkIn);
    const normalCheckOut = normalizeYMD(checkOut);
    
    if (!normalCheckIn || !normalCheckOut) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format'
      });
    }

    const [items] = await db.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.category,
        COUNT(*) as totalUnits,
        COUNT(CASE WHEN ii.item_id NOT IN (
          SELECT bi.inventory_item_id
          FROM booking_items bi
          INNER JOIN bookings b ON b.booking_id = bi.booking_id
          WHERE b.check_in_date < ? AND b.check_out_date > ?
            AND b.booking_status IN ('Confirmed', 'Pending')
        ) THEN 1 END) as availableUnits
      FROM inventory_items ii
      WHERE ii.status NOT IN ('under maintenance', 'maintenance')
      GROUP BY ii.item_id, ii.name, ii.category
    `, [normalCheckOut, normalCheckIn]);

    const availability = items.map(item => ({
      itemId: item.item_id,
      name: item.name,
      category: item.category,
      totalUnits: item.totalUnits,
      availableUnits: item.availableUnits,
      isFullyBooked: item.availableUnits <= 0,
      availabilityPercent: Math.round((item.availableUnits / item.totalUnits) * 100)
    }));

    return res.json({ success: true, data: availability });
  } catch (error) {
    console.error('Availability check error:', error);
    return res.status(500).json({ success: false, error: 'Failed to check availability' });
  }
};

Then add to routes:
router.get('/availability', getAvailability);
*/

// ================================================================
// 5. FRONTEND INTEGRATION (ReservationSection.vue)
// ================================================================

/*
In ReservationSection.vue, add this method to check availability when dates change:

async checkItemAvailability() {
  if (!this.checkIn || !this.checkOut) return;

  try {
    const checkIn = this.toYMDLocal(this.checkIn);
    const checkOut = this.toYMDLocal(this.checkOut);
    
    const res = await fetch(
      `${this.apiBaseUrl}/bookings/availability?checkIn=${checkIn}&checkOut=${checkOut}`
    );
    const data = await res.json();
    
    if (data.success && data.data) {
      // Mark fully booked items in itemData
      data.data.forEach(availability => {
        this.itemData.rooms.concat(this.itemData.cottages).forEach(item => {
          if (item.item_id === availability.itemId) {
            item.isFullyBooked = availability.isFullyBooked;
            item.availableUnits = availability.availableUnits;
          }
        });
      });
    }
  } catch (error) {
    console.error('Availability check failed:', error);
  }
}

Then call it when dates are selected:

selectDate(date) {
  // ... existing code ...
  this.checkOut = date;
  this.checkItemAvailability();  // Add this line
}
*/

// ================================================================
// 6. ADMIN/RECEPTIONIST SCANNER PAGE
// ================================================================

/*
Create a new Vue component: AdminScanner.vue

<template>
  <div class="scanner-page">
    <div class="scanner-input">
      <input 
        v-model="bookingCode" 
        @keyup.enter="scanBooking" 
        placeholder="Scan booking QR or enter code..."
        autofocus
      />
      <button @click="scanBooking">Scan</button>
    </div>

    <div v-if="booking" class="booking-details">
      <h2>{{ booking.guestName }}</h2>
      <p>Booking: {{ booking.bookingReference }}</p>
      <p>Status: {{ booking.bookingStatus }}</p>
      <p>Check-in: {{ booking.checkInDate }}</p>
      <p>Check-out: {{ booking.checkOutDate }}</p>

      <div v-if="booking.bookingStatus === 'Pending'" class="status-pending">
        ⏳ Booking is pending approval
      </div>
      
      <div v-else-if="booking.bookingStatus === 'Confirmed' || booking.bookingStatus === 'Paid'" class="status-ready">
        <button @click="checkIn">✓ Check-in Guest</button>
      </div>

      <div v-else-if="booking.bookingStatus === 'Checked-in'" class="status-checked-in">
        <button @click="checkOut">✓ Check-out Guest</button>
      </div>

      <div v-else-if="booking.bookingStatus === 'Completed'" class="status-complete">
        ✓ Booking completed
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      bookingCode: '',
      booking: null,
      loading: false
    }
  },
  methods: {
    async scanBooking() {
      this.loading = true;
      try {
        const res = await fetch(`/api/bookings/qr/${this.bookingCode}`);
        const data = await res.json();
        
        if (data.success) {
          this.booking = data.data;
        } else {
          alert(data.error || 'Booking not found');
        }
      } finally {
        this.loading = false;
      }
    },
    async checkIn() {
      const res = await fetch(
        `/api/bookings/${this.booking.bookingId}/check-in`,
        { method: 'POST' }
      );
      const data = await res.json();
      
      if (data.success) {
        this.booking.bookingStatus = 'Checked-in';
        alert('Guest checked in successfully!');
      } else {
        alert(data.error);
      }
    },
    async checkOut() {
      const res = await fetch(
        `/api/bookings/${this.booking.bookingId}/check-out`,
        { method: 'POST' }
      );
      const data = await res.json();
      
      if (data.success) {
        this.booking.bookingStatus = 'Completed';
        alert('Guest checked out successfully!');
      } else {
        alert(data.error);
      }
    }
  }
}
</script>
*/

export default 'Implementation guide - see code comments above';
