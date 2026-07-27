# Sprint 3 — Task 01 Report
## HttpOnly Cookie Authentication

**Date:** June 11, 2026  
**Status:** Complete

---

## Objective

Replace `localStorage` JWT delivery with an **HttpOnly `access_token` cookie** while keeping temporary **Bearer header** compatibility.

---

## Files Changed

### Backend

| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | Added `cookie-parser` |
| `server.js` | Registered `cookie-parser()` after CORS |
| `utils/accessTokenCookie.js` | **New** — cookie name, options, `setAccessTokenCookie()` |
| `middleware/authenticateToken.js` | Reads `access_token` cookie **or** `Authorization: Bearer` |
| `controllers/customerController.js` | Sets cookie on login, signup, google-login; removed `token` from JSON |
| `scripts/sprint3-task01-test.mjs` | **New** — automated validation script |

### Frontend (required for cookie transport)

| File | Change |
|------|--------|
| `src/services/apiClient.js` | `withCredentials: true` (axios), `credentials: 'include'` (authFetch) |
| `src/components/LoginForm.vue` | `credentials: 'include'`; no longer stores `authToken` |
| `src/components/SignupForm.vue` | Same as login |
| `src/stores/auth.js` | Google login uses cookies; `initFromStorage()` restores user profile only |

---

## Endpoints Changed

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /api/customers/login` | `{ success, token, customer }` | `Set-Cookie: access_token=…` + `{ success, customer }` |
| `POST /api/customers/signup` | `{ success, token, customer }` | `Set-Cookie: access_token=…` + `{ success, customer }` |
| `POST /api/customers/google-login` | `{ success, token, customer }` | `Set-Cookie: access_token=…` + `{ success, customer }` |
| All protected routes | Bearer header only | Cookie **or** Bearer (legacy) |

---

## Cookie Configuration

| Setting | Development | Production |
|---------|-------------|------------|
| `httpOnly` | `true` | `true` |
| `sameSite` | `lax` | `strict` |
| `secure` | `false` | `true` |
| `maxAge` | 7 days (matches JWT `expiresIn`) | 7 days |
| `path` | `/` | `/` |

---

## Authentication Flow (New)

```
1. POST /api/customers/login  (credentials: 'include')
2. Server signs JWT → res.cookie('access_token', jwt, options)
3. Response body: { success: true, customer: {…} }   // no token field
4. Browser stores HttpOnly cookie automatically
5. apiClient / authFetch send cookie on subsequent requests (withCredentials)
6. authenticateToken reads req.cookies.access_token
```

**Legacy:** If `localStorage.authToken` still exists, `apiClient` continues sending `Authorization: Bearer` until cleared.

---

## Tests Executed

```bash
cd reservision-backend
node scripts/sprint3-task01-test.mjs
```

### Validation Results

| Test | Result |
|------|--------|
| Dev cookie options (`httpOnly`, `lax`, `secure: false`) | ✅ PASS |
| Protected route rejects missing auth (`401 TOKEN_MISSING`) | ✅ PASS |
| `authenticateToken` accepts `access_token` cookie | ✅ PASS |
| Bearer header compatibility (temporary) | ✅ PASS |
| Cookie persists across simulated refresh | ✅ PASS |
| Login response excludes `token` field | ✅ PASS |
| Full login → Set-Cookie integration | ⏭ SKIP (DB unavailable in test env) |

**Summary: 6/6 core auth tests passed** (login integration skipped pending database)

> When MySQL is running, re-run with valid credentials:
> `TEST_LOGIN_EMAIL=you@example.com TEST_LOGIN_PASSWORD=secret node scripts/sprint3-task01-test.mjs`

### Manual Validation Checklist

- [x] Login no longer returns `token` in JSON
- [x] Middleware accepts cookie-based JWT
- [x] Middleware still accepts Bearer token
- [x] Frontend sends `credentials: 'include'`
- [ ] Browser refresh + protected page (verify with live DB + frontend dev server)

---

## Compatibility Notes

| Area | Impact |
|------|--------|
| **Cross-origin dev** (`localhost:5173` → `localhost:8000`) | Cookies sent when `credentials: 'include'` + CORS `credentials: true` (already configured) |
| **Existing sessions** | Users with old `localStorage.authToken` keep working via Bearer until they log in again |
| **Logout** | Cookie not cleared yet (Task 02+); client clears `localStorage.user` only |
| **Payment webhooks** | Unaffected — no cookie auth |
| **Mobile / third-party API clients** | Can still use Bearer header during compatibility window |

---

## Remaining Work (Future Tasks)

- `POST /api/auth/logout` to clear `access_token` cookie
- Refresh token rotation (short-lived access + long-lived refresh)
- Remove Bearer header compatibility
- Remove `localStorage.user` fallbacks across components
- CSRF protection for cookie-based auth
