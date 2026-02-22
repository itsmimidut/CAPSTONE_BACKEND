# Swimming Session Tracking Solution

## Problem
When users book swimming lessons from the Reservation page and select multiple dates, we need to:
1. Track which specific dates each enrolled student has selected
2. Query who is scheduled for swimming on any given date
3. Display daily swimming schedules showing all enrolled participants
4. **Support teacher/group bookings** - where one person books for multiple students

## Use Cases

### Case 1: Individual/Family Booking
- Parent books for 2 children
- Selects 10 dates for their package
- Both children attend all sessions together

### Case 2: Teacher/Group Booking  
- Teacher books for 5 students from their class
- Each student has individual information (name, age, parent contact)
- Teacher is the booker, but we need to track each student separately
- **This is the scenario you asked about!**

### Case 3: Mixed Booking
- Swimming school administrator books multiple groups
- Different students on different dates
- Need detailed attendance tracking per student

## Current Structure

### Tables
- **`swimming_enrollments`** - stores enrollment information (personal details, lesson type, skill level)
- **`swimming_class_bookings`** - stores individual class sessions with date, time, and coach
- **`bookings`** - main booking table from reservation system
- **`booking_items`** - items in each booking (including swimming lessons)

### Issue
When booking from Reservation.vue, the dates are stored as:
```javascript
swimmingDetails: {
  dates: ['2026-03-01', '2026-03-05', '2026-03-08'],
  time: '8:00 AM - 9:00 AM',
  participants: 2
}
```
But these dates aren't saved to the database in a queryable format.

---

## ✅ Recommended Solution

### Method: Create Individual Session Records

When a swimming booking is confirmed through checkout, create individual records in `swimming_class_bookings` for each selected date.

### Implementation Steps

#### 1. Add New Tables

**Two-Table System to Support Group Bookings:**
- `swimming_session_schedules` - The session/class itself
- `swimming_session_participants` - Individual students in each session

This allows one person (teacher/parent) to book for multiple students.

```sql
-- Table 1: Session Schedule (one per session)
CREATE TABLE IF NOT EXISTS `swimming_session_schedules` (
  `schedule_id` INT(11) NOT NULL AUTO_INCREMENT,
  `booking_id` INT(11) NOT NULL,
  `customer_id` INT(11) NOT NULL COMMENT 'Who made the booking (teacher/parent)',
  `session_date` DATE NOT NULL,
  `session_time` VARCHAR(50) NOT NULL,
  `lesson_type` VARCHAR(100) NOT NULL,
  `status` ENUM('Scheduled','Completed','Cancelled','No-show') DEFAULT 'Scheduled',
  `coach_assigned` VARCHAR(100) DEFAULT NULL,
  `remarks` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`schedule_id`),
  KEY `booking_id` (`booking_id`),
  KEY `session_date` (`session_date`),
  KEY `customer_id` (`customer_id`),
  CONSTRAINT `fk_swimming_schedules_booking` 
    FOREIGN KEY (`booking_id`) 
    REFERENCES `bookings` (`booking_id`) 
    ON DELETE CASCADE,
  CONSTRAINT `fk_swimming_schedules_customer` 
    FOREIGN KEY (`customer_id`) 
    REFERENCES `customers` (`customer_id`) 
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table 2: Individual Participants (multiple per session)
CREATE TABLE IF NOT EXISTS `swimming_session_participants` (
  `participant_id` INT(11) NOT NULL AUTO_INCREMENT,
  `schedule_id` INT(11) NOT NULL,
  `enrollment_id` INT(11) DEFAULT NULL COMMENT 'Links to swimming_enrollments table',
  `student_name` VARCHAR(200) NOT NULL,
  `student_age` INT(11) DEFAULT NULL,
  `student_email` VARCHAR(100) DEFAULT NULL,
  `student_phone` VARCHAR(20) DEFAULT NULL,
  `parent_guardian_name` VARCHAR(200) DEFAULT NULL,
  `parent_guardian_phone` VARCHAR(20) DEFAULT NULL,
  `emergency_contact_name` VARCHAR(200) DEFAULT NULL,
  `emergency_contact_phone` VARCHAR(20) DEFAULT NULL,
  `skill_level` VARCHAR(50) DEFAULT NULL,
  `medical_notes` TEXT DEFAULT NULL,
  `attendance_status` ENUM('Present','Absent','Excused') DEFAULT NULL,
  `performance_notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`participant_id`),
  KEY `schedule_id` (`schedule_id`),
  KEY `enrollment_id` (`enrollment_id`),
  CONSTRAINT `fk_swimming_participants_schedule` 
    FOREIGN KEY (`schedule_id`) 
    REFERENCES `swimming_session_schedules` (`schedule_id`) 
    ON DELETE CASCADE,
  CONSTRAINT `fk_swimming_participants_enrollment` 
    FOREIGN KEY (`enrollment_id`) 
    REFERENCES `swimming_enrollments` (`enrollment_id`) 
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**See:** [CREATE_SWIMMING_SESSION_SCHEDULES_TABLE.sql](CREATE_SWIMMING_SESSION_SCHEDULES_TABLE.sql) for complete SQL with examples.

---

## 🎯 Correct Flow: Booking First, Then Enrollment

### **The Actual System Flow:**

Think of it like buying a **class voucher/pass** first, then registering students who will use that pass!

### **3-Step Process:**

#### **Step 1: Book Swimming Package (Reservation Page)**
Teacher/Parent books through Reservation page:
```javascript
swimmingDetails: {
  dates: ['2026-03-01', '2026-03-05', '2026-03-08', ...],  // 10 dates selected
  time: '8:00 AM - 9:00 AM',
  participants: 3,  // Paying for 3 students
  lessonType: '7 Years Old & Above'
}
```

**System creates:**
- Main booking record
- Booking item: "Swimming Package - 10 sessions"
- **Generates booking reference**: `SWM12345678`
- **NO enrollment records yet!**
- **NO session schedules yet!**

**Customer receives:**
- Booking confirmation with reference: `SWM12345678`
- Instructions: "Use this booking reference to enroll students on Swimming page"

---

#### **Step 2: Students Enroll Using Booking Reference**

Each student visits **Swimming Enrollment Form** and enters:
```javascript
enrollmentForm: {
  bookingReference: 'SWM12345678',  // ← The booking ID from Step 1
  studentName: 'Juan Dela Cruz',
  age: 8,
  parentName: 'Maria Dela Cruz',
  parentPhone: '09123456789',
  medicalNotes: 'None',
  emergencyContact: 'Rosa Dela Cruz - 09187654321'
}
```

**System validates:**
1. ✅ Check if booking reference exists
2. ✅ Check if booking is for swimming
3. ✅ Check booking participant count vs. current enrollments
   - Booking paid for: **3 participants**
   - Already enrolled: **2 students**
   - Can this student enroll? **YES** (3rd slot available)
4. ✅ Create enrollment record with `booking_id` link
5. ✅ Generate enrollment ID: `ENR-101`

**If 4th student tries to enroll with same booking:**
❌ Error: "This booking only covers 3 participants. All slots are filled."

---

#### **Step 3: System Creates Session Schedules (Auto or Manual)**

**Option A: Auto-create after all enrollments complete**
```javascript
// When all 3 participants have enrolled
// System automatically creates:
for (const date of bookingDates) {
  // Create session schedule
  INSERT INTO swimming_session_schedules (booking_id, session_date, ...)
  
  // Link all enrolled students to this session
  INSERT INTO swimming_session_participants (schedule_id, enrollment_id, ...)
  VALUES (scheduleId, 101), (scheduleId, 102), (scheduleId, 103)
}
```

**Option B: Manual schedule creation by admin**
- Admin reviews pending bookings with enrollments
- Assigns coach, finalizes schedule
- Creates session schedules linking enrolled students

---

### **Database Structure with Booking-First Flow:**

```sql
-- Step 1: Booking created
bookings
  booking_id: 789
  booking_reference: 'SWM12345678'
  customer_id: 456  -- Teacher/Parent who paid

booking_items
  booking_item_id: 234
  booking_id: 789
  item: 'Swimming Package - 10 sessions'
  participants: 3  -- ← Paid for 3 students
  dates: '2026-03-01,2026-03-05,...'

-- Step 2: Students enroll using booking reference
swimming_enrollments
  enrollment_id: 101
  booking_id: 789  -- ← Links to booking
  student_name: 'Juan Dela Cruz'
  ...

swimming_enrollments
  enrollment_id: 102
  booking_id: 789  -- ← Same booking
  student_name: 'Pedro Santos'
  ...

swimming_enrollments
  enrollment_id: 103
  booking_id: 789  -- ← Same booking
  student_name: 'Anna Reyes'
  ...

-- Step 3: System creates session schedules
swimming_session_schedules
  schedule_id: 1
  booking_id: 789
  session_date: '2026-03-01'
  ...

swimming_session_participants
  schedule_id: 1
  enrollment_id: 101  -- Juan
  
swimming_session_participants
  schedule_id: 1
  enrollment_id: 102  -- Pedro
  
swimming_session_participants
  schedule_id: 1
  enrollment_id: 103  -- Anna
```

---

### **Validation Query:**

```sql
-- Check if booking has room for more enrollments
SELECT 
  bi.participants as paid_slots,
  COUNT(se.enrollment_id) as enrolled_count,
  (bi.participants - COUNT(se.enrollment_id)) as available_slots
FROM booking_items bi
LEFT JOIN swimming_enrollments se ON bi.booking_id = se.booking_id
WHERE bi.booking_id = ?
GROUP BY bi.booking_item_id
```

**Result:**
```
paid_slots | enrolled_count | available_slots
-----------|----------------|----------------
3          | 2              | 1  ← Can still enroll 1 more
```

---

### **Benefits of Booking-First Approach:**

✅ **Payment upfront** - Teacher/Parent pays first, then distributes booking reference  
✅ **Flexible enrollment timing** - Students can enroll at different times using same booking  
✅ **Slot validation** - System prevents over-enrollment  
✅ **Clear accountability** - Booking shows who paid, enrollments show who will attend  
✅ **Voucher-like system** - One booking reference can be shared with multiple people  
✅ **Prevents no-shows** - Students already registered before class starts  
✅ **Easy refunds** - Track payment vs. actual enrollments  

---

#### 2. Update Backend - Save Sessions on Booking Confirmation

**File:** `routes/bookings.js` or wherever booking confirmation happens

```javascript
// After creating the main booking
if (item.swimmingDetails && item.swimmingDetails.dates) {
  const { dates, time, participants } = item.swimmingDetails;
  
  // Create a session record for each selected date
  for (const date of dates) {
    // Step 1: Create the session schedule
    const [scheduleResult] = await connection.query(
      `INSERT INTO swimming_session_schedules (
        booking_id,
        customer_id,
        session_date,
        session_time,
        lesson_type
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        bookingId,
        customerId,
        date,
        time,
        item.item.name // e.g., "7 Years Old & Above"
      ]
    );
    
    const scheduleId = scheduleResult.insertId;
    
    // Step 2: Add participants to this session
    // If swimmingDetails has studentList (for teacher bookings)
    if (item.swimmingDetails.studentList && item.swimmingDetails.studentList.length > 0) {
      // Teacher booked for multiple students
      for (const student of item.swimmingDetails.studentList) {
        await connection.query(
          `INSERT INTO swimming_session_participants (
            schedule_id,
            student_name,
            student_age,
            parent_guardian_name,
            parent_guardian_phone,
            skill_level
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            scheduleId,
            student.name,
            student.age || null,
            student.parentName || null,
            student.parentPhone || null,
            student.skillLevel || 'Beginner'
          ]
        );
      }
    } else {
      // Regular booking - use the booker's information
      // Create one participant per participant count
      for (let i = 0; i < participants; i++) {
        await connection.query(
          `INSERT INTO swimming_session_participants (
            schedule_id,
            student_name,
            parent_guardian_name,
            parent_guardian_phone
          ) VALUES (?, ?, ?, ?)`,
          [
            scheduleId,
            i === 0 ? `${firstName} ${lastName}` : `${firstName} ${lastName} - Student ${i + 1}`,
            `${firstName} ${lastName}`,
            phone
          ]
        );
      }
    }
  }
}
```

#### 3. Create API Endpoint - Get Swimming Schedule by Date

**File:** `routes/swimming.js`

```javascript
/**
 * GET /api/swimming/schedule/:date
 * Get all swimming sessions for a specific date with enrolled students
 * 
 * Example: GET /api/swimming/schedule/2026-03-01
 */
router.get("/schedule/:date", async (req, res) => {
  try {
    const { date } = req.params;
    
    // Get all sessions for the date
    const [sessions] = await db.query(
      `SELECT 
        s.schedule_id,
        s.session_date,
        s.session_time,
        s.lesson_type,
        s.status,
        s.coach_assigned,
        s.remarks,
        b.booking_reference,
        c.first_name as booker_first_name,
        c.last_name as booker_last_name,
        c.email as booker_email,
        c.phone as booker_phone
      FROM swimming_session_schedules s
      LEFT JOIN bookings b ON s.booking_id = b.booking_id
      LEFT JOIN customers c ON s.customer_id = c.customer_id
      WHERE s.session_date = ?
      ORDER BY s.session_time`,
      [date]
    );
    
    // Get participants for each session
    for (const session of sessions) {
      const [participants] = await db.query(
        `SELECT 
          participant_id,
          student_name,
          student_age,
          parent_guardian_name,
          parent_guardian_phone,
          skill_level,
          attendance_status,
          performance_notes
        FROM swimming_session_participants
        WHERE schedule_id = ?
        ORDER BY student_name`,
        [session.schedule_id]
      );
      
      session.students = participants;
      session.student_count = participants.length;
    }
    
    const totalStudents = sessions.reduce((sum, s) => sum + s.student_count, 0);
    
    res.json({
      success: true,
      date: date,
      sessionCount: sessions.length,
      totalStudents: totalStudents,
      sessions: sessions
    });
    
  } catch (error) {
    console.error("Error fetching swimming schedule:", error);
    res.status(500).json({
      error: "Failed to fetch swimming schedule",
      details: error.message
    });
  }
});

/**
 * GET /api/swimming/students/:studentName
 * Get all sessions for a specific student
 */
router.get("/students/:studentName", async (req, res) => {
  try {
    const { studentName } = req.params;
    
    const [sessions] = await db.query(
      `SELECT 
        p.student_name,
        p.student_age,
        p.parent_guardian_name,
        p.attendance_status,
        p.performance_notes,
        s.session_date,
        s.session_time,
        s.lesson_type,
        s.status,
        s.coach_assigned,
        b.booking_reference
      FROM swimming_session_participants p
      JOIN swimming_session_schedules s ON p.schedule_id = s.schedule_id
      LEFT JOIN bookings b ON s.booking_id = b.booking_id
      WHERE p.student_name LIKE ?
      ORDER BY s.session_date DESC`,
      [`%${studentName}%`]
    );
    
    res.json({
      success: true,
      studentName: studentName,
      sessionCount: sessions.length,
      sessions: sessions
    });
    
  } catch (error) {
    console.error("Error fetching student sessions:", error);
    res.status(500).json({
      error: "Failed to fetch student sessions",
      details: error.message
    });
  }
});

/**
 * GET /api/swimming/roster/:scheduleId
 * Get detailed roster for a specific session
 */
router.get("/roster/:scheduleId", async (req, res) => {
  try {
    const { scheduleId } = req.params;
    
    // Get session details
    const [sessions] = await db.query(
      `SELECT 
        s.*,
        b.booking_reference,
        c.first_name as booker_first_name,
        c.last_name as booker_last_name,
        c.email as booker_email
      FROM swimming_session_schedules s
      LEFT JOIN bookings b ON s.booking_id = b.booking_id
      LEFT JOIN customers c ON s.customer_id = c.customer_id
      WHERE s.schedule_id = ?`,
      [scheduleId]
    );
    
    if (sessions.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Get all students enrolled
    const [students] = await db.query(
      `SELECT * FROM swimming_session_participants
       WHERE schedule_id = ?
       ORDER BY student_name`,
      [scheduleId]
    );
    
    res.json({
      success: true,
      session: sessions[0],
      students: students,
      studentCount: students.length
    });
    
  } catch (error) {
    console.error("Error fetching roster:", error);
    res.status(500).json({
      error: "Failed to fetch roster",
      details: error.message
    });
  }
});

/**
 * PUT /api/swimming/attendance/:participantId
 * Update attendance for a student
 */
router.put("/attendance/:participantId", async (req, res) => {
  try {
    const { participantId } = req.params;
    const { attendance_status, performance_notes } = req.body;
    
    await db.query(
      `UPDATE swimming_session_participants
       SET attendance_status = ?, performance_notes = ?
       WHERE participant_id = ?`,
      [attendance_status, performance_notes || null, participantId]
    );
    
    res.json({
      success: true,
      message: "Attendance updated successfully"
    });
    
  } catch (error) {
    console.error("Error updating attendance:", error);
    res.status(500).json({
      error: "Failed to update attendance",
      details: error.message
    });
  }
});
```

/**
 * GET /api/swimming/schedule
 * Get swimming schedules with optional date range filter
 */
router.get("/schedule", async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    
    let sql = `
      SELECT 
        s.schedule_id,
        s.session_date,
        s.session_time,
        s.participants,
        s.lesson_type,
        s.customer_name,
        s.customer_email,
        s.status,
        s.coach_assigned,
        b.booking_reference
      FROM swimming_session_schedules s
      LEFT JOIN bookings b ON s.booking_id = b.booking_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      sql += " AND s.session_date >= ?";
      params.push(startDate);
    }
    
    if (endDate) {
      sql += " AND s.session_date <= ?";
      params.push(endDate);
    }
    
    if (status) {
      sql += " AND s.status = ?";
      params.push(status);
    }
    
    sql += " ORDER BY s.session_date, s.session_time";
    
    const [sessions] = await db.query(sql, params);
    
    res.json({
      success: true,
      count: sessions.length,
      sessions: sessions
    });
    
  } catch (error) {
    console.error("Error fetching swimming schedules:", error);
    res.status(500).json({
      error: "Failed to fetch swimming schedules",
      details: error.message
    });
  }
});

/**
 * GET /api/swimming/daily-summary
 * Get a summary of swimming sessions grouped by date
 */
router.get("/daily-summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let sql = `
      SELECT 
        s.session_date,
        COUNT(DISTINCT s.schedule_id) as total_sessions,
        SUM(s.participants) as total_participants,
        GROUP_CONCAT(DISTINCT s.session_time ORDER BY s.session_time) as time_slots,
        COUNT(DISTINCT CASE WHEN s.status = 'Scheduled' THEN s.schedule_id END) as scheduled,
        COUNT(DISTINCT CASE WHEN s.status = 'Completed' THEN s.schedule_id END) as completed,
        COUNT(DISTINCT CASE WHEN s.status = 'Cancelled' THEN s.schedule_id END) as cancelled
      FROM swimming_session_schedules s
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      sql += " AND s.session_date >= ?";
      params.push(startDate);
    }
    
    if (endDate) {
      sql += " AND s.session_date <= ?";
      params.push(endDate);
    }
    
    sql += " GROUP BY s.session_date ORDER BY s.session_date";
    
    const [summary] = await db.query(sql, params);
    
    res.json({
      success: true,
      summary: summary
    });
    
  } catch (error) {
    console.error("Error fetching daily summary:", error);
    res.status(500).json({
      error: "Failed to fetch daily summary",
      details: error.message
    });
  }
});
```

---

## Usage Examples

### 1. View Who's Enrolled on March 1, 2026 (With Individual Students)
```javascript
// API Call
GET /api/swimming/schedule/2026-03-01

// Response
{
  "success": true,
  "date": "2026-03-01",
  "sessionCount": 2,
  "totalStudents": 5,
  "sessions": [
    {
      "schedule_id": 1,
      "session_date": "2026-03-01",
      "session_time": "8:00 AM - 9:00 AM",
      "lesson_type": "7 Years Old & Above",
      "status": "Scheduled",
      "coach_assigned": "Coach Maria Santos",
      "booking_reference": "SWM12345678",
      "booker_first_name": "Ana",
      "booker_last_name": "Rodriguez",
      "booker_email": "ana.rodriguez@school.com",
      "student_count": 3,
      "students": [
        {
          "participant_id": 1,
          "student_name": "Juan Dela Cruz",
          "student_age": 8,
          "parent_guardian_name": "Maria Dela Cruz",
          "parent_guardian_phone": "09123456789",
          "skill_level": "Beginner",
          "attendance_status": null
        },
        {
          "participant_id": 2,
          "student_name": "Pedro Santos",
          "student_age": 9,
          "parent_guardian_name": "Rosa Santos",
          "parent_guardian_phone": "09187654321",
          "skill_level": "Beginner",
          "attendance_status": null
        },
        {
          "participant_id": 3,
          "student_name": "Anna Reyes",
          "student_age": 7,
          "parent_guardian_name": "Jose Reyes",
          "parent_guardian_phone": "09156781234",
          "skill_level": "Beginner",
          "attendance_status": null
        }
      ]
    },
    {
      "schedule_id": 2,
      "session_date": "2026-03-01",
      "session_time": "10:00 AM - 11:00 AM",
      "lesson_type": "6 Years Old & Below",
      "status": "Scheduled",
      "coach_assigned": "Coach Anna",
      "booking_reference": "SWM87654321",
      "booker_first_name": "Maria",
      "booker_last_name": "Garcia",
      "student_count": 2,
      "students": [
        {
          "participant_id": 4,
          "student_name": "Sofia Garcia",
          "student_age": 5,
          "parent_guardian_name": "Maria Garcia",
          "parent_guardian_phone": "09198765432",
          "skill_level": "Beginner",
          "attendance_status": null
        },
        {
          "participant_id": 5,
          "student_name": "Luis Garcia",
          "student_age": 6,
          "parent_guardian_name": "Maria Garcia",
          "parent_guardian_phone": "09198765432",
          "skill_level": "Beginner",
          "attendance_status": null
        }
      ]
    }
  ]
}
```

### 2. Get All Sessions for a Specific Student
```javascript
GET /api/swimming/students/Juan%20Dela%20Cruz

// Shows all past and future sessions for Juan
```

### 3. Get Session Roster (for Attendance Taking)
```javascript
GET /api/swimming/roster/1

// Returns full details of session #1 with all enrolled students
// Perfect for attendance sheets
```

### 4. Update Student Attendance
```javascript
PUT /api/swimming/attendance/1
{
  "attendance_status": "Present",
  "performance_notes": "Good progress on freestyle"
}
```

### 5. Admin Swimming Schedule Page
Create a Vue component to display daily schedule with individual students:

```vue
<template>
  <div class="swimming-schedule">
    <h2>Swimming Schedule</h2>
    
    <input type="date" v-model="selectedDate" @change="loadSchedule" />
    
    <div v-if="loading">Loading...</div>
    
    <div v-else-if="schedule.sessions && schedule.sessions.length > 0">
      <h3>{{ formatDate(selectedDate) }}</h3>
      <p>Total Sessions: {{ schedule.sessionCount }}</p>
      <p>Total Students: {{ schedule.totalStudents }}</p>
      
      <!-- Group by Time Slot -->
      <div v-for="session in schedule.sessions" :key="session.schedule_id" class="session-card">
        <div class="session-header">
          <h4>{{ session.session_time }}</h4>
          <span class="lesson-type">{{ session.lesson_type }}</span>
          <span class="coach">Coach: {{ session.coach_assigned || 'Not assigned' }}</span>
        </div>
        
        <div class="session-info">
          <p><strong>Booked by:</strong> {{ session.booker_first_name }} {{ session.booker_last_name }}</p>
          <p><strong>Contact:</strong> {{ session.booker_email }} / {{ session.booker_phone }}</p>
          <p><strong>Booking Ref:</strong> {{ session.booking_reference }}</p>
        </div>
        
        <!-- Student List -->
        <div class="students-list">
          <h5>Enrolled Students ({{ session.student_count }})</h5>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Student Name</th>
                <th>Age</th>
                <th>Parent/Guardian</th>
                <th>Contact</th>
                <th>Skill Level</th>
                <th>Attendance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(student, index) in session.students" :key="student.participant_id">
                <td>{{ index + 1 }}</td>
                <td>{{ student.student_name }}</td>
                <td>{{ student.student_age || 'N/A' }}</td>
                <td>{{ student.parent_guardian_name || 'N/A' }}</td>
                <td>{{ student.parent_guardian_phone || 'N/A' }}</td>
                <td>{{ student.skill_level || 'Beginner' }}</td>
                <td>
                  <select 
                    v-model="student.attendance_status" 
                    @change="updateAttendance(student.participant_id, student.attendance_status)"
                  >
                    <option value="">-</option>
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                    <option value="Excused">Excused</option>
                  </select>
                </td>
                <td>
                  <button @click="addNotes(student)">Notes</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    <div v-else>
      <p>No swimming sessions scheduled for this date.</p>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      selectedDate: new Date().toISOString().split('T')[0],
      schedule: { sessions: [] },
      loading: false
    }
  },
  mounted() {
    this.loadSchedule()
  },
  methods: {
    async loadSchedule() {
      this.loading = true
      try {
        const response = await fetch(
          `http://localhost:8000/api/swimming/schedule/${this.selectedDate}`
        )
        this.schedule = await response.json()
      } catch (error) {
        console.error('Error loading schedule:', error)
      } finally {
        this.loading = false
      }
    },
    
    async updateAttendance(participantId, status) {
      try {
        await fetch(`http://localhost:8000/api/swimming/attendance/${participantId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendance_status: status })
        })
        alert('Attendance updated')
      } catch (error) {
        console.error('Error updating attendance:', error)
        alert('Failed to update attendance')
      }
    },
    
    addNotes(student) {
      const notes = prompt(`Performance notes for ${student.student_name}:`, 
                          student.performance_notes || '')
      if (notes !== null) {
        fetch(`http://localhost:8000/api/swimming/attendance/${student.participant_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            attendance_status: student.attendance_status,
            performance_notes: notes 
          })
        })
      }
    },
    
    formatDate(date) {
      return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }
  }
}
</script>

<style scoped>
.session-card {
  border: 1px solid #ddd;
  margin: 20px 0;
  padding: 15px;
  border-radius: 8px;
}
.session-header {
  background: #e3f2fd;
  padding: 10px;
  border-radius: 4px;
  display: flex;
  gap: 20px;
  align-items: center;
}
.students-list table {
  width: 100%;
  margin-top: 15px;
  border-collapse: collapse;
}
.students-list th,
.students-list td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}
.students-list th {
  background-color: #f5f5f5;
}
</style>
```

---

## Benefits of This Approach

✅ **Easy Date Queries** - Simply query by date to see all scheduled students  
✅ **Individual Student Tracking** - Each student has their own record  
✅ **Teacher Booking Support** - Track who booked vs. who is enrolled  
✅ **Attendance Management** - Mark attendance per student, not per booking  
✅ **Coach Assignment** - Can assign coaches to specific sessions  
✅ **Status Management** - Track completed, cancelled, or no-show sessions  
✅ **Reporting** - Easy to generate reports by date, student, coach, or teacher  
✅ **Scalable** - Works for any number of participants and dates  
✅ **Student History** - Track individual student progress across multiple sessions  

---

## Summary

**To identify who is enrolled on a specific date (including teacher bookings):**

1. ✅ Create TWO tables:
   - `swimming_session_schedules` - The session/class
   - `swimming_session_participants` - Individual students in each session

2. ✅ When booking is confirmed:
   - Insert session schedule (one per date)
   - Insert participants (one per student)

3. ✅ When teacher books for students:
   - Session shows teacher as booker
   - Participants show individual students with their details

4. ✅ Query by date:
   ```sql
   SELECT sessions with all enrolled students
   WHERE session_date = '2026-03-01'
   ```

5. ✅ Admin can see:
   - Who made the booking (teacher/parent)
   - Individual students enrolled
   - Student attendance per session
   - Coach assignments
   - Performance notes

**Example Teacher Booking:**
```
Teacher Ana Rodriguez books for 3 students on March 1:
  → Session: March 1, 8-9 AM (Booked by: Ana Rodriguez)
    → Student 1: Juan Dela Cruz (Age 8, Parent: Maria)
    → Student 2: Pedro Santos (Age 9, Parent: Rosa)
    → Student 3: Anna Reyes (Age 7, Parent: Jose)
```

This gives you complete tracking of:
- ✅ Who booked (teacher)
- ✅ Who is enrolled (individual students)  
- ✅ Parent/guardian contacts for each student
- ✅ Individual attendance records
- ✅ Student-specific performance notes
