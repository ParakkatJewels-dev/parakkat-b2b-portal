# Disaster Recovery & Backup Runbook — B2B Resort Booking Portal

Backup strategy, recovery objectives, and step-by-step restore/DR procedures. Day-to-day operations
are in `docs/RUNBOOK.md`; this document covers **data loss and outage recovery**.

> Fill the **`<…>` placeholders** with your production values (project refs, bucket names, on-call
> contacts) before this runbook is operational. Values that require an operational decision are
> flagged **DECIDE**.

## 1. What must be recoverable

| Asset | System of record | Backup mechanism |
|---|---|---|
| Portal relational data (users, agencies, applications, bookings, invoices, payments, credit notes, audit log, pricing, inventory, **rebook queue**, **CRS outbox**) | Supabase PostgreSQL | Supabase automated backups + PITR; logical `pg_dump` |
| Uploaded documents (KYC proofs, signed agreements) | Object storage (`STORAGE_PROVIDER=s3`) | Bucket versioning + cross-region replication |
| Secrets (`MFA_ENCRYPTION_KEY`, webhook secrets, provider keys) | Secret manager (host dashboard) | Escrowed copy in the org password manager |
| External ledgers (CRS is the ledger of record for finance) | Vendor (CRS) | Reconciled via the outbox; **the portal is not the source of truth for the ledger** |

**Critical coupling:** `MFA_ENCRYPTION_KEY` decrypts every stored TOTP secret. **Lose it and all MFA
enrolments are unrecoverable** (users must re-enrol). Back it up independently of the database, and
never rotate it without a re-encryption migration.

## 2. Recovery objectives (DECIDE — proposed defaults)

| Metric | Proposed target | Rationale |
|---|---|---|
| **RPO** (max data loss) | **≤ 5 minutes** | Supabase PITR replays WAL to a chosen second; money-moving events must not be lost |
| **RTO** (max downtime) | **≤ 2 hours** | Single-region managed stack; restore + redeploy + smoke test |
| Backup retention | **≥ 30 days** PITR window + **90 days** of weekly logical dumps | Covers late-discovered corruption |
| Restore drill cadence | **Quarterly** | Proves the runbook actually works |

Ratify these with the business (finance's tolerance for lost bookings drives RPO). The current
architecture is **single-region managed compute** with Supabase Realtime (see `docs/RUNBOOK.md`),
so DR is *restore-and-redeploy*, not hot-standby failover. If the business needs a
lower RTO, that is a **decision to add a read-replica/multi-region topology** — call it out, don't
assume it.

## 3. Backup configuration

### 3.1 Database (Supabase)
- Enable **Point-in-Time Recovery** on the project (Database → Backups). Confirm the retention window
  matches §2.
- Verify **daily automated backups** are on and alerting is configured for backup failure.
- **Independent logical dumps** (defence against "PITR window too short" and against project deletion):
  ```bash
  # Scheduled job (CI/cron), NOT on an app instance. Uses the direct (non-pooled) connection.
  pg_dump "$DIRECT_URL" --format=custom --no-owner --file "portal-$(date +%F).dump"
  # Upload to a SEPARATE bucket/account from primary storage:
  aws s3 cp "portal-$(date +%F).dump" "s3://<dr-dumps-bucket>/db/"
  ```
  Keep dumps in a **different cloud account/region** than the Supabase project so a compromised or
  deleted account can't take the backups with it.
- Store the schema/migration history in git (already the case: `server/prisma/migrations`), so schema
  is reproducible even without a dump.

### 3.2 Documents (object storage)
- Enable **bucket versioning** and **cross-region replication**.
- Lifecycle policy: retain non-current versions ≥ 90 days.
- Documents are referenced by opaque `storageKey` in the DB; a DB restore + bucket restore must be to
  **consistent points in time** (see §5.3).

### 3.3 Secrets
- Primary in the host secret manager; escrowed copy in the org password manager, access-controlled.
- Record which `MFA_ENCRYPTION_KEY` version is active alongside each DB backup so a restore pairs the
  right key with the right ciphertext.

## 4. Monitoring & alerting (detection)

DR starts with knowing you need it. Ensure alerts exist for:
- Backup job failure (DB dump job + Supabase backup status).
- `GET /api/health/live` and `/api/health/ready` failing.
- **Connection-pool exhaustion** (`EMAXCONNSESSION`) — the app is pinned to `connection_limit` under
  Supabase's client cap; a spike is an early outage signal (see `docs/RUNBOOK.md`).
- CRS outbox growth: rising `PENDING`/`FAILED` events means finance postings aren't reaching the
  ledger — a data-integrity incident even without an outage.
- Rebook queue growth (`RebookTask` PENDING/ABANDONED) — AxisRooms commit failures accumulating.

## 5. Recovery procedures

### 5.0 Declare & communicate
1. Declare the incident; assign an **incident commander**.
2. Notify stakeholders (`<ops-contact>`, `<finance-contact>`, `<vendor-contacts>`).
3. Put the portal in a controlled state: scale the API to 0 or enable a maintenance page so no new
   writes race the restore.

### 5.1 Scenario A — accidental data corruption / bad deploy (most common)
Point-in-time restore to just before the corrupting event.
1. Identify the **target timestamp** (from the audit log / deploy log — the event that introduced the corruption).
2. Supabase → Database → Backups → **PITR** → restore to `T-ε`. Prefer restoring into a **new project/branch** first to verify, rather than overwriting live.
3. Verify on the restored copy (§6). Then cut over: point `DATABASE_URL`/`DIRECT_URL` at the restored instance and redeploy.
4. Reconcile finance: run `POST /api/finance/crs/flush` then `GET /api/finance/reconciliation` — must return `clean: true`.

### 5.2 Scenario B — total loss of the Supabase project
1. Provision a new Supabase project; set `connection_limit` on the pooled `DATABASE_URL` and configure `DIRECT_URL` (see `docs/RUNBOOK.md`).
2. Restore data:
   - **Preferred:** `pg_restore` the latest logical dump:
     ```bash
     pg_restore --no-owner --dbname "$DIRECT_URL" portal-<date>.dump
     ```
   - Then `npm run db:migrate:deploy --workspace server` to apply any migrations newer than the dump.
3. Re-apply **RLS policies** (they ship as migration `enable_rls`; confirm they're present — see `docs/SECURITY-CHECKLIST.md`).
4. Restore the paired `MFA_ENCRYPTION_KEY` version. If it is truly lost, force MFA re-enrolment (communicate to users) — do **not** ship a new key against old ciphertext.
5. Redeploy API + web; run smoke tests (§6).

### 5.3 Scenario C — document store loss / inconsistency
1. Restore the bucket (or specific versions) to the timestamp matching the DB restore point.
2. Spot-check that `Document.storageKey` values resolve to objects; a DB row without its object is a
   partial-restore defect — re-align the timestamps.

### 5.4 Scenario D — external integration outage (AxisRooms/CRS/Airpay/Digio)
Not a data-loss event; **degrade, don't corrupt**:
- **AxisRooms down:** new bookings return 503 by design (block-don't-queue). Bookings caught mid-commit
  land in the **rebook queue** (§5.2) with funds held. When AxisRooms recovers, run
  `POST /api/bookings/admin/rebook/run` to drain the queue. No data is lost.
- **CRS down:** financial events accumulate in the **outbox** and retry. On recovery,
  `POST /api/finance/crs/flush`, then reconcile.
- **Airpay/Digio down:** the affected flow pauses; no partial financial state is committed (payment
  capture and invoice creation are transactional).

## 6. Post-restore verification (before declaring recovered)
- `GET /api/health/ready` returns healthy (DB reachable).
- Login works for a known Admin (MFA prompt appears → key/ciphertext pairing is intact).
- Row counts / latest `createdAt` on `Booking`, `Invoice`, `Payment`, `AuditLog` match the target
  point in time.
- `GET /api/finance/reconciliation` → `clean: true`; outbox drained.
- Rebook queue reviewed; drained or intentionally left with a known cause.
- A test booking end-to-end (search → book → pay/commit) succeeds against the (sandbox) adapters.
- Tenant isolation spot-check (an agency sees only its own data).

## 7. Restore drill (quarterly, DECIDE owner)
1. Restore the latest dump into a throwaway project.
2. Run §6 verification.
3. Time it — record actual RTO vs target; file gaps as action items.
4. Rotate who runs it so the knowledge isn't single-person.

## 8. Runbook maintenance
- Review after any schema change that adds a new system-of-record table (update §1).
- Re-confirm `<…>` values and on-call contacts each quarter.
- Keep this in git next to the code so it versions with the schema it describes.
