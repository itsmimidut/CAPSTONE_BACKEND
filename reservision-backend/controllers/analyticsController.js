/**
 * ============================================================
 * Analytics Controller
 * ============================================================
 * 
 * Purpose:
 * - Provide real-time analytics data for admin dashboard
 * - Calculate revenue, bookings, occupancy, and guest statistics
 * - Generate chart data for revenue trends and booking breakdowns
 * 
 * Dependencies:
 * - db: Database connection pool
 * 
 * Endpoints:
 * - GET /api/analytics/stats - Get dashboard statistics
 * - GET /api/analytics/revenue-chart - Get revenue trend data
 * - GET /api/analytics/bookings-by-type - Get bookings breakdown
 */

import db from "../config/db.js";

/**
 * Calculate date range based on period
 */
const getDateRange = (period, startDate, endDate) => {
    const now = new Date();
    let start, end;

    if (startDate && endDate) {
        // Custom range
        start = new Date(startDate);
        end = new Date(endDate);
    } else {
        // Predefined periods
        end = new Date(now);

        switch (period) {
            case 'day':
                start = new Date(now);
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'week':
                start = new Date(now);
                start.setDate(now.getDate() - 7);
                break;
            case 'month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'year':
                start = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                // Default to current month
                start = new Date(now.getFullYear(), now.getMonth(), 1);
        }
    }

    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
    };
};

/**
 * Calculate previous period for trend comparison
 */
const getPreviousPeriod = (period, startDate, endDate) => {
    const current = getDateRange(period, startDate, endDate);
    const start = new Date(current.start);
    const end = new Date(current.end);
    const diff = end - start;

    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);

    const prevStart = new Date(prevEnd);
    prevStart.setTime(prevStart.getTime() - diff);

    return {
        start: prevStart.toISOString().split('T')[0],
        end: prevEnd.toISOString().split('T')[0]
    };
};

/**
 * GET /api/analytics/stats
 * Get dashboard statistics with trend comparison
 */
export const getStats = async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;

        const currentRange = getDateRange(period, startDate, endDate);
        const previousRange = getPreviousPeriod(period, startDate, endDate);

        console.log('📊 Fetching analytics stats for period:', period);
        console.log('Current range:', currentRange);
        console.log('Previous range:', previousRange);

        // ============================================================
        // 1. TOTAL REVENUE
        // ============================================================
        // Revenue from bookings (paid only)
        const [currentBookingRevenue] = await db.query(
            `SELECT COALESCE(SUM(total), 0) as revenue 
             FROM bookings 
             WHERE payment_status = 'Paid' 
             AND DATE(created_at) BETWEEN ? AND ?`,
            [currentRange.start, currentRange.end]
        );

        // Revenue from POS/E-Shop transactions
        const [currentPosRevenue] = await db.query(
            `SELECT COALESCE(SUM(total_amount), 0) as revenue 
             FROM pos_transactions 
             WHERE DATE(transaction_date) BETWEEN ? AND ?`,
            [currentRange.start, currentRange.end]
        );

        const currentRevenue = parseFloat(currentBookingRevenue[0].revenue) +
            parseFloat(currentPosRevenue[0].revenue);

        // Previous period revenue for trend
        const [prevBookingRevenue] = await db.query(
            `SELECT COALESCE(SUM(total), 0) as revenue 
             FROM bookings 
             WHERE payment_status = 'Paid' 
             AND DATE(created_at) BETWEEN ? AND ?`,
            [previousRange.start, previousRange.end]
        );

        const [prevPosRevenue] = await db.query(
            `SELECT COALESCE(SUM(total_amount), 0) as revenue 
             FROM pos_transactions 
             WHERE DATE(transaction_date) BETWEEN ? AND ?`,
            [previousRange.start, previousRange.end]
        );

        const previousRevenue = parseFloat(prevBookingRevenue[0].revenue) +
            parseFloat(prevPosRevenue[0].revenue);

        const revenueTrend = previousRevenue > 0
            ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
            : 0;

        // ============================================================
        // 2. BOOKINGS COUNT
        // ============================================================
        const [currentBookings] = await db.query(
            `SELECT COUNT(*) as count 
             FROM bookings 
             WHERE booking_status != 'Cancelled' 
             AND DATE(created_at) BETWEEN ? AND ?`,
            [currentRange.start, currentRange.end]
        );

        const [previousBookings] = await db.query(
            `SELECT COUNT(*) as count 
             FROM bookings 
             WHERE booking_status != 'Cancelled' 
             AND DATE(created_at) BETWEEN ? AND ?`,
            [previousRange.start, previousRange.end]
        );

        const currentBookingCount = currentBookings[0].count;
        const previousBookingCount = previousBookings[0].count;

        const bookingsTrend = previousBookingCount > 0
            ? ((currentBookingCount - previousBookingCount) / previousBookingCount) * 100
            : 0;

        // ============================================================
        // 3. OCCUPANCY RATE
        // ============================================================
        // Count days with active bookings vs total days in period
        const [occupiedDays] = await db.query(
            `SELECT COUNT(DISTINCT DATE(check_in_date)) as days
             FROM bookings
             WHERE booking_status IN ('Confirmed', 'Checked-In')
             AND check_in_date BETWEEN ? AND ?`,
            [currentRange.start, currentRange.end]
        );

        const start = new Date(currentRange.start);
        const end = new Date(currentRange.end);
        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        const occupancyRate = totalDays > 0
            ? (occupiedDays[0].days / totalDays) * 100
            : 0;

        // Previous period occupancy
        const [prevOccupiedDays] = await db.query(
            `SELECT COUNT(DISTINCT DATE(check_in_date)) as days
             FROM bookings
             WHERE booking_status IN ('Confirmed', 'Checked-In')
             AND check_in_date BETWEEN ? AND ?`,
            [previousRange.start, previousRange.end]
        );

        const prevStart = new Date(previousRange.start);
        const prevEnd = new Date(previousRange.end);
        const prevTotalDays = Math.ceil((prevEnd - prevStart) / (1000 * 60 * 60 * 24)) + 1;

        const previousOccupancy = prevTotalDays > 0
            ? (prevOccupiedDays[0].days / prevTotalDays) * 100
            : 0;

        const occupancyTrend = previousOccupancy > 0
            ? ((occupancyRate - previousOccupancy) / previousOccupancy) * 100
            : 0;

        // ============================================================
        // 4. TOTAL GUESTS
        // ============================================================
        const [currentGuests] = await db.query(
            `SELECT COALESCE(SUM(adults + children), 0) as guests
             FROM bookings
             WHERE booking_status != 'Cancelled'
             AND DATE(check_in_date) BETWEEN ? AND ?`,
            [currentRange.start, currentRange.end]
        );

        const [previousGuests] = await db.query(
            `SELECT COALESCE(SUM(adults + children), 0) as guests
             FROM bookings
             WHERE booking_status != 'Cancelled'
             AND DATE(check_in_date) BETWEEN ? AND ?`,
            [previousRange.start, previousRange.end]
        );

        const currentGuestCount = currentGuests[0].guests;
        const previousGuestCount = previousGuests[0].guests;

        const guestsTrend = previousGuestCount > 0
            ? ((currentGuestCount - previousGuestCount) / previousGuestCount) * 100
            : 0;

        // ============================================================
        // RESPONSE
        // ============================================================
        const stats = {
            revenue: {
                label: 'Total Revenue',
                value: `₱${currentRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                rawValue: currentRevenue,
                progress: Math.min((currentRevenue / (previousRevenue || 1)) * 100, 100),
                type: 'revenue',
                trend: parseFloat(revenueTrend.toFixed(1))
            },
            bookings: {
                label: 'Bookings',
                value: currentBookingCount.toString(),
                rawValue: currentBookingCount,
                progress: Math.min((currentBookingCount / (previousBookingCount || 1)) * 100, 100),
                type: 'bookings',
                trend: parseFloat(bookingsTrend.toFixed(1))
            },
            occupancy: {
                label: 'Occupancy',
                value: `${occupancyRate.toFixed(0)}%`,
                rawValue: occupancyRate,
                progress: occupancyRate,
                type: 'occupancy',
                trend: parseFloat(occupancyTrend.toFixed(1))
            },
            guests: {
                label: 'Guests',
                value: currentGuestCount.toString(),
                rawValue: currentGuestCount,
                progress: Math.min((currentGuestCount / (previousGuestCount || 1)) * 100, 100),
                type: 'guests',
                trend: parseFloat(guestsTrend.toFixed(1))
            }
        };

        console.log('✅ Analytics stats calculated successfully');
        res.json(stats);

    } catch (error) {
        console.error('❌ Error fetching analytics stats:', error);
        res.status(500).json({ error: 'Failed to fetch analytics statistics' });
    }
};

/**
 * GET /api/analytics/revenue-chart
 * Get revenue trend data for chart
 */
export const getRevenueChart = async (req, res) => {
    try {
        const { period = 'week', startDate, endDate } = req.query;
        const dateRange = getDateRange(period, startDate, endDate);

        console.log('📈 Fetching revenue chart data for period:', period);

        let groupBy, dateFormat, labels;

        // Determine grouping based on period
        switch (period) {
            case 'day':
                groupBy = 'HOUR(created_at)';
                dateFormat = '%H:00';
                labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
                break;
            case 'week':
                groupBy = 'DATE(created_at)';
                dateFormat = '%Y-%m-%d';
                // Generate last 7 days
                labels = Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (6 - i));
                    return d.toISOString().split('T')[0];
                });
                break;
            case 'month':
                groupBy = 'DATE(created_at)';
                dateFormat = '%Y-%m-%d';
                // Generate days in current month
                const now = new Date();
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                labels = Array.from({ length: daysInMonth }, (_, i) => {
                    const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
                    return d.toISOString().split('T')[0];
                });
                break;
            case 'year':
                groupBy = 'MONTH(created_at)';
                dateFormat = '%Y-%m';
                labels = Array.from({ length: 12 }, (_, i) => {
                    const d = new Date(new Date().getFullYear(), i, 1);
                    return d.toISOString().slice(0, 7);
                });
                break;
            default:
                groupBy = 'DATE(created_at)';
                dateFormat = '%Y-%m-%d';
                labels = [];
        }

        // Get booking revenue grouped by period
        const [bookingRevenue] = await db.query(
            `SELECT 
                DATE_FORMAT(created_at, ?) as period,
                COALESCE(SUM(total), 0) as revenue
             FROM bookings 
             WHERE payment_status = 'Paid' 
             AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY ${groupBy}
             ORDER BY created_at`,
            [dateFormat, dateRange.start, dateRange.end]
        );

        // Get POS revenue grouped by period
        const [posRevenue] = await db.query(
            `SELECT 
                DATE_FORMAT(transaction_date, ?) as period,
                COALESCE(SUM(total_amount), 0) as revenue
             FROM pos_transactions 
             WHERE DATE(transaction_date) BETWEEN ? AND ?
             GROUP BY ${groupBy}
             ORDER BY transaction_date`,
            [dateFormat, dateRange.start, dateRange.end]
        );

        // Merge revenue data
        const revenueMap = new Map();
        bookingRevenue.forEach(row => {
            revenueMap.set(row.period, parseFloat(row.revenue));
        });
        posRevenue.forEach(row => {
            const current = revenueMap.get(row.period) || 0;
            revenueMap.set(row.period, current + parseFloat(row.revenue));
        });

        // Fill in missing periods with 0
        const data = labels.map(label => revenueMap.get(label) || 0);

        // Format labels for display
        const displayLabels = labels.map(label => {
            if (period === 'day') return label;
            if (period === 'week') {
                const d = new Date(label);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
            if (period === 'month') {
                const d = new Date(label);
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
            if (period === 'year') {
                const d = new Date(label);
                return d.toLocaleDateString('en-US', { month: 'short' });
            }
            return label;
        });

        const chartData = {
            labels: displayLabels,
            datasets: [{
                label: 'Revenue',
                data: data,
                borderColor: '#2B6CB0',
                backgroundColor: 'rgba(43,108,176,0.1)',
                tension: 0.3,
                fill: true
            }]
        };

        console.log('✅ Revenue chart data generated successfully');
        res.json(chartData);

    } catch (error) {
        console.error('❌ Error fetching revenue chart:', error);
        res.status(500).json({ error: 'Failed to fetch revenue chart data' });
    }
};

/**
 * GET /api/analytics/bookings-by-type
 * Get bookings breakdown by item type
 */
export const getBookingsByType = async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;
        const dateRange = getDateRange(period, startDate, endDate);

        console.log('📊 Fetching bookings by type for period:', period);
        console.log('📅 Date range:', dateRange);

        // Get booking items grouped by type
        const [bookingItems] = await db.query(
            `SELECT 
                bi.item_type,
                COUNT(DISTINCT bi.booking_id) as count
             FROM booking_items bi
             JOIN bookings b ON bi.booking_id = b.booking_id
             WHERE b.booking_status != 'Cancelled'
             AND DATE(b.created_at) BETWEEN ? AND ?
             GROUP BY bi.item_type
             ORDER BY count DESC`,
            [dateRange.start, dateRange.end]
        );

        console.log('📦 Raw booking items from DB:', bookingItems);

        // Prepare labels and data
        const labels = bookingItems.map(item => item.item_type);
        const data = bookingItems.map(item => parseInt(item.count));

        // Define colors for each category
        const colorMap = {
            'Room': { bg: 'rgba(99, 179, 237, 0.8)', border: 'rgb(99, 179, 237)', hover: 'rgba(99, 179, 237, 1)' },
            'Cottage': { bg: 'rgba(56, 178, 172, 0.8)', border: 'rgb(56, 178, 172)', hover: 'rgba(56, 178, 172, 1)' },
            'Event': { bg: 'rgba(129, 140, 248, 0.8)', border: 'rgb(129, 140, 248)', hover: 'rgba(129, 140, 248, 1)' },
            'Swimming': { bg: 'rgba(59, 130, 246, 0.8)', border: 'rgb(59, 130, 246)', hover: 'rgba(59, 130, 246, 1)' }
        };

        // Map colors based on labels
        const backgroundColor = labels.map(label => colorMap[label]?.bg || 'rgba(99, 179, 237, 0.8)');
        const borderColor = labels.map(label => colorMap[label]?.border || 'rgb(99, 179, 237)');
        const hoverBackgroundColor = labels.map(label => colorMap[label]?.hover || 'rgba(99, 179, 237, 1)');

        const chartData = {
            labels: labels.length > 0 ? labels : ['Room', 'Cottage', 'Event', 'Swimming'],
            datasets: [{
                label: 'Bookings',
                data: data.length > 0 ? data : [0, 0, 0, 0],
                backgroundColor: backgroundColor.length > 0 ? backgroundColor : [
                    'rgba(99, 179, 237, 0.8)',
                    'rgba(56, 178, 172, 0.8)',
                    'rgba(129, 140, 248, 0.8)',
                    'rgba(59, 130, 246, 0.8)'
                ],
                borderColor: borderColor.length > 0 ? borderColor : [
                    'rgb(99, 179, 237)',
                    'rgb(56, 178, 172)',
                    'rgb(129, 140, 248)',
                    'rgb(59, 130, 246)'
                ],
                borderWidth: 2,
                borderRadius: 8,
                hoverBackgroundColor: hoverBackgroundColor.length > 0 ? hoverBackgroundColor : [
                    'rgba(99, 179, 237, 1)',
                    'rgba(56, 178, 172, 1)',
                    'rgba(129, 140, 248, 1)',
                    'rgba(59, 130, 246, 1)'
                ]
            }]
        };

        console.log('✅ Bookings by type data:', chartData);
        res.json(chartData);

    } catch (error) {
        console.error('❌ Error fetching bookings by type:', error);
        res.status(500).json({ error: 'Failed to fetch bookings breakdown' });
    }
};
