# 🔗 PayMongo Webhook Setup with ngrok

## 📋 Step-by-Step Guide

### Step 1: Install ngrok

**Option A: Download Manually**
1. Go to: https://ngrok.com/download
2. Download Windows version
3. Extract to `C:\ngrok`
4. Add to PATH or run from folder

**Option B: Install via Package Manager**
```powershell
# Using Chocolatey
choco install ngrok

# OR using winget
winget install ngrok.ngrok
```

### Step 2: Create ngrok Account (Free)

1. Go to: https://dashboard.ngrok.com/signup
2. Sign up for FREE account
3. Go to: https://dashboard.ngrok.com/get-started/your-authtoken
4. Copy your authtoken

### Step 3: Configure ngrok

```powershell
# Add your authtoken
ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
```

### Step 4: Start ngrok Tunnel

```powershell
# Open NEW terminal window
ngrok http 8000
```

**You'll see:**
```
Forwarding: https://abc123.ngrok-free.app -> http://localhost:8000
```

**Copy this URL:** `https://abc123.ngrok-free.app`

### Step 5: Configure PayMongo Webhook

1. Go to: https://dashboard.paymongo.com/developers/webhooks
2. Click **"Create webhook"**
3. **Endpoint URL:** `https://abc123.ngrok-free.app/api/paymongo/webhook`
4. **Select Events:**
   - ✅ `link.payment.paid`
   - ✅ `payment.paid`
   - ✅ `payment.failed`
5. Click **"Create"**

### Step 6: Test Payment Flow

1. **Make sure 3 terminals are running:**
   - Terminal 1: Backend (`npm start`)
   - Terminal 2: Frontend (`npm run dev`)
   - Terminal 3: ngrok (`ngrok http 8000`)

2. **Create booking** on your site
3. **Click "Pay Now"**
4. **Complete payment** (GCash/Card)
5. **Watch the magic:**
   - PayMongo sends webhook to ngrok
   - ngrok forwards to your localhost
   - Your backend receives notification
   - Database updated automatically

## 🔍 Verify Webhook is Working

### Check ngrok Dashboard
1. Go to: http://localhost:4040
2. See all webhook requests in real-time
3. Debug any issues

### Check Backend Logs
```
📨 PayMongo Webhook Received: {
  type: 'link.payment.paid',
  status: 'paid'
}
💰 Payment successful: {
  amount: 18500,
  reference: 'r5L92J2'
}
```

### Check PayMongo Dashboard
1. Go to: https://dashboard.paymongo.com/developers/webhooks
2. Click on your webhook
3. See **"Recent deliveries"** tab
4. Check if webhooks are being sent successfully

## 🚨 Troubleshooting

### Webhook not received?

**Check 1: ngrok is running**
```powershell
# Should show active tunnel
ngrok http 8000
```

**Check 2: Correct URL in PayMongo**
- Should be: `https://YOUR-NGROK-URL.ngrok-free.app/api/paymongo/webhook`
- NOT: `http://localhost:8000/api/paymongo/webhook`

**Check 3: Backend is running**
```powershell
# Should show:
Server running at http://localhost:8000
```

**Check 4: Route is correct**
Test manually:
```powershell
curl -X POST http://localhost:8000/api/paymongo/webhook -H "Content-Type: application/json" -d "{\"test\":\"data\"}"
```

### ngrok URL changes?

Every time you restart ngrok, the URL changes (on free plan).

**Solutions:**
1. **Free:** Update webhook URL in PayMongo each time
2. **Paid ($8/mo):** Get static domain (e.g., `myapp.ngrok.io`)

## 📊 Complete Setup Checklist

- [ ] ngrok installed
- [ ] ngrok account created
- [ ] Authtoken configured
- [ ] ngrok tunnel running
- [ ] Backend server running
- [ ] Frontend server running
- [ ] Webhook created in PayMongo
- [ ] Webhook URL points to ngrok
- [ ] Events selected (link.payment.paid)
- [ ] Test payment completed
- [ ] Webhook received in backend logs

## 🎯 Expected Flow

```
Customer pays on PayMongo
    ↓
PayMongo sends webhook
    ↓
Webhook → ngrok (https://abc123.ngrok-free.app/api/paymongo/webhook)
    ↓
ngrok → localhost:8000 (/api/paymongo/webhook)
    ↓
Backend receives event
    ↓
Update booking status in database
    ↓
Send email confirmation (optional)
    ↓
Customer sees success message
```

## 🔐 Security Note

**For Production:**
- Don't use ngrok
- Use your real domain: `https://yourdomain.com/api/paymongo/webhook`
- Enable webhook signature verification
- Use HTTPS only

**For Development/Testing:**
- ngrok is perfect!
- Safe and secure
- Easy to debug

## 💡 Pro Tips

1. **Keep ngrok terminal open** - Don't close it while testing
2. **Check ngrok dashboard** - `http://localhost:4040` shows all requests
3. **Test multiple times** - Make sure webhook consistently works
4. **Save ngrok URL** - Update PayMongo webhook if you restart
5. **Monitor backend logs** - See webhook events in real-time

## 🎉 Success Indicators

When everything works:
- ✅ ngrok shows webhook requests
- ✅ Backend logs show payment events
- ✅ PayMongo dashboard shows successful deliveries
- ✅ Your confirmation page loads automatically
- ✅ Database updated with payment status

---

**Ready to test? Start all 3 servers and try a payment!** 🚀
