import type { ActorRole, PaymentMode, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { recordAuditLogSafe } from '../audit/audit.service';

export interface TierPreset {
  paymentMode: PaymentMode;
  creditLimit: number;
  paymentTerms: string;
  markupPct: number;
}

// Built-in defaults. Overridable via TIERS_CONFIG_JSON (§16 — presets are
// configuration, not hardcoded business rules). A prepay tier always implies
// an effective credit limit of ₹0.
// Markup % is the portal's hike on the CRS net rate. Top-tier partners get
// the keenest price (lowest markup); it rises down the tiers. This is the per-tier
// *default* — admins can override markupPct per agency ("personal bias").
const DEFAULT_TIERS: Record<string, TierPreset> = {
  A: { paymentMode: 'CREDIT', creditLimit: 99999999, paymentTerms: 'net 7', markupPct: 8 },
  B: { paymentMode: 'CREDIT', creditLimit: 200000, paymentTerms: 'net 4', markupPct: 12 },
  C: { paymentMode: 'PREPAY', creditLimit: 0, paymentTerms: 'prepaid', markupPct: 15 },
};

/**
 * The SystemSetting row holding the admin-edited presets — the whole map, replacing the defaults.
 * Kept in the database rather than on disk: serverless instances have no durable, shared filesystem.
 */
export const TIER_PRESETS_SETTING = 'tierPresets';

let configured: Record<string, TierPreset> | undefined;
let stored: Record<string, TierPreset> | undefined;

function configuredDefaults(): Record<string, TierPreset> {
  if (configured) return configured;
  configured = { ...DEFAULT_TIERS };
  if (env.TIERS_CONFIG_JSON) {
    try {
      configured = { ...configured, ...(JSON.parse(env.TIERS_CONFIG_JSON) as Record<string, TierPreset>) };
    } catch {
      logger.error('TIERS_CONFIG_JSON is not valid JSON; using built-in tier presets');
    }
  }
  return configured;
}

/** Called by the settings loader with the persisted presets (undefined when none are saved). */
export function setStoredTiers(value: unknown): void {
  stored =
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
      ? (value as Record<string, TierPreset>)
      : undefined;
}

export function getTiers(): Record<string, TierPreset> {
  return stored ?? configuredDefaults();
}

export async function saveTiers(
  tiers: Record<string, TierPreset>,
  actor: { actorId: string; actorRole: ActorRole },
): Promise<void> {
  const before = getTiers();
  const value = tiers as unknown as Prisma.InputJsonObject;
  await prisma.systemSetting.upsert({
    where: { key: TIER_PRESETS_SETTING },
    create: { key: TIER_PRESETS_SETTING, value },
    update: { value },
  });
  stored = tiers;
  await recordAuditLogSafe({
    entityType: 'SystemSetting',
    entityId: TIER_PRESETS_SETTING,
    event: 'SETTINGS_UPDATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: before as unknown as Prisma.InputJsonObject,
    after: value,
  });
}

export function getTierPreset(tier: string): TierPreset | undefined {
  return getTiers()[tier.toUpperCase()];
}

export function listTierNames(): string[] {
  return Object.keys(getTiers());
}
