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
            const [fetchedRates] = await db.query(
                `SELECT * FROM entrance_rates WHERE status = 'active' ORDER BY age_min ASC`
            );
            rates = fetchedRates;
        }

        const dayType = detectDayType(date);

        // Find rates for each category
        const adultRate = findRateForAge(35, dayType, rates); // Default adult age
        const childRate = findRateForAge(10, dayType, rates); // Default child age
        const seniorRate = findRateForAge(65, dayType, rates); // Default senior age

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

export default computeEntranceFee;
