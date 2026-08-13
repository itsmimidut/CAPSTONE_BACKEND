# Reservision Go-Live Runbook

## Release gate

1. Apply reviewed database migrations and take a restorable database backup.
2. Run `npm test` in the backend.
3. Run `npm run verify:operational-readiness` in the backend.
4. Run `npm run build` in the frontend.
5. Confirm `GET /health/live` returns HTTP 200 and `GET /health/ready` returns HTTP 200.
6. Sign in as an administrator and review `GET /api/admin/operational-readiness`.

## Required production configuration

- `NODE_ENV=production`
- `PORT`
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- A strong `JWT_SECRET`
- `FRONTEND_URL` using the production HTTPS origin
- `XENDIT_SECRET_KEY` and `XENDIT_WEBHOOK_TOKEN`
- One supported email provider configuration for customer notifications

Never put secret values in logs, tickets, screenshots, or readiness responses.

## Monitoring

- Liveness: `/health/live`
- Dependency readiness: `/health/ready`
- Detailed authenticated diagnostics: `/api/admin/operational-readiness`
- Alert on HTTP 5xx, readiness failures, failed refunds, failed payments, and stale forecast models.

## Backup and restore

- Back up the database before every deployment and at least daily.
- Encrypt backups, restrict access, define retention, and test restoration regularly.
- Keep uploaded assets and predictive model artifacts in the backup scope.
- A backup is not considered valid until a restore test succeeds.

## Shutdown and rollback

The server drains HTTP connections and closes the database pool on SIGINT/SIGTERM. If a release fails its smoke tests, restore the previous application release; restore the database only when the migration rollback procedure explicitly requires it.
