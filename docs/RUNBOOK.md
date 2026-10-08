# Runbook — B2B Resort Booking Portal

Operational notes for running, deploying, and troubleshooting the portal. Architecture and the
per-phase feature list are in the root `README.md`; external integrations are in
`docs/API-CONTRACTS.md`.

## Services
- **Portal** — one Vercel project and domain: the Next.js app in `web/` (Root Directory `web`,
  region `sin1`). Its pages are static on the CDN; `/api/*` is one Function that runs the Express
  API in-process.
- **PostgreSQL + Auth + Storage + Realtime** — Supabase provides the persistent data services and
  sign-in (Supabase Auth: users, passwords, sessions, TOTP factors).

Notifications are delivered synchronously; the CRS outbox is flushed inline after each financial
change (no Redis/queue/worker). Async/queued delivery is a future enhancement.

**Realtime (Supabase Broadcast):** the API sends lightweight cache-topic invalidations through
Supabase. Authenticated clients obtain HMAC-derived admin/agency channel names from
`GET /api/realtime/config`; no business records are included in a broadcast. The frontend polls
active data once per minute if Realtime is unavailable.

## Local run
```bash
npm install
# Set server/.env DATABASE_URL to Supabase.
npm run db:generate
npm run db:migrate                     # once
npm run db:seed                        # admin + demo users (see README)
npm run dev                            # app :3000 (proxies /api) + API :4000
```

## Deploy (one Vercel project)
- Root Directory `web`; `web/vercel.json` sets the framework, build, region and crons.
- Configure the server values from `server/.env.example` (including `IDENTITY_PROVIDER=supabase`)
  and the public `NEXT_PUBLIC_*` values from `web/.env.example`. First move to Supabase Auth: see
  "Moving to Supabase Auth" in the README.
- Set `STORAGE_PROVIDER=supabase`, `SCHEDULER_ENABLED=false`, a random `CRON_SECRET`, and
  `REALTIME_ENABLED=true` with a random `REALTIME_CHANNEL_SECRET`.
- Apply migrations separately with `npm run db:migrate:deploy`, then deploy. Verify
  `/api/health/live`, `/api/health/ready`, a login, a deep link, and uploaded-file access.
- `web/vercel.json` invokes maintenance every five minutes and dunning daily. The five-minute schedule
  requires Vercel Pro; use an external scheduler against the same protected routes otherwise.
- Turn on per-role MFA enforcement in System Settings → Security (the `MFA_ENFORCE*` env flags are
  not read; only `MFA_DISABLED` is), and switch providers to `live`/`airpay` when their credentials/contracts
  are available (see `docs/API-CONTRACTS.md`).

## Health & monitoring
- `GET /api/health/live` — liveness. `GET /api/health/ready` — database reachability.
- Logs: Winston (JSON) with a correlation id per request. Sentry/Prometheus hooks are stack choices
  in the README; wire in deploy.

## Common operations
- **Verification stuck**: an application waits in `VERIFICATION` until all Digio checks are terminal.
  Re-run: `POST /api/applications/:id/verifications/initiate`; manual override:
  `.../verifications/:checkType/override`. Drive mock results with signed webhooks (see API-CONTRACTS).
- **Activate without eSign**: not permitted — `POST /applications/:id/activate` refuses without a
  signed agreement.
- **CRS drift**: `GET /api/finance/reconciliation` reports committed-without-invoice/ref and
  pending/failed CRS events. Retry delivery: `POST /api/finance/crs/flush`.
- **Booking blocked**: if AxisRooms is down (`healthCheck` false / `AXISROOMS_FORCE_DOWN=true`),
  booking returns 503 by design — never queued. Restore AxisRooms to resume.
- **Audit review**: admins query `GET /api/audit-logs` (filters: event, entityType, actorRole,
  correlationId, date range) or the **Activity Logs** UI.
- **Abuse**: public onboarding is IP-rate-limited; sensitive authenticated actions are per-account
  limited; anomalous onboarding volume raises an audited `ONBOARDING_ANOMALY_DETECTED` event.
  Rate limiting is disabled outside production.

## Data & migrations
- Migrations in `server/prisma/migrations` (generated offline via `prisma migrate diff`; applied
  with `migrate deploy`). Never edit an applied migration — add a new one.
- The audit log is append-only (no update/delete path is exposed).
