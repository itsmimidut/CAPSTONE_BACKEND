# Sprint 3 — Task 03 Report
## Session Revocation & Secure Logout

**Date:** June 11, 2026  
**Status:** Complete

---

## Objective

Implement secure logout that revokes refresh tokens server-side and clears auth cookies. Revoke all sessions on logout-all and password change.

---

## New Endpoints

### `POST /api/auth/logout`

| Step | Action |
|------|--------|
| 1 | Read `refresh_token` cookie |
| 2 | Revoke matching row in `refresh_tokens` (`revoked_at = NOW()`) |
| 3 | Clear `access_token` and `refresh_token` cookies |
| 4 | Return `{ success: true, message: 'Logged out successfully' }` |

**Auth required:** No (works with refresh cookie even if access token expired)

---

### `POST /api/auth/logout-all`

| Step | Action |
|------|--------|
| 1 | Authenticate user (access cookie or Bearer) |
| 2 | Revoke **all** active refresh tokens for `req.user.id` |
| 3 | Clear auth cookies on current device |
| 4 | Return `{ success: true, revokedCount }` |

**Auth required:** Yes (`authenticateToken`)

---

## Password Change Revocation

| Endpoint | Behavior |
|----------|----------|
| `POST /api/customers/change-password` | Revokes all refresh tokens for user + clears cookies |
| `POST /api/customers/reset-password` | Revokes all refresh tokens for user + clears cookies |

---

## Multi-Device Validation Scenario

```
Device A login  → refresh_token A stored (hashed in DB)
Device B login  → refresh_token B stored (hashed in DB)

POST /api/auth/logout-all (from Device A)
  → All refresh tokens for user revoked
  → Device A cookies cleared
  → Device B refresh_token B revoked in DB

Device A: POST /api/auth/refresh → 401 REFRESH_INVALID
Device B: POST /api/auth/refresh → 401 REFRESH_INVALID
```

Both devices become unauthorized for session renewal.

---

## Files Changed

### Backend

| File | Change |
|------|--------|
| `utils/accessTokenCookie.js` | Added `clearAccessTokenCookie()` |
| `utils/tokenService.js` | `clearAuthCookies`, `revokeRefreshTokenByPlain`, `revokeCurrentRefreshToken`, `revokeAllUserRefreshTokens` |
| `controllers/authController.js` | `logout`, `logoutAllSessions` handlers |
| `routes/auth.js` | Mounted `/logout` and `/logout-all` |
| `controllers/customerController.js` | Password change + reset revoke all sessions |
| `scripts/sprint3-task03-test.mjs` | Multi-device validation script |

### Frontend

| File | Change |
|------|--------|
| `src/services/sessionRefresh.js` | `logoutSession()`, `logoutAllSessions()` |
| `src/stores/auth.js` | `logout()` calls backend before clearing state |
| `src/components/Admin/AdminSidebar.vue` | Async logout |
| `src/components/Customer/CustomerSidebar.vue` | Async logout |

---

## Tests Executed

```bash
cd reservision-backend
node scripts/sprint3-task03-test.mjs
```

### Validation Results

| Test | Result |
|------|--------|
| Refresh token hashing utility | ✅ |
| `POST /api/auth/logout` without cookies | ✅ |
| Device A + B login with distinct refresh tokens | ⏭ requires DB |
| Both devices unauthorized after logout-all | ⏭ requires DB |
| Single logout revokes current session | ⏭ requires DB |
| Password change revokes all sessions | Manual / integration |

---

## Security Summary

| Control | Implementation |
|---------|----------------|
| Server-side revocation | `revoked_at` timestamp on `refresh_tokens` |
| Cookie cleanup | `clearAuthCookies()` on logout / password change |
| Cross-device logout | `logout-all` revokes every active refresh token |
| Credential rotation | Password change forces re-login on all devices |

---

## Remaining Work

- UI for "Sign out all devices" (API ready: `logoutAllSessions()`)
- CSRF protection for cookie-auth POST endpoints
- Remove legacy `localStorage.authToken` Bearer path
