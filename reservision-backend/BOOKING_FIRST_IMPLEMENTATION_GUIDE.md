# Booking-First Enrollment Implementation Guide

## 🎯 Overview

**Correct Flow:** BOOK → ENROLL → SCHEDULE

1. Customer **books** swimming package (pays, gets booking reference)
2. Students **enroll** using booking reference (validates capacity)
3. System **creates schedules** for enrolled students

---

## 📋 Implementation Checklist

### ✅ Phase 1: Database Setup

- [ ] Run `BOOKING_FIRST_ENROLLMENT_FLOW.sql` to add `booking_id` to `swimming_enrollments`
- [ ] Verify foreign key constraint created
- [ ] Test enrollment capacity validation query

### ✅ Phase 2: Backend API Updates

#### **A. Update Booking Confirmation (bookings.js)**

Currently: Creates booking + booking_items  
**No changes needed** - booking flow stays the same!

Optional: Store swimming dates in separate table for easier querying
```javascript
// After creating booking_items
if (item.swimmingDetails && item.swimmingDetails.dates) {
  for (const date of item.swimmingDetails.dates) {
    await connection.query(
      `INSERT INTO booking_swimming_dates (booking_item_id, session_date, session_time)
       VALUES (?, ?, ?)`,
      [bookingItemId, date, item.swimmingDetails.time]
    );
  }
}
```

---

#### **B. Create New Enrollment Validation Endpoint**

**File:** `routes/swimming.js`

```javascript
/**
 * POST /api/swimming/validate-booking
 * Validate if booking reference can accept new enrollment
 */
router.post("/validate-booking", async (req, res) => {
  try {
    const { bookingReference } = req.body;
    
    const [result] = await db.query(
      `SELECT 
        b.booking_id,
        b.booking_reference,
        b.customer_id,
        CONCAT(c.first_name, ' ', c.last_name) as booker_name,
        bi.participants as paid_slots,
        bi.item as package_name,
        COUNT(se.enrollment_id) as enrolled_count,
        (bi.participants - COUNT(se.enrollment_id)) as available_slots
      FROM bookings b
      JOIN booking_items bi ON b.booking_id = bi.booking_id
      JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
      WHERE b.booking_reference = ?
        AND bi.item LIKE '%Swimming%'
      GROUP BY b.booking_id, bi.booking_item_id`,
      [bookingReference]
    );
    
    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Booking reference not found or not a swimming booking"
      });
    }
    
    const booking = result[0];
    
    if (booking.available_slots <= 0) {
      return res.status(400).json({
        success: false,
        error: `Booking is full. Paid for ${booking.paid_slots} participants, all slots used.`,
        booking: booking
      });
    }
    
    res.json({
      success: true,
      canEnroll: true,
      booking: booking,
      message: `${booking.available_slots} slot(s) available`
    });
    
  } catch (error) {
    console.error("Error validating booking:", error);
    res.status(500).json({
      success: false,
      error: "Failed to validate booking",
      details: error.message
    });
  }
});
```

---

#### **C. Update Enrollment Creation Endpoint**

**File:** `routes/swimming.js`

```javascript
/**
 * POST /api/swimming/enroll
 * Enroll a student using booking reference
 */
router.post("/enroll", async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const {
      bookingReference,
      studentName,
      age,
      parentGuardianName,
      parentGuardianContact,
      emergencyContactName,
      emergencyContactPhone,
      medicalConditions,
      skillLevel
    } = req.body;
    
    // Step 1: Validate booking reference and capacity
    const [bookingCheck] = await connection.query(
      `SELECT 
        b.booking_id,
        bi.participants as paid_slots,
        bi.item as lesson_type,
        COUNT(se.enrollment_id) as enrolled_count
      FROM bookings b
      JOIN booking_items bi ON b.booking_id = bi.booking_id
      LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
      WHERE b.booking_reference = ?
        AND bi.item LIKE '%Swimming%'
      GROUP BY b.booking_id, bi.booking_item_id`,
      [bookingReference]
    );
    
    if (bookingCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "Invalid booking reference"
      });
    }
    
    const booking = bookingCheck[0];
    
    if (booking.enrolled_count >= booking.paid_slots) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Booking is full. Paid for ${booking.paid_slots} participants.`
      });
    }
    
    // Step 2: Check for duplicate enrollment (same student, same booking)
    const [duplicateCheck] = await connection.query(
      `SELECT enrollment_id 
       FROM swimming_enrollments 
       WHERE booking_id = ? AND student_name = ?`,
      [booking.booking_id, studentName]
    );
    
    if (duplicateCheck.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `${studentName} is already enrolled for this booking.`
      });
    }
    
    // Step 3: Create enrollment
    const [enrollmentResult] = await connection.query(
      `INSERT INTO swimming_enrollments (
        booking_id,
        student_name,
        age,
        parent_guardian_name,
        parent_guardian_contact,
        emergency_contact_name,
        emergency_contact_phone,
        medical_conditions,
        skill_level,
        lesson_type,
        enrollment_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        booking.booking_id,
        studentName,
        age,
        parentGuardianName,
        parentGuardianContact,
        emergencyContactName,
        emergencyContactPhone,
        medicalConditions || null,
        skillLevel || 'Beginner',
        booking.lesson_type
      ]
    );
    
    const enrollmentId = enrollmentResult.insertId;
    
    // Step 4: Check if all slots are filled
    const [finalCount] = await connection.query(
      `SELECT COUNT(*) as total 
       FROM swimming_enrollments 
       WHERE booking_id = ?`,
      [booking.booking_id]
    );
    
    const allSlotsFilled = finalCount[0].total >= booking.paid_slots;
    
    await connection.commit();
    
    res.json({
      success: true,
      enrollmentId: enrollmentId,
      message: `Successfully enrolled ${studentName}`,
      allSlotsFilled: allSlotsFilled,
      slotsUsed: finalCount[0].total,
      totalSlots: booking.paid_slots
    });
    
  } catch (error) {
    await connection.rollback();
    console.error("Error creating enrollment:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create enrollment",
      details: error.message
    });
  } finally {
    connection.release();
  }
});
```

---

#### **D. Get Enrollment Details Endpoint**

```javascript
/**
 * GET /api/swimming/enrollment/:bookingReference
 * Get all enrollments for a booking
 */
router.get("/enrollment/:bookingReference", async (req, res) => {
  try {
    const { bookingReference } = req.params;
    
    const [enrollments] = await db.query(
      `SELECT 
        se.*,
        b.booking_reference,
        b.booking_date,
        CONCAT(c.first_name, ' ', c.last_name) as booker_name
      FROM swimming_enrollments se
      JOIN bookings b ON se.booking_id = b.booking_id
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      WHERE b.booking_reference = ?
      ORDER BY se.created_at`,
      [bookingReference]
    );
    
    if (enrollments.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No enrollments found for this booking"
      });
    }
    
    res.json({
      success: true,
      enrollments: enrollments,
      count: enrollments.length
    });
    
  } catch (error) {
    console.error("Error fetching enrollments:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch enrollments",
      details: error.message
    });
  }
});
```

---

### ✅ Phase 3: Frontend Updates

#### **A. Update Booking Confirmation Email/Page**

Show booking reference prominently:

```vue
<template>
  <div class="booking-confirmation">
    <h2>Swimming Booking Confirmed!</h2>
    
    <div class="booking-reference-box">
      <h3>Your Booking Reference</h3>
      <p class="reference-code">{{ bookingReference }}</p>
      <p class="instruction">
        📋 Share this reference with students who will enroll
      </p>
    </div>
    
    <div class="enrollment-instructions">
      <h4>Next Steps:</h4>
      <ol>
        <li>Share booking reference <strong>{{ bookingReference }}</strong> with participants</li>
        <li>Each student must enroll at: 
          <a href="/swimming">Swimming Enrollment Page</a>
        </li>
        <li>Students use this reference to complete enrollment</li>
        <li>System validates {{ participants }} participant slots</li>
      </ol>
    </div>
    
    <div class="booking-details">
      <p><strong>Package:</strong> {{ packageName }}</p>
      <p><strong>Participants:</strong> {{ participants }} students</p>
      <p><strong>Sessions:</strong> {{ sessions.length }} dates</p>
      <p><strong>Total Paid:</strong> ₱{{ totalPrice.toLocaleString() }}</p>
    </div>
  </div>
</template>
```

---

#### **B. Create Swimming Enrollment Form Component**

**File:** `views/SwimmingEnrollment.vue`

```vue
<template>
  <div class="swimming-enrollment">
    <h2>Swimming Lesson Enrollment</h2>
    
    <form @submit.prevent="submitEnrollment">
      <!-- Step 1: Booking Reference -->
      <div class="form-section">
        <h3>Step 1: Enter Booking Reference</h3>
        <input 
          v-model="bookingReference" 
          type="text" 
          placeholder="e.g., SWM12345678"
          required
          @blur="validateBooking"
        />
        <button type="button" @click="validateBooking">Validate</button>
        
        <div v-if="validationMessage" :class="validationClass">
          {{ validationMessage }}
        </div>
        
        <div v-if="bookingValid" class="booking-info">
          <p><strong>Package:</strong> {{ bookingInfo.package_name }}</p>
          <p><strong>Booked by:</strong> {{ bookingInfo.booker_name }}</p>
          <p><strong>Slots:</strong> {{ bookingInfo.enrolled_count }}/{{ bookingInfo.paid_slots }} used</p>
          <p><strong>Available:</strong> {{ bookingInfo.available_slots }} slots</p>
        </div>
      </div>
      
      <!-- Step 2: Student Information -->
      <div v-if="bookingValid" class="form-section">
        <h3>Step 2: Student Information</h3>
        
        <label>
          Student Name *
          <input v-model="enrollment.studentName" type="text" required />
        </label>
        
        <label>
          Age *
          <input v-model.number="enrollment.age" type="number" min="3" max="100" required />
        </label>
        
        <label>
          Parent/Guardian Name *
          <input v-model="enrollment.parentGuardianName" type="text" required />
        </label>
        
        <label>
          Parent/Guardian Contact *
          <input v-model="enrollment.parentGuardianContact" type="tel" required />
        </label>
        
        <label>
          Emergency Contact Name *
          <input v-model="enrollment.emergencyContactName" type="text" required />
        </label>
        
        <label>
          Emergency Contact Phone *
          <input v-model="enrollment.emergencyContactPhone" type="tel" required />
        </label>
        
        <label>
          Medical Conditions (if any)
          <textarea v-model="enrollment.medicalConditions" rows="3"></textarea>
        </label>
        
        <label>
          Swimming Skill Level
          <select v-model="enrollment.skillLevel">
            <option value="Beginner">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>
        </label>
      </div>
      
      <!-- Submit -->
      <div v-if="bookingValid" class="form-actions">
        <button type="submit" :disabled="submitting">
          {{ submitting ? 'Enrolling...' : 'Complete Enrollment' }}
        </button>
      </div>
    </form>
    
    <!-- Success Message -->
    <div v-if="enrollmentSuccess" class="success-message">
      <h3>✅ Enrollment Successful!</h3>
      <p>{{ successMessage }}</p>
      <p><strong>Enrollment ID:</strong> {{ enrollmentId }}</p>
      
      <div v-if="allSlotsFilled">
        <p class="highlight">
          🎉 All {{ bookingInfo.paid_slots }} slots are now filled! 
          Swimming schedules will be created soon.
        </p>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      bookingReference: '',
      bookingValid: false,
      bookingInfo: null,
      validationMessage: '',
      validationClass: '',
      
      enrollment: {
        studentName: '',
        age: null,
        parentGuardianName: '',
        parentGuardianContact: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        medicalConditions: '',
        skillLevel: 'Beginner'
      },
      
      submitting: false,
      enrollmentSuccess: false,
      enrollmentId: null,
      successMessage: '',
      allSlotsFilled: false
    }
  },
  
  methods: {
    async validateBooking() {
      if (!this.bookingReference) return;
      
      try {
        const response = await fetch('http://localhost:8000/api/swimming/validate-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingReference: this.bookingReference })
        });
        
        const data = await response.json();
        
        if (data.success) {
          this.bookingValid = true;
          this.bookingInfo = data.booking;
          this.validationMessage = data.message;
          this.validationClass = 'success';
        } else {
          this.bookingValid = false;
          this.validationMessage = data.error;
          this.validationClass = 'error';
        }
      } catch (error) {
        console.error('Validation error:', error);
        this.validationMessage = 'Failed to validate booking reference';
        this.validationClass = 'error';
      }
    },
    
    async submitEnrollment() {
      this.submitting = true;
      
      try {
        const response = await fetch('http://localhost:8000/api/swimming/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingReference: this.bookingReference,
            ...this.enrollment
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          this.enrollmentSuccess = true;
          this.enrollmentId = data.enrollmentId;
          this.successMessage = data.message;
          this.allSlotsFilled = data.allSlotsFilled;
          
          // Reset form
          this.enrollment = {
            studentName: '',
            age: null,
            parentGuardianName: '',
            parentGuardianContact: '',
            emergencyContactName: '',
            emergencyContactPhone: '',
            medicalConditions: '',
            skillLevel: 'Beginner'
          };
          
          // Re-validate booking to update slot count
          this.validateBooking();
        } else {
          alert(data.error);
        }
      } catch (error) {
        console.error('Enrollment error:', error);
        alert('Failed to complete enrollment');
      } finally {
        this.submitting = false;
      }
    }
  }
}
</script>

<style scoped>
.booking-info {
  background: #e3f2fd;
  padding: 15px;
  border-radius: 8px;
  margin-top: 10px;
}

.success {
  color: green;
  background: #e8f5e9;
  padding: 10px;
  border-radius: 4px;
}

.error {
  color: red;
  background: #ffebee;
  padding: 10px;
  border-radius: 4px;
}

.success-message {
  background: #c8e6c9;
  padding: 20px;
  border-radius: 8px;
  margin-top: 20px;
}

.highlight {
  background: #fff9c4;
  padding: 10px;
  border-radius: 4px;
  font-weight: bold;
}
</style>
```

---

### ✅ Phase 4: Admin Dashboard Updates

Create admin view to:
- See pending bookings awaiting full enrollment
- Trigger schedule creation when all slots filled
- View enrolled students per booking

```vue
<template>
  <div class="admin-swimming-bookings">
    <h2>Swimming Bookings & Enrollments</h2>
    
    <div v-for="booking in bookings" :key="booking.booking_id" class="booking-card">
      <div class="booking-header">
        <h3>{{ booking.booking_reference }}</h3>
        <span :class="getStatusClass(booking)">
          {{ booking.enrolled_count }}/{{ booking.paid_slots }} Enrolled
        </span>
      </div>
      
      <div class="booking-details">
        <p><strong>Booked by:</strong> {{ booking.booker_name }}</p>
        <p><strong>Package:</strong> {{ booking.package_name }}</p>
        <p><strong>Booking Date:</strong> {{ formatDate(booking.booking_date) }}</p>
      </div>
      
      <div class="enrolled-students">
        <h4>Enrolled Students:</h4>
        <ul v-if="booking.students && booking.students.length > 0">
          <li v-for="student in booking.students" :key="student.enrollment_id">
            {{ student.student_name }} (Age {{ student.age }})
          </li>
        </ul>
        <p v-else class="no-students">No students enrolled yet</p>
      </div>
      
      <div class="actions">
        <button 
          v-if="booking.enrolled_count >= booking.paid_slots" 
          @click="createSchedules(booking.booking_id)"
          :disabled="booking.schedules_created"
        >
          {{ booking.schedules_created ? 'Schedules Created' : 'Create Schedules' }}
        </button>
        <button @click="viewEnrollments(booking.booking_reference)">
          View Details
        </button>
      </div>
    </div>
  </div>
</template>
```

---

## 🔄 Complete User Journey Example

### Scenario: Teacher Ana Books for 3 Students

**Day 1 - Booking**
1. Teacher Ana opens Reservation page
2. Selects Swimming Package, 10 dates, 3 participants
3. Pays ₱11,000
4. Receives confirmation with **SWM12345678**

**Day 2 - Enrollment 1**
1. Juan's parent opens Swimming Enrollment page
2. Enters **SWM12345678**
3. System shows: "✅ Valid booking, 3 slots available"
4. Fills Juan's information
5. Submits → Enrollment successful (1/3 filled)

**Day 3 - Enrollment 2**
1. Pedro's parent enrolls Pedro
2. Uses same **SWM12345678**
3. System shows: "✅ Valid booking, 2 slots available"
4. Enrolls successfully (2/3 filled)

**Day 4 - Enrollment 3**
1. Anna's parent enrolls Anna
2. Uses same **SWM12345678**
3. System shows: "✅ Valid booking, 1 slot available"
4. Enrolls successfully (3/3 filled)
5. System: "🎉 All slots filled!"

**Day 4 - Attempted Enrollment 4 (REJECTED)**
1. Sofia's parent tries to enroll
2. Enters **SWM12345678**
3. System shows: "❌ Booking full - paid for 3, all slots used"
4. Cannot proceed

**Day 5 - Admin Creates Schedules**
1. Admin sees booking SWM12345678 with 3/3 enrolled
2. Clicks "Create Schedules"
3. System creates 10 session schedules
4. Links all 3 students to each session (30 participant records)
5. Done! Ready for classes

---

## 🎯 Summary

**Flow:** BOOK → ENROLL → SCHEDULE

**Benefits:**
✅ Payment upfront (booking)  
✅ Controlled enrollment (validation)  
✅ One reference shared by multiple people  
✅ Prevents overbooking automatically  
✅ Clear separation: who paid vs. who attends  

**Database:**
- `bookings` → Who paid, how many slots  
- `swimming_enrollments` → Individual students (links to booking)  
- `swimming_session_schedules` → Session dates/times  
- `swimming_session_participants` → Students in each session (links to enrollment)
