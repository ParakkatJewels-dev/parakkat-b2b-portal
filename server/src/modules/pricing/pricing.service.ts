import type { RatePlanCode } from '@prisma/client';
import { ApiError } from '../../utils/apiError';
import type { OccupancyConfig, RoomTypeRates } from '../../lib/inventory/inventory.types';

/**
 * v4 §1 — server-side room-charge composition. Rate plans, per-date net rates,
 * occupancy and restrictions all come from CRS (the source of truth); the
 * portal's ONLY pricing responsibility is applying the agency's markup. The
 * customer price is never computed or stored, and a client-supplied price is never
 * trusted — every booking recomputes here.
 *
 *   room charge = Σ per-night net rate + (extra-adult + child + extra-bed) × nights
 *   agency price = room charge total × (1 + markup%)   (D10: single markup on total)
 */

export interface Occupancy {
  adults: number;
  children: number;
  extraBeds: number;
  // v3 §2.2 — ages of the children in the room; when present, drives age-band
  // pricing and overrides `children` as the child count.
  childAges?: number[];
}

// v3 §2.2 — a child age band: inclusive [minAge, maxAge] → per-night charge.
export interface ChildBand {
  minAge: number;
  maxAge: number;
  charge: number;
}

export interface RoomPricingConfig {
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdultCharge: number;
  childCharge: number;
  extraBedCharge: number;
  childBands?: ChildBand[];
}

/** v3 §2.2 — per-night charge for one child by age (first matching band; none → free). */
function childCharge(age: number, bands: ChildBand[], flat: number): number {
  if (!bands.length) return flat;
  const band = bands.find((b) => age >= b.minAge && age <= b.maxAge);
  return band ? band.charge : 0;
}

export interface ComposedCharge {
  plan: RatePlanCode;
  nights: number;
  occupancy: { adults: number; children: number; extraBeds: number; baseOccupancy: number; childAges?: number[] };
  perNight: {
    base: number;
    extraAdults: number;
    extraAdultAmount: number;
    childAmount: number;
    extraBedAmount: number;
    total: number;
  };
  roomChargeTotal: number; // pre-markup, across the stay
  markupPct: number;
  agencyPrice: number; // post-markup
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * B2B resale layer — the agent's customer-facing sell price: the agency's buy
 * price plus the agent's own markup. Profit = sellPrice − agencyPrice.
 */
export function applyResaleMarkup(agencyPrice: number, resaleMarkupPct: number): number {
  if (!Number.isFinite(resaleMarkupPct) || resaleMarkupPct < 0) return round2(agencyPrice);
  return round2(agencyPrice * (1 + resaleMarkupPct / 100));
}

const toPricingConfig = (o: OccupancyConfig): RoomPricingConfig => ({
  baseOccupancy: o.baseOccupancy,
  maxAdults: o.maxAdults,
  maxChildren: o.maxChildren,
  maxOccupancy: o.maxOccupancy,
  extraAdultCharge: o.extraAdultCharge,
  childCharge: o.childCharge,
  extraBedCharge: o.extraBedCharge,
  childBands: o.childBands,
});

/** Validates occupancy against the room config and computes the per-occupancy extras. */
function computeExtras(cfg: RoomPricingConfig, occ: Occupancy) {
  const childAges = occ.childAges;
  const children = childAges ? childAges.length : occ.children;
  if (occ.adults < 1) throw ApiError.badRequest('At least one adult is required');
  if (occ.extraBeds < 0 || children < 0) throw ApiError.badRequest('Invalid occupancy');
  if (childAges && childAges.some((a) => a < 0 || a > 17)) throw ApiError.badRequest('Child ages must be between 0 and 17');
  if (occ.adults > cfg.maxAdults) throw ApiError.badRequest(`This room allows at most ${cfg.maxAdults} adults`);
  if (children > cfg.maxChildren) throw ApiError.badRequest(`This room allows at most ${cfg.maxChildren} children`);
  if (occ.adults + children + occ.extraBeds > cfg.maxOccupancy) {
    throw ApiError.badRequest(`This room's maximum occupancy is ${cfg.maxOccupancy}`);
  }
  const bands = cfg.childBands ?? [];
  const extraAdults = Math.max(0, occ.adults - cfg.baseOccupancy);
  const extraAdultAmount = round2(extraAdults * cfg.extraAdultCharge);
  const childAmount = childAges
    ? round2(childAges.reduce((sum, age) => sum + childCharge(age, bands, cfg.childCharge), 0))
    : round2(children * cfg.childCharge);
  const extraBedAmount = round2(occ.extraBeds * cfg.extraBedCharge);
  return { children, extraAdults, extraAdultAmount, childAmount, extraBedAmount, perNightExtras: round2(extraAdultAmount + childAmount + extraBedAmount) };
}

/**
 * Compose a charge from CRS per-night net rates. Base varies by date; the
 * occupancy extras are per-night flat. Markup is applied once on the stay total.
 */
export function composeFromNightly(
  nightlyRates: number[],
  plan: RatePlanCode,
  cfg: RoomPricingConfig,
  occ: Occupancy,
  markupPct: number,
): ComposedCharge {
  const nights = nightlyRates.length;
  if (nights <= 0) throw ApiError.badRequest('Check-out must be after check-in');

  const e = computeExtras(cfg, occ);
  const baseSum = round2(nightlyRates.reduce((s, r) => s + r, 0));
  const roomChargeTotal = round2(baseSum + e.perNightExtras * nights);
  const avgBase = round2(baseSum / nights);
  const agencyPrice = round2(roomChargeTotal * (1 + markupPct / 100));

  return {
    plan,
    nights,
    occupancy: { adults: occ.adults, children: e.children, extraBeds: occ.extraBeds, baseOccupancy: cfg.baseOccupancy, childAges: occ.childAges },
    perNight: { base: avgBase, extraAdults: e.extraAdults, extraAdultAmount: e.extraAdultAmount, childAmount: e.childAmount, extraBedAmount: e.extraBedAmount, total: round2(avgBase + e.perNightExtras) },
    roomChargeTotal,
    markupPct,
    agencyPrice,
  };
}

const nightlyFor = (rates: RoomTypeRates, plan: RatePlanCode): number[] | null => {
  const rp = rates.ratePlans.find((p) => p.plan === plan);
  return rp ? rp.dailyRates.map((d) => d.rate) : null;
};

/** Price one plan for a room from CRS rates (booking commit). Throws if the plan/occupancy is invalid. */
export function priceRoomFromAxis(rates: RoomTypeRates, plan: RatePlanCode, occupancy: Occupancy, markupPct: number): ComposedCharge {
  const nightly = nightlyFor(rates, plan);
  if (!nightly) throw ApiError.badRequest(`Rate plan ${plan} is not available for these dates`);
  return composeFromNightly(nightly, plan, toPricingConfig(rates.occupancy), occupancy, markupPct);
}

/** Price every available plan for a room from CRS rates (search view). Invalid plans/occupancy are skipped. */
export function pricePlansFromAxis(rates: RoomTypeRates, occupancy: Occupancy, markupPct: number): ComposedCharge[] {
  const out: ComposedCharge[] = [];
  for (const rp of rates.ratePlans) {
    try {
      out.push(composeFromNightly(rp.dailyRates.map((d) => d.rate), rp.plan, toPricingConfig(rates.occupancy), occupancy, markupPct));
    } catch {
      // occupancy invalid for this room/plan → skip
    }
  }
  return out.sort((a, b) => a.agencyPrice - b.agencyPrice);
}

/**
 * v4 §1 — price a same-day DAY_USE booking from the CRS day-use rate. A single
 * use charge (not per-night); occupancy extras apply once. `nights` is 0. Day-use is
 * plan-agnostic (recorded as EP) — meal plans don't apply to a same-day slot.
 */
export function priceDayUseFromAxis(rates: RoomTypeRates, occupancy: Occupancy, markupPct: number): ComposedCharge {
  if (!rates.dayUse?.available) throw ApiError.badRequest('Day-use is not available for this room on the selected date');
  const cfg = toPricingConfig(rates.occupancy);
  const e = computeExtras(cfg, occupancy);
  const base = round2(rates.dayUse.ratePerUse);
  const roomChargeTotal = round2(base + e.perNightExtras);
  const agencyPrice = round2(roomChargeTotal * (1 + markupPct / 100));
  return {
    plan: 'EP',
    nights: 0,
    occupancy: { adults: occupancy.adults, children: e.children, extraBeds: occupancy.extraBeds, baseOccupancy: cfg.baseOccupancy, childAges: occupancy.childAges },
    perNight: { base, extraAdults: e.extraAdults, extraAdultAmount: e.extraAdultAmount, childAmount: e.childAmount, extraBedAmount: e.extraBedAmount, total: roomChargeTotal },
    roomChargeTotal,
    markupPct,
    agencyPrice,
  };
}
