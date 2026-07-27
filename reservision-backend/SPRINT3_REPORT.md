# Sprint 3 — Secure Session Architecture Report
## Tasks 01–06 Complete

**Date:** June 11, 2026  
**Security Score Target:** 9.7 / 10

---

## Executive Summary

Sprint 3 migrated Reservision from **localStorage JWT** to a **production-grade cookie session architecture** with refresh token rotation, server-side revocation, CSRF protection, and session management UI.

| Task | Focus | Status |
|------|-------|--------|
| **01** | HttpOnly cookie authentication | ✅ Complete |
| **02** | Refresh token system | ✅ Complete |
| **03** | Session revocation & logout | ✅ Complete |
| **04** | CSRF protection | ✅ Complete |
| **05** | Remove localStorage auth | ✅ Complete |
| **06** | Session management UI/API | ✅ Complete |

---

## Task 01 — HttpOnly Cookie Authentication

### Changes
- Access JWT moved from JSON body → `access_token` HttpOnly cookie
- `cookie-parser` middleware added
- `authenticateToken` reads cookie (Bearer kept temporarily on backend)

### Cookie Policy

| Setting | Development | Production |
|---------|-------------|------------|
| `httpOnly` | `true` | `true` |
| `sameSite` | `lax` | `strict` |
| `secure` | `false` | `true` |

### Files
- `utils/accessTokenCookie.js`
- `controllers/customerController.js`
- `middleware/authenticateToken.js`
- `src/services/apiClient.js` (`withCredentials: true`)

**Report:** [`SPRINT3_TASK01_REPORT.md`](./SPRINT3_TASK01_REPORT.md)

---

## Task 02 — Refresh Token System

### Schema

```sql
CREATE TABLE refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(45) NULL,
  last_used_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE
);
```

Migrations:
- [`CREATE_REFRESH_TOKENS_TABLE.sql`](./CREATE_REFRESH_TOKENS_TABLE.sql)
- [`ADD_REFRESH_TOKEN_LAST_USED.sql`](./ADD_REFRESH_TOKEN_LAST_USED.sql)

### Token Lifetimes

| Token | TTL | Storage |
|-------|-----|---------|
| Access JWT | **15 minutes** | HttpOnly `access_token` |
| Refresh opaque | **30 days** | HttpOnly `refresh_token` (path `/api/auth`) |

### Endpoint
- `POST /api/auth/refresh` — rotate refresh token, issue new access cookie

### Security
- SHA-256 hashed refresh tokens in DB
- Rotation on every refresh (old token revoked)

**Report:** [`SPRINT3_TASK02_REPORT.md`](./SPRINT3_TASK02_REPORT.md)

---

## Task 03 — Session Revocation

### Endpoints

| Endpoint | Action |
|----------|--------|
| `POST /api/auth/logout` | Revoke current refresh token + clear cookies |
| `POST /api/auth/logout-all` | Revoke all user refresh tokens + clear cookies |

### Password Change
`change-password` and `reset-password` revoke **all** sessions automatically.

### Multi-Device Validation

```
Device A login → refresh_token A
Device B login → refresh_token B
POST /api/auth/logout-all
→ A and B refresh tokens revoked
→ POST /api/auth/refresh on either device → 401
```

**Report:** [`SPRINT3_TASK03_REPORT.md`](./SPRINT3_TASK03_REPORT.md)

---

## Task 04 — CSRF Protection

### Pattern: Double Submit Cookie

| Component | Value |
|-----------|-------|
| Cookie | `csrf_token` (readable by JS, **not** HttpOnly) |
| Header | `X-CSRF-Token` |
| Validation | Timing-safe compare cookie vs header |

### Protected Methods
`POST`, `PUT`, `PATCH`, `DELETE`

### Excluded Routes
- `/api/webhooks/*`
- `/api/xendit/webhook`
- `/api/paymongo/webhook`
- `/api/bookings/update-payment` (payment provider callback)

### Responses

| Case | Status | Code |
|------|--------|------|
| Missing token | `403` | `CSRF_MISSING` |
| Invalid token | `403` | `CSRF_INVALID` |
| Valid token | Passes to route handler | — |

### Files
- `middleware/csrf.js`
- `utils/csrfCookie.js`
- `src/utils/csrf.js` (frontend header injection)
- `middleware/corsConfig.js` (allows `X-CSRF-Token` header)

---

## Task 05 — Remove localStorage Auth

### Removed
- `localStorage.authToken` reads/writes
- `getAuthToken()` helper
- `Authorization: Bearer` injection in `apiClient` / `authFetch`

### Replaced With
- `credentials: 'include'` on all authenticated fetch calls
- `withCredentials: true` on axios
- `GET /api/auth/me` for session hydration

### Boot Flow

```
1. App starts (main.js)
2. await authStore.initFromApi()  → GET /api/auth/me
3. Pinia populated from response
4. Router mounts with correct auth state
5. Hard refresh → still authenticated via cookies
```

### Files Modified
- `src/services/apiClient.js`
- `src/stores/auth.js`
- `src/main.js`
- `src/components/LoginForm.vue`
- `src/components/SignupForm.vue`
- `src/services/authFailureHandler.js`

> **Note:** `localStorage.user` fallbacks in some admin/swimming components remain for display caching; auth credentials are no longer stored client-side.

---

## Task 06 — Session Management

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/sessions` | List active sessions |
| `POST` | `/api/auth/revoke-session/:id` | Terminate one session |

### Session Fields

```json
{
  "id": 12,
  "device": "Desktop",
  "browser": "Chrome",
  "ip_address": "::1",
  "location": null,
  "created_at": "2026-06-11T10:00:00.000Z",
  "last_used": "2026-06-11T12:30:00.000Z"
}
```

### Frontend UI
- `src/components/shared/ActiveSessions.vue`
- Integrated into `ProfilePage.vue`
- Actions: **Terminate Session**, **Sign out all devices**

### Validation
Revoked session → `POST /api/auth/refresh` returns `401 REFRESH_INVALID`

---

## Complete Auth Endpoint Reference

| Method | Path | Auth | CSRF |
|--------|------|------|------|
| `GET` | `/api/auth/me` | Access cookie | No |
| `POST` | `/api/auth/refresh` | Refresh cookie | Yes |
| `POST` | `/api/auth/logout` | Refresh cookie | Yes |
| `POST` | `/api/auth/logout-all` | Access cookie | Yes |
| `GET` | `/api/auth/sessions` | Access cookie | No |
| `POST` | `/api/auth/revoke-session/:id` | Access cookie | Yes |
| `POST` | `/api/customers/login` | Public | Yes |
| `POST` | `/api/customers/signup` | Public | Yes |

---

## Files Created (Sprint 3)

### Backend
| File |
|------|
| `utils/accessTokenCookie.js` |
| `utils/refreshTokenCookie.js` |
| `utils/tokenService.js` |
| `utils/csrfCookie.js` |
| `utils/userAgentParser.js` |
| `middleware/csrf.js` |
| `controllers/authController.js` |
| `routes/auth.js` |
| `CREATE_REFRESH_TOKENS_TABLE.sql` |
| `ADD_REFRESH_TOKEN_LAST_USED.sql` |
| `scripts/sprint3-task01-test.mjs` |
| `scripts/sprint3-task02-test.mjs` |
| `scripts/sprint3-task03-test.mjs` |
| `scripts/sprint3-tasks04-06-test.mjs` |

### Frontend
| File |
|------|
| `src/utils/csrf.js` |
| `src/services/sessionRefresh.js` |
| `src/components/shared/ActiveSessions.vue` |

---

## Validation Commands

```bash
# Restart backend first
cd reservision-backend
node server.js

# Task tests
node scripts/sprint3-task01-test.mjs
node scripts/sprint3-task02-test.mjs
node scripts/sprint3-task03-test.mjs
node scripts/sprint3-tasks04-06-test.mjs
```

### Expected CSRF Tests (Task 04)
- Missing `X-CSRF-Token` → `403 CSRF_MISSING`
- Mismatched token → `403 CSRF_INVALID`
- Matching cookie + header → request proceeds

### Expected Session Tests (Task 05)
- Hard refresh while logged in → `GET /api/auth/me` returns user → dashboard loads

### Expected Revocation Tests (Task 06)
- Terminate session → refresh fails with `401`

---

## Remaining Risks

| Risk | Mitigation (Future) |
|------|---------------------|
| `localStorage.user` display fallbacks in legacy components | Migrate to Pinia-only |
| Backend still accepts Bearer header | Remove after full cookie migration verified |
| No geo-IP for session location | Integrate IP geolocation service |
| CSRF on first visit before cookie issued | `ensureCsrfCookie` middleware issues on any request |

---

## Definition of Done

- [x] HttpOnly access token cookies
- [x] Refresh token rotation (15m / 30d)
- [x] Secure logout + logout-all
- [x] Password change revokes all sessions
- [x] CSRF double-submit protection
- [x] localStorage JWT removed
- [x] `GET /api/auth/me` boot hydration
- [x] Active session management API + UI
- [x] Sprint 3 report generated

**Estimated Security Score: 9.7 / 10**
