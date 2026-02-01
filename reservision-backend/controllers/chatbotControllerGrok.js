import db from '../config/db.js';

// Using Grok AI from xAI (Elon Musk's AI)
// Get API key from: https://console.x.ai

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

// Grok AI Chat
export const chatWithGrok = async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const resortData = await getResortContext();
    
    if (!resortData) {
      return res.status(500).json({ 
        reply: 'Sorry, may technical issue ako ngayon. Please try again later! 😊'
      });
    }
    
    // Build system prompt with real resort data
    const systemPrompt = `You are a helpful, friendly assistant for Eduardo's Resort in the Philippines. 
You speak both English and Tagalog/Filipino. Be conversational, warm, and helpful.

IMPORTANT RULES:
- Always use REAL DATA from the context provided below
- Never make up information - only use data from the context
- Format prices as ₱X,XXX (Philippine Peso)
- Be concise but informative
- Use emojis appropriately (🏨🏖️💰🍽️🏊 etc.)
- If asked about availability, show actual available rooms/cottages
- For promos, show active promo codes and discounts

CURRENT RESORT DATA (Use this for answers):

AVAILABLE ROOMS (${resortData.rooms.filter(r => r.status === 'Available').length} available):
${JSON.stringify(resortData.rooms, null, 2)}

AVAILABLE COTTAGES (${resortData.cottages.filter(c => c.status === 'Available').length} available):
${JSON.stringify(resortData.cottages, null, 2)}

ACTIVE PROMOS (${resortData.promos.length} active):
${JSON.stringify(resortData.promos, null, 2)}

ENTRANCE RATES:
${JSON.stringify(resortData.rates.entrance, null, 2)}

COTTAGE RENTAL RATES:
${JSON.stringify(resortData.rates.cottages, null, 2)}

PACKAGE RATES:
${JSON.stringify(resortData.rates.packages, null, 2)}

RESTAURANT MENU:
${JSON.stringify(resortData.menu, null, 2)}

SWIMMING COACHES:
${JSON.stringify(resortData.coaches, null, 2)}

CONTACT INFO:
- Name: Eduardo's Resort
- Location: Eduardo's Resort, [Your Address]
- Email: info@eduardosresort.com
- Phone: [Your Phone Number]
- Hours: 24/7 for guests, Office: 8AM-6PM
- Amenities: Swimming Pool, Restaurant, Beach Access, Videoke Rooms, Function Hall, Parking, WiFi

Remember: Be helpful, friendly, and ONLY use the real data provided above!`;

    // Call Grok API (OpenAI-compatible format)
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-beta', // or 'grok-2-latest'
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    
    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    res.json({
      reply,
      model: 'grok-beta',
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Grok error:', error);
    res.status(500).json({ 
      reply: 'Sorry, may problema ako ngayon. Please try again later! 😊',
      error: error.message
    });
  }
};

// Get chatbot statistics
export const getStats = async (req, res) => {
  try {
    const [rooms] = await db.query(
      'SELECT COUNT(*) as count FROM inventory_items WHERE category = "Room" AND status = "Available"'
    );
    const [cottages] = await db.query(
      'SELECT COUNT(*) as count FROM inventory_items WHERE category = "Cottage" AND status = "Available"'
    );
    const [promos] = await db.query(
      'SELECT COUNT(*) as count FROM promos WHERE endDate >= CURDATE()'
    );
    const [coaches] = await db.query(
      'SELECT COUNT(*) as count FROM swimming_coaches WHERE status = "Active"'
    );
    
    res.json({
      availableRooms: rooms[0].count,
      availableCottages: cottages[0].count,
      activePromos: promos[0].count,
      activeCoaches: coaches[0].count,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
