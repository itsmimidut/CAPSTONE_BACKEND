import { db } from '../config/db.js';

// Predict tomorrow's bookings using a simple moving average of the last 7 days
export const predictTomorrowBookings = async (req, res) => {
  try {
    // Get bookings per day for the last 7 days
    const [rows] = await db.query(`
      SELECT DATE(created_at) as day, COUNT(*) as bookings
      FROM bookings
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        AND booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
      GROUP BY day
      ORDER BY day DESC
      LIMIT 7
    `);
    if (!rows.length) {
      return res.json({ prediction: 0, details: [] });
    }
    // Calculate average bookings per day
    const total = rows.reduce((sum, r) => sum + r.bookings, 0);
    const avg = total / rows.length;
    res.json({ prediction: Math.round(avg), details: rows });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Prediction failed' });
  }
};
