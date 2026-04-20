# GCash QR Code Troubleshooting Guide

## Issue
QR code not appearing in GCash payment receipts when printing

## Root Causes Identified

### 1. **Silent PayMongo API Failures** ✅ FIXED
**Before:** Errors in PayMongo payment link generation were silently caught, so if API failed, no payment URL was generated
**After:** Added console logs and error toast notifications to show what's happening

### 2. **Missing Payment URL in Receipt Data**
If PayMongo API fails, the receipt won't have a payment URL, so no QR code can be generated

### 3. **Printer Service Not Running**
Even if payment URL exists, the printer daemon must be running to send data to the physical printer

## Step-by-Step Troubleshooting

### Step 1: Check Console Logs for Payment Link Generation
**What to look for in browser console (F12 → Console):**
```
🔗 Generating PayMongo link for booking: [booking-ref]
✅ PayMongo checkout URL: https://pay.paymongo.com/...
✅ QR Code generated for: [booking-ref]
```

**If you see ❌ errors instead:**
- PayMongo API is failing
- Check backend console for details
- Verify PAYMONGO_SECRET_KEY in .env file

### Step 2: Check Backend Console Logs
**Run the backend and check for:**
```
📋 Print Booking Receipt Request:
   Receipt: POS-001
   Guest: John Doe
   Booking Ref: BOOKING-12345
   Payment Method: GCash
   Payment URL: ✅ SET (or ❌ MISSING)
🔳 Adding GCash QR code to receipt: https://pay.paymongo.com/...
✅ QR code added successfully
```

**If you see ⚠️ "Payment method is GCash but no paymentUrl provided":**
- Payment URL was not generated successfully
- Check Step 1 logs for PayMongo errors

### Step 3: Verify Printer Service is Running
**Check if printer daemon is active:**

**Windows - Check for printer-service.js process:**
```powershell
Get-Process | Where-Object {$_.Name -like "*node*"} | Select-Object Name, Id, CommandLine
```

**Check print queue directory:**
```powershell
dir "C:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend\print-queue"
```

If .prn files exist, printer service is queuing receipts
If .prn files don't exist, printer service may not be running

### Step 4: Verify PAYMONGO_SECRET_KEY Configuration
**Check .env file:**
```bash
cat .env | grep PAYMONGO
```

Should see:
```
PAYMONGO_SECRET_KEY=sk_live_... (or sk_test_...)
```

**If missing or empty:**
1. Get API key from PayMongo dashboard
2. Add to .env file
3. Restart backend server

### Step 5: Test Payment Link Creation Directly
**Using Postman or curl:**
```bash
curl -X POST http://localhost:8000/api/paymongo/create-payment-link \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "description": "Test - BOOKING-12345",
    "bookingId": 999,
    "email": "test@resort.local",
    "paymentMethod": "gcash"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "checkout_url": "https://pay.paymongo.com/...",
  "reference_number": "...",
  "payment_id": "...",
  "amount": 5000,
  "status": "unpaid"
}
```

**If you get an error:**
- Check backend console for details
- Verify PAYMONGO_SECRET_KEY is correct
- Check if PayMongo API is accessible

### Step 6: Test Print Endpoint with PayMongo URL
**Using Postman or curl:**
```bash
curl -X POST http://localhost:8000/api/pos/print/booking \
  -H "Content-Type: application/json" \
  -d '{
    "receiptNo": "POS-999",
    "date": "2024-04-19",
    "time": "14:30:00",
    "guestName": "John Doe",
    "phone": "09123456789",
    "email": "john@test.com",
    "roomName": "Deluxe Room",
    "checkInDate": "2024-04-20",
    "checkOutDate": "2024-04-22",
    "nights": 2,
    "adults": 2,
    "children": 0,
    "total": 5000,
    "paymentMethod": "GCash",
    "bookingReference": "BOOKING-12345",
    "paymentUrl": "https://pay.paymongo.com/..."
  }'
```

**Expected response:**
```json
{
  "success": true,
  "message": "Booking receipt printed successfully",
  "receiptNo": "POS-999"
}
```

**Check backend console for:**
```
🔳 Adding GCash QR code to receipt: https://pay.paymongo.com/...
✅ QR code added successfully
```

### Step 7: Verify QR Code is in Receipt File
**Check generated .prn file:**
```powershell
$qrFile = Get-ChildItem "C:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend\print-queue\booking*.prn" | Sort-Object LastWriteTime | Select-Object -Last 1
Get-Content $qrFile | Format-Hex | Select-Object -First 30
```

Look for QR code ESC/POS commands starting with `GS 28 6B` (hex: 1D 28 6B)

## Changes Made to Fix This

### Frontend (POS.vue)
1. **Added detailed logging** for PayMongo payment link generation
2. **Improved error handling** to show PayMongo API errors instead of silently catching
3. **Added logging in print functions** to verify payment URL is being passed

### Backend
1. **Added logging in posController.js** to show receipt data including payment URL
2. **Added logging in printerService.js** to show when QR code is being added

## Quick Checklist

- [ ] Backend server is running
- [ ] Printer service daemon is running
- [ ] PAYMONGO_SECRET_KEY is configured in .env
- [ ] PayMongo account is active and in correct environment (test/live)
- [ ] Check browser console (F12) for PayMongo errors
- [ ] Check backend console for printer service errors
- [ ] Payment URL is being generated when GCash is selected
- [ ] Payment URL is being passed to print endpoint
- [ ] Print queue directory has .prn files being created
- [ ] Physical printer is connected and powered on

## Testing Workflow

1. **Start backend:**
   ```
   npm start
   ```
   
2. **Open admin POS page**

3. **Create booking, select GCash, and checkout**

4. **Watch browser console (F12) for:**
   - 🔗 Generating PayMongo link...
   - ✅ PayMongo checkout URL: ...
   - 🖨️ Printing booking receipt...
   - 🔳 Adding GCash QR code...

5. **Watch backend terminal for:**
   - Similar log messages with ✅ or ❌ status
   - Any PayMongo API errors

6. **Check print-queue folder:**
   ```
   dir "reservision-backend\print-queue\*.prn"
   ```

## If QR Code Still Not Printing

### Possible Issue: Printer Daemon Not Running
The ESC/POS commands are being generated correctly, but the Windows printer daemon may not be sending to the physical printer.

**Solution:** Check `printer-service.js` is running in a separate terminal:
```powershell
cd CAPSTONE_BACKEND\reservision-backend
node printer-service.js
```

### Possible Issue: Physical Printer Not Supported
Some printer models don't support ESC/POS QR code commands.

**Solution:** Test printer capability:
```
GET http://localhost:8000/api/pos/printer/test
```

Response will show printer capabilities.

### Possible Issue: QR Code Data Too Long
PayMongo URLs can exceed 700 characters, which is the ESC/POS limit.

**Solution:** Verify URL length in backend logs and truncate if needed.

## Files Modified
- `/CAPSTONE_FRONTEND/reservision/src/views/admin/POS.vue` - Added logging and error handling
- `/CAPSTONE_BACKEND/reservision-backend/controllers/posController.js` - Added receipt data logging
- `/CAPSTONE_BACKEND/reservision-backend/services/printerService.js` - Added QR code logging
