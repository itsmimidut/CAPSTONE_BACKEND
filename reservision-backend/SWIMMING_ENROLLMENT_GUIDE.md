# Swimming Enrollment System - Complete Guide

## Overview
This document describes the complete swimming enrollment system implementation including database schema, backend API, and frontend integration.

---

## Database Schema

### 1. `swimming_enrollments` Table
Stores all swimming lesson enrollment submissions.

**Key Fields:**
- **Personal Info**: first_name, middle_name, last_name, date_of_birth
- **Contact Info**: email, mobile_phone, home_phone, address
- **Swimming Details**: lesson_type, skill_level, preferred_coach
- **Parent/Guardian**: father_name, mother_name, emergency contacts
- **Medical**: medical_conditions, allergies, medications
- **Status Tracking**: enrollment_status, payment_status
- **Timestamps**: created_at, updated_at

**Status Values:**
- enrollment_status: 'Pending', 'Approved', 'Rejected', 'Completed'
- payment_status: 'Pending', 'Paid', 'Partially Paid'
- lesson_type: 'Group Lessons', 'Private Lessons'

### 2. `swimming_coaches` Table
Manages swimming instructor/coach profiles.

**Key Fields:**
- name, specialization, experience_years
- certification, bio, profile_image
- availability, max_students, current_students
- status: 'Active', 'Inactive', 'On Leave'

**Sample Coaches Included:**
1. Coach Maria Santos - Beginner & Kids Training
2. Coach Juan Dela Cruz - Advanced & Competitive Swimming
3. Coach Sarah Reyes - Private Lessons & Adult Swimming

---

## Backend API Endpoints

### Base URL: `http://localhost:8000/api/swimming`

### Enrollment Endpoints

#### 1. Create Enrollment
```http
POST /api/swimming/enrollments
Content-Type: application/json

{
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "dateOfBirth": "2010-05-15",
  "email": "juan@example.com",
  "preferredCoach": "Coach Maria Santos",
  "address": "123 Main St, Manila",
  "lessonType": "Group Lessons",
  "agreedToTerms": true,
  "agreedToWaiver": true,
  // ... additional fields
}

Response (201):
{
  "message": "Enrollment submitted successfully",
  "enrollment": {
    "enrollment_id": 1,
    "first_name": "Juan",
    "enrollment_status": "Pending",
    // ... all fields
  }
}
```

#### 2. Get All Enrollments
```http
GET /api/swimming/enrollments?status=Pending&lessonType=Group%20Lessons&limit=50&offset=0

Response (200):
{
  "enrollments": [...],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

#### 3. Get Single Enrollment
```http
GET /api/swimming/enrollments/1

Response (200):
{
  "enrollment_id": 1,
  "first_name": "Juan",
  // ... all enrollment data
}
```

#### 4. Update Enrollment
```http
PUT /api/swimming/enrollments/1
Content-Type: application/json

{
  "enrollmentStatus": "Approved",
  "paymentStatus": "Paid"
}

Response (200):
{
  "message": "Enrollment updated successfully",
  "enrollment": {...}
}
```

#### 5. Delete Enrollment
```http
DELETE /api/swimming/enrollments/1

Response (200):
{
  "message": "Enrollment deleted successfully"
}
```

### Coach Endpoints

#### 1. Get All Coaches
```http
GET /api/swimming/coaches?status=Active

Response (200):
[
  {
    "coach_id": 1,
    "name": "Coach Maria Santos",
    "specialization": "Beginner & Kids Training",
    "experience_years": 8,
    "certification": "PSIA Level 3, First Aid & CPR Certified",
    "availability": "Monday-Friday: 8AM-5PM",
    // ... more fields
  }
]
```

#### 2. Get Single Coach
```http
GET /api/swimming/coaches/1
```

#### 3. Create Coach
```http
POST /api/swimming/coaches
Content-Type: application/json

{
  "name": "Coach New Instructor",
  "specialization": "Advanced Training",
  "experienceYears": 5,
  "certification": "PSIA Level 4",
  "availability": "Monday-Saturday: 6AM-2PM"
}
```

#### 4. Update Coach
```http
PUT /api/swimming/coaches/1
Content-Type: application/json

{
  "currentStudents": 8,
  "status": "Active"
}
```

---

## Frontend Integration

### Component: `EnrollmentModal.vue`
Location: `CAPSTONE FRONTEND/reservision/src/components/EnrollmentModal.vue`

**Features:**
- Fetches coaches dynamically from API
- Validates required fields before submission
- Shows loading state during submission
- Displays error messages
- Emits success event to parent

**Usage:**
```vue
<EnrollmentModal
  v-if="showEnrollmentModal"
  :preselected-type="selectedLessonType"
  @close="closeEnrollmentModal"
  @submit="handleEnrollment"
/>
```

### Page: `Swimming.vue`
Location: `CAPSTONE FRONTEND/reservision/src/views/website/Swimming.vue`

**Features:**
- Opens enrollment modal
- Handles successful enrollment submissions
- Shows confirmation with enrollment details

**Key Methods:**
```javascript
const openEnrollmentModal = (lessonType = null) => {
  selectedLessonType.value = lessonType
  showEnrollmentModal.value = true
}

const handleEnrollment = (response) => {
  // Shows success alert with enrollment ID
  // Displays enrollment details
  // Closes modal
}
```

---

## Database Setup

### Run SQL Script
1. Open your MySQL client (phpMyAdmin, MySQL Workbench, etc.)
2. Select your database
3. Run the SQL script from `database-setup.sql`
4. Verify tables were created:
   ```sql
   SHOW TABLES LIKE 'swimming_%';
   ```

### Verify Sample Data
```sql
-- Check coaches
SELECT * FROM swimming_coaches;

-- Check enrollments (should be empty initially)
SELECT * FROM swimming_enrollments;
```

---

## Testing the System

### 1. Start Backend Server
```bash
cd "CAPSTONE BACKEND/reservision-backend"
npm start
```

Server should start at: `http://localhost:8000`

### 2. Test API with Postman or curl

**Test GET Coaches:**
```bash
curl http://localhost:8000/api/swimming/coaches
```

**Test POST Enrollment:**
```bash
curl -X POST http://localhost:8000/api/swimming/enrollments \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "Student",
    "dateOfBirth": "2010-01-01",
    "email": "test@example.com",
    "preferredCoach": "Coach Maria Santos",
    "address": "123 Test St",
    "lessonType": "Group Lessons",
    "agreedToTerms": true,
    "agreedToWaiver": true
  }'
```

### 3. Test Frontend
1. Start frontend dev server
2. Navigate to `/swimming` page
3. Click "Enroll Now" button
4. Fill out the enrollment form
5. Submit and verify:
   - Success message appears
   - Enrollment ID is shown
   - Database record is created

---

## API Response Examples

### Successful Enrollment Response
```json
{
  "message": "Enrollment submitted successfully",
  "enrollment": {
    "enrollment_id": 1,
    "first_name": "Juan",
    "middle_name": null,
    "last_name": "Dela Cruz",
    "date_of_birth": "2010-05-15",
    "email": "juan@example.com",
    "preferred_coach": "Coach Maria Santos",
    "lesson_type": "Group Lessons",
    "enrollment_status": "Pending",
    "payment_status": "Pending",
    "created_at": "2026-01-31T10:30:00.000Z"
  }
}
```

### Error Response (Missing Fields)
```json
{
  "error": "Missing required fields",
  "required": [
    "firstName",
    "lastName",
    "dateOfBirth",
    "email",
    "preferredCoach",
    "address",
    "lessonType"
  ]
}
```

### Error Response (Invalid Email)
```json
{
  "error": "Invalid email format"
}
```

---

## Admin Features (Future Enhancement)

### Enrollment Management Dashboard
- View all enrollments with filtering
- Update enrollment status
- Mark payments as paid
- Export enrollment data
- View enrollment statistics

### Coach Management
- Add/edit/remove coaches
- Update availability
- Track student count per coach
- View coach performance

---

## Security Considerations

### Current Implementation
- Basic validation on frontend and backend
- SQL injection prevention via parameterized queries
- CORS enabled for frontend communication

### Recommended Enhancements
1. Add authentication/authorization
2. Implement rate limiting
3. Add input sanitization
4. Encrypt sensitive data
5. Add email verification
6. Implement payment gateway integration

---

## Troubleshooting

### Issue: "Failed to fetch coaches"
**Solution:** Ensure backend server is running on port 8000

### Issue: "Network error" on form submission
**Solution:** 
1. Check backend is running
2. Verify CORS is enabled
3. Check browser console for details

### Issue: Database connection error
**Solution:** 
1. Verify MySQL is running
2. Check database credentials in `config/db.js`
3. Ensure database exists

### Issue: Coach dropdown is empty
**Solution:**
1. Verify coaches table has data
2. Check API endpoint: `GET /api/swimming/coaches`
3. Check browser console for errors

---

## File Structure

```
CAPSTONE BACKEND/
└── reservision-backend/
    ├── routes/
    │   └── swimming.js          # Swimming API routes
    ├── config/
    │   └── db.js                # Database configuration
    ├── database-setup.sql       # SQL schema + sample data
    └── server.js                # Main server file (updated)

CAPSTONE FRONTEND/
└── reservision/
    └── src/
        ├── components/
        │   └── EnrollmentModal.vue    # Enrollment form modal
        └── views/
            └── website/
                └── Swimming.vue       # Swimming lessons page
```

---

## Next Steps

1. ✅ Database schema created
2. ✅ Backend API implemented
3. ✅ Frontend modal integrated
4. ✅ Coach management system added

**Future Enhancements:**
- [ ] Admin dashboard for enrollment management
- [ ] Email notifications on enrollment
- [ ] Payment integration
- [ ] Schedule management system
- [ ] Student progress tracking
- [ ] Automated reminder system

---

## Support

For issues or questions:
1. Check this documentation
2. Review API endpoints
3. Check browser console for errors
4. Verify database connection
5. Test API endpoints directly

---

**Last Updated:** January 31, 2026
**Version:** 1.0
