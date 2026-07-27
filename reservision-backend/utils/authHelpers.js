export const normalizeRole = (role = '') => {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'restaurant_staff') return 'restaurantstaff';
  if (value === 'instructor' || value === 'swimminginstructor') return 'swimming_instructor';
  return value;
};

export const ADMIN_ROLES = ['admin'];
export const STAFF_ROLES = ['admin', 'receptionist', 'restaurantstaff'];
export const DASHBOARD_ROLES = ['admin', 'receptionist', 'restaurantstaff'];
export const INSTRUCTOR_ROLES = ['swimming_instructor'];

export const isAdminUser = (user) => ADMIN_ROLES.includes(normalizeRole(user?.role));
export const isStaffUser = (user) => STAFF_ROLES.includes(normalizeRole(user?.role));
export const isDashboardUser = (user) => DASHBOARD_ROLES.includes(normalizeRole(user?.role));
export const isInstructorUser = (user) => INSTRUCTOR_ROLES.includes(normalizeRole(user?.role));

export const sendForbidden = (res, message = 'Insufficient permissions') =>
  res.status(403).json({
    success: false,
    error: message,
    code: 'FORBIDDEN',
  });

export const sendUnauthorized = (res, message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  res.status(401).json({
    success: false,
    error: message,
    code,
  });

export const canAccessUserId = (req, targetUserId) => {
  if (!req.user) return false;
  if (isStaffUser(req.user)) return true;
  return Number(req.user.id) === Number(targetUserId);
};

export const canAccessEmail = (req, targetEmail) => {
  if (!req.user) return false;
  if (isStaffUser(req.user)) return true;
  return String(req.user.email || '').trim().toLowerCase() === String(targetEmail || '').trim().toLowerCase();
};

export const assertUserIdAccess = (req, res, targetUserId) => {
  if (canAccessUserId(req, targetUserId)) return true;
  sendForbidden(res);
  return false;
};

export const assertEmailAccess = (req, res, targetEmail) => {
  if (canAccessEmail(req, targetEmail)) return true;
  sendForbidden(res);
  return false;
};
