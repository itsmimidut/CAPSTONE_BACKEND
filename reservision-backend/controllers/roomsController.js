/**
 * ============================================================
 * Rooms Controller
 * ============================================================
 * 
 * Purpose:
 * - Handle all CRUD operations for rooms, cottages, and events
 * - Manage inventory_items table in database
 * - Process image uploads (base64 encoded)
 * - Support multi-category accommodation types
 * 
 * Database Table: inventory_items
 * Key Fields:
 * - item_id: Unique identifier (auto-increment)
 * - category_type: 'room' | 'cottage' | 'event'
 * - room_number: Room/cottage ID (e.g., '101', 'Main Hall')
 * - name: Display name (e.g., 'Ocean View Suite')
 * - description: Full description text
 * - max_guests: Maximum occupancy
 * - price: Price per night/event
 * - status: 'Available' | 'Occupied' | 'Under Maintenance'
 * - promo: Boolean - whether marked as limited offer
 * - images: JSON array of base64-encoded image data URLs
 * - primaryImageIndex: Index of main thumbnail image
 * - created_at: Timestamp of creation
 * 
 * Image Format:
 * - Stored as: JSON.stringify(array of data URLs)
 * - Example: ["data:image/jpeg;base64,...", "data:image/png;base64,..."]
 * - Retrieved and parsed by frontend for display
 */

import { db } from "../config/db.js";

// ============================================================
// GET ALL ROOMS/COTTAGES/EVENTS
// ============================================================
/**
 * Handler: GET /api/rooms
 * 
 * Purpose: Retrieve all rooms/cottages/events from database
 * 
 * Response:
 * - Array of room objects sorted by creation date (newest first)
 * - Each object includes all fields (description, images, pricing, etc.)
 * 
 * Usage in Frontend:
 * - Fetch all rooms on initial page load
 * - Populate admin dashboard
 * - Display in public browsing
 * 
 * Query: SELECT * FROM inventory_items ORDER BY created_at DESC
 * 
 * Response Example:
 * [
 *   {
 *     item_id: 1,
 *     category_type: 'room',
 *     room_number: '101',
 *     name: 'Ocean View Suite',
 *     price: 199.99,
 *     status: 'Available',
 *     images: ['data:image/jpeg;base64,...'],
 *     ...
 *   }
 * ]
 */
export const getRooms = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM inventory_items ORDER BY created_at DESC");
  res.json(rows);
};

// ============================================================
// GET SINGLE ROOM/COTTAGE/EVENT
// ============================================================
/**
 * Handler: GET /api/rooms/:id
 * 
 * Purpose: Retrieve a specific room by ID
 * 
 * Parameters:
 * - id (URL param): item_id of the room to fetch
 * 
 * Response:
 * - Single room object with all details
 * - Or 404 error if room not found
 * 
 * Usage in Frontend:
 * - Load room details for editing in admin modal
 * - Display full room information on detail page
 * - Populate booking form with room data
 * 
 * Query: SELECT * FROM inventory_items WHERE item_id = {id}
 */
export const getRoom = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM inventory_items WHERE item_id=?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: "Room not found" });
  res.json(rows[0]);
};

// ============================================================
// CREATE NEW ROOM/COTTAGE/EVENT
// ============================================================
/**
 * Handler: POST /api/rooms
 * 
 * Purpose: Create a new room/cottage/event in database
 * 
 * Request Body:
 * {
 *   category: string - (optional) fallback category if not provided
 *   category_type: string - 'room' | 'cottage' | 'event' (required)
 *   room_number: string - unique identifier (required, e.g., '101')
 *   name: string - display name (required)
 *   description: string - full description
 *   max_guests: number - maximum occupancy
 *   price: number - price per night/event
 *   status: string - 'Available' | 'Occupied' | 'Under Maintenance'
 *   promo: boolean - whether marked as promotional
 *   images: array - base64-encoded image data URLs
 *   primaryImageIndex: number - which image is the thumbnail
 * }
 * 
 * Processing:
 * - Images are JSON.stringify'd before database storage
 * - Creates new database record
 * - Returns success with new item_id
 * 
 * Usage in Frontend:
 * - Called by RoomModal component when user clicks "Save Room"
 * - Triggered after form validation
 * 
 * Response:
 * { success: true, id: 42 }
 * 
 * Error Handling:
 * - Missing required fields → validation error (frontend)
 * - Database connection error → 500 error
 */
export const createRoom = async (req, res) => {
  const { category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex } = req.body;
  const [result] = await db.query(
    `INSERT INTO inventory_items
      (category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [category, category_type, room_number, name, description, max_guests, price, status, promo, JSON.stringify(images || []), primaryImageIndex || 0]
  );
  res.json({ success: true, id: result.insertId });
};

// ============================================================
// UPDATE EXISTING ROOM/COTTAGE/EVENT
// ============================================================
/**
 * Handler: PUT /api/rooms/:id
 * 
 * Purpose: Update an existing room with new data
 * 
 * Parameters:
 * - id (URL param): item_id of room to update
 * 
 * Request Body:
 * - Same fields as createRoom (all fields can be updated)
 * - Images array can be modified (replaced entirely)
 * - primaryImageIndex can change
 * 
 * Processing:
 * - All fields in the database record are replaced
 * - Images are JSON.stringify'd again
 * - Update reflected immediately in all views
 * 
 * Usage in Frontend:
 * - Called when user edits room and clicks "Save"
 * - Modal passes initialRoom data to prefill form
 * - Form sends back updated data via PUT request
 * 
 * Response:
 * { success: true }
 * 
 * Note:
 * - If room doesn't exist, silently succeeds (no error check)
 * - Frontend should verify room exists before allowing edit
 */
export const updateRoom = async (req, res) => {
  const { category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex } = req.body;
  await db.query(
    `UPDATE inventory_items SET
       category=?, category_type=?, room_number=?, name=?, description=?, max_guests=?, price=?, status=?, promo=?, images=?, primaryImageIndex=?
     WHERE item_id=?`,
    [category, category_type, room_number, name, description, max_guests, price, status, promo, JSON.stringify(images || []), primaryImageIndex || 0, req.params.id]
  );
  res.json({ success: true });
};

// ============================================================
// DELETE ROOM/COTTAGE/EVENT
// ============================================================
/**
 * Handler: DELETE /api/rooms/:id
 * 
 * Purpose: Permanently delete a room from the database
 * 
 * Parameters:
 * - id (URL param): item_id of room to delete
 * 
 * Processing:
 * - Removes the entire database record
 * - All images and data associated with room are lost
 * - This action cannot be undone
 * 
 * Usage in Frontend:
 * - Called when admin clicks "Delete" button on a room
 * - Should show confirmation dialog first
 * - Removes room from list after successful deletion
 * 
 * Response:
 * { success: true }
 * 
 * Warning:
 * - No soft delete (permanent removal)
 * - Consider backing up database before bulk deletions
 * - No referential integrity checks (orphaned bookings possible)
 */
export const deleteRoom = async (req, res) => {
  await db.query("DELETE FROM inventory_items WHERE item_id=?", [req.params.id]);
  res.json({ success: true });
};
