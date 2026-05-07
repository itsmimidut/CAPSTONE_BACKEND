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

    const { guest, checkIn, checkOut, items, paymentMethod, subtotal = 0, total = 0, userId, isSwimmingOnly, entranceFee = 0, extraPersonFee = 0 } = req.body;

    // Debug logging
    console.log('🔍 Booking request received:');
    console.log('  - userId:', userId);
    console.log('  - guest email:', guest?.email);
    console.log('  - guest name:', guest?.firstName, guest?.lastName);
    console.log('  - isSwimmingOnly:', isSwimmingOnly);
    console.log('  - entranceFee:', entranceFee);
    console.log('  - extraPersonFee:', extraPersonFee);

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

    // Validate and normalize dates to ISO format (YYYY-MM-DD)
    let normalizedCheckIn = checkIn;
    let normalizedCheckOut = checkOut;

    if (!isSwimmingOnly && checkIn && checkOut) {
      try {
        // Parse the date and ensure it's in YYYY-MM-DD format
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
          throw new Error('Invalid date format');
        }

        // Convert to YYYY-MM-DD format for MySQL
        normalizedCheckIn = checkInDate.toISOString().split('T')[0];
        normalizedCheckOut = checkOutDate.toISOString().split('T')[0];

        console.log(`📅 Normalized dates - Check-in: ${normalizedCheckIn}, Check-out: ${normalizedCheckOut}`);
      } catch (err) {
        console.error(`❌ Date parsing error: ${err.message}`);
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Invalid date format. Please use YYYY-MM-DD format.' });
      }
    }

    if (!items || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'At least one booking item is required' });
    }

    const [bookingColumns] = await connection.query(
      'SHOW COLUMNS FROM bookings WHERE Field IN (?, ?)',
      ['entrance_fee', 'extra_person_fee']
    )
    const bookingColumnNames = bookingColumns.map(col => col.Field)
    const hasBookingEntranceFee = bookingColumnNames.includes('entrance_fee')
    const hasBookingExtraPersonFee = bookingColumnNames.includes('extra_person_fee')

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
    const bookingFields = [
      'booking_reference',
      'customer_id',
      'check_in_date',
      'check_out_date',
      'adults',
      'children',
      'arrival_time',
      'special_requests',
      'subtotal'
    ]
    const bookingValues = [
      bookingReference,
      customerId,
      normalizedCheckIn,
      normalizedCheckOut,
      guest.adults || 2,
      guest.children || 0,
      guest.arrivalTime || null,
      guest.specialRequests || '',
      subtotal
    ]

    if (hasBookingEntranceFee) {
      bookingFields.push('entrance_fee')
      bookingValues.push(Number(entranceFee || 0))
    }

    if (hasBookingExtraPersonFee) {
      bookingFields.push('extra_person_fee')
      bookingValues.push(Number(extraPersonFee || 0))
    }

    bookingFields.push('total', 'booking_status')
    bookingValues.push(Number(total || subtotal + Number(entranceFee || 0) + Number(extraPersonFee || 0)), 'Pending')

    const [bookingResult] = await connection.query(
      `INSERT INTO bookings (${bookingFields.join(', ')}) VALUES (${bookingFields.map(() => '?').join(', ')})`,
      bookingValues
    );

    const bookingId = bookingResult.insertId;

    // Step 4: Add booking items
    for (const item of items) {
      const bookingType = item.booking_type || item.bookingType || 'room'
      const isRoom = bookingType === 'room'
      const isCottage = bookingType === 'cottage'
      const isEvent = bookingType === 'event'

      const requestedQty = Math.max(1, Number(item.qty || 1))

      // Use item-level booking dates
      const itemCheckIn = item.check_in || item.checkIn
      const itemCheckOut = item.check_out || item.checkOut
      const itemBookingDate = item.booking_date || item.bookingDate

      // Calculate nights using item-level dates for rooms
      const nights = isRoom && itemCheckIn && itemCheckOut
        ? Math.ceil((new Date(itemCheckOut) - new Date(itemCheckIn)) / 86400000)
        : 0

      // For cottages/events, price doesn't multiply by nights
      const totalPrice = isRoom
        ? item.price * requestedQty * (nights > 0 ? nights : 1)
        : item.price * requestedQty

      // Get numeric inventory_item_id
      const itemIdValue = item.item_id || item.id
      let numericItemId = null

      if (isNaN(itemIdValue)) {
        const categoryName = item.swimmingDetails ? 'Swimming' : (item.category || 'Room')
        const [inventoryItem] = await connection.query(
          'SELECT item_id FROM inventory_items WHERE category = ? LIMIT 1',
          [categoryName]
        )

        if (inventoryItem.length > 0) {
          numericItemId = inventoryItem[0].item_id
        }
      } else {
        numericItemId = parseInt(itemIdValue)
      }

      // Determine item type
      const itemType = item.swimmingDetails ? 'Swimming' : (item.category || 'Room')
      const itemName = item.swimmingDetails
        ? (item.name || 'Swimming Lesson Package')
        : (item.name || 'Item')

      console.log(`📦 Adding booking item: ${itemType} - ${itemName} [${bookingType}]`)

      // For swimming bookings, use participants; otherwise use guests
      const guestCount = item.swimmingDetails && item.swimmingDetails.participants
        ? item.swimmingDetails.participants
        : (item.guests || 0)

      const itemExtraPersonFee = Number((item.extra_person_fee ?? item.extraPersonFee) || 0)
      const itemExtraPersonCount = Number((item.extra_person_count ?? item.extraPersonCount) || 0)
      const itemDescriptionPayload = item.swimmingDetails ? { ...item.swimmingDetails } : {}

      const itemMeta = {
        extraPersonFee: itemExtraPersonFee,
        extraPersonCount: itemExtraPersonCount,
        extraPersonBreakdown: item.extra_person_breakdown ?? item.extraPersonBreakdown ?? null,
        durationHours: item.duration_hours ?? item.durationHours ?? null,
        capacity: item.capacity ?? item.roomCapacity ?? item.item?.maxGuests ?? item.item?.capacity ?? null,
        location: item.location || null,
        bookingType: bookingType,
        guestBreakdown: item.guest_breakdown || item.guestBreakdown || null,
        payingGuests: item.paying_guests || item.payingGuests || null
      }

      Object.entries(itemMeta).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          itemDescriptionPayload[key] = value
        }
      })

      const itemDescription = Object.keys(itemDescriptionPayload).length > 0
        ? JSON.stringify(itemDescriptionPayload)
        : null

      if (isRoom && !item.swimmingDetails) {
        // For rooms: use item-level dates if available, otherwise fall back to booking-level dates
        const roomCheckIn = itemCheckIn || normalizedCheckIn
        const roomCheckOut = itemCheckOut || normalizedCheckOut
        const roomNights = roomCheckIn && roomCheckOut
          ? Math.ceil((new Date(roomCheckOut) - new Date(roomCheckIn)) / 86400000)
          : nights

        const requestedIds = Array.isArray(item.selectedInventoryItemIds)
          ? item.selectedInventoryItemIds.map(id => Number(id)).filter(Number.isFinite)
          : []

        let candidateParams = []
        let candidateFilter = ''
        const isDirectIdBooking = requestedIds.length > 0

        if (isDirectIdBooking) {
          candidateFilter = ` AND ii.item_id IN (${requestedIds.map(() => '?').join(', ')})`
          candidateParams = requestedIds
        } else if (numericItemId) {
          candidateFilter = ' AND ii.item_id = ?'
          candidateParams = [numericItemId]
        }

        // Log for debugging
        console.log(`🔍 Checking availability for: "${item.name}", Category: ${itemType}, Item ID: ${numericItemId}`)
        if (candidateFilter) {
          console.log(`🔧 Using inventory filter: ${candidateFilter} with params`, candidateParams)
        }
        console.log(`📅 Date range: ${roomCheckIn} to ${roomCheckOut}`)
        let availableUnits = []
        if (isDirectIdBooking) {
          const [availableByIds] = await connection.query(
            `SELECT ii.item_id
             FROM inventory_items ii
             WHERE LOWER(COALESCE(ii.status, '')) NOT IN ('under maintenance', 'maintenance')
               ${candidateFilter}
               AND ii.item_id NOT IN (
                 SELECT bi.inventory_item_id
                 FROM booking_items bi
                 INNER JOIN bookings b ON b.booking_id = bi.booking_id
                 WHERE bi.inventory_item_id IS NOT NULL
                   AND b.booking_status IN ('Confirmed', 'Pending')
                   AND COALESCE(b.payment_status, 'Unpaid') IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
                   AND b.check_in_date < ?
                   AND b.check_out_date > ?
               )
             ORDER BY ii.item_id ASC
             LIMIT ?`,
            [
              ...candidateParams,
              roomCheckOut,
              roomCheckIn,
              requestedQty
            ]
          )
          availableUnits = availableByIds
          console.log(`✅ Found ${availableUnits.length} available unit(s) by direct inventory IDs`)
        } else {
          const [availableByName] = await connection.query(
            `SELECT ii.item_id
             FROM inventory_items ii
             WHERE LOWER(TRIM(ii.name)) = LOWER(TRIM(?))
               AND LOWER(COALESCE(ii.status, '')) NOT IN ('under maintenance', 'maintenance')
               ${candidateFilter}
               AND ii.item_id NOT IN (
                 SELECT bi.inventory_item_id
                 FROM booking_items bi
                 INNER JOIN bookings b ON b.booking_id = bi.booking_id
                 WHERE bi.inventory_item_id IS NOT NULL
                   AND b.booking_status IN ('Confirmed', 'Pending')
                   AND COALESCE(b.payment_status, 'Unpaid') IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
                   AND b.check_in_date < ?
                   AND b.check_out_date > ?
               )
             ORDER BY ii.item_id ASC
             LIMIT ?`,
            [
              item.name || 'Item',
              ...candidateParams,
              roomCheckOut,
              roomCheckIn,
              requestedQty
            ]
          )
          availableUnits = availableByName
          console.log(`✅ Found ${availableUnits.length} available unit(s) by name match`)
        }

        // If no exact name match, try by category (fallback)
        if (availableUnits.length < requestedQty) {
          console.log(`⚠️ Exact name match returned 0 results, trying category fallback...`)
          const [availableByCategory] = await connection.query(
            `SELECT ii.item_id
             FROM inventory_items ii
             WHERE LOWER(TRIM(ii.category)) = LOWER(TRIM(?))
               AND LOWER(COALESCE(ii.status, '')) NOT IN ('under maintenance', 'maintenance')
               ${candidateFilter}
               AND ii.item_id NOT IN (
                 SELECT bi.inventory_item_id
                 FROM booking_items bi
                 INNER JOIN bookings b ON b.booking_id = bi.booking_id
                 WHERE bi.inventory_item_id IS NOT NULL
                   AND b.booking_status IN ('Confirmed', 'Pending')
                   AND COALESCE(b.payment_status, 'Unpaid') IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
                   AND b.check_in_date < ?
                   AND b.check_out_date > ?
               )
             ORDER BY ii.item_id ASC
             LIMIT ?`,
            [
              itemType,
              ...candidateParams,
              roomCheckOut,
              roomCheckIn,
              requestedQty
            ]
          )
          availableUnits = availableByCategory
          console.log(`✅ Found ${availableUnits.length} available unit(s) by category match`)
        }

        if (availableUnits.length < requestedQty) {
          console.log(`❌ Insufficient units: Requested ${requestedQty}, Available ${availableUnits.length}`)
          await connection.rollback()
          return res.status(409).json({
            success: false,
            error: 'Not enough available rooms for the selected dates',
            item_name: itemName,
            requested_quantity: requestedQty,
            available_quantity: availableUnits.length,
            debug_info: {
              searched_name: item.name,
              searched_category: itemType,
              check_in: roomCheckIn,
              check_out: roomCheckOut
            }
          })
        }

        const guestsPerUnit = guestCount > 0 ? Math.max(1, Math.ceil(guestCount / requestedQty)) : 0

        for (const unit of availableUnits) {
          await connection.query(
            `INSERT INTO booking_items (
              booking_id,
              inventory_item_id,
              item_type,
              item_name,
              batch_id,
              schedule_id,
              coach_id,
              unit_price,
              quantity,
              guests,
              nights,
              total_price,
              per_night,
              item_description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              bookingId,
              unit.item_id,
              itemType,
              itemName,
              null,
              null,
              null,
              item.price,
              1,
              guestsPerUnit,
              roomNights,
              item.price * (roomNights > 0 ? roomNights : 1),
              true,
              itemDescription
            ]
          )
        }

        console.log(`🏨 Reserved ${availableUnits.length} unit(s) for ${itemName}`)
        continue
      }

      await connection.query(
        `INSERT INTO booking_items (
          booking_id, 
          inventory_item_id, 
          item_type,
          item_name,
          batch_id,
          schedule_id,
          coach_id,
          unit_price, 
          quantity, 
          guests,
          nights,
          total_price,
          per_night,
          item_description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          numericItemId,
          itemType,
          itemName,
          item.batch_id || null,
          item.schedule_id || null,
          item.coach_id || null,
          item.price,
          requestedQty,
          guestCount,
          isRoom ? nights : 0,
          totalPrice,
          isRoom,
          itemDescription
        ]
      );

      console.log(`📦 Added item to booking: ${itemName}, Qty: ${requestedQty}, Guests: ${guestCount}`)

      // Handle occupied dates based on booking type
      if (item.swimmingDetails) {
        // Swimming: use swimming dates from item details
        const swimmingDates = Array.isArray(item.swimmingDetails.dates)
          ? item.swimmingDetails.dates.map(date => [numericItemId, bookingId, date])
          : []

        if (numericItemId && swimmingDates.length > 0) {
          await connection.query(
            'INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES ?',
            [swimmingDates]
          )

          console.log(`🏊 Added ${swimmingDates.length} swimming session dates to occupied_dates`)
        } else {
          console.warn(`⚠️ No numeric item ID found for swimming, skipping occupied_dates`)
        }
      } else if (isRoom && itemCheckIn && itemCheckOut) {
        // Room: use item-level dates for availability check
        const roomCheckIn = itemCheckIn
        const roomCheckOut = itemCheckOut
        const itemId = item.item_id || item.id

        // Check for conflicts using bookings table
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
          [itemId, roomCheckOut, roomCheckIn, roomCheckIn, roomCheckOut, roomCheckIn, roomCheckOut]
        )

        if (conflicts.length > 0) {
          const conflictInfo = conflicts.map(c =>
            `${c.booking_reference} (${c.check_in_date} to ${c.check_out_date})`
          ).join(', ')

          console.warn(`⚠️ Room availability issues detected for item ${itemId}: ${conflictInfo}`)
          console.log(`✅ Room booking stored anyway; source of truth is bookings table`)
        } else {
          console.log(`✅ Room availability verified for item ${itemId} from ${roomCheckIn} to ${roomCheckOut}`)
        }
      } else if ((isCottage || isEvent) && itemBookingDate) {
        // Cottage/Event: use booking date only (single-day occupancy)
        console.log(`✅ ${bookingType} booking date set to ${itemBookingDate}; marking as occupied for that date`)
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

    // Mark payment as paid and confirm the booking immediately after successful payment
    if (status === 'paid') {
      await db.query(
        'UPDATE bookings SET payment_status = ?, booking_status = ? WHERE booking_id = ?',
        ['Paid', 'Pending', bookingId]
      );

      await db.query(
        'INSERT INTO booking_logs (booking_id, action, description, performed_by) VALUES (?, ?, ?, ?)',
        [bookingId, 'Payment Received', `Payment completed via ${paymentIntentId}. Booking confirmed.`, 'System']
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
