/**
 * ============================================================
 * Room Grouping & Auto-Assignment Service
 * ============================================================
 * 
 * Purpose:
 * - Handle grouped room display logic
 * - Atomically assign first available room for date range
 * - Prevent double booking with transactions and locks
 * - Query optimization for room availability
 *
 * Status lifecycle (inventory_items.status ENUM):
 * - Available — operational / bookable; future stays use occupied_dates
 * - Occupied — currently in use (admin/manual or operational flag)
 * - Under Maintenance — not bookable
 *
 * Auto-assignment must NOT write invalid values (e.g. "Booked").
 * Date occupancy is owned by occupied_dates (+ bookings), not status.
 */

import db from "../config/db.js";
import { isBookableInventoryStatus } from "./inventoryBookabilityService.js";

/**
 * Extract base room name from inventory item name
 * Examples:
 *   "FAMILY ROOM 1" -> "FAMILY ROOM"
 *   "DELUXE ROOM 2" -> "DELUXE ROOM"
 *   "SUITE 3" -> "SUITE"
 */
export const extractRoomBase = (roomName) => {
    // Remove trailing numbers and spaces
    return roomName.replace(/\s+\d+\s*$/, '').trim();
};

/**
 * GET GROUPED ROOMS FOR CUSTOMER DISPLAY
 * 
 * Returns one card per room type with:
 * - price, max_guests, description
 * - count of available rooms
 * - sample images
 * - list of all physical rooms
 */
export const getGroupedRooms = async () => {
    const query = `
    SELECT 
      SUBSTRING(name, 1, CHAR_LENGTH(name) - 2) AS room_type,
      MIN(name) AS sample_name,
      price,
      max_guests,
      description,
      COUNT(CASE WHEN status = 'Available' THEN 1 END) AS available_count,
      COUNT(*) AS total_rooms,
      MIN(item_id) AS primary_item_id,
      GROUP_CONCAT(images SEPARATOR '|||') AS images_list,
      category_type,
      JSON_ARRAYAGG(JSON_OBJECT(
        'item_id', item_id,
        'room_number', room_number,
        'name', name,
        'status', status
      )) AS all_rooms
    FROM inventory_items
    WHERE category_type = 'room'
      AND status IN ('Available', 'Occupied')
    GROUP BY SUBSTRING(name, 1, CHAR_LENGTH(name) - 2), price, max_guests, description, category_type
    ORDER BY price ASC
  `;

    try {
        const [rooms] = await db.query(query);

        return {
            success: true,
            data: rooms.map(room => ({
                room_type: room.room_type,
                price: parseFloat(room.price),
                max_guests: room.max_guests,
                description: room.description,
                available_count: room.available_count,
                total_rooms: room.total_rooms,
                primary_item_id: room.primary_item_id,
                images: room.images_list ? room.images_list.split('|||')[0] : null,
                all_rooms: JSON.parse(room.all_rooms || '[]')
            }))
        };
    } catch (error) {
        console.error('Error fetching grouped rooms:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * CHECK AVAILABILITY FOR ROOM TYPE & DATE RANGE
 * 
 * Returns list of available physical rooms for a given:
 * - Room type (e.g., "FAMILY ROOM")
 * - Check-in date
 * - Check-out date
 */
export const checkRoomAvailability = async (roomType, checkInDate, checkOutDate) => {
    const checkIn = checkInDate.toISOString().split('T')[0];
    const checkOut = checkOutDate.toISOString().split('T')[0];

    const query = `
    SELECT 
      ii.item_id,
      ii.name,
      ii.room_number,
      ii.status,
      COUNT(CASE WHEN od.occupied_date BETWEEN ? AND ? THEN 1 END) as booked_nights_in_range
    FROM inventory_items ii
    LEFT JOIN occupied_dates od ON ii.item_id = od.inventory_item_id
    WHERE SUBSTRING(ii.name, 1, CHAR_LENGTH(ii.name) - 2) = ?
      AND ii.category_type = 'room'
      AND ii.status = 'Available'
    GROUP BY ii.item_id, ii.name, ii.room_number, ii.status
    HAVING booked_nights_in_range = 0
    ORDER BY ii.item_id ASC
  `;

    try {
        const [rooms] = await db.query(query, [checkIn, checkOut, roomType]);
        const availableRooms = rooms.filter((room) => isBookableInventoryStatus(room.status));
        return {
            success: true,
            available_rooms: availableRooms,
            available_count: availableRooms.length
        };
    } catch (error) {
        console.error('Error checking availability:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * AUTO-ASSIGN FIRST AVAILABLE ROOM (ATOMIC TRANSACTION)
 * 
 * ⚠️ CRITICAL: Must be called within a database transaction
 * 
 * Process:
 * 1. Use FOR UPDATE lock to reserve an Available room with no date conflicts
 * 2. Re-assert bookable status (do not mutate physical status)
 * 3. Return assigned room details + stay date list
 *
 * Caller must insert occupied_dates AFTER the booking row exists
 * (live schema requires booking_id NOT NULL + FK).
 * 
 * @param {Connection} connection - MySQL connection (for transaction)
 * @param {string} roomType - Base room name (e.g., "FAMILY ROOM")
 * @param {Date} checkInDate - Check-in date
 * @param {Date} checkOutDate - Check-out date
 * @returns {Object} - {success: bool, item_id: int, room_name: string, occupied_dates?: string[], error?: string}
 */
export const autoAssignRoom = async (connection, roomType, checkInDate, checkOutDate) => {
    try {
        const checkIn = checkInDate.toISOString().split('T')[0];
        const checkOut = checkOutDate.toISOString().split('T')[0];
        const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

        // STEP 1: Find first Available room (row lock) excluding date conflicts
        const [availableRooms] = await connection.query(
            `SELECT item_id, name, price, status
       FROM inventory_items 
       WHERE category_type = 'room'
         AND SUBSTRING(name, 1, CHAR_LENGTH(name) - 2) = ?
         AND status = 'Available'
         AND item_id NOT IN (
           SELECT DISTINCT inventory_item_id 
           FROM occupied_dates 
           WHERE occupied_date BETWEEN ? AND ?
         )
       LIMIT 1
       FOR UPDATE`,
            [roomType, checkIn, checkOut]
        );

        if (!availableRooms.length) {
            return {
                success: false,
                error: `No available ${roomType} rooms for dates ${checkIn} to ${checkOut}`
            };
        }

        const assignedRoom = availableRooms[0];
        const itemId = assignedRoom.item_id;
        const roomName = assignedRoom.name;
        const roomPrice = assignedRoom.price;

        // STEP 2: Keep physical status Available — occupancy is date-based.
        // Never write invalid ENUM values such as "Booked".
        if (!isBookableInventoryStatus(assignedRoom.status)) {
            return {
                success: false,
                error: 'Room is no longer bookable - may have been taken by another user'
            };
        }

        // STEP 3: Build stay dates for the caller to persist with booking_id
        const datesList = [];
        const currentDate = new Date(checkInDate);

        while (currentDate < checkOutDate) {
            datesList.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return {
            success: true,
            item_id: itemId,
            room_name: roomName,
            room_price: parseFloat(roomPrice),
            nights: nights,
            occupied_dates: datesList,
            status_preserved: 'Available',
        };

    } catch (error) {
        console.error('Error auto-assigning room:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Persist occupied_dates for an assigned room after booking_id exists.
 */
export const insertOccupiedDatesForBooking = async (connection, {
  inventoryItemId,
  bookingId,
  dates = [],
}) => {
  const itemId = Number(inventoryItemId)
  const bid = Number(bookingId)
  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(bid) || bid <= 0) {
    throw new Error('inventoryItemId and bookingId are required')
  }

  for (const date of dates) {
    await connection.query(
      `INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date, created_at)
       VALUES (?, ?, ?, NOW())`,
      [itemId, bid, date]
    )
  }
};

/**
 * GENERATE BOOKING REFERENCE
 * 
 * Format: BK + YYYYMMDD + XXX (sequential)
 * Example: BK20260421001
 */
export const generateBookingReference = async () => {
    try {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

        // Get count of bookings created today
        const [rows] = await db.query(
            `SELECT COUNT(*) as count FROM bookings WHERE DATE(created_at) = CURDATE()`
        );

        const count = (rows[0]?.count || 0) + 1;
        const sequential = String(count).padStart(3, '0');

        return `BK${dateStr}${sequential}`;
    } catch (error) {
        console.error('Error generating booking reference:', error);
        throw error;
    }
};

/**
 * VALIDATE BOOKING DATES
 * 
 * Check if:
 * - Check-out is after check-in
 * - Check-in is not in the past
 * - Date range is reasonable (max 30 days)
 */
export const validateBookingDates = (checkInDate, checkOutDate) => {
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if check-in is in the future
    if (checkIn < today) {
        return {
            valid: false,
            error: 'Check-in date must be in the future'
        };
    }

    // Check if check-out is after check-in
    if (checkOut <= checkIn) {
        return {
            valid: false,
            error: 'Check-out date must be after check-in date'
        };
    }

    // Check max stay duration (30 days)
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (nights > 30) {
        return {
            valid: false,
            error: 'Maximum stay is 30 nights'
        };
    }

    return {
        valid: true,
        nights: nights
    };
};

/**
 * GET ROOM DETAILS BY ITEM ID
 */
export const getRoomDetails = async (itemId) => {
    try {
        const [rooms] = await db.query(
            `SELECT * FROM inventory_items WHERE item_id = ? AND category_type = 'room'`,
            [itemId]
        );

        if (!rooms.length) {
            return {
                success: false,
                error: 'Room not found'
            };
        }

        return {
            success: true,
            data: rooms[0]
        };
    } catch (error) {
        console.error('Error fetching room details:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * GET ALL BOOKED DATES FOR A ROOM
 */
export const getRoomBookedDates = async (itemId, startDate, endDate) => {
    try {
        const start = startDate?.toISOString().split('T')[0] || null;
        const end = endDate?.toISOString().split('T')[0] || null;

        let query = `SELECT occupied_date FROM occupied_dates WHERE inventory_item_id = ?`;
        const params = [itemId];

        if (start && end) {
            query += ` AND occupied_date BETWEEN ? AND ?`;
            params.push(start, end);
        }

        query += ` ORDER BY occupied_date ASC`;

        const [dates] = await db.query(query, params);

        return {
            success: true,
            booked_dates: dates.map(d => d.occupied_date),
            count: dates.length
        };
    } catch (error) {
        console.error('Error fetching booked dates:', error);
        return {
            success: false,
            error: error.message
        };
    }
};
