import db from '../config/db.js';

// Using Ollama (LOCAL AI - No internet needed!)
// Install: https://ollama.com/download
// Then run: ollama pull llama3.2:1b

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

// Ollama AI Chat
export const chatWithOllama = async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const resortData = await getResortContext();
    
    const systemPrompt = `You are Eduardo's Resort assistant. Answer using ONLY real data below.

Available Rooms: ${JSON.stringify(resortData.rooms.filter(r => r.status === 'Available'))}
Active Promos: ${JSON.stringify(resortData.promos)}
Entrance Rates: ${JSON.stringify(resortData.rates.entrance)}
Menu: ${JSON.stringify(resortData.menu)}
Coaches: ${JSON.stringify(resortData.coaches)}

Be helpful, use emojis, speak English/Tagalog.`;

    // Call Ollama (runs locally on http://localhost:11434)
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',  // or 'phi3'
        prompt: `${systemPrompt}\n\nUser: ${message}\nAssistant:`,
        stream: false
      })
    });
    
    const data = await response.json();
    const reply = data.response;
    
    res.json({
      reply,
      model: 'ollama-llama3.2',
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Ollama error:', error);
    res.status(500).json({ 
      reply: 'Sorry, may problema ako ngayon. Please try again later! 😊'
    });
  }
};

// Get stats
export const getStats = async (req, res) => {
  try {
    const [rooms] = await db.query('SELECT COUNT(*) as count FROM inventory_items WHERE category = "Room" AND status = "Available"');
    const [cottages] = await db.query('SELECT COUNT(*) as count FROM inventory_items WHERE category = "Cottage" AND status = "Available"');
    const [promos] = await db.query('SELECT COUNT(*) as count FROM promos WHERE endDate >= CURDATE()');
    const [coaches] = await db.query('SELECT COUNT(*) as count FROM swimming_coaches WHERE status = "Active"');
    
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
