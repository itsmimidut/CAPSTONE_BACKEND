import Groq from 'groq-sdk';
import {
  CHAT_HISTORY_CONTENT_MAX_LENGTH,
  CHAT_HISTORY_MAX_ITEMS,
} from '../middleware/validators/chatbotValidators.js';
import { getCachedResortContext } from '../services/chatbotResortContextService.js';
import { logSystemEvent } from '../utils/logger.js';

const isProduction = process.env.NODE_ENV === 'production';

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

function sanitizeConversationHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-CHAT_HISTORY_MAX_ITEMS)
    .filter((item) => item && ['user', 'assistant'].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, CHAT_HISTORY_CONTENT_MAX_LENGTH),
    }));
}

function respondServiceUnavailable(res, devMessage) {
  return res.status(503).json({
    success: false,
    error: isProduction
      ? 'The assistant is temporarily unavailable. Please try again later.'
      : devMessage,
    ...(isProduction ? {} : { code: 'GROQ_NOT_CONFIGURED' }),
  });
}

// Groq AI Chat with Llama
export const chatWithGroq = async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return respondServiceUnavailable(
        res,
        'Groq API key not configured. Add GROQ_API_KEY to your .env file.',
      );
    }

    const { data: resortData } = await getCachedResortContext();

    if (!resortData) {
      return res.status(503).json({
        success: false,
        error: 'The assistant is temporarily unavailable. Please try again later.',
      });
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

  🎉 ACTIVE PROMOS:
  ${JSON.stringify(resortData.promos || [], null, 2)}

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

    // Add conversation history (last N messages to keep context manageable)
    const recentHistory = sanitizeConversationHistory(conversationHistory);
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
    logSystemEvent('CHATBOT_GROQ_ERROR', {
      status: error?.status,
      message: error?.message,
    });

    let statusCode = 500;
    let errorMessage = isProduction
      ? 'The assistant is temporarily unavailable. Please try again later.'
      : 'Failed to process chat request';

    if (error?.status === 401) {
      statusCode = 503;
      errorMessage = 'The assistant is temporarily unavailable. Please try again later.';
    } else if (error?.status === 429) {
      statusCode = 429;
      errorMessage = 'Too many requests. Please try again in a moment.';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
    });
  }
};

// Admin-only endpoint to verify Groq connection
export const testGroq = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return respondServiceUnavailable(
        res,
        'Groq API key not configured. Add GROQ_API_KEY to your .env file.',
      );
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
    logSystemEvent('CHATBOT_GROQ_TEST_ERROR', {
      status: error?.status,
      message: error?.message,
    });

    res.status(500).json({
      success: false,
      error: 'Groq API test failed',
    });
  }
};
