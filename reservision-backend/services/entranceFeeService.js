import { db } from '../config/db.js';

/**
 * Detect day type (weekday, weekend, holiday)
 * Future: Integration with holiday calendar
 */
const detectDayType = (date) => {
    const dateObj = new Date(date);
    const day = dateObj.getDay();

    // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) {
        return 'weekend';
    }

    // TODO: Check against holiday calendar
    // For now, just return weekday as default
    return 'weekday';
};

/**
 * Get rate for person age and day type
 * Returns the matching rate or adult rate as fallback
 */
const findRateForAge = (age, dayType, rates) => {
    // Try exact match first
    const exactMatch = rates.find(r =>
        r.day_type === dayType &&
        r.status === 'active' &&
        age >= (r.age_min || 0) &&
        age <= (r.age_max || 120)
    );

    if (exactMatch) return exactMatch;

    // Fallback to adult rate if no match
    const adultRate = rates.find(r =>
        r.day_type === dayType &&
        r.status === 'active' &&
        (r.name.toLowerCase().includes('adult') || !r.age_min)
    );

    return adultRate;
};

const findRateForCategory = (category, age, dayType, rates) => {
    const aliases = {
        adult: ['adult'],
        child: ['child', 'kid', 'teen'],
        senior: ['senior'],
    };
    const names = aliases[category] || [category];
    const namedRate = rates.find((rate) => {
        const name = String(rate.name || '').toLowerCase();
        return rate.day_type === dayType
            && rate.status === 'active'
            && names.some((alias) => name.includes(alias));
    });
    return namedRate || findRateForAge(age, dayType, rates);
};

/**
 * Compute total entrance fee for a reservation
 * 
 * @param {Object} input
 * @param {number} input.adults - Number of adults
 * @param {number} input.children - Number of children
 * @param {number} input.seniors - Number of seniors (optional)
 * @param {string} input.date - Date in YYYY-MM-DD format
 * @param {Array} input.rates - Optional pre-fetched rates
 * 
 * @returns {Object}
 * {
 *   success: boolean,
 *   total: number,
 *   breakdown: { adults: number, children: number, seniors: number },
 *   rateUsed: { adult, child, senior },
 *   dayType: string,
 *   error?: string
 * }
 */
export const computeEntranceFee = async (input) => {
    try {
        const { adults = 0, children = 0, seniors = 0, date } = input;
        let rates = input.rates;
        const connection = input.connection || db;

        // Validate input
        if (!date) {
            return {
                success: false,
                error: 'Date is required for fee computation'
            };
        }

        if (adults < 0 || children < 0 || seniors < 0) {
            return {
                success: false,
                error: 'Guest counts cannot be negative'
            };
        }

        // Fetch rates if not provided
        if (!rates) {
            const [fetchedRates] = await connection.query(
                `SELECT * FROM entrance_rates WHERE status = 'active' ORDER BY age_min ASC`
            );
            rates = fetchedRates;
        }

        const dayType = detectDayType(date);

        // Find rates for each category
        const adultRate = findRateForCategory('adult', 35, dayType, rates);
        const childRate = findRateForCategory('child', 10, dayType, rates);
        const seniorRate = findRateForCategory('senior', 65, dayType, rates);

        // Calculate total
        const adultFee = adults * (adultRate?.price || 0);
        const childFee = children * (childRate?.price || 0);
        const seniorFee = seniors * (seniorRate?.price || 0);
        const total = adultFee + childFee + seniorFee;

        return {
            success: true,
            total,
            breakdown: {
                adults: { count: adults, price: adultRate?.price || 0, subtotal: adultFee },
                children: { count: children, price: childRate?.price || 0, subtotal: childFee },
                seniors: { count: seniors, price: seniorRate?.price || 0, subtotal: seniorFee }
            },
            ratesUsed: {
                adult: adultRate?.name || 'Adult',
                child: childRate?.name || 'Child',
                senior: seniorRate?.name || 'Senior'
            },
            dayType,
            date
        };
    } catch (error) {
        console.error('Error computing entrance fee:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

const getItemGuestBreakdown = (item = {}) => {
    const nested = item.guest_breakdown || item.guestBreakdown || {};
    return {
        adults: Number(item.adults ?? nested.adults ?? 0),
        children: Number(item.children ?? nested.children ?? 0),
        seniors: Number(item.seniors ?? nested.seniors ?? 0),
    };
};

const getItemEntranceDate = (item = {}, defaultDate = null) => (
    item.booking_date
    || item.bookingDate
    || item.check_in_date
    || item.checkIn
    || item.swimmingDetails?.sessionDates?.[0]
    || item.swimmingDetails?.dates?.[0]
    || defaultDate
);

export const computeEntranceFeeForBookingItems = async ({
    items = [],
    defaultDate = null,
    connection = null,
} = {}) => {
    const conn = connection || db;
    const chargeableItems = (Array.isArray(items) ? items : []).filter((item) => {
        const bookingType = String(
            item.booking_type || item.bookingType || item.category_type || item.category || 'room'
        ).toLowerCase();
        return bookingType !== 'event';
    });

    let total = 0;
    const breakdown = {
        adults: { count: 0, subtotal: 0 },
        children: { count: 0, subtotal: 0 },
        seniors: { count: 0, subtotal: 0 },
    };

    for (const item of chargeableItems) {
        const counts = getItemGuestBreakdown(item);
        const date = getItemEntranceDate(item, defaultDate);
        const result = await computeEntranceFee({
            ...counts,
            date,
            connection: conn,
        });

        if (!result.success) return result;

        total += Number(result.total || 0);
        for (const category of ['adults', 'children', 'seniors']) {
            breakdown[category].count += Number(result.breakdown[category].count || 0);
            breakdown[category].subtotal += Number(result.breakdown[category].subtotal || 0);
        }
    }

    return {
        success: true,
        total: Math.round((total + Number.EPSILON) * 100) / 100,
        breakdown,
    };
};

export default computeEntranceFee;
