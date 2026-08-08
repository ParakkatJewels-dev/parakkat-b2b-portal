# Project Scope Document

## B2B Resort Booking Portal — Enterprise onboarding & compliance extension

**Version:** 2.0 · **Date:** 9 July 2026 · **Status:** Draft for review

> This revision extends v1.0 with a self-service agency onboarding module, Digio-based KYB/eKYC verification, agency lifecycle management, an agreement/eSign workflow, and an expanded security & compliance framework. The existing architecture, booking flow, pricing model, and integrations are preserved without change.

---

## 1. Project overview

The B2B Resort Booking Portal is a centralized, secure reservation platform through which registered travel agencies and their agents book rooms across the company's resorts at agency-specific prices. The platform serves business partners exclusively; end customers never access it.

The portal is a new B2B layer that sits between two systems the company already operates: the existing reservation system (PMS), integrated via AxisRooms, which remains the source of truth for resorts, room types, availability, and inventory; and the CRS, which remains the source of truth for payments and the financial ledger. The portal owns the agency relationship — agency and agent accounts, per-agency pricing, credit control, bookings, and agency accounts receivable.

**New in v2.0.** Agencies are onboarded through a self-service registration and verification workflow rather than manual admin creation. Identity and business verification are performed through Digio (KYB/eKYC), and every agency progresses through a governed lifecycle culminating in a signed agreement before activation. These additions layer onto the existing architecture and do not alter the booking flow, pricing model, or existing integrations.

---

## 2. Objectives

1. Provide agencies a self-service channel to register, complete verification, and — once approved and activated — book rooms at their agency-specific price.
2. Enforce robust KYB/eKYC through Digio (GST, PAN, Aadhaar of the authorized representative, bank verification, and document verification) before any agency becomes operational.
3. Give the company full control over agency commercial terms — pricing markup, payment mode, credit limits, and payment terms — assigned during a controlled commercial-configuration step after approval, with tier-based defaults.
4. Govern each agency through an auditable lifecycle with a mandatory agreement/eSign step prior to activation.
5. Keep room inventory synchronized with the existing reservation system through AxisRooms, with no possibility of booking unverifiable inventory.
6. Feed all financial events into the CRS so the company's ledger remains the single financial record.
7. Meet enterprise security and compliance expectations: MFA, immutable audit logging, secure document storage, webhook validation, and rate limiting.

---

## 3. System context and ownership boundaries

Each data domain has exactly one system of record. No domain is co-owned. Onboarding introduces one new external integration — Digio — without changing existing ones.

| Domain | System of record | Portal's role |
|---|---|---|
| Resorts, room types, availability, inventory | Existing reservation system (via AxisRooms) | Read-only. Fetched live (optional short-TTL cache). No local master tables, no admin CRUD. |
| Reservations (committed bookings) | Existing reservation system | Portal creates bookings and pushes them via AxisRooms on commit; reverses on cancellation. |
| Base room rate | Existing system or portal admin (Decision D1) | Read or manage per D1. |
| Agency price (base + markup) | Portal | Computed and owned by the portal. |
| Agencies, agents, users, roles | Portal | Full ownership. |
| Agency applications, verification, documents | Portal | Full ownership. Verification data sourced from Digio and retained by the portal. |
| Identity & business verification checks | Digio (executed) / Portal (record of result) | Portal initiates checks and stores results and references; Digio performs the checks. |
| Commercial configuration (tier, credit, terms, markup) | Portal | Full ownership; assigned during onboarding, editable by Admin. |
| Bookings (B2B records) | Portal | Full ownership; mirrored to reservation system on commit. |
| Agency accounts receivable | Portal | Full ownership. |
| Payments and financial ledger | CRS | Portal feeds financial events to the CRS (Decision D2). |

---

## 4. In scope

### 4.1 User and access management

- Four roles with strict data separation: Admin, Verifier (an Admin sub-role for onboarding review), Agency, and Agent.
- Role-based access control enforced on every endpoint. An agency can never read another agency's data; an agent can never reach admin or cross-agency finance functions.
- Agency accounts originate from self-service registration (§4.2); agent accounts are created by an active agency.
- Authentication with mandatory MFA for Admin/Verifier and configurable MFA for agencies (§6); account lifecycle (activate / suspend / deactivate) driven by the agency lifecycle (§4.4).

### 4.2 Agency onboarding — self-service registration

Manual agency creation is replaced by a self-service onboarding module. A prospective agency registers, submits business and representative details plus supporting documents, and the application is carried through verification and admin review before activation.

**Registration & application capture**

- Public registration entry point capturing: legal business name, GST number, PAN, registered address, business contact, and the authorized representative's details (name, designation, email, mobile, Aadhaar for eKYC).
- Bank account details for verification (account number, IFSC, account holder name).
- Document upload for required proofs (see §4.3), stored in secure document storage (§6).
- Applications are saved as drafts and can be resumed; a submitted application enters the lifecycle at the Verification state.
- Duplicate detection on GST/PAN to prevent multiple concurrent applications for the same entity.

### 4.3 Identity & business verification — Digio KYB/eKYC

The portal integrates Digio to perform Know-Your-Business and eKYC checks. The portal initiates each check, receives results asynchronously via validated webhooks, stores results and reference IDs against the Verification entity, and advances the lifecycle based on outcomes.

| Check | Purpose |
|---|---|
| GST verification | Validate the GST number and confirm legal name / registration status against the submitted business details. |
| PAN verification | Validate the business/representative PAN and name match. |
| Aadhaar eKYC | eKYC of the authorized representative via Digio (OTP/XML/offline as supported), confirming identity of the signatory. |
| Bank verification | Penny-drop / account-validation to confirm the bank account and holder name. |
| Document verification | Validate uploaded business documents (e.g., incorporation/registration proof, address proof) via Digio document checks. |
| eSign (optional at this stage) | Digio Aadhaar eSign capability, used in the agreement workflow (§4.6) prior to activation. |

- Each check has an independent status (pending, in-progress, passed, failed, manual-review) with the Digio reference ID and raw response retained for audit.
- All verification events — initiation, webhook receipt, result, and any manual override — are written to the verification audit log (§4.5, §5).
- Webhook callbacks from Digio are signature-validated and idempotent (§6). Results never mutate state without passing validation.
- A configurable rule determines auto-progression (e.g., all mandatory checks passed → Review) versus routing to manual review on any failure.

### 4.4 Agency lifecycle

Every agency progresses through a governed state machine. Transitions are permission-controlled, audit-logged, and drive notifications (§4.14).

```
Draft → Verification → Review → Approved → Commercial Configuration → Active
                          └→ Rejected                    Active ↔ Suspended
```

| State | Entered when | What it means |
|---|---|---|
| Draft | Applicant saves registration before submitting. | Editable application; not yet in review. |
| Verification | Application submitted. | Digio KYB/eKYC checks run; results collected via webhooks. |
| Review | Verification checks complete (or flagged). | Application appears in the Admin Verification Dashboard for human decision. |
| Approved | Verifier approves the application. | Eligible for commercial configuration; no bookings yet. |
| Commercial Configuration | Admin assigns tier, credit limit, terms, markup. | Commercial terms recorded; agreement generated for eSign (§4.6). |
| Active | Agreement signed via eSign. | Agency and its agents can transact; commercial terms enforced. |
| Rejected | Verifier rejects (from Review). | Terminal for this application; reason recorded; re-application permitted per policy. |
| Suspended | Admin suspends an active agency. | Bookings blocked; reversible back to Active. Existing balances remain due. |

### 4.5 Admin verification dashboard

A dedicated Admin/Verifier workspace to process the onboarding pipeline end to end.

- Queue of applications filterable by lifecycle state, with SLA/aging indicators.
- Application detail view: submitted business and representative data, uploaded documents, and each Digio check with status, reference ID, and result.
- Decision actions: approve or reject, with a mandatory reason on rejection; request re-submission of specific documents/checks.
- On approval, proceed to commercial configuration: assign tier (which populates default credit limit, payment terms, and markup %), with per-agency overrides (§4.7).
- Trigger the agreement/eSign workflow (§4.6) and monitor signature status.
- Activate the agency on completed eSign; suspend or reactivate active agencies.
- Every action is written to the verification audit log with actor, timestamp, and before/after values.

### 4.6 Agreement & eSign workflow

An executed agreement is mandatory before activation. This step sits between commercial configuration and Active.

- On completion of commercial configuration, the portal generates the partnership agreement, embedding the agreed commercial terms (tier, credit limit, payment terms, markup) and standard clauses.
- The agreement is sent to the authorized representative for Digio Aadhaar eSign.
- Signature status is tracked (sent, viewed, signed, declined, expired); reminders are issued per policy.
- On successful eSign, the signed document is stored in secure document storage and the agency transitions to Active.
- A declined or expired agreement holds the agency at Commercial Configuration and notifies Admin; no activation occurs without a signed agreement.
- All agreement events are audit-logged.

### 4.7 Commercial configuration

The commercial terms assigned during onboarding (and editable thereafter by Admin) are unchanged from v1.0 in meaning; onboarding formalizes when and how they are set. Each agency carries four tier-defaulted, individually overridable values:

- **Payment mode** — prepay or credit. A prepay agency has an effective credit limit of ₹0.
- **Credit limit (₹)** — required for credit agencies.
- **Payment terms** — e.g., net 15 / net 30, for credit agencies.
- **Agency markup %** — applied on the base rate to produce that agency's displayed and payable price.

Tiers act as presets that populate these four values; the system always reads the resolved per-agency values, never the tier directly. The pricing model and credit gate that consume these values are unchanged (§4.10–§4.12).

### 4.8 Agency capabilities

- Complete and track its onboarding application; view verification and agreement status.
- Dashboard (post-activation).
- Manage its own agents (create, suspend, deactivate).
- View bookings created by its agents; monitor outstanding balance and credit usage.
- View invoices, payment history, and receipts; settle invoices (per Decision D2).
- Reports scoped to its own business; agency profile management.

### 4.9 Agent capabilities

- Dashboard; resort search by dates, occupancy, and resort.
- Real-time availability (from AxisRooms) with the agency price displayed.
- Booking creation and modification (subject to business rules); booking history and customer booking information.

### 4.10 Pricing model (unchanged)

Three price levels; the portal computes and records the middle one and never the customer price.

1. **Base rate** — e.g., ₹4,500. Source per Decision D1.
2. **Agency price** = `base rate × (1 + agency markup %)` — e.g., 10% → ₹4,950. This is what the agency sees, books at, and owes; every financial function operates on it.
3. **Customer price** — whatever the agent charges their own customer (e.g., ₹5,200). Out of scope: never stored, tracked, or reported.

- Agency price is computed server-side from the base rate and the booking agency's resolved markup; client-supplied prices are never trusted.
- Each booking stores both the base rate and the resolved agency price so invoices and refunds remain reproducible if the markup later changes.

### 4.11 Booking lifecycle and the unified credit gate (unchanged)

**Rule.** A booking confirms on credit if `(agency outstanding balance + this booking's agency price) ≤ agency effective credit limit`; otherwise payment must be collected before confirmation.

```
draft → (credit gate)
        ├─ within limit        → confirmed_on_credit → committed
        └─ over limit / prepay → awaiting_payment → paid → confirmed → committed
```

- Prepay agencies (effective limit ₹0) always take the pay-first branch — no special-casing.
- A credit agency over its limit takes the pay-first branch for that booking (Decision D3).
- Tentative hold on `awaiting_payment` with configurable TTL (default 15 min); commit to AxisRooms only after payment clears; expired holds are released.
- Both branches converge on `confirmed` + `committed`, at which point the reservation is pushed to the reservation system via AxisRooms. All transitions are audit-logged.

### 4.12 Finance and accounts receivable (unchanged)

- Outstanding balance tracking per agency; credit limit monitoring feeding the gate.
- Invoice and receipt generation; payment collection per Decision D2.
- Every financial event posted to the CRS as the ledger of record; financial reporting for Admin (company-wide) and Agency (own).

### 4.13 Refunds and cancellations (unchanged)

- The agent refunds the customer outside the system; the company refunds the agency the agency price stored on the booking, never the customer-facing amount.
- A cancellation policy on the agency price applies (bands per Decision D4).
- On cancellation: reverse the reservation in AxisRooms, adjust the balance or issue a refund, and post the event to the CRS.

### 4.14 Notification workflows

Event-driven, templated notifications are issued across onboarding and operations, via email with optional SMS for time-sensitive steps. Notifications are triggered by lifecycle and verification events and are themselves audit-logged.

| Notification | Trigger | Content |
|---|---|---|
| Registration received | Applicant submits application | Confirmation with application reference and next steps. |
| Verification in progress / result | Digio checks initiated / returned | Status update; request for re-submission if a check fails. |
| Approved | Verifier approves | Notice of approval; agreement to follow. |
| Rejected | Verifier rejects | Notice with reason and re-application guidance. |
| Agreement / eSign request | Commercial configuration done | eSign link to the authorized representative; reminders on pending. |
| Activation | eSign completed | Welcome / activation notice; credentials and getting-started guidance. |
| Suspension / reactivation | Admin action | Notice of status change and impact on transacting. |

### 4.15 Integrations

**AxisRooms (existing — unchanged)**

- Read: resorts, room types, real-time availability, inventory. AxisRooms is the master; any cache is short-TTL and refresh-before-book.
- Write: push reservations on commit; reverse on cancellation.
- Downtime handling — block, don't queue: health is checked before an agent can confirm; if down, booking is blocked with a maintenance state; bookings are never queued (overbooking risk).

**CRS (existing — unchanged)**

- Receives all financial events from the portal (pattern per Decision D2); markup may be posted separately from base for margin reporting (Decision D5).

**Digio (new — onboarding)**

- KYB/eKYC checks (GST, PAN, Aadhaar eKYC, bank verification, document verification) and Aadhaar eSign for the agreement.
- Asynchronous results via signature-validated, idempotent webhooks; reference IDs and responses retained against the Verification entity.

**Cross-cutting integration mechanics (unchanged)**

- Shared correlation ID on every booking, carried into the reservation system and CRS.
- Idempotent writes to external systems keyed off the correlation ID; outbox + retry delivery; periodic reconciliation job flagging drift to Admin.

### 4.16 Non-functional requirements

- RBAC on every endpoint; strict tenant isolation between agencies.
- The customer-facing price / agent's customer-side markup is never persisted or exposed. (The company→agency markup is recorded; only the agency→customer markup is out of scope.)
- Graceful, clearly communicated failure states for AxisRooms, Digio, and payment outages.
- Configurable (not hardcoded): hold TTL, tier presets, markup defaults, cancellation policy, verification auto-progression rules.
- Scalable to a growing agency network and onboarding pipeline.

---

## 5. Onboarding & verification data entities

New portal-owned entities supporting onboarding, verification, and governance. Field lists are indicative and implementation-ready, not exhaustive.

### AgencyApplication

Captures a self-service registration through to decision.

| Key field | Type | Description |
|---|---|---|
| id | UUID | Primary key / correlation reference for the application. |
| legal_name, gstin, pan | string | Submitted business identifiers. |
| rep_name, rep_designation, rep_email, rep_mobile | string | Authorized representative details. |
| rep_aadhaar_ref | string | Reference/token for Aadhaar eKYC (not the raw Aadhaar; see §6). |
| bank_account, ifsc, account_holder | string | Bank details for verification. |
| lifecycle_state | enum | Draft, Verification, Review, Approved, Commercial Configuration, Active, Rejected, Suspended. |
| submitted_at, decided_at | timestamp | Submission and decision timestamps. |
| decision, decision_reason, decided_by | string / FK | Approve/reject outcome, mandatory reason on reject, and actor. |
| agency_id | FK (nullable) | Links to the created Agency once approved/active. |

### Verification

One record per check performed via Digio, linked to an application.

| Key field | Type | Description |
|---|---|---|
| id | UUID | Primary key. |
| application_id | FK | Owning AgencyApplication. |
| check_type | enum | gst, pan, aadhaar_ekyc, bank, document, esign. |
| status | enum | pending, in_progress, passed, failed, manual_review. |
| provider_ref | string | Digio reference ID for the check. |
| request_payload, response_payload | json | Stored request/result for audit (sensitive fields protected per §6). |
| initiated_at, completed_at | timestamp | Timing of the check. |

### Document

Uploaded proofs and generated/signed artifacts.

| Key field | Type | Description |
|---|---|---|
| id | UUID | Primary key. |
| application_id / agency_id | FK | Owning application or agency. |
| doc_type | enum | registration_proof, address_proof, agreement, signed_agreement, other. |
| storage_key | string | Reference into secure document storage (not a public URL). |
| checksum | string | Integrity hash. |
| status | enum | uploaded, verified, rejected, signed. |
| uploaded_by, uploaded_at | FK / timestamp | Provenance. |

### CommercialConfiguration

Resolved commercial terms assigned at onboarding, editable by Admin.

| Key field | Type | Description |
|---|---|---|
| id | UUID | Primary key. |
| agency_id | FK | Owning agency. |
| tier | enum | Source tier used as preset. |
| payment_mode | enum | prepay / credit. |
| credit_limit | decimal | Effective credit limit (₹0 for prepay). |
| payment_terms | string | e.g., net 15 / net 30. |
| markup_pct | decimal | Agency markup percentage. |
| effective_from, updated_by | timestamp / FK | Versioning and actor for changes. |

### AuditLog

Append-only record of onboarding and verification events (see §6 for integrity).

| Key field | Type | Description |
|---|---|---|
| id | UUID | Primary key. |
| entity_type, entity_id | string / UUID | Target of the event (application, verification, agency, document). |
| event | string | e.g., application_submitted, check_result, approved, rejected, agreement_sent, esigned, activated, suspended. |
| actor_id, actor_role | FK / enum | Who performed the action (or "system"/"Digio" for automated events). |
| before, after | json | State snapshot for change traceability. |
| correlation_id, created_at | string / timestamp | Cross-system correlation and immutable timestamp. |

---

## 6. Security & compliance

The onboarding module handles sensitive identity and financial data, so security and compliance are treated as first-class scope.

### Authentication & MFA

- MFA mandatory for all Admin/Verifier accounts; configurable (recommended enforced) for agency users.
- Session management with idle and absolute timeouts; secure, httpOnly, same-site cookies or short-lived tokens.
- RBAC enforced server-side on every endpoint, including all onboarding and verification actions.

### Audit logging

- Append-only, tamper-evident audit logs for all onboarding, verification, commercial-configuration, agreement, and lifecycle events.
- Each entry records actor, role, timestamp, before/after state, and correlation ID; system- and Digio-originated events are attributed accordingly.
- Logs are retained per policy and are queryable from the Admin Verification Dashboard.

### Secure document & PII storage

- Documents and verification artifacts stored encrypted at rest; access via short-lived signed references, never public URLs.
- Sensitive identifiers (Aadhaar, PAN, bank details) minimized, masked in the UI, and protected in line with the DPDP Act and Digio guidelines; raw Aadhaar is not persisted where a reference/token suffices.
- Encryption in transit (TLS) for all traffic; secrets and API keys held in a managed secret store, never in source or config.
- Defined retention and deletion policy for application data and documents.

### Webhook validation

- All inbound webhooks (Digio verification/eSign, payment gateway) are signature-verified against the provider secret before processing.
- Webhook handling is idempotent (keyed off provider reference / correlation ID) so retried callbacks never double-apply.
- Unverified or malformed callbacks are rejected and logged; no state changes on failed validation.

### Rate limiting & abuse protection

- Rate limiting per endpoint, per IP, and per account, with stricter limits on public onboarding endpoints.
- Protections against automated abuse of registration and verification (throttling, duplicate GST/PAN detection, optional CAPTCHA on public entry points).
- Alerting on anomalous onboarding activity.

---

## 7. Out of scope

- End-customer access of any kind — the portal is B2B only.
- Customer-facing price and agent markup — never captured, stored, or reported.
- Resort / room / inventory management — owned by the existing reservation system.
- Replacing the CRS — the portal feeds the CRS; it is not a second financial ledger.
- Channel management / OTA distribution — the portal is one consumer of AxisRooms.
- Agent-to-customer payment collection — outside the system.
- Queued/offline booking during AxisRooms downtime — explicitly excluded.
- Manual agency creation as the primary path — replaced by self-service onboarding (an admin-initiated application may remain as an exception path if required, per Decision D7).
- Provision of KYC/verification infrastructure — delegated to Digio; the portal orchestrates and records outcomes only.
- Fixed-amount or per-resort markup, loyalty/promotions, multi-currency — future extensions.

---

## 8. Open decisions

| # | Decision | Options | Assumption |
|---|---|---|---|
| D1 | Base-rate source | (a) from AxisRooms; (b) Admin sets in portal | (b) — per brief |
| D2 | Payment collection pattern | (a) portal gateway posts to CRS; (b) CRS collects, portal reads status | (a) |
| D3 | Credit-limit-reached behavior | (a) flip to prepay; (b) hard stop + override | (a) |
| D4 | Cancellation policy bands | To be defined by business | TBD |
| D5 | CRS posting granularity | Agency price as one figure vs. base + markup split | Split (margin reporting) |
| D6 | AxisRooms write capability | Confirm reservation push is supported, not read-only | Verify before build |
| D7 | Admin-initiated onboarding | Whether an admin-created application exception path is required | Optional |
| D8 | Verification auto-progression | Fully automatic on all-pass vs. always manual Review | Auto to Review, manual decision |
| D9 | Re-application policy | Cooldown / conditions for re-applying after rejection | TBD by business |

---

## 9. Assumptions

1. Digio provides API access for GST, PAN, Aadhaar eKYC, bank verification, document verification, and eSign at the required volume, with webhook callbacks.
2. AxisRooms provides API access with sufficient rate limits for real-time availability; CRS exposes an interface to receive financial events or report payment status (per D2).
3. Single currency (₹) and a single tax regime in this phase.
4. Agencies self-onboard; Admin/Verifier reviews and approves. One markup % per agency applies uniformly across resorts and room types.
5. Email/SMS infrastructure is available for onboarding and operational notifications.
6. Handling of Aadhaar and other PII complies with the DPDP Act and Digio's data-handling requirements.

---

## 10. Deliverables

1. Web application (Admin/Verifier, Agency, Agent) with the full feature set in §4, including the self-service onboarding module and Admin Verification Dashboard.
2. Digio integration layer: KYB/eKYC checks, eSign, validated idempotent webhooks, and verification record-keeping.
3. AxisRooms integration layer (read + write + health check + downtime blocking) — unchanged.
4. CRS integration layer (event postings or status reads per D2) with outbox, idempotency, and correlation IDs — unchanged.
5. Payment gateway integration (if D2-a).
6. Agency lifecycle engine, agreement/eSign workflow, and notification service.
7. Data model for onboarding entities (§5); reconciliation job and admin drift report.
8. Security & compliance controls (§6): MFA, audit logging, secure document storage, webhook validation, rate limiting.
9. Technical documentation: data model, API contracts (AxisRooms, CRS, Digio), lifecycle and state-machine definitions, and deployment/runbook notes.

---

## 11. Success criteria

1. A prospective agency can self-register, complete Digio verification, be reviewed and approved, receive commercial terms, sign the agreement via eSign, and reach Active without manual account creation.
2. No agency can transact before reaching Active; every lifecycle transition is permission-controlled and audit-logged.
3. All Digio results arrive via validated, idempotent webhooks and are fully recorded with reference IDs.
4. An agent can search, see their agency's price, and complete a booking end-to-end; the reservation appears in the existing reservation system.
5. The credit gate behaves correctly for prepay, within-limit, and over-limit cases; no booking is created while AxisRooms is down.
6. Every confirmed booking, payment, and refund is traceable across portal ↔ reservation system ↔ CRS by correlation ID with zero unexplained drift.
7. No customer-facing price exists anywhere in the database, logs, or reports; sensitive PII is stored and masked per §6.