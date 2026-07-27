import db from '../config/db.js';
import { logSystemEvent } from '../utils/logger.js';

const DEFAULT_TTL_MS = 3 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 5 * 60 * 1000;

const parseCacheTtlMs = () => {
  const parsed = Number.parseInt(process.env.CHATBOT_CONTEXT_CACHE_TTL_SECONDS, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_MS;
  }
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, parsed * 1000));
};

let cachedContext = null;
let cacheExpiresAt = 0;
let inflightFetch = null;

async function fetchResortContextFromDb() {
  const [rooms] = await db.query(
    'SELECT item_id, category, category_type, room_number, name, description, max_guests, price, status FROM inventory_items WHERE category = "Room" ORDER BY price ASC',
  );

  const [cottages] = await db.query(
    'SELECT item_id, category, category_type, room_number, name, description, max_guests, price, status FROM inventory_items WHERE category = "Cottage" ORDER BY price ASC',
  );

  const [entrancerates] = await db.query(
    `SELECT id, name, day_type, price, age_min, age_max, start_time, end_time, status
     FROM entrance_rates
     ORDER BY FIELD(day_type, 'weekday', 'weekend', 'holiday'), price ASC`,
  );

  const [menu] = await db.query(
    'SELECT name, price, category, available, description FROM menu_items WHERE available = TRUE ORDER BY category, name',
  );

  const [coaches] = await db.query(
    'SELECT name, specialization, experience_years, certification, availability FROM swimming_coaches WHERE status = "Active"',
  );

  const [promos] = await db.query(
    'SELECT * FROM promos WHERE endDate >= CURDATE() ORDER BY value DESC',
  );

  return {
    rooms,
    cottages,
    entrancerates,
    menu,
    coaches,
    promos,
  };
}

export async function getCachedResortContext() {
  const now = Date.now();

  if (cachedContext && cacheExpiresAt > now) {
    return { data: cachedContext, cacheHit: true };
  }

  if (!inflightFetch) {
    inflightFetch = (async () => {
      try {
        const data = await fetchResortContextFromDb();
        cachedContext = data;
        cacheExpiresAt = Date.now() + parseCacheTtlMs();
        logSystemEvent(
          'CHATBOT_CONTEXT_CACHE_REFRESH',
          { ttl_ms: parseCacheTtlMs() },
          'info',
        );
        return data;
      } finally {
        inflightFetch = null;
      }
    })();
  }

  try {
    const data = await inflightFetch;
    return { data, cacheHit: false };
  } catch (error) {
    logSystemEvent('CHATBOT_RESORT_CONTEXT_ERROR', { message: error.message });
    if (cachedContext) {
      return { data: cachedContext, cacheHit: true, stale: true };
    }
    return { data: null, cacheHit: false };
  }
}

export function clearChatbotResortContextCache() {
  cachedContext = null;
  cacheExpiresAt = 0;
}
