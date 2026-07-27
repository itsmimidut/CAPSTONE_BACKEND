/**
 * Event area availability — time-slot overlap checks for bookable venues.
 */

import { db } from "../config/db.js";
import { BLOCKING_BOOKING_STATUSES } from "../constants/bookingStatusRules.js";
import { expireStalePendingBookings } from "./pendingBookingExpiryService.js";

const ACTIVE_BOOKING_STATUSES = BLOCKING_BOOKING_STATUSES;

export const normalizeTimeValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = String(match[1]).padStart(2, "0");
  const minutes = String(match[2]).padStart(2, "0");
  const seconds = String(match[3] || "00").padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

export const normalizeDateValue = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const timeToMinutes = (timeValue) => {
  const normalized = normalizeTimeValue(timeValue);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
};

export const timesOverlap = (startA, endA, startB, endB) => {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  if ([aStart, aEnd, bStart, bEnd].some(v => v == null)) return false;
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && aEnd > bStart;
};

const parseScheduleFromDescription = (raw) => {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      booking_date: parsed.booking_date || parsed.bookingDate || null,
      start_time: parsed.start_time || parsed.startTime || null,
      end_time: parsed.end_time || parsed.endTime || null
    };
  } catch {
    return {};
  }
};

let scheduleColumnsAvailable = null;

const hasScheduleColumns = async (connection) => {
  if (scheduleColumnsAvailable !== null) return scheduleColumnsAvailable;
  const conn = connection || db;
  const [rows] = await conn.query(
    `SHOW COLUMNS FROM booking_items WHERE Field IN ('booking_date', 'start_time', 'end_time')`
  );
  const names = new Set(rows.map(row => row.Field));
  scheduleColumnsAvailable = names.has("booking_date") && names.has("start_time") && names.has("end_time");
  return scheduleColumnsAvailable;
};

const getInventoryArea = async (connection, inventoryItemId) => {
  const conn = connection || db;
  const [rows] = await conn.query(
    `SELECT item_id, name, category_type, status, max_guests
     FROM inventory_items
     WHERE item_id = ? AND category_type = 'event'
     LIMIT 1`,
    [inventoryItemId]
  );
  return rows[0] || null;
};

const fetchConflictingBookings = async (connection, {
  inventoryItemId,
  bookingDate,
  startTime,
  endTime,
  excludeBookingId = null
}) => {
  const conn = connection || db;
  const normalizedDate = normalizeDateValue(bookingDate);
  const normalizedStart = normalizeTimeValue(startTime);
  const normalizedEnd = normalizeTimeValue(endTime);

  if (!normalizedDate || !normalizedStart || !normalizedEnd) {
    return [];
  }

  const useColumns = await hasScheduleColumns(conn);

  if (useColumns) {
    const params = [
      inventoryItemId,
      normalizedDate,
      normalizedEnd,
      normalizedStart,
      ...ACTIVE_BOOKING_STATUSES,
    ];
    let excludeSql = "";
    if (excludeBookingId) {
      excludeSql = " AND b.booking_id <> ?";
      params.push(excludeBookingId);
    }

    const [rows] = await conn.query(
      `SELECT bi.item_id, bi.booking_id, bi.start_time, bi.end_time, bi.item_description, b.booking_reference
       FROM booking_items bi
       INNER JOIN bookings b ON b.booking_id = bi.booking_id
       WHERE bi.inventory_item_id = ?
         AND bi.item_type = 'Event'
         AND bi.booking_date = ?
         AND bi.start_time IS NOT NULL
         AND bi.end_time IS NOT NULL
         AND bi.start_time < ?
         AND bi.end_time > ?
         AND b.booking_status IN (${ACTIVE_BOOKING_STATUSES.map(() => "?").join(", ")})
         ${excludeSql}`,
      params
    );
    return rows;
  }

  const [rows] = await conn.query(
    `SELECT bi.item_id, bi.booking_id, bi.item_description, b.booking_reference
     FROM booking_items bi
     INNER JOIN bookings b ON b.booking_id = bi.booking_id
     WHERE bi.inventory_item_id = ?
       AND bi.item_type = 'Event'
       AND b.booking_status IN (${ACTIVE_BOOKING_STATUSES.map(() => "?").join(", ")})
       ${excludeBookingId ? " AND b.booking_id <> ?" : ""}`,
  [
    inventoryItemId,
    ...ACTIVE_BOOKING_STATUSES,
    ...(excludeBookingId ? [excludeBookingId] : [])
  ]
  );

  return rows.filter((row) => {
    const schedule = parseScheduleFromDescription(row.item_description);
    if (normalizeDateValue(schedule.booking_date) !== normalizedDate) return false;
    return timesOverlap(schedule.start_time, schedule.end_time, normalizedStart, normalizedEnd);
  });
};

export const checkEventAreaAvailability = async ({
  inventory_item_id,
  booking_date,
  start_time,
  end_time,
  exclude_booking_id = null
}, connection = null) => {
  await expireStalePendingBookings(connection);
  const inventoryItemId = Number(inventory_item_id);
  if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
    return {
      success: false,
      available: false,
      message: "A valid event area is required."
    };
  }

  const bookingDate = normalizeDateValue(booking_date);
  const startTime = normalizeTimeValue(start_time);
  const endTime = normalizeTimeValue(end_time);

  if (!bookingDate) {
    return { success: false, available: false, message: "Event date is required." };
  }
  if (!startTime || !endTime) {
    return { success: false, available: false, message: "Start and end time are required." };
  }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return { success: false, available: false, message: "End time must be later than start time." };
  }

  const area = await getInventoryArea(connection, inventoryItemId);
  if (!area) {
    return { success: false, available: false, message: "Event area not found." };
  }

  const status = String(area.status || "").toLowerCase();
  if (status === "unavailable") {
    return {
      success: true,
      available: false,
      message: `${area.name} is currently unavailable.`
    };
  }
  if (status === "under maintenance" || status === "maintenance") {
    return {
      success: true,
      available: false,
      message: `${area.name} is under maintenance.`
    };
  }

  const conflicts = await fetchConflictingBookings(connection, {
    inventoryItemId,
    bookingDate,
    startTime,
    endTime,
    excludeBookingId: exclude_booking_id ? Number(exclude_booking_id) : null
  });

  if (conflicts.length > 0) {
    return {
      success: true,
      available: false,
      message: `${area.name} is already booked for the selected date and time.`,
      conflicts: conflicts.map(row => ({
        booking_id: row.booking_id,
        booking_reference: row.booking_reference
      }))
    };
  }

  return {
    success: true,
    available: true,
    message: `${area.name} is available for your selected schedule.`,
    area: {
      item_id: area.item_id,
      name: area.name,
      capacity: area.max_guests
    }
  };
};
