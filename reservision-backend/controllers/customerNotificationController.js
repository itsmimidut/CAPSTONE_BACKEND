import db from '../config/db.js';

const parseLimit = (raw) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 50);
};

export const getCustomerNotifications = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const limit = parseLimit(req.query?.limit);

    const [rows] = await db.query(
      `SELECT id, title, message, type, link, is_read, created_at
       FROM customer_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit],
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS unreadCount
       FROM customer_notifications
       WHERE user_id = ? AND is_read = 0`,
      [userId],
    );

    return res.json({
      success: true,
      unreadCount: Number(countRows[0]?.unreadCount || 0),
      notifications: rows.map((row) => ({
        ...row,
        is_read: Boolean(row.is_read),
      })),
    });
  } catch (error) {
    console.error('getCustomerNotifications error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load notifications',
    });
  }
};

export const markCustomerNotificationRead = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const notificationId = Number(req.params?.id);

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!notificationId) {
      return res.status(400).json({ success: false, error: 'Notification ID is required' });
    }

    const [result] = await db.query(
      `UPDATE customer_notifications
       SET is_read = 1
       WHERE id = ? AND user_id = ?`,
      [notificationId, userId],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('markCustomerNotificationRead error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update notification',
    });
  }
};

export const markAllCustomerNotificationsRead = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await db.query(
      `UPDATE customer_notifications
       SET is_read = 1
       WHERE user_id = ? AND is_read = 0`,
      [userId],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('markAllCustomerNotificationsRead error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update notifications',
    });
  }
};
