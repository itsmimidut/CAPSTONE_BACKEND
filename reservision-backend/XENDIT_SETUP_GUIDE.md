# Xendit Payment Integration Guide

## 🚀 Quick Setup

### 1. Get Xendit API Keys

1. Go to [Xendit Dashboard](https://dashboard.xendit.co/)
2. Sign up or log in
3. Navigate to **Settings** → **Developers** → **API Keys**
4. Copy your **Secret Key** (starts with `xnd_development_` for test mode)

### 2. Install Dependencies

```bash
cd C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm install node-fetch@2
```

### 3. Update Environment Variables

Add to your `.env` file:

```env
# Xendit Configuration
XENDIT_SECRET_KEY=xnd_development_YOUR_SECRET_KEY_HERE
XENDIT_WEBHOOK_TOKEN=your_webhook_verification_token_here
FRONTEND_URL=http://localhost:5173
```

### 4. Update server.js

Add Xendit routes to your Express app:

```javascript
import xenditRoutes from './routes/xendit.js';

// Add this line with other routes
app.use('/api/xendit', xenditRoutes);
```

### 5. Test Payment Flow

1. Start backend server:
   ```bash
   npm start
   ```

2. Test GCash payment creation:
   ```bash
   curl -X POST http://localhost:8000/api/xendit/create-payment \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 1000,
       "email": "customer@example.com",
       "bookingId": "BK12345678",
       "customerName": "Juan Dela Cruz",
       "paymentMethod": "gcash",
       "description": "Resort Booking Payment"
     }'
   ```

## 📱 Payment Methods

### GCash
- Channel: `PH_GCASH`
- Min: ₱1
- Max: ₱50,000
- Processing: Instant

### PayMaya
- Channel: `PH_PAYMAYA`
- Min: ₱1
- Max: ₱50,000
- Processing: Instant

### GrabPay
- Channel: `PH_GRABPAY`
- Min: ₱1
- Max: ₱50,000
- Processing: Instant

## 🔄 Payment Flow

1. **Customer fills booking form** → BookingConfirmation.vue
2. **Click "Pay Now"** → Calls `/api/xendit/create-payment`
3. **Backend creates Xendit invoice** → Returns payment URL
4. **Frontend redirects to Xendit** → Customer pays via GCash/PayMaya
5. **Xendit redirects back** → Success or failure page
6. **Webhook updates database** → Payment status confirmed

## 🔐 Security Best Practices

1. **Never expose secret key in frontend**
2. **Always validate webhook signatures**
3. **Use HTTPS in production**
4. **Store API keys in environment variables**
5. **Implement webhook verification token**

## 🧪 Testing

### Test Mode Cards (for development)
- **Success:** Use any valid card number
- **Failure:** Use `4000000000000002`

### Test GCash
- Xendit provides a test GCash flow in development mode
- No real money is charged

## 📊 Webhook Setup

1. Go to Xendit Dashboard → Settings → Webhooks
2. Add webhook URL: `https://your-domain.com/api/xendit/webhook`
3. Select events: `invoice.paid`, `invoice.expired`
4. Save webhook verification token to `.env`

## 🚨 Common Issues

### "Invalid API Key"
- Check if XENDIT_SECRET_KEY is set correctly
- Ensure no extra spaces in .env file
- Use test key for development: `xnd_development_...`

### "Amount too low"
- Minimum amount is ₱1 (100 centavos)
- Check currency is set to 'PHP'

### "Webhook not received"
- Ensure webhook URL is publicly accessible
- Use ngrok for local testing: `ngrok http 8000`
- Check webhook logs in Xendit dashboard

## 📞 Support

- Documentation: https://developers.xendit.co/
- Support: support@xendit.co
- API Status: https://status.xendit.co/

## 🎯 Production Checklist

- [ ] Replace development key with production key
- [ ] Update FRONTEND_URL to production domain
- [ ] Enable webhook signature verification
- [ ] Set up error monitoring
- [ ] Test all payment methods
- [ ] Configure success/failure redirect URLs
- [ ] Enable payment notifications
