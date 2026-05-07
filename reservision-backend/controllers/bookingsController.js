/**
 * ============================================================
 * Bookings Controller
 * ============================================================
 * 
 * Purpose:
 * - Handle all booking-related operations
 * - Manage customer reservations for rooms, cottages, events, and food
 * - Track occupied dates to prevent double bookings
 * - Generate booking references
 * 
 * Dependencies:
 * - db: Database connection pool
 * 
 * Endpoints:
 * - GET /api/bookings - Get all bookings
 * - GET /api/bookings/:id - Get single booking with items
 * - POST /api/bookings - Create new booking
 * - PUT /api/bookings/:id - Update booking
 * - DELETE /api/bookings/:id - Cancel booking
 * - GET /api/bookings/occupied-dates/:itemId - Get occupied dates for item
 * - GET /api/bookings/reference/:reference - Get booking by reference
 */

import db from "../config/db.js";
import { sendBookingApprovalEmail } from "../services/emailService.js";
import { getQRCodeByReference } from "../services/qrCodeService.js";
import {
  autoAssignRoom,
  validateBookingDates,
  generateBookingReference as generateRef
} from "../services/roomAssignmentService.js";

/**
 * Generate unique booking reference
 * Format: BK + YYYYMMDD + XXX (sequential number)
 */
const generateBookingReference = async () => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Get count of bookings today
  const [rows] = await db.query(
    `SELECT COUNT(*) as count FROM bookings WHERE DATE(created_at) = CURDATE()`
  );

  const count = rows[0].count + 1;
  const sequential = String(count).padStart(3, '0');

  return `BK${dateStr}${sequential}`;
};

// Simple in-memory cache for admin reservations list.
// TTL is 60 seconds to reduce repeated DB reads while keeping data reasonably fresh.
const RESERVATION_CACHE_TTL_MS = 60 * 1000;
const reservationResponseCache = new Map();

const buildReservationCacheKey = (query = {}) => {
  const params = new URLSearchParams();

  // Cache key includes page, limit, status, search, from, and to as required.
  // Support both from/to and startDate/endDate to align frontend/backend param naming.
  const from = query.from || query.startDate || '';
  const to = query.to || query.endDate || '';

  params.set('page', String(query.page ?? 1));
  params.set('limit', String(query.limit ?? 15));
  params.set('status', String(query.status ?? ''));
  params.set('search', String(query.search ?? ''));
  params.set('from', String(from));
  params.set('to', String(to));

  return `admin_reservations:${params.toString()}`;
};

const getCachedReservationResponse = (key) => {
  const cached = reservationResponseCache.get(key);
  if (!cached) {
    return null; // Cache miss: no entry for this query key.
  }

  if (cached.expiresAt <= Date.now()) {
    reservationResponseCache.delete(key); // TTL expired: remove stale entry.
    return null;
  }

  return cached.payload; // Cache hit: return cached response payload.
};

const setCachedReservationResponse = (key, payload) => {
  reservationResponseCache.set(key, {
    payload,
    expiresAt: Date.now() + RESERVATION_CACHE_TTL_MS // Cache set with 60-second TTL.
  });
};

const invalidateReservationCache = () => {
  // Invalidation: clear all reservation-related cache entries after any data mutation.
  reservationResponseCache.clear();
};

/**
 * GET /api/bookings
 * Get all bookings with optional filters
 */
export const getBookings = async (req, res) => {
  try {
    const { status, email, startDate, endDate, limit = 100 } = req.query;

    let query = `
      SELECT 
        b.*,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        p.payment_reference,
        COUNT(bi.item_id) as item_count,
        GROUP_CONCAT(bi.item_name SEPARATOR ', ') as items_summary
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }

    if (email) {
      query += ` AND c.email LIKE ?`;
      params.push(`%${email}%`);
    }

    if (startDate) {
      query += ` AND b.check_in_date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND b.check_out_date <= ?`;
      params.push(endDate);
    }

    query += ` 
      GROUP BY b.booking_id
      ORDER BY b.created_at DESC
      LIMIT ?
    `;
    params.push(parseInt(limit));

    const [bookings] = await db.query(query, params);

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
};

/**
 * GET /api/bookings/:id
 * Get single booking with all items
 */
export const getBooking = async (req, res) => {
  try {
    const { id } = req.params;

    // Get booking details with customer info
    const [bookings] = await db.query(
      `SELECT 
        b.*,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.address,
        c.city,
        c.country,
        c.postal_code
      FROM bookings b
      LEFT JOIN user c ON b.customer_id = c.user_id
      WHERE b.booking_id = ?`,
      [id]
    );

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Get booking items
    const [items] = await db.query(
      `SELECT * FROM booking_items WHERE booking_id = ?`,
      [id]
    );

    booking.items = items;

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking',
      error: error.message
    });
  }
};

/**
 * GET /api/bookings/reference/:reference
 * Get booking by reference number
 */
export const getBookingByReference = async (req, res) => {
  try {
    const { reference } = req.params;

    // Get booking details
    const [bookings] = await db.query(
      `SELECT * FROM bookings WHERE booking_reference = ?`,
      [reference]
    );

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Get booking items
    const [items] = await db.query(
      `SELECT * FROM booking_items WHERE booking_id = ?`,
      [booking.booking_id]
    );

    booking.items = items;

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Error fetching booking by reference:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking',
      error: error.message
    });
  }
};

/**
 * POST /api/bookings
 * Create new booking
 */
export const createBooking = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      customer,
      contact,
      checkIn,
      checkOut,
      nights,
      adults,
      children,
      items,
      specialRequests,
      total,
      subtotal,
      promoCode
    } = req.body;

    // Validate required fields
    if (!customer || !contact || !items || items.length === 0) {
      throw new Error('Missing required fields');
    }

    // Generate booking reference
    const bookingReference = await generateBookingReference();

    // --- AVAILABILITY CHECK ---
    // For each per-night item with an inventory_item_id, ensure no occupied_dates exist
    if (checkIn && checkOut && items && items.length) {
      const startIso = new Date(checkIn).toISOString().slice(0, 10);
      const endIso = new Date(checkOut).toISOString().slice(0, 10);

      for (const item of items) {
        if (item.item && item.item.perNight && item.item.item_id) {
          const requestedQty = Number(item.qty || 1)
          if (requestedQty > 1) {
            throw new Error(`Quantity greater than 1 is not allowed for room/cottage inventory item "${item.item.name || item.item.item_id}".`)
          }

          // Query occupied_dates for any date in [checkIn, checkOut) for this inventory item
          const [rows] = await connection.query(
            `SELECT COUNT(*) as cnt FROM occupied_dates
             WHERE inventory_item_id = ?
             AND occupied_date >= ?
             AND occupied_date < ?`,
            [item.item.item_id, startIso, endIso]
          );

          const occupiedCount = rows[0].cnt || 0;

          if (occupiedCount > 0) {
            throw new Error(`Item \"${item.item.name || item.item.title || item.item.room_number || item.item.item_id}\" is not available for the selected dates (${startIso} to ${endIso}).`);
          }
        }
      }
    }

    // Insert booking
    const [bookingResult] = await connection.query(
      `INSERT INTO bookings (
        booking_reference,
        first_name,
        last_name,
        email,
        phone,
        address,
        city,
        country,
        postal_code,
        check_in_date,
        check_out_date,
        nights,
        adults,
        children,
        special_requests,
        subtotal,
        total,
        promo_code,
        booking_status,
        payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Unpaid')`,
      [
        bookingReference,
        customer.firstName,
        customer.lastName,
        contact.email,
        contact.phone,
        contact.address,
        contact.city,
        contact.country || 'Philippines',
        contact.postal,
        checkIn || null,
        checkOut || null,
        nights || 0,
        adults || 2,
        children || 0,
        specialRequests || null,
        subtotal || total,
        total,
        promoCode || null
      ]
    );

    const bookingId = bookingResult.insertId;

    // Insert booking items
    for (const item of items) {
      const [itemResult] = await connection.query(
        `INSERT INTO booking_items (
          booking_id,
          item_type,
          item_name,
          item_description,
          inventory_item_id,
          batch_id,
          schedule_id,
          unit_price,
          quantity,
          nights,
          total_price,
          guests,
          per_night
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          item.item.category || 'Room',
          item.item.name,
          item.item.desc || item.item.description,
          item.item.item_id || null,
          item.item.batch_id || null,
          item.item.schedule_id || null,
          item.item.price,
          item.qty || 1,
          item.item.perNight ? (nights || 0) : 0,
          item.item.perNight ? (item.item.price * item.qty * nights) : (item.item.price * item.qty),
          item.guests || adults,
          item.item.perNight || false
        ]
      );

      // If item is a room/cottage and has check-in/out dates, create occupied dates
      if (item.item.perNight && checkIn && checkOut && item.item.item_id) {
        const start = new Date(checkIn);
        const end = new Date(checkOut);

        // Generate occupied dates for each day
        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          await connection.query(
            `INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date)
             VALUES (?, ?, ?)`,
            [item.item.item_id, bookingId, d.toISOString().slice(0, 10)]
          );
        }
      }
    }

    // Create booking log
    await connection.query(
      `INSERT INTO booking_logs (booking_id, action, new_status, description, performed_by)
       VALUES (?, 'Created', 'Pending', 'Booking created by customer', 'System')`,
      [bookingId]
    );

    await connection.commit();

    // Fetch complete booking data
    const [newBooking] = await connection.query(
      `SELECT * FROM bookings WHERE booking_id = ?`,
      [bookingId]
    );

    const [bookingItems] = await connection.query(
      `SELECT * FROM booking_items WHERE booking_id = ?`,
      [bookingId]
    );

    newBooking[0].items = bookingItems;

    // Invalidate reservation cache after create so listing endpoints return fresh data.
    invalidateReservationCache();

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: newBooking[0]
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * PUT /api/bookings/:id
 * Update booking status or details
 */
export const updateBooking = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const updates = req.body;

    // Check if booking exists
    const [existing] = await connection.query(
      `SELECT * FROM bookings WHERE booking_id = ?`,
      [id]
    );

    if (existing.length === 0) {
      throw new Error('Booking not found');
    }

    const oldBooking = existing[0];

    // Build update query dynamically
    const allowedFields = [
      'booking_status',
      'payment_status',
      'payment_method',
      'special_requests'
    ];

    const setClause = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);

    await connection.query(
      `UPDATE bookings SET ${setClause.join(', ')} WHERE booking_id = ?`,
      values
    );

    // Create booking log
    if (updates.booking_status && updates.booking_status !== oldBooking.booking_status) {
      await connection.query(
        `INSERT INTO booking_logs (booking_id, action, old_status, new_status, description, performed_by)
         VALUES (?, 'Status Updated', ?, ?, 'Status changed', 'Admin')`,
        [id, oldBooking.booking_status, updates.booking_status]
      );
    }

    await connection.commit();

    // Fetch updated booking with customer and items info
    const [updated] = await connection.query(
      `SELECT 
        b.*,
        c.first_name,
        c.last_name,
        c.email
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      WHERE b.booking_id = ?`,
      [id]
    );

    const updatedBooking = updated[0];

    // If booking was confirmed, send approval email
    if (updates.booking_status === 'Confirmed' &&
      updates.booking_status !== oldBooking.booking_status &&
      updatedBooking.email) {

      console.log('========================================');
      console.log('📧 BOOKING CONFIRMED - Preparing to send approval email');
      console.log('Recipient:', updatedBooking.email);
      console.log('Booking Reference:', updatedBooking.booking_reference);
      console.log('Customer Name:', `${updatedBooking.first_name} ${updatedBooking.last_name}`);

      // Fetch booking items for email
      const [items] = await connection.query(
        `SELECT item_name as name, quantity as qty, guests, unit_price as price
         FROM booking_items 
         WHERE booking_id = ?`,
        [id]
      );

      console.log('Booking Items:', items);

      // Send approval email asynchronously (don't wait for it)
      sendBookingApprovalEmail(updatedBooking.email, {
        bookingReference: updatedBooking.booking_reference,
        firstName: updatedBooking.first_name || 'Guest',
        lastName: updatedBooking.last_name || '',
        checkIn: updatedBooking.check_in_date,
        checkOut: updatedBooking.check_out_date,
        items: items,
        total: parseFloat(updatedBooking.total)
      }).then(result => {
        console.log('✅ Approval email sent successfully!', result);
        console.log('========================================');
      }).catch(err => {
        console.error('❌ Failed to send approval email:', err);
        console.error('Error details:', err.message);
        console.error('========================================');
        // Continue even if email fails
      });
    } else {
      console.log('⚠️ Approval email NOT sent. Conditions:');
      console.log('- Status changed to Confirmed?', updates.booking_status === 'Confirmed');
      console.log('- Status different from old?', updates.booking_status !== oldBooking.booking_status);
      console.log('- Email exists?', !!updatedBooking.email);
      console.log('- Old status:', oldBooking.booking_status);
      console.log('- New status:', updates.booking_status);
    }

    // Invalidate reservation cache after confirm/cancel/update mutations.
    invalidateReservationCache();

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: updatedBooking
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * DELETE /api/bookings/:id
 * Cancel/delete booking
 */
export const deleteBooking = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Check if booking exists
    const [existing] = await connection.query(
      `SELECT * FROM bookings WHERE booking_id = ?`,
      [id]
    );

    if (existing.length === 0) {
      throw new Error('Booking not found');
    }

    // Create cancellation log
    await connection.query(
      `INSERT INTO booking_logs (booking_id, action, old_status, new_status, description, performed_by)
       VALUES (?, 'Cancelled', ?, 'Cancelled', 'Booking cancelled', 'Admin')`,
      [id, existing[0].booking_status]
    );

    // Update status to cancelled instead of deleting
    await connection.query(
      `UPDATE bookings SET booking_status = 'Cancelled' WHERE booking_id = ?`,
      [id]
    );

    // Delete occupied dates
    await connection.query(
      `DELETE FROM occupied_dates WHERE booking_id = ?`,
      [id]
    );

    await connection.commit();

    // Invalidate reservation cache after delete/cancel mutation.
    invalidateReservationCache();

    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * GET /api/bookings/admin/reservations
 * Get all reservations for admin management page
 * Includes customer details, booking items, and payment info
 */


export const getAdminReservations = async (req, res) => {
  try {
    const {
      status,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 15
    } = req.query;

    const cacheKey = buildReservationCacheKey(req.query);
    const cachedPayload = getCachedReservationResponse(cacheKey);

    const hasBookingColumn = async (columnName) => {
      const [columns] = await db.query(`SHOW COLUMNS FROM bookings LIKE ?`, [columnName]);
      return Array.isArray(columns) && columns.length > 0;
    }

    const hasEntranceFee = await hasBookingColumn('entrance_fee');
    const hasExtraPersonFee = await hasBookingColumn('extra_person_fee');
    const entranceFeeSelect = hasEntranceFee ? 'COALESCE(b.entrance_fee, 0) AS entrance_fee,' : '0 AS entrance_fee,';
    const extraPersonFeeSelect = hasExtraPersonFee ? 'COALESCE(b.extra_person_fee, 0) AS extra_person_fee,' : '0 AS extra_person_fee,';

    if (cachedPayload) {
      // Cache hit: return cached response with unchanged structure.
      return res.json(cachedPayload);
    }
    // Cache miss: continue to fetch from DB and cache the computed response.

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.booking_status,
        b.payment_status,
        b.payment_method,
        b.subtotal,
        ${entranceFeeSelect}
        ${extraPersonFeeSelect}
        b.total,
        b.created_at,
        c.customer_id,
        COALESCE(NULLIF(TRIM(c.first_name), ''), NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(b.first_name), '')) as first_name,
        COALESCE(NULLIF(TRIM(c.last_name), ''), NULLIF(TRIM(u.last_name), ''), NULLIF(TRIM(b.last_name), '')) as last_name,
        COALESCE(NULLIF(TRIM(c.email), ''), NULLIF(TRIM(u.email), ''), NULLIF(TRIM(b.email), '')) as email,
        COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(b.phone), '')) as phone,
      MAX(p.payment_reference) as payment_reference,
      MAX(p.amount) as payment_amount,
        GROUP_CONCAT(DISTINCT bi.item_description SEPARATOR '|||') as items_descriptions,
        COUNT(DISTINCT bi.item_id) as item_count
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN user u ON c.user_id = u.user_id
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
      WHERE 1=1
    `;

    const params = [];

    // Filter by status
    if (status && status !== 'all') {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }

    // Search by guest name or email
    if (search) {
      query += ` AND (
        COALESCE(NULLIF(TRIM(c.first_name), ''), NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(b.first_name), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR 
        COALESCE(NULLIF(TRIM(c.last_name), ''), NULLIF(TRIM(u.last_name), ''), NULLIF(TRIM(b.last_name), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR 
        COALESCE(NULLIF(TRIM(c.email), ''), NULLIF(TRIM(u.email), ''), NULLIF(TRIM(b.email), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR
        b.booking_reference COLLATE utf8mb4_unicode_ci LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Filter by date range
    if (startDate) {
      query += ` AND b.check_in_date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND b.check_out_date <= ?`;
      params.push(endDate);
    }

    query += ` 
      GROUP BY b.booking_id, c.customer_id
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), offset);

    // Execute query
    const [reservations] = await db.query(query, params);

    if (reservations.length > 0) {
      const bookingIds = reservations.map(r => r.booking_id)
      const [items] = await db.query(
        `SELECT
           bi.item_id,
           bi.booking_id,
           bi.inventory_item_id,
           bi.item_type,
           bi.item_name,
           bi.quantity,
           bi.unit_price,
           bi.nights,
           bi.total_price,
           bi.guests,
           bi.item_description,
           bi.per_night
         FROM booking_items bi
         WHERE bi.booking_id IN (?)
         ORDER BY bi.booking_id, bi.item_id`,
        [bookingIds]
      )

      const itemsByBooking = items.reduce((acc, item) => {
        if (!acc[item.booking_id]) acc[item.booking_id] = []
        acc[item.booking_id].push({
          item_id: item.item_id,
          inventory_item_id: item.inventory_item_id,
          item_name: item.item_name,
          category: item.item_type,
          category_type: item.item_type,
          quantity: item.quantity,
          price: Number(item.unit_price || 0),
          nights: item.nights || 0,
          duration_hours: 0,
          capacity: null,
          location: null,
          line_total: Number(item.total_price || 0),
          guests: item.guests || 0,
          guest_breakdown: null,
          paying_guests: item.guests || 0,
          entrance_fee: 0,
          extra_person_fee: 0,
          extra_person_breakdown: null
        })
        return acc
      }, {})

      reservations.forEach(reservation => {
        reservation.items_details = itemsByBooking[reservation.booking_id] || []
      })
    }

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT b.booking_id) as total
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN user u ON c.user_id = u.user_id
      WHERE 1=1
    `;

    const countParams = [];

    if (status && status !== 'all') {
      countQuery += ` AND b.booking_status = ?`;
      countParams.push(status);
    }

    if (search) {
      countQuery += ` AND (
        COALESCE(NULLIF(TRIM(c.first_name), ''), NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(b.first_name), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR 
        COALESCE(NULLIF(TRIM(c.last_name), ''), NULLIF(TRIM(u.last_name), ''), NULLIF(TRIM(b.last_name), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR 
        COALESCE(NULLIF(TRIM(c.email), ''), NULLIF(TRIM(u.email), ''), NULLIF(TRIM(b.email), '')) COLLATE utf8mb4_unicode_ci LIKE ? OR
        b.booking_reference COLLATE utf8mb4_unicode_ci LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (startDate) {
      countQuery += ` AND b.check_in_date >= ?`;
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ` AND b.check_out_date <= ?`;
      countParams.push(endDate);
    }

    const [countResult] = await db.query(countQuery, countParams);
    const totalCount = countResult[0].total;
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    const responsePayload = {
      success: true,
      data: reservations,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        limit: parseInt(limit)
      }
    };

    // Cache set: store successful response for 60 seconds.
    setCachedReservationResponse(cacheKey, responsePayload);

    res.json(responsePayload);
  } catch (error) {
    console.error('Error fetching admin reservations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reservations',
      error: error.message
    });
  }
};

/**
 * GET /api/bookings/customer/:customerId/history
 * Get all bookings for a specific customer with QR code data
 * Used on customer dashboard / My Reservations page
 */
export const getCustomerBookingHistory = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, limit = 20, page = 1 } = req.query;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      });
    }

    // Get customer info
    const [customers] = await db.query(
      'SELECT * FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customerInfo = customers[0];

    // Build query for bookings
    let query = `
      SELECT 
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.total,
        b.booking_status,
        b.created_at,
        MAX(p.payment_reference) as payment_reference,
        MAX(p.payment_method) as payment_method,
        MAX(p.status) as payment_status,
        MAX(p.paid_at) as paid_at
      FROM bookings b
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      WHERE b.customer_id = ?
      GROUP BY b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date, b.adults, b.children, b.total, b.booking_status, b.created_at
    `;

    const params = [customerId];

    // Optional status filter
    if (status && status !== 'all') {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [bookings] = await db.query(query, params);

    // For each booking, get items and prepare QR data
    const bookingsWithDetails = await Promise.all(
      bookings.map(async (booking) => {
        const [items] = await db.query(
          'SELECT * FROM booking_items WHERE booking_id = ?',
          [booking.booking_id]
        );

        // Generate QR data reference
        const qrReference = `${booking.booking_reference}_${booking.booking_id}`;

        return {
          ...booking,
          items: items.map(item => ({
            item_name: item.item_name,
            quantity: item.quantity,
            item_type: item.item_type,
            unit_price: item.unit_price,
            total_price: item.total_price
          })),
          qrCode: {
            reference: qrReference,
            url: `/api/qr/${booking.booking_reference}` // Endpoint to get QR
          }
        };
      })
    );

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM bookings 
      WHERE customer_id = ?
    `;
    const countParams = [customerId];

    if (status && status !== 'all') {
      countQuery += ` AND booking_status = ?`;
      countParams.push(status);
    }

    const [countResult] = await db.query(countQuery, countParams);
    const totalCount = countResult[0].total;
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        customer: {
          customer_id: customerInfo.customer_id,
          name: `${customerInfo.first_name} ${customerInfo.last_name}`,
          email: customerInfo.email,
          phone: customerInfo.phone
        },
        bookings: bookingsWithDetails,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching customer booking history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking history',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/user/:userId/history
 * Get all bookings for a logged-in customer by their user_id.
 * Most reliable method — no email lookup needed.
 */
export const getBookingHistoryByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = 50, page = 1 } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Get customer_id from customers table via user_id
    const [customerRows] = await db.query(
      `SELECT c.customer_id, u.first_name, u.last_name, u.email, u.phone
       FROM user u
       JOIN customers c ON c.user_id = u.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [userId]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No customer profile found for this user'
      });
    }

    const customerInfo = customerRows[0];
    const customerId = customerInfo.customer_id;

    // Build bookings query
    let query = `
      SELECT
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.total,
        b.booking_status,
        b.created_at,
        LOWER(COALESCE(b.payment_status, 'pending')) as payment_status,
        MAX(p.payment_reference) as payment_reference,
        MAX(p.payment_method) as payment_method,
        MAX(p.paid_at) as paid_at
      FROM bookings b
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      WHERE b.customer_id = ?
      GROUP BY b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date, b.adults, b.children, b.total, b.booking_status, b.created_at, b.payment_status
    `;
    const params = [customerId];

    if (status && status !== 'all') {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC`;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [bookings] = await db.query(query, params);

    const bookingsWithDetails = await Promise.all(
      bookings.map(async (booking) => {
        const [items] = await db.query(
          'SELECT * FROM booking_items WHERE booking_id = ?',
          [booking.booking_id]
        );
        return {
          ...booking,
          items: items.map(item => ({
            item_name: item.item_name,
            quantity: item.quantity,
            item_type: item.item_type,
            unit_price: item.unit_price,
            total_price: item.total_price
          })),
          qrCode: { reference: booking.booking_reference }
        };
      })
    );

    let countQuery = `SELECT COUNT(*) as total FROM bookings WHERE customer_id = ?`;
    const countParams = [customerId];
    if (status && status !== 'all') {
      countQuery += ` AND booking_status = ?`;
      countParams.push(status);
    }
    const [countResult] = await db.query(countQuery, countParams);
    const totalCount = countResult[0].total;

    res.json({
      success: true,
      data: {
        customer: {
          customer_id: customerId,
          name: `${customerInfo.first_name} ${customerInfo.last_name}`,
          email: customerInfo.email,
          phone: customerInfo.phone
        },
        bookings: bookingsWithDetails,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalCount,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching booking history by userId:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking history',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/email/:email/history
 * Get all bookings for a specific email address
 * Used when booking by email instead of customer_id
 */
export const getBookingHistoryByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const { status, limit = 20, page = 1 } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Two kinds of customer records exist in the DB:
    //   NEW: customer row has user_id set; name/email/phone live in `user` table
    //   OLD: customer row has user_id=NULL; name/email/phone stored directly in `customers`
    // We need to find customer_ids from BOTH so no bookings are missed.

    // --- NEW style: email in user table, linked via user_id ---
    const [newStyleRows] = await db.query(
      `SELECT c.customer_id, u.first_name, u.last_name, u.email, u.phone
       FROM user u
       JOIN customers c ON c.user_id = u.user_id
       WHERE u.email = ?`,
      [email]
    );

    // --- OLD style: email stored directly in customers (user_id IS NULL) ---
    const [oldStyleRows] = await db.query(
      `SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone
       FROM customers c
       WHERE c.email = ? AND c.user_id IS NULL`,
      [email]
    );

    const allRows = [...newStyleRows, ...oldStyleRows];

    if (allRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No customer found with this email'
      });
    }

    // Use the first row for customer info display; collect all customer_ids for booking lookup
    const customerInfo = allRows[0];
    const customerIds = [...new Set(allRows.map(r => r.customer_id))];

    // Build IN clause — handles both old-style (email in customers) and
    // new-style (email in user, linked via user_id) records
    const placeholders = customerIds.map(() => '?').join(', ');
    let query = `
      SELECT 
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.total,
        b.booking_status,
        b.created_at,
        MAX(p.payment_reference) as payment_reference,
        MAX(p.payment_method) as payment_method,
        MAX(p.status) as payment_status,
        MAX(p.paid_at) as paid_at
      FROM bookings b
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      WHERE b.customer_id IN (${placeholders})
      GROUP BY b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date, b.adults, b.children, b.total, b.booking_status, b.created_at
    `;
    const params = [...customerIds];

    // Optional status filter
    if (status && status !== 'all') {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [bookings] = await db.query(query, params);

    // For each booking, get items
    const bookingsWithDetails = await Promise.all(
      bookings.map(async (booking) => {
        const [items] = await db.query(
          'SELECT * FROM booking_items WHERE booking_id = ?',
          [booking.booking_id]
        );

        return {
          ...booking,
          items: items.map(item => ({
            item_name: item.item_name,
            quantity: item.quantity,
            item_type: item.item_type,
            unit_price: item.unit_price,
            total_price: item.total_price
          })),
          qrCode: {
            reference: booking.booking_reference,
            url: `/api/qr/${booking.booking_reference}`
          }
        };
      })
    );

    // Get total count for pagination
    const countPlaceholders = customerIds.map(() => '?').join(', ');
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM bookings 
      WHERE customer_id IN (${countPlaceholders})
    `;
    const countParams = [...customerIds];

    if (status && status !== 'all') {
      countQuery += ` AND booking_status = ?`;
      countParams.push(status);
    }

    const [countResult] = await db.query(countQuery, countParams);
    const totalCount = countResult[0].total;
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        customer: {
          customer_id: customerInfo.customer_id,
          name: `${customerInfo.first_name} ${customerInfo.last_name}`,
          email: customerInfo.email,
          phone: customerInfo.phone
        },
        bookings: bookingsWithDetails,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching booking history by email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking history',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/qr/:bookingReference
 * Get QR code for a booking
 */
export const getBookingQRCode = async (req, res) => {
  try {
    const { bookingReference } = req.params;

    if (!bookingReference) {
      return res.status(400).json({
        success: false,
        error: 'Booking reference is required'
      });
    }

    // Get QR code
    const qrCodeBase64 = await getQRCodeByReference(bookingReference);

    if (!qrCodeBase64) {
      return res.status(404).json({
        success: false,
        error: 'QR code not found for this booking'
      });
    }

    res.json({
      success: true,
      data: {
        bookingReference,
        qrCode: qrCodeBase64
      }
    });

  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch QR code',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/occupied-dates/:itemId
 * Get all occupied dates for a specific room/item from bookings table
 * Now queries the bookings table directly instead of occupied_dates
 */
export const getOccupiedDates = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'Item ID is required'
      });
    }

    // 🔍 Query bookings table for all confirmed/paid bookings with this item
    const [bookings] = await db.query(
      `SELECT DISTINCT 
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.booking_status,
        b.payment_status
       FROM bookings b
       INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
       WHERE bi.inventory_item_id = ?
       AND b.booking_status IN ('Confirmed', 'Pending')
      AND b.payment_status IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
       AND b.check_in_date IS NOT NULL
       AND b.check_out_date IS NOT NULL
       ORDER BY b.check_in_date ASC`,
      [itemId]
    );

    // Convert booking date ranges into individual dates
    const occupiedDates = [];
    bookings.forEach(booking => {
      const start = new Date(booking.check_in_date);
      const end = new Date(booking.check_out_date);

      // Create entry for each date from check-in (exclusive of check-out)
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        occupiedDates.push({
          date: `${year}-${month}-${day}`,
          bookingReference: booking.booking_reference,
          inventoryItemId: itemId,
          status: booking.payment_status === 'Paid' ? 'confirmed' : 'pending'
        });
      }
    });

    res.json({
      success: true,
      data: {
        itemId,
        occupiedDates,
        totalCount: occupiedDates.length,
        bookingsAffecting: bookings.length
      }
    });

  } catch (error) {
    console.error('Error fetching occupied dates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch occupied dates',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/occupied-dates
 * Get all occupied dates across all items (no filter)
 */
export const getAllOccupiedDates = async (req, res) => {
  try {
    // Query all confirmed/paid bookings with complete date ranges
    const [bookings] = await db.query(
      `SELECT DISTINCT 
        b.booking_id,
        b.booking_reference,
        b.check_in_date,
        b.check_out_date,
        b.booking_status,
        b.payment_status,
        bi.inventory_item_id
       FROM bookings b
       INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
       WHERE b.booking_status IN ('Confirmed', 'Pending')
      AND b.payment_status IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
       AND b.check_in_date IS NOT NULL
       AND b.check_out_date IS NOT NULL
       ORDER BY b.check_in_date ASC`
    );

    // Convert all booking date ranges into individual date entries
    const occupiedDates = [];
    bookings.forEach(booking => {
      const start = new Date(booking.check_in_date);
      const end = new Date(booking.check_out_date);

      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        occupiedDates.push({
          date: `${year}-${month}-${day}`,
          bookingReference: booking.booking_reference,
          inventoryItemId: booking.inventory_item_id,
          status: booking.payment_status === 'Paid' ? 'confirmed' : 'pending'
        });
      }
    });

    res.json({
      success: true,
      data: {
        occupiedDates,
        totalCount: occupiedDates.length,
        bookingsAffecting: bookings.length
      }
    });

  } catch (error) {
    console.error('Error fetching all occupied dates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch occupied dates',
      details: error.message
    });
  }
};

/**
 * GET /api/bookings/validate/:bookingReference
 * Validate booking and return details for check-in
 */
export const validateBookingForCheckIn = async (req, res) => {
  try {
    const { bookingReference } = req.params;

    if (!bookingReference) {
      return res.status(400).json({
        success: false,
        error: 'Booking reference is required'
      });
    }

    // Query booking details including actual check-in/out times
    const [bookings] = await db.query(
      `SELECT 
        b.booking_id as id,
        b.booking_reference,
        COALESCE(
          NULLIF(TRIM(c.first_name), ''),
          NULLIF(TRIM(u.first_name), ''),
          NULLIF(TRIM(b.first_name), ''),
          'Guest'
        ) as first_name,
        COALESCE(
          NULLIF(TRIM(c.last_name), ''),
          NULLIF(TRIM(u.last_name), ''),
          NULLIF(TRIM(b.last_name), ''),
          ''
        ) as last_name,
        COALESCE(
          NULLIF(TRIM(c.email), ''),
          NULLIF(TRIM(u.email), ''),
          NULLIF(TRIM(b.email), ''),
          ''
        ) as email,
        COALESCE(
          NULLIF(TRIM(c.phone), ''),
          NULLIF(TRIM(u.phone), ''),
          NULLIF(TRIM(b.phone), ''),
          ''
        ) as phone,
        b.check_in_date,
        b.check_out_date,
        b.booking_status,
        b.payment_status,
        b.actual_check_in_time,
        b.actual_check_out_time,
        CONCAT('[', GROUP_CONCAT(
          JSON_OBJECT(
            'item_id', bi.inventory_item_id,
            'item_name', COALESCE(NULLIF(TRIM(ii.name), ''), NULLIF(TRIM(bi.item_name), ''), 'Item'),
            'qty', bi.quantity
          )
        ), ']') as items_list
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.customer_id
       LEFT JOIN user u ON c.user_id = u.user_id
       LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
       LEFT JOIN inventory_items ii ON bi.inventory_item_id = ii.item_id
       WHERE b.booking_reference = ?
       GROUP BY b.booking_id`,
      [bookingReference]
    );

    if (!bookings || bookings.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const booking = bookings[0];

    // Parse items list
    let itemsList = [];
    if (booking.items_list) {
      try {
        itemsList = JSON.parse(booking.items_list);
      } catch (e) {
        itemsList = [];
      }
    }

    res.json({
      success: true,
      data: {
        ...booking,
        items_list: itemsList
      }
    });

  } catch (error) {
    console.error('Error validating booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate booking',
      details: error.message
    });
  }
};

/**
 * POST /api/bookings/:bookingId/check-in
 * Process guest check-in
 */
export const processCheckIn = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { checked_in_by } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        error: 'Booking ID is required'
      });
    }

    // Verify booking exists and get current status
    const [existingBooking] = await db.query(
      'SELECT booking_id, booking_status FROM bookings WHERE booking_id = ?',
      [bookingId]
    );

    if (!existingBooking || existingBooking.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const currentStatus = String(existingBooking[0].booking_status || '').toLowerCase().replace(/[^a-z]/g, '');
    
    // Only allow check-in from Confirmed or Paid status
    if (!['confirmed', 'paid'].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        error: `Cannot check in booking with status: ${existingBooking[0].booking_status}. Guest must be Confirmed or Paid.`
      });
    }

    // Update booking status to Checked-In with actual check-in time
    const [result] = await db.query(
      `UPDATE bookings 
       SET 
        booking_status = 'Checked-In',
        actual_check_in_time = NOW()
       WHERE booking_id = ?`,
      [bookingId]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        error: 'Failed to update booking status'
      });
    }

    res.json({
      success: true,
      message: 'Guest checked in successfully',
      data: {
        booking_id: bookingId,
        status: 'Checked-In',
        checked_in_by: checked_in_by || 'admin',
        checked_in_time: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error processing check-in:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process check-in',
      details: error.message
    });
  }
};

/**
 * POST /api/bookings/:bookingId/check-out
 * Process guest check-out
 */
export const processCheckOut = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { checked_out_by } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        error: 'Booking ID is required'
      });
    }

    // Verify booking exists and get current status
    const [existingBooking] = await db.query(
      'SELECT booking_id, booking_status FROM bookings WHERE booking_id = ?',
      [bookingId]
    );

    if (!existingBooking || existingBooking.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const currentStatus = String(existingBooking[0].booking_status || '').toLowerCase().replace(/[^a-z]/g, '');
    
    // Only allow check-out from Checked-In status
    if (currentStatus !== 'checkedin') {
      return res.status(400).json({
        success: false,
        error: `Cannot check out booking with status: ${existingBooking[0].booking_status}. Guest must be Checked-In.`
      });
    }

    // Update booking status to Checked-Out with actual check-out time
    const [result] = await db.query(
      `UPDATE bookings 
       SET 
        booking_status = 'Checked-Out',
        actual_check_out_time = NOW()
       WHERE booking_id = ?`,
      [bookingId]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        error: 'Failed to update booking status'
      });
    }

    res.json({
      success: true,
      message: 'Guest checked out successfully',
      data: {
        booking_id: bookingId,
        status: 'Checked-Out',
        checked_out_by: checked_out_by || 'admin',
        checked_out_time: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error processing check-out:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process check-out',
      details: error.message
    });
  }
};

/**
 * ============================================================
 * CREATE BOOKING WITH AUTO-ASSIGNED ROOM
 * ============================================================
 * 
 * Endpoint: POST /api/bookings/with-auto-assign
 * 
 * Purpose:
 * - Create a new booking with automatic room assignment
 * - Atomically assign first available room of requested type
 * - Prevent double-booking with transactions and row-level locks
 * 
 * Request Body:
 * {
 *   customer: {
 *     first_name: string,
 *     last_name: string,
 *     email: string,
 *     phone: string,
 *     address: string,
 *     city: string,
 *     postal_code: string
 *   },
 *   checkInDate: string (ISO format),
 *   checkOutDate: string (ISO format),
 *   roomType: string (e.g., "FAMILY ROOM"),
 *   paymentMethod: string,
 *   subtotal: number,
 *   discount: number,
 *   tax: number,
 *   total: number,
 *   promoCode: string (optional)
 * }
 * 
 * Response (201 Success):
 * {
 *   success: true,
 *   message: "Booking created successfully with auto-assigned room",
 *   data: {
 *     booking_id: 42,
 *     booking_reference: "BK20260421001",
 *     room_assigned: "FAMILY ROOM 1",
 *     item_id: 1,
 *     check_in_date: "2026-05-01",
 *     check_out_date: "2026-05-03",
 *     nights: 2,
 *     total: 9900
 *   }
 * }
 * 
 * Error (409 Conflict - No Available Rooms):
 * {
 *   success: false,
 *   message: "Room assignment failed",
 *   error: "No available FAMILY ROOM rooms for dates 2026-05-01 to 2026-05-03"
 * }
 * 
 * Error (503 Service Unavailable - Lock Timeout):
 * {
 *   success: false,
 *   message: "System busy. Please try again.",
 *   error: "Lock acquisition timeout"
 * }
 */
export const createBookingWithAutoAssign = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      customer,
      checkInDate,
      checkOutDate,
      roomType,
      paymentMethod,
      subtotal,
      discount,
      tax,
      total,
      promoCode
    } = req.body;

    // Validate required fields
    if (!roomType || !checkInDate || !checkOutDate) {
      await connection.release();
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        details: 'roomType, checkInDate, checkOutDate are required'
      });
    }

    if (!customer || !customer.first_name || !customer.last_name || !customer.email) {
      await connection.release();
      return res.status(400).json({
        success: false,
        message: 'Missing customer information',
        details: 'first_name, last_name, email are required'
      });
    }

    // Validate booking dates
    const dateValidation = validateBookingDates(new Date(checkInDate), new Date(checkOutDate));
    if (!dateValidation.valid) {
      await connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid booking dates',
        error: dateValidation.error
      });
    }

    // Set SERIALIZABLE isolation for strictest consistency
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();

    try {
      // Step 1: Auto-assign first available room
      const assignmentResult = await autoAssignRoom(
        connection,
        roomType,
        new Date(checkInDate),
        new Date(checkOutDate)
      );

      if (!assignmentResult.success) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: 'Room assignment failed',
          error: assignmentResult.error
        });
      }

      // Step 2: Generate booking reference
      const bookingRef = await generateRef();

      // Step 3: Create booking record
      const [bookingResult] = await connection.query(
        `INSERT INTO bookings (
          booking_reference, first_name, last_name, email, phone, address, city, postal_code,
          check_in_date, check_out_date, nights, subtotal, discount, tax, total, 
          promo_code, payment_method, booking_status, payment_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          bookingRef,
          customer.first_name,
          customer.last_name,
          customer.email,
          customer.phone || '',
          customer.address || '',
          customer.city || '',
          customer.postal_code || '',
          checkInDate,
          checkOutDate,
          assignmentResult.nights,
          subtotal || 0,
          discount || 0,
          tax || 0,
          total || 0,
          promoCode || null,
          paymentMethod || 'Cash',
          'Pending',
          'Unpaid'
        ]
      );

      const bookingId = bookingResult.insertId;

      // Step 4: Create booking item entry
      await connection.query(
        `INSERT INTO booking_items (
          booking_id, item_type, item_name, inventory_item_id, 
          unit_price, quantity, nights, total_price, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          bookingId,
          'Room',
          assignmentResult.room_name,
          assignmentResult.item_id,
          assignmentResult.room_price || 0,
          1,
          assignmentResult.nights,
          (assignmentResult.room_price || 0) * assignmentResult.nights
        ]
      );

      // Step 5: Update occupied_dates with booking_id
      await connection.query(
        `UPDATE occupied_dates 
         SET booking_id = ? 
         WHERE inventory_item_id = ? AND booking_id IS NULL`,
        [bookingId, assignmentResult.item_id]
      );

      // Commit transaction
      await connection.commit();

      // Step 6: Send booking confirmation email (non-blocking)
      try {
        await sendBookingApprovalEmail({
          bookingReference: bookingRef,
          customerEmail: customer.email,
          customerName: `${customer.first_name} ${customer.last_name}`,
          roomName: assignmentResult.room_name,
          checkInDate,
          checkOutDate,
          nights: assignmentResult.nights,
          total: total || 0
        });
      } catch (emailError) {
        console.error('Email sending failed (non-blocking):', emailError);
        // Don't fail booking if email fails
      }

      res.status(201).json({
        success: true,
        message: 'Booking created successfully with auto-assigned room',
        data: {
          booking_id: bookingId,
          booking_reference: bookingRef,
          room_assigned: assignmentResult.room_name,
          item_id: assignmentResult.item_id,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          nights: assignmentResult.nights,
          total: total || 0
        }
      });

    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }

  } catch (error) {
    console.error('Error creating booking with auto-assign:', error);

    // Handle lock timeout (system busy)
    if (error.code === 'ER_LOCK_WAIT_TIMEOUT') {
      return res.status(503).json({
        success: false,
        message: 'System busy. Please try again.',
        error: 'Lock acquisition timeout'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message,
      details: error.sqlState
    });

  } finally {
    await connection.release();
  }
};
