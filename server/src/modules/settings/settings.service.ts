import type { ActorRole, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { setCompanyProfileOverride } from '../../config/company';
import { recordAuditLogSafe } from '../audit/audit.service';

/**
 * Admin-editable runtime settings. Persisted one row per group in SystemSetting,
 * merged over the defaults below, and cached in-process so hot paths (booking
 * date validation, invoice numbering, the login gate, PDF company header) read
 * current values synchronously. {@link loadSettings} primes the cache at startup;
 * {@link updateGroup} refreshes it and re-applies side-effects on every save.
 */

export interface CompanySettings {
  name: string;
  addressLine1: string;
  addressLine2: string;
  gstin: string;
  email: string;
  phone: string;
  website: string;
}
export interface FinancialSettings {
  gstNumber: string;
  defaultGstRate: number;
  currency: string;
  invoiceNumberFormat: string; // tokens: {YYYY} {YY} {MM} {RAND}
}
export interface BookingSettings {
  bookingWindowDays: number; // max advance window
  checkInTime: string;
  checkOutTime: string;
}
export interface PortalSettings {
  maintenanceMode: boolean;
  termsUrl: string;
  privacyUrl: string;
}
export interface SecuritySettings {
  mfaEnabled: boolean; // master switch — when false, MFA is never required
  enforceAdmin: boolean; // require MFA for ADMIN + VERIFIER
  enforceAgency: boolean; // require MFA for AGENCY principals
  enforceAgent: boolean; // require MFA for AGENT sub-users
}

export interface AllSettings {
  company: CompanySettings;
  financial: FinancialSettings;
  booking: BookingSettings;
  portal: PortalSettings;
  security: SecuritySettings;
}

export type SettingsGroup = keyof AllSettings;

const DEFAULTS: AllSettings = {
  // GSTIN/phone/URLs default EMPTY — never ship fabricated identifiers. The
  // admin fills the real values in System Settings; documents and UI skip
  // empty fields.
  company: {
    name: 'Parakkat Resorts & Holidays',
    addressLine1: 'Parakkat Nature Resort',
    addressLine2: 'Munnar, Idukki, Kerala 685612, India',
    gstin: '',
    email: 'support@parakkatjewels.com',
    phone: '',
    website: '',
  },
  financial: {
    gstNumber: '',
    defaultGstRate: 18,
    currency: 'INR',
    invoiceNumberFormat: 'INV-{YYYY}{MM}-{RAND}',
  },
  booking: {
    bookingWindowDays: env.BOOKING_MAX_ADVANCE_DAYS,
    checkInTime: '2:00 PM',
    checkOutTime: '11:00 AM',
  },
  portal: {
    maintenanceMode: false,
    termsUrl: '',
    privacyUrl: '',
  },
  // Safe baseline: master switch off ⇒ password-only logins (demo-friendly), and
  // every per-role enforcement starts OFF so turning the master switch on never
  // force-enrols a role by surprise — the admin opts each role in from the
  // Security page. (env MFA_* flags remain as a deployment-level fallback.)
  security: {
    mfaEnabled: !env.MFA_DISABLED,
    enforceAdmin: false,
    enforceAgency: false,
    enforceAgent: false,
  },
};

// In-process cache; a shallow copy of DEFAULTS until loadSettings() runs.
let cache: AllSettings = structuredClone(DEFAULTS);
let loaded = false;

/** Push settings-derived values into the subsystems that consume them. */
function applySideEffects(): void {
  const c = cache.company;
  setCompanyProfileOverride({
    name: c.name,
    addressLines: [c.addressLine1, c.addressLine2].filter(Boolean),
    gstin: c.gstin,
    email: c.email,
    phone: c.phone,
    website: c.website,
  });
}

/** Load persisted overrides from the DB into the cache (called once at startup). */
export async function loadSettings(): Promise<void> {
  try {
    const rows = await prisma.systemSetting.findMany();
    const next = structuredClone(DEFAULTS);
    for (const row of rows) {
      const group = row.key as SettingsGroup;
      if (group in next) {
        Object.assign(next[group], row.value as Record<string, unknown>);
      }
    }
    cache = next;
    loaded = true;
    applySideEffects();
    logger.info('[settings] loaded', { groups: rows.map((r) => r.key) });
  } catch (err) {
    logger.error('[settings] load failed; using defaults', { err: (err as Error).message });
    applySideEffects();
  }
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadSettings();
}

export async function getAllSettings(): Promise<AllSettings> {
  await ensureLoaded();
  return structuredClone(cache);
}

export async function updateGroup<G extends SettingsGroup>(
  group: G,
  patch: Partial<AllSettings[G]>,
  actor: { actorId: string; actorRole: ActorRole },
): Promise<AllSettings[G]> {
  await ensureLoaded();
  const before = structuredClone(cache[group]);
  const merged = { ...cache[group], ...patch } as AllSettings[G];
  const value = merged as unknown as Prisma.InputJsonObject;
  await prisma.systemSetting.upsert({
    where: { key: group },
    create: { key: group, value },
    update: { value },
  });
  cache[group] = merged;
  applySideEffects();
  await recordAuditLogSafe({
    entityType: 'SystemSetting',
    entityId: group,
    event: 'SETTINGS_UPDATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: before as unknown as Prisma.InputJsonObject,
    after: merged as unknown as Prisma.InputJsonObject,
  });
  return merged;
}

// --- synchronous accessors for hot paths -------------------------------------

export const isMaintenanceMode = (): boolean => cache.portal.maintenanceMode;
export const getBookingWindowDays = (): number => cache.booking.bookingWindowDays;
export const getCheckInOutTimes = (): { checkIn: string; checkOut: string } => ({
  checkIn: cache.booking.checkInTime,
  checkOut: cache.booking.checkOutTime,
});
export const getInvoiceNumberFormat = (): string => cache.financial.invoiceNumberFormat;
export const getMfaPolicy = (): SecuritySettings => cache.security;
