# 🚀 QUICK START - Bookings System

## ⚡ 3-Step Setup

### 1️⃣ Create Database Tables
Open phpMyAdmin → http://localhost/phpmyadmin
- Select database: `eduardos`
- Click `SQL` tab
- Copy & paste from: `SETUP_BOOKINGS_TABLES.sql`
- Click `Go`

### 2️⃣ Start Backend
```bash
cd C:\xampp\htdocs\cap2\CAPSTONE_BACKEND\reservision-backend
node server.js
```
✅ You should see: `Server running at http://localhost:8000`

### 3️⃣ Start Frontend
```bash
cd C:\xampp\htdocs\cap\CAPSTONE_FRONTEND\reservision
npm run dev
```
✅ Open: http://localhost:5173/reservation

---

## 🧪 Quick Test

1. Open reservation page
2. Click "Rooms" tab - should show database rooms
3. Click "Cottages" tab - should show database cottages
4. Add a room to booking
5. Select check-in/out dates
6. Fill contact form
7. Submit booking
8. Check database:
```sql
SELECT * FROM bookings ORDER BY created_at DESC LIMIT 1;
```

---

## 📍 Important URLs

| Service | URL |
|---------|-----|
| Backend API | http://localhost:8000 |
| Bookings API | http://localhost:8000/api/bookings |
| Rooms API | http://localhost:8000/api/rooms |
| Frontend | http://localhost:5173/reservation |
| phpMyAdmin | http://localhost/phpmyadmin |

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| No rooms showing | Check backend is running, verify `inventory_items` table has data |
| Can't create booking | Fill all required fields, check backend console for errors |
| Backend won't start | Kill existing node: `taskkill /F /IM node.exe` |
| Database error | Run `SETUP_BOOKINGS_TABLES.sql` in phpMyAdmin |

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `SETUP_BOOKINGS_TABLES.sql` | Create database tables |
| `TEST_BOOKINGS_DATA.sql` | Add sample bookings |
| `BOOKINGS_SETUP_GUIDE.md` | Full setup guide |
| `controllers/bookingsController.js` | Backend logic |
| `routes/bookings.js` | API endpoints |
| `Reservation.vue` | Frontend page |

---

## ✅ What Changed

**BEFORE:** Mock data hardcoded in Reservation.vue
```javascript
itemData: {
  rooms: [{ id: 'r1', name: 'Garden Glass Villa', ... }]
}
```

**AFTER:** Real data from database
```javascript
async fetchInventoryItems() {
  const response = await fetch('http://localhost:8000/api/rooms')
  const data = await response.json()
  this.itemData.rooms = data.data
}
```

---

## 💾 Database Tables

- `bookings` - Main booking records
- `booking_items` - Items in each booking
- `occupied_dates` - Prevents double bookings
- `booking_logs` - Audit trail

---

## 📞 Need Help?

See full documentation: `BOOKINGS_SETUP_GUIDE.md`

---

**Ready to go!** 🎉
