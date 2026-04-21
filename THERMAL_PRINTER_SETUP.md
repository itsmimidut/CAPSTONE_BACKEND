# Thermal Printer Direct Printing Setup

## ✅ Changes Made

### Backend
1. **Created Printer Service** (`services/printerService.js`)
   - `printBookingReceipt()` - Prints booking receipts to USB thermal printer
   - `printRegularReceipt()` - Prints POS receipts to USB thermal printer
   - `testPrinterConnection()` - Tests if printer is connected

2. **Added Controller Methods** (`controllers/posController.js`)
   - `POST /api/pos/print/booking` - Endpoint for booking receipts
   - `POST /api/pos/print/regular` - Endpoint for POS receipts
   - `GET /api/pos/printer/test` - Test printer connection

3. **Added Routes** (`routes/pos.js`)
   - `/print/booking` - POST request for booking receipt printing
   - `/print/regular` - POST request for regular receipt printing
   - `/printer/test` - GET test connection

### Frontend
4. **Updated POS.vue** (`src/views/admin/POS.vue`)
   - Replaced `showBookingReceipt()` method
   - Now sends receipt data to backend instead of using `window.print()`
   - Calls `POST /api/pos/print/booking` endpoint
   - Shows toast notifications for print success/failure
   - Falls back gracefully if printer unavailable

---

## 🔧 Installation Steps

### Step 1: Install Thermal Printer Library

Run this command in your backend directory:

```bash
cd CAPSTONE_BACKEND/reservision-backend
npm install escpos escpos-usb
```

**What it does:**
- `escpos` - Generates ESC/POS commands for thermal printers
- `escpos-usb` - Handles USB communication with the printer

### Step 2: Test Printer Connection

Before using, test if your printer is detected:

```bash
# Using curl or Postman
GET http://localhost:8000/api/pos/printer/test
```

Expected response:
```json
{
  "connected": true,
  "message": "Printer is connected and ready",
  "printerType": "POS-58mm Series"
}
```

### Step 3: Verify Setup

1. Start your backend: `npm start`
2. Start your frontend: `npm run dev`
3. In POS, try creating a walk-in booking
4. Click "Pay & Complete" 
5. Receipt should **print directly to thermal printer** (no system dialog)

---

## 📋 How It Works Now

### Old Flow (System Print Dialog)
```
POS.vue → window.print() → Browser Print Dialog → Printer
         (User sees print dialog, must confirm)
```

### New Flow (Direct Automatic Printing)
```
POS.vue → Backend API → Printer Service → USB Thermal Printer
         (Automatic, no dialog needed)
```

---

## 📊 Receipt Format

The printer service formats receipts as:

```
═══════════════════════
RESERVISION SYSTEM
═══════════════════════
Walk-In Room Booking

Receipt: POS-001
Date: 2026-03-02
Time: 14:30

───────────────────────
BOOKING DETAILS
───────────────────────

Guest: John Doe
Phone: +1-234-567-8900

Room: Deluxe Room
Check-in: 2026-03-02
Check-out: 2026-03-04
Nights: 2

Adults: 2
Children: 1

───────────────────────
AMOUNT DUE
───────────────────────

Rate (per night): ₱5,000
Number of nights: 2

₱10,000

───────────────────────
PAYMENT METHOD
───────────────────────
GCash

SCAN TO PAY
(QR Code here)

Booking Ref: BK-xxx-2026-0001

═══════════════════════
Thank you for choosing Reservision!
Please keep this receipt for check-in
═══════════════════════
```

---

## 🐛 Troubleshooting

### Printer Not Detected
1. **Check USB Connection**
   - Is printer plugged in and powered on?
   - Is USB cable connected to computer?

2. **Test Connection**
   ```bash
   curl http://localhost:8000/api/pos/printer/test
   ```
   
3. **Check Printer Drivers**
   - Windows: Device Manager → Ports (COM & LPT)
   - Printer should appear as USB device or COM port

### Receipt Doesn't Print
1. Check backend logs for errors
2. Verify receipt data is being sent properly
3. Try test endpoint first
4. Check if printer has paper

### Garbled Output / Spacing Issues
1. Printer service uses proper ESC/POS formatting
2. Should not have spacing issues like before
3. If printer incompatible, update character encoding in service:
   ```javascript
   // Change from 'cp857' to:
   'utf8', 'cp1252', 'gb2312', depending on your printer
   ```

---

## 📝 API Request Examples

### Print Booking Receipt

```javascript
// Frontend example
fetch('http://localhost:8000/api/pos/print/booking', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    receiptNo: 'POS-001',
    date: '2026-03-02',
    time: '14:30',
    guestName: 'John Doe',
    phone: '09123456789',
    email: 'john@example.com',
    roomName: 'Deluxe Room',
    checkInDate: '2026-03-02',
    checkOutDate: '2026-03-04',
    nights: 2,
    adults: 2,
    children: 1,
    pricePerNight: '5000',
    total: 10000,
    paymentMethod: 'GCash',
    bookingReference: 'BK-xxx-2026-0001'
  })
})
.then(res => res.json())
.then(data => console.log(data))
```

### Test Printer

```javascript
fetch('http://localhost:8000/api/pos/printer/test', {
  method: 'GET'
})
.then(res => res.json())
.then(data => console.log(data))
```

---

## 🎯 Benefits

✅ **No system print dialog** - Prints automatically
✅ **Proper formatting** - Uses ESC/POS commands directly
✅ **No spacing issues** - Consistent receipt layout
✅ **Fast printing** - Direct USB communication
✅ **Professional receipts** - Proper thermal printer formatting
✅ **Error handling** - Graceful fallbacks if printer unavailable

---

## 🚀 Next Steps

1. **Install packages**: `npm install escpos escpos-usb`
2. **Restart backend**: `npm start`
3. **Test connection**: `GET /api/pos/printer/test`
4. **Create test booking**: Try the POS booking flow
5. **Monitor console**: Check for any print errors

---

## 📞 Support

If you encounter issues:
1. Check browser console for frontend errors
2. Check backend logs for service errors
3. Verify printer is powered and connected
4. Test with: `GET http://localhost:8000/api/pos/printer/test`
