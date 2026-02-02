# 📧 RESEND EMAIL VERIFICATION SETUP GUIDE

## ✅ What Was Created

### Backend Files
1. **`schema/otp_verifications.sql`** - Database table for OTP storage
2. **`services/emailService.js`** - Resend email service with beautiful templates
3. **`controllers/otpController.js`** - OTP generation, verification logic
4. **`routes/otp.js`** - API endpoints for OTP operations
5. **`server.js`** - Updated with OTP routes

### Features Implemented
- ✅ 6-digit OTP generation
- ✅ 10-minute expiry timer
- ✅ Rate limiting (1 OTP per minute)
- ✅ Beautiful HTML email templates
- ✅ Email format validation
- ✅ Spam prevention
- ✅ Resend OTP functionality

---

## 🚀 SETUP INSTRUCTIONS

### Step 1: Create Resend Account

1. Go to **https://resend.com**
2. Click **"Sign Up"** or **"Get Started"**
3. Sign up using:
   - GitHub account (recommended - fastest)
   - Google account
   - Or email

### Step 2: Get API Key

1. After login, go to **https://resend.com/api-keys**
2. Click **"Create API Key"**
3. Name it: `Eduardo's Resort - Booking System`
4. Copy the API key (starts with `re_`)
5. **IMPORTANT**: Save it somewhere safe - you can only see it once!

### Step 3: Setup Database

Run this SQL in your MySQL/phpMyAdmin:

```sql
-- Run this file to create OTP table
source C:/xampp/htdocs/cap2/CAPSTONE_BACKEND/reservision-backend/schema/otp_verifications.sql
```

Or manually copy-paste the SQL:

```sql
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_otp_code (otp_code),
  INDEX idx_expires_at (expires_at)
);
```

### Step 4: Add API Key to .env

Open `c:\xampp\htdocs\cap2\CAPSTONE_BACKEND\reservision-backend\.env`

Add this line (replace with your actual key):

```env
RESEND_API_KEY=re_your_actual_key_here_from_step_2
```

**Example:**
```env
# Email Service (Resend)
RESEND_API_KEY=re_123abc456def789ghi012jkl345mno678
```

### Step 5: Verify Domain (Optional but Recommended)

For production, verify your domain:

1. Go to https://resend.com/domains
2. Click **"Add Domain"**
3. Add your domain: `eduardosresort.com` (or whatever domain you'll use)
4. Add the DNS records they provide

**Note:** For development/testing, you can skip this. Resend allows sending to your own email without verification.

---

## 🧪 TESTING THE SYSTEM

### Test 1: Send OTP

**Request:**
```bash
POST http://localhost:8000/api/otp/send
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "firstName": "Juan"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Verification code sent to your email",
  "expiresIn": 600
}
```

**Check your email** - you should receive a beautiful email with 6-digit code!

### Test 2: Verify OTP

**Request:**
```bash
POST http://localhost:8000/api/otp/verify
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "otp": "123456"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "email": "your-email@gmail.com"
}
```

### Test 3: Resend OTP

**Request:**
```bash
POST http://localhost:8000/api/otp/resend
Content-Type: application/json

{
  "email": "your-email@gmail.com",
  "firstName": "Juan"
}
```

---

## 📋 API ENDPOINTS

### 1. Send OTP
- **URL:** `POST /api/otp/send`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "firstName": "Juan" // optional
  }
  ```
- **Success Response:**
  ```json
  {
    "success": true,
    "message": "Verification code sent to your email",
    "expiresIn": 600
  }
  ```
- **Error Responses:**
  - `400` - Invalid email format
  - `429` - Too many requests (wait 1 minute)
  - `500` - Email sending failed

### 2. Verify OTP
- **URL:** `POST /api/otp/verify`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "otp": "123456"
  }
  ```
- **Success Response:**
  ```json
  {
    "success": true,
    "message": "Email verified successfully",
    "email": "user@example.com"
  }
  ```
- **Error Responses:**
  - `400` - Invalid or expired OTP
  - `500` - Server error

### 3. Resend OTP
- **URL:** `POST /api/otp/resend`
- **Body:** Same as Send OTP
- **Note:** Invalidates previous OTP codes

### 4. Check Verification Status
- **URL:** `GET /api/otp/check/:email`
- **Example:** `GET /api/otp/check/user@example.com`
- **Response:**
  ```json
  {
    "success": true,
    "verified": true,
    "email": "user@example.com"
  }
  ```

---

## 🎨 EMAIL TEMPLATES

### OTP Email Template
- Professional gradient design
- Large 6-digit code display
- 10-minute expiry warning
- Security tips
- Eduardo's Resort branding

### Booking Confirmation Email
- Success badge
- Booking reference number
- Check-in and check-out dates
- Itemized list of bookings (rooms/cottages/events/food)
- Total amount in Philippine Peso
- Next steps information

---

## 🔧 CONFIGURATION

### Email Service Settings

Located in `services/emailService.js`:

```javascript
// Sender email (must be verified in Resend)
from: 'Eduardo\'s Resort <onboarding@resend.dev>'

// For production, change to your verified domain:
// from: 'Eduardo\'s Resort <noreply@eduardosresort.com>'
```

### OTP Settings

Located in `controllers/otpController.js`:

```javascript
// OTP length: 6 digits
generateOTP() => "123456"

// OTP expiry: 10 minutes
expiresAt = new Date(Date.now() + 10 * 60 * 1000)

// Rate limit: 1 OTP per minute per email
// Prevents spam/abuse
```

---

## 🛡️ SECURITY FEATURES

1. **Rate Limiting** - Max 1 OTP request per minute per email
2. **Expiry Timer** - OTP expires after 10 minutes
3. **One-Time Use** - OTP marked as verified after successful validation
4. **Email Validation** - Regex check for valid email format
5. **Database Indexing** - Fast lookup for email, OTP, expiry checks
6. **Invalid Code Handling** - Clear error messages without leaking info

---

## ⚠️ TROUBLESHOOTING

### Error: "Resend API key not configured"

**Solution:**
1. Check `.env` file has `RESEND_API_KEY=re_...`
2. Restart backend server: `npm start`
3. Verify API key is correct (no extra spaces)

### Error: "Failed to send email"

**Possible causes:**
1. Invalid API key
2. No internet connection
3. Resend service down (check https://status.resend.com)

**Solution:**
1. Verify API key in `.env`
2. Check network connection
3. Check Resend logs: https://resend.com/emails

### Error: "Invalid verification code"

**Causes:**
1. OTP expired (older than 10 minutes)
2. Wrong OTP entered
3. OTP already used

**Solution:**
1. Click "Resend Code" button
2. Double-check the 6-digit code

### Email not received

**Checklist:**
1. Check spam/junk folder
2. Verify email address spelling
3. Check Resend dashboard for delivery status
4. Try resending OTP

---

## 📊 DATABASE SCHEMA

```sql
CREATE TABLE otp_verifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,           -- User's email
  otp_code VARCHAR(6) NOT NULL,          -- 6-digit code
  expires_at DATETIME NOT NULL,          -- Expiry timestamp
  verified BOOLEAN DEFAULT FALSE,        -- Verification status
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for fast lookup
  INDEX idx_email (email),
  INDEX idx_otp_code (otp_code),
  INDEX idx_expires_at (expires_at)
);
```

---

## 🎯 NEXT STEPS

Now that the backend is ready, you need to:

1. ✅ **Update BookingConfirmation.vue** 
   - Add OTP verification modal
   - Email input with "Send Code" button
   - 6-digit OTP input fields
   - Countdown timer
   - Resend button

2. ✅ **Test Complete Flow**
   - Enter booking details
   - Enter email → Send OTP
   - Check email → Enter OTP → Verify
   - Create booking
   - Process payment
   - Receive confirmation email

3. ✅ **Production Setup**
   - Verify domain in Resend
   - Update sender email
   - Add environment variables to hosting
   - Test email delivery

---

## 📞 RESEND SUPPORT

- **Documentation:** https://resend.com/docs
- **API Reference:** https://resend.com/docs/api-reference
- **Status Page:** https://status.resend.com
- **Email Logs:** https://resend.com/emails
- **Support:** https://resend.com/support

---

## 🎉 FREE TIER LIMITS

Resend Free Plan:
- ✅ **100 emails per day**
- ✅ **3,000 emails per month**
- ✅ Perfect for development and small projects
- ✅ No credit card required

**Tip:** For production with many bookings, consider upgrading to paid plan.

---

## 📝 SUMMARY

You now have a complete, production-ready email verification system:

✅ Backend OTP system with database  
✅ Beautiful email templates  
✅ Rate limiting and security  
✅ API endpoints ready  
✅ Error handling and validation  

**Ready to integrate with frontend!** 🚀

---

*Created for Eduardo's Resort Booking System*  
*Capstone Project - 2024*
