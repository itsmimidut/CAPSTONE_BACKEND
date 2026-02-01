# 🤖 Grok AI Integration Guide

## Overview
Your chatbot now uses **Grok** (xAI's AI model from Elon Musk's company). Grok is powerful, uncensored, and has real-time knowledge!

## 🚀 Quick Setup

### Step 1: Get Grok API Key
1. Go to **https://console.x.ai**
2. Sign in with your X (Twitter) account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `xai-...`)

### Step 2: Add API Key to .env
```env
GROK_API_KEY=xai-your-actual-api-key-here
```

### Step 3: Start Backend
```bash
cd C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm start
```

## 📋 What Was Set Up

### 1. **chatbotControllerGrok.js**
- Uses Grok Beta model (`grok-beta`)
- Connects to real database (rooms, cottages, promos, menu, coaches)
- Bilingual support (English + Tagalog)
- Formatted responses with emojis

### 2. **Updated routes/chatbot.js**
- Routes now use Grok controller
- POST `/api/resort/chat` - Chat endpoint
- GET `/api/resort/stats` - Get resort statistics

### 3. **Updated .env**
- Added `GROK_API_KEY` configuration
- Kept old Gemini key for reference

## 🌟 Why Grok?

### ✅ Advantages
- **No Network Blocking** - Works from your school network
- **Real-time Knowledge** - Connected to current events
- **Uncensored** - More flexible responses
- **OpenAI-compatible API** - Easy to use
- **Affordable Pricing** - Competitive rates

### 💰 Pricing (as of Jan 2026)
- **Grok Beta**: ~$5 per 1M tokens
- Much cheaper than OpenAI GPT-4
- Free tier available for testing

## 🧪 Testing Grok

### Test 1: Simple Chat
```bash
curl -X POST http://localhost:8000/api/resort/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"May available rooms ba?\"}"
```

### Test 2: Get Stats
```bash
curl http://localhost:8000/api/resort/stats
```

### Test 3: From Frontend
1. Start frontend: `npm run dev`
2. Open chatbot modal
3. Type: "Show me available rooms"
4. Should get real database results with Grok's personality!

## 📊 API Format

Grok uses OpenAI-compatible format:

```javascript
POST https://api.x.ai/v1/chat/completions
Headers:
  - Content-Type: application/json
  - Authorization: Bearer YOUR_GROK_API_KEY

Body:
{
  "model": "grok-beta",
  "messages": [
    { "role": "system", "content": "You are..." },
    { "role": "user", "content": "User message" }
  ],
  "temperature": 0.7,
  "max_tokens": 500
}
```

## 🔄 Switching Models

Want to try different Grok models? Edit `chatbotControllerGrok.js`:

```javascript
model: 'grok-beta'  // Current (fastest, cheapest)
// or
model: 'grok-2-latest'  // More powerful, slower
```

## 🐛 Troubleshooting

### Error: "Unauthorized" (401)
- Check API key is correct in .env
- Make sure key starts with `xai-`
- Verify key is active in console.x.ai

### Error: "Network Error"
- Check if api.x.ai is accessible (unlikely to be blocked)
- Test: `curl https://api.x.ai/v1/models`

### Error: "Quota Exceeded"
- You've used up free tier
- Add payment method at console.x.ai

### Chatbot returns generic responses
- Make sure backend restarted after adding API key
- Check console for errors: `npm start`

## 🎯 Features

Your Grok chatbot can:
- ✅ Answer questions about rooms/cottages
- ✅ Show current promos with real data
- ✅ Display entrance rates
- ✅ Show restaurant menu
- ✅ List swimming coaches
- ✅ Check availability in real-time
- ✅ Speak English & Tagalog
- ✅ Use emojis for friendly responses

## 🔐 Security

**IMPORTANT**: 
- Never commit `.env` file to Git
- Keep your Grok API key private
- Add `.env` to `.gitignore`

## 📞 Support

- Grok API Docs: https://docs.x.ai
- API Status: https://status.x.ai
- Get API Key: https://console.x.ai

## 🎉 Next Steps

1. ✅ Get Grok API key from console.x.ai
2. ✅ Add key to .env file
3. ✅ Restart backend: `npm start`
4. ✅ Test chatbot from frontend
5. ✅ Deploy to production (Render, Railway, etc.)

Your chatbot is now powered by Grok! 🚀
