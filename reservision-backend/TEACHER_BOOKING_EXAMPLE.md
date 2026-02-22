# Teacher Booking Example - Data Flow

## Scenario: Teacher books swimming lessons for 3 students

**Teacher Information:**
- Name: Ana Rodriguez  
- Email: ana.rodriguez@school.com
- Phone: 09171234567
- Type: Teacher at ABC Elementary School

**Students to Enroll:**
1. Juan Dela Cruz (Age 8, Parent: Maria - 09123456789)
2. Pedro Santos (Age 9, Parent: Rosa - 09187654321)
3. Anna Reyes (Age 7, Parent: Jose - 09156781234)

**Booking Details:**
- Lesson Type: 7 Years Old & Above
- Selected Dates: March 1, March 3, March 5
- Time: 8:00 AM - 9:00 AM
- Total: ₱3,000 × 3 students = ₱9,000

---

## Database Records Created

### 1. Main Booking Record (`bookings` table)
```sql
booking_id: 123
booking_reference: "SWM12345678"
customer_id: 456 (Ana Rodriguez)
first_name: "Ana"
last_name: "Rodriguez"
email: "ana.rodriguez@school.com"
phone: "09171234567"
total: 9000
...
```

### 2. Booking Item (`booking_items` table)
```sql
item_id: 789
booking_id: 123
item_type: "Event"
item_name: "Swimming Lesson - 7 Years Old & Above"
quantity: 3 (participants)
unit_price: 3000
total_price: 9000
...
```

### 3. Session Schedules (3 records - one per date)

#### Session 1: March 1
```sql
schedule_id: 1
booking_id: 123
customer_id: 456 (Ana - the teacher who booked)
session_date: "2026-03-01"
session_time: "8:00 AM - 9:00 AM"
lesson_type: "7 Years Old & Above"
status: "Scheduled"
coach_assigned: NULL
```

#### Session 2: March 3
```sql
schedule_id: 2
booking_id: 123
customer_id: 456
session_date: "2026-03-03"
session_time: "8:00 AM - 9:00 AM"
lesson_type: "7 Years Old & Above"
status: "Scheduled"
```

#### Session 3: March 5
```sql
schedule_id: 3
booking_id: 123
customer_id: 456
session_date: "2026-03-05"
session_time: "8:00 AM - 9:00 AM"
lesson_type: "7 Years Old & Above"
status: "Scheduled"
```

### 4. Session Participants (9 records - 3 students × 3 dates)

#### For Session 1 (March 1):
```sql
-- Student 1
participant_id: 1
schedule_id: 1
student_name: "Juan Dela Cruz"
student_age: 8
parent_guardian_name: "Maria Dela Cruz"
parent_guardian_phone: "09123456789"
skill_level: "Beginner"
attendance_status: NULL

-- Student 2
participant_id: 2
schedule_id: 1
student_name: "Pedro Santos"
student_age: 9
parent_guardian_name: "Rosa Santos"
parent_guardian_phone: "09187654321"
skill_level: "Beginner"
attendance_status: NULL

-- Student 3
participant_id: 3
schedule_id: 1
student_name: "Anna Reyes"
student_age: 7
parent_guardian_name: "Jose Reyes"
parent_guardian_phone: "09156781234"
skill_level: "Beginner"
attendance_status: NULL
```

#### For Session 2 (March 3):
```sql
participant_id: 4, 5, 6
schedule_id: 2
(Same 3 students repeated)
```

#### For Session 3 (March 5):
```sql
participant_id: 7, 8, 9
schedule_id: 3
(Same 3 students repeated)
```

---

## Queries to Track Students

### Query 1: Who is enrolled on March 1?
```sql
SELECT 
  s.session_time,
  s.lesson_type,
  s.coach_assigned,
  p.student_name,
  p.student_age,
  p.parent_guardian_name,
  p.parent_guardian_phone,
  c.first_name as booked_by_firstname,
  c.last_name as booked_by_lastname,
  c.email as booker_email
FROM swimming_session_schedules s
JOIN swimming_session_participants p ON s.schedule_id = p.schedule_id
LEFT JOIN customers c ON s.customer_id = c.customer_id
WHERE s.session_date = '2026-03-01'
ORDER BY s.session_time, p.student_name;
```

**Result:**
```
session_time     | lesson_type           | student_name    | student_age | parent_name       | parent_phone  | booked_by
-----------------|----------------------|-----------------|-------------|-------------------|---------------|------------------
8:00 AM - 9:00 AM| 7 Years Old & Above  | Anna Reyes      | 7           | Jose Reyes        | 09156781234   | Ana Rodriguez
8:00 AM - 9:00 AM| 7 Years Old & Above  | Juan Dela Cruz  | 8           | Maria Dela Cruz   | 09123456789   | Ana Rodriguez
8:00 AM - 9:00 AM| 7 Years Old & Above  | Pedro Santos    | 9           | Rosa Santos       | 09187654321   | Ana Rodriguez
```

### Query 2: All sessions for student "Juan Dela Cruz"
```sql
SELECT 
  s.session_date,
  s.session_time,
  s.lesson_type,
  s.status,
  p.attendance_status,
  p.performance_notes
FROM swimming_session_participants p
JOIN swimming_session_schedules s ON p.schedule_id = s.schedule_id
WHERE p.student_name = 'Juan Dela Cruz'
ORDER BY s.session_date;
```

**Result:**
```
session_date | session_time     | lesson_type           | status    | attendance_status | performance_notes
-------------|------------------|-----------------------|-----------|-------------------|------------------
2026-03-01   | 8:00 AM - 9:00 AM| 7 Years Old & Above  | Scheduled | NULL              | NULL
2026-03-03   | 8:00 AM - 9:00 AM| 7 Years Old & Above  | Scheduled | NULL              | NULL
2026-03-05   | 8:00 AM - 9:00 AM| 7 Years Old & Above  | Scheduled | NULL              | NULL
```

### Query 3: Attendance sheet for March 1 session
```sql
SELECT 
  p.student_name,
  p.student_age,
  p.parent_guardian_name,
  p.parent_guardian_phone,
  p.attendance_status,
  p.performance_notes
FROM swimming_session_participants p
JOIN swimming_session_schedules s ON p.schedule_id = s.schedule_id
WHERE s.session_date = '2026-03-01'
  AND s.session_time = '8:00 AM - 9:00 AM'
ORDER BY p.student_name;
```

**Used for:**
- Printing attendance sheets
- Taking attendance during class
- Coach performance tracking

---

## Admin Dashboard Views

### View 1: Daily Schedule
**URL:** `/admin/swimming/schedule/2026-03-01`

Shows:
- All sessions for the day
- Each session shows enrolled students
- Teacher/booker information
- Ability to assign coaches
- Attendance tracking

### View 2: Student Progress Report
**URL:** `/admin/swimming/student/Juan%20Dela%20Cruz`

Shows:
- All sessions for Juan
- Attendance history
- Performance notes from coaches
- Progress tracking
- Parent contact information

### View 3: Teacher Bookings
**URL:** `/admin/swimming/bookings/teacher/ana.rodriguez@school.com`

Shows:
- All bookings made by Teacher Ana
- List of students she enrolled
- Payment status
- Session schedules

---

## Benefits for Your Use Case

✅ **Track Teacher Bookings**
- Know which teacher made the booking
- Contact teacher for payment or questions

✅ **Track Individual Students**
- See each student's name, age, parent contact
- Individual attendance records
- Performance tracking per student

✅ **Easy Queries**
- "Who is enrolled on March 1?" → Get all students
- "What are Juan's sessions?" → Get his schedule
- "What did Teacher Ana book?" → Get all her students

✅ **Attendance Management**
- Mark attendance per student (not per booking)
- Juan present, Pedro absent, Anna excused

✅ **Parent Communication**
- Have parent contacts for each student
- Can notify parents individually

✅ **Scalable**
- Teacher books 1 student or 100 students
- Same structure works for all cases
