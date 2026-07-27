import {
  normalizeRole,
  sendForbidden,
} from '../utils/authHelpers.js';

/**
 * Require the authenticated user to have one of the allowed roles.
 * Must run after authenticateToken.
 */
export const requireRole = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map((role) => normalizeRole(role));

  return (req, res, next) => {
    if (!req.user) {
      return sendForbidden(res, 'Insufficient permissions');
    }

    const userRole = normalizeRole(req.user.role);
    if (!normalizedAllowed.includes(userRole)) {
      return sendForbidden(res, 'Insufficient permissions');
    }

    return next();
  };
};

export const requireAdmin = requireRole('admin');
export const requireDashboardAccess = requireRole('admin', 'receptionist', 'restaurantstaff', 'swimming_instructor');
export const requireStaff = requireRole('admin', 'receptionist', 'restaurantstaff');
export const requireInstructorOrStaff = requireRole(
  'admin',
  'receptionist',
  'swimming_instructor'
);

export const requireCustomer = requireRole('customer');
