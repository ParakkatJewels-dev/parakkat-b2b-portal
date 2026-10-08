# Build Prompt — B2B Resort Booking Portal (v2.0)


## 1. Role & goal

You are building a **B2B Resort Booking Portal** — a secure, multi-tenant web application where travel agencies self-onboard, pass identity/business verification, and (once approved and activated) let their agents book resort rooms at agency-specific net prices. It is for business partners only; **end customers never access it**, and the **customer-facing price is never stored anywhere**.

The portal is a new B2B layer over two existing company systems and one new verification provider:

- **Existing reservation system (PMS)** — source of truth for resorts, rooms, availability, inventory. Reached via **AxisRooms**.
- **CRS** — source of truth for payments and the financial ledger.
- **Digio** — new integration for KYB/eKYC (GST, PAN, Aadhaar eKYC, bank, document) and Aadhaar eSign.

The portal itself owns: agencies, agents, users, onboarding applications, verification records, documents, commercial configuration, bookings, and agency accounts receivable.

## Technology Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + React Router + TanStack Query + Zustand
- **Backend:** Node.js + Express.js + TypeScript
- **Database:** PostgreSQL (Supabase)
- **ORM:** Prisma ORM
- **Authentication:** JWT + Refresh Tokens + RBAC + MFA (TOTP/Email OTP)
- **Authorization:** Role-Based Access Control (Super Admin, Receptionist, Agency, Agent)
- **Payments:** Airpay
- **Queue / Worker:** BullMQ + Redis
- **Cache:** Redis
- **File Storage:** AWS S3 (or Supabase Storage if self-contained) with encryption at rest
- **Verification Provider:** Digio (GST, PAN, Aadhaar, Bank Verification, eSign)
- **Real-time:** Supabase Broadcast (serverless-safe cache invalidation)
- **Email:** Resend
- **SMS/OTP:** MSG91
- **Logging:** Winston + Morgan
- **API Documentation:** Swagger (OpenAPI)
- **Validation:** Zod
- **Testing:** Vitest + Supertest
- **CI/CD:** GitHub Actions
- **Containerization:** Docker + Docker Compose
- **Monitoring:** Sentry + Prometheus + Grafana
- **Deployment:** One Vercel project (React CDN assets + Express Function) with Supabase data services

---

## 2. Decisions to confirm before building

Set these; they change how code is written. Defaults shown are the working assumptions from the scope.

| # | Decision | Default assumption |
|---|---|---|
| D1 | Base rate source: AxisRooms vs. Admin-set in portal | Admin-set in portal |
| D2 | Payment collection: portal gateway posts to CRS **(a)**, vs. CRS collects and portal reads status **(b)** | (a) portal collects, posts events to CRS |
| D3 | Credit-limit-reached: flip that booking to prepay, vs. hard stop + admin override | Flip to prepay |
| D6 | **AxisRooms supports reservation *write* (push), not just availability reads** | **Must verify before build — reshapes the commit step if read-only** |
| D8 | Verification auto-progression: auto to Review on all-pass vs. always manual | Auto to Review; human makes the decision |

---

## 3. Data ownership (do not violate)

One system of record per domain. Never build local master tables for another system's data.

- **Read-only from AxisRooms** (no local CRUD, short-TTL cache only): resorts, room types, availability, inventory.
- **Written to AxisRooms on commit / reversed on cancel**: reservations.
- **Portal-owned**: agencies, agents, users/roles, applications, verification records, documents, commercial configuration, bookings, agency AR (balances, invoices), audit logs.
- **CRS-owned**: payments and the financial ledger. The portal posts financial events to the CRS; it is never a second ledger.
- **Digio-executed / portal-recorded**: KYB/eKYC checks and eSign. Portal initiates, stores results + reference IDs, never re-implements verification.

---

## 4. Roles & RBAC

Four roles, strict server-side enforcement on **every** endpoint:

- **Admin** — full control; manages verification pipeline, commercial config, bookings, finance, settings.
- **Verifier** — Admin sub-role scoped to the onboarding/verification dashboard (review, approve, reject, request re-submission).
- **Agency** — post-activation tenant; manages its own agents and sees only its own data.
- **Agent** — created by an active agency; search + book only; no finance/admin access.

Tenant isolation is mandatory: an agency can never read another agency's data; an agent can never reach admin/verifier/cross-agency functions.

---

## 5. Self-service onboarding

Replace manual agency creation with a public self-service flow.

- Public registration capturing: legal business name, GSTIN, PAN, registered address, business contact, authorized representative (name, designation, email, mobile, Aadhaar reference for eKYC), and bank details (account, IFSC, holder name).
- Document upload for required proofs → secure storage (§11).
- Applications save as **Draft** (resumable); submission moves them to **Verification**.
- **Duplicate detection** on GSTIN/PAN to block concurrent applications for the same entity.
- Public onboarding endpoints get stricter rate limits + optional CAPTCHA (§11).

---

## 6. Digio KYB/eKYC integration

Portal initiates checks, receives async results via **signature-validated, idempotent webhooks**, stores results + reference IDs on the `Verification` entity, and advances the lifecycle.

Checks: **GST**, **PAN**, **Aadhaar eKYC** (authorized representative), **bank** (penny-drop/validation), **document verification**, and **Aadhaar eSign** (used later in §8).

- Each check is a `Verification` row with independent status: `pending | in_progress | passed | failed | manual_review`, plus `provider_ref` and stored request/response (sensitive fields protected per §11).
- Webhook handler: verify Digio signature → check idempotency key (provider ref) → apply result → audit-log. Reject unverified/malformed callbacks with no state change.
- Auto-progression rule (D8): all mandatory checks passed → move application to **Review**; any failure → **manual_review** flag surfaced to the Verifier.
- Every verification event (initiate, webhook receipt, result, manual override) is written to the audit log.

---

## 7. Agency lifecycle (state machine)

Build this as an explicit, permission-controlled, audit-logged state machine. Transitions drive notifications (§10).

```
Draft → Verification → Review → Approved → Commercial Configuration → Active
                          └→ Rejected                    Active ↔ Suspended
```

| State | Enter when | Effect |
|---|---|---|
| Draft | Applicant saves before submit | Editable; not in review |
| Verification | Application submitted | Digio checks run |
| Review | Checks complete/flagged | Appears in Verifier dashboard |
| Approved | Verifier approves | Eligible for commercial config; no bookings |
| Commercial Configuration | Admin sets terms | Terms recorded; agreement generated |
| Active | Agreement eSigned | Agency + agents can transact |
| Rejected | Verifier rejects (from Review) | Terminal; reason recorded; re-apply per policy |
| Suspended | Admin suspends active agency | Bookings blocked; reversible; balances still due |

No agency can transact before **Active**.

---

## 8. Admin verification dashboard + agreement/eSign

Dashboard (Admin/Verifier):
- Queue filterable by lifecycle state, with SLA/aging.
- Detail view: submitted data, uploaded documents, and each Digio check (status, ref ID, result).
- Actions: approve / reject (mandatory reason on reject) / request re-submission of specific checks or documents.
- On approval → **commercial configuration**: assign tier (populates default credit limit, payment terms, markup %), with per-agency overrides (§9).
- Trigger agreement/eSign; monitor signature status; activate on completion; suspend/reactivate.
- Every action audit-logged with actor, timestamp, before/after.

Agreement/eSign (mandatory before Active):
- After commercial config, generate the partnership agreement embedding the agreed terms + standard clauses.
- Send to the authorized representative for **Digio Aadhaar eSign**; track status (sent, viewed, signed, declined, expired) with reminders.
- On signed → store the signed document in secure storage → transition to **Active**.
- Declined/expired → hold at Commercial Configuration, notify Admin. No activation without a signed agreement.

---

## 9. Commercial configuration & pricing

Each agency carries four tier-defaulted, overridable values (set at commercial-config, editable by Admin):
1. **Payment mode** — `prepay` | `credit` (prepay ⇒ effective credit limit ₹0)
2. **Credit limit (₹)** — required for credit
3. **Payment terms** — e.g., net 15 / net 30
4. **Agency markup %**

Tiers are presets that populate these; the system always reads the resolved per-agency values, never the tier directly.

**Pricing — three levels, record only the middle one:**
1. **Base rate** (e.g., ₹4,500) — source per D1.
2. **Agency price** = `base × (1 + markup%)` (e.g., ₹4,950) — displayed, booked, and owed; **all finance runs on this**.
3. **Customer price** — the agent's own price; **out of scope, never stored**.

Integrity rules (enforce):
- Compute agency price **server-side**; never trust a client-supplied price.
- Store **both** base rate and resolved agency price on each booking so invoices/refunds are reproducible if markup changes later.
- The company→agency markup **is** recorded; only the agency→customer markup is out of scope.

---

## 10. Booking, credit gate, integrations (unchanged core)

**Booking lifecycle + unified credit gate** — one gate, not two flows:

> Confirm on credit if `(agency outstanding balance + booking agency price) ≤ agency effective credit limit`; else collect payment first.

```
draft → (credit gate)
        ├─ within limit        → confirmed_on_credit → committed
        └─ over limit / prepay → awaiting_payment → paid → confirmed → committed
```

- Prepay (limit ₹0) always takes the pay-first branch — no special-casing.
- Over-limit credit agency → pay-first for that booking (D3).
- **Tentative hold** on `awaiting_payment`: hold in the portal (not AxisRooms), configurable TTL (default 15 min); commit to AxisRooms **only after payment clears**; on TTL expiry release the hold and return to draft/cancelled.
- Both branches converge on `confirmed + committed` → push reservation to AxisRooms. Audit-log all transitions.

**AxisRooms:** read availability/inventory (master; short-TTL cache, refresh-before-book); write reservation on commit, reverse on cancel. **Downtime = block, don't queue**: health-check before confirm; if down, disable booking with a maintenance state; never queue (overbooking risk).

**CRS:** post every financial event (booking obligation, payment, refund, cancellation charge) as the ledger of record; collection pattern per D2; post base + markup separately if margin reporting is wanted.

**Cross-cutting:** shared **correlation ID** on every booking carried into AxisRooms and CRS; **idempotent** external writes keyed off it; **outbox + retry** worker for reservation push and CRS postings; periodic **reconciliation job** flagging drift to Admin.

**Refunds/cancellations:** agent refunds customer (outside system); company refunds the **agency price stored on the booking**; cancellation policy applies bands (D4); reverse AxisRooms + adjust balance + post to CRS.

---

## 11. Security & compliance (first-class scope)

- **MFA** mandatory for Admin/Verifier; configurable (recommend enforced) for agencies. Session idle + absolute timeouts; secure httpOnly same-site cookies or short-lived tokens.
- **Audit logs**: append-only, tamper-evident, for all onboarding/verification/commercial/agreement/lifecycle events — actor, role, timestamp, before/after, correlation ID; system/Digio events attributed. Queryable from the dashboard.
- **Secure document & PII storage**: encrypt at rest; access via short-lived signed references, never public URLs; minimize and mask Aadhaar/PAN/bank data; don't persist raw Aadhaar where a token suffices; TLS in transit; secrets in a managed store; defined retention/deletion. Comply with the **DPDP Act** and Digio guidelines.
- **Webhook validation**: signature-verify all inbound webhooks (Digio, payment) before processing; idempotent handling keyed off provider ref/correlation ID; reject + log unverified callbacks with no state change.
- **Rate limiting**: per endpoint, per IP, per account; stricter on public onboarding endpoints; abuse protection (throttle, duplicate GST/PAN detection, optional CAPTCHA); alert on anomalous onboarding activity.

---

## 12. Data model (portal-owned; indicative fields)

Build these plus core agency/agent/booking/invoice/payment tables. **No** local master tables for resorts/rooms/inventory (read from AxisRooms).

- **AgencyApplication**: id (UUID, correlation), legal_name, gstin, pan, rep_{name,designation,email,mobile}, rep_aadhaar_ref (token, not raw), bank_{account,ifsc,holder}, lifecycle_state (enum), submitted_at, decided_at, decision, decision_reason, decided_by, agency_id (FK nullable).
- **Verification**: id, application_id (FK), check_type (gst|pan|aadhaar_ekyc|bank|document|esign), status (pending|in_progress|passed|failed|manual_review), provider_ref, request_payload/response_payload (json, sensitive protected), initiated_at, completed_at.
- **Document**: id, application_id/agency_id (FK), doc_type (registration_proof|address_proof|agreement|signed_agreement|other), storage_key (not a public URL), checksum, status (uploaded|verified|rejected|signed), uploaded_by, uploaded_at.
- **CommercialConfiguration**: id, agency_id (FK), tier, payment_mode, credit_limit, payment_terms, markup_pct, effective_from, updated_by (versioned).
- **AuditLog**: id, entity_type, entity_id, event, actor_id, actor_role, before/after (json), correlation_id, created_at (immutable).
- **Booking** (core): stores base_rate + resolved agency_price, state, correlation_id, hold_expires_at, axisrooms_ref, agency_id, agent_id.

---

## 13. Suggested build order (phased)

**Phase 1 — Foundation:** auth + RBAC (4 roles) + MFA; portal-owned data model (§12) minus bookings; audit-log infrastructure; secure file storage + secrets.

**Phase 2 — Onboarding:** self-service registration + draft/resume + duplicate detection; document upload; AgencyApplication + lifecycle state machine (Draft→Verification).

**Phase 3 — Verification:** Digio integration (GST, PAN, Aadhaar eKYC, bank, document); signature-validated idempotent webhook handler; verification records + audit logging; auto-progression (D8) to Review.

**Phase 4 — Review & activation:** Admin verification dashboard (queue, detail, approve/reject/re-submit); commercial configuration (tier presets + overrides); agreement generation + Digio eSign; activation to Active; suspend/reactivate.

**Phase 5 — Notifications:** event-driven templated notifications (registration, verification, approval, rejection, agreement/eSign, activation, suspension) via email + optional SMS; audit-logged.

**Phase 6 — Booking core:** AxisRooms read layer (availability, short-TTL cache) + agency-price computation; booking creation (draft); **the unified credit gate + tentative hold/TTL**; AxisRooms write on commit + downtime blocking.

**Phase 7 — Finance:** payment gateway (D2-a) + invoices + outstanding balance + settlement; refund/cancellation with net-only policy; CRS event postings with outbox/idempotency/correlation IDs; reconciliation job + drift report.

**Phase 8 — Hardening:** rate limiting + abuse protection; audit-log review UI; reporting/dashboards; runbook + API-contract docs (AxisRooms, CRS, Digio).

Keep the **credit gate** and the **lifecycle state machine** each as a single, well-tested module — everything routes through them.

---

## 14. Definition of done

- An agency self-registers → completes Digio verification → is reviewed/approved → gets commercial terms → eSigns → reaches Active, with no manual account creation.
- No agency transacts before Active; every transition is permission-controlled and audit-logged.
- All Digio results arrive via validated, idempotent webhooks and are fully recorded with reference IDs.
- An agent searches, sees the agency price, books end-to-end, and the reservation appears in the reservation system.
- Credit gate correct for prepay / within-limit / over-limit; no booking while AxisRooms is down.
- Every booking, payment, refund traceable across portal ↔ reservation system ↔ CRS by correlation ID; reconciliation shows zero unexplained drift.
- No customer-facing price anywhere; PII stored and masked per §11.
