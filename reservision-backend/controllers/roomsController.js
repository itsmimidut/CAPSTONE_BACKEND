/**
 * Rooms Controller — CRUD for rooms, cottages, and events (inventory_items)
 */

import { db } from "../config/db.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getGroupedRooms as getGroupedRoomsFromService } from "../services/roomAssignmentService.js";
import {
  attachStructuredDetails,
  sanitizeInventoryDescription,
  persistStructuredDetails,
  hasOwn,
} from "../services/inventoryStructuredDetailsService.js";
import {
  detectLegacyMixedDescription,
  MIXED_LEGACY_DESCRIPTION_CODE,
  MIXED_LEGACY_DESCRIPTION_MESSAGE,
} from "../services/inventoryDescriptionGuard.js";

const OVERVIEW_DESCRIPTION_MAX_LENGTH = 2000;

const assertCleanOverviewDescription = (rawDescription) => {
  const description = sanitizeInventoryDescription(rawDescription);
  if (description.length > OVERVIEW_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: `Description overview must be at most ${OVERVIEW_DESCRIPTION_MAX_LENGTH} characters.`,
      },
    };
  }
  const mixed = detectLegacyMixedDescription(description);
  if (mixed.isMixed) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: MIXED_LEGACY_DESCRIPTION_CODE,
        message: MIXED_LEGACY_DESCRIPTION_MESSAGE,
        reasons: mixed.reasons,
      },
    };
  }
  return { ok: true, description };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOM_STATUSES = new Set(["Available", "Occupied", "Under Maintenance"]);
const EVENT_AREA_STATUSES = new Set(["Available", "Under Maintenance", "Unavailable"]);
const EVENT_RATE_TYPES = new Set(["per_event", "per_hour", "per_day"]);

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

const parseImages = (images) => {
  if (Array.isArray(images)) return images;
  if (typeof images === "string") {
    try {
      return JSON.parse(images || "[]");
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeInventoryRow = (row) => {
  const images = parseImages(row.images);
  const base = { ...row, images };

  if (row.category_type === "event") {
    const venue = row.venue || row.room_number || null;
    const rateType = row.rate_type || "per_event";
    return {
      ...base,
      venue,
      location: venue,
      capacity: row.max_guests,
      rate_type: rateType,
      event_date: null,
      event_start_time: null,
      event_end_time: null
    };
  }

  return base;
};

const getEventFields = (body, isEvent) => {
  if (!isEvent) {
    return {
      event_date: null,
      event_start_time: null,
      event_end_time: null,
      venue: null
    };
  }

  const venue = String(body.venue || body.location || body.room_number || "").trim() || null;

  return {
    event_date: null,
    event_start_time: null,
    event_end_time: null,
    venue
  };
};

const resolveEventRateType = (body) => {
  const rateType = String(body.rate_type || "per_event").trim();
  return EVENT_RATE_TYPES.has(rateType) ? rateType : "per_event";
};

const isUnknownColumnError = (error, column) =>
  error?.code === "ER_BAD_FIELD_ERROR"
  && String(error?.sqlMessage || "").toLowerCase().includes(String(column).toLowerCase());

const validateInventoryPayload = (body, { existingType = null } = {}) => {
  const categoryType = body.category_type || existingType || "room";
  const isEvent = categoryType === "event";

  if (isEvent) {
    const errors = [];
    if (!String(body.name || "").trim()) errors.push("Area name is required.");
    const venue = body.venue || body.location || body.room_number;
    if (!String(venue || "").trim()) errors.push("Location is required.");
    const capacity = Number(body.capacity ?? body.max_guests);
    if (!Number.isFinite(capacity) || capacity <= 0) errors.push("Capacity is required.");
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) errors.push("Price is required.");
    const status = body.status || "Available";
    if (!EVENT_AREA_STATUSES.has(status)) errors.push("Invalid event area status.");
    return { errors, categoryType, isEvent, status };
  }

  const errors = [];
  if (!String(body.name || "").trim()) errors.push("Name is required.");
  if (!String(body.room_number || "").trim()) errors.push("Room number is required.");
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("Valid price is required.");
  const status = body.status || "Available";
  if (!ROOM_STATUSES.has(status)) errors.push("Invalid room status.");
  return { errors, categoryType, isEvent, status };
};

export const getRooms = async (req, res) => {
  try {
    const { category_type } = req.query
    const allowedCategoryTypes = ['room', 'cottage', 'event']

    if (category_type && !allowedCategoryTypes.includes(category_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category_type filter.'
      })
    }

    let sql = `
      SELECT *
      FROM inventory_items
      WHERE 1 = 1
    `
    const params = []

    if (category_type) {
      sql += ' AND category_type = ?'
      params.push(category_type)
    }

    sql += ' ORDER BY COALESCE(updated_at, created_at) DESC, item_id DESC'

    const [rows] = await db.query(sql, params)
    const normalized = rows.map(normalizeInventoryRow)
    const withStructured = await attachStructuredDetails(db, normalized)

    return res.json({
      success: true,
      data: withStructured
    })
  } catch (error) {
    console.error('Error fetching rooms:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory items.'
    })
  }
}

export const getRoom = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM inventory_items WHERE item_id=?', [req.params.id])
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Room not found' })
    }
    const [withStructured] = await attachStructuredDetails(db, [normalizeInventoryRow(rows[0])])
    return res.json({ success: true, data: withStructured })
  } catch (error) {
    console.error('Error fetching room:', error)
    return res.status(500).json({ success: false, message: 'Failed to fetch inventory item.' })
  }
}

export const createRoom = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const validation = validateInventoryPayload(req.body);
    if (validation.errors.length) {
      return res.status(400).json({ success: false, message: validation.errors[0], errors: validation.errors });
    }

    const {
      category, category_type, name,
      max_guests, price, promo, primaryImageIndex,
      existingImages, unit_number, unit_label
    } = req.body;

    const isEvent = validation.isEvent;
    const eventFields = getEventFields(req.body, isEvent);
    const eventRateType = isEvent ? resolveEventRateType(req.body) : null;
    let room_number = isEvent
      ? (eventFields.venue || "")
      : String(req.body.room_number || "").trim();
    const capacity = Number(req.body.capacity ?? max_guests) || (isEvent ? 0 : 2);
    const status = validation.status;
    const overviewCheck = assertCleanOverviewDescription(req.body.description);
    if (!overviewCheck.ok) {
      return res.status(overviewCheck.status).json(overviewCheck.body);
    }
    const description = overviewCheck.description;

    if (!hasOwn(req.body, "structured_details")) {
      return res.status(400).json({
        success: false,
        code: "STRUCTURED_DETAILS_REQUIRED",
        message: "structured_details is required for new room, cottage, and event records.",
      });
    }

    const newPaths = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const kept = existingImages ? JSON.parse(existingImages) : [];
    const allImages = [...kept, ...newPaths];
    const unitNum = parseInt(unit_number) || 1;
    const unitLbl = unit_label || `${name} - Unit ${unitNum}`;

    await connection.beginTransaction();

    const insertParams = [
      category || (isEvent ? "Event Area" : ""),
      category_type,
      room_number,
      name,
      description,
      capacity,
      price,
      status,
      promo,
      JSON.stringify(allImages),
      primaryImageIndex || 0,
      unitNum,
      unitLbl,
      eventFields.event_date,
      eventFields.event_start_time,
      eventFields.event_end_time,
      eventFields.venue,
      eventRateType
    ];

    let result;
    try {
      [result] = await connection.query(
        `INSERT INTO inventory_items
          (category, category_type, room_number, name, description, max_guests, price, status,
           promo, images, primaryImageIndex, quantity, unit_number, unit_label,
           event_date, event_start_time, event_end_time, venue, rate_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
        insertParams
      );
    } catch (insertError) {
      if (!isEvent || !isUnknownColumnError(insertError, "rate_type")) throw insertError;
      [result] = await connection.query(
        `INSERT INTO inventory_items
          (category, category_type, room_number, name, description, max_guests, price, status,
           promo, images, primaryImageIndex, quantity, unit_number, unit_label,
           event_date, event_start_time, event_end_time, venue)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
        insertParams.slice(0, -1)
      );
    }

    const itemId = result.insertId;
    const structuredRaw = req.body.structured_details;

    const { venueSync } = await persistStructuredDetails(
      connection,
      itemId,
      category_type,
      structuredRaw
    );

    if (isEvent && venueSync !== undefined && venueSync !== null) {
      await connection.query(
        "UPDATE inventory_items SET venue=?, room_number=? WHERE item_id=?",
        [venueSync, venueSync, itemId]
      );
    }

    await connection.commit();
    res.json({ success: true, id: itemId });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    console.error("Error creating room:", error);
    if (error?.errors) {
      return res.status(error.status || 422).json({
        success: false,
        message: error.message || "Some inventory details are invalid.",
        errors: error.errors,
      });
    }
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

export const updateRoom = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [existingRows] = await connection.query(
      "SELECT category_type, venue, room_number FROM inventory_items WHERE item_id=?",
      [req.params.id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const existingType = existingRows[0].category_type;
    const validation = validateInventoryPayload(req.body, { existingType });
    if (validation.errors.length) {
      return res.status(400).json({ success: false, message: validation.errors[0], errors: validation.errors });
    }

    const {
      category, category_type, name,
      max_guests, price, promo, primaryImageIndex,
      existingImages, unit_number, unit_label
    } = req.body;

    const isEvent = existingType === "event";
    const eventFields = getEventFields(req.body, isEvent);
    const eventRateType = isEvent ? resolveEventRateType(req.body) : null;
    let room_number = isEvent
      ? (eventFields.venue || "")
      : String(req.body.room_number || "").trim();
    const capacity = Number(req.body.capacity ?? max_guests) || (isEvent ? 0 : 2);
    const status = validation.status;
    const overviewCheck = assertCleanOverviewDescription(req.body.description);
    if (!overviewCheck.ok) {
      return res.status(overviewCheck.status).json(overviewCheck.body);
    }
    const description = overviewCheck.description;

    const newPaths = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const kept = existingImages ? JSON.parse(existingImages) : [];
    const allImages = [...kept, ...newPaths];
    const unitNum = parseInt(unit_number) || 1;
    const unitLbl = unit_label || `${name} - Unit ${unitNum}`;

    await connection.beginTransaction();

    if (isEvent) {
      const updateParams = [
        category || "Event Area",
        category_type || "event",
        room_number,
        name,
        description,
        capacity,
        price,
        status,
        promo,
        JSON.stringify(allImages),
        primaryImageIndex || 0,
        unitNum,
        unitLbl,
        eventFields.event_date,
        eventFields.event_start_time,
        eventFields.event_end_time,
        eventFields.venue,
        eventRateType,
        req.params.id
      ];

      try {
        await connection.query(
          `UPDATE inventory_items SET
             category=?, category_type=?, room_number=?, name=?, description=?, max_guests=?, price=?,
             status=?, promo=?, images=?, primaryImageIndex=?, quantity=1, unit_number=?, unit_label=?,
             event_date=?, event_start_time=?, event_end_time=?, venue=?, rate_type=?
           WHERE item_id=?`,
          updateParams
        );
      } catch (updateError) {
        if (!isUnknownColumnError(updateError, "rate_type")) throw updateError;
        await connection.query(
          `UPDATE inventory_items SET
             category=?, category_type=?, room_number=?, name=?, description=?, max_guests=?, price=?,
             status=?, promo=?, images=?, primaryImageIndex=?, quantity=1, unit_number=?, unit_label=?,
             event_date=?, event_start_time=?, event_end_time=?, venue=?
           WHERE item_id=?`,
          [...updateParams.slice(0, 18), updateParams[19]]
        );
      }
    } else {
      await connection.query(
        `UPDATE inventory_items SET
           category=?, category_type=?, room_number=?, name=?, description=?, max_guests=?, price=?,
           status=?, promo=?, images=?, primaryImageIndex=?, quantity=1, unit_number=?, unit_label=?,
           event_date=NULL, event_start_time=NULL, event_end_time=NULL, venue=NULL
         WHERE item_id=?`,
        [
          category,
          category_type,
          room_number,
          name,
          description,
          capacity,
          price,
          status,
          promo,
          JSON.stringify(allImages),
          primaryImageIndex || 0,
          unitNum,
          unitLbl,
          req.params.id
        ]
      );
    }

    const structuredRaw = hasOwn(req.body, "structured_details")
      ? req.body.structured_details
      : undefined;

    const { venueSync } = await persistStructuredDetails(
      connection,
      Number(req.params.id),
      existingType,
      structuredRaw
    );

    if (isEvent && venueSync !== undefined && venueSync !== null) {
      await connection.query(
        "UPDATE inventory_items SET venue=?, room_number=? WHERE item_id=?",
        [venueSync, venueSync, req.params.id]
      );
    }

    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    console.error("Error updating room:", error);
    if (error?.errors) {
      return res.status(error.status || 422).json({
        success: false,
        message: error.message || "Some inventory details are invalid.",
        errors: error.errors,
      });
    }
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

const hasActiveOrFutureBookings = async (itemId) => {
  const [bookingRows] = await db.query(
    `
    SELECT b.booking_id, b.booking_reference, b.booking_status, b.check_in_date, b.check_out_date
    FROM booking_items bi
    INNER JOIN bookings b ON b.booking_id = bi.booking_id
    WHERE bi.inventory_item_id = ?
      AND b.booking_status NOT IN ('Cancelled', 'Checked-Out')
      AND (
        b.check_out_date >= CURDATE()
        OR b.check_in_date >= CURDATE()
        OR EXISTS (
          SELECT 1
          FROM occupied_dates od
          WHERE od.inventory_item_id = bi.inventory_item_id
            AND od.booking_id = b.booking_id
            AND od.occupied_date >= CURDATE()
        )
      )
    LIMIT 1
    `,
    [itemId]
  )

  return bookingRows.length > 0
}

export const deleteRoom = async (req, res) => {
  try {
    const itemId = req.params.id

    const [existingRows] = await db.query(
      'SELECT item_id FROM inventory_items WHERE item_id = ?',
      [itemId]
    )
    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: 'Item not found.' })
    }

    const blocked = await hasActiveOrFutureBookings(itemId)
    if (blocked) {
      return res.status(409).json({
        success: false,
        message: 'This item cannot be deleted because it has active or future bookings.'
      })
    }

    await db.query('DELETE FROM inventory_items WHERE item_id=?', [itemId])
    return res.json({ success: true })
  } catch (error) {
    console.error('Error deleting room:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to delete inventory item.'
    })
  }
}

export const getGroupedRooms = async (req, res) => {
  try {
    const result = await getGroupedRoomsFromService();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch grouped rooms",
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error("Error fetching grouped rooms:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch grouped rooms",
      error: error.message
    });
  }
};
