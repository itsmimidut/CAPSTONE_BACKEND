import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public');

const GS = 0x1d;
const ESC = 0x1b;

/** In-memory cache: absolutePath:mtimeMs:maxWidth -> Buffer */
const rasterCache = new Map();

/**
 * Resolve a receipt logo path from DB (/uploads/receipts/...) to an absolute file path.
 */
export function resolveLogoAbsolutePath(logoPath) {
  const raw = String(logoPath || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    // Remote URLs are not fetched for thermal print in MVP.
    return null;
  }

  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    return raw;
  }

  const relative = raw.replace(/^[\\/]+/, '').replace(/^public[\\/]/i, '');
  const absolute = path.join(PUBLIC_ROOT, relative);
  if (fs.existsSync(absolute)) return absolute;

  // Also try as path under project root (legacy)
  const alt = path.resolve(__dirname, '..', relative);
  if (fs.existsSync(alt)) return alt;

  return null;
}

/**
 * Max printable width in dots for common thermal paper sizes (203 dpi).
 */
export function maxLogoWidthForPaper(paperWidth = '58') {
  const w = String(paperWidth || '58');
  if (w === '80') return 576;
  if (w === '72') return 512;
  return 384; // 58mm
}

/**
 * Convert RGBA image data to ESC/POS GS v 0 raster bitmap.
 * m=0 normal size.
 */
function rgbaToEscPosRaster(width, height, rgba, threshold = 180) {
  const widthBytes = Math.ceil(width / 8);
  const data = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const a = rgba[idx + 3];

      // Transparent / near-white pixels stay white (0). Dark pixels print black (1).
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBlack = a >= 128 && luminance < threshold;

      if (isBlack) {
        const byteIndex = y * widthBytes + (x >> 3);
        data[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  // GS v 0 m xL xH yL yH [data]
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]),
    data,
  ]);
}

/**
 * Build centered ESC/POS logo command buffer from a local image file.
 * Returns null if logo cannot be loaded (caller should fall back to text-only).
 */
export async function buildEscPosLogoRaster(logoPath, options = {}) {
  const absolute = resolveLogoAbsolutePath(logoPath);
  if (!absolute) return null;

  const maxWidth = Math.max(
    64,
    Math.min(576, Number(options.maxWidth) || maxLogoWidthForPaper(options.paperWidth) || 384)
  );
  const threshold = Number(options.threshold) || 180;
  const maxHeight = Math.max(32, Math.min(400, Number(options.maxHeight) || 160));
  const alignment = String(options.alignment || 'center').toLowerCase();
  const alignByte = alignment === 'left' ? 0x00 : alignment === 'right' ? 0x02 : 0x01;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(absolute).mtimeMs;
  } catch {
    return null;
  }

  const cacheKey = `${absolute}:${mtimeMs}:${maxWidth}:${maxHeight}:${threshold}:${alignByte}`;
  if (rasterCache.has(cacheKey)) {
    return rasterCache.get(cacheKey);
  }

  try {
    const image = await Jimp.read(absolute);

    // Fit within max box, keep aspect ratio.
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const targetW = Math.max(1, Math.floor(image.width * scale));
    const targetH = Math.max(1, Math.floor(image.height * scale));

    // Width must be multiple of 8 for clean packing (pad by resizing up slightly if needed).
    const packedW = Math.ceil(targetW / 8) * 8;
    image.resize({ w: packedW, h: targetH });
    image.greyscale();

    const { width, height, data } = image.bitmap;
    const raster = rgbaToEscPosRaster(width, height, data, threshold);

    const full = Buffer.concat([
      Buffer.from([ESC, 0x61, alignByte]),
      raster,
      Buffer.from([0x0a]),
      Buffer.from([ESC, 0x61, 0x00]),
    ]);

    // Bound cache size
    if (rasterCache.size > 32) {
      const firstKey = rasterCache.keys().next().value;
      rasterCache.delete(firstKey);
    }
    rasterCache.set(cacheKey, full);
    return full;
  } catch (error) {
    console.warn('[escposLogo] Failed to rasterize logo:', error.message);
    return null;
  }
}

export function clearEscPosLogoCache() {
  rasterCache.clear();
}

export default {
  buildEscPosLogoRaster,
  resolveLogoAbsolutePath,
  maxLogoWidthForPaper,
  clearEscPosLogoCache,
};
