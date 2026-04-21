import db from '../config/db.js';
import { generateQRCode, formatBookingDataForQR } from '../services/qrCodeService.js';
import { sendBookingConfirmationWithQR } from '../services/emailService.js';

/**
 * ============================================================
 * BOOKING CONFIRMATION CONTROLLER
 * ============================================================
 * Handles complete booking confirmation process including:
 * - Customer creation/update
 * - Booking creation with items
 * - QR code generation
 * - Email confirmation with QR code
 * - Payment initiation
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

    const { guest, checkIn, checkOut, items, paymentMethod, total, userId, isSwimmingOnly } = req.body;

    // Debug logging
    console.log('🔍 Booking request received:');
    console.log('  - userId:', userId);
    console.log('  - guest email:', guest?.email);
    console.log('  - guest name:', guest?.firstName, guest?.lastName);
    console.log('  - isSwimmingOnly:', isSwimmingOnly);

    // Validation
    if (!guest?.firstName || !guest?.lastName || !guest?.email || !guest?.phone) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Guest information is required' });
    }

    // Skip date validation for swimming-only bookings
    if (!isSwimmingOnly && (!checkIn || !checkOut)) {
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
      // Guest / walk-in booking (no userId supplied).
      // email and name live in `user`; customer profile is linked via user_id.
      // Try to find an existing user with this email, then their customer record.
      const [existingUser] = await connection.query(
        'SELECT user_id FROM user WHERE email = ? LIMIT 1',
        [guest.email]
      );

      if (existingUser.length > 0) {
        const guestUserId = existingUser[0].user_id;
        const [existingCustomer] = await connection.query(
          'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
          [guestUserId]
        );

        if (existingCustomer.length > 0) {
          customerId = existingCustomer[0].customer_id;
          // Update address fields
          await connection.query(
            `UPDATE customers SET address=?, city=?, country=?, postal_code=?, updated_at=CURRENT_TIMESTAMP
             WHERE customer_id=?`,
            [guest.address, guest.city, guest.country || 'Philippines', guest.postal, customerId]
          );
        } else {
          // User exists but no customer row yet — create one
          const [customerResult] = await connection.query(
            `INSERT INTO customers (user_id, address, city, country, postal_code)
             VALUES (?, ?, ?, ?, ?)`,
            [guestUserId, guest.address, guest.city, guest.country || 'Philippines', guest.postal]
          );
          customerId = customerResult.insertId;
        }
        console.log(`✅ Found existing user_id ${guestUserId}, customer_id ${customerId}`);
      } else {
        // Truly anonymous guest — create a minimal user row first, then a customer row
        const [newUser] = await connection.query(
          `INSERT INTO user (first_name, last_name, email, phone, password, role)
           VALUES (?, ?, ?, ?, 'GUEST_NO_PASSWORD', 'customer')`,
          [guest.firstName, guest.lastName, guest.email, guest.phone]
        );
        const newUserId = newUser.insertId;
        const [customerResult] = await connection.query(
          `INSERT INTO customers (user_id, address, city, country, postal_code)
           VALUES (?, ?, ?, ?, ?)`,
          [newUserId, guest.address, guest.city, guest.country || 'Philippines', guest.postal]
        );
        customerId = customerResult.insertId;
        console.log(`✅ Created guest user_id ${newUserId}, customer_id ${customerId}`);
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
      const requestedQty = Math.max(1, Number(item.qty || 1));
      // Calculate nights only for non-swimming items with valid dates
      const nights = item.perNight && checkIn && checkOut
        ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000)
        : 0;
      const totalPrice = item.price * requestedQty * (item.perNight ? nights : 1);

      // Get numeric inventory_item_id
      const itemIdValue = item.item_id || item.id;
      let numericItemId = null;

      if (isNaN(itemIdValue)) {
        // String ID - query database for numeric ID
        const categoryName = item.swimmingDetails ? 'Swimming' : (item.category || 'Room');
        const [inventoryItem] = await connection.query(
          'SELECT item_id FROM inventory_items WHERE category = ? LIMIT 1',
          [categoryName]
        );

        if (inventoryItem.length > 0) {
          numericItemId = inventoryItem[0].item_id;
        }
      } else {
        numericItemId = parseInt(itemIdValue);
      }

      // Determine item type - if has swimmingDetails, it's a swimming booking
      const itemType = item.swimmingDetails ? 'Swimming' : (item.category || 'Room');
      const itemName = item.swimmingDetails
        ? (item.name || 'Swimming Lesson Package')
        : (item.name || 'Item');

      console.log(`📦 Adding booking item: ${itemType} - ${itemName}`, item.swimmingDetails ? '(Swimming)' : '');

      // For swimming bookings, use participants from swimmingDetails, otherwise use guests
      const guestCount = item.swimmingDetails && item.swimmingDetails.participants
        ? item.swimmingDetails.participants
        : (item.guests || 0);

      if (item.perNight && !item.swimmingDetails) {
        const requestedIds = Array.isArray(item.selectedInventoryItemIds)
          ? item.selectedInventoryItemIds.map(id => Number(id)).filter(Number.isFinite)
          : [];

        let candidateParams = [];
        let candidateFilter = '';

        if (requestedIds.length) {
          candidateFilter = ` AND ii.item_id IN (${requestedIds.map(() => '?').join(', ')})`;
          candidateParams = requestedIds;
        }

        const [availableUnits] = await connection.query(
          `SELECT ii.item_id
           FROM inventory_items ii
           WHERE ii.name = ?
             AND LOWER(COALESCE(ii.status, '')) NOT IN ('under maintenance', 'maintenance')
             ${candidateFilter}
             AND ii.item_id NOT IN (
               SELECT bi.inventory_item_id
               FROM booking_items bi
               INNER JOIN bookings b ON b.booking_id = bi.booking_id
               WHERE bi.inventory_item_id IS NOT NULL
                 AND b.booking_status IN ('Confirmed', 'Pending')
                 AND COALESCE(b.payment_status, 'Unpaid') IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
                 AND (
                   (b.check_in_date < ? AND b.check_out_date > ?)
                   OR (b.check_in_date >= ? AND b.check_in_date < ?)
                   OR (b.check_out_date > ? AND b.check_out_date <= ?)
                 )
             )
           ORDER BY ii.item_id ASC
           LIMIT ?`,
          [
            item.name || 'Item',
            ...candidateParams,
            checkOut,
            checkIn,
            checkIn,
            checkOut,
            checkIn,
            checkOut,
            requestedQty
          ]
        );

        if (availableUnits.length < requestedQty) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            error: 'Not enough available rooms for the selected dates',
            item_name: itemName,
            requested_quantity: requestedQty,
            available_quantity: availableUnits.length
          });
        }

        const guestsPerUnit = guestCount > 0 ? Math.max(1, Math.ceil(guestCount / requestedQty)) : 0;

        for (const unit of availableUnits) {
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
              per_night,
              item_description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              bookingId,
              unit.item_id,
              itemType,
              itemName,
              item.price,
              1,
              guestsPerUnit,
              nights,
              item.price * (item.perNight ? nights : 1),
              true,
              item.description || null
            ]
          );
        }

        console.log(`🏨 Reserved ${availableUnits.length} unit(s) for ${itemName}`);
        continue;
      }

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
          per_night,
          item_description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          numericItemId,
          itemType,
          itemName,
          item.price,
          requestedQty,
          guestCount,
          nights,
          totalPrice,
          item.perNight || false,
          item.swimmingDetails ? JSON.stringify(item.swimmingDetails) : null
        ]
      );

      // Add swimming session dates as occupied dates
      if (item.swimmingDetails && item.swimmingDetails.dates && item.swimmingDetails.dates.length > 0) {
        // Only insert if we have a valid numeric ID
        if (numericItemId) {
          const swimmingDates = item.swimmingDetails.dates.map(date => [
            numericItemId,
            bookingId,
            date
          ]);

          // **VALIDATION**: Check if any swimming dates are already occupied
          const dateStrings = swimmingDates.map(d => d[2]);
          const [conflictingDates] = await connection.query(
            `SELECT DISTINCT occupied_date FROM occupied_dates 
             WHERE inventory_item_id = ? AND occupied_date IN (?)`,
            [numericItemId, dateStrings]
          );

          if (conflictingDates.length > 0) {
            await connection.rollback();
            const conflictDates = conflictingDates.map(d => d.occupied_date).join(', ');
            console.error(`❌ Swimming date conflict for item ${numericItemId}: ${conflictDates}`);
            return res.status(409).json({
              success: false,
              error: 'Some swimming session dates have already been booked',
              conflict_dates: conflictingDates.map(d => d.occupied_date),
              item_id: numericItemId,
              item_name: itemName
            });
          }

          // All dates available - proceed with insert
          await connection.query(
            'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES ?',
            [swimmingDates]
          );

          console.log(`🏊 Added ${swimmingDates.length} swimming session dates to occupied_dates`);
        } else {
          console.warn(`⚠️ No numeric item ID found for swimming, skipping occupied_dates`);
        }
      }

      // Add occupied dates for rooms/cottages (skip for swimming - already handled above)
      if (item.perNight && checkIn && checkOut && !item.swimmingDetails) {
        const itemId = item.item_id || item.id;

        // 🔍 IMPROVED: Check availability directly from bookings table
        // Query all confirmed/paid bookings for this item that overlap with requested dates
        const [conflicts] = await connection.query(
          `SELECT b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date
           FROM bookings b
           INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
           WHERE bi.inventory_item_id = ? 
           AND b.booking_status IN ('Confirmed', 'Pending')
           AND b.payment_status IN ('Paid', 'pending')
           AND (
             (b.check_in_date < ? AND b.check_out_date > ?)
             OR (b.check_in_date >= ? AND b.check_in_date < ?)
             OR (b.check_out_date > ? AND b.check_out_date <= ?)
           )`,
          [itemId, checkOut, checkIn, checkIn, checkOut, checkIn, checkOut]
        );

        if (conflicts.length > 0) {
          await connection.rollback();
          const conflictInfo = conflicts.map(c =>
            `${c.booking_reference} (${c.check_in_date} to ${c.check_out_date})`
          ).join(', ');

          console.error(`❌ Room booking conflict for item ${itemId}: ${conflictInfo}`);
          return res.status(409).json({
            success: false,
            error: 'Room is not available for selected dates',
            conflict_dates: conflicts.map(c => ({
              booking_reference: c.booking_reference,
              check_in: c.check_in_date,
              check_out: c.check_out_date
            })),
            item_id: itemId,
            item_name: itemName
          });
        }

        // Dates are available - no need to insert into occupied_dates
        // Source of truth is now the bookings table with check_in/check_out dates
        console.log(`✅ Room availability verified for item ${itemId} from ${checkIn} to ${checkOut}`);
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

    // Step 7: Generate QR Code with booking info
    let qrCodeData = null;
    try {
      console.log('🔄 Generating QR code...');

      // Prepare data for QR code
      const formattedQRData = formatBookingDataForQR(
        {
          booking_reference: bookingReference,
          first_name: guest.firstName,
          last_name: guest.lastName
        },
        items.map(item => ({
          item_name: item.name,
          quantity: item.qty,
          item_type: item.category || 'Room'
        }))
      );

      qrCodeData = await generateQRCode(formattedQRData);
      console.log('✅ QR code generated successfully');
    } catch (qrError) {
      console.warn('⚠️ QR code generation failed:', qrError.message);
      // Continue even if QR generation fails
    }

    // Step 8: Skip email sending here - will send only after payment is completed
    // Email with QR code will be sent in updatePaymentStatus when status = 'paid'
    console.log('⏳ Email will be sent after payment is confirmed');

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
        status: 'pending',
        qrCode: qrCodeData ? {
          url: qrCodeData.url,
          filename: qrCodeData.filename
        } : null
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

    // Mark payment as paid — booking status stays pending for admin approval
    if (status === 'paid') {
      await db.query(
        'UPDATE bookings SET payment_status = ? WHERE booking_id = ?',
        ['Paid', bookingId]
      );

      await db.query(
        'INSERT INTO booking_logs (booking_id, action, description, performed_by) VALUES (?, ?, ?, ?)',
        [bookingId, 'Payment Received', `Payment completed via ${paymentIntentId}. Awaiting admin approval.`, 'System']
      );

      // 🎉 Step: Send confirmation email with QR code AFTER payment is confirmed
      try {
        console.log('📧 Sending booking confirmation email with QR code after payment...');

        // Get booking details for email
        const [bookings] = await db.query(
          `SELECT b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date, b.total,
                  u.first_name, u.last_name, u.email
           FROM bookings b
           LEFT JOIN customers c ON b.customer_id = c.customer_id
           LEFT JOIN user u ON c.user_id = u.user_id
           WHERE b.booking_id = ?`,
          [bookingId]
        );

        if (bookings.length > 0) {
          const booking = bookings[0];

          // Get booking items
          const [items] = await db.query(
            `SELECT bi.quantity as qty, bi.unit_price as price, bi.item_name as name, bi.item_type as category
             FROM booking_items bi
             WHERE bi.booking_id = ?`,
            [bookingId]
          );

          // Generate QR code for paid booking
          let qrCodeData = null;
          try {
            const formattedQRData = formatBookingDataForQR(
              {
                booking_reference: booking.booking_reference,
                first_name: booking.first_name,
                last_name: booking.last_name
              },
              items.map(item => ({
                item_name: item.name,
                quantity: item.qty,
                item_type: item.category || 'Room'
              }))
            );
            qrCodeData = await generateQRCode(formattedQRData);
            console.log('✅ QR code generated for payment confirmation');
          } catch (qrError) {
            console.warn('⚠️ QR code generation failed:', qrError.message);
          }

          // Send email with QR
          const emailData = {
            email: booking.email,
            firstName: booking.first_name,
            lastName: booking.last_name,
            bookingReference: booking.booking_reference,
            checkIn: booking.check_in_date,
            checkOut: booking.check_out_date,
            items: items.map(item => ({
              name: item.name,
              qty: item.qty,
              price: item.price
            })),
            total: booking.total
          };

          await sendBookingConfirmationWithQR(emailData, qrCodeData?.base64 || null);
          console.log('✅ Confirmation email with QR sent successfully');
        }
      } catch (emailError) {
        console.warn('⚠️ Email sending failed after payment:', emailError.message);
        // Don't fail the payment update if email fails
      }
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
