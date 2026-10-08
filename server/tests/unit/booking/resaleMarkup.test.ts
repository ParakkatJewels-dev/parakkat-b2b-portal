import { describe, expect, it } from 'vitest';
import { applyResaleMarkup } from '../../../src/modules/pricing/pricing.service';

/**
 * B2B resale layer — sell price = agency buy price × (1 + agent markup %).
 * The agent pays the agency price; their customer pays the sell price; the
 * difference is the agent's profit.
 */
describe('applyResaleMarkup', () => {
  it('adds the agent markup on top of the agency price', () => {
    // Buy at 4950 (net 4500 + 10% admin markup), resell at 15% → 5692.50
    expect(applyResaleMarkup(4950, 15)).toBe(5692.5);
  });

  it('zero markup means sell price equals buy price (no profit)', () => {
    expect(applyResaleMarkup(4950, 0)).toBe(4950);
  });

  it('rounds to two decimals', () => {
    // 1000.01 × 1.125 = 1125.011… → 1125.01
    expect(applyResaleMarkup(1000.01, 12.5)).toBe(1125.01);
  });

  it('treats negative or invalid markup as zero (defensive)', () => {
    expect(applyResaleMarkup(4950, -10)).toBe(4950);
    expect(applyResaleMarkup(4950, Number.NaN)).toBe(4950);
  });

  it('supports fractional percentages', () => {
    expect(applyResaleMarkup(10000, 7.5)).toBe(10750);
  });

  it('profit is the difference between sell and buy price', () => {
    const buy = 12870;
    const sell = applyResaleMarkup(buy, 20);
    expect(sell - buy).toBeCloseTo(2574, 2);
  });
});
