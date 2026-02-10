import db from '../config/db.js';

/**
 * ============================================================
 * BOOKING CONFIRMATION CONTROLLER
 * ============================================================
 * Handles complete booking confirmation process including:
 * - Customer creation/update
 * - Booking creation with items
 * - Payment initiation
 * - Email confirmation (future)
 */

/**
 * Create Complete Booking with Customer and Payment
 * POST /api/bookings/confirm
 * 
 * Body: {
 *   guest: { firstName, lastName, email, phone, address, city, country, postal, adults, children, arrivalTime, specialRequests },
 *   checkIn: "2026-02-15",
 *   checkOut: "2026-02-17",
 *   items: [{ item_id, qty, guests, price, perNight }],
 *   paymentMethod: "gcash",
 *   total: 5000
 * }
 */
export const createBookingConfirmation = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { guest, checkIn, checkOut, items, paymentMethod, total, userId } = req.body;

    // Debug logging
    console.log('🔍 Booking request received:');
    console.log('  - userId:', userId);
    console.log('  - guest email:', guest?.email);
    console.log('  - guest name:', guest?.firstName, guest?.lastName);

    // Validation
    if (!guest?.firstName || !guest?.lastName || !guest?.email || !guest?.phone) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Guest information is required' });
    }

    if (!checkIn || !checkOut) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Check-in and check-out dates are required' });
    }

    if (!items || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'At least one booking item is required' });
    }

    // Step 1: Get or create customer - prioritize user_id if logged in
    let customerId;

    if (userId) {
      // Logged-in user: find customer by user_id
      const [userCustomer] = await connection.query(
        'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
        [userId]
      );

      if (userCustomer.length > 0) {
        // Use existing customer linked to this user
        customerId = userCustomer[0].customer_id;

        // Update customer info with latest details
        await connection.query(
          `UPDATE customers SET 
            address = ?, 
            city = ?, 
            country = ?, 
            postal_code = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = ?`,
          [guest.address, guest.city, guest.country || 'Philippines', guest.postal, customerId]
        );

        console.log(`✅ Using existing customer_id ${customerId} for user_id ${userId}`);
      } else {
        // User exists but no customer record - create one linked to user_id
        const [customerResult] = await connection.query(
          `INSERT INTO customers (user_id, address, city, country, postal_code)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, guest.address, guest.city, guest.country || 'Philippines', guest.postal]
        );
        customerId = customerResult.insertId;
        console.log(`✅ Created new customer_id ${customerId} linked to user_id ${userId}`);
      }
    } else {
      // Guest booking (not logged in): check by email
      const [existingCustomer] = await connection.query(
        'SELECT customer_id FROM customers WHERE email = ? LIMIT 1',
        [guest.email]
      );

      if (existingCustomer.length > 0) {
        customerId = existingCustomer[0].customer_id;

        // Update existing customer info
        await connection.query(
          `UPDATE customers SET 
            first_name = ?, 
            last_name = ?, 
            phone = ?, 
            address = ?, 
            city = ?, 
            country = ?, 
            postal_code = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = ?`,
          [guest.firstName, guest.lastName, guest.phone, guest.address, guest.city, guest.country || 'Philippines', guest.postal, customerId]
        );
      } else {
        // Create new guest customer (no user_id)
        const [customerResult] = await connection.query(
          `INSERT INTO customers (first_name, last_name, email, phone, address, city, country, postal_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [guest.firstName, guest.lastName, guest.email, guest.phone, guest.address, guest.city, guest.country || 'Philippines', guest.postal]
        );
        customerId = customerResult.insertId;
        console.log(`✅ Created new guest customer_id ${customerId} (no user account)`);
      }
    }

    // Step 2: Generate booking reference
    const bookingReference = 'EDU' + Date.now().toString().slice(-8);

    // Step 3: Create booking
    const [bookingResult] = await connection.query(
      `INSERT INTO bookings (
        booking_reference, 
        customer_id, 
        check_in_date, 
        check_out_date, 
        adults, 
        children, 
        arrival_time, 
        special_requests,
        subtotal,
        total,
        booking_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        bookingReference,
        customerId,
        checkIn,
        checkOut,
        guest.adults || 2,
        guest.children || 0,
        guest.arrivalTime || '3 PM',
        guest.specialRequests || '',
        total,
        total
      ]
    );

    const bookingId = bookingResult.insertId;

    // Step 4: Add booking items
    for (const item of items) {
      const nights = item.perNight ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000) : 0;
      const totalPrice = item.price * item.qty * (item.perNight ? nights : 1);

      await connection.query(
        `INSERT INTO booking_items (
          booking_id, 
          inventory_item_id, 
          item_type,
          item_name,
          unit_price, 
          quantity, 
          guests,
          nights,
          total_price,
          per_night
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          item.item_id || item.id,
          item.category || 'Room',
          item.name || 'Item',
          item.price,
          item.qty,
          item.guests,
          nights,
          totalPrice,
          item.perNight || false
        ]
      );

      // Add occupied dates for rooms/cottages
      if (item.perNight) {
        const dates = [];
        const start = new Date(checkIn);
        const end = new Date(checkOut);

        for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
          dates.push([
            item.item_id || item.id,
            bookingId,
            d.toISOString().split('T')[0]
          ]);
        }

        if (dates.length > 0) {
          await connection.query(
            'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES ?',
            [dates]
          );
        }
      }
    }

    // Step 5: Create payment record (pending status)
    const paymentReference = 'PAY' + Date.now().toString().slice(-6);
    const [paymentResult] = await connection.query(
      `INSERT INTO payments (
        booking_id, 
        customer_id, 
        payment_reference, 
        payment_method, 
        amount, 
        status
      ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [bookingId, customerId, paymentReference, paymentMethod, total]
    );

    // Step 6: Log booking creation
    await connection.query(
      'INSERT INTO booking_logs (booking_id, action, description) VALUES (?, ?, ?)',
      [bookingId, 'created', `Booking created by ${guest.firstName} ${guest.lastName}`]
    );

    await connection.commit();

    // Return success response
    res.json({
      success: true,
      message: 'Booking created successfully',
      data: {
        bookingId,
        bookingReference,
        customerId,
        paymentId: paymentResult.insertId,
        paymentReference,
        total,
        status: 'pending'
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Booking confirmation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking',
      details: error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * Update Payment Status (Called by PayMongo webhook or after payment)
 * POST /api/bookings/update-payment
 * 
 * Body: {
 *   bookingId: 123,
 *   paymentReference: "PAY123456",
 *   status: "paid",
 *   paymentIntentId: "pi_xxx",
 *   checkoutUrl: "https://..."
 * }
 */
export const updatePaymentStatus = async (req, res) => {
  try {
    const { bookingId, paymentReference, status, paymentIntentId, checkoutUrl } = req.body;

    const [result] = await db.query(
      `UPDATE payments SET 
        status = ?, 
        payment_intent_id = ?, 
        checkout_url = ?,
        paid_at = IF(? = 'paid', CURRENT_TIMESTAMP, paid_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE booking_id = ? AND payment_reference = ?`,
      [status, paymentIntentId, checkoutUrl, status, bookingId, paymentReference]
    );

    // Update booking status if payment is completed
    if (status === 'paid') {
      await db.query(
        'UPDATE bookings SET booking_status = ?, payment_status = ? WHERE booking_id = ?',
        ['Confirmed', 'Paid', bookingId]
      );

      await db.query(
        'INSERT INTO booking_logs (booking_id, action, details) VALUES (?, ?, ?)',
        [bookingId, 'payment_completed', `Payment completed via ${paymentIntentId}`]
      );
    }

    res.json({
      success: true,
      message: 'Payment status updated',
      affected: result.affectedRows
    });

  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment status',
      details: error.message
    });
  }
};

/**
 * Get Booking Details with Customer and Payment Info
 * GET /api/bookings/:id/details
 */
export const getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;

    // Get booking with customer info
    const [bookings] = await db.query(
      `SELECT 
        b.*,
        c.first_name, c.last_name, c.email, c.phone, c.address, c.city, c.country, c.postal_code,
        p.payment_reference, p.payment_method, p.amount as payment_amount, p.status as payment_status,
        p.paid_at, p.checkout_url
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN payments p ON b.id = p.booking_id
      WHERE b.id = ?`,
      [id]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Get booking items
    const [items] = await db.query(
      `SELECT 
        bi.*,
        i.name, i.description, i.category, i.category_type
      FROM booking_items bi
      LEFT JOIN inventory_items i ON bi.item_id = i.item_id
      WHERE bi.booking_id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...bookings[0],
        items
      }
    });

  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking details',
      details: error.message
    });
  }
};
