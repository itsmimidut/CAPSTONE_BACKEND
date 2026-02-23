import { db } from '../config/db.js';

// Resort Sales Report Controller
export const getSalesReport = async (req, res) => {
  try {
    // 1. Trends (last 30 days)
    const [trendRows] = await db.query(`
      SELECT DATE(created_at) as period, SUM(total) as sales
      FROM bookings
      WHERE booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
      GROUP BY period
      ORDER BY period DESC
      LIMIT 30
    `);

    // 2. Sales Breakdown by Category
    // Cottages
    const [cottageRows] = await db.query(`
      SELECT COUNT(*) as count, SUM(total_price) as revenue
      FROM booking_items
      WHERE item_type = 'Cottage'
    `);
    // Rooms
    const [roomRows] = await db.query(`
      SELECT COUNT(*) as count, SUM(total_price) as revenue, SUM(nights) as nights
      FROM booking_items
      WHERE item_type = 'Room'
    `);
    // Events
    const [eventRows] = await db.query(`
      SELECT COUNT(*) as count, SUM(total_price) as revenue
      FROM booking_items
      WHERE item_type = 'Event'
    `);
    // Restaurant (orders)
    const [restaurantRows] = await db.query(`
      SELECT SUM(total_amount) as revenue, COUNT(*) as count
      FROM orders
      WHERE status IN ('completed', 'served')
    `);

    // 3. Top-Selling Restaurant Items
    const [topItemsRows] = await db.query(`
      SELECT m.name, SUM(oi.quantity) as count
      FROM order_items oi
      JOIN menu_items m ON oi.menu_id = m.menu_id
      JOIN orders o ON oi.order_id = o.order_id
      WHERE o.status IN ('completed', 'served')
      GROUP BY m.name
      ORDER BY count DESC
      LIMIT 5
    `);

    // 4. Customer Data
    const [guestRows] = await db.query(`
      SELECT SUM(adults + children) as total_guests, COUNT(DISTINCT email) as unique_customers
      FROM bookings
      WHERE booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
    `);
    // Walk-in vs Online (assume walk-in if email is null or empty)
    const [walkinRows] = await db.query(`
      SELECT COUNT(*) as walkins
      FROM bookings
      WHERE (email IS NULL OR email = '')
        AND booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
    `);
    const [onlineRows] = await db.query(`
      SELECT COUNT(*) as online
      FROM bookings
      WHERE (email IS NOT NULL AND email != '')
        AND booking_status IN ('Confirmed', 'Checked-In', 'Checked-Out')
    `);

    // 5. Expenses & Net Income (if available)
    let expenses = 0, netIncome = 0;
    try {
      const [expenseRows] = await db.query(`SELECT SUM(amount) as expenses FROM expenses`);
      expenses = expenseRows[0]?.expenses || 0;
    } catch {}

    // 6. Calculations
    const totalSales =
      (cottageRows[0]?.revenue || 0) +
      (roomRows[0]?.revenue || 0) +
      (eventRows[0]?.revenue || 0) +
      (restaurantRows[0]?.revenue || 0);
    netIncome = totalSales - expenses;

    // Occupancy Rate, ADR, RevPAR (Rooms)
    let occupancyRate = 0, adr = 0, revpar = 0;
    const [roomCountRows] = await db.query(`SELECT COUNT(*) as total_rooms FROM inventory_items WHERE category = 'Room'`);
    const totalRooms = roomCountRows[0]?.total_rooms || 1;
    const totalRoomNights = roomRows[0]?.nights || 0;
    occupancyRate = totalRooms ? ((totalRoomNights / (totalRooms * 30)) * 100) : 0;
    adr = (roomRows[0]?.revenue || 0) / (totalRoomNights || 1);
    revpar = (roomRows[0]?.revenue || 0) / (totalRooms * 30 || 1);

    // Category Percentages
    const percent = (val) => totalSales ? ((val / totalSales) * 100).toFixed(1) : 0;

    // 7. Executive Summary
    const peakDay = trendRows.reduce((max, row) => row.sales > (max.sales||0) ? row : max, {sales:0}).period || '';
    const keyHighlights = topItemsRows.length ? `Top item: ${topItemsRows[0].name}` : '';

    res.json({
      summary: {
        totalSales,
        peakDay,
        keyHighlights,
        comparison: null // TODO: add previous period comparison
      },
      breakdown: [
        { category: 'Rooms', revenue: roomRows[0]?.revenue || 0, count: roomRows[0]?.count || 0, percent: percent(roomRows[0]?.revenue || 0) },
        { category: 'Cottages', revenue: cottageRows[0]?.revenue || 0, count: cottageRows[0]?.count || 0, percent: percent(cottageRows[0]?.revenue || 0) },
        { category: 'Events', revenue: eventRows[0]?.revenue || 0, count: eventRows[0]?.count || 0, percent: percent(eventRows[0]?.revenue || 0) },
        { category: 'Restaurant', revenue: restaurantRows[0]?.revenue || 0, count: restaurantRows[0]?.count || 0, percent: percent(restaurantRows[0]?.revenue || 0) }
      ],
      topItems: topItemsRows,
      trends: trendRows.reverse(),
      guests: {
        total: guestRows[0]?.total_guests || 0,
        unique: guestRows[0]?.unique_customers || 0,
        walkins: walkinRows[0]?.walkins || 0,
        online: onlineRows[0]?.online || 0
      },
      rooms: {
        occupancyRate,
        adr,
        revpar,
        totalRooms,
        totalRoomNights
      },
      expenses,
      netIncome
    });
  } catch (error) {
    console.error('Error generating sales report:', error);
    res.status(500).json({ error: 'Error generating sales report' });
  }
};
