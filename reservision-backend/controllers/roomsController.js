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
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getGroupedRooms as getGroupedRoomsFromService } from "../services/roomAssignmentService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "..", "public", "uploads", "rooms");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}`));
  }
});

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
  const [rows] = await db.query(
    "SELECT * FROM inventory_items ORDER BY name ASC, unit_number ASC, created_at DESC"
  );
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
  try {
    const {
      category, category_type, room_number, name, description,
      max_guests, price, status, promo, primaryImageIndex,
      quantity, existingImages, unit_number, unit_label
    } = req.body;
    const newPaths = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const kept = existingImages ? JSON.parse(existingImages) : [];
    const allImages = [...kept, ...newPaths];
    const unitNum = parseInt(unit_number) || 1;
    const unitLbl = unit_label || `${name} - Unit ${unitNum}`;
    // quantity is kept as 1 — each row IS one unit
    const [result] = await db.query(
      `INSERT INTO inventory_items
        (category, category_type, room_number, name, description, max_guests, price, status,
         promo, images, primaryImageIndex, quantity, unit_number, unit_label)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [category, category_type, room_number, name, description, max_guests, price, status,
        promo, JSON.stringify(allImages), primaryImageIndex || 0, unitNum, unitLbl]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error("Error creating room:", error);
    res.status(500).json({ error: error.message });
  }
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
  try {
    const {
      category, category_type, room_number, name, description,
      max_guests, price, status, promo, primaryImageIndex,
      existingImages, unit_number, unit_label
    } = req.body;
    const newPaths = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const kept = existingImages ? JSON.parse(existingImages) : [];
    const allImages = [...kept, ...newPaths];
    const unitNum = parseInt(unit_number) || 1;
    const unitLbl = unit_label || `${name} - Unit ${unitNum}`;
    await db.query(
      `UPDATE inventory_items SET
         category=?, category_type=?, room_number=?, name=?, description=?, max_guests=?, price=?,
         status=?, promo=?, images=?, primaryImageIndex=?, quantity=1, unit_number=?, unit_label=?
       WHERE item_id=?`,
      [category, category_type, room_number, name, description, max_guests, price,
        status, promo, JSON.stringify(allImages), primaryImageIndex || 0,
        unitNum, unitLbl, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating room:", error);
    res.status(500).json({ error: error.message });
  }
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

// ============================================================
// GET GROUPED ROOMS (FOR CUSTOMER DISPLAY)
// ============================================================
/**
 * Handler: GET /api/rooms/grouped
 * 
 * Purpose: Get grouped room types for customer-facing display
 * 
 * Returns one card per room type (e.g., "FAMILY ROOM") showing:
 * - Room type name
 * - Price per night
 * - Max guests
 * - Description
 * - Available count (rooms with status = 'Available')
 * - Total count
 * - Sample images
 * - List of all physical rooms
 * 
 * This consolidates:
 *   "FAMILY ROOM 1" (Available)
 *   "FAMILY ROOM 2" (Available)
 *   "FAMILY ROOM 3" (Booked)
 * Into a single card: "FAMILY ROOM" with available_count: 2
 * 
 * Response Example:
 * {
 *   success: true,
 *   data: [
 *     {
 *       room_type: "FAMILY ROOM",
 *       price: 4500,
 *       max_guests: 4,
 *       description: "Spacious family room...",
 *       available_count: 2,
 *       total_rooms: 3,
 *       primary_item_id: 1,
 *       images: ["data:image/jpeg;base64,..."],
 *       all_rooms: [
 *         { item_id: 1, room_number: "101", name: "FAMILY ROOM 1", status: "Available" },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 */
export const getGroupedRooms = async (req, res) => {
  try {
    const result = await getGroupedRoomsFromService();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch grouped rooms',
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Error fetching grouped rooms:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grouped rooms',
      error: error.message
    });
  }
};
