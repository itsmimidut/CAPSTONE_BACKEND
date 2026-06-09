import db from '../config/db.js'

const normalizeRole = (role = '') =>
    String(role).trim().toLowerCase().replace(/\s+/g, '_')

const safeQuery = async (sql, params = []) => {
    try {
        const [rows] = await db.query(sql, params)
        return rows
    } catch (error) {
        console.warn('Notification query skipped:', error.message)
        return []
    }
}

const formatCurrency = (value) => {
    const amount = Number(value || 0)
    return `₱${amount.toFixed(2)}`
}

const buildNotification = ({ id, type, title, message, created_at, link }) => ({
    id,
    type,
    title,
    message,
    created_at,
    is_read: false,
    link
})

const getRefundNotifications = async (limit) => {
    const rows = await safeQuery(
        `SELECT
      r.refund_id,
      r.refund_reference,
      r.booking_id,
      COALESCE(b.booking_reference, '') AS booking_reference,
      r.refund_amount,
      r.refund_status,
      COALESCE(r.requested_at, r.created_at, NOW()) AS created_at
    FROM refunds r
    LEFT JOIN bookings b ON b.booking_id = r.booking_id
    WHERE r.refund_status IN ('Pending', 'Requested')
    ORDER BY created_at DESC
    LIMIT ?`,
        [limit]
    )

    return rows.map((row) =>
        buildNotification({
            id: `refund-${row.refund_id || row.id}`,
            type: 'refund_request',
            title: 'New refund request',
            message: `Refund request for booking ${row.booking_reference || row.booking_id}. Amount: ${formatCurrency(row.refund_amount)}.`,
            created_at: row.created_at,
            link: '/admin/refunds'
        })
    )
}

const getBookingNotifications = async (limit) => {
    const rows = await safeQuery(
    `SELECT
        b.booking_id,
        b.booking_reference,
        b.booking_status,
        b.payment_status,
        COALESCE(b.created_at, NOW()) AS created_at
    FROM bookings b
    WHERE b.booking_status IN ('Pending', 'Confirmed')
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY created_at DESC
    LIMIT ?`,
    [limit]
    )

    return rows.map((row) =>
        buildNotification({
            id: `booking-${row.booking_id}`,
            type: 'new_booking',
            title: 'New reservation',
            message: `New reservation ${row.booking_reference || row.booking_id} was created.`,
            created_at: row.created_at,
            link: '/admin/reservations'
        })
    )
}

const getEshopNotifications = async (limit) => {
    const rows = await safeQuery(
    `SELECT
        pt.id,
        pt.receipt_no,
        pt.total_amount,
        pt.payment_method,
        pt.type,
        COALESCE(pt.transaction_date, pt.created_at, NOW()) AS created_at
    FROM pos_transactions pt
    WHERE LOWER(TRIM(COALESCE(pt.type, ''))) IN ('e-shop', 'eshop', 'delivery')
        AND COALESCE(pt.transaction_date, pt.created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY created_at DESC
    LIMIT ?`,
    [limit]
    )

    return rows.map((row) =>
        buildNotification({
            id: `eshop-${row.id}`,
            type: 'eshop_order',
            title: 'New E-Shop order',
            message: `E-Shop order ${row.receipt_no || row.id} received. Total: ${formatCurrency(row.total_amount)}.`,
            created_at: row.created_at,
            link: '/admin/pos'
        })
    )
}

const getLowStockNotifications = async (limit) => {
    const rows = await safeQuery(
        `SELECT
      inventory_id,
      item_name,
      quantity,
      threshold,
      COALESCE(updated_at, created_at, NOW()) AS created_at
    FROM inventory
    WHERE quantity <= threshold
    ORDER BY quantity ASC
    LIMIT ?`,
        [limit]
    )

    return rows.map((row) =>
        buildNotification({
            id: `stock-${row.inventory_id}`,
            type: 'low_stock',
            title: 'Low stock alert',
            message: `${row.item_name || 'Item'} is low in stock. Remaining: ${row.quantity ?? 0}.`,
            created_at: row.created_at,
            link: '/admin/inventory'
        })
    )
}

const getSwimmingNotifications = async (limit) => {
    const rows = await safeQuery(
        `SELECT
      se.enrollment_id,
      se.first_name,
      se.last_name,
      se.enrollment_status,
      COALESCE(se.created_at, NOW()) AS created_at
    FROM swimming_enrollments se
    WHERE se.enrollment_status IN ('Pending', 'For Approval')
    ORDER BY created_at DESC
    LIMIT ?`,
        [limit]
    )

    return rows.map((row) =>
        buildNotification({
            id: `swim-${row.enrollment_id}`,
            type: 'swimming_enrollment',
            title: 'New swimming enrollment',
            message: `${[row.first_name, row.last_name].filter(Boolean).join(' ') || 'A student'} submitted a swimming enrollment.`,
            created_at: row.created_at,
            link: '/admin/swimming'
        })
    )
}

const getSystemAlertNotifications = async (limit) => {
    const tables = await safeQuery(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('system_alerts', 'alerts', 'notifications')`
    )
    if (!tables.length) {
        return []
    }

    const table = tables[0].TABLE_NAME
    const rows = await safeQuery(
        `SELECT
      id,
      title,
      message,
      COALESCE(created_at, updated_at, NOW()) AS created_at,
      COALESCE(link, '/admin') AS link,
      COALESCE(is_read, 0) AS is_read
    FROM ${table}
    ORDER BY created_at DESC
    LIMIT ?`,
        [limit]
    )

    return rows.map((row) => ({
        id: `alert-${row.id}`,
        type: 'system_alert',
        title: row.title || 'System alert',
        message: row.message || 'System notification available.',
        created_at: row.created_at,
        is_read: Boolean(row.is_read),
        link: row.link || '/admin'
    }))
}

const getRoleNotificationSources = async (role, limit) => {
    const sources = []
    const normalizedRole = normalizeRole(role)

    const adminRoles = ['admin', 'manager', 'unknown']
    const staffRoles = ['staff']
    const cashierRoles = ['cashier']
    const restaurantRoles = ['restaurant_staff']
    const inventoryRoles = ['inventory_staff']
    const swimmingRoles = ['swimming_instructor']

    if (adminRoles.includes(normalizedRole)) {
        sources.push(getRefundNotifications(limit))
        sources.push(getBookingNotifications(limit))
        sources.push(getEshopNotifications(limit))
        sources.push(getLowStockNotifications(limit))
        sources.push(getSwimmingNotifications(limit))
        sources.push(getSystemAlertNotifications(limit))
        return await Promise.all(sources)
    }

    if (staffRoles.includes(normalizedRole)) {
        sources.push(getBookingNotifications(limit))
        sources.push(getEshopNotifications(limit))
        return await Promise.all(sources)
    }

    if (cashierRoles.includes(normalizedRole)) {
        sources.push(getEshopNotifications(limit))
        sources.push(getRefundNotifications(limit))
        return await Promise.all(sources)
    }

    if (restaurantRoles.includes(normalizedRole)) {
        sources.push(getEshopNotifications(limit))
        sources.push(getLowStockNotifications(limit))
        return await Promise.all(sources)
    }

    if (inventoryRoles.includes(normalizedRole)) {
        sources.push(getLowStockNotifications(limit))
        return await Promise.all(sources)
    }

    if (swimmingRoles.includes(normalizedRole)) {
        sources.push(getSwimmingNotifications(limit))
        return await Promise.all(sources)
    }

    // Default admin-like behavior
    sources.push(getRefundNotifications(limit))
    sources.push(getBookingNotifications(limit))
    sources.push(getEshopNotifications(limit))
    sources.push(getLowStockNotifications(limit))
    sources.push(getSwimmingNotifications(limit))
    sources.push(getSystemAlertNotifications(limit))
    return await Promise.all(sources)
}

const countTable = async (sql, params = []) => {
    const rows = await safeQuery(sql, params)
    return Number(rows[0]?.count || 0)
}

export const getAdminNotifications = async (req, res) => {
    try {
        const { role = 'admin', limit = 10 } = req.query
        const limitValue = Math.max(Number(limit) || 10, 1)

        const notificationsChunks = await getRoleNotificationSources(role, limitValue)
        const notifications = notificationsChunks.flat().filter(Boolean)

        const unreadCount = notifications.filter((notification) => !notification.is_read).length

        const sortedNotifications = notifications
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limitValue)

        return res.json({
        success: true,
        unreadCount,
        notifications: sortedNotifications
        })
    } catch (error) {
        console.error('getAdminNotifications error:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to load admin notifications',
            error: error.message
        })
    }
}

export const getPendingCounts = async (req, res) => {
    try {
        const refunds = await countTable(
            "SELECT COUNT(*) AS count FROM refunds WHERE refund_status IN ('Pending', 'Requested')"
        )

        const bookings = await countTable(
            "SELECT COUNT(*) AS count FROM bookings WHERE booking_status IN ('Pending', 'Confirmed')"
        )

        const eshopOrders = await countTable(
            `SELECT COUNT(*) AS count FROM pos_transactions WHERE LOWER(TRIM(COALESCE(type, ''))) IN ('e-shop', 'eshop', 'delivery')`
        )

        const lowStock = await countTable(
            'SELECT COUNT(*) AS count FROM inventory WHERE quantity <= threshold'
        )

        const swimmingEnrollments = await countTable(
            "SELECT COUNT(*) AS count FROM swimming_enrollments WHERE enrollment_status IN ('Pending', 'For Approval')"
        )

        const total = refunds + bookings + eshopOrders + lowStock + swimmingEnrollments

        return res.json({
            success: true,
            counts: {
                total,
                refunds,
                bookings,
                eshopOrders,
                lowStock,
                swimmingEnrollments
            },
            reservationPendingCount: bookings,
            swimmingPendingCount: swimmingEnrollments,
            eshopPendingCount: eshopOrders
        })
    } catch (error) {
        console.error('getPendingCounts error:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to load pending notification counts',
            error: error.message
        })
    }
}
