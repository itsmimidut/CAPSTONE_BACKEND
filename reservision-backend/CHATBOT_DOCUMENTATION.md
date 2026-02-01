# 🤖 AI Chatbot - Real Data Integration

## Overview
Ang chatbot ay gumagamit na ng **real data from database** instead of hardcoded responses. It's like a real AI assistant that can answer questions about your resort!

---

## ✅ What Was Created

### Backend Files

#### 1. **Controller** - `controllers/chatbotController.js`
- **Natural Language Processing (NLP)** - Analyzes user intent from messages
- **Database Integration** - Fetches real-time data from MySQL
- **Smart Responses** - Generates contextual replies based on actual data

**Capabilities:**
- ✅ Understands both English and Tagalog
- ✅ Recognizes multiple question formats
- ✅ Provides real-time availability information
- ✅ Shows actual prices and promos
- ✅ Lists menu items from restaurant
- ✅ Displays swimming coaches
- ✅ Handles greetings and help requests

#### 2. **Routes** - `routes/chatbot.js`
- `POST /api/resort/chat` - Main chatbot endpoint
- `GET /api/resort/stats` - Chatbot statistics (optional)

#### 3. **Server Integration** - `server.js`
- Added chatbot routes to Express server
- Mounted at `/api/resort`

---

## 🎯 Supported Intents (What the Bot Understands)

### 1. **Room Queries**
**Keywords:** room, kwarto, tulog, overnight, stay, available, bakante

**Example Questions:**
- "Meron ba kayong available rooms?"
- "Magkano ang rooms?"
- "May bakante bang kwarto?"
- "What rooms do you have?"

**Response:** Shows actual available rooms from database with:
- Room name and type
- Room number
- Max guests
- Price
- Description

---

### 2. **Cottage Queries**
**Keywords:** cottage, kubo, bahay, villa

**Example Questions:**
- "May available cottages ba?"
- "Magkano ang cottage?"
- "Meron bang beach front villa?"

**Response:** Lists available cottages with full details

---

### 3. **Promo Queries**
**Keywords:** promo, discount, sale, offer, bawas, tipid

**Example Questions:**
- "May promo ba kayo?"
- "Meron bang discount?"
- "What are your current offers?"

**Response:** Shows active promos from database:
- Promo code
- Discount percentage or fixed amount
- Description
- Validity dates

---

### 4. **Rate/Price Queries**
**Keywords:** rate, rates, presyo, price, magkano, entrance

**Example Questions:**
- "Magkano ang entrance?"
- "What are your rates?"
- "How much for cottages?"
- "Package rates?"

**Response Types:**
- **Entrance Rates** - Gate admission prices
- **Cottage Rates** - Cottage rental prices
- **Package Rates** - Day tour, overnight packages
- **General Rates** - All rates combined

---

### 5. **Restaurant/Menu Queries**
**Keywords:** food, kain, menu, restaurant, ulam, pagkain

**Example Questions:**
- "Ano ang menu niyo?"
- "What food do you serve?"
- "May restaurant ba?"

**Response:** Complete restaurant menu by category:
- Appetizers
- Mains
- Desserts
- With prices for each item

---

### 6. **Swimming Lessons**
**Keywords:** swimming, langoy, lesson, coach, trainer

**Example Questions:**
- "May swimming lessons ba?"
- "Who are your coaches?"
- "How to enroll?"

**Response:** Active swimming coaches with:
- Name
- Specialization
- Years of experience
- Availability
- Enrollment information

---

### 7. **Contact/Location**
**Keywords:** contact, location, address, saan, nasaan

**Example Questions:**
- "Saan kayo located?"
- "How to contact you?"
- "What's your address?"

**Response:** Contact information and location details

---

### 8. **Booking Information**
**Keywords:** book, reserve, reservation, pa-book

**Example Questions:**
- "Paano mag-book?"
- "How to make a reservation?"
- "Can I book now?"

**Response:** Step-by-step booking instructions

---

### 9. **Amenities**
**Keywords:** amenity, amenities, facilities, pool, gym

**Example Questions:**
- "What are your facilities?"
- "May pool ba?"
- "Ano ang amenities?"

**Response:** List of all resort amenities

---

### 10. **Greetings & Help**
**Keywords:** hi, hello, hey, kumusta, help, tulong

**Response:** Welcome message and what the bot can help with

---

## 📊 Database Tables Used

The chatbot fetches real-time data from these tables:

```sql
inventory_items      -- Rooms and cottages
promos              -- Active promotions
rate_entries        -- Entrance, cottage, package rates
rate_cards          -- Function hall and special rates
menu_items          -- Restaurant menu
swimming_coaches    -- Swimming instructors
```

---

## 🚀 How to Use

### Backend Setup

1. **Make sure database is running**
   ```bash
   # Check if MySQL is running
   Get-Service MySQL*
   ```

2. **Start the backend server**
   ```bash
   cd CAPSTONE_BACKEND/reservision-backend
   npm start
   ```

   Server should run at: `http://localhost:8000`

### Frontend Setup

1. **Start the frontend**
   ```bash
   cd CAPSTONE_FRONTEND/reservision
   npm run dev
   ```

2. **Click the chatbot button** (blue robot icon at bottom-right)

3. **Start chatting!**

---

## 💬 Example Conversations

### Example 1: Room Inquiry
```
User: "May available rooms ba?"

Bot: "We have 3 available rooms right now! 🏨

📍 Deluxe Ocean View
   Type: Deluxe
   Room #: R101
   Max Guests: 2 persons
   Price: ₱3,500/night
   Luxurious room with stunning ocean views

📍 Garden Suite
   Type: Suite
   Room #: R103
   Max Guests: 3 persons
   Price: ₱4,000/night
   Suite with beautiful garden view

Would you like to book? Visit our booking page or call us!"
```

### Example 2: Promo Check
```
User: "Meron bang promo?"

Bot: "🎉 We have 3 active promos for you!

💰 SUMMER20
   Summer special - 20% off all rooms
   Discount: 20% OFF
   Valid until: 8/31/2024

💰 EARLY15
   Early bird discount - 15% off
   Discount: 15% OFF
   Valid until: 12/31/2024

Use these codes when booking to get discounts!"
```

### Example 3: Menu Inquiry
```
User: "Ano ang menu?"

Bot: "🍽️ Restaurant Menu:

APPETIZERS:
• Caesar Salad - ₱320

MAINS:
• Grilled Salmon - ₱580
• Margherita Pizza - ₱380

DESSERTS:
• Chocolate Cake - ₱180

🕐 All items prepared fresh! Prep time varies."
```

---

## 🧠 How the AI Works

### 1. **Intent Recognition**
```javascript
// Analyzes message to determine what user wants
analyzeIntent(message)
  ↓
Returns: { intent: 'available_rooms', entities: {} }
```

### 2. **Database Query**
```javascript
// Fetches real data based on intent
getAvailableRooms()
  ↓
SELECT * FROM inventory_items 
WHERE category = 'Room' AND status = 'Available'
```

### 3. **Response Generation**
```javascript
// Creates human-like response with actual data
generateResponse(intent, data)
  ↓
Returns formatted reply with real information
```

---

## 🛠️ Customization

### Add New Intents

Edit `controllers/chatbotController.js`:

```javascript
// In analyzeIntent function
if (msg.match(/\b(your_keywords|here)\b/i)) {
  return { intent: 'your_new_intent', entities: {} };
}

// In generateResponse function
case 'your_new_intent': {
  // Your custom logic here
  const data = await getYourData();
  return `Your formatted response: ${data}`;
}
```

### Update Contact Information

Find this section in `chatbotController.js`:

```javascript
case 'contact_info':
  return "📞 Contact Us:\n\n" +
         "📍 Location: Eduardo's Resort, [Your Address]\n" +
         "📧 Email: info@eduardosresort.com\n" +
         // Update these with real information
```

---

## 🐛 Troubleshooting

### Bot says "offline ako ngayon"
**Problem:** Backend not running or connection error

**Solution:**
1. Check if backend is running: `http://localhost:8000`
2. Check browser console for errors
3. Verify database is connected

### Bot gives generic responses
**Problem:** Database query failed

**Solution:**
1. Check database connection in `config/db.js`
2. Verify tables exist and have data
3. Check backend console for SQL errors

### Bot doesn't understand question
**Problem:** Intent not recognized

**Solution:**
1. Add more keywords to intent patterns
2. Check spelling and format
3. Ask in simpler terms

---

## 📈 Future Enhancements

Ideas to make the chatbot even smarter:

- [ ] Add booking directly from chat
- [ ] Image support (send room photos)
- [ ] Multi-language support
- [ ] Voice input/output
- [ ] Integration with real AI APIs (OpenAI, Gemini)
- [ ] Sentiment analysis
- [ ] Chat history persistence
- [ ] Admin dashboard for chat analytics

---

## 🎉 Key Features

✅ **Real-time data** - Always up-to-date information  
✅ **Bilingual** - English and Tagalog support  
✅ **Natural language** - Understands conversational queries  
✅ **Fast responses** - Instant replies from database  
✅ **Mobile-friendly** - Works on all devices  
✅ **Error handling** - Graceful fallbacks when offline  
✅ **Typing indicator** - Shows bot is "thinking"  
✅ **Smooth animations** - Professional UI/UX  

---

## 📝 API Endpoints

### POST /api/resort/chat
**Request:**
```json
{
  "message": "May available rooms ba?"
}
```

**Response:**
```json
{
  "reply": "We have 3 available rooms right now! 🏨\n\n...",
  "intent": "available_rooms",
  "timestamp": "2026-01-31T12:00:00.000Z"
}
```

### GET /api/resort/stats
**Response:**
```json
{
  "availableRooms": 3,
  "availableCottages": 2,
  "activePromos": 3,
  "activeCoaches": 3,
  "timestamp": "2026-01-31T12:00:00.000Z"
}
```

---

## 🎯 Summary

**Ginawa natin:**
1. ✅ Created intelligent chatbot controller with NLP
2. ✅ Integrated with all database tables
3. ✅ Added real-time data fetching
4. ✅ Support for English and Tagalog
5. ✅ Updated frontend to use new API
6. ✅ Added server routes

**Result:**  
Fully functional AI-like chatbot that provides **real, up-to-date information** from your database! 🚀

Ang chatbot mo ay **LIVE** na at ready to help customers! 🎉
