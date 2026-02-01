# 🦙 Llama AI Chatbot Integration Guide

## Overview
You now have **Llama 3.3 (70B)** integrated into your chatbot using **Groq** - the fastest inference platform for Llama models!

### ⚡ Why Groq?
- **SUPER FAST**: Responses in milliseconds
- **FREE TIER**: Generous free usage limits
- **LATEST MODELS**: Llama 3.3 70B Versatile
- **EASY SETUP**: Just need an API key

---

## 🔑 Step 1: Get Your FREE Groq API Key

### 1. Visit Groq Console
Go to: **https://console.groq.com/keys**

### 2. Sign Up/Login
- Click "Sign Up" or "Login"
- Use Google, GitHub, or email
- It's completely FREE!

### 3. Create API Key
1. Click "Create API Key"
2. Give it a name (e.g., "Eduardo Resort Chatbot")
3. Copy the key (starts with `gsk_...`)
4. **IMPORTANT**: Save it somewhere safe - you can only see it once!

### 4. Add to Your .env File
Open `CAPSTONE_BACKEND/reservision-backend/.env` and replace:
```env
GROQ_API_KEY=your-groq-api-key-here
```

With your actual key:
```env
GROQ_API_KEY=gsk_your_actual_key_here
```

---

## 📦 Step 2: Install Dependencies

Open terminal in the backend folder:
```bash
cd C:\Users\NPMI01\CAPSTONE_BACKEND\reservision-backend
npm install
```

This installs the `groq-sdk` package.

---

## 🚀 Step 3: Test the Integration

### Test the API Connection
1. Start your backend server:
```bash
npm start
```

2. Test the Groq connection (use browser or Postman):
```
GET http://localhost:8000/api/resort/chat/groq/test
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Groq API is working!",
  "response": "Hello! I'm here to help!",
  "model": "llama-3.3-70b-versatile"
}
```

---

## 💬 Step 4: Update Your Frontend

### Option 1: Update Existing Chatbot Component

Find your chatbot component (likely in `components/ChatbotModal.vue`) and update the API endpoint:

```javascript
// Change from:
const response = await fetch('http://localhost:8000/api/resort/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: userMessage })
});

// To:
const response = await fetch('http://localhost:8000/api/resort/chat/groq', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    message: userMessage,
    conversationHistory: conversationHistory // Optional: for context
  })
});
```

### Option 2: Create a Toggle for AI Models

```vue
<template>
  <div class="ai-model-selector">
    <select v-model="selectedModel">
      <option value="groq">Llama 3.3 (Groq) - Fast</option>
      <option value="pattern">Pattern Matching - Offline</option>
    </select>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const selectedModel = ref('groq');

async function sendMessage(message) {
  const endpoint = selectedModel.value === 'groq' 
    ? 'http://localhost:8000/api/resort/chat/groq'
    : 'http://localhost:8000/api/resort/chat';
    
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  
  const data = await response.json();
  return data.response;
}
</script>
```

---

## 🎯 API Endpoints

### Chat with Llama
```
POST /api/resort/chat/groq
```

**Request Body:**
```json
{
  "message": "What rooms are available?",
  "conversationHistory": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "response": "We have several rooms available...",
  "model": "llama-3.3-70b-versatile",
  "provider": "Groq",
  "timestamp": "2026-02-01T12:00:00.000Z"
}
```

### Test Connection
```
GET /api/resort/chat/groq/test
```

---

## 🔥 Features Implemented

### ✅ What the Chatbot Can Do:

1. **Real-Time Data Access**
   - Available rooms and cottages
   - Current promotions
   - Menu items
   - Swimming coaches
   - Entrance rates

2. **Bilingual Support**
   - English and Tagalog
   - Natural conversation

3. **Smart Context**
   - Remembers conversation history
   - Provides relevant suggestions

4. **Fast Responses**
   - Groq delivers responses in milliseconds
   - Much faster than other AI providers

---

## 🐛 Troubleshooting

### Error: "Invalid Groq API key"
- Check that your API key is correctly copied in `.env`
- Make sure there are no extra spaces
- Restart your server after updating `.env`

### Error: "Rate limit exceeded"
- Groq free tier has limits
- Wait a few seconds and try again
- Consider upgrading if needed

### Error: "Groq API key not configured"
- Make sure `.env` file exists
- Check that `GROQ_API_KEY` is set
- Restart the server

### Server Not Loading .env
Add this to the top of `server.js`:
```javascript
import dotenv from 'dotenv';
dotenv.config();
```

---

## 📊 Groq Free Tier Limits

- **Requests**: 30 requests per minute
- **Tokens**: 6,000 tokens per minute
- **Daily**: Generous limits for development

**For most chatbots, this is MORE than enough!**

---

## 🎨 Example Frontend Implementation

```vue
<template>
  <div class="chatbot">
    <div class="messages">
      <div v-for="msg in messages" :key="msg.id" :class="msg.role">
        {{ msg.content }}
      </div>
    </div>
    
    <div class="input-area">
      <input v-model="userInput" @keyup.enter="sendMessage" 
             placeholder="Ask about rooms, rates, promos...">
      <button @click="sendMessage" :disabled="loading">
        {{ loading ? 'Thinking...' : 'Send' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const messages = ref([]);
const userInput = ref('');
const loading = ref(false);
const conversationHistory = ref([]);

async function sendMessage() {
  if (!userInput.value.trim()) return;
  
  const userMessage = userInput.value;
  messages.value.push({ role: 'user', content: userMessage });
  userInput.value = '';
  loading.value = true;
  
  try {
    const response = await fetch('http://localhost:8000/api/resort/chat/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: userMessage,
        conversationHistory: conversationHistory.value
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      messages.value.push({ role: 'assistant', content: data.response });
      
      // Update conversation history
      conversationHistory.value.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: data.response }
      );
      
      // Keep only last 10 messages for context
      if (conversationHistory.value.length > 10) {
        conversationHistory.value = conversationHistory.value.slice(-10);
      }
    }
  } catch (error) {
    console.error('Chat error:', error);
    messages.value.push({ 
      role: 'assistant', 
      content: 'Sorry, something went wrong. Please try again.' 
    });
  } finally {
    loading.value = false;
  }
}
</script>
```

---

## 🚀 Next Steps

1. ✅ Get your Groq API key
2. ✅ Add it to `.env`
3. ✅ Run `npm install` in backend
4. ✅ Test with `/api/resort/chat/groq/test`
5. ✅ Update your frontend component
6. ✅ Test the full chatbot!

---

## 📚 Additional Resources

- **Groq Console**: https://console.groq.com
- **Groq Docs**: https://console.groq.com/docs
- **Llama 3.3 Info**: https://www.llama.com
- **API Reference**: https://console.groq.com/docs/api-reference

---

## 💡 Pro Tips

1. **Conversation Context**: Pass the last 5-10 messages for better context
2. **Error Handling**: Always handle API errors gracefully
3. **Loading States**: Show "typing..." while waiting for response
4. **Rate Limiting**: Add debouncing to prevent spam
5. **Fallback**: Keep the pattern-matching chatbot as backup

---

## 🎉 You're All Set!

Your chatbot now uses **Llama 3.3 70B** - one of the most powerful open-source models!

Groq makes it blazing fast (often under 1 second for responses) and it's FREE to use.

Happy coding! 🚀
