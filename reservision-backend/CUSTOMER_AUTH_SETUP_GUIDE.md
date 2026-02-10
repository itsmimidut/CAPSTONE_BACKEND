# 🔐 Customer Authentication System - Setup Guide

## Overview
Complete authentication system for customer signup and login with bcrypt password hashing, JWT token authentication, and session management.

---

## 📋 Table of Contents
1. [Database Setup](#database-setup)
2. [Backend API](#backend-api)
3. [Frontend Integration](#frontend-integration)
4. [Testing](#testing)
5. [Security Features](#security-features)
6. [Troubleshooting](#troubleshooting)

---

## 🗄️ Database Setup

### Step 1: Create Customers Table

Run the SQL file to create the customers table:

```bash
# From MySQL command line
mysql -u root -p eduardo_resort < SETUP_CUSTOMERS_TABLE.sql

# Or using MySQL Workbench or phpMyAdmin
# Copy and paste the SQL from SETUP_CUSTOMERS_TABLE.sql
```

### Table Structure

```sql
CREATE TABLE customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,         -- Bcrypt hashed
  phone VARCHAR(20),
  address VARCHAR(255),
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Philippines',
  postal_code VARCHAR(20),
  profile_image TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Verify Table Creation

```sql
-- Check if table exists
DESCRIBE customers;

-- View any existing customers
SELECT customer_id, first_name, last_name, email, created_at FROM customers;
```

---

## 🔌 Backend API

### File Structure

```
CAPSTONE_BACKEND/reservision-backend/
├── controllers/
│   └── customerController.js    ✅ Updated with signup/login
├── routes/
│   └── customers.js              ✅ Routes configured
└── server.js                     ✅ Routes registered
```

### Available Endpoints

#### 1. **Customer Signup**
```http
POST http://localhost:8000/api/customers/signup
Content-Type: application/json

{
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "email": "juan@example.com",
  "password": "password123",
  "contactNumber": "09171234567"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "customer": {
    "id": 1,
    "firstName": "Juan",
    "lastName": "Dela Cruz",
    "email": "juan@example.com",
    "phone": "09171234567",
    "role": "customer"
  },
  "message": "Account created successfully"
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Email already registered"
}
```

#### 2. **Customer Login**
```http
POST http://localhost:8000/api/customers/login
Content-Type: application/json

{
  "email": "juan@example.com",
  "password": "password123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "customer": {
    "id": 1,
    "firstName": "Juan",
    "lastName": "Dela Cruz",
    "email": "juan@example.com",
    "phone": "09171234567",
    "role": "customer"
  },
  "message": "Login successful"
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

### Validation Rules

**Signup:**
- ✅ All fields (firstName, lastName, email, password) required
- ✅ Email format validation
- ✅ Password minimum 6 characters
- ✅ Email uniqueness check
- ✅ Password hashed with bcrypt (10 rounds)

**Login:**
- ✅ Email and password required
- ✅ Bcrypt password comparison
- ✅ JWT token generation (7 days expiry)

---

## 🎨 Frontend Integration

### File Structure

```
CAPSTONE_FRONTEND/reservision/src/
├── components/
│   ├── SignupForm.vue     ✅ Updated with backend integration
│   └── LoginForm.vue      ✅ Updated with backend integration
└── stores/
    └── auth.js            ✅ Added helper methods
```

### Authentication Flow

#### Signup Flow:
1. User fills form (full name, email, password, contact number)
2. Frontend splits full name into firstName/lastName
3. POST request to `/api/customers/signup`
4. Backend validates, hashes password, creates customer
5. Backend returns JWT token and customer data
6. Frontend stores token in `localStorage`
7. Frontend stores user data in `localStorage`
8. Redirect to `/customer` dashboard

#### Login Flow:
1. User enters email and password
2. POST request to `/api/customers/login`
3. Backend validates credentials with bcrypt
4. Backend returns JWT token and customer data
5. Frontend stores token in `localStorage`
6. Frontend updates auth store
7. Redirect based on user role

### Auth Store Methods

```javascript
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Set loading state
auth.setLoading(true)

// Clear error messages
auth.clearError()

// Set error message
auth.setError('Invalid credentials')

// Set user data
auth.setUser({
  id: 1,
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  email: 'juan@example.com',
  role: 'customer'
})

// Initialize from localStorage on app startup
auth.initFromStorage()

// Logout
auth.logout() // Clears localStorage and auth state
```

### LocalStorage Structure

```javascript
// After successful login/signup:
localStorage.getItem('authToken')  
// "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

localStorage.getItem('user')       
// "{\"id\":1,\"firstName\":\"Juan\",\"role\":\"customer\"}"
```

---

## 🧪 Testing

### Manual Testing with Browser

#### Test Signup:
1. Navigate to `http://localhost:5173/signup`
2. Fill in the form:
   - Full Name: Juan Dela Cruz
   - Email: test@example.com
   - Password: password123
   - Contact: 09171234567
3. Click "Create Account"
4. Should redirect to `/customer` dashboard
5. Check localStorage has `authToken` and `user`

#### Test Login:
1. Navigate to `http://localhost:5173/login`
2. Enter credentials from signup
3. Click "Login"
4. Should redirect to `/customer` dashboard

### Testing with Postman

#### Signup Request:
```
POST http://localhost:8000/api/customers/signup
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "firstName": "Test",
  "lastName": "User",
  "email": "test@example.com",
  "password": "password123",
  "contactNumber": "09171234567"
}
```

#### Login Request:
```
POST http://localhost:8000/api/customers/login
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "email": "test@example.com",
  "password": "password123"
}
```

### Verify Database:
```sql
-- Check newly created customer
SELECT * FROM customers WHERE email = 'test@example.com';

-- Verify password is hashed
-- Should see something like: $2a$10$...
```

---

## 🔒 Security Features

### Implemented Security Measures:

1. **Password Hashing**
   - Uses `bcrypt` with 10 salt rounds
   - Passwords never stored in plain text
   - One-way hashing (irreversible)

2. **JWT Tokens**
   - Signed with secret key
   - 7 days expiration
   - Contains user ID, email, role, name

3. **Input Validation**
   - Email format validation
   - Password length requirement (min 6 chars)
   - Required field checks
   - SQL injection protection (parameterized queries)

4. **Error Handling**
   - Generic error messages (no exposure of system details)
   - Proper HTTP status codes
   - Server-side validation

5. **Database Security**
   - Prepared statements (prevents SQL injection)
   - Email uniqueness constraint
   - Indexed columns for performance

---

## 🔧 Environment Variables

Make sure your `.env` file has:

```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=eduardo_resort

# JWT Secret (change this to a random string)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Server Configuration
PORT=8000
```

**⚠️ IMPORTANT:** Change `JWT_SECRET` to a random, complex string in production!

---

## 🐛 Troubleshooting

### Issue: "Email already registered"
**Solution:** Email must be unique. Use a different email or delete the existing customer.
```sql
DELETE FROM customers WHERE email = 'test@example.com';
```

### Issue: "Failed to register customer"
**Possible causes:**
1. Database not running
2. Customers table doesn't exist
3. Database connection error

**Fix:**
```bash
# Check if MySQL is running
mysql -u root -p

# Verify table exists
USE eduardo_resort;
SHOW TABLES;
DESCRIBE customers;
```

### Issue: "Invalid email or password"
**Possible causes:**
1. Wrong password
2. Email not in database
3. Password hashing mismatch

**Fix:**
```sql
-- Check if customer exists
SELECT email FROM customers WHERE email = 'your@email.com';
```

### Issue: Token not being saved
**Fix:**
- Open browser DevTools → Application → Local Storage
- Check if `authToken` and `user` keys exist
- Clear localStorage and try again:
```javascript
localStorage.clear()
```

### Issue: CORS Error
**Fix:** Make sure backend has CORS enabled in `server.js`:
```javascript
import cors from 'cors';
app.use(cors());
```

---

## 📝 Quick Start Checklist

- [ ] MySQL database running
- [ ] Database `eduardo_resort` created
- [ ] `SETUP_CUSTOMERS_TABLE.sql` executed
- [ ] Backend server running (`npm run dev` in backend folder)
- [ ] Frontend server running (`npm run dev` in frontend folder)
- [ ] `.env` file configured with `JWT_SECRET`
- [ ] Test signup at `http://localhost:5173/signup`
- [ ] Test login at `http://localhost:5173/login`
- [ ] Verify localStorage has token after login
- [ ] Test redirect to customer dashboard

---

## 🎯 Next Steps

After authentication is working:

1. **Add Email Verification**
   - Send verification email on signup
   - Verify email before allowing login

2. **Add Password Reset**
   - "Forgot Password" functionality
   - Email reset link
   - Token-based password reset

3. **Add Session Management**
   - Automatic token refresh
   - Logout all sessions
   - Remember me functionality

4. **Add Profile Management**
   - Update customer profile
   - Change password
   - Upload profile picture

5. **Add Role-Based Access Control**
   - Protect customer-only routes
   - Middleware for authentication
   - Route guards in Vue Router

---

## 📞 Support

If you encounter any issues:

1. Check console logs (browser and server)
2. Verify database connection
3. Check if all required tables exist
4. Ensure `.env` variables are set correctly
5. Review this documentation

---

**✅ Authentication System Complete!**

Your customer signup and login system is now fully functional with secure password hashing, JWT token authentication, and proper session management.
