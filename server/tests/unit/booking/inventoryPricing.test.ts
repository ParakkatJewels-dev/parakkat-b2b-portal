import { describe, expect, it } from 'vitest';
import { composeFromNightly, priceRoomFromAxis, pricePlansFromAxis, priceDayUseFromAxis } from '../../../src/modules/pricing/pricing.service';
import type { RoomTypeRates } from '../../../src/lib/inventory/inventory.types';

const cfg = {
  baseOccupancy: 2,
  maxAdults: 3,
  maxChildren: 2,
  maxOccupancy: 4,
  extraAdultCharge: 1350, // 30% of 4500
  childCharge: 675,
  extraBedCharge: 900,
};

const occ2 = { adults: 2, children: 0, extraBeds: 0 };

describe('composeFromNightly (CRS-sourced pricing)', () => {
  it('sums per-date net rates and applies a single markup', () => {
    // spec example: 4500 base × 1 night, 10% → 4950
    const c = composeFromNightly([4500], 'EP', cfg, occ2, 10);
    expect(c.roomChargeTotal).toBe(4500);
    expect(c.agencyPrice).toBe(4950);
    expect(c.nights).toBe(1);
  });

  it('honours rates that vary by night (weekend uplift)', () => {
    // Fri 4500 + Sat 5175 = 9675 net; 8% markup → 10449
    const c = composeFromNightly([4500, 5175], 'EP', cfg, occ2, 8);
    expect(c.roomChargeTotal).toBe(9675);
    expect(c.agencyPrice).toBe(10449);
  });

  it('adds per-night occupancy extras before markup', () => {
    // 2 nights @ 4500 = 9000 base + extra adult 1350/night × 2 = 2700 → 11700; 10% → 12870
    const c = composeFromNightly([4500, 4500], 'EP', cfg, { adults: 3, children: 0, extraBeds: 0 }, 10);
    expect(c.roomChargeTotal).toBe(11700);
    expect(c.agencyPrice).toBe(12870);
  });

  it('rejects occupancy above the room maximum', () => {
    expect(() => composeFromNightly([4500], 'EP', cfg, { adults: 4, children: 0, extraBeds: 0 }, 10)).toThrow();
  });
});

const rates: RoomTypeRates = {
  roomTypeId: 'goa-deluxe',
  roomTypeName: 'Deluxe Sea View',
  occupancy: cfg,
  ratePlans: [
    { plan: 'EP', dailyRates: [{ date: '2026-08-01', rate: 4500 }, { date: '2026-08-02', rate: 4500 }] },
    { plan: 'CP', dailyRates: [{ date: '2026-08-01', rate: 4950 }, { date: '2026-08-02', rate: 4950 }] },
  ],
  restrictions: { minNights: 1, closedToArrival: false, closedToDeparture: false, stopSell: false },
};

describe('priceRoomFromAxis / pricePlansFromAxis', () => {
  it('prices the requested plan from its per-date rates', () => {
    const c = priceRoomFromAxis(rates, 'CP', occ2, 0);
    expect(c.plan).toBe('CP');
    expect(c.roomChargeTotal).toBe(9900); // 4950 × 2
  });

  it('throws when the plan is not offered for the dates', () => {
    expect(() => priceRoomFromAxis(rates, 'AP', occ2, 0)).toThrow();
  });

  it('prices every plan and sorts cheapest first', () => {
    const all = pricePlansFromAxis(rates, occ2, 10);
    expect(all.map((c) => c.plan)).toEqual(['EP', 'CP']);
    expect(all[0].agencyPrice).toBeLessThan(all[1].agencyPrice);
  });
});

describe('priceDayUseFromAxis', () => {
  const dayUseRates: RoomTypeRates = {
    ...rates,
    dayUse: { available: true, ratePerUse: 2250, earliestStart: '09:00', latestEnd: '18:00' },
  };

  it('prices a same-day use as a single charge (nights = 0) with markup', () => {
    const c = priceDayUseFromAxis(dayUseRates, occ2, 10);
    expect(c.nights).toBe(0);
    expect(c.roomChargeTotal).toBe(2250);
    expect(c.agencyPrice).toBe(2475); // 2250 × 1.10
  });

  it('adds occupancy extras once (not per night)', () => {
    const c = priceDayUseFromAxis(dayUseRates, { adults: 3, children: 0, extraBeds: 0 }, 0);
    expect(c.roomChargeTotal).toBe(3600); // 2250 + 1350 extra adult, once
  });

  it('throws when the room has no day-use option', () => {
    expect(() => priceDayUseFromAxis(rates, occ2, 10)).toThrow();
  });
});
