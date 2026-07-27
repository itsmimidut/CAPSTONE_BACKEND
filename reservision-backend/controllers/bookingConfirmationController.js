import db from '../config/db.js';
import { generateQRCode, formatBookingDataForQR } from '../services/qrCodeService.js';
import { sendBookingConfirmationWithQR } from '../services/emailService.js';
import { isCashPaymentMethod } from '../services/paymentRecordService.js';
import { assertBookingAccess } from '../middleware/ownership.js';
import {
  checkAvailability,
  normalizeDateValue,
  normalizeTimeValue
} from '../services/availabilityService.js';
import {
  assertInventoryItemsBookable,
  UNAVAILABLE_BOOKING_MESSAGE,
} from '../services/inventoryBookabilityService.js';
import {
  calculateBookingTotal,
  mapCheckoutItemToPricingPayload,
  getBookingPricingColumnSets,
  buildBookingItemPricingFields,
} from '../services/reservationPricingService.js';
import { computeEntranceFeeForBookingItems } from '../services/entranceFeeService.js';
import { computeExtraPersonFeeForBookingItems } from '../services/extraPersonFeeService.js';
import { getInitialBookingPaymentState } from '../services/bookingPaymentLifecycle.js';

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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
  let normalizedCheckoutToken = '';

  try {
    await connection.beginTransaction();

    const { guest, checkIn, checkOut, items, paymentMethod, subtotal = 0, total = 0, userId, isSwimmingOnly, entranceFee = 0, extraPersonFee = 0, promo_id = null, promo_code = null, checkoutToken = null } = req.body;
    normalizedCheckoutToken = String(checkoutToken || '').trim();

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

    if (normalizedCheckoutToken && !/^[A-Za-z0-9-]{16,64}$/.test(normalizedCheckoutToken)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        code: 'INVALID_CHECKOUT_TOKEN',
        error: 'Invalid checkout token.',
      });
    }

    if (normalizedCheckoutToken) {
      const [existingRows] = await connection.query(
        `SELECT booking_id, booking_reference, customer_id, total, booking_status, payment_status
         FROM bookings
         WHERE checkout_token = ?
         LIMIT 1`,
        [normalizedCheckoutToken],
      );
      const existing = existingRows[0];
      if (existing) {
        await connection.rollback();
        if (
          existing.booking_status === 'Pending'
          && existing.payment_status !== 'Paid'
        ) {
          return res.json({
            success: true,
            reused: true,
            message: 'Existing pending booking reused.',
            data: {
              bookingId: existing.booking_id,
              bookingReference: existing.booking_reference,
              customerId: existing.customer_id,
              total: Number(existing.total || 0),
              status: 'pending',
            },
          });
        }
        return res.status(409).json({
          success: false,
          code: 'CHECKOUT_TOKEN_NOT_REUSABLE',
          error: 'This checkout attempt is already closed. Start a new checkout attempt.',
        });
      }
    }

    const hasRoomItems = Array.isArray(items) && items.some(
      item => (item.booking_type || item.bookingType || 'room') === 'room'
    );

    // Skip date validation for swimming-only or non-room bookings (e.g. event areas)
    if (!isSwimmingOnly && hasRoomItems && (!checkIn || !checkOut)) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Check-in and check-out dates are required' });
    }

    // Validate and normalize dates to ISO format (YYYY-MM-DD)
    let normalizedCheckIn = checkIn;
    let normalizedCheckOut = checkOut;

    if (!isSwimmingOnly && hasRoomItems && checkIn && checkOut) {
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

    const eventOnlyItems = Array.isArray(items)
      ? items.filter(item => (item.booking_type || item.bookingType) === 'event')
      : [];

    if (!isSwimmingOnly && !hasRoomItems && eventOnlyItems.length > 0) {
      const firstEventDate = normalizeDateValue(
        eventOnlyItems[0].booking_date || eventOnlyItems[0].bookingDate
      );
      if (firstEventDate) {
        normalizedCheckIn = firstEventDate;
        normalizedCheckOut = firstEventDate;
      }
    }

    if (!items || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'At least one booking item is required' });
    }

    const pricingPayloadItems = items.map((item) => mapCheckoutItemToPricingPayload({
      ...item,
      swimmingDetails: item.swimmingDetails,
    }, {
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      promo_id,
      promo_code,
    }));

    const entranceFeeResult = await computeEntranceFeeForBookingItems({
      items,
      defaultDate: normalizedCheckIn,
      connection,
    });
    if (!entranceFeeResult.success) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: entranceFeeResult.error || 'Failed to calculate entrance fees.',
      });
    }
    const authoritativeEntranceFee = entranceFeeResult.total;
    const extraPersonFeeResult = await computeExtraPersonFeeForBookingItems({
      items,
      connection,
    });
    const authoritativeExtraPersonFee = extraPersonFeeResult.total;

    const pricingResult = await calculateBookingTotal(pricingPayloadItems, {
      promo_id,
      promo_code,
      entrance_fee: authoritativeEntranceFee,
      extra_person_fee: authoritativeExtraPersonFee,
    }, connection);

    if (!pricingResult.success) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: pricingResult.message || 'Failed to calculate booking price.' });
    }

    const pricedItems = pricingResult.data.items;
    const backendSubtotal = pricingResult.data.subtotal;
    const backendTotal = pricingResult.data.total;
    const pricingColumnSets = await getBookingPricingColumnSets(connection);

    const appendPricingFields = (fields, values, priced) => {
      const pricing = buildBookingItemPricingFields(priced, pricingColumnSets.bookingItems);
      fields.push(...pricing.fields);
      values.push(...pricing.values);
    };

    const [bookingColumns] = await connection.query(
      `SHOW COLUMNS FROM bookings WHERE Field IN
        ('entrance_fee', 'extra_person_fee', 'total_guests', 'seniors', 'infants',
         'guest_breakdown_provided', 'guest_breakdown_type')`
    )
    const bookingColumnNames = bookingColumns.map(col => col.Field)
    const hasBookingEntranceFee = bookingColumnNames.includes('entrance_fee')
    const hasBookingExtraPersonFee = bookingColumnNames.includes('extra_person_fee')
    const hasBookingGuestBreakdown = bookingColumnNames.includes('total_guests')
      && bookingColumnNames.includes('guest_breakdown_provided')

    // Aggregate guest breakdown across all items for booking-level summary
    const bookingBreakdown = (Array.isArray(items) ? items : []).reduce((acc, item) => {
      const provided = Number(item.guest_breakdown_provided) === 1
        || item.guest_breakdown_provided === true
      const adults = Number(item.adults || 0)
      const children = Number(item.children || 0)
      const seniors = Number(item.seniors || 0)
      const infants = Number(item.infants || 0)
      const totalGuests = Number(item.total_guests || item.guests || 0)

      acc.totalGuests += totalGuests
      acc.seniors += seniors
      acc.infants += infants
      if (provided && (adults + children + seniors + infants) > 0) {
        acc.anyProvided = true
        if (item.guest_breakdown_type && item.guest_breakdown_type !== 'not_provided') {
          acc.types.add(item.guest_breakdown_type)
        }
      }
      return acc
    }, { totalGuests: 0, seniors: 0, infants: 0, anyProvided: false, types: new Set() })

    const bookingBreakdownType = !bookingBreakdown.anyProvided
      ? 'not_provided'
      : (bookingBreakdown.types.has('estimated') ? 'estimated' : 'exact')

    if (bookingBreakdown.totalGuests < 1) {
      await connection.rollback()
      return res.status(400).json({
        success: false,
        code: 'GUESTS_REQUIRED',
        error: 'Please select at least one guest before continuing.',
      })
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

    // Reject unavailable inventory before any booking insert or side effects.
    // Swimming / non-inventory items are skipped (no numeric inventory_item_id).
    const inventoryIdsToGuard = []
    for (const item of items) {
      if (item?.swimmingDetails) continue
      const rawId = item?.item_id ?? item?.id
      const numericId = Number(rawId)
      if (Number.isFinite(numericId) && numericId > 0) {
        inventoryIdsToGuard.push(numericId)
      }
      if (Array.isArray(item?.selectedInventoryItemIds)) {
        for (const selectedId of item.selectedInventoryItemIds) {
          const n = Number(selectedId)
          if (Number.isFinite(n) && n > 0) inventoryIdsToGuard.push(n)
        }
      }
    }
    const bookability = await assertInventoryItemsBookable(connection, inventoryIdsToGuard)
    if (!bookability.ok) {
      await connection.rollback()
      return res.status(409).json({
        success: false,
        message: bookability.message || UNAVAILABLE_BOOKING_MESSAGE,
      })
    }

    const itemGuestTotal = Array.isArray(items)
      ? items.reduce((sum, item) => {
          const guests = Number(item.guests || item.guest_count || 0);
          return sum + (Number.isFinite(guests) ? guests : 0);
        }, 0)
      : 0;

    const bookingAdults = Math.max(0, Number(guest.adults || 0));
    const bookingChildren = Number(guest.children || 0);

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
      bookingAdults,
      bookingChildren,
      guest.arrivalTime || null,
      guest.specialRequests || '',
      backendSubtotal
    ]

    if (normalizedCheckoutToken) {
      bookingFields.push('checkout_token');
      bookingValues.push(normalizedCheckoutToken);
    }

    if (pricingColumnSets.bookings.has('pricing_total')) {
      bookingFields.splice(bookingFields.indexOf('subtotal') + 1, 0, 'pricing_total');
      bookingValues.splice(bookingValues.indexOf(backendSubtotal) + 1, 0, backendTotal);
    }

    if (hasBookingEntranceFee) {
      bookingFields.push('entrance_fee')
      bookingValues.push(authoritativeEntranceFee)
    }

    if (hasBookingExtraPersonFee) {
      bookingFields.push('extra_person_fee')
      bookingValues.push(authoritativeExtraPersonFee)
    }

    if (hasBookingGuestBreakdown) {
      bookingFields.push(
        'total_guests',
        'seniors',
        'infants',
        'guest_breakdown_provided',
        'guest_breakdown_type'
      )
      bookingValues.push(
        bookingBreakdown.totalGuests || itemGuestTotal || 0,
        bookingBreakdown.seniors || 0,
        bookingBreakdown.infants || 0,
        bookingBreakdown.anyProvided ? 1 : 0,
        bookingBreakdownType
      )
    }

    const initialPaymentState = getInitialBookingPaymentState(paymentMethod);
    bookingFields.push('total', 'booking_status', 'payment_status', 'payment_method')
    bookingValues.push(
      backendTotal,
      initialPaymentState.bookingStatus,
      initialPaymentState.paymentStatus,
      paymentMethod || 'xendit',
    )

    const [bookingResult] = await connection.query(
      `INSERT INTO bookings (${bookingFields.join(', ')}) VALUES (${bookingFields.map(() => '?').join(', ')})`,
      bookingValues
    );

    const bookingId = bookingResult.insertId;

    // Detect guest-breakdown columns on booking_items (migration may not be applied yet)
    const [itemBreakdownColumns] = await connection.query(
      `SHOW COLUMNS FROM booking_items WHERE Field IN
        ('total_guests', 'adults', 'children', 'seniors', 'infants',
         'guest_breakdown_provided', 'guest_breakdown_type')`
    );
    const itemBreakdownColumnNames = new Set(itemBreakdownColumns.map(col => col.Field));
    const hasItemGuestBreakdown = itemBreakdownColumnNames.has('total_guests')
      && itemBreakdownColumnNames.has('adults')
      && itemBreakdownColumnNames.has('guest_breakdown_provided');

    // Normalize per-item guest breakdown -> { fields:[], values:[] } to append to any insert.
    // Rule: never copy total_guests into adults. adults holds actual adult count only.
    const buildBreakdownInsert = (item, fallbackGuests) => {
      if (!hasItemGuestBreakdown) return { fields: [], values: [] };

      const provided = Number(item.guest_breakdown_provided) === 1
        || item.guest_breakdown_provided === true;
      const adults = Math.max(0, Number(item.adults || 0));
      const children = Math.max(0, Number(item.children || 0));
      const seniors = Math.max(0, Number(item.seniors || 0));
      const infants = Math.max(0, Number(item.infants || 0));
      const breakdownSum = adults + children + seniors + infants;

      const totalGuests = provided && breakdownSum > 0
        ? breakdownSum
        : Number(item.total_guests || fallbackGuests || item.guests || 0);

      const typeRaw = String(item.guest_breakdown_type || '').toLowerCase();
      const guestBreakdownType = (provided && breakdownSum > 0)
        ? (['exact', 'estimated'].includes(typeRaw) ? typeRaw : 'estimated')
        : 'not_provided';

      return {
        fields: [
          'total_guests', 'adults', 'children', 'seniors', 'infants',
          'guest_breakdown_provided', 'guest_breakdown_type'
        ],
        values: [
          totalGuests,
          provided ? adults : 0,
          provided ? children : 0,
          provided ? seniors : 0,
          provided ? infants : 0,
          (provided && breakdownSum > 0) ? 1 : 0,
          guestBreakdownType
        ]
      };
    };

    // Step 4: Add booking items
    for (let pricedIndex = 0; pricedIndex < items.length; pricedIndex += 1) {
      const item = items[pricedIndex];
      const priced = pricedItems[pricedIndex] || null;
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

      // Backend-authoritative pricing (ignores frontend-submitted line totals)
      const totalPrice = priced?.final_subtotal ?? (
        isRoom
          ? item.price * requestedQty * (nights > 0 ? nights : 1)
          : item.price * requestedQty
      );
      const unitPrice = priced?.unit_price ?? item.price;

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

      if (!item.swimmingDetails && numericItemId) {
        const requestedCategory = isEvent ? 'event' : (isCottage ? 'cottage' : 'room');

        const roomCheckIn = normalizeDateValue(itemCheckIn || normalizedCheckIn);
        const roomCheckOut = normalizeDateValue(itemCheckOut || normalizedCheckOut);
        const cottageDate = normalizeDateValue(itemBookingDate || itemCheckIn || normalizedCheckIn);
        const eventDate = normalizeDateValue(item.booking_date || item.bookingDate || itemBookingDate);
        const eventStartTime = normalizeTimeValue(item.start_time || item.startTime);
        const eventEndTime = normalizeTimeValue(item.end_time || item.endTime);

        const availabilityPayload = {
          inventory_item_id: numericItemId,
          category_type: requestedCategory
        };

        if (requestedCategory === 'room') {
          availabilityPayload.check_in_date = roomCheckIn;
          availabilityPayload.check_out_date = roomCheckOut;
        } else if (requestedCategory === 'cottage') {
          availabilityPayload.booking_date = cottageDate;
        } else if (requestedCategory === 'event') {
          availabilityPayload.booking_date = eventDate;
          availabilityPayload.start_time = eventStartTime;
          availabilityPayload.end_time = eventEndTime;
        }

        const availability = await checkAvailability(availabilityPayload, connection);
        if (availability.success === false) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            reason: availability.reason || 'INVALID_REQUEST',
            message: availability.message || 'Invalid availability check payload.'
          });
        }

        if (!availability.available) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            reason: availability.reason || 'BOOKING_CONFLICT',
            message: availability.message || 'This item is no longer available.',
            conflict: availability.conflict || null
          });
        }
      }

      // Determine item type
      const itemType = item.swimmingDetails
        ? 'Swimming'
        : isEvent
          ? 'Event'
          : isCottage
            ? 'Cottage'
            : (item.category || 'Room');
      const itemName = item.swimmingDetails
        ? (item.name || 'Swimming Lesson Package')
        : (item.name || 'Item')

      console.log(`📦 Adding booking item: ${itemType} - ${itemName} [${bookingType}]`)

      // For swimming bookings, use participants; otherwise use guests
      const guestCount = item.swimmingDetails && item.swimmingDetails.participants
        ? item.swimmingDetails.participants
        : isEvent
          ? Number(item.guests || item.guest_count || 0)
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
             WHERE LOWER(TRIM(COALESCE(ii.status, ''))) = 'available'
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
               AND LOWER(TRIM(COALESCE(ii.status, ''))) = 'available'
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
               AND LOWER(TRIM(COALESCE(ii.status, ''))) = 'available'
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
        const perUnitTotalPrice = roundMoney(totalPrice / requestedQty)
        let roomUnitIndex = 0

        for (const unit of availableUnits) {
          // Distribute the guest breakdown across units (per-unit share).
          const perUnitItem = requestedQty > 1
            ? {
                ...item,
                total_guests: guestsPerUnit,
                adults: Math.ceil(Number(item.adults || 0) / requestedQty),
                children: Math.ceil(Number(item.children || 0) / requestedQty),
                seniors: Math.ceil(Number(item.seniors || 0) / requestedQty),
                infants: Math.ceil(Number(item.infants || 0) / requestedQty)
              }
            : item
          const roomBreakdown = buildBreakdownInsert(perUnitItem, guestsPerUnit)
          const roomFields = [
            'booking_id', 'inventory_item_id', 'item_type', 'item_name',
            'batch_id', 'schedule_id', 'coach_id', 'unit_price', 'quantity',
            'guests', 'nights', 'total_price', 'per_night', 'item_description',
            ...roomBreakdown.fields
          ]
          const roomValues = [
            bookingId,
            unit.item_id,
            itemType,
            itemName,
            null,
            null,
            null,
            unitPrice,
            1,
            guestsPerUnit,
            roomNights,
            perUnitTotalPrice,
            true,
            itemDescription,
            ...roomBreakdown.values
          ]
          appendPricingFields(roomFields, roomValues, roomUnitIndex === 0 ? priced : null)
          roomUnitIndex += 1
          await connection.query(
            `INSERT INTO booking_items (${roomFields.join(', ')}) VALUES (${roomFields.map(() => '?').join(', ')})`,
            roomValues
          )
        }

        console.log(`🏨 Reserved ${availableUnits.length} unit(s) for ${itemName}`)
        continue
      }

      if (isEvent && !item.swimmingDetails) {
        const eventDate = normalizeDateValue(item.booking_date || item.bookingDate || itemBookingDate);
        const eventStartTime = normalizeTimeValue(item.start_time || item.startTime);
        const eventEndTime = normalizeTimeValue(item.end_time || item.endTime);
        const eventPurpose = String(item.purpose || item.event_purpose || '').trim() || null;

        if (!numericItemId) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: `Unable to resolve inventory item for ${itemName}`
          });
        }

        const [areaRows] = await connection.query(
          'SELECT max_guests, name FROM inventory_items WHERE item_id = ? LIMIT 1',
          [numericItemId]
        );
        const areaCapacity = Number(areaRows[0]?.max_guests || 0);
        if (areaCapacity > 0 && guestCount > areaCapacity) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: `This area can only accommodate up to ${areaCapacity} guests.`
          });
        }

        itemDescriptionPayload.booking_date = eventDate;
        itemDescriptionPayload.start_time = eventStartTime;
        itemDescriptionPayload.end_time = eventEndTime;
        itemDescriptionPayload.purpose = eventPurpose;
        itemDescriptionPayload.event_type = item.event_type || item.eventType || eventPurpose;
        itemDescriptionPayload.custom_event_type = item.custom_event_type || item.customEventType || null;
        itemDescriptionPayload.notes = String(item.notes || item.special_request || '').trim() || null;
        itemDescriptionPayload.rate_type = item.rate_type || item.rateType || null;

        const eventItemDescription = Object.keys(itemDescriptionPayload).length > 0
          ? JSON.stringify(itemDescriptionPayload)
          : null;

        const [scheduleColumns] = await connection.query(
          `SHOW COLUMNS FROM booking_items WHERE Field IN ('booking_date', 'start_time', 'end_time', 'event_purpose')`
        );
        const scheduleColumnNames = new Set(scheduleColumns.map(col => col.Field));
        const hasScheduleColumns = scheduleColumnNames.has('booking_date')
          && scheduleColumnNames.has('start_time')
          && scheduleColumnNames.has('end_time');

        const eventBreakdown = buildBreakdownInsert(item, guestCount);

        if (hasScheduleColumns) {
          const insertFields = [
            'booking_id', 'inventory_item_id', 'item_type', 'item_name',
            'unit_price', 'quantity', 'guests', 'nights', 'total_price', 'per_night', 'item_description'
          ];
          const insertValues = [
            bookingId,
            numericItemId,
            itemType,
            itemName,
            unitPrice,
            1,
            guestCount,
            0,
            totalPrice,
            false,
            eventItemDescription
          ];

          if (scheduleColumnNames.has('booking_date')) {
            insertFields.push('booking_date');
            insertValues.push(eventDate);
          }
          if (scheduleColumnNames.has('start_time')) {
            insertFields.push('start_time');
            insertValues.push(eventStartTime);
          }
          if (scheduleColumnNames.has('end_time')) {
            insertFields.push('end_time');
            insertValues.push(eventEndTime);
          }
          if (scheduleColumnNames.has('event_purpose')) {
            insertFields.push('event_purpose');
            insertValues.push(eventPurpose);
          }

          insertFields.push(...eventBreakdown.fields);
          insertValues.push(...eventBreakdown.values);
          appendPricingFields(insertFields, insertValues, priced);

          await connection.query(
            `INSERT INTO booking_items (${insertFields.join(', ')}) VALUES (${insertFields.map(() => '?').join(', ')})`,
            insertValues
          );
        } else {
          const fallbackFields = [
            'booking_id', 'inventory_item_id', 'item_type', 'item_name',
            'unit_price', 'quantity', 'guests', 'nights', 'total_price', 'per_night', 'item_description',
            ...eventBreakdown.fields
          ];
          const fallbackValues = [
            bookingId,
            numericItemId,
            itemType,
            itemName,
            unitPrice,
            1,
            guestCount,
            0,
            totalPrice,
            false,
            eventItemDescription,
            ...eventBreakdown.values
          ];
          appendPricingFields(fallbackFields, fallbackValues, priced);
          await connection.query(
            `INSERT INTO booking_items (${fallbackFields.join(', ')}) VALUES (${fallbackFields.map(() => '?').join(', ')})`,
            fallbackValues
          );
        }

        if (eventDate) {
          await connection.query(
            'INSERT IGNORE INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES (?, ?, ?)',
            [numericItemId, bookingId, eventDate]
          );
        }

        console.log(`🎪 Reserved event area ${itemName} on ${eventDate} ${eventStartTime}-${eventEndTime}`);
        continue;
      }

      const genericBreakdown = buildBreakdownInsert(item, guestCount);
      const genericFields = [
        'booking_id', 'inventory_item_id', 'item_type', 'item_name',
        'batch_id', 'schedule_id', 'coach_id', 'unit_price', 'quantity',
        'guests', 'nights', 'total_price', 'per_night', 'item_description',
        ...genericBreakdown.fields
      ];
      const genericValues = [
        bookingId,
        numericItemId,
        itemType,
        itemName,
        item.batch_id || null,
        item.schedule_id || null,
        item.coach_id || null,
        unitPrice,
        requestedQty,
        guestCount,
        isRoom ? nights : 0,
        totalPrice,
        isRoom,
        itemDescription,
        ...genericBreakdown.values
      ];
      appendPricingFields(genericFields, genericValues, priced);
      await connection.query(
        `INSERT INTO booking_items (${genericFields.join(', ')}) VALUES (${genericFields.map(() => '?').join(', ')})`,
        genericValues
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

    // Step 5: Create payment record only for cash bookings.
    // Online/Xendit payments are recorded when /api/xendit/create-payment runs.
    let paymentId = null;
    let paymentReference = null;

    if (isCashPaymentMethod(paymentMethod)) {
      paymentReference = `CASH-${bookingId}-${Date.now()}`;
      const [paymentResult] = await connection.query(
        `INSERT INTO payments (
          booking_id,
          customer_id,
          payment_reference,
          payment_method,
          payment_gateway,
          amount,
          status,
          currency,
          created_at
        ) VALUES (?, ?, ?, ?, 'manual', ?, 'pending', 'PHP', NOW())`,
        [bookingId, customerId, paymentReference, paymentMethod, backendTotal],
      );
      paymentId = paymentResult.insertId;
    }

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
    // Confirmation email with QR is sent by Xendit webhook after verified payment
    console.log('⏳ Email will be sent after payment is confirmed');

    // Return success response
    res.json({
      success: true,
      message: 'Booking created successfully',
      data: {
        bookingId,
        bookingReference,
        customerId,
        paymentId,
        paymentReference,
        total: backendTotal,
        status: 'pending',
        qrCode: qrCodeData ? {
          url: qrCodeData.url,
          filename: qrCodeData.filename
        } : null
      }
    });

  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY' && normalizedCheckoutToken) {
      const [existingRows] = await db.query(
        `SELECT booking_id, booking_reference, customer_id, total, booking_status, payment_status
         FROM bookings
         WHERE checkout_token = ?
         LIMIT 1`,
        [normalizedCheckoutToken],
      );
      const existing = existingRows[0];
      if (existing?.booking_status === 'Pending' && existing?.payment_status !== 'Paid') {
        return res.json({
          success: true,
          reused: true,
          message: 'Existing pending booking reused.',
          data: {
            bookingId: existing.booking_id,
            bookingReference: existing.booking_reference,
            customerId: existing.customer_id,
            total: Number(existing.total || 0),
            status: 'pending',
          },
        });
      }
    }
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
 * Get Booking Details with Customer and Payment Info
 * GET /api/bookings/:id/details
 */
export const getBookingDetails = async (req, res) => {
  try {
    const bookingId = req.params.id;

    const hasAccess = await assertBookingAccess(req, res, bookingId);
    if (!hasAccess) return;

    const [bookings] = await db.query(
      `SELECT 
        b.*,
        c.first_name, c.last_name, c.email, c.phone, c.address, c.city, c.country, c.postal_code,
        p.payment_reference, p.payment_method, p.amount as payment_amount, p.status as payment_status,
        p.paid_at, p.checkout_url
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.customer_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      WHERE b.booking_id = ?`,
      [bookingId]
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
      [bookingId]
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
