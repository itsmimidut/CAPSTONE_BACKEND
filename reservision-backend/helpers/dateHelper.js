/**
 * Safe Local Date Helper
 * ========================
 * Prevents timezone-related date shifting by working with local dates only
 */

/**
 * Normalize date to YYYY-MM-DD format (local time, no timezone conversion)
 * 
 * @param {string|Date|null} value - Date to normalize
 * @returns {string|null} - YYYY-MM-DD format or null
 */
export const normalizeYMD = (value) => {
    if (!value) return null

    const str = String(value)
    const match = str.match(/^\d{4}-\d{2}-\d{2}/)

    // Already in YYYY-MM-DD format
    if (match) return match[0]

    // Parse as local date, not UTC
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null

    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

/**
 * Calculate nights between two dates (YYYY-MM-DD format)
 * 
 * @param {string} checkIn - Check-in date in YYYY-MM-DD format
 * @param {string} checkOut - Check-out date in YYYY-MM-DD format
 * @returns {number} - Number of nights
 */
export const calculateNightsBetweenDates = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0

    const start = new Date(`${checkIn}T00:00:00`)
    const end = new Date(`${checkOut}T00:00:00`)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

    return Math.max(0, Math.ceil((end - start) / 86400000))
}

export default {
    normalizeYMD,
    calculateNightsBetweenDates
}
