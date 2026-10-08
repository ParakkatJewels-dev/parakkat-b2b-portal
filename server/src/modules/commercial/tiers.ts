import type { PaymentMode } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

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

const CONFIG_DIR = path.resolve(__dirname, '../../../.data');
const CONFIG_FILE = path.resolve(CONFIG_DIR, 'tiers.config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

let cached: Record<string, TierPreset> | undefined;

export function getTiers(): Record<string, TierPreset> {
  if (cached) return cached;

  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      cached = JSON.parse(content) as Record<string, TierPreset>;
      return cached!;
    } catch (err) {
      logger.error('Failed to parse tiers.config.json; falling back to defaults', err);
    }
  }

  cached = { ...DEFAULT_TIERS };
  if (env.TIERS_CONFIG_JSON) {
    try {
      const parsed = JSON.parse(env.TIERS_CONFIG_JSON) as Record<string, TierPreset>;
      cached = { ...cached, ...parsed };
    } catch {
      logger.error('TIERS_CONFIG_JSON is not valid JSON; using built-in tier presets');
    }
  }
  return cached!;
}

export function saveTiers(tiers: Record<string, TierPreset>): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(tiers, null, 2), 'utf8');
  cached = tiers;
}

export function getTierPreset(tier: string): TierPreset | undefined {
  return getTiers()[tier.toUpperCase()];
}

export function listTierNames(): string[] {
  return Object.keys(getTiers());
}
