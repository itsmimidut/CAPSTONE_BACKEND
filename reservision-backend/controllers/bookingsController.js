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
        COUNT(bi.item_id) as item_count
      FROM bookings b
      LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (status) {
      query += ` AND b.booking_status = ?`;
      params.push(status);
    }
    
    if (email) {
      query += ` AND b.email LIKE ?`;
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
    
    // Get booking details
    const [bookings] = await db.query(
      `SELECT * FROM bookings WHERE booking_id = ?`,
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
          unit_price,
          quantity,
          nights,
          total_price,
          guests,
          per_night
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          item.item.category || 'Room',
          item.item.name,
          item.item.desc || item.item.description,
          item.item.item_id || null,
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
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
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
    
    // Fetch updated booking
    const [updated] = await connection.query(
      `SELECT * FROM bookings WHERE booking_id = ?`,
      [id]
    );
    
    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: updated[0]
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
 * GET /api/bookings/occupied-dates/:itemId
 * Get all occupied dates for a specific inventory item
 */
export const getOccupiedDates = async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const [dates] = await db.query(
      `SELECT DISTINCT occupied_date 
       FROM occupied_dates 
       WHERE inventory_item_id = ? 
       AND occupied_date >= CURDATE()
       ORDER BY occupied_date ASC`,
      [itemId]
    );
    
    // Return array of date strings
    const occupiedDates = dates.map(row => row.occupied_date);
    
    res.json({
      success: true,
      data: occupiedDates
    });
  } catch (error) {
    console.error('Error fetching occupied dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch occupied dates',
      error: error.message
    });
  }
};

/**
 * GET /api/bookings/occupied-dates
 * Get all occupied dates across all items
 */
export const getAllOccupiedDates = async (req, res) => {
  try {
    const [dates] = await db.query(
      `SELECT inventory_item_id, occupied_date 
       FROM occupied_dates 
       WHERE occupied_date >= CURDATE()
       ORDER BY occupied_date ASC`
    );
    
    res.json({
      success: true,
      count: dates.length,
      data: dates
    });
  } catch (error) {
    console.error('Error fetching all occupied dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch occupied dates',
      error: error.message
    });
  }
};
