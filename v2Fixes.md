# B2B Resort Booking Portal — Project Scope Document

**Parakkat Nature Resorts**

**Version:** 3.0  **Date:** 9 July 2026  **Status:** Draft for review

Gap-closure revision — revenue, finance, compliance, operations & delivery

> This revision supersedes Scope v2.0. It retains v2.0 in full — the self-service onboarding module, Digio KYB/eKYC verification, agency lifecycle, agreement/eSign workflow, and the expanded security framework are all carried forward unchanged — and closes the outstanding items raised in Annexure A (Gap Analysis) that v2.0 left open, principally the revenue-critical pricing and booking gaps, the financial and GST-compliance gaps, and the project-delivery gaps. Each item from Annexure A is traced to its resolution in Section 1.

---

## Contents

1. Gap-closure traceability (Annexure A)
2. Pricing model — rate plans & occupancy (replaces v2.0 §4.10)
3. B2B channel inventory control
4. Group & multi-room bookings
5. Booking, hold & commit integrity
6. Finance, invoicing & GST compliance
7. Cancellations, no-shows & resort-initiated changes
8. Guest data specification & DPDP compliance
9. Notification matrix
10. Non-functional requirements — quantified
11. Delivery plan
12. UAT, training & post-launch support
13. Retained from v2.0 (unchanged)
14. Open decisions — updated register & required actions
15. Success criteria — additions

---

## 1. Gap-closure traceability (Annexure A)

Every gap and open decision from Annexure A is listed below with its disposition in this version. "Resolved" means scoped in a section of this document; "In v2.0" means already addressed by the previous revision; "Business decision" and "Blocking verification" require an owner action outside the document and are called out in Section 14.

| # | Gap (Annexure A) | Priority | Disposition in v3.0 |
|---|---|---|---|
| 1 | Meal plans & occupancy-based pricing | Critical | Resolved — §2 (rate-plan & occupancy pricing model). |
| 2 | Group / multi-room bookings | Critical | Resolved — §4 (multi-room, room blocks, partial cancellation). |
| 3 | B2B channel inventory control | High | Resolved — §3 (stop-sell, blackout, allocation caps, allotments). |
| 4 | Rate calendar (if D1 = portal-managed) | Critical | Resolved — §2.4, conditional on D1 (see §14, D1 closed to option b). |
| 5 | GST compliance (India) | Critical | Resolved — §6 (GST tax-invoice spec, slabs, place of supply, e-invoice/IRN). |
| 6 | Overdue / dunning workflow | High | Resolved — §6.3 (reminder cadence, auto-suspension, late fees, override). |
| 7 | Payment & post-payment commit failure | Critical | Resolved — §5 (commit-failure flow, rebook queue, refunds, chargebacks). |
| 8 | Amendments, repricing & credit notes | High | Resolved — §6.4 (repricing rules, GST credit notes, application). |
| 9 | Notification matrix (incl. WhatsApp) | High | Resolved — §9 (full event→recipient→channel matrix, WhatsApp first-class). |
| 10 | Hold-window race condition | High | Resolved — §5.1 (re-validate-at-commit; paired with §5.2 failure flow). |
| 11 | No-shows & resort-initiated changes | High | Resolved — §7 (no-show charging; resort-initiated relocation/compensation). |
| 12 | Guest data specification & DPDP | High | Resolved — §8 (guest-data spec, PMS push, retention, DPDP obligations). |
| 13 | Agency onboarding documentation | Medium | In v2.0 §4.2–§4.3; §8.4 adds explicit cancellation-policy acceptance artifact. |
| 14 | Delivery plan | Critical | Resolved — §11 (phasing, milestones, stack, hosting, commercials placeholder). |
| 15 | UAT, training & post-launch support | High | Resolved — §12 (UAT & sign-off, training, warranty, support SLA). |
| 16 | Performance NFRs (quantified) | High | Resolved — §10 (uptime, response, concurrency, volume — quantified). |
| 17 | Security hardening | High | v2.0 §6 + §10.2 additions (password policy, agency 2FA, backup/DR, pen-test). |
| 18 | Mobile experience | High | Resolved — §10.1 (responsive mobile web as acceptance criterion). |

**Open decisions:** D1 closed to portal-managed base rate (pending PMS confirmation); D4 cancellation bands proposed for CEO sign-off; **D6 (AxisRooms reservation-write capability) remains the single blocking item and is not resolvable inside this document — see §14.**

---

## 2. Pricing model — rate plans & occupancy (replaces v2.0 §4.10)

The flat "one rate per room type per night" model in v2.0 does not match how resort inventory is sold. The portal computes the agency price from a structured room charge that combines a rate plan and occupancy components. The three-level price principle is unchanged: the portal owns only the agency price; the customer price is never stored.

### 2.1 Rate plans

Each room type is sold under one or more meal-inclusive rate plans. The applicable plans per room type are configurable.

| Code | Name | Inclusions |
|---|---|---|
| EP | European Plan | Room only. No meals included. |
| CP | Continental Plan | Room + breakfast. |
| MAP | Modified American Plan | Room + breakfast + one major meal (lunch or dinner). |
| AP | American Plan | Room + breakfast + lunch + dinner. |

### 2.2 Occupancy-based components

- Base rate is quoted for standard (double) occupancy per room type per rate plan per night.
- **Extra-adult charge** per additional adult beyond base occupancy, up to the room's maximum adult capacity.
- **Child charge** by configurable age band (e.g., 0–5 free, 6–11 charged, 12+ treated as adult). Bands are configurable, not hardcoded.
- **Extra-bed charge** where an additional bed/mattress is added, subject to room maximum occupancy.
- Every room line validates the requested occupancy against the room type's max adults, max children, and max total occupancy before pricing.

### 2.3 Price composition and markup

For each room-night the payable room charge is composed server-side as:

> **room charge = rate-plan rate (for occupancy) + Σ extra-adult + Σ child + extra-bed**

**Markup application (Decision D10 — proposed):** a single agency markup % applies to the full room charge including meal-plan and occupancy components, producing the agency price. Per-component markup (e.g., no markup on meal cost) is a configurable alternative; the default is single-markup-on-total. This must be confirmed at sign-off so estimation is not built on an open item.

- Each booking line persists: room type, rate plan, occupancy breakdown, base components, resolved markup %, and resolved agency price — so invoices, amendments, and refunds remain reproducible if the markup or rates later change (consistent with v2.0 §4.10).
- Client-supplied prices are never trusted; the agency price is always recomputed server-side.

### 2.4 Rate calendar (conditional on Decision D1)

**D1 is closed to option (b): base rates are managed in the portal** (per the original brief), subject to written confirmation that seasonal pricing does not already live authoritatively in the PMS. Under option (b) a rate-calendar module is in scope and must be estimated as such — it was previously hidden behind a single line.

- Seasonal and date-range rates per room type per rate plan (e.g., peak, shoulder, off-season).
- Weekday / weekend differentials.
- Effective-dated rate versions with full rate history (who set which rate, when, effective from/to) for auditability and reproducibility.
- Bulk update and copy-forward tooling for a season; validation against overlapping date ranges.

*If D1 is instead confirmed as (a) — rates sourced from AxisRooms — the portal reads rates live and this module is removed from scope, reducing the estimate. The decision must be made before build.*

---

## 3. B2B channel inventory control (new — §4.2/§4.9 extension)

AxisRooms remains the inventory master and is read-only to the portal (v2.0 §3 unchanged). Between AxisRooms availability and what agencies can book, the portal applies a B2B availability policy layer so peak dates and scarce inventory are not fully exposed to the B2B channel.

- **Stop-sell / blackout:** Admin can close specified dates (or date ranges) for the B2B channel per resort and per room type — e.g., peak dates reserved for direct/OTA rates.
- **Allocation caps:** Admin can cap the number of rooms sellable to the B2B channel per room type per date, independent of total AxisRooms availability.
- **Per-agency allotments (optional):** a block of rooms reserved for a specific agency for a date range (see §4.2), consuming from the B2B cap.
- The policy layer filters live AxisRooms availability before display and is re-checked at hold and at commit; it never writes to AxisRooms.
- All stop-sell / cap / allotment changes are permission-controlled and audit-logged.

---

## 4. Group & multi-room bookings (new — §4.9/§5 extension)

Group business is the primary B2B use case and must be first-class. A booking is a cart of one or more room lines (differing room types, rate plans, occupancies, and date ranges) committed as a single transaction.

### 4.1 Multi-room booking

- An agent assembles multiple room lines into one booking; the agency price is the sum of all line agency prices.
- The unified credit gate (v2.0 §4.11) evaluates the **aggregate** booking total against the agency's effective credit limit — within-limit confirms on credit; over-limit / prepay takes the pay-first branch for the whole booking.
- A single tentative hold (configurable TTL, default 15 min) covers every line in the booking; commit to AxisRooms occurs for all lines only after payment clears (where applicable).

### 4.2 Room blocks / allotments

- Admin can create a room block (allotment) of N rooms of a given type for a date range against a specific agency, with an optional release-back date after which unsold rooms return to the general B2B pool.
- An agency's bookings draw from its allotment first, then from general B2B availability (subject to §3 caps).

### 4.3 Partial cancellation of a group booking

- Individual room lines within a multi-room booking can be cancelled without cancelling the whole booking.
- The cancellation policy (§7 / D4) is applied per cancelled line on that line's agency price; the balance is adjusted or a proportional refund / credit note (§6.4) is issued.
- The AxisRooms reservation is reversed only for the cancelled lines; remaining lines are untouched. All partial changes are audit-logged with correlation IDs.

---

## 5. Booking, hold & commit integrity (extends v2.0 §4.11 / §4.15)

### 5.1 Hold-window race condition

The portal hold is local: it does not lock the room in AxisRooms, so another channel can sell it during the hold. "Refresh-before-book" reduces but does not eliminate the risk. The mitigation is a mandatory re-validation of live availability at the moment of commit; if the room is no longer available, the booking does not silently fail — it enters the commit-failure flow (§5.2).

- If AxisRooms supports a channel hold/block, the portal places a real hold at §4.11 `awaiting_payment` and releases it on expiry (dependent on D6).
- The v2.0 stance is retained: bookings are never queued during AxisRooms downtime (overbooking risk) — booking is blocked with a maintenance state.

### 5.2 Payment collected but commit fails

The critical failure case: payment is collected (prepay or over-limit) but the AxisRooms reservation push fails or the room is gone. The flow is explicit and never leaves the agency charged without a booking or a resolution.

- Booking moves to `commit_failed / rebook_pending` and an Admin alert is raised; the collected amount is held, not lost.
- Automatic retry via the existing outbox + retry mechanism (v2.0 §4.15), keyed on the correlation ID (idempotent — never double-books).
- If unrecoverable within a configurable SLA, resolve by policy (D11 — proposed default): **offer alternative inventory (manual rebook queue) or auto-refund to source**. Admin can force either path.
- Refund-to-source timelines are surfaced to the agency; the financial event is posted to the CRS in all branches.

### 5.3 Partial payments, chargebacks & settlement reconciliation

- **Partial payments:** a booking may be part-settled; the outstanding remainder is tracked against the agency balance and the credit gate.
- **Chargebacks / disputes:** gateway chargeback and dispute events are captured, linked to the original booking and CRS entry, and flagged to Admin; the affected booking's financial state is reconciled, not silently overwritten.
- **Gateway settlement reconciliation:** a periodic job reconciles gateway settlement reports against portal payment records (in addition to the AxisRooms/CRS reconciliation job), flagging drift to Admin.

---

## 6. Finance, invoicing & GST compliance (extends v2.0 §4.12; mandatory before go-live)

"Single tax regime" (v2.0 Assumption 3) is an assumption, not an invoicing specification. India GST-compliant tax invoicing is mandatory before go-live and is specified here. Rates below reflect the GST 2.0 structure effective 22 September 2025 and are configurable, not hardcoded, so future GST Council changes are absorbed without a rebuild.

### 6.1 GST tax-invoice specification

- Agency GSTIN is captured at onboarding (v2.0 §4.2) and printed on every invoice; the resort's GSTIN and SAC code for accommodation (SAC 9963 / 996311) appear on each invoice.
- **Correct slab by room tariff** per night, applied on the value actually charged:

| Room value / night | GST rate | Input Tax Credit | Notes |
|---|---|---|---|
| Up to ₹1,000 | 0% (Nil) | n/a | Exempt slab. |
| ₹1,001 – ₹7,500 | 5% | Not available (no ITC) | Concessional slab; ITC apportionment per CGST Rules 42/43. |
| Above ₹7,500 | 18% | Available | Standard slab. |

- **Place of supply & tax split:** accommodation place of supply is the location of the resort. Intra-state supply → CGST + SGST; inter-state → IGST. The split is computed from the resort state vs. the place of supply, not assumed.
- **Invoice content:** sequential GST invoice number series, invoice date, supplier & recipient GSTIN and legal names, SAC, taxable value, CGST/SGST/IGST breakup, total, and (where applicable) IRN and signed QR code.
- **E-invoicing / IRN:** where the supplying entity's aggregate annual turnover exceeds the notified e-invoicing threshold (currently ₹5 crore), B2B invoices — and the corresponding credit/debit notes — must carry an IRN and QR code generated via the IRP before issue; entities at ₹10 crore+ are additionally subject to the 30-day IRP reporting window. The portal integrates an IRP/e-invoicing provider so invoices are IRN-stamped at generation. Applicability is a per-entity configuration.
- Note: room and meal-plan components may attract different GST treatment; the invoice engine itemises components so the correct rate is applied to each (composite vs. mixed supply handling is configurable).

### 6.2 Amendments to v2.0 finance (retained)

Outstanding-balance tracking, credit-limit monitoring feeding the gate, receipt generation, per-agency and company-wide reporting, and posting every financial event to the CRS as the ledger of record are retained from v2.0 §4.12 unchanged.

### 6.3 Overdue / dunning workflow (new)

Credit terms (net 15 / net 30) without enforcement are unenforceable. The following workflow enforces them; all thresholds are configurable.

- **Reminder cadence:** automated reminders on invoice generation, at due date, and at configurable intervals thereafter (e.g., +3, +7 days).
- **Auto-suspension:** at X days overdue (default = term + grace), the agency is moved to the lifecycle `Suspended` state (v2.0 §4.4) — booking rights blocked, existing balances remain due — with Admin override to reinstate.
- **Late fees (optional):** configurable late-fee rule, off by default, applied on overdue balance with Admin visibility.
- 80% credit-utilisation and overdue events feed the notification matrix (§9).

### 6.4 Amendments, repricing & credit notes (new)

- **Repricing on amendment:** a date, occupancy, or rate-plan change recomputes the agency price using the same server-side logic (§2). If the new price is higher, the difference is collected (or added to balance for credit agencies); if lower, a refund or credit note is issued.
- **GST credit notes:** reductions and cancellations generate a GST-compliant credit note (with IRN where e-invoicing applies), linked to the original invoice.
- **Application:** credit notes can be applied against the agency's future invoices or refunded to source, per Admin policy; application is tracked and audit-logged.

---

## 7. Cancellations, no-shows & resort-initiated changes (extends v2.0 §4.13)

### 7.1 Cancellation policy bands (Decision D4 — proposed, CEO sign-off required)

v2.0 left D4 "TBD". The following starting point is proposed for CEO-office sign-off; bands are configurable and versioned (not hardcoded), and apply to the agency price stored on the booking.

| Window before check-in | Charge on agency price | Notes |
|---|---|---|
| More than 7 days | Free cancellation | Full refund / credit of agency price. |
| Within 7 days to 48 hours | 50% | Balance refunded or credit-noted. |
| Within 48 hours | 100% | No refund. |
| No-show (see §7.2) | 100% (or 1 night) | Aligned with cancellation policy; configurable. |

**These bands must be confirmed by the CEO office before build.** Peak-season or block-booking bands may differ and can be configured separately.

### 7.2 No-shows

- A no-show is charged per the policy above and is linked to the cancellation configuration; the AxisRooms reservation is released/settled accordingly and the event posted to the CRS.

### 7.3 Resort-initiated cancellation / relocation

Separate from agency-initiated cancellation: the resort may need to cancel or relocate due to overbooking or maintenance.

- Admin can cancel or relocate an affected booking with a mandatory reason; the agency is notified (§9) with the alternative offered.
- Compensation / credit handling is defined (e.g., re-accommodation at no extra cost, or credit note), audit-logged, and posted to the CRS.

---

## 8. Guest data specification & DPDP compliance (extends v2.0 §4.9 / §6)

### 8.1 Guest data captured

- Per booking: lead guest name and contact; rooming-list guest names per room; and, where the resort requires it for check-in, guest ID type/number.
- Occupancy counts (adults/children) required for pricing (§2) are captured at booking.

### 8.2 What is pushed to the PMS

- Only the guest data the reservation system requires (via AxisRooms) is pushed on commit; the portal retains its own record linked by correlation ID. The exact field set pushed vs. retained is defined against the AxisRooms reservation contract (dependent on D6).

### 8.3 Retention & DPDP (Digital Personal Data Protection Act, 2023)

- Guest personal data is held under defined retention and deletion rules, distinct from the agency-representative PII already covered in v2.0 §6.
- DPDP obligations are designed in: lawful purpose and purpose limitation, data-minimisation, security safeguards, support for data-principal rights (access/correction/erasure) and grievance handling, and breach-notification readiness. Guest IDs are masked in the UI and encrypted at rest, consistent with v2.0 §6.

### 8.4 Onboarding documentation (closes Gap 13)

- v2.0 already captures GST certificate, PAN, bank details and the signed agreement. This version adds explicit capture of the agency's acceptance of the cancellation policy (§7) as a stored onboarding artifact against the agency record.

---

## 9. Notification matrix (extends v2.0 §4.14; WhatsApp first-class)

v2.0 covered onboarding notifications only. The matrix below adds the operational events and makes WhatsApp Business API a first-class channel alongside email for the Indian agency market; SMS is retained for OTP and time-critical steps. All notifications remain templated and audit-logged.

| Event | Recipient | Channel(s) |
|---|---|---|
| Hold expiring (pre-expiry warning) | Booking agent | WhatsApp + email |
| Booking confirmed / committed | Agent + agency | WhatsApp + email |
| Booking cancelled (agency or resort) | Agent + agency | WhatsApp + email |
| Invoice generated | Agency | Email + WhatsApp |
| Payment received / receipt | Agency | WhatsApp + email |
| Invoice due reminder | Agency | WhatsApp + email |
| Invoice overdue / dunning | Agency (+ Admin escalation) | WhatsApp + email |
| Credit utilisation at 80% | Agency | WhatsApp + email |
| No-show recorded | Agency | Email |
| Resort-initiated change / relocation | Agency | WhatsApp + email + SMS |
| Onboarding events (v2.0 §4.14) | Applicant / representative | Email (+ SMS for eSign/OTP) |

*WhatsApp templates require Meta/BSP approval; this is a dependency to schedule early. Recipients can opt channels per agency preference.*

---

## 10. Non-functional requirements — quantified (replaces v2.0 §4.16 "scalable")

### 10.1 Performance & availability (acceptance criteria)

"Scalable" is replaced by measurable targets. Values below are proposed baselines for confirmation at sign-off.

| Metric | Target (proposed) | Notes |
|---|---|---|
| Uptime (portal) | 99.5% monthly | Excludes scheduled maintenance windows. |
| Availability search response | < 3 s (p95) | Live AxisRooms fetch with short-TTL cache. |
| Booking commit response | < 5 s (p95) | Excludes external system latency spikes. |
| Concurrent users | ≥ 200 concurrent agents | Confirm against agency-network projection. |
| Peak booking volume | Define at sign-off | e.g., N bookings/hour at peak season. |
| Mobile web | Fully responsive | Acceptance criterion — see below. |

**Mobile experience** (closes Gap 18): a fully responsive mobile web experience is a stated acceptance criterion — not an assumption — because agents book primarily from phones. Search, availability, booking, and invoice/balance views must be usable on a phone.

### 10.2 Security hardening (adds to v2.0 §6)

v2.0 §6 already specifies MFA for Admin/Verifier, RBAC on every endpoint, encrypted document/PII storage, webhook signature validation, and rate limiting — all retained. The following are added:

- **Explicit password policy** (length, complexity, rotation/breach-check) and enforced 2FA for agency users (v2.0 made agency MFA configurable; this version recommends it enforced).
- **Backup & disaster recovery** with defined RPO and RTO targets (e.g., RPO ≤ 1 hour, RTO ≤ 4 hours — to confirm), tested restores.
- **Pre-launch penetration test** and periodic vulnerability scanning, with remediation sign-off before go-live.

---

## 11. Delivery plan (new section — closes Gap 14, Critical)

v2.0 defined scope but made no delivery commitment. This section provides phasing, milestones, an indicative timeline, a proposed stack, and hosting. Commercials (budget and payment schedule) are to be provided by the delivery vendor against this scope; they are not asserted here.

### 11.1 Phasing

| Phase | Scope | Indicative duration |
|---|---|---|
| MVP | Onboarding + Digio KYB/eKYC + lifecycle + eSign (v2.0); core booking with rate plans & occupancy (§2); credit gate; GST invoicing (§6.1); AxisRooms read/write + commit-failure flow (§5); essential notifications. | To be quoted |
| Phase 2 | Group/multi-room & allotments (§4); channel inventory control (§3); dunning (§6.3); amendments & credit notes (§6.4); full notification matrix incl. WhatsApp (§9); no-show & resort-initiated changes (§7). | To be quoted |
| Phase 3 | Rate-calendar tooling (§2.4, if D1-b); advanced reporting; settlement reconciliation refinements; hardening & performance tuning to NFR targets (§10). | To be quoted |

**Sequencing note:** MVP cannot be estimated or started until D6 (AxisRooms write) is confirmed — see §14.

### 11.2 Milestones (indicative)

- M0 — D6 confirmed; D1, D4, D10, D11 closed; scope frozen for estimation.
- M1 — Onboarding + verification live in staging; M2 — Booking + pricing + GST invoicing in staging; M3 — Integrations hardened (AxisRooms, CRS, Digio, gateway, IRP); M4 — UAT sign-off; M5 — Go-live.

### 11.3 Technology, hosting & team (proposed)

- **Stack (recommended, vendor to confirm):** modern web stack with a typed backend and a responsive SPA/SSR front end; managed relational database; message/outbox queue for idempotent external writes.
- **Hosting:** cloud (India region for data-residency alignment with DPDP), with managed backups, secret store, and TLS everywhere (consistent with v2.0 §6).
- **Team & responsibilities:** to be stated in the vendor proposal (roles, RACI, escalation), against the milestones above.

---

## 12. UAT, training & post-launch support (new section — Gap 15)

### 12.1 UAT & sign-off

- An acceptance-test plan with pass/fail criteria per module (onboarding, verification, pricing, booking, credit gate, invoicing/GST, cancellations, notifications, integrations).
- Formal sign-off per module by the resort before go-live; defects triaged by severity with fix SLAs during UAT.

### 12.2 Training & material

- Training and onboarding material for Admin/Verifier, agency, and agent roles (guides + walkthroughs); optional live sessions.

### 12.3 Warranty, support SLA & maintenance

- Warranty period after go-live (e.g., 90 days — to confirm) covering defect fixes at no charge.
- Support SLA (response/resolution targets by severity) and ongoing maintenance terms, defined in the vendor proposal.

---

## 13. Retained from v2.0 (unchanged)

The following v2.0 content is carried forward without change and remains authoritative; it is summarised here for completeness. Refer to Scope v2.0 for full text.

- Self-service agency onboarding & registration (v2.0 §4.2); Digio KYB/eKYC verification (§4.3); agency lifecycle state machine (§4.4); Admin verification dashboard (§4.5); agreement & eSign workflow (§4.6); commercial configuration & tiers (§4.7).
- System context & ownership boundaries (§3); RBAC and four-role model (§4.1); the unified credit gate (§4.11); CRS-as-ledger (§4.12); onboarding & verification data entities (§5); the security & compliance framework (§6).
- Integrations mechanics — AxisRooms read/write + block-don't-queue downtime handling, CRS event posting with outbox/idempotency/correlation IDs, Digio validated idempotent webhooks, and the reconciliation job (§4.15).

---

## 14. Open decisions — updated register & required actions

**D6 is the single largest project risk and must be resolved first.** If AxisRooms does not support reservation push (write), the entire commit architecture in §5 changes. Verify with AxisRooms in writing before any further design or estimation work.

| # | Decision | Status / resolution in v3.0 |
|---|---|---|
| D1 | Base-rate source | Closed to (b) portal-managed — enables rate calendar §2.4. Confirm in writing that seasonal pricing is not already authoritative in the PMS; if it is, revert to (a) and drop §2.4. |
| D2 | Payment collection pattern | Carry v2.0 assumption (a): portal gateway posts to CRS. Confirm and close. |
| D3 | Credit-limit-reached behaviour | Carry v2.0 assumption (a): over-limit booking flips to pay-first. Confirmed. |
| D4 | Cancellation policy bands | Proposed in §7.1 — CEO-office sign-off required before build. |
| D5 | CRS posting granularity | Carry v2.0 assumption: base + markup split for margin reporting. |
| D6 | AxisRooms write capability | **BLOCKING** — verify reservation push is supported (not read-only), in writing, before build. |
| D7 | Admin-initiated onboarding exception | Optional path per v2.0; confirm if required. |
| D8 | Verification auto-progression | Carry v2.0: auto to Review, manual decision. |
| D9 | Re-application policy | Business to define cooldown/conditions after rejection. |
| D10 | Markup application to meal/occupancy | NEW — §2.3. Default single-markup-on-total; confirm at sign-off. |
| D11 | Post-payment commit-failure resolution | NEW — §5.2. Default: rebook queue or auto-refund to source; confirm default. |

**Required actions before estimation:** (1) confirm D6 in writing; (2) close D1, D4, D10, D11; (3) confirm NFR targets (§10) and e-invoicing applicability (§6.1); (4) obtain vendor commercials and timeline against §11.

---

## 15. Success criteria — additions

In addition to the v2.0 success criteria (retained), this version is successful when:

- An agent can book a multi-room group at meal-plan and occupancy-based prices, and partially cancel it, with correct per-line pricing and refunds/credit notes.
- Every invoice is GST-compliant — correct slab, place-of-supply tax split, SAC, and IRN where applicable — and every credit note is linked and compliant.
- A payment collected against a booking that fails to commit is never lost: it is retried, and resolved by rebook or refund-to-source with an audit trail and CRS posting.
- Overdue credit agencies are reminded and auto-suspended per policy; no agency can transact while suspended.
- Admin can stop-sell / blackout / cap B2B inventory, and the portal never exposes restricted dates to agencies.
- The portal meets the quantified NFR targets (§10) and is fully usable on mobile web; a pre-launch penetration test is signed off.

---

*Prepared as Scope v3.0 in response to Annexure A (Gap Analysis). Critical items are resolved or explicitly flagged for sign-off; D6 remains the blocking dependency. Issue for review and vendor estimation.*