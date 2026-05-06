# 🏊 Swimming Enrollment UI - Testing Guide

## Problem: No Data Showing in Enrolled State

The UI is working correctly—it's showing "You have no active swimming enrollment yet" because there's **no test data** in your database yet.

## Solution: Insert Test Data

### Step 1: Run the SQL Script

1. Open your MySQL client (phpMyAdmin, MySQL Workbench, or command line)
2. Select your `reservision` database
3. Run this file:
   ```
   reservision-backend/INSERT_SWIMMING_TEST_DATA.sql
   ```

   Or paste the SQL directly into your MySQL query console.

### Step 2: What Gets Created

This script creates:

- ✅ **3 test coaches** (Maria Santos, Juan Dela Cruz, Pedro Lopez)
- ✅ **3 swimming batches** (BATCH A, B, C with different schedules)
- ✅ **3 test customers** with different scenarios
- ✅ **3 paid swimming bookings**
- ✅ **3 existing enrollments** with different statuses:
  - **APPROVED** → Shows locked UI
  - **PENDING** → Shows editable UI  
  - **REJECTED** → Shows rejection reason + editable UI

### Step 3: Test Each Scenario

Go to the Swimming Enrollment page and enter these booking references:

#### 📌 Test Case 1: APPROVED (Locked State)
```
Booking Reference: EDU16864909
```
**Expected UI:**
- ✅ Green success card: "You are already enrolled"
- ✅ Status chips showing: Approved, Paid, Coach Maria Santos, etc.
- ✅ All form fields **disabled/readonly**
- ✅ Buttons: "View My Enrollment" + "Download Form"
- ✅ Booking details card shown

---

#### ⏳ Test Case 2: PENDING (Editable State)
```
Booking Reference: EDU16864910
```
**Expected UI:**
- ⏳ Yellow status card: "Your enrollment is pending admin approval"
- ✅ Status chips showing
- ✅ All form fields **editable**
- ✅ Button: "Update Enrollment"
- ✅ Can modify details and submit again

---

#### ❌ Test Case 3: REJECTED (With Reason)
```
Booking Reference: EDU16864911
```
**Expected UI:**
- ❌ Red status card: "Your enrollment was rejected"
- ✅ **Rejection reason displayed**: "Age exceeds program requirement. Maximum age is 18 years old."
- ✅ All form fields **editable**
- ✅ Button: "Resubmit Enrollment"
- ✅ Can fix and resubmit

---

## Full Testing Checklist

- [ ] Backend running: `npm start` (port 8000)
- [ ] Frontend running: `npm run dev` (port 5173)
- [ ] Database has test data inserted
- [ ] Test each booking reference above
- [ ] Verify all UI states show correctly
- [ ] Check form fields lock/unlock properly
- [ ] Verify all buttons appear as expected

## Command Line Quick Start

```powershell
# Terminal 1: Start Backend
cd C:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend
npm start

# Terminal 2: Start Frontend
cd C:\Users\John Rhey Tamares\CAPSTONE_FRONTEND\reservision
npm run dev

# Terminal 3: Insert Test Data (one-time)
mysql -u root -p reservision < INSERT_SWIMMING_TEST_DATA.sql
# OR use phpMyAdmin/MySQL Workbench
```

Then visit: **http://localhost:5173** and go to **Swimming Enrollment**

## What Data Fields Map

**Frontend** → **Database**
- `enrollmentStatus` → `enrollment_status` (Pending, Approved, Rejected, Completed)
- `enrollmentPaymentStatus` → `payment_status` (Paid, Pending, Partially Paid)
- `rejectionReason` → `rejection_reason` (Why it was rejected)
- `bookingInfo` → From `bookings` + `booking_items` + `swimming_batches` + `swimming_batch_schedules`

## If Data Still Not Showing

1. **Check backend is running:**
   ```powershell
   curl http://localhost:8000/api/swimming/validate-booking -X POST -H "Content-Type: application/json" -d "{\"bookingReference\":\"EDU16864909\"}"
   ```

2. **Check database has data:**
   ```sql
   SELECT * FROM swimming_enrollments;
   SELECT * FROM bookings WHERE booking_reference LIKE 'EDU%';
   ```

3. **Check browser console for errors:**
   - Open DevTools (F12)
   - Look for network errors in the Network tab
   - Check the Console tab for JavaScript errors

4. **Enable backend logs:**
   - The backend logs to console
   - Check for any SQL errors or connection issues

## Next Steps

After confirming the feature works:
- ✅ Update the backend to auto-populate rejection_reason on enrollment rejection
- ✅ Add admin panel to manage rejections
- ✅ Add email notifications for status changes
- ✅ Add payment link generation for rejected enrollments
