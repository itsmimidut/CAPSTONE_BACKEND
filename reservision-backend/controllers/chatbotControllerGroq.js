import Groq from 'groq-sdk';
import db from '../config/db.js';

// Groq AI with Llama 3.3 - SUPER FAST and FREE!
// Get API key: https://console.groq.com/keys

// Lazy initialization - creates Groq client only when needed
let groq = null;

function getGroqClient() {
  if (!groq && process.env.GROQ_API_KEY) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  }
  return groq;
}

async function getResortContext() {
  try {
    const [rooms] = await db.query(
      'SELECT item_id, category, category_type, room_number, name, description, max_guests, price, status FROM inventory_items WHERE category = "Room" ORDER BY price ASC'
    );

    const [cottages] = await db.query(
      'SELECT item_id, category, category_type, room_number, name, description, max_guests, price, status FROM inventory_items WHERE category = "Cottage" ORDER BY price ASC'
    );

    const [entrancerates] = await db.query(
      `SELECT id, name, day_type, price, age_min, age_max, start_time, end_time, status
       FROM entrance_rates
       ORDER BY FIELD(day_type, 'weekday', 'weekend', 'holiday'), price ASC`
    );

    const [menu] = await db.query('SELECT name, price, category, available, description FROM menu_items WHERE available = TRUE ORDER BY category, name');
    const [coaches] = await db.query('SELECT name, specialization, experience_years, certification, availability FROM swimming_coaches WHERE status = "Active"');

    return { rooms, cottages, entrancerates, menu, coaches };
  } catch (error) {
    console.error('Error fetching resort context:', error);
    return null;
  }
}

// Groq AI Chat with Llama
export const chatWithGroq = async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: 'Groq API key not configured. Please add GROQ_API_KEY to your .env file',
        setup: 'Get your free API key at https://console.groq.com/keys'
      });
    }

    const resortData = await getResortContext();

    if (!resortData) {
      return res.status(500).json({ error: 'Failed to fetch resort data' });
    }

    // Build a concise human-readable rates summary to ensure the model sees rates
    const formattedRates = (resortData.entrancerates || []).map(r => {
      const day = r.day_type ? r.day_type.charAt(0).toUpperCase() + r.day_type.slice(1) : 'All days'
      const price = Number(r.price).toFixed(2)
      const age = (r.age_min || r.age_max) ? `${r.age_min || 0}–${r.age_max || '∞'} yrs` : 'All ages'
      const time = (r.start_time && r.end_time) ? `${r.start_time}–${r.end_time}` : 'All day'
      const status = r.status && r.status !== 'active' ? ` (${r.status})` : ''
      return `• ${r.name} (${day}) — ₱${price} — ${age} — ${time}${status}`
    }).join('\n')

    console.log('Chatbot: entrance rates count =', resortData.entrancerates.length)
    console.log('Chatbot: formattedRates:\n', formattedRates)

    // If the user explicitly asks about entrance/per-head rates, return deterministic answer
    const q = message.toString().toLowerCase()
    const rateKeywords = ['per head', 'per-head', 'per person', 'per-person', 'entrance rate', 'entrance rates', 'entrance fee', 'per pax', 'per head rates', 'rate per head']
    const askedForRates = rateKeywords.some(k => q.includes(k))
    if (askedForRates) {
      const reply = `Kumusta! 👋\nNarito ang aming entrance rates (per head):\n${formattedRates}\n\nGusto mo bang i-book o may specific date ka na tinitignan?`;
      return res.json({ success: true, response: reply, model: 'local-fallback', provider: 'server', timestamp: new Date().toISOString() })
    }

    const systemPrompt = `You are Eduardo's Resort AI assistant. You MUST answer using ONLY real data provided below.

  🏨 AVAILABLE ROOMS:
  ${JSON.stringify(resortData.rooms.filter(r => r.status === 'Available'), null, 2)}

  🏡 AVAILABLE COTTAGES:
  ${JSON.stringify(resortData.cottages.filter(c => c.status === 'Available'), null, 2)}

  ️ RESTAURANT MENU:
  ${JSON.stringify(resortData.menu, null, 2)}

  ️ ENTRANCE RATES:
  ${JSON.stringify(resortData.entrancerates, null, 2)}

  🏊 SWIMMING COACHES:
  ${JSON.stringify(resortData.coaches, null, 2)}

  SPECIAL BEHAVIOR FOR RATE QUERIES:
  When the user asks about "per head", "per person", "entrance", "rates", or any question about how much it costs to enter (including requests like "per head rates"), ALWAYS respond using the ENTRANCE RATES section above. Format each rate as a concise bullet with:
  - Rate name
  - Day type (Weekday/Weekend/Holiday)
  - Price formatted as ₱XXX.XX
  - Age range if present (e.g., 3–12 yrs)
  - Time range if present (e.g., 08:00–17:00)
  - Status (Active/Hidden) — include only if not active

  RESPONSE FORMATTING RULES:
  1. Use emojis to make responses friendly and visual
  2. Format prices clearly as ₱XXX.XX (e.g., ₱380.00)
  3. Use line breaks for better readability
  4. Structure responses with clear sections when listing multiple items
  5. Keep responses conversational in Taglish (mix of Tagalog and English)
  6. When showing multiple options, use bullet points or numbered lists
  7. Highlight important info like room numbers
  8. End with a helpful question or call-to-action when appropriate

  FORMATTING EXAMPLES:

  For Entrance Rate Queries (per-head):
  "Narito ang aming entrance rates:
  • Adult (Weekday) — ₱150.00 — All ages — All day
  • Child (Weekday) — ₱80.00 — 3–12 yrs — All day
  "

  FORMATTED_RATES:
  ${formattedRates}

  For Menu Queries:
  "Here's our menu! 🍽️

  MAIN DISHES:
  • Adobong Baka - ₱100.00
  • Lechon Kawali - ₱150.00

  DESSERTS:
  • Halo-Halo - ₱80.00
  • Leche Flan - ₱60.00

  Anong gusto mo i-order?"

  IMPORTANT:
  - Answer ONLY with real data from above
  - Use friendly, conversational Taglish tone
  - Keep responses organized and easy to read
  - Always format prices with ₱ symbol
  - Use emojis appropriately (not too much!)
  - If data not available, politely say so and suggest alternatives`;

    // Build conversation messages
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (last 5 messages to keep context manageable)
    const recentHistory = conversationHistory.slice(-5);
    messages.push(...recentHistory);

    // Add current user message
    messages.push({ role: 'user', content: message });

    // Call Groq API with Llama model
    const groqClient = getGroqClient();
    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile', // Latest Llama model on Groq
      messages: messages,
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 0.9,
      stream: false
    });

    const aiResponse = completion.choices[0].message.content;

    res.json({
      success: true,
      response: aiResponse,
      model: 'llama-3.3-70b-versatile',
      provider: 'Groq',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Groq API Error:', error);

    let errorMessage = 'Failed to process chat request';
    let statusCode = 500;

    if (error.status === 401) {
      errorMessage = 'Invalid Groq API key. Please check your GROQ_API_KEY in .env file';
      statusCode = 401;
    } else if (error.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again in a moment';
      statusCode = 429;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message
    });
  }
};

// Test endpoint to verify Groq connection
export const testGroq = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: 'Groq API key not configured',
        setup: 'Get your free API key at https://console.groq.com/keys'
      });
    }
    const groqClient = getGroqClient();
    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: 'Say hello in one sentence!' }
      ],
      temperature: 0.7,
      max_tokens: 100
    });

    res.json({
      success: true,
      message: 'Groq API is working!',
      response: completion.choices[0].message.content,
      model: 'llama-3.3-70b-versatile'
    });
  } catch (error) {
    console.error('Groq Test Error:', error);
    res.status(500).json({
      error: 'Groq API test failed',
      details: error.message
    });
  }
};
