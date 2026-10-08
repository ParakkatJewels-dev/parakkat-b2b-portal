import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env for dev/prod only. Under test, the test harness loads .env.test
// first (setting NODE_ENV=test); loading .env here too would leak dev values
// (e.g. MFA_ENFORCED) into the test environment.
if (process.env.NODE_ENV !== 'test') {
  // Workspace scripts run from server/, while `vercel dev` and the root
  // Express entry run from the repository root. Load both locations without
  // overriding values already supplied by the process/Vercel dashboard.
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
}

/**
 * Parses a boolean env var. NOTE: `z.coerce.boolean()` is unusable here — it
 * does `Boolean(value)`, so the string "false" becomes `true`. This treats
 * "false"/"0"/"no"/"off"/"" as false and "true"/"1"/"yes"/"on" as true.
 */
const boolEnv = (defaultVal: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return defaultVal;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Identity: Supabase Auth owns users, passwords, sessions, refresh-token rotation and TOTP
  // factors (lib/identity). `mock` is an in-memory stand-in for tests and offline development —
  // rejected in production like the other mock providers.
  // Default: Supabase in production, the mock everywhere else. The mock keeps sessions in process
  // memory, so it cannot serve a multi-instance (serverless) deployment.
  IDENTITY_PROVIDER: z.enum(['supabase', 'mock']).default(process.env.NODE_ENV === 'production' ? 'supabase' : 'mock'),
  // Public key used for Supabase Auth's password/refresh grants (falls back to the service role).
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  // Only for projects still on the legacy shared HS256 secret; others verify against the
  // project's published signing keys (JWKS).
  SUPABASE_JWT_SECRET: z.string().optional(),
  // Signs the mock provider's tokens (tests / local dev only).
  IDENTITY_MOCK_JWT_SECRET: z.string().min(32).default('local-identity-mock-secret-not-for-production'),
  // Lifetime of the httpOnly cookie that carries the Supabase refresh token.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Master kill-switch: when true, MFA is OFF for everyone — no setup prompt, no
  // second factor, even for users who previously enabled it. Flip back to false
  // to restore the per-role enforcement below. Default false (secure).
  MFA_DISABLED: boolEnv(false),

  // When true (default), ADMIN/VERIFIER must use MFA regardless of their
  // per-user setting. Set to false in dev to skip mandatory MFA for testing —
  // login then follows each user's own mfaEnabled flag. Keep true in prod.
  MFA_ENFORCED: boolEnv(true),
  // v3 §10.2 — enforce MFA for agency principals (default) and, optionally, agents.
  MFA_ENFORCE_AGENCY: boolEnv(true),
  MFA_ENFORCE_AGENT: boolEnv(false),
  // v3 §10.2 — minimum password length (policy also requires upper/lower/digit/symbol).
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(10),

  STORAGE_PROVIDER: z.enum(['supabase', 's3', 'local']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolEnv(false),
  // Supabase Storage (STORAGE_PROVIDER=supabase). Private bucket; served via
  // short-lived signed URLs. Uses the service-role key — server-side only.
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().optional(),

  // Supabase Broadcast replaces the process-local Socket.IO fan-out when the
  // API runs as a Vercel Function. Broadcast payloads contain cache topics only.
  REALTIME_ENABLED: boolEnv(false),
  REALTIME_CHANNEL_SECRET: z.string().min(16).optional().or(z.literal('')),

  MAILER_PROVIDER: z.enum(['resend', 'console']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@parakkatjewels.com'),

  SMS_PROVIDER: z.enum(['msg91', 'console']).default('console'),
  MSG91_AUTH_KEY: z.string().optional(),

  ADMIN_SEED_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_SEED_PASSWORD: z.string().min(8).optional().or(z.literal('')),

  SWAGGER_ENABLED: boolEnv(true),

  // Optional CAPTCHA on public onboarding endpoints (§11). Off in dev.
  CAPTCHA_ENABLED: boolEnv(false),
  // Provider whose siteverify endpoint validates the token. Turnstile is the
  // privacy-friendly default; hCaptcha and reCAPTCHA are drop-in alternatives.
  CAPTCHA_PROVIDER: z.enum(['turnstile', 'hcaptcha', 'recaptcha']).default('turnstile'),
  CAPTCHA_SECRET: z.string().optional(),

  // Max upload size (bytes) for onboarding documents. Default 10 MB.
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  // --- Digio KYB/eKYC (Phase 3) ---
  // mock: no live calls; results are driven via the webhook endpoint / manual
  // override. live: real Digio API (base URL + credentials required in prod).
  DIGIO_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  DIGIO_BASE_URL: z.string().optional(),
  DIGIO_CLIENT_ID: z.string().optional(),
  DIGIO_CLIENT_SECRET: z.string().optional(),
  // Shared secret used to HMAC-validate inbound Digio webhooks. Has a dev
  // default so mock webhooks can be signed locally; required in production.
  DIGIO_WEBHOOK_SECRET: z.string().min(8).default('dev-digio-webhook-secret'),
  // Auto-progress an application VERIFICATION → REVIEW once all mandatory
  // checks reach a terminal status (Decision D8). Configurable per §16.
  VERIFICATION_AUTO_PROGRESS: boolEnv(true),

  // --- Commercial / activation (Phase 4) ---
  // Optional JSON overriding the built-in tier presets (§16 — presets must be
  // configurable, not hardcoded). Shape: { "GOLD": { paymentMode, creditLimit,
  // paymentTerms, markupPct }, ... }. Invalid JSON falls back to defaults.
  TIERS_CONFIG_JSON: z.string().optional(),
  // App base URL used to build eSign / activation links in emails.
  APP_BASE_URL: z.string().default('http://localhost:5173'),

  // Placeholder guard escape hatch. Production boots REFUSE mock/console/local
  // providers and localhost URLs unless this is explicitly set — so a demo or
  // staging deployment must declare itself, and a real launch can never run on
  // fakes silently.
  ALLOW_MOCK_PROVIDERS: boolEnv(false),

  // --- Notifications (Phase 5) ---
  // Send SMS alongside email for time-sensitive events (eSign, activation).
  SMS_NOTIFICATIONS_ENABLED: boolEnv(false),

  // --- Booking / hotel inventory (Phase 6) ---
  // mock: in-memory dev catalogue. crs: the hotel's CRS (client lands once the
  // CRS company provides API docs — selecting it before then fails at boot).
  INVENTORY_PROVIDER: z.enum(['mock', 'crs']).default('mock'),
  // Simulate inventory-source downtime to exercise block-don't-queue behaviour.
  INVENTORY_FORCE_DOWN: boolEnv(false),
  // Tentative-hold TTL for pay-first bookings (default 15 min, §10).
  BOOKING_HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // Stay-date guardrails: no past check-in, a max stay length, and how far ahead
  // a booking may be made. Enforced server-side (authoritative) on search + book.
  BOOKING_MAX_STAY_NIGHTS: z.coerce.number().int().positive().default(30),
  BOOKING_MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(365),
  // v3 §5.2 — max automatic CRS rebook attempts before a commit-failed
  // booking is parked for manual admin resolution.
  REBOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Short-TTL availability cache (seconds).
  AVAILABILITY_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(30),

  // --- Finance / CRS / payments (Phase 7) ---
  // CRS is the ledger of record; the portal posts financial events to it.
  CRS_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  CRS_BASE_URL: z.string().optional(),
  CRS_API_KEY: z.string().optional(),
  // Live HotSoft ingest endpoint on the company CRS (chief.parakkatjewels.in).
  // Accepts JSON, max 2MB/request; authenticated with a Bearer token.
  CRS_INGEST_URL: z.string().optional(),
  CRS_TOKEN: z.string().optional(),
  // Request timeout (ms) for a CRS ingest POST before it's treated as failed
  // (outbox then retries). Kept short so a hung CRS doesn't stall the worker.
  CRS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  // Payment gateway (Decision D2-a: portal collects, posts to CRS).
  PAYMENT_PROVIDER: z.enum(['mock', 'airpay']).default('mock'),
  AIRPAY_MERCHANT_ID: z.string().optional(),
  AIRPAY_SECRET: z.string().optional(),
  // HMAC secret validating inbound payment webhooks. Dev default; required in prod.
  PAYMENT_WEBHOOK_SECRET: z.string().min(8).default('dev-payment-webhook-secret'),
  // Deliver CRS outbox events synchronously after each financial change (dev),
  // in addition to the retry worker. Off → rely on the worker only.
  CRS_FLUSH_INLINE: boolEnv(true),
  // Cancellation policy bands (Decision D4). JSON array of { minDaysBefore, chargePct }
  // sorted desc by minDaysBefore; the first band whose minDaysBefore <= daysBefore applies.
  CANCELLATION_POLICY_JSON: z.string().optional(),

  // --- GST / e-invoicing (v3 §6.1; configurable, not hardcoded) ---
  // Slabs by room value per night. JSON array of { upTo: number|null, rate: number }
  // ascending by upTo; upTo:null is the top (open-ended) band. Default = GST 2.0.
  GST_SLABS_JSON: z.string().optional(),
  // Per-resort GST identity for place-of-supply. JSON map
  // { "<resortId>": { "stateCode": "30", "gstin": "30AABCP...1Z5" } }.
  RESORT_GST_JSON: z.string().optional(),
  // Stamp a (mock) IRN + QR at generation when the supplying entity is over the
  // e-invoicing threshold. Real IRP integration replaces the stub when live.
  EINVOICE_ENABLED: boolEnv(false),

  // --- WhatsApp (v3 §9, first-class channel) ---
  WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
  WHATSAPP_NOTIFICATIONS_ENABLED: boolEnv(false),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  // --- Dunning / overdue (v3 §6.3; all thresholds configurable) ---
  // Auto-suspend an agency once it has a credit invoice this many days overdue.
  DUNNING_SUSPEND_DAYS: z.coerce.number().int().positive().default(15),
  // Notify an agency once its credit utilisation reaches this percentage.
  CREDIT_UTILIZATION_ALERT_PCT: z.coerce.number().int().positive().max(100).default(80),

  // --- Hardening (Phase 8) ---
  // Soft anomaly threshold: this many onboarding drafts from one IP within the
  // window raises an audited alert (the hard block is the rate limiter).
  ONBOARDING_ANOMALY_THRESHOLD: z.coerce.number().int().positive().default(5),
  ONBOARDING_ANOMALY_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),

  // --- Background scheduler ---
  // In-process scheduler that drives the periodic jobs (stale-hold expiry, CRS
  // outbox retry, rebook queue, dunning). Set false to disable and rely solely
  // on the manual admin endpoints / an external cron. Always off under test.
  SCHEDULER_ENABLED: boolEnv(true),
  // Release lapsed pay-first holds (AWAITING_PAYMENT past holdExpiresAt).
  HOLD_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  // Retry PENDING CRS outbox events that failed inline delivery.
  CRS_FLUSH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  // Retry COMMIT_FAILED bookings queued for CRS rebook.
  REBOOK_QUEUE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  // Dunning (overdue reminders / auto-suspend / credit alerts). Defaults to daily
  // to avoid re-notifying overdue agencies too often; for a precise time-of-day
  // run, disable this and hit POST /finance/dunning/run from an external cron.
  DUNNING_INTERVAL_SECONDS: z.coerce.number().int().positive().default(86400),

  // Vercel automatically sends this value as `Authorization: Bearer ...` when
  // invoking routes declared in vercel.json.
  CRON_SECRET: z.string().min(16).optional().or(z.literal('')),
});

const parsed = baseSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const data = parsed.data;

if (data.NODE_ENV === 'production') {
  const productionErrors: string[] = [];
  if (!data.CRON_SECRET) productionErrors.push('CRON_SECRET is required in production');
  if (data.IDENTITY_PROVIDER === 'supabase') {
    if (!data.SUPABASE_URL) productionErrors.push('SUPABASE_URL is required when IDENTITY_PROVIDER=supabase');
    if (!data.SUPABASE_SERVICE_ROLE_KEY)
      productionErrors.push('SUPABASE_SERVICE_ROLE_KEY is required when IDENTITY_PROVIDER=supabase');
  }
  if (data.STORAGE_PROVIDER === 's3') {
    if (!data.S3_BUCKET) productionErrors.push('S3_BUCKET is required when STORAGE_PROVIDER=s3');
    if (!data.S3_REGION) productionErrors.push('S3_REGION is required when STORAGE_PROVIDER=s3');
    if (!data.S3_ACCESS_KEY_ID)
      productionErrors.push('S3_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3');
    if (!data.S3_SECRET_ACCESS_KEY)
      productionErrors.push('S3_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=s3');
  }
  if (data.STORAGE_PROVIDER === 'supabase') {
    if (!data.SUPABASE_URL)
      productionErrors.push('SUPABASE_URL is required when STORAGE_PROVIDER=supabase');
    if (!data.SUPABASE_SERVICE_ROLE_KEY)
      productionErrors.push('SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_PROVIDER=supabase');
    if (!data.SUPABASE_STORAGE_BUCKET)
      productionErrors.push('SUPABASE_STORAGE_BUCKET is required when STORAGE_PROVIDER=supabase');
  }
  if (data.REALTIME_ENABLED) {
    if (!data.SUPABASE_URL)
      productionErrors.push('SUPABASE_URL is required when REALTIME_ENABLED=true');
    if (!data.SUPABASE_SERVICE_ROLE_KEY)
      productionErrors.push('SUPABASE_SERVICE_ROLE_KEY is required when REALTIME_ENABLED=true');
    if (!data.REALTIME_CHANNEL_SECRET)
      productionErrors.push('REALTIME_CHANNEL_SECRET is required when REALTIME_ENABLED=true');
  }
  if (data.MAILER_PROVIDER === 'resend' && !data.RESEND_API_KEY) {
    productionErrors.push('RESEND_API_KEY is required when MAILER_PROVIDER=resend');
  }
  if (data.DIGIO_PROVIDER === 'live') {
    if (!data.DIGIO_BASE_URL)
      productionErrors.push('DIGIO_BASE_URL is required when DIGIO_PROVIDER=live');
    if (!data.DIGIO_CLIENT_ID)
      productionErrors.push('DIGIO_CLIENT_ID is required when DIGIO_PROVIDER=live');
    if (!data.DIGIO_CLIENT_SECRET)
      productionErrors.push('DIGIO_CLIENT_SECRET is required when DIGIO_PROVIDER=live');
  }
  if (data.DIGIO_WEBHOOK_SECRET === 'dev-digio-webhook-secret') {
    productionErrors.push('DIGIO_WEBHOOK_SECRET must be set to a real secret in production');
  }
  if (data.PAYMENT_WEBHOOK_SECRET === 'dev-payment-webhook-secret') {
    productionErrors.push('PAYMENT_WEBHOOK_SECRET must be set to a real secret in production');
  }
  if (data.INVENTORY_PROVIDER === 'crs') {
    if (!data.CRS_BASE_URL)
      productionErrors.push('CRS_BASE_URL is required when INVENTORY_PROVIDER=crs');
    if (!data.CRS_API_KEY)
      productionErrors.push('CRS_API_KEY is required when INVENTORY_PROVIDER=crs');
  }
  if (data.CRS_PROVIDER === 'live') {
    if (!data.CRS_INGEST_URL)
      productionErrors.push('CRS_INGEST_URL is required when CRS_PROVIDER=live');
    if (!data.CRS_TOKEN) productionErrors.push('CRS_TOKEN is required when CRS_PROVIDER=live');
  }
  if (data.PAYMENT_PROVIDER === 'airpay') {
    if (!data.AIRPAY_MERCHANT_ID)
      productionErrors.push('AIRPAY_MERCHANT_ID is required when PAYMENT_PROVIDER=airpay');
    if (!data.AIRPAY_SECRET)
      productionErrors.push('AIRPAY_SECRET is required when PAYMENT_PROVIDER=airpay');
  }
  if (data.CAPTCHA_ENABLED && !data.CAPTCHA_SECRET) {
    productionErrors.push('CAPTCHA_SECRET is required when CAPTCHA_ENABLED=true');
  }
  // Placeholder guard — production must never run on fakes silently. Each
  // mock/console/local provider and localhost URL is rejected unless
  // ALLOW_MOCK_PROVIDERS=true declares this a demo/staging deployment.
  if (!data.ALLOW_MOCK_PROVIDERS) {
    const mocked: [string, boolean][] = [
      ['IDENTITY_PROVIDER=mock', data.IDENTITY_PROVIDER === 'mock'],
      ['INVENTORY_PROVIDER=mock', data.INVENTORY_PROVIDER === 'mock'],
      ['CRS_PROVIDER=mock', data.CRS_PROVIDER === 'mock'],
      ['PAYMENT_PROVIDER=mock', data.PAYMENT_PROVIDER === 'mock'],
      ['DIGIO_PROVIDER=mock', data.DIGIO_PROVIDER === 'mock'],
      ['MAILER_PROVIDER=console', data.MAILER_PROVIDER === 'console'],
      ['SMS_PROVIDER=console', data.SMS_PROVIDER === 'console' && data.SMS_NOTIFICATIONS_ENABLED],
      ['WHATSAPP_PROVIDER=console', data.WHATSAPP_PROVIDER === 'console' && data.WHATSAPP_NOTIFICATIONS_ENABLED],
      ['STORAGE_PROVIDER=local', data.STORAGE_PROVIDER === 'local'],
    ];
    for (const [label, isMock] of mocked) {
      if (isMock) {
        productionErrors.push(
          `${label} is a dev/mock provider — not allowed in production (set ALLOW_MOCK_PROVIDERS=true only for a demo/staging deployment)`,
        );
      }
    }
    const isLocalUrl = (u: string) => u.includes('localhost') || u.includes('127.0.0.1');
    if (isLocalUrl(data.APP_BASE_URL)) {
      productionErrors.push('APP_BASE_URL points at localhost — emails would carry dead links (set ALLOW_MOCK_PROVIDERS=true only for a demo/staging deployment)');
    }
    if (isLocalUrl(data.CORS_ORIGIN)) {
      productionErrors.push('CORS_ORIGIN points at localhost (set ALLOW_MOCK_PROVIDERS=true only for a demo/staging deployment)');
    }
  }
  if (productionErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Invalid production environment configuration:');
    for (const err of productionErrors) {
      // eslint-disable-next-line no-console
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}

export const env = data;
export type Env = typeof env;
