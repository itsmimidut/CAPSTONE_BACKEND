import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'website-config');

const PAGE_KEY = 'amenities';
const ALLOWED_PAGE_KEYS = new Set([
    'amenities',
    'landing',
    'home',
    'swimming',
    'gallery',
    'about',
    'rates',
    'contact'
]);

const defaultAmenitiesConfig = {
    hero: {
        badge: "Eduardo's Resort",
        titleLine1: 'World-Class',
        titleLine2: 'Amenities',
        subtitle:
            'From Olympic-sized pools to elegant dining and air-conditioned cottages - every detail is crafted for your ultimate relaxation, joy, and unforgettable memories.',
        backgroundImage: 'https://www.eduardosresort.com/images/IMG_4224.JPG'
    },
    categories: [
        {
            id: 'pools',
            heading: 'Aquatic Paradise',
            listText: 'MINI-OLYMPIC SIZE SWIMMING POOL • KIDDIE POOL w/ SLIDE • SWIMMING CLUB',
            cards: [
                {
                    title: 'Mini-Olympic Size Swimming Pool',
                    description:
                        'Dive into our expansive pool with crystal-clear, temperature-controlled water. Perfect for laps, family swims, or floating under the tropical sun.',
                    images: ['/images/img1.jpg', '/images/img3.jpg', '/images/img5.jpg'],
                    bookable: false,
                    buttonLink: '/reservation'
                },
                {
                    title: 'Kiddie Pool w/ Slide',
                    description:
                        'A colorful, shallow splash zone with a twisting slide designed just for little ones. Safe, supervised, and endlessly entertaining.',
                    images: ['/images/img1.jpg', '/images/img2.jpg'],
                    bookable: false,
                    buttonLink: '/reservation'
                },
                {
                    title: 'Swimming Club',
                    description:
                        'Join exclusive aqua-aerobics, swim lessons, or friendly competitions. Certified coaches ensure fun and fitness for all ages.',
                    images: ['/images/img7.jpg', '/images/img1.jpg'],
                    bookable: false,
                    buttonLink: '/reservation'
                }
            ]
        },
        {
            id: 'comfort',
            heading: 'Luxury Comfort & Dining',
            listText: 'BAR and RESTAURANT • FUNCTION HALL • AIR CONDITIONED ROOMS',
            cards: [
                {
                    title: 'Bar and Restaurant',
                    description:
                        'Savor tropical cocktails and gourmet Filipino-international fusion dishes while overlooking the pools. Open from sunrise to midnight.',
                    images: [
                        '/images/img8.jpg',
                        'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80'
                    ],
                    bookable: false,
                    buttonLink: '/reservation'
                },
                {
                    title: 'Function Hall',
                    description:
                        'Elegant, air-conditioned venue for weddings, corporate events, or birthdays. State-of-the-art AV and catering services included.',
                    images: [
                        'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80',
                        'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=800&q=80'
                    ],
                    bookable: false,
                    buttonLink: '/reservation'
                },
                {
                    title: 'Air-Conditioned Cottages',
                    description:
                        'Private, stylish cottages with plush beds, en-suite bathrooms, and scenic views. Your serene home-away-from-home.',
                    images: [
                        'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80',
                        '/images/img10.jpg'
                    ],
                    bookable: true,
                    buttonLink: '/reservation'
                }
            ]
        }
    ],
    cta: {
        buttonText: 'Book Your Experience Today',
        buttonLink: '/reservation',
        helperText:
            'Experience world-class amenities designed for unforgettable moments with family and friends.'
    }
};

const defaultImagePageConfig = (pageKey) => ({
    pageKey,
    heroImage: '',
    images: []
});

const getDefaultConfigByPageKey = (pageKey) => {
    if (pageKey === PAGE_KEY) return defaultAmenitiesConfig;
    return defaultImagePageConfig(pageKey);
};

const ensureConfigTable = async () => {
    await db.query(`
    CREATE TABLE IF NOT EXISTS website_configs (
      config_id INT AUTO_INCREMENT PRIMARY KEY,
      page_key VARCHAR(120) NOT NULL UNIQUE,
      config_json LONGTEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
};

const parseConfig = (row) => {
    if (!row?.config_json) return null;
    try {
        return JSON.parse(row.config_json);
    } catch {
        return null;
    }
};

export const getAmenitiesConfig = async (req, res) => {
    try {
        await ensureConfigTable();

        const [rows] = await db.query(
            'SELECT config_json, updated_at FROM website_configs WHERE page_key = ? LIMIT 1',
            [PAGE_KEY]
        );

        const parsed = parseConfig(rows[0]);

        res.json({
            success: true,
            pageKey: PAGE_KEY,
            config: parsed || defaultAmenitiesConfig,
            updatedAt: rows[0]?.updated_at || null,
            isDefault: !parsed
        });
    } catch (error) {
        console.error('Error fetching amenities config:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch amenities config' });
    }
};

export const getPageConfig = async (req, res) => {
    try {
        await ensureConfigTable();

        const pageKey = String(req.params.pageKey || '').trim().toLowerCase();
        if (!ALLOWED_PAGE_KEYS.has(pageKey)) {
            return res.status(400).json({ success: false, message: 'Unsupported page key' });
        }

        const [rows] = await db.query(
            'SELECT config_json, updated_at FROM website_configs WHERE page_key = ? LIMIT 1',
            [pageKey]
        );

        const parsed = parseConfig(rows[0]);

        res.json({
            success: true,
            pageKey,
            config: parsed || getDefaultConfigByPageKey(pageKey),
            updatedAt: rows[0]?.updated_at || null,
            isDefault: !parsed
        });
    } catch (error) {
        console.error('Error fetching website page config:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch page config' });
    }
};

export const saveAmenitiesConfig = async (req, res) => {
    try {
        await ensureConfigTable();

        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid config payload' });
        }

        const configJson = JSON.stringify(config);

        await db.query(
            `INSERT INTO website_configs (page_key, config_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = CURRENT_TIMESTAMP`,
            [PAGE_KEY, configJson]
        );

        res.json({ success: true, message: 'Amenities configuration saved successfully' });
    } catch (error) {
        console.error('Error saving amenities config:', error);
        res.status(500).json({ success: false, message: 'Failed to save amenities config' });
    }
};

export const savePageConfig = async (req, res) => {
    try {
        await ensureConfigTable();

        const pageKey = String(req.params.pageKey || '').trim().toLowerCase();
        if (!ALLOWED_PAGE_KEYS.has(pageKey)) {
            return res.status(400).json({ success: false, message: 'Unsupported page key' });
        }

        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid config payload' });
        }

        const configJson = JSON.stringify(config);

        await db.query(
            `INSERT INTO website_configs (page_key, config_json)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = CURRENT_TIMESTAMP`,
            [pageKey, configJson]
        );

        res.json({ success: true, message: `${pageKey} configuration saved successfully` });
    } catch (error) {
        console.error('Error saving page config:', error);
        res.status(500).json({ success: false, message: 'Failed to save page config' });
    }
};

export const uploadWebsiteConfigImage = async (req, res) => {
    try {
        const { imageData, fileName } = req.body;

        if (!imageData || typeof imageData !== 'string') {
            return res.status(400).json({ success: false, message: 'imageData is required' });
        }

        const match = imageData.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
        if (!match) {
            return res.status(400).json({ success: false, message: 'Invalid image data format' });
        }

        const mimeType = match[1].toLowerCase();
        const base64Body = match[3];
        const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
        const safeBaseName = String(fileName || 'website-image')
            .replace(/\.[^/.]+$/, '')
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .slice(0, 40) || 'website-image';

        await fs.mkdir(uploadsDir, { recursive: true });

        const generatedName = `${safeBaseName}-${Date.now()}.${ext}`;
        const diskPath = path.join(uploadsDir, generatedName);

        await fs.writeFile(diskPath, Buffer.from(base64Body, 'base64'));

        res.json({
            success: true,
            url: `/uploads/website-config/${generatedName}`,
            fileName: generatedName
        });
    } catch (error) {
        console.error('Error uploading website config image:', error);
        res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
};
