import db from '../config/db.js';

const mapAddressRow = (row) => ({
  id: row.id,
  label: row.label,
  street: row.street,
  city: row.city || '',
  postalCode: row.postal_code || '',
  country: row.country || 'Philippines',
  isDefault: Boolean(row.is_default),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapPreferencesRow = (row) => ({
  booking: Boolean(row?.booking_updates ?? true),
  restaurant: Boolean(row?.restaurant_orders ?? true),
  shop: Boolean(row?.shop_orders ?? true),
  activity: Boolean(row?.activity_updates ?? true),
  promotions: Boolean(row?.promotions ?? false),
});

export const resolveCustomerIdForUser = async (userId) => {
  const [rows] = await db.query(
    'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0]?.customer_id ?? null;
};

const fetchProfileAddressFields = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.address, u.city, u.postal_code, u.country, c.customer_id
     FROM user u
     LEFT JOIN customers c ON c.user_id = u.user_id
     WHERE u.user_id = ?
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
};

const seedDefaultAddressFromProfile = async (customerId, userId) => {
  const profile = await fetchProfileAddressFields(userId);
  const street = String(profile?.address || '').trim();
  if (!street || !customerId) return [];

  await db.query(
    `INSERT INTO customer_addresses (
      customer_id, label, street, city, postal_code, country, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      customerId,
      'Profile Address',
      street,
      String(profile?.city || '').trim() || null,
      String(profile?.postal_code || '').trim() || null,
      String(profile?.country || 'Philippines').trim() || 'Philippines',
    ],
  );

  return getAddressesForCustomer(customerId, userId, { skipSeed: true });
};

export const getAddressesForCustomer = async (customerId, userId, { skipSeed = false } = {}) => {
  const [rows] = await db.query(
    `SELECT id, customer_id, label, street, city, postal_code, country, is_default, created_at, updated_at
     FROM customer_addresses
     WHERE customer_id = ?
     ORDER BY is_default DESC, updated_at DESC, id DESC`,
    [customerId],
  );

  if (!rows.length && !skipSeed) {
    return seedDefaultAddressFromProfile(customerId, userId);
  }

  return rows.map(mapAddressRow);
};

const clearDefaultAddresses = async (customerId, connection = db) => {
  await connection.query(
    'UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?',
    [customerId],
  );
};

const ensureDefaultAddress = async (customerId) => {
  const [rows] = await db.query(
    `SELECT id FROM customer_addresses
     WHERE customer_id = ?
     ORDER BY updated_at DESC, id ASC
     LIMIT 1`,
    [customerId],
  );

  if (rows[0]?.id) {
    await db.query(
      'UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?',
      [rows[0].id, customerId],
    );
  }
};

export const createAddress = async (customerId, payload = {}) => {
  const label = String(payload.label || '').trim();
  const street = String(payload.street || '').trim();
  const city = String(payload.city || '').trim() || null;
  const postalCode = String(payload.postalCode || payload.postal_code || '').trim() || null;
  const country = String(payload.country || 'Philippines').trim() || 'Philippines';
  const isDefault = Boolean(payload.isDefault ?? payload.is_default);

  if (!label || !street) {
    const error = new Error('Label and street are required');
    error.statusCode = 400;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    if (isDefault) {
      await clearDefaultAddresses(customerId, connection);
    }

    const [existing] = await connection.query(
      'SELECT COUNT(*) AS total FROM customer_addresses WHERE customer_id = ?',
      [customerId],
    );
    const shouldDefault = isDefault || Number(existing[0]?.total || 0) === 0;

    if (shouldDefault && !isDefault) {
      await clearDefaultAddresses(customerId, connection);
    }

    const [result] = await connection.query(
      `INSERT INTO customer_addresses (
        customer_id, label, street, city, postal_code, country, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customerId, label, street, city, postalCode, country, shouldDefault ? 1 : 0],
    );

    await connection.commit();

    const [rows] = await db.query(
      `SELECT id, customer_id, label, street, city, postal_code, country, is_default, created_at, updated_at
       FROM customer_addresses WHERE id = ? LIMIT 1`,
      [result.insertId],
    );

    return mapAddressRow(rows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateAddress = async (customerId, addressId, payload = {}) => {
  const [existingRows] = await db.query(
    'SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ? LIMIT 1',
    [addressId, customerId],
  );

  if (!existingRows.length) {
    const error = new Error('Address not found');
    error.statusCode = 404;
    throw error;
  }

  const existing = existingRows[0];
  const label = String(payload.label ?? existing.label).trim();
  const street = String(payload.street ?? existing.street).trim();
  const city = String(payload.city ?? existing.city ?? '').trim() || null;
  const postalCode = String(payload.postalCode ?? payload.postal_code ?? existing.postal_code ?? '').trim() || null;
  const country = String(payload.country ?? existing.country ?? 'Philippines').trim() || 'Philippines';
  const isDefault = payload.isDefault !== undefined
    ? Boolean(payload.isDefault)
    : Boolean(existing.is_default);

  if (!label || !street) {
    const error = new Error('Label and street are required');
    error.statusCode = 400;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    if (isDefault) {
      await clearDefaultAddresses(customerId, connection);
    }

    await connection.query(
      `UPDATE customer_addresses
       SET label = ?, street = ?, city = ?, postal_code = ?, country = ?, is_default = ?
       WHERE id = ? AND customer_id = ?`,
      [label, street, city, postalCode, country, isDefault ? 1 : 0, addressId, customerId],
    );

    await connection.commit();

    const [rows] = await db.query(
      `SELECT id, customer_id, label, street, city, postal_code, country, is_default, created_at, updated_at
       FROM customer_addresses WHERE id = ? LIMIT 1`,
      [addressId],
    );

    return mapAddressRow(rows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const deleteAddress = async (customerId, addressId) => {
  const [existingRows] = await db.query(
    'SELECT is_default FROM customer_addresses WHERE id = ? AND customer_id = ? LIMIT 1',
    [addressId, customerId],
  );

  if (!existingRows.length) {
    const error = new Error('Address not found');
    error.statusCode = 404;
    throw error;
  }

  const wasDefault = Boolean(existingRows[0].is_default);

  await db.query(
    'DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?',
    [addressId, customerId],
  );

  if (wasDefault) {
    await ensureDefaultAddress(customerId);
  }

  return { success: true };
};

export const setDefaultAddress = async (customerId, addressId) => {
  const [existingRows] = await db.query(
    'SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ? LIMIT 1',
    [addressId, customerId],
  );

  if (!existingRows.length) {
    const error = new Error('Address not found');
    error.statusCode = 404;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await clearDefaultAddresses(customerId, connection);
    await connection.query(
      'UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?',
      [addressId, customerId],
    );
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getNotificationPreferences = async (customerId) => {
  const [rows] = await db.query(
    `SELECT booking_updates, restaurant_orders, shop_orders, activity_updates, promotions
     FROM customer_notification_preferences
     WHERE customer_id = ?
     LIMIT 1`,
    [customerId],
  );

  if (!rows.length) {
    return {
      booking: true,
      restaurant: true,
      shop: true,
      activity: true,
      promotions: false,
    };
  }

  return mapPreferencesRow(rows[0]);
};

export const upsertNotificationPreferences = async (customerId, payload = {}) => {
  const preferences = {
    booking: payload.booking !== undefined ? Boolean(payload.booking) : true,
    restaurant: payload.restaurant !== undefined ? Boolean(payload.restaurant) : true,
    shop: payload.shop !== undefined ? Boolean(payload.shop) : true,
    activity: payload.activity !== undefined ? Boolean(payload.activity) : true,
    promotions: payload.promotions !== undefined ? Boolean(payload.promotions) : false,
  };

  await db.query(
    `INSERT INTO customer_notification_preferences (
      customer_id, booking_updates, restaurant_orders, shop_orders, activity_updates, promotions
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      booking_updates = VALUES(booking_updates),
      restaurant_orders = VALUES(restaurant_orders),
      shop_orders = VALUES(shop_orders),
      activity_updates = VALUES(activity_updates),
      promotions = VALUES(promotions)`,
    [
      customerId,
      preferences.booking ? 1 : 0,
      preferences.restaurant ? 1 : 0,
      preferences.shop ? 1 : 0,
      preferences.activity ? 1 : 0,
      preferences.promotions ? 1 : 0,
    ],
  );

  return preferences;
};

export const getViewedOrders = async (customerId) => {
  const [rows] = await db.query(
    `SELECT order_reference, viewed_at
     FROM customer_viewed_orders
     WHERE customer_id = ?
     ORDER BY viewed_at DESC`,
    [customerId],
  );

  return rows.map((row) => ({
    orderReference: row.order_reference,
    viewedAt: row.viewed_at,
  }));
};

export const markOrderViewed = async (customerId, orderReference) => {
  const reference = String(orderReference || '').trim();
  if (!reference) {
    const error = new Error('orderReference is required');
    error.statusCode = 400;
    throw error;
  }

  await db.query(
    `INSERT INTO customer_viewed_orders (customer_id, order_reference)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE viewed_at = CURRENT_TIMESTAMP`,
    [customerId, reference],
  );

  return { success: true, orderReference: reference };
};

export const getCustomerNotificationCounts = async (customerId, userId) => {
  const [[swimmingRow]] = await db.query(
    `SELECT COUNT(*) AS count
     FROM customer_notifications
     WHERE user_id = ? AND is_read = 0
       AND LOWER(COALESCE(type, '')) LIKE '%swimming%'`,
    [userId],
  );

  const [[reservationRow]] = await db.query(
    `SELECT COUNT(*) AS count
     FROM customer_notifications
     WHERE user_id = ? AND is_read = 0
       AND (
         LOWER(COALESCE(type, '')) LIKE '%booking%'
         OR LOWER(COALESCE(type, '')) LIKE '%reservation%'
         OR LOWER(COALESCE(type, '')) LIKE '%refund%'
       )`,
    [userId],
  );

  const [[eshopRow]] = await db.query(
    `SELECT COUNT(*) AS count
     FROM pos_transactions pt
     WHERE pt.customer_id = ?
       AND LOWER(TRIM(COALESCE(pt.type, ''))) IN ('e-shop', 'eshop', 'delivery')
       AND NOT EXISTS (
         SELECT 1
         FROM customer_viewed_orders vo
         WHERE vo.customer_id = ?
           AND vo.order_reference = pt.receipt_no
       )`,
    [customerId, customerId],
  );

  return {
    swimming: Number(swimmingRow?.count || 0),
    reservation: Number(reservationRow?.count || 0),
    eshop: Number(eshopRow?.count || 0),
  };
};
