import db from '../config/db.js';

export const buildCoachDisplayName = (user = {}) => {
    const fromUser = `${user.first_name || user.firstName || ''} ${user.last_name || user.lastName || ''}`.trim();
    return fromUser || user.name || 'Unnamed Coach';
};

/**
 * Keep swimming_coaches.name in sync with the linked user profile.
 * Email and phone are read from user via JOIN; name is denormalized for legacy queries.
 */
export async function syncSwimmingCoachFromUser(userId, connection = null, userOverride = null) {
    if (!userId) {
        return { updated: 0 };
    }

    const executor = connection || db;
    let user = userOverride;

    if (!user) {
        const [users] = await executor.query(
            `SELECT user_id, first_name, last_name, email, phone
             FROM user
             WHERE user_id = ?
             LIMIT 1`,
            [userId]
        );
        user = users[0];
    }

    if (!user) {
        return { updated: 0 };
    }

    const displayName = buildCoachDisplayName(user);
    const [result] = await executor.query(
        `UPDATE swimming_coaches
         SET name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [displayName, userId]
    );

    return {
        updated: result.affectedRows || 0,
        displayName
    };
}

/**
 * Sync all linked coach profiles from the user table.
 */
export async function syncAllSwimmingCoachesFromUsers(connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
        `SELECT user_id, first_name, last_name
         FROM user
         WHERE user_id IN (
            SELECT user_id FROM swimming_coaches WHERE user_id IS NOT NULL
         )`
    );

    let updated = 0;
    for (const user of rows) {
        const result = await syncSwimmingCoachFromUser(user.user_id, executor, user);
        updated += result.updated;
    }

    return { updated, total: rows.length };
}
