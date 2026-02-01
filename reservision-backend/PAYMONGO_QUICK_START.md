# 🚀 PayMongo Integration - Quick Start

## ✅ Why PayMongo?

✔️ **Instant test mode** - No business verification needed
✔️ **GCash works immediately** - Test right away
✔️ **PayMaya works immediately** - No waiting
✔️ **Philippine-focused** - Better PH support
✔️ **Lower barrier to entry** - Start testing in minutes

## 📋 Setup Steps (5 minutes)

### Step 1: Create PayMongo Account

1. Go to: https://dashboard.paymongo.com/signup
2. Sign up (FREE)
3. Verify email
4. **No business verification needed for testing!**

### Step 2: Get API Keys

1. Login to dashboard
2. Go to: **Developers** → **API Keys**
3. You'll see TWO keys:
   - **Secret Key** (sk_test_...) ← Copy this
   - **Public Key** (pk_test_...) ← Not needed for now

### Step 3: Update .env File

```env
PAYMONGO_SECRET_KEY=sk_test_paste_your_key_here
```

### Step 4: Restart Backend

```bash
cd C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm start
```

### Step 5: Test Payment!

1. Go to your booking page
2. Add items
3. Fill guest info
4. Click "Pay Now"
5. Choose payment method:
   - **GCash** (test immediately!)
   - **Card** (use test cards below)
   - **PayMaya**
   - **GrabPay**

## 💳 Test Payment Methods

### GCash (Works Immediately!)
- In test mode, you'll see a simulated GCash screen
- Click "Authorize" to complete payment
- **No real money charged!**

### Test Credit Cards

**Success:**
```
Card: 4343434343434345
Expiry: 12/25
CVC: 123
```

**3D Secure (requires authentication):**
```
Card: 4571736000000075
Expiry: 12/25
CVC: 123
```

**Decline:**
```
Card: 4571736000000067
Expiry: 12/25
CVC: 123
```

## 🔄 Payment Flow

```
Customer clicks "Pay Now"
    ↓
Backend: POST /api/paymongo/create-payment-link
    ↓
PayMongo creates checkout page
    ↓
Returns checkout_url
    ↓
Frontend redirects to PayMongo
    ↓
Customer selects: GCash | Card | PayMaya | GrabPay
    ↓
Customer completes payment
    ↓
PayMongo processes payment
    ↓
Webhook notifies backend (optional)
    ↓
Customer returns to your site ✅
```

## 🎯 API Endpoints

### Create Payment Link
```http
POST http://localhost:8000/api/paymongo/create-payment-link
Content-Type: application/json

{
  "amount": 18500,
  "description": "Eduardo's Resort Booking",
  "bookingId": "EDU12345678",
  "email": "customer@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "checkout_url": "https://pm.link/org-name/test/abc123",
  "reference_number": "abc123",
  "payment_id": "link_xyz",
  "amount": 18500,
  "status": "unpaid"
}
```

### Check Payment Status
```http
GET http://localhost:8000/api/paymongo/payment-status/{paymentId}
```

## 🆚 PayMongo vs Xendit

| Feature | PayMongo | Xendit |
|---------|----------|--------|
| **Test GCash** | ✅ Instant | ❌ Needs verification |
| **Test Cards** | ✅ Instant | ✅ Instant |
| **Setup Time** | ⚡ 5 minutes | ⏰ 1-3 days |
| **PH Support** | ✅ Better | ⚠️ Good |
| **Fees** | 3.5% + ₱15 | 2.5% |
| **Payout** | T+3 days | T+1 day |

## 🎉 You're Ready!

**Current setup:**
- ✅ Backend configured
- ✅ Frontend updated
- ✅ Routes added

**Just need:**
1. Get API key from PayMongo
2. Add to `.env`
3. Restart backend
4. Test! 🚀

## 💡 Pro Tips

1. **Use Payment Links** (already configured) - Simpler than Payment Intents
2. **Test all methods** - GCash, Card, PayMaya, GrabPay
3. **Check webhook logs** - Dashboard shows all events
4. **Monitor dashboard** - Real-time payment tracking

## 🔐 Going to Production

When ready for real payments:

1. Complete business verification
2. Get **live** API keys (sk_live_...)
3. Update `.env` with live keys
4. Enable real payment methods
5. Configure payout bank account
6. Set up webhooks

## 📞 Support

- **Documentation:** https://developers.paymongo.com/
- **Dashboard:** https://dashboard.paymongo.com/
- **Support:** support@paymongo.com
- **Community:** https://discord.gg/paymongo

---

**PayMongo is MUCH easier for Philippine testing!** 🇵🇭
