# Bookings Backend Setup Guide

## 🎯 What Was Created

I've created a complete backend system for the Reservation page that connects to your MySQL database. Here's what's included:

### 📦 Backend Components

1. **Database Schema** (`schema/bookings.sql` & `SETUP_BOOKINGS_TABLES.sql`)
   - `bookings` table - Main booking records
   - `booking_items` table - Individual items in each booking
   - `occupied_dates` table - Prevents double bookings
   - `booking_logs` table - Audit trail for booking changes

2. **Controller** (`controllers/bookingsController.js`)
   - `getBookings()` - Get all bookings with filters
   - `getBooking()` - Get single booking with items
   - `getBookingByReference()` - Find booking by reference number
   - `createBooking()` - Create new booking
   - `updateBooking()` - Update booking status
   - `deleteBooking()` - Cancel booking
   - `getOccupiedDates()` - Get occupied dates for preventing double bookings

3. **Routes** (`routes/bookings.js`)
   - GET `/api/bookings` - All bookings
   - GET `/api/bookings/:id` - Single booking
   - GET `/api/bookings/reference/:reference` - Booking by reference
   - POST `/api/bookings` - Create booking
   - PUT `/api/bookings/:id` - Update booking
   - DELETE `/api/bookings/:id` - Cancel booking
   - GET `/api/bookings/occupied-dates` - All occupied dates
   - GET `/api/bookings/occupied-dates/:itemId` - Occupied dates for specific item

4. **Frontend Updates** (`Reservation.vue`)
   - Fetches rooms and cottages from `inventory_items` table
   - Fetches food items from `menu_items` table
   - Sends bookings to backend API
   - Fetches occupied dates to prevent double bookings
   - Displays real-time data from database

## 🚀 Setup Instructions

### Step 1: Create Database Tables

**Option A: Using phpMyAdmin (Recommended)**
1. Open phpMyAdmin: http://localhost/phpmyadmin
2. Select the `eduardos` database from the left sidebar
3. Click on the **SQL** tab at the top
4. Open the file: `SETUP_BOOKINGS_TABLES.sql`
5. Copy all contents and paste into the SQL textarea
6. Click **Go** to execute
7. You should see: "Bookings tables created successfully!"

**Option B: Using MySQL Command Line**
```bash
# Make sure MySQL is running in XAMPP first
cd C:\xampp\htdocs\cap2\CAPSTONE_BACKEND\reservision-backend
& "C:\xampp\mysql\bin\mysql.exe" -u root eduardos < SETUP_BOOKINGS_TABLES.sql
```

### Step 2: Start the Backend Server

```bash
cd C:\xampp\htdocs\cap2\CAPSTONE_BACKEND\reservision-backend
node server.js
```

You should see: `Server running at http://localhost:8000`

### Step 3: Test the API

Open your browser and test these endpoints:

1. **Check server is running:**
   ```
   http://localhost:8000
   ```
   Should return API info with all endpoints

2. **Get all bookings:**
   ```
   http://localhost:8000/api/bookings
   ```

3. **Get rooms/cottages:**
   ```
   http://localhost:8000/api/rooms
   ```

4. **Get occupied dates:**
   ```
   http://localhost:8000/api/bookings/occupied-dates
   ```

### Step 4: Run the Frontend

```bash
cd C:\xampp\htdocs\cap\CAPSTONE_FRONTEND\reservision
npm run dev
```

Then open: http://localhost:5173/reservation

## ✅ Verification Checklist

- [ ] Database tables created successfully
- [ ] Backend server running on port 8000
- [ ] Frontend can fetch rooms and cottages
- [ ] Frontend can fetch menu items
- [ ] Occupied dates are loading
- [ ] Can create a test booking
- [ ] Booking appears in database

## 🔍 How It Works

### Data Flow

1. **Loading Reservations Page:**
   ```
   Frontend -> GET /api/rooms -> Database -> inventory_items
   Frontend -> GET /api/restaurant/menu -> Database -> menu_items
   Frontend -> GET /api/bookings/occupied-dates -> Database -> occupied_dates
   ```

2. **Creating a Booking:**
   ```
   User fills form -> Frontend -> POST /api/bookings -> Backend validates
   -> Creates booking record -> Creates booking_items -> Creates occupied_dates
   -> Returns booking_reference -> Shows confirmation
   ```

3. **Preventing Double Bookings:**
   - Occupied dates stored in `occupied_dates` table
   - Frontend fetches these dates
   - Calendar modal disables occupied dates
   - Backend validates on booking creation

### Database Relationships

```
bookings (1) ----< (many) booking_items
   |
   |
   +----< (many) occupied_dates
   |
   +----< (many) booking_logs

inventory_items (1) ----< (many) occupied_dates
```

## 📊 Sample Data Structure

### Creating a Booking (POST /api/bookings)

```json
{
  "customer": {
    "firstName": "Juan",
    "lastName": "Dela Cruz"
  },
  "contact": {
    "email": "juan@email.com",
    "phone": "+639171234567",
    "address": "123 Main St",
    "city": "Manila",
    "country": "Philippines",
    "postal": "1000"
  },
  "checkIn": "2026-02-15",
  "checkOut": "2026-02-17",
  "nights": 2,
  "adults": 2,
  "children": 0,
  "items": [
    {
      "item": {
        "item_id": 1,
        "name": "Deluxe Ocean View",
        "price": 3500,
        "perNight": true,
        "category": "Room"
      },
      "qty": 1,
      "guests": 2
    }
  ],
  "total": 7000,
  "subtotal": 7000,
  "specialRequests": "Late check-in requested"
}
```

### Response

```json
{
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "booking_id": 1,
    "booking_reference": "BK20260201001",
    "first_name": "Juan",
    "last_name": "Dela Cruz",
    "email": "juan@email.com",
    "total": 7000,
    "booking_status": "Pending",
    "items": [...]
  }
}
```

## 🛠️ Troubleshooting

### Backend Issues

**Problem: Server won't start**
- Check if port 8000 is already in use
- Kill existing node processes: `taskkill /F /IM node.exe`
- Check for syntax errors in code

**Problem: Database connection failed**
- Verify MySQL is running in XAMPP
- Check database name is `eduardos`
- Verify credentials in `config/db.js`

**Problem: Foreign key constraint errors**
- Make sure `inventory_items` table exists
- Run the setup SQL script in correct order

### Frontend Issues

**Problem: No data loading**
- Check browser console for errors
- Verify backend is running on port 8000
- Check API endpoint URLs in `Reservation.vue`
- Test API endpoints directly in browser

**Problem: CORS errors**
- Verify `cors()` is enabled in `server.js`
- Check backend logs for errors

**Problem: Booking creation fails**
- Check all required fields are filled
- Verify phone number is 10 digits
- Check email format is valid
- Look at backend console for error details

## 📝 API Endpoints Reference

### Bookings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookings` | Get all bookings (supports filters) |
| GET | `/api/bookings/:id` | Get single booking by ID |
| GET | `/api/bookings/reference/:ref` | Get booking by reference number |
| POST | `/api/bookings` | Create new booking |
| PUT | `/api/bookings/:id` | Update booking status |
| DELETE | `/api/bookings/:id` | Cancel booking |
| GET | `/api/bookings/occupied-dates` | Get all occupied dates |
| GET | `/api/bookings/occupied-dates/:itemId` | Get occupied dates for specific item |

### Query Parameters (GET /api/bookings)

- `status` - Filter by booking status (Pending, Confirmed, etc.)
- `email` - Search by customer email
- `startDate` - Filter by check-in date (YYYY-MM-DD)
- `endDate` - Filter by check-out date (YYYY-MM-DD)
- `limit` - Maximum results to return (default: 100)

## 🎓 Next Steps

1. **Test the system:**
   - Create sample bookings
   - Verify data in database
   - Test date validation

2. **Add features:**
   - Payment integration
   - Email confirmations
   - Admin dashboard for managing bookings
   - Booking search and filtering

3. **Enhance security:**
   - Add authentication
   - Validate all inputs
   - Add rate limiting
   - Sanitize user data

## 📞 Need Help?

If you encounter any issues:
1. Check the browser console for frontend errors
2. Check the terminal for backend errors
3. Verify database tables were created
4. Test API endpoints individually
5. Check that all services are running (MySQL, Node.js, Vite)

---

**Created:** February 1, 2026  
**Backend Port:** 8000  
**Frontend Port:** 5173  
**Database:** eduardos (MySQL)
