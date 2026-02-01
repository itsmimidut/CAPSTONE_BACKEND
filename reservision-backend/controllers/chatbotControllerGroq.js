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
    
    const [promos] = await db.query(
      'SELECT code, type, value, description, startDate, endDate FROM promos WHERE endDate >= CURDATE() ORDER BY value DESC'
    );
    
    const [entranceRates] = await db.query('SELECT label, value FROM rate_entries WHERE category = "entrance"');
    const [cottageRates] = await db.query('SELECT label, value FROM rate_entries WHERE category = "cottages"');
    const [packageRates] = await db.query('SELECT label, value FROM rate_entries WHERE category = "packages"');
    const [menu] = await db.query('SELECT name, price, category, available, description FROM menu_items WHERE available = TRUE ORDER BY category, name');
    const [coaches] = await db.query('SELECT name, specialization, experience_years, certification, availability FROM swimming_coaches WHERE status = "Active"');
    
    return { rooms, cottages, promos, rates: { entrance: entranceRates, cottages: cottageRates, packages: packageRates }, menu, coaches };
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
    
    const systemPrompt = `You are Eduardo's Resort AI assistant. You MUST answer using ONLY real data provided below.

🏨 AVAILABLE ROOMS:
${JSON.stringify(resortData.rooms.filter(r => r.status === 'Available'), null, 2)}

🏡 AVAILABLE COTTAGES:
${JSON.stringify(resortData.cottages.filter(c => c.status === 'Available'), null, 2)}

🎉 ACTIVE PROMOTIONS:
${JSON.stringify(resortData.promos, null, 2)}

💰 ENTRANCE RATES:
${JSON.stringify(resortData.rates.entrance, null, 2)}

🏡 COTTAGE RATES:
${JSON.stringify(resortData.rates.cottages, null, 2)}

📦 PACKAGE RATES:
${JSON.stringify(resortData.rates.packages, null, 2)}

🍽️ RESTAURANT MENU:
${JSON.stringify(resortData.menu, null, 2)}

🏊 SWIMMING COACHES:
${JSON.stringify(resortData.coaches, null, 2)}

RESPONSE FORMATTING RULES:
1. Use emojis to make responses friendly and visual
2. Format prices clearly as ₱XXX.XX (e.g., ₱380.00)
3. Use line breaks for better readability
4. Structure responses with clear sections when listing multiple items
5. Keep responses conversational in Taglish (mix of Tagalog and English)
6. When showing multiple options, use bullet points or numbered lists
7. Highlight important info like promo codes, discounts, room numbers
8. End with a helpful question or call-to-action when appropriate

FORMATTING EXAMPLES:

For Room Queries:
"Kumusta! May available rooms kami:

🏨 Deluxe Room (Room 101)
• Max: 2 guests
• Price: ₱1,200.00/night
• Features: [description]

🏨 Family Room (Room 205)  
• Max: 4 guests
• Price: ₱2,500.00/night
• Features: [description]

May promo din kami ngayon! Use code SUMMER15 for 15% off. Interested ka ba?"

For Promo Queries:
"Yes, may active promos kami! 🎉

💝 SUMMER15 - 15% discount
Valid until: [date]
Perfect for summer bookings!

💝 STAYCATION - ₱500 off
Valid until: [date]
Great for overnight stays!

Gusto mo bang mag-book?"

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
