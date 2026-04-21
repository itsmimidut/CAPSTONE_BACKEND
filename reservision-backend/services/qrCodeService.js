import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

/**
 * QR Code Generation Service
 * Generates QR codes containing booking information
 */

// Ensure qr_codes directory exists
const QR_DIR = './public/qr_codes';
if (!fs.existsSync(QR_DIR)) {
    fs.mkdirSync(QR_DIR, { recursive: true });
}

/**
 * Generate QR Code for Booking
 * QR Code contains: Booking Reference, Guest Name, Items Booked
 * 
 * @param {Object} bookingData - Booking information
 * @param {string} bookingData.bookingReference - Booking reference (e.g., EDU-2026-001234)
 * @param {string} bookingData.guestName - Guest full name
 * @param {Array} bookingData.items - Array of booked items with names
 * @returns {Object} - { filename, path, base64 }
 */
export const generateQRCode = async (bookingData) => {
    try {
        const { bookingReference, guestName, items } = bookingData;

        // Create QR code data with all required information
        const qrData = {
            bookingReference,
            guestName,
            items: items.map(item => ({
                name: item.item_name || item.name,
                quantity: item.quantity || item.qty,
                type: item.item_type || item.category || 'Item'
            })),
            generatedAt: new Date().toISOString()
        };

        // Convert to JSON string for QR code
        const qrString = JSON.stringify(qrData);

        // Generate filename with timestamp
        const filename = `${bookingReference}_${Date.now()}.png`;
        const filepath = path.join(QR_DIR, filename);

        // Generate QR code as image file
        await QRCode.toFile(filepath, qrString, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: 300,
            margin: 2,
            color: {
                dark: '#2B6CB0', // Primary blue
                light: '#FFFFFF'
            }
        });

        // Also generate base64 for embedding in emails
        const base64 = await QRCode.toDataURL(qrString, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: 250,
            margin: 2,
            color: {
                dark: '#2B6CB0',
                light: '#FFFFFF'
            }
        });

        console.log(`✅ QR Code generated: ${filename}`);

        return {
            filename,
            filepath,
            url: `/public/qr_codes/${filename}`,
            base64, // For embedding in email HTML
            qrData: qrData
        };

    } catch (error) {
        console.error('QR Code generation error:', error);
        throw new Error(`Failed to generate QR code: ${error.message}`);
    }
};

/**
 * Format booking data for QR code generation
 * Takes booking and items from database and formats for QR
 * 
 * @param {Object} booking - Booking object from database
 * @param {Array} bookingItems - Array of booking items from database
 * @returns {Object} - Formatted data for QR generation
 */
export const formatBookingDataForQR = (booking, bookingItems) => {
    return {
        bookingReference: booking.booking_reference,
        guestName: `${booking.first_name || ''} ${booking.last_name || ''}`.trim(),
        items: bookingItems.map(item => ({
            item_name: item.item_name,
            quantity: item.quantity,
            item_type: item.item_type,
            category: item.item_type
        }))
    };
};

/**
 * Get QR code by booking reference (retrieve generated QR)
 * 
 * @param {string} bookingReference - Booking reference
 * @returns {string|null} - Base64 QR code or null if not found
 */
export const getQRCodeByReference = async (bookingReference) => {
    try {
        const files = fs.readdirSync(QR_DIR);
        const qrFiles = files.filter(f => f.startsWith(bookingReference));

        if (qrFiles.length === 0) return null;

        // Get most recent QR file
        const latestFile = qrFiles.sort().pop();
        const filepath = path.join(QR_DIR, latestFile);
        const fileBuffer = fs.readFileSync(filepath);
        const base64 = fileBuffer.toString('base64');

        return `data:image/png;base64,${base64}`;

    } catch (error) {
        console.error('Error retrieving QR code:', error);
        return null;
    }
};

/**
 * Create QR code HTML for email
 * 
 * @param {string} base64QR - Base64 encoded QR code
 * @returns {string} - HTML string with QR code
 */
export const createQRHTML = (base64QR) => {
    return `
    <div style="text-align: center; margin: 20px 0; padding: 15px; background-color: #f8fbff; border-radius: 8px;">
      <h3 style="margin: 0 0 10px 0; color: #2b6cb0; font-size: 16px;">Your Booking QR Code</h3>
      <img src="${base64QR}" alt="Booking QR Code" style="width: 200px; height: 200px; border-radius: 8px;" />
      <p style="margin: 10px 0 0 0; font-size: 12px; color: #718096;">Scan with your phone to view booking details</p>
    </div>
  `;
};
