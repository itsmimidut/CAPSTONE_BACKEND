import { db } from '../config/db.js';

const DAY_NAME_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

const APPROVED_ENROLLMENT_STATUSES = ['Approved', 'Enrolled', 'Confirmed', 'Completed'];

export const parseBatchDays = (daysField) => {
  if (!daysField) return [];
  if (Array.isArray(daysField)) return daysField;
  if (typeof daysField === 'object') return [];

  try {
    const parsed = JSON.parse(daysField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(daysField)
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
};

export const parseTimeSlot = (timeSlot) => {
  if (!timeSlot || timeSlot === 'TBD') {
    return { startTime: null, endTime: null };
  }

  const parts = String(timeSlot).trim().split(/\s*[–—-]\s*/);
  if (parts.length < 2) {
    return { startTime: null, endTime: null };
  }

  return {
    startTime: normalizeTimeValue(parts[0]),
    endTime: normalizeTimeValue(parts[1]),
  };
};

const normalizeTimeValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;

  const match12 = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1]) % 12;
    if (match12[3].toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${match12[2]}:00`;
  }

  const match24 = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match24) {
    return `${String(match24[1]).padStart(2, '0')}:${match24[2]}:${match24[3] || '00'}`;
  }

  return null;
};

const formatDateOnly = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value).trim();
  const date = text.includes('T') || text.includes('GMT')
    ? new Date(text)
    : new Date(`${text.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const dayNameToIndex = (dayName) => {
  const key = String(dayName || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(DAY_NAME_TO_INDEX, key)) {
    return DAY_NAME_TO_INDEX[key];
  }

  const shortKey = key.slice(0, 3);
  return DAY_NAME_TO_INDEX[shortKey] ?? null;
};

export const validateBatchScheduleConfig = (batch = {}) => {
  const scheduleType = String(batch.schedule_type || 'DAILY').toUpperCase();
  const maxSessions = Number(batch.max_sessions ?? 0);
  const startDate = parseDateOnly(batch.start_date);
  const endDate = parseDateOnly(batch.end_date);

  if (!startDate) {
    throw new Error('start_date is required');
  }

  if (endDate && startDate > endDate) {
    throw new Error('start_date cannot be after end_date');
  }

  if (scheduleType === 'FLEXIBLE') {
    return { scheduleType, maxSessions: 0, startDate, endDate };
  }

  if (!Number.isFinite(maxSessions) || maxSessions <= 0) {
    throw new Error('max_sessions must be greater than 0 for automatic session generation');
  }

  if (scheduleType === 'SELECTED_DAYS') {
    const selectedDays = parseBatchDays(batch.days)
      .map(dayNameToIndex)
      .filter((index) => index !== null);

    if (!selectedDays.length) {
      throw new Error('SELECTED_DAYS requires at least one day selected');
    }
  } else if (scheduleType !== 'DAILY') {
    throw new Error(`Unsupported schedule_type: ${scheduleType}`);
  }

  return { scheduleType, maxSessions, startDate, endDate };
};

export const buildSessionDates = (batch = {}) => {
  const { scheduleType, maxSessions, startDate, endDate } = validateBatchScheduleConfig(batch);

  if (scheduleType === 'FLEXIBLE') {
    return [];
  }

  const dates = [];

  if (scheduleType === 'DAILY') {
    const cursor = new Date(startDate);
    while (dates.length < maxSessions) {
      if (endDate && cursor > endDate) break;
      dates.push(formatDateOnly(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (scheduleType === 'SELECTED_DAYS') {
    const selectedDayIndexes = new Set(
      parseBatchDays(batch.days)
        .map(dayNameToIndex)
        .filter((index) => index !== null)
    );

    const cursor = new Date(startDate);
    const safetyLimit = Math.max(maxSessions * 21, 400);
    let iterations = 0;

    while (dates.length < maxSessions && iterations < safetyLimit) {
      if (endDate && cursor > endDate) break;
      if (selectedDayIndexes.has(cursor.getDay())) {
        dates.push(formatDateOnly(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
      iterations += 1;
    }
  }

  if (dates.length < maxSessions) {
    throw new Error(
      `Could only generate ${dates.length} of ${maxSessions} sessions within the batch date range`
    );
  }

  return dates;
};

export const getBatchById = async (batchId, connection = db) => {
  const [rows] = await connection.query(
    'SELECT * FROM swimming_batches WHERE batch_id = ? LIMIT 1',
    [batchId]
  );
  return rows[0] || null;
};

export const getBatchSessions = async (batchId, connection = db) => {
  const [rows] = await connection.query(
    `SELECT
        batch_session_id,
        batch_id,
        session_date,
        start_time,
        end_time,
        coach_id,
        max_slots,
        booked_slots,
        status,
        created_at,
        updated_at
     FROM swimming_batch_sessions
     WHERE batch_id = ?
     ORDER BY session_date ASC, batch_session_id ASC`,
    [batchId]
  );
  return rows;
};

const mapPublicSessionRow = (row = {}) => ({
  batch_session_id: row.batch_session_id,
  session_date: row.session_date,
  start_time: row.start_time,
  end_time: row.end_time,
  status: row.status,
  max_slots: Number(row.max_slots || 0),
  booked_slots: Number(row.booked_slots || 0),
  slots_left: Math.max(0, Number(row.max_slots || 0) - Number(row.booked_slots || 0)),
});

export const getPublicBatchSessions = async (batchId, connection = db) => {
  const batch = await getBatchById(batchId, connection);
  if (!batch) {
    return { notFound: true };
  }

  if (!['Open', 'Ongoing'].includes(String(batch.status || ''))) {
    return { notAvailable: true, batch };
  }

  const [rows] = await connection.query(
    `SELECT
        batch_session_id,
        session_date,
        start_time,
        end_time,
        status,
        max_slots,
        booked_slots
     FROM swimming_batch_sessions
     WHERE batch_id = ?
       AND session_date >= CURDATE()
       AND status NOT IN ('Cancelled', 'Completed')
     ORDER BY session_date ASC, batch_session_id ASC`,
    [batchId]
  );

  return {
    batch,
    sessions: rows.map(mapPublicSessionRow),
  };
};

const resolveBatchTimes = async (batch, connection = db) => {
  const fromSlot = parseTimeSlot(batch.time_slot);
  if (fromSlot.startTime && fromSlot.endTime) {
    return fromSlot;
  }

  const [scheduleRows] = await connection.query(
    `SELECT start_time, end_time
     FROM swimming_batch_schedules
     WHERE batch_id = ?
     ORDER BY schedule_id ASC
     LIMIT 1`,
    [batch.batch_id]
  );

  if (scheduleRows[0]) {
    return {
      startTime: scheduleRows[0].start_time || null,
      endTime: scheduleRows[0].end_time || null,
    };
  }

  return { startTime: null, endTime: null };
};

const countApprovedEnrollmentsForBatch = async (batchId, connection = db) => {
  const placeholders = APPROVED_ENROLLMENT_STATUSES.map(() => '?').join(', ');
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM swimming_enrollments
     WHERE batch_id = ?
       AND enrollment_status IN (${placeholders})`,
    [batchId, ...APPROVED_ENROLLMENT_STATUSES]
  );
  return Number(row?.count || 0);
};

export const syncBatchSessionStatuses = async (batchId, connection = db) => {
  await connection.query(
    `UPDATE swimming_batch_sessions
     SET status = CASE
       WHEN status = 'Cancelled' THEN 'Cancelled'
       WHEN booked_slots >= max_slots THEN 'Full'
       WHEN status = 'Completed' THEN 'Completed'
       ELSE 'Open'
     END
     WHERE batch_id = ?`,
    [batchId]
  );
};

export const syncBatchStatus = async (batchId, connection = db) => {
  const batch = await getBatchById(batchId, connection);
  if (!batch) return null;

  if (String(batch.status).toLowerCase() === 'closed') {
    return batch.status;
  }

  const today = formatDateOnly(new Date());
  const capacity = Number(batch.capacity || 0);
  const enrolledCount = await countApprovedEnrollmentsForBatch(batchId, connection);

  let nextStatus = batch.status;

  if (capacity > 0 && enrolledCount >= capacity) {
    nextStatus = 'Full';
  } else if (today < String(batch.start_date).slice(0, 10)) {
    nextStatus = 'Open';
  } else if (today >= String(batch.start_date).slice(0, 10) && today <= String(batch.end_date).slice(0, 10)) {
    nextStatus = 'Ongoing';
  } else if (today > String(batch.end_date).slice(0, 10)) {
    const [[pendingRow]] = await connection.query(
      `SELECT COUNT(*) AS pending
       FROM swimming_batch_sessions
       WHERE batch_id = ?
         AND status NOT IN ('Completed', 'Cancelled')`,
      [batchId]
    );
    nextStatus = Number(pendingRow?.pending || 0) === 0 ? 'Completed' : 'Ongoing';
  }

  await connection.query(
    `UPDATE swimming_batches
     SET status = ?
     WHERE batch_id = ?
       AND status <> 'Closed'`,
    [nextStatus, batchId]
  );

  await syncBatchSessionStatuses(batchId, connection);
  return nextStatus;
};

export const generateBatchSessions = async (batchId, options = {}) => {
  const connection = options.connection || db;
  const replaceExisting = Boolean(options.replaceExisting);

  const batch = await getBatchById(batchId, connection);
  if (!batch) {
    throw new Error('Batch not found');
  }

  const scheduleType = String(batch.schedule_type || 'DAILY').toUpperCase();
  if (scheduleType === 'FLEXIBLE') {
    return {
      batchId: Number(batchId),
      scheduleType,
      generated: 0,
      sessions: [],
      message: 'FLEXIBLE batches do not auto-generate sessions',
    };
  }

  const sessionDates = buildSessionDates(batch);
  const { startTime, endTime } = await resolveBatchTimes(batch, connection);
  const maxSlots = Number(batch.capacity) > 0 ? Number(batch.capacity) : 10;
  const coachId = batch.coach_id || null;

  if (replaceExisting) {
    const [bookedFuture] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM swimming_batch_sessions
       WHERE batch_id = ?
         AND session_date >= CURDATE()
         AND booked_slots > 0`,
      [batchId]
    );

    if (Number(bookedFuture[0]?.count || 0) > 0) {
      throw new Error('Cannot regenerate sessions because future sessions already have bookings');
    }

    await connection.query(
      `DELETE FROM swimming_batch_sessions
       WHERE batch_id = ?
         AND session_date >= CURDATE()`,
      [batchId]
    );
  } else {
    const [existingRows] = await connection.query(
      'SELECT COUNT(*) AS count FROM swimming_batch_sessions WHERE batch_id = ?',
      [batchId]
    );

    if (Number(existingRows[0]?.count || 0) > 0) {
      throw new Error('Batch sessions already exist. Use regenerate to rebuild future sessions.');
    }
  }

  const insertedSessions = [];

  for (const sessionDate of sessionDates) {
    const [result] = await connection.query(
      `INSERT INTO swimming_batch_sessions
        (batch_id, session_date, start_time, end_time, coach_id, max_slots, booked_slots, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'Open')`,
      [batchId, sessionDate, startTime, endTime, coachId, maxSlots]
    );

    insertedSessions.push({
      batch_session_id: result.insertId,
      batch_id: Number(batchId),
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      coach_id: coachId,
      max_slots: maxSlots,
      booked_slots: 0,
      status: 'Open',
    });
  }

  const [[countRow]] = await connection.query(
    'SELECT COUNT(*) AS total FROM swimming_batch_sessions WHERE batch_id = ?',
    [batchId]
  );

  await connection.query(
    `UPDATE swimming_batches
     SET generated_sessions = ?, updated_at = CURRENT_TIMESTAMP
     WHERE batch_id = ?`,
    [Number(countRow?.total || insertedSessions.length), batchId]
  );

  await syncBatchStatus(batchId, connection);

  return {
    batchId: Number(batchId),
    scheduleType,
    generated: insertedSessions.length,
    sessions: insertedSessions,
  };
};

export const regenerateBatchSessions = async (batchId, options = {}) => {
  return generateBatchSessions(batchId, { ...options, replaceExisting: true });
};

export const assertBatchHasEnrollmentCapacity = async (batchId, connection = db) => {
  const batch = await getBatchById(batchId, connection);
  if (!batch) {
    throw new Error('Batch not found');
  }

  const capacity = Number(batch.capacity || 0);
  if (capacity <= 0) {
    return { allowed: true, remaining: null };
  }

  const enrolledCount = await countApprovedEnrollmentsForBatch(batchId, connection);
  if (enrolledCount >= capacity) {
    throw new Error('This batch is already full');
  }

  return {
    allowed: true,
    remaining: capacity - enrolledCount,
  };
};

export const incrementBatchBookedSlots = async (batchId, connection = db) => {
  await connection.query(
    `UPDATE swimming_batch_sessions
     SET booked_slots = LEAST(max_slots, booked_slots + 1),
         status = CASE
           WHEN booked_slots + 1 >= max_slots THEN 'Full'
           ELSE status
         END
     WHERE batch_id = ?
       AND session_date >= CURDATE()
       AND status IN ('Open', 'Full')`,
    [batchId]
  );

  await syncBatchStatus(batchId, connection);
};
