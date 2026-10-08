# Security Hardening & Penetration-Test Checklist — B2B Resort Booking Portal

Pre-engagement hardening review and a scoped test plan for an external penetration test. Maps the
attack surface to what to verify. Pair with `docs/RUNBOOK.md` (deploy/secrets) and
`docs/DR-BACKUP-RUNBOOK.md`.

Legend: **[✓ built]** already implemented in the codebase — *verify it holds*; **[DECIDE]** an
operational/business decision the pen-test scope needs; **[GAP]** known follow-up to close before
go-live.

## 1. Engagement scope & rules of engagement (DECIDE)
- Targets: the API origin (`<api-url>`), the web origin (`<web-url>`), and the auth/session surface.
  **Exclude** third-party vendor systems (AxisRooms, CRS, Airpay, Digio, Supabase) — test only *our*
  integration handling, not their infrastructure.
- Environment: a **dedicated staging** with production-like config and **synthetic data only** — never
  production PII.
- Windows, rate-limit allowances, and a named emergency contact: **DECIDE** with the vendor.
- Provide test accounts for all four roles (Admin/Verifier/Agency/Agent) across **two** agencies (to
  test tenant isolation).

## 2. Authentication & session

| Item | Status | Verify |
|---|---|---|
| Password hashing (bcrypt, cost 12) | ✓ built | No plaintext/reversible storage; cost is adequate |
| Password policy (len + upper/lower/digit/symbol) | ✓ built (§10.2) | Enforced server-side on create + change; can't be bypassed via API |
| Forced change of temp passwords | ✓ built | `mustChangePassword` set on all temp/admin-set passwords |
| MFA mandatory for Admin/Verifier/Agency | ✓ built (§10.2) | Cannot reach protected routes without completing MFA; setup-required path can't be skipped |
| TOTP secret encryption (AES-256-GCM) | ✓ built | Secret never returned; key only in env; not logged |
| Access token in memory only; refresh in httpOnly cookie | ✓ built | Token not in localStorage; cookie `HttpOnly`+`Secure`(prod)+`SameSite=strict` |
| Refresh-token rotation + reuse detection | ✓ built | Replaying a used/revoked token revokes the family |
| Session revocation on password change / suspend | ✓ built | Other sessions invalidated |
| Login rate limiting | ✓ built | `authLimiter` throttles brute force; verify thresholds are production-appropriate |
| Account lockout policy | [DECIDE] | Confirm whether progressive lockout is required beyond rate limiting |
| Generic auth errors (no user enumeration) | ✓ built | "Invalid email or password" regardless of which is wrong; check timing side-channels |

**Pen-test focus:** JWT tampering (alg-none, signature strip, expiry/role/agencyId claim edits), MFA
bypass, pending-token reuse/forgery, cookie theft/replay, refresh-rotation race conditions.

## 3. Authorization & multi-tenancy (highest-value target)

| Item | Status | Verify |
|---|---|---|
| Role gating (`requireRole`) on every route | ✓ built | No admin/verifier route reachable by agency/agent |
| Tenant isolation (`scopeToAgency` defence-in-depth) | ✓ built | Service queries merge the caller's `agencyId`, not just route guards |
| Agent permission flags (canBook/canCancel/canModify/canViewReports) | ✓ built | Enforced server-side, not just hidden in UI |
| RLS enabled on all public tables | ✓ built (`enable_rls` migration) | Prisma `postgres` role bypasses (by design); anon/PostgREST denied |
| `service_role` key server-side only | ✓ built | Never shipped to the browser bundle |

**Pen-test focus (IDOR/BOLA):** with a valid Agency-A token, attempt every object-scoped endpoint
using Agency-B ids — bookings, invoices, payments, agents, balances, rebook queue, documents. Expect
404/403, **never** foreign data. Try horizontal (agency↔agency) and vertical (agent→agency→admin)
escalation. Confirm the API enforces isolation even when the UI would hide the action.

## 4. Input validation & injection

| Item | Status | Verify |
|---|---|---|
| Request validation (Zod on body/query/params) | ✓ built | Every route validated; reject unknown/oversized payloads |
| ORM parameterization (Prisma) | ✓ built | No raw string-concatenated SQL; check any `$queryRaw` usage is parameterized |
| Child-age / occupancy / date bounds | ✓ built (§2.2) | Server rejects out-of-range ages, negative counts, inverted date ranges |
| Money/amount validation | ✓ built | Partial-payment amount can't exceed remaining; no negative charges |
| File upload validation | ✓ built | Type/size limits; stored by opaque key; not served as executable |

**Pen-test focus:** SQLi via any raw query, NoSQL/operator injection in JSON, path traversal in
document keys, XSS (stored in guest names / special requests / notes; reflected in error messages),
SSRF via any URL-accepting field, mass-assignment (extra fields like `role`/`agencyId`/`amountPaid`
in create/update bodies).

## 5. Business-logic abuse (portal-specific)

The highest-impact bugs here are **logic**, not classic web vulns:
- **Credit gate bypass:** can a booking exceed the credit limit by racing concurrent requests, or via
  the group-vs-single path? (Gate runs on aggregate for groups — probe concurrency.)
- **Price tampering:** client-supplied prices are ignored (server recomputes) — confirm no endpoint
  trusts a submitted amount/markup.
- **Chargeback/refund abuse:** double chargeback (idempotency), refund exceeding paid, chargeback of a
  non-inbound/failed payment.
- **Rebook queue:** can a COMMIT_FAILED booking be paid/committed twice, or its held funds be both
  refunded and committed?
- **Cancellation timing:** manipulate dates to dodge policy charges; ensure server uses server time.
- **Hold expiry race:** pay a hold at the exact TTL boundary.
- **Inventory:** exceed a CAP/stop-sell by racing search→commit (policy is re-checked at commit — probe the window).

## 6. Sensitive data & privacy (DPDP)

| Item | Status | Verify |
|---|---|---|
| Guest ID minimisation (only type + last-4) | ✓ built (§8) | Full ID never persisted or logged; UI masks as `••••1234` |
| Aadhaar handling in onboarding | ✓ built | Reference/token only, never the raw number |
| Audit log is append-only | ✓ built | No update/delete path exposed |
| PII in logs | [GAP] verify | Confirm request/error logs don't capture passwords, tokens, full IDs, card data |
| Data-principal access/erasure endpoints | [GAP] | §8.3 follow-up — not yet built; decide DPDP process |
| At-rest encryption of retained PII beyond last-4 | [DECIDE] | Confirm DB/storage encryption at rest is enabled by the provider |
| Data retention schedule | [DECIDE] | Define retention/erasure timelines for applications, bookings, documents |

## 7. Transport, headers & CORS

| Item | Status | Verify |
|---|---|---|
| HTTPS everywhere; HSTS | [DECIDE] | Enforced at the Vercel platform edge |
| CORS allow-list (`CORS_ORIGIN`) | ✓ built | Only the web origin; not `*`; credentials handling correct |
| Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) | [GAP] verify | Confirm a helmet-style header set is applied at the API/edge; add CSP for the SPA |
| Cookie flags in production | ✓ built | `Secure` on in prod; `SameSite=strict`; scoped path |

**Pen-test focus:** TLS config (weak ciphers/versions), missing headers, clickjacking, CORS
misconfig / credentialed cross-origin, cookie scope.

## 8. Secrets, config & supply chain

| Item | Status | Verify |
|---|---|---|
| Prod refuses dev webhook-secret defaults / missing live creds | ✓ built (`config/env.ts`) | Boot fails safely on misconfig |
| Webhook signature verification (Airpay/Digio, HMAC + timing-safe compare) | ✓ built | Reject unsigned/mismatched; replay-protect where possible |
| `MFA_ENCRYPTION_KEY` & webhook secrets in a secret manager | [DECIDE] | Not in git/CI logs; escrowed (see DR runbook) |
| No secrets in the web bundle | ✓ built | Grep the built bundle for keys/tokens |
| Dependency audit | [DECIDE] | `npm audit` / SCA in CI; triage highs before go-live |
| CI hooks/signing not bypassed | ✓ built | Commits don't skip hooks/signing |

## 9. Rate limiting, DoS & abuse
- Auth and account endpoints are rate-limited (`authLimiter`, `accountLimiter`) — **[DECIDE]** confirm
  production thresholds and whether an edge WAF/DDoS layer is in front.
- Pagination caps on list endpoints (max page size) — ✓ built; verify no unbounded queries.
- Bulk endpoints (rate-calendar apply, group booking, dunning run) are admin-only and bounded — verify
  input array caps.

## 10. Observability & incident readiness
- Audit trail present for every state change (logins, bookings, payments, cancellations, chargebacks,
  password changes, agency lifecycle) — ✓ built; verify completeness during the test.
- Alerting for auth-failure spikes, pool exhaustion, outbox/rebook growth — see DR runbook §4.
- **[DECIDE]** log retention, tamper-evidence, and who reviews the audit log.

## 11. Known follow-ups to close before go-live (GAP summary)
1. Confirm/add **security response headers + CSP** at the API/edge (§7).
2. **DPDP data-principal access/erasure** endpoints and a **retention schedule** (§6).
3. Verify **no PII/secrets in logs** (§6).
4. **SCA/dependency scanning** in CI (§8).
5. Ratify **rate-limit thresholds**, **HSTS/TLS**, **at-rest encryption**, **secret management** with ops (DECIDE items).
6. Admin has no self-service password-change UI yet (endpoint exists) — minor.

## 12. Deliverables from the pen-test
- Findings with CVSS + reproduction + evidence, ranked by exploitability against **this** app (weight
  auth bypass, tenant isolation/IDOR, and business-logic abuse highest).
- Retest of fixes.
- An attestation letter for enterprise-agency due diligence.
