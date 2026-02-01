# 🧪 Chatbot Testing Guide

## Quick Test - Sunod-sunod na gawin:

### 1. Start Backend
```powershell
cd c:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm start
```

Expected output:
```
Server running at http://localhost:8000
```

---

### 2. Test Chatbot API Directly (Using PowerShell)

```powershell
# Test 1: Available Rooms
$body = @{
    message = "May available rooms ba?"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/resort/chat" -Method POST -Body $body -ContentType "application/json"
```

```powershell
# Test 2: Promos
$body = @{
    message = "Meron bang promo?"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/resort/chat" -Method POST -Body $body -ContentType "application/json"
```

```powershell
# Test 3: Menu
$body = @{
    message = "Ano ang menu?"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/resort/chat" -Method POST -Body $body -ContentType "application/json"
```

```powershell
# Test 4: Get Stats
Invoke-RestMethod -Uri "http://localhost:8000/api/resort/stats" -Method GET
```

---

### 3. Start Frontend
```powershell
# Open new terminal
cd c:\Users\NPMI01\CAPSTONE_FRONTEND\reservision
npm run dev
```

---

### 4. Test in Browser

1. Open browser: `http://localhost:5173` (or whatever port Vite shows)
2. Click the **blue robot button** sa bottom-right
3. Try these sample questions:

#### English Questions:
- "Hi"
- "What rooms do you have?"
- "Any promos?"
- "Show me your menu"
- "Swimming lessons available?"
- "How to book?"
- "What are your rates?"

#### Tagalog Questions:
- "Kumusta"
- "May bakante bang kwarto?"
- "Meron bang discount?"
- "Magkano ang entrance?"
- "Ano ang pagkain?"
- "Paano mag-book?"
- "Nasaan kayo?"

---

## Expected Responses

### ✅ Correct Behavior:
- Bot responds within 1-2 seconds
- Shows typing indicator ("typing...")
- Displays real data from database
- Uses proper formatting with emojis
- Provides helpful, contextual answers

### ❌ If Bot Says "Sorry, offline ako ngayon":
**Possible Issues:**
1. Backend not running
2. Port 8000 already in use
3. Database connection error
4. Network/firewall blocking

**Solutions:**
```powershell
# Check if backend is running
Get-Process node

# Check what's using port 8000
netstat -ano | findstr :8000

# Check MySQL service
Get-Service MySQL*
```

---

## Sample Conversation Flow

```
User: Hi
Bot: Hi! Welcome to Eduardo's Resort! 🏖️ Kumusta? How can I help you today?...

User: May available rooms ba?
Bot: We have 3 available rooms right now! 🏨
     [Lists actual rooms from database with details]

User: Magkano?
Bot: [Shows prices for available rooms]

User: May promo ba?
Bot: 🎉 We have 3 active promos for you!
     [Lists actual promos with codes and discounts]

User: Ano ang menu?
Bot: 🍽️ Restaurant Menu:
     [Shows actual menu items by category]

User: How to book?
Bot: 📅 How to Book:
     [Step-by-step booking instructions]
```

---

## Testing Different Scenarios

### Scenario 1: No Available Rooms
```sql
-- Temporarily make all rooms occupied
UPDATE inventory_items SET status = 'Occupied' WHERE category = 'Room';
```
**Test:** "May available rooms ba?"  
**Expected:** "Sorry, walang available rooms ngayon. Would you like to check our cottages instead?"

```sql
-- Restore
UPDATE inventory_items SET status = 'Available' WHERE category = 'Room';
```

---

### Scenario 2: No Active Promos
```sql
-- Make all promos expired
UPDATE promos SET endDate = '2020-01-01';
```
**Test:** "May promo ba?"  
**Expected:** "Sorry, walang active promos ngayon. But we still offer great value!..."

```sql
-- Restore
UPDATE promos SET endDate = '2024-12-31';
```

---

### Scenario 3: Empty Menu
```sql
-- Make all menu items unavailable
UPDATE menu_items SET available = FALSE;
```
**Test:** "Ano ang menu?"  
**Expected:** "Our restaurant menu is being updated..."

```sql
-- Restore
UPDATE menu_items SET available = TRUE;
```

---

## Browser Console Testing

Open DevTools (F12) and run:

```javascript
// Test chatbot API
fetch('http://localhost:8000/api/resort/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hi there!' })
})
.then(r => r.json())
.then(data => console.log(data))

// Test stats API
fetch('http://localhost:8000/api/resort/stats')
.then(r => r.json())
.then(data => console.log(data))
```

---

## Performance Testing

```powershell
# Measure response time
Measure-Command {
  $body = @{ message = "May rooms ba?" } | ConvertTo-Json
  Invoke-RestMethod -Uri "http://localhost:8000/api/resort/chat" -Method POST -Body $body -ContentType "application/json"
}
```

**Expected:** Less than 1 second for simple queries

---

## Common Questions for Testing

### Rooms & Cottages
- "Show available rooms"
- "Meron bang cottage?"
- "What's the cheapest room?"
- "Do you have family cottages?"

### Pricing
- "How much is entrance?"
- "Magkano ang cottage rental?"
- "Package rates please"
- "What are your rates?"

### Promos
- "Current discounts?"
- "Any special offers?"
- "Promo codes?"

### Food
- "What do you serve?"
- "Menu please"
- "May desserts ba?"

### Swimming
- "Swimming lessons?"
- "Who are the coaches?"
- "Paano mag-enroll?"

### General
- "How to book?"
- "Where are you located?"
- "Contact number?"
- "What facilities do you have?"

---

## Debugging Tips

### Backend Console
Watch for:
```
POST /api/resort/chat 200 OK
GET /api/resort/stats 200 OK
```

### Frontend Console (F12)
Check for:
```javascript
// Successful request
POST http://localhost:8000/api/resort/chat 200 OK

// Failed request
POST http://localhost:8000/api/resort/chat net::ERR_CONNECTION_REFUSED
```

### Database Logs
```sql
-- Check recent queries
SHOW PROCESSLIST;

-- View slow queries (if any)
SHOW FULL PROCESSLIST;
```

---

## Success Criteria

✅ Backend starts without errors  
✅ Chatbot button appears on website  
✅ Bot responds to greetings  
✅ Shows real room data  
✅ Displays active promos  
✅ Lists restaurant menu  
✅ Shows swimming coaches  
✅ Handles unknown questions gracefully  
✅ Error messages are user-friendly  
✅ Response time < 2 seconds  
✅ Works on mobile devices  

---

## Next Steps After Testing

1. **Update contact information** in chatbot responses
2. **Add more keywords** for better intent recognition  
3. **Customize welcome messages**
4. **Add more FAQ responses**
5. **Test with real users**
6. **Monitor chat logs** for improvements

---

## 🎉 You're Done!

Kung lahat ng tests ay **PASSED**, your AI chatbot is ready to help customers! 🚀

**Enjoy your smart, data-driven chatbot!** 🤖✨
