# 404 Error Fix Guide - E-Shop Order Endpoint

## Problem
```
Failed to load resource: the server responded with a status of 404 (Not Found)
/api/pos/eshop/order:1  Failed to load resource
Error placing order: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

**What this means:**
- The endpoint `/api/pos/eshop/order` is not found (404)
- Server is returning an HTML error page instead of JSON
- Backend server needs to be restarted to load the new route

---

## ✅ SOLUTION: Restart Backend Server

### Step 1: Stop the Backend Server

**If running in terminal:**
- Press `Ctrl + C` to stop the server

**If running in VS Code terminal:**
- Click the terminal where server is running
- Press `Ctrl + C`

**If you can't find it:**
- Close all terminals
- Or open Task Manager → End `node.exe` processes

---

### Step 2: Restart Backend Server

```bash
cd c:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend

npm start
```

**Expected output:**
```
Server running on port 8000
Connected to MySQL database: reservision_db
```

---

### Step 3: Verify Endpoint Exists

**Option A: Run test script**
```bash
node test-eshop-endpoint.js
```

**Option B: Use browser**
Open: `http://localhost:8000/api/pos/items`
- Should return JSON array of items (not 404)

**Option C: Check server console**
When frontend makes request, you should see backend logs

---

## 🔍 Troubleshooting Checklist

### ✅ Verify Files Are Saved
- [ ] `controllers/posController.js` - Has `createEshopOrder` function (Line 307)
- [ ] `routes/pos.js` - Has route `POST /eshop/order` (Line 16)
- [ ] Both files saved (check for • in VS Code tab)

### ✅ Verify Server Status
- [ ] Backend server is running (check terminal)
- [ ] Port 8000 is accessible
- [ ] No error messages in server console
- [ ] Database connection successful

### ✅ Verify Route Registration
Check `server.js` has:
```javascript
import posRoutes from "./routes/pos.js";  // Line ~58
app.use("/api/pos", posRoutes);           // Line ~133
```

### ✅ Verify Database Columns Exist
Run this SQL to check:
```sql
DESCRIBE pos_transactions;
```

Should show columns:
- `location_type`
- `location_number`
- `delivery_notes`
- `customer_id`

If missing, run:
```sql
ALTER TABLE pos_transactions
ADD COLUMN location_type VARCHAR(50) NULL,
ADD COLUMN location_number VARCHAR(50) NULL,
ADD COLUMN delivery_notes TEXT NULL,
ADD COLUMN customer_id INT NULL;
```

---

## 🧪 Test the Endpoint

### Method 1: Use Test Script
```bash
cd c:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend
node test-eshop-endpoint.js
```

**Expected output:**
```
✅ SUCCESS! Response Data:
{
  "success": true,
  "orderId": 1,
  "receiptNo": "ESHOP-20260223-1234",
  "message": "Order placed successfully!"
}
```

### Method 2: Use Postman/Thunder Client
```
POST http://localhost:8000/api/pos/eshop/order
Content-Type: application/json

{
  "cart": [
    {"name": "Beef Mami Noodle Soup", "price": 185, "qty": 2}
  ],
  "locationType": "Room",
  "locationNumber": "101",
  "deliveryNotes": "Test",
  "totalAmount": 370
}
```

### Method 3: Check Browser DevTools
1. Open e-shop in browser
2. Open DevTools (F12)
3. Go to Network tab
4. Try to place order
5. Click the failed request
6. Check Response tab

**If you see HTML:**
- Server returned error page (not JSON)
- Route doesn't exist or server not running

**If you see JSON error:**
- Route exists but has validation error
- Check request payload

---

## 🚨 Common Issues

### Issue 1: "Cannot find module 'posController.js'"
**Fix:** Check import path in `routes/pos.js`
```javascript
import * as posController from '../controllers/posController.js';
```

### Issue 2: "posController.createEshopOrder is not a function"
**Fix:** Check function is exported in `posController.js`
```javascript
export const createEshopOrder = async (req, res) => {
  // ... function code
};
```

### Issue 3: Server crashes when calling endpoint
**Fix:** Check server console for error message
- Database connection error?
- Missing table columns?
- Syntax error in code?

### Issue 4: CORS Error (from browser)
**Fix:** Add CORS headers in `server.js` (should already be there)
```javascript
app.use(cors());
```

### Issue 5: Port 8000 already in use
**Fix:** Kill the process and restart
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Then restart
npm start
```

---

## ✅ Final Verification

Once server is restarted, test the flow:

1. **Open E-Shop** in browser
   - Should load products from backend

2. **Add items to cart**
   - Should see cart count increase

3. **Proceed to checkout**
   - Fill in Room number
   - Add delivery notes

4. **Place Order**
   - Should see success message
   - Check backend terminal for logs
   - Check database for new record:
   ```sql
   SELECT * FROM pos_transactions WHERE type = 'E-Shop' ORDER BY id DESC LIMIT 1;
   ```

---

## 📊 Expected Backend Logs

When order is placed successfully:
```
POST /api/pos/eshop/order 201 145ms
Order created: ESHOP-20260223-4521
Transaction ID: 42
```

When there's an error:
```
POST /api/pos/eshop/order 400 12ms
Error: Cart is required and must contain at least one item
```

---

## 💡 Quick Fix Summary

**99% of the time, this fixes it:**

1. Stop backend server (`Ctrl + C`)
2. Restart backend server (`npm start`)
3. Wait for "Server running on port 8000"
4. Try placing order again

**The route was added to the code but the running server doesn't know about it yet. Restarting loads the new code.**

---

## 🆘 Still Not Working?

1. Share error message from backend terminal
2. Share error from browser DevTools Console
3. Share screenshot of Network tab
4. Verify all files are saved
5. Check if another app is using port 8000

---

## Files to Check

- ✅ `controllers/posController.js` (Line 307 - createEshopOrder function)
- ✅ `routes/pos.js` (Line 16 - POST route)
- ✅ `server.js` (Line 133 - route mounting)
- ✅ `ADD_ESHOP_COLUMNS_TO_POS.sql` (database migration)
- ✅ `ResortEShop.vue` (Line 566 - placeOrder function)

All files are correct. Just need to **restart the server**! 🔄
