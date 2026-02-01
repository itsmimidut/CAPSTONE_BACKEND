# 🚀 Xendit Payment Integration - Quick Start

## ✅ What's Already Done

✔️ Backend controller created (`controllers/xenditController.js`)
✔️ Routes configured (`routes/xendit.js`)
✔️ Server.js updated with Xendit routes
✔️ Frontend BookingConfirmation.vue integrated
✔️ node-fetch package installed

## 📋 Next Steps (5 minutes)

### Step 1: Get Xendit API Key

1. Go to: https://dashboard.xendit.co/register
2. Sign up for FREE account
3. After login, go to: **Settings** → **Developers** → **API Keys**
4. Copy your **Secret Key** (starts with `xnd_development_`)

### Step 2: Update .env File

Open: `C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend\.env`

Replace this line:
```env
XENDIT_SECRET_KEY=xnd_development_YOUR_SECRET_KEY_HERE
```

With your actual key:
```env
XENDIT_SECRET_KEY=xnd_development_abc123...your_actual_key
```

### Step 3: Start Backend Server

```bash
cd C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm start
```

You should see:
```
Server running at http://localhost:8000
```

### Step 4: Test Payment Flow

1. Open frontend: http://localhost:5173
2. Go to Reservation page
3. Add items to booking
4. Click "Proceed to Checkout"
5. Fill in guest information
6. Select **GCash** as payment method
7. Click **"Pay Now"**
8. You'll be redirected to Xendit payment page
9. Use test GCash credentials (provided by Xendit)
10. Complete payment
11. Redirected back to confirmation page ✅

## 🎯 Payment Methods Available

| Method | Code | Min | Max | Fee |
|--------|------|-----|-----|-----|
| **GCash** | gcash | ₱1 | ₱50,000 | 2.5% |
| **PayMaya** | paymaya | ₱1 | ₱50,000 | 2.5% |
| **Bank Transfer** | bank | ₱1 | No limit | Free |

## 🧪 Test Mode (Development)

In test mode:
- No real money is charged
- Use test credentials provided by Xendit
- All payments are simulated
- Perfect for development

## 📱 GCash Payment Flow

```
Customer clicks "Pay Now"
    ↓
Frontend calls: POST /api/xendit/create-payment
    ↓
Backend creates Xendit invoice
    ↓
Returns payment URL
    ↓
Frontend redirects to Xendit
    ↓
Customer scans QR code with GCash app
    ↓
Customer confirms payment in GCash
    ↓
Xendit processes payment
    ↓
Redirects back to success page
    ↓
Webhook notifies backend (payment confirmed)
```

## 🔍 API Endpoints

### Create Payment
```http
POST http://localhost:8000/api/xendit/create-payment
Content-Type: application/json

{
  "amount": 18500,
  "email": "customer@example.com",
  "bookingId": "EDU12345678",
  "customerName": "Juan Dela Cruz",
  "paymentMethod": "gcash",
  "description": "Resort Booking Payment"
}
```

**Response:**
```json
{
  "success": true,
  "invoice_url": "https://checkout.xendit.co/web/...",
  "invoice_id": "abc123...",
  "status": "PENDING",
  "amount": 18500
}
```

### Check Payment Status
```http
GET http://localhost:8000/api/xendit/payment-status/{invoiceId}
```

**Response:**
```json
{
  "success": true,
  "status": "PAID",
  "paid_at": "2026-02-01T10:30:00Z",
  "amount": 18500
}
```

## 🔐 Security Notes

1. ✅ API key is stored in .env (NOT in code)
2. ✅ .env is in .gitignore (NOT committed to GitHub)
3. ✅ All payments processed through Xendit (PCI compliant)
4. ✅ Customer card details NEVER touch your server
5. ✅ Webhook verification token protects against fraud

## 🚨 Common Issues

### "Invalid API Key"
**Solution:** Make sure you copied the FULL key from Xendit dashboard, including `xnd_development_` prefix

### "Cannot connect to payment server"
**Solution:** Check if backend is running on port 8000

### "CORS Error"
**Solution:** Already configured! But if issues, check `server.js` has `app.use(cors())`

### Payment redirects but no webhook received
**Solution:** For local testing, use ngrok:
```bash
ngrok http 8000
# Copy the ngrok URL to Xendit webhook settings
```

## 📊 Production Checklist

Before going live:

- [ ] Get production API key from Xendit
- [ ] Update XENDIT_SECRET_KEY in production .env
- [ ] Update FRONTEND_URL to your production domain
- [ ] Set up webhook URL in Xendit dashboard
- [ ] Enable webhook verification
- [ ] Test all payment methods
- [ ] Set up payment monitoring
- [ ] Configure email notifications

## 💡 Tips

1. **Test thoroughly** - Try different amounts, payment methods
2. **Check webhook logs** - Xendit dashboard shows all webhook calls
3. **Monitor transactions** - Dashboard has real-time payment tracking
4. **Enable notifications** - Get email alerts for payments
5. **Use test mode** - Until you're ready for production

## 📞 Need Help?

- **Xendit Docs:** https://developers.xendit.co/
- **Support Email:** support@xendit.co
- **API Status:** https://status.xendit.co/
- **Community:** https://discord.gg/xendit

## 🎉 You're Ready!

Just add your API key to `.env` and start testing! 🚀
