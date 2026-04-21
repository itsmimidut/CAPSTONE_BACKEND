# Native Thermal Printer Service Setup

## 📋 Overview

The **Thermal Printer Service** is a Node.js application that:
- Monitors the print queue directory for new print jobs
- Sends ESC/POS commands directly to your USB thermal printer
- Automatically processes and deletes completed jobs
- Logs all printing activity for debugging
- Handles printer connection failures gracefully

---

## 🚀 Quick Start

### Step 1: Install Dependencies

```bash
cd CAPSTONE_BACKEND/reservision-backend
npm install usb
```

### Step 2: Run the Printer Service

**Option A: Manual Start (Development)**
```bash
node printer-service.js
```

**Option B: Background Service (Windows Production)**

Install NSSM (Node Service Manager):
```bash
npm install -g nssm
```

Register as Windows service:
```bash
nssm install PrinterService "C:\path\to\node.exe" "C:\path\to\printer-service.js"
```

Start the service:
```bash
nssm start PrinterService
```

View logs:
```bash
nssm logs PrinterService
```

---

## 📊 How It Works

### Flow Diagram

```
POS Frontend
    ↓
Click "Pay & Complete"
    ↓
Backend API (/api/pos/print/booking)
    ↓
Printer Service (printerService.js)
    ↓
Write ESC/POS to file → print-queue/
    ↓
Printer Service (printer-service.js) watches directory
    ↓
New job detected
    ↓
Read ESC/POS file
    ↓
Send to USB Printer (via USB module)
    ↓
Delete file after printing
    ↓
Log complete
```

### Directory Structure

```
CAPSTONE_BACKEND/
├── reservision-backend/
│   ├── printer-service.js          ← Native printer service (runs separate)
│   ├── printer-service.log         ← Service logs
│   ├── print-queue/                ← ESC/POS files (auto-created)
│   │   ├── booking-POS-001-1709398400000.txt
│   │   ├── receipt-POS-002-1709398500000.txt
│   │   └── [processed files auto-deleted]
│   ├── services/
│   │   └── printerService.js       ← Queue management (backend)
│   ├── controllers/
│   │   └── posController.js        ← API endpoints
│   └── routes/
│       └── pos.js                  ← Route handlers
```

---

## 🛠️ Configuration

Edit `printer-service.js` to configure your printer:

```javascript
const PRINTER_CONFIG = {
  vendorId: 0x0483,      // ← Change to your printer's Vendor ID
  productId: 0x0110,     // ← Change to your printer's Product ID
  vendor: 'Generic',
  model: 'POS-58mm',
  timeout: 5000
};
```

### Finding Your Printer's USB IDs

**Windows:**
1. Open Device Manager
2. Find your printer under "Ports (COM & LPT)" or "Universal Serial Bus controllers"
3. Right-click → Properties → Details
4. Look for "Device Instance Path" or "Hardware IDs"
5. Extract Vendor ID and Product ID

**Linux:**
```bash
lsusb
# Output: Bus 001 Device 005: ID 0483:0110 STMicroelectronics Printer
#                                 ^^^^  ^^^^
#                          Vendor ID  Product ID
```

---

## 📡 API Endpoints

### 1. Test Printer Connection

```http
GET http://localhost:8000/api/pos/printer/test
```

**Response (Success):**
```json
{
  "success": true,
  "connected": true,
  "message": "Printer service is ready",
  "queueDirectory": "C:\\...\\print-queue",
  "printerType": "POS-58mm Series (Print Queue Mode)"
}
```

---

### 2. Get Pending Print Jobs

```http
GET http://localhost:8000/api/pos/printer/queue
```

**Response:**
```json
{
  "success": true,
  "message": "Found 2 pending print job(s)",
  "jobs": [
    {
      "filename": "booking-POS-001-1709398400000.txt",
      "filepath": "C:\\...\\print-queue\\booking-POS-001-1709398400000.txt",
      "createdAt": "2026-03-02T14:30:00.000Z"
    },
    {
      "filename": "receipt-POS-002-1709398500000.txt",
      "filepath": "C:\\...\\print-queue\\receipt-POS-002-1709398500000.txt",
      "createdAt": "2026-03-02T14:31:00.000Z"
    }
  ],
  "queueDir": "C:\\...\\print-queue"
}
```

---

### 3. Print Booking Receipt

```http
POST http://localhost:8000/api/pos/print/booking
Content-Type: application/json

{
  "receiptNo": "POS-001",
  "date": "2026-03-02",
  "time": "14:30",
  "guestName": "John Doe",
  "phone": "09123456789",
  "email": "john@example.com",
  "roomName": "Deluxe Room",
  "checkInDate": "2026-03-02",
  "checkOutDate": "2026-03-04",
  "nights": 2,
  "adults": 2,
  "children": 1,
  "pricePerNight": "5000",
  "total": 10000,
  "paymentMethod": "GCash",
  "bookingReference": "BK-xxx-2026-0001"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking receipt queued for printing",
  "receiptNo": "POS-001",
  "queueFile": "booking-POS-001-1709398400000.txt"
}
```

---

## 📝 Log Files

Printer service logs are saved to:
```
CAPSTONE_BACKEND/reservision-backend/printer-service.log
```

**Example Log Content:**
```
[2026-03-02T14:30:00.000Z] [INFO] ============================================
[2026-03-02T14:30:00.000Z] [INFO] Thermal Printer Service Starting
[2026-03-02T14:30:00.000Z] [INFO] ============================================
[2026-03-02T14:30:00.000Z] [INFO] Print Queue Directory: C:\...\print-queue
[2026-03-02T14:30:00.000Z] [INFO] Printer Model: POS-58mm Series
[2026-03-02T14:30:00.000Z] [INFO] Check Interval: 1000ms
[2026-03-02T14:30:00.000Z] [INFO] ============================================
[2026-03-02T14:30:00.000Z] [INFO] Service is running. Watching for print jobs...

[2026-03-02T14:30:15.000Z] [INFO] Processing print job: booking-POS-001-1709398400000.txt
[2026-03-02T14:30:15.500Z] [SUCCESS] Printed successfully via USB: booking-POS-001-1709398400000.txt
```

---

## 🐛 Troubleshooting

### Printer Not Found

**Problem:** Service logs show "No compatible printer found on USB"

**Solutions:**
1. **Install USB drivers:**
   - Download drivers from printer manufacturer
   - Run driver installer
   - Restart service

2. **Find correct USB IDs:**
   ```bash
   node -e "require('usb').getDeviceList().forEach(d => console.log(d.deviceDescriptor.idVendor.toString(16), d.deviceDescriptor.idProduct.toString(16)))"
   ```
   Update `PRINTER_CONFIG` with correct IDs

3. **Check USB connection:**
   - Is printer powered on?
   - Is USB cable properly connected?
   - Try different USB port
   - Check Device Manager for unknown devices

---

### Print Jobs Not Processing

**Problem:** Files stay in print-queue folder without printing

**Solutions:**
1. **Check service is running:**
   ```bash
   # Windows
   tasklist | findstr node
   
   # Linux
   ps aux | grep printer-service
   ```

2. **Check logs for errors:**
   ```bash
   tail -f printer-service.log
   ```

3. **Verify print-queue directory exists:**
   ```bash
   ls -la print-queue/
   ```

4. **Test printer directly:**
   ```bash
   curl http://localhost:8000/api/pos/printer/test
   ```

---

### USB Module Installation Issues

**Problem:** `npm install usb` fails

**Solution (Windows):**
```bash
npm install --global windows-build-tools
npm install usb
```

**Solution (Linux):**
```bash
sudo apt-get install libusb-1.0-0-dev
npm install usb
```

---

## 🔄 Fallback Behavior

If USB direct printing fails, the service automatically:
1. Logs the USB error
2. Attempts Windows Print Spooler method
3. Creates temporary `.prn` file
4. Sends via Windows printer interface
5. Logs result
6. Deletes temporary file

---

## 🚨 Important Notes

1. **USB Module Compatibility:**
   - Works best on Windows and Linux
   - macOS requires additional setup
   - Some USB hubs may not work

2. **File Permissions:**
   - Service needs read/write access to print-queue directory
   - Ensure folder permissions are correct

3. **Multiple Printers:**
   - Service sends to first compatible printer found
   - For multiple printers, run separate service instances on different ports

4. **Network:**
   - USB printing requires local machine connection
   - For network printers, use alternative approach

---

## 📚 ESC/POS Command Reference

The service generates standard ESC/POS commands:

```
\x1B\x40        Reset printer
\x1B\x61\x00    Align left
\x1B\x61\x01    Align center
\x1B\x61\x02    Align right
\x1D\x56\x00    Cut paper (full cut)
\x1D\x56\x01    Cut paper (partial cut)
```

---

## ✅ Verification Checklist

- [ ] USB printer connected and powered on
- [ ] `npm install usb` completed successfully
- [ ] `node printer-service.js` runs without errors
- [ ] `curl http://localhost:8000/api/pos/printer/test` returns success
- [ ] `print-queue` folder exists and is writable
- [ ] Backend server running on port 8000
- [ ] Frontend can call `/api/pos/print/booking` endpoint
- [ ] Print jobs appear in print-queue directory
- [ ] Files are processed and deleted automatically
- [ ] Receipts print to thermal printer

---

## 🎯 Next Steps

1. **Install and run printer service:**
   ```bash
   npm install usb
   node printer-service.js &
   ```

2. **Test the connection:**
   ```bash
   curl http://localhost:8000/api/pos/printer/test
   ```

3. **Test a print job:**
   - Go to POS booking
   - Complete a booking
   - Click "Pay & Complete"
   - Check print-queue folder
   - Verify receipt prints

4. **Monitor logs:**
   ```bash
   tail -f printer-service.log
   ```

---

## 📞 Support

For issues with:
- **Backend API:** Check `backend.log` or console output
- **Printer Service:** Check `printer-service.log`
- **USB Connection:** Check Windows Device Manager
- **Print Queue:** Verify files in `print-queue/` directory
