# 💳 Payment System Documentation Index

## 📚 Complete Documentation Set

Your CAPSTONE_BACKEND now has comprehensive payment documentation:

### 1. **[PAYMENT_ARCHITECTURE_SUMMARY.md](PAYMENT_ARCHITECTURE_SUMMARY.md)** 📋
**Overview of entire payment system**
- ✅ All payment-related files (controllers, routes, configs)
- ✅ Current PayMongo & Xendit configuration
- ✅ Database schema for payments
- ✅ API endpoints reference
- ✅ Supported payment methods
- ✅ Security implementation

**When to use:** 
- Getting high-level understanding of payment system
- Understanding database structure
- Finding which file does what

---

### 2. **[PAYMENT_CODE_REFERENCE.md](PAYMENT_CODE_REFERENCE.md)** 💻
**Actual code implementations with examples**
- ✅ Xendit integration code (create, status, webhook)
- ✅ PayMongo integration code (create, status, webhook)
- ✅ Booking payment flow code
- ✅ Database operations (queries)
- ✅ Environment configuration examples
- ✅ Common issues & solutions

**When to use:**
- Implementing new payment features
- Debugging payment issues
- Understanding how to call payment APIs
- Setting up test payments

---

### 3. **[PAYMENT_FLOW_DIAGRAMS.md](PAYMENT_FLOW_DIAGRAMS.md)** 🎯
**Visual flows and implementation checklists**
- ✅ Complete customer payment journey (11 steps)
- ✅ E-Shop POS payment flow
- ✅ Payment status monitoring flow
- ✅ Setup checklist (what's done, what's TODO)
- ✅ Testing scenarios
- ✅ Pre-launch checklist

**When to use:**
- Understanding the complete flow
- Checking implementation status
- Planning next steps
- Testing payment scenarios

---

## 🚀 Quick Start

### For Developers
1. **First time?** Read [PAYMENT_ARCHITECTURE_SUMMARY.md](PAYMENT_ARCHITECTURE_SUMMARY.md)
2. **Implementing feature?** Check [PAYMENT_CODE_REFERENCE.md](PAYMENT_CODE_REFERENCE.md)
3. **Debugging?** Search code reference, then check [PAYMENT_FLOW_DIAGRAMS.md](PAYMENT_FLOW_DIAGRAMS.md) testing section
4. **Need API info?** See Architecture Summary → API Endpoints section

### For Admins/Project Managers
1. Start with [PAYMENT_FLOW_DIAGRAMS.md](PAYMENT_FLOW_DIAGRAMS.md) "Quick Status Check"
2. Review setup checklist to see what's complete
3. Check testing scenarios before launch
4. Use pre-launch checklist before going live

### For QA/Testers
1. Read [PAYMENT_FLOW_DIAGRAMS.md](PAYMENT_FLOW_DIAGRAMS.md) "Testing Scenarios"
2. Use test credentials from [PAYMENT_ARCHITECTURE_SUMMARY.md](PAYMENT_ARCHITECTURE_SUMMARY.md)
3. Reference [PAYMENT_CODE_REFERENCE.md](PAYMENT_CODE_REFERENCE.md) for API endpoints

---

## 📂 Key Files in Codebase

### Controllers
```
controllers/
├── paymongoController.js      ← PayMongo gateway logic
├── xenditController.js        ← Xendit gateway logic
├── bookingConfirmationController.js ← Booking + payment creation
└── posController.js           ← E-Shop POS transactions
```

### Routes
```
routes/
├── paymongo.js               ← /api/paymongo/* endpoints
├── xendit.js                 ← /api/xendit/* endpoints
└── bookings.js               ← /api/bookings/* endpoints
```

### Configuration
```
.env                          ← API keys (SECRET - don't commit!)
package.json                  ← Dependencies (node-fetch)
database-setup.sql            ← Payment table schema
```

### Documentation (NEW!)
```
PAYMENT_ARCHITECTURE_SUMMARY.md    ← System overview
PAYMENT_CODE_REFERENCE.md          ← Code implementations
PAYMENT_FLOW_DIAGRAMS.md           ← Flows & checklists
```

---

## 🎯 Current Status

### ✅ Completed
- Xendit integration (full with webhooks)
- PayMongo integration (full with webhooks)
- Database schema
- Booking payment flow
- Email confirmation system
- QR code generation
- E-Shop POS integration
- All API endpoints

### 🔴 Critical Issues
- **⚠️ PayMongo using LIVE secret key** 
  - Currently: 
  - Should use: Test key (`sk_test_...`) during development

### ⏳ In Progress
- Frontend Vue component integration
- Success/failure page handling

### 📋 TODO
- Configure webhook URLs in payment dashboards
- End-to-end testing
- Production readiness review
- Refund system implementation
- Payment retry logic
- Payment analytics

---

## 💡 Common Questions

### Q: Which payment gateway is primary?
**A:** Xendit is primary (fully implemented with webhooks). PayMongo is secondary/alternative.

### Q: How do customers pay?
**A:** 
1. Fill booking form
2. Select payment method (GCash, PayMaya, Bank Transfer)
3. Click "Pay Now"
4. Redirected to Xendit/PayMongo checkout
5. Complete payment
6. Confirmation email sent

### Q: How does the backend know payment is done?
**A:** Two ways:
1. **Webhook** - Payment gateway sends callback when payment received
2. **Status check** - Poll API to check if payment is complete

### Q: What happens if customer doesn't pay?
**A:** 
- Booking stays in "Pending" status
- Payment record shows "pending"
- After 24 hours, payment link expires
- Customer needs to create new booking to pay

### Q: What payment methods are supported?
**A:** 
- GCash (instant)
- PayMaya (instant)
- Bank Transfer (1-3 days)
- Card via PayMongo (instant)

### Q: How are payments secured?
**A:**
- API keys stored in .env (not in code)
- Customer card details never touch server
- All payments use PCI-compliant gateways
- Webhook tokens verify authenticity

### Q: Is production-ready?
**A:** Almost. Need to:
1. Switch PayMongo to test key for dev
2. Configure webhook URLs in dashboards
3. Complete frontend integration
4. Run end-to-end testing

---

## 🔧 Setup Instructions

### Quick Setup (5 minutes)

#### 1. Install Dependencies
```bash
cd C:\Users\John Rhey Tamares\CAPSTONE_BACKEND\reservision-backend
npm install node-fetch@2
```

#### 2. Configure .env
```env
# Already configured with API keys:
XENDIT_SECRET_KEY=xnd_development_...
PAYMONGO_SECRET_KEY=sk_live_... (⚠️ Should be test key)
FRONTEND_URL=http://localhost:5173
```

#### 3. Start Backend
```bash
npm start
# Should see: "Server running at http://localhost:8000"
```

#### 4. Test Xendit (via HTML)
Open: `test-xendit-payment.html` in browser
- Fill in test details
- Click "Create Payment"
- You'll get a checkout link

#### 5. Configure Webhooks (For production)
1. Go to Xendit Dashboard → Settings → Webhooks
2. Add: `https://yourdomain.com/api/xendit/webhook`
3. Same for PayMongo

---

## 📞 Support & Troubleshooting

### Common Errors

**"Payment service not configured"**
- ✓ Check .env has API keys
- ✓ Restart server after updating .env
- ✓ Verify key isn't empty

**"Payment link not redirecting"**
- ✓ Check FRONTEND_URL in .env matches your frontend URL
- ✓ Verify frontend is actually running on that URL
- ✓ Check browser console for JavaScript errors

**"Webhook not received"**
- ✓ Use ngrok to test locally: `ngrok http 8000`
- ✓ Configure webhook URL with ngrok URL
- ✓ Check webhook token matches in dashboard

**"Cannot connect to server"**
- ✓ Backend must be running: `npm start`
- ✓ Check server.js has routes mounted
- ✓ Verify port 8000 is not blocked

---

## 📊 Database Schema Quick Reference

### payments table
```sql
CREATE TABLE payments (
  payment_id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT,
  payment_reference VARCHAR(50) UNIQUE,
  payment_method VARCHAR(50),      -- 'gcash', 'paymaya', 'card'
  amount DECIMAL(10,2),
  status ENUM('pending','paid','failed') DEFAULT 'pending',
  payment_intent_id VARCHAR(255),  -- Xendit/PayMongo ID
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### bookings table (payment fields)
```sql
ALTER TABLE bookings ADD COLUMN (
  payment_status ENUM('Pending','Paid','Partially Paid') DEFAULT 'Pending',
  payment_method VARCHAR(50)
);
```

### Query Examples
```sql
-- Get payment for booking
SELECT * FROM payments WHERE booking_id = 123;

-- Check if booking is paid
SELECT * FROM bookings WHERE booking_id = 123 AND payment_status = 'Paid';

-- Get all payments today
SELECT * FROM payments WHERE DATE(created_at) = CURDATE();

-- Find unpaid bookings (older than 1 day)
SELECT * FROM bookings 
WHERE payment_status = 'Pending' 
AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY);
```

---

## 🎓 Learning Path

### For New Team Members
1. **Day 1:** Read PAYMENT_ARCHITECTURE_SUMMARY.md
2. **Day 2:** Read PAYMENT_CODE_REFERENCE.md
3. **Day 3:** Review actual code files
4. **Day 4:** Read PAYMENT_FLOW_DIAGRAMS.md
5. **Day 5:** Run test payment (test-xendit-payment.html)

### For Experienced Developers
1. Skim architecture summary
2. Jump to code reference for specific feature
3. Check flow diagrams if confused
4. Reference actual controller code

---

## 🚨 Critical Reminders

⚠️ **SECURITY**
- Never commit .env to Git
- Keep API keys confidential
- Use HTTPS in production
- Verify webhook tokens

⚠️ **TESTING**
- Always test with test API keys first
- Never use production keys in dev
- Test all payment methods
- Test edge cases (timeouts, failures)

⚠️ **PRODUCTION**
- Switch to LIVE keys ONLY after testing
- Configure webhook URLs properly
- Have monitoring/alerts in place
- Have backup payment method ready
- Document incident procedures

---

## 📈 Metrics to Monitor

Once live, track these metrics:

```
Daily:
- Total payments received
- Failed payment rate
- Average payment time
- Payment method breakdown

Weekly:
- Payment refunds
- Chargeback rate
- Customer complaints
- System uptime

Monthly:
- Revenue by payment method
- Payment processing costs
- Customer satisfaction
- Fraud attempts
```

---

## 🔗 External Resources

### Xendit Documentation
- Dashboard: https://dashboard.xendit.co/
- Docs: https://developers.xendit.co/
- Support: support@xendit.co

### PayMongo Documentation
- Dashboard: https://dashboard.paymongo.com/
- Docs: https://developers.paymongo.com/
- Support: hello@paymongo.com

### Philippine Payment Methods
- GCash: https://www.gcash.com/
- PayMaya: https://www.payma.ph/
- BDO Online: https://www.bdo.com.ph/
- BPI Online: https://www.bpi.com.ph/

---

## 📝 Document Maintenance

These documents should be updated when:
- [ ] New payment method added
- [ ] API changes from Xendit/PayMongo
- [ ] New features implemented
- [ ] Bugs fixed
- [ ] Security issues addressed

**Last Updated:** April 25, 2026
**Version:** 1.0
**Status:** Ready for Implementation

---

## ✅ Next Steps

### Immediate (This Week)
1. [ ] Fix PayMongo: Switch to test key
2. [ ] Configure webhook URLs in dashboards
3. [ ] Complete frontend Vue component integration

### Short Term (This Month)
4. [ ] Run end-to-end payment testing
5. [ ] Test all edge cases and error scenarios
6. [ ] Performance testing under load
7. [ ] Security audit

### Medium Term (Next Month)
8. [ ] Go live to production
9. [ ] Monitor payment system
10. [ ] Implement analytics dashboard
11. [ ] Plan for refunds system

### Long Term (Future)
12. [ ] Add payment plans/installments
13. [ ] Implement fraud detection
14. [ ] Add advanced analytics
15. [ ] Consider additional payment methods

---

**For questions or issues, refer to the appropriate documentation:**
- Architecture overview → **PAYMENT_ARCHITECTURE_SUMMARY.md**
- Code implementation → **PAYMENT_CODE_REFERENCE.md**  
- Flow & testing → **PAYMENT_FLOW_DIAGRAMS.md**

Happy coding! 🚀
