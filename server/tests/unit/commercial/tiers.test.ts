import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTierPreset,
  getTiers,
  listTierNames,
  saveTiers,
  setStoredTiers,
  TIER_PRESETS_SETTING,
} from '../../../src/modules/commercial/tiers';

const upsert = vi.fn();
vi.mock('../../../src/lib/prisma', () => ({ prisma: { systemSetting: { upsert: (...args: unknown[]) => upsert(...args) } } }));
vi.mock('../../../src/modules/audit/audit.service', () => ({ recordAuditLogSafe: vi.fn() }));

describe('tier presets', () => {
  afterEach(() => {
    setStoredTiers(undefined);
    upsert.mockReset();
  });

  it('exposes the built-in tiers A, B, C', () => {
    const names = listTierNames();
    expect(names).toContain('A');
    expect(names).toContain('B');
    expect(names).toContain('C');
  });

  it('is case-insensitive on tier name', () => {
    expect(getTierPreset('a')).toEqual(getTierPreset('A'));
  });

  it('C tier is prepay with a zero credit limit', () => {
    const prepaid = getTierPreset('C');
    expect(prepaid?.paymentMode).toBe('PREPAY');
    expect(prepaid?.creditLimit).toBe(0);
  });

  it('returns undefined for an unknown tier', () => {
    expect(getTierPreset('NOPE')).toBeUndefined();
  });

  it('saves edited tiers to the database and serves them', async () => {
    const original = getTiers();
    const updated = { ...original, A: { ...original.A, creditLimit: 5000000 } };
    await saveTiers(updated, { actorId: 'admin-1', actorRole: 'ADMIN' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: TIER_PRESETS_SETTING } }));
    expect(getTierPreset('A')?.creditLimit).toBe(5000000);
  });

  it('serves presets loaded from the database and falls back to the defaults', () => {
    setStoredTiers({ A: { paymentMode: 'PREPAY', creditLimit: 0, paymentTerms: 'prepaid', markupPct: 20 } });
    expect(getTierPreset('A')?.markupPct).toBe(20);
    setStoredTiers(undefined);
    expect(getTierPreset('A')?.markupPct).toBe(8);
  });
});
