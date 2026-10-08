# B2B Resort Booking Portal

A multi-tenant B2B booking platform for travel agencies to self-onboard, complete KYB/eKYC
verification, and (once approved and activated) book resort rooms at agency-specific net prices.
See [`projectScope.md`](projectScope.md) and [`Instructions.md`](Instructions.md) for the full
product and build spec.

**This repository implements all 8 phases** (per `Instructions.md` §13):

- **Phase 1 — Foundation:** auth, RBAC, MFA, the portal-owned data model (minus bookings),
  audit-log infrastructure, and secure file storage/secrets scaffolding.
- **Phase 2 — Onboarding:** public self-service registration with resumable drafts, GSTIN/PAN
  duplicate detection, document upload to secure storage, the agency lifecycle state machine
  (Draft→Verification wired; full transition table defined), and a read-only admin applications
  view with masked PII.
- **Phase 3 — Verification:** Digio KYB/eKYC integration (GST, PAN, Aadhaar eKYC, bank, document)
  behind a swappable `DigioClient` adapter (mock + live skeleton), a signature-validated,
  idempotent webhook handler, per-check `Verification` records with audit logging, and
  configurable auto-progression (D8) to Review once all mandatory checks are terminal.
- **Phase 4 — Review & activation:** admin verification dashboard (queue + detail + actions),
  verifier approve / reject (mandatory reason) / request-resubmission, commercial configuration
  from configurable tier presets with per-agency overrides (versioned), agreement generation +
  Digio Aadhaar eSign, auto-activation on signed (creates the Agency + its initial AGENCY user +
  welcome email), and admin suspend / reactivate.
- **Phase 5 — Notifications:** a central, event-driven templated notification service (registration,
  verification, approval, rejection, re-submission, agreement/eSign, activation, suspension,
  reactivation) delivered over email with optional SMS for time-sensitive events, each send
  audit-logged. Delivery is synchronous.
- **Phase 6 — Booking core:** AxisRooms read/write behind a swappable adapter (mock + live skeleton)
  with a short-TTL availability cache and refresh-before-book; server-side agency-price computation
  (base rate never exposed); the **unified credit gate** (one rule for prepay / within-limit /
  over-limit, D3) with a tentative hold + TTL on the pay-first branch; AxisRooms commit on confirm
  with **downtime blocking (block, don't queue)** and idempotent writes keyed on the booking
  correlation id; plus the agent booking UI (search, availability, book, pay, cancel, history).

- **Phase 7 — Finance:** invoices + agency AR (outstanding = unpaid credit invoices, feeding the
  credit gate), a payment gateway behind an adapter (mock + Airpay skeleton) with a
  signature-validated idempotent webhook, settlement of credit invoices, a configurable
  cancellation policy (D4 bands) with refunds, CRS event postings via a transactional **outbox**
  (idempotent, delivered inline + retryable via the admin flush endpoint), a **reconciliation** drift report,
  and dashboard aggregation endpoints (`/api/dashboard/admin`, `/api/dashboard/agency`).

- **Phase 8 — Hardening:** per-account rate limiting on sensitive authenticated actions (in
  addition to the existing per-IP/onboarding limiters, duplicate GST/PAN detection, and CAPTCHA
  hook), audited anomaly alerting on high-volume onboarding activity, an admin **audit-log review
  UI** (`/audit`, filterable by event/entity/actor/correlation/date), a **Reports** page
  (`/reports`) with revenue-by-agency and bookings-by-resort breakdowns + CSV export backed by
  `/api/reports/summary`, and operational docs (`docs/RUNBOOK.md`, `docs/API-CONTRACTS.md`).

All three role dashboards use a shared, reference-styled shell (fixed sidebar + top bar) with
**Recharts** visualizations on real data: the Admin/Verifier dashboard shows KPI cards (bookings,
revenue, active agents/agencies, outstanding), a bookings-&-revenue trend line, top resorts by
revenue, recent bookings, and a bookings-by-status donut; the Agency dashboard shows its
balance/credit KPIs, spend trend, status donut, and recent bookings; the Agent dashboard shows
booking shortcuts + summary KPIs. Finance UI: agencies see invoices/balance and settle credit
invoices; admins get the reconciliation drift report + CRS outbox flush. The verification queue
lives at `/applications`.

Every external integration (AxisRooms, Digio, CRS, Airpay) runs behind a swappable adapter with a
`mock` implementation, so the whole system is testable end-to-end without live credentials; the
`live` clients are drop-in skeletons documented in `docs/API-CONTRACTS.md`.

## Stack

- **API** (`server`): Node.js + Express + TypeScript, Prisma ORM over PostgreSQL, JWT auth with
  RBAC + MFA (TOTP/email OTP), Winston/Morgan logging, Swagger docs, Vitest.
- **Web** (`web`): React + TypeScript + Vite + Tailwind CSS, React Router, TanStack Query,
  Zustand.
- One deployable full-stack application: `server/` and `web/` remain internal workspaces for code
  organization, while the root Express entry serves both under one Vercel domain.

## Prerequisites

- Node.js 20+
- A **Supabase PostgreSQL** connection string (`DATABASE_URL`) works for both local and production.
  No Docker or local database installation is required.
  (Supabase note: use the **Session pooler** URL — the direct host is IPv6-only.)

## Setup

```bash
npm install

# Backend env:
cp server/.env.example server/.env
# Set DATABASE_URL to your managed Postgres, and fill the secrets:
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / JWT_MFA_SECRET
#     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   MFA_ENCRYPTION_KEY  (exactly 64 hex chars)
#     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run db:generate                      # generates Prisma Client
npm run db:migrate                       # applies local development migrations
npm run db:seed                          # creates admin + demo login users

# Frontend env (defaults are fine for local dev — Vite proxies /api to :4000):
cp web/.env.example web/.env

npm run dev       # web: http://localhost:5173, API/docs: http://localhost:4000/api/docs
```

## Deployment

- Import the **repository root** as one Vercel project. The root `index.ts` is the Express Function;
  `npm run build` compiles the API and writes the React application to `public/` for Vercel's CDN.
- Leave `VITE_API_BASE_URL` empty. Browser requests use same-origin `/api`, so preview and production
  deployments work without a separately configured API host.
- Add the values from `server/.env.example` to Vercel, including `DATABASE_URL`, JWT/MFA/webhook
  secrets, `APP_BASE_URL`, `CRON_SECRET`, and the Supabase storage credentials. Use
  `STORAGE_PROVIDER=supabase`; Vercel Functions do not provide persistent local file storage.
- For live updates, set `REALTIME_ENABLED=true`, `REALTIME_CHANNEL_SECRET`, `VITE_SUPABASE_URL`, and
  `VITE_SUPABASE_PUBLISHABLE_KEY`. The service-role key remains server-only.
- Run `npm run db:migrate:deploy` against Supabase before the production deployment. Migrations are
  intentionally not run during Vercel builds because preview builds may run concurrently.
- The five-minute maintenance schedule in `vercel.json` requires Vercel Pro; Hobby permits only
  daily cron schedules. The repository is also GitHub-organization-owned, which requires a paid
  Vercel team for Git integration. Dunning runs daily at 03:00 UTC.

### Logging in

The seed creates these users (dev):

| Login | Password | Role | MFA |
|---|---|---|---|
| `admin@parakkatjewels.com` | `admin123` | ADMIN | required (TOTP setup on first login) |
| `agency@demo.com` | `agency123` | AGENCY | none — logs in directly |
| `agent@demo.com` | `agent123` | AGENT | none — logs in directly |

ADMIN/VERIFIER mandate MFA, so the admin's first login returns `mfaSetupRequired` and the frontend
routes to a TOTP enrollment QR — scan it with any authenticator app, confirm the code, and you're
in. The demo AGENCY/AGENT users skip MFA for quick testing. (The demo users are dev-only: skipped
when `NODE_ENV=production` or `SEED_DEMO=false`.)

## Testing

```bash
npm run test:unit --workspace server       # 111 unit tests, no DB needed

# Integration tests need a Postgres test database. Point .env.test's DATABASE_URL
# at one (managed Postgres works), migrate it once, then run:
npm run db:migrate:deploy --workspace server   # against the .env.test DATABASE_URL
npm run test --workspace server                # full suite (unit + integration)
```

Test files run serially (they share one Postgres test database and truncate it between tests);
rate limiting is disabled under `NODE_ENV=test`.

- **Unit tests** (`server/tests/unit`) have no external dependencies and run standalone —
  password hashing, JWT issue/verify, TOTP crypto, RBAC middleware, local-disk storage, mailer.
- **Integration tests** (`server/tests/integration`) run against a real database. Copy
  `server/.env.test.example` to `server/.env.test` and point `DATABASE_URL` at a disposable
  test database (integration tests truncate all tables between runs — never point this at
  dev/prod data).

```bash
npm run lint --workspaces
npm run typecheck --workspaces
```

All of the above pass as of this Phase 1 build for everything that doesn't require a live
database connection (unit tests, lint, typecheck, both apps' production builds, and the API server
booting and serving `/api/health/live` + `/api/docs`). The Prisma migration and the DB-backed
integration tests need to be run once against a real Postgres instance.

## Project structure

```
server/    Express API — see server/src for config, lib (providers), middleware, modules
web/    React frontend — see web/src for api client, store, routes, pages
```

Key design decisions and their rationale live as comments in the relevant files:
- `server/src/middleware/rbac.ts` — role gating + tenant isolation (`requireRole`,
  `requireOwnAgency`, `scopeToAgency`)
- `server/src/modules/auth/auth.service.ts` — login/MFA state machine, including the
  `mfaSetupRequired` first-login path for roles that mandate MFA
- `server/src/modules/audit/audit.service.ts` and `README.md` — the single append-only
  audit-log write path and why it's explicit calls rather than Prisma middleware
- `server/src/modules/lifecycle/lifecycle.machine.ts` + `lifecycle.service.ts` — the single
  agency-lifecycle state machine every transition routes through (legal transitions + who may
  perform each + transactional audit)
- `server/src/modules/onboarding/` — public self-service onboarding: resumable drafts guarded by
  a resume token (`middleware/resumeToken.ts`), submit-time validation, GSTIN/PAN duplicate
  detection
- `server/prisma/schema.prisma` — full data model with inline notes on what's a Phase 3+ seam

### Onboarding flow (Phase 2)

Public applicant endpoints under `/api/onboarding` require no account — a `POST /applications`
returns a one-time **resume token** the applicant supplies via the `x-resume-token` header to
resume, edit, upload documents to, and submit their draft. Submission runs full validation +
duplicate detection, then routes `Draft → Verification` through the lifecycle module. Admin/Verifier
users read applications (PII masked) at `GET /api/applications`. The frontend exposes this at
`/onboarding/register`, `/onboarding/resume`, and `/onboarding/status`.

### Verification flow (Phase 3)

On submit, the mandatory Digio checks are created as `Verification` rows and initiated through the
`DigioClient` (`server/src/lib/digio/`). With `DIGIO_PROVIDER=mock` (default) no live call is made;
results are delivered by POSTing to `POST /api/webhooks/digio` with a valid `x-digio-signature`
header (hex HMAC-SHA256 of the raw body using `DIGIO_WEBHOOK_SECRET`). The handler rejects
unverified callbacks with no state change and ignores retries for an already-terminal check
(idempotent). Once all mandatory checks reach a terminal status, the application auto-progresses
`Verification → Review` (clean if all passed, flagged otherwise). Admins can re-initiate checks
(`POST /api/applications/:id/verifications/initiate`) or manually override one
(`POST /api/applications/:id/verifications/:checkType/override`).

To drive a full run locally against a live DB: submit an application, read each check's
`providerRef`, then post a signed webhook per check. See
`server/tests/integration/verification.flow.test.ts` for the exact shape (including the
`signDigioBody` helper used to sign test payloads).

### Review → activation flow (Phase 4)

Once an application reaches `REVIEW`, an ADMIN/VERIFIER works it from the dashboard
(`AdminDashboard` / `VerifierDashboard` → `/admin/applications/:id`):

1. **Approve** (`POST /applications/:id/approve`) → `APPROVED`; or **reject** with a mandatory
   reason (`/reject`, terminal); or **request re-submission** (`/request-resubmission`) which sends
   it back to `VERIFICATION` and re-runs the named checks.
2. **Commercial config** (`POST /applications/:id/commercial-config` with `{ tier, overrides }`) —
   resolves the four terms from a tier preset (prepay ⇒ credit limit ₹0), versions the
   configuration, creates the `Agency`, and moves to `COMMERCIAL_CONFIGURATION`. Presets are
   configurable via `TIERS_CONFIG_JSON`.
3. **Agreement + eSign** (`POST /applications/:id/agreement/send`) — generates the agreement,
   stores it, and initiates Digio Aadhaar eSign (mock returns a signing URL). Completion arrives as
   a signed webhook to `/api/webhooks/digio` for the ESIGN `providerRef`.
4. On **signed**, the agency auto-activates: `→ ACTIVE`, `activatedAt` stamped, the initial
   AGENCY-role user created with a temporary password (emailed; logged by the console mailer in
   dev). A declined/expired eSign holds at `COMMERCIAL_CONFIGURATION`.
5. **Suspend / reactivate** an active agency: `POST /agencies/:id/suspend` | `/reactivate`.

The full happy path plus reject/suspend is exercised in
`server/tests/integration/activation.flow.test.ts`.

### Notifications (Phase 5)

Every lifecycle/verification event routes through one `notify()` entry point
(`server/src/modules/notifications/`). Templates are pure render functions
(`templates.ts`) producing the email subject/body and an optional SMS for
time-sensitive events (eSign request, activation); `notification.service.ts`
dispatches over email (+ SMS when `SMS_NOTIFICATIONS_ENABLED`) and audit-logs
each send as `NOTIFICATION_SENT` — recording the event, channels, and a *masked*
recipient, never the message body (so a temporary password is never persisted).

Delivery is synchronous (no queue/Redis). Notification wiring + audit is covered by
`server/tests/integration/notifications.flow.test.ts`. (Async/queued delivery is a future
enhancement.)

### Booking flow (Phase 6)

An AGENT/AGENCY user searches resorts (`GET /api/catalog/resorts`,
`/api/catalog/availability`) and sees the **agency price** computed server-side
(`modules/booking/pricing.ts`) — the base rate and customer price are never
exposed. `POST /api/bookings` runs the **single credit gate**
(`modules/booking/creditGate.ts`): if `outstanding + price ≤ effective limit`
the booking is confirmed on credit and committed to AxisRooms immediately;
otherwise it enters `AWAITING_PAYMENT` with a tentative hold (TTL
`BOOKING_HOLD_TTL_MINUTES`, held in the portal, not AxisRooms). `POST
/bookings/:id/pay` (mock payment; real gateway is Phase 7) then commits it.
Both branches converge on a `COMMITTED` reservation pushed to AxisRooms with the
booking correlation id as the idempotency key. AxisRooms is health-checked before
any commit — if it's down the booking is **blocked, never queued** (simulate with
`AXISROOMS_FORCE_DOWN=true`). Everything is agency-scoped and gated on an ACTIVE
agency. Covered end-to-end in `server/tests/integration/booking.flow.test.ts`.

The seeded demo agency (`agency@demo.com` / `agency123`) and agent
(`agent@demo.com` / `agent123`) have GOLD credit terms, so they can book immediately from
`/book` in the web app.

## Environment variables

See `server/.env.example` for server-only values and `web/.env.example` for the two public Supabase
browser values. `server/src/config/env.ts` validates server configuration at boot with Zod and
fails fast if anything required is missing or malformed.
