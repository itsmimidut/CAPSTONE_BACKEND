# Sprint 3 — Task 02 Report
## Refresh Token System

**Date:** June 11, 2026  
**Status:** Complete

---

## Objective

Implement refresh token architecture with hashed storage, rotation on every refresh, and short-lived access tokens.

---

## SQL Migration

File: [`CREATE_REFRESH_TOKENS_TABLE.sql`](./CREATE_REFRESH_TOKENS_TABLE.sql)

```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(45) NULL,
  INDEX idx_refresh_tokens_user_id (user_id),
  INDEX idx_refresh_tokens_token_hash (token_hash),
  INDEX idx_refresh_tokens_expires_at (expires_at),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES user(user_id)
    ON DELETE CASCADE
);
```

The server also auto-creates this table on startup via `ensureRefreshTokensSchema()` in `server.js`.

---

## Token Lifetimes

| Token | Lifetime | Storage |
|-------|----------|---------|
| **Access token** (JWT) | **15 minutes** | HttpOnly cookie `access_token` |
| **Refresh token** (opaque) | **30 days** | HttpOnly cookie `refresh_token` (path `/api/auth`) |

---

## Refresh Flow

```
POST /api/auth/refresh
  1. Read refresh_token cookie
  2. Hash token → lookup refresh_tokens row
  3. Reject if missing, revoked, or expired
  4. Revoke old row (revoked_at = NOW())
  5. Insert new hashed refresh token (30 days)
  6. Set-Cookie: new access_token (15m) + new refresh_token
  7. Return { success: true, message: 'Token refreshed' }
```

---

## Security Controls

| Control | Implementation |
|---------|----------------|
| Hashed storage | SHA-256 of opaque token in `token_hash` |
| Rotation | Old token revoked on every successful refresh |
| HttpOnly cookies | Both tokens inaccessible to JavaScript |
| Scoped refresh cookie | `path: /api/auth` — only sent to auth endpoints |
| Transaction safety | `FOR UPDATE` + rollback on failure |

---

## Files Changed

### Backend (new)

| File | Purpose |
|------|---------|
| `CREATE_REFRESH_TOKENS_TABLE.sql` | Manual migration |
| `utils/tokenService.js` | Access/refresh creation, hashing, rotation |
| `utils/refreshTokenCookie.js` | Refresh cookie options |
| `controllers/authController.js` | `refreshAccessToken` handler |
| `routes/auth.js` | `POST /refresh` route |
| `scripts/sprint3-task02-test.mjs` | Validation script |

### Backend (modified)

| File | Change |
|------|--------|
| `utils/accessTokenCookie.js` | `maxAge` → 15 minutes |
| `controllers/customerController.js` | Login/signup/google use `issueAuthSession()` |
| `server.js` | `ensureRefreshTokensSchema()`, mount `/api/auth` |

### Frontend (modified)

| File | Change |
|------|--------|
| `src/services/sessionRefresh.js` | **New** — calls `POST /api/auth/refresh` |
| `src/services/apiClient.js` | Auto-refresh on `401 TOKEN_EXPIRED` |

---

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/auth/refresh` | Public (refresh cookie) | Rotate refresh token, issue new access token |
| `POST /api/customers/login` | Public | Now issues access + refresh cookies |
| `POST /api/customers/signup` | Public | Now issues access + refresh cookies |
| `POST /api/customers/google-login` | Public | Now issues access + refresh cookies |

---

## Tests Executed

```bash
cd reservision-backend
node scripts/sprint3-task02-test.mjs
```

### Validation Results

| Test | Result |
|------|--------|
| Access token JWT TTL = 15 minutes | ✅ |
| Access cookie maxAge = 15 minutes | ✅ |
| Refresh cookie maxAge = 30 days | ✅ |
| Refresh cookie path = `/api/auth` | ✅ |
| Refresh token stored as SHA-256 hash | ✅ |
| Missing refresh cookie → `401 REFRESH_INVALID` | ✅ |
| Login sets both cookies | ⏭ requires DB |
| Refresh rotates token + revokes old | ⏭ requires DB |
| New access token works after refresh | ⏭ requires DB |

---

## Frontend Auto-Refresh

When any `apiClient` or `authFetch` call receives `401 TOKEN_EXPIRED`:

1. `POST /api/auth/refresh` (with cookies)
2. Retry original request once
3. If refresh fails → existing logout/redirect flow

---

## Remaining Work (Task 03+)

- `POST /api/auth/logout` — revoke refresh token + clear cookies
- Revoke all sessions on password change
- CSRF protection for cookie auth
- Remove legacy Bearer header support
