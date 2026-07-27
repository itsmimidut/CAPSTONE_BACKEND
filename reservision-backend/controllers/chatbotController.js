import db from '../config/db.js';
import { logSystemEvent } from '../utils/logger.js';

const isProduction = process.env.NODE_ENV === 'production';
// Helper function to get available rooms
async function getAvailableRooms() {
  const [rooms] = await db.query(
    'SELECT * FROM inventory_items WHERE category = "Room" AND status = "Available" ORDER BY price ASC'
  );
  return rooms;
}

// Helper function to get available cottages
async function getAvailableCottages() {
  const [cottages] = await db.query(
    'SELECT * FROM inventory_items WHERE category = "Cottage" AND status = "Available" ORDER BY price ASC'
  );
  return cottages;
}

// Helper function to get active promos
async function getActivePromos() {
  const [promos] = await db.query(
    'SELECT * FROM promos WHERE endDate >= CURDATE() ORDER BY value DESC'
  );
  return promos;
}

// Helper function to get rate entries
async function getRateEntries(category) {
  const [rates] = await db.query(
    'SELECT * FROM rate_entries WHERE category = ?',
    [category]
  );
  return rates;
}

// Helper function to get menu items
async function getMenuItems() {
  const [menu] = await db.query(
    'SELECT * FROM menu_items WHERE available = TRUE ORDER BY category, name'
  );
  return menu;
}

// Helper function to get swimming coaches
async function getSwimmingCoaches() {
  const [coaches] = await db.query(
    'SELECT * FROM swimming_coaches WHERE status = "Active" ORDER BY name'
  );
  return coaches;
}

// Natural language processing function
function analyzeIntent(message) {
  const msg = message.toLowerCase();

  // Room/Accommodation queries
  if (msg.match(/\b(rooms?|kwarto|tulog|overnight|stay)\b/i)) {
    if (msg.match(/\b(available|bakante|meron|may|magkano|presyo|price)\b/i)) {
      return { intent: 'available_rooms', entities: {} };
    }
    return { intent: 'room_info', entities: {} };
  }

  // Cottage queries
  if (msg.match(/\b(cottages?|kubo|bahay)\b/i)) {
    if (msg.match(/\b(available|bakante|meron|may|magkano|presyo|price)\b/i)) {
      return { intent: 'available_cottages', entities: {} };
    }
    return { intent: 'cottage_info', entities: {} };
  }

  // Promo queries
  if (msg.match(/\b(promos?|discounts?|sale|offers?|bawas|tipid)\b/i)) {
    return { intent: 'promos', entities: {} };
  }

  // Rate/Price queries
  if (msg.match(/\b(rates?|presyo|prices?|magkano|entrance|pasok)\b/i)) {
    if (msg.match(/\b(entrance|pasok|admission|gate)\b/i)) {
      return { intent: 'entrance_rates', entities: {} };
    }
    if (msg.match(/\b(cottages?|kubo)\b/i)) {
      return { intent: 'cottage_rates', entities: {} };
    }
    if (msg.match(/\b(packages?|pakete)\b/i)) {
      return { intent: 'package_rates', entities: {} };
    }
    return { intent: 'general_rates', entities: {} };
  }

  // Restaurant queries
  if (msg.match(/\b(food|foods|kain|menu|menus|restaurant|ulam|pagkain)\b/i)) {
    return { intent: 'restaurant_menu', entities: {} };
  }

  // Swimming lessons queries
  if (msg.match(/\b(swimming|langoy|lessons?|coach|coaches|trainer|trainers)\b/i)) {
    return { intent: 'swimming_lessons', entities: {} };
  }

  // Contact/Location queries
  if (msg.match(/\b(contact|location|address|saan|nasaan|paano pumunta|how to get)\b/i)) {
    return { intent: 'contact_info', entities: {} };
  }

  // Booking queries
  if (msg.match(/\b(book|books|booking|reserve|reservations?|pa-book|mag-book)\b/i)) {
    return { intent: 'booking_info', entities: {} };
  }

  // Amenities queries
  if (msg.match(/\b(amenity|amenities|facilities|facility|pasilidad|pool|pools|gym|gyms)\b/i)) {
    return { intent: 'amenities', entities: {} };
  }

  // Greetings
  if (msg.match(/\b(hi|hello|hey|kumusta|musta|good morning|good afternoon|good evening)\b/i)) {
    return { intent: 'greeting', entities: {} };
  }

  // Help
  if (msg.match(/\b(help|tulong|ano kaya|what can)\b/i)) {
    return { intent: 'help', entities: {} };
  }

  return { intent: 'unknown', entities: {} };
}

// Generate response based on intent
async function generateResponse(intent, entities) {
  try {
    switch (intent) {
      case 'greeting':
        return "Hi! Welcome to Eduardo's Resort! 🏖️ Kumusta? How can I help you today? You can ask me about available rooms, cottages, rates, promos, restaurant menu, swimming lessons, or how to book!";

      case 'help':
        return "I can help you with:\n\n" +
          "🏨 Available rooms and cottages\n" +
          "💰 Rates and pricing\n" +
          "🎉 Current promos and discounts\n" +
          "🍽️ Restaurant menu\n" +
          "🏊 Swimming lessons and coaches\n" +
          "📞 Contact information\n" +
          "📅 How to book\n\n" +
          "Just ask me anything!";

      case 'available_rooms': {
        const rooms = await getAvailableRooms();
        if (rooms.length === 0) {
          return "Sorry, walang available rooms ngayon. Would you like to check our cottages instead?";
        }

        let response = `We have ${rooms.length} available room${rooms.length > 1 ? 's' : ''} right now! 🏨\n\n`;
        rooms.forEach(room => {
          response += `📍 ${room.name}\n`;
          response += `   Type: ${room.category_type}\n`;
          response += `   Room #: ${room.room_number}\n`;
          response += `   Max Guests: ${room.max_guests} persons\n`;
          response += `   Price: ₱${parseFloat(room.price).toLocaleString()}/night\n`;
          if (room.description) {
            response += `   ${room.description}\n`;
          }
          response += `\n`;
        });
        response += "Would you like to book? Visit our booking page or call us!";
        return response;
      }

      case 'available_cottages': {
        const cottages = await getAvailableCottages();
        if (cottages.length === 0) {
          return "Sorry, walang available cottages ngayon. Would you like to check our rooms instead?";
        }

        let response = `We have ${cottages.length} available cottage${cottages.length > 1 ? 's' : ''} right now! 🏡\n\n`;
        cottages.forEach(cottage => {
          response += `📍 ${cottage.name}\n`;
          response += `   Type: ${cottage.category_type}\n`;
          response += `   Cottage #: ${cottage.room_number}\n`;
          response += `   Max Guests: ${cottage.max_guests} persons\n`;
          response += `   Price: ₱${parseFloat(cottage.price).toLocaleString()}/night\n`;
          if (cottage.description) {
            response += `   ${cottage.description}\n`;
          }
          response += `\n`;
        });
        response += "Interested? Contact us to book!";
        return response;
      }

      case 'room_info': {
        const rooms = await getAvailableRooms();
        return `We offer different types of rooms:\n\n` +
          `🏨 Standard Rooms - Perfect for couples\n` +
          `🏨 Deluxe Rooms - Premium comfort with great views\n` +
          `🏨 Suites - Spacious rooms for families\n\n` +
          `Current available: ${rooms.length} room${rooms.length !== 1 ? 's' : ''}\n` +
          `Prices start from ₱${rooms.length > 0 ? parseFloat(rooms[0].price).toLocaleString() : '2,000'}\n\n` +
          `Want to see specific available rooms?`;
      }

      case 'cottage_info': {
        const cottages = await getAvailableCottages();
        return `We have beautiful cottages available:\n\n` +
          `🏡 Family Cottages - Spacious for big groups\n` +
          `🏡 Beach Front Villas - Direct beach access\n` +
          `🏡 Mountain View Cottages - Scenic mountain views\n\n` +
          `Current available: ${cottages.length} cottage${cottages.length !== 1 ? 's' : ''}\n` +
          `Prices start from ₱${cottages.length > 0 ? parseFloat(cottages[0].price).toLocaleString() : '5,500'}\n\n` +
          `Want to see specific available cottages?`;
      }

      case 'promos': {
        const promos = await getActivePromos();
        if (promos.length === 0) {
          return "Sorry, walang active promos ngayon. But we still offer great value! Check our regular rates.";
        }

        let response = `🎉 We have ${promos.length} active promo${promos.length > 1 ? 's' : ''} for you!\n\n`;
        promos.forEach(promo => {
          response += `💰 ${promo.code}\n`;
          response += `   ${promo.description}\n`;
          response += `   Discount: `;
          if (promo.type === 'percentage') {
            response += `${promo.value}% OFF\n`;
          } else {
            response += `₱${parseFloat(promo.value).toLocaleString()} OFF\n`;
          }
          response += `   Valid until: ${new Date(promo.endDate).toLocaleDateString()}\n\n`;
        });
        response += "Use these codes when booking to get discounts!";
        return response;
      }

      case 'entrance_rates': {
        const rates = await getRateEntries('entrance');
        let response = "🎫 Entrance Rates:\n\n";
        rates.forEach(rate => {
          response += `• ${rate.label}: ${rate.value}\n`;
        });
        response += "\n💡 PWD and Senior Citizens get special rates!";
        return response;
      }

      case 'cottage_rates': {
        const rates = await getRateEntries('cottages');
        let response = "🏖️ Cottage Rental Rates:\n\n";
        rates.forEach(rate => {
          response += `• ${rate.label}: ${rate.value}\n`;
        });
        return response;
      }

      case 'package_rates': {
        const rates = await getRateEntries('packages');
        let response = "📦 Package Rates:\n\n";
        rates.forEach(rate => {
          response += `• ${rate.label}: ${rate.value}\n`;
        });
        return response;
      }

      case 'general_rates': {
        const entrance = await getRateEntries('entrance');
        const cottages = await getRateEntries('cottages');
        const packages = await getRateEntries('packages');

        let response = "💰 Our Rates:\n\n";

        if (entrance.length > 0) {
          response += "🎫 ENTRANCE:\n";
          entrance.forEach(rate => {
            response += `• ${rate.label}: ${rate.value}\n`;
          });
          response += "\n";
        }

        if (cottages.length > 0) {
          response += "🏖️ COTTAGES:\n";
          cottages.forEach(rate => {
            response += `• ${rate.label}: ${rate.value}\n`;
          });
          response += "\n";
        }

        if (packages.length > 0) {
          response += "📦 PACKAGES:\n";
          packages.forEach(rate => {
            response += `• ${rate.label}: ${rate.value}\n`;
          });
        }

        return response;
      }

      case 'restaurant_menu': {
        const menu = await getMenuItems();
        if (menu.length === 0) {
          return "Our restaurant menu is being updated. Please check back later or visit us in person!";
        }

        let response = "🍽️ Restaurant Menu:\n\n";
        let currentCategory = '';

        menu.forEach(item => {
          if (item.category !== currentCategory) {
            currentCategory = item.category;
            response += `\n${currentCategory.toUpperCase()}:\n`;
          }
          response += `• ${item.name} - ₱${parseFloat(item.price).toLocaleString()}\n`;
        });

        response += "\n🕐 All items prepared fresh! Prep time varies.";
        return response;
      }

      case 'swimming_lessons': {
        const coaches = await getSwimmingCoaches();
        if (coaches.length === 0) {
          return "Our swimming program is currently being organized. Please contact us for more information!";
        }

        let response = "🏊 Swimming Lessons Available!\n\n";
        response += "Our certified coaches:\n\n";

        coaches.forEach(coach => {
          response += `👨‍🏫 ${coach.name}\n`;
          response += `   Specialization: ${coach.specialization}\n`;
          response += `   Experience: ${coach.experience_years} years\n`;
          if (coach.availability) {
            response += `   Available: ${coach.availability}\n`;
          }
          response += `\n`;
        });

        response += "We offer both Group and Private lessons!\n";
        response += "Visit our Swimming Enrollment page to sign up!";
        return response;
      }

      case 'contact_info':
        return "📞 Contact Us:\n\n" +
          "📍 Location: Eduardo's Resort, [Your Address]\n" +
          "📧 Email: info@eduardosresort.com\n" +
          "📱 Phone: [Your Phone Number]\n" +
          "⏰ Hours: 24/7 for guests, Office: 8AM-6PM\n\n" +
          "Visit our Contact page for more details!";

      case 'booking_info':
        return "📅 How to Book:\n\n" +
          "1. Visit our Booking page on the website\n" +
          "2. Choose your dates and room type\n" +
          "3. Fill out the booking form\n" +
          "4. Submit and wait for confirmation\n\n" +
          "💡 Or call us directly to book!\n" +
          "💡 Walk-ins are also welcome (subject to availability)\n\n" +
          "Don't forget to use promo codes for discounts!";

      case 'amenities':
        return "🌟 Our Amenities:\n\n" +
          "🏊 Swimming Pool\n" +
          "🍽️ Restaurant\n" +
          "🏖️ Beach Access\n" +
          "🎤 Videoke Rooms\n" +
          "🏛️ Function Hall\n" +
          "🅿️ Parking Area\n" +
          "📶 WiFi Available\n\n" +
          "Visit our Amenities page to see more!";

      default:
        return "I'm not sure I understand that. 🤔\n\n" +
          "You can ask me about:\n" +
          "• Available rooms and cottages\n" +
          "• Rates and prices\n" +
          "• Current promos\n" +
          "• Restaurant menu\n" +
          "• Swimming lessons\n" +
          "• How to book\n\n" +
          "What would you like to know?";
    }
  } catch (error) {
    logSystemEvent('CHATBOT_GENERATE_RESPONSE_ERROR', { message: error.message });
    return "Sorry, may technical issue ako ngayon. Please try again or contact our staff directly. 😊";
  }
}

// Main chat endpoint
export const chat = async (req, res) => {
  try {
    const { message } = req.body;
    const usedGroqFallback = req.get('X-Chat-Fallback') === 'groq-unavailable';

    if (usedGroqFallback) {
      logSystemEvent(
        'CHATBOT_GROQ_FALLBACK_USED',
        {
          ip_address: req.ip,
          message_length: typeof message === 'string' ? message.length : 0,
          ...(isProduction ? {} : { message_preview: String(message || '').slice(0, 80) }),
        },
        'info',
      );
    }

    // Analyze user intent
    const analysis = analyzeIntent(message);

    // Generate appropriate response
    const reply = await generateResponse(analysis.intent, analysis.entities);

    res.json({
      reply,
      intent: analysis.intent,
      timestamp: new Date()
    });

  } catch (error) {
    logSystemEvent('CHATBOT_FALLBACK_ERROR', { message: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to process chat request',
      reply: 'Sorry, may problema ako ngayon. Please try again later! 😊',
    });
  }
};

// Get chatbot statistics (optional - for admin)
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
    logSystemEvent('CHATBOT_STATS_ERROR', { message: error.message });
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
};
