import {
    getCoachByUserId,
    assertEnrollmentBelongsToCoach,
} from '../services/instructorSwimmingService.js';

const getAuthenticatedUserId = (req) => {
    const id = req.user?.id ?? req.user?.user_id;
    return id != null ? Number(id) : null;
};

/**
 * Resolve the authenticated user's linked coach and attach to req.coach.
 * Never reads coach_id from query, params, or body.
 */
export async function resolveInstructorCoach(req, res, next) {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized',
            });
        }

        const coach = await getCoachByUserId(userId);
        if (!coach) {
            return res.status(403).json({
                success: false,
                message: 'Coach profile not linked to this account.',
            });
        }

        req.coach = {
            coach_id: coach.coach_id,
            name: coach.name,
            specialization: coach.specialization,
            status: coach.status,
        };

        return next();
    } catch (error) {
        console.error('resolveInstructorCoach error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to resolve coach profile',
            error: error.message,
        });
    }
}

/**
 * Ensure enrollment belongs to the authenticated coach on req.coach.
 */
export async function requireEnrollmentOwnership(req, res, next) {
    try {
        const enrollmentId = Number(req.params.enrollmentId);
        const coachId = req.coach?.coach_id;

        if (!enrollmentId || !coachId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid enrollment or coach context.',
            });
        }

        const owned = await assertEnrollmentBelongsToCoach(enrollmentId, coachId);
        if (!owned) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: you do not have access to this enrollment.',
            });
        }

        return next();
    } catch (error) {
        console.error('requireEnrollmentOwnership error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to verify enrollment ownership',
            error: error.message,
        });
    }
}
