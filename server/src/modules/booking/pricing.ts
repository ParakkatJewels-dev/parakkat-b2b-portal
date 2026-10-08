/**
 * Agency-price computation (Instructions.md §9). Three price levels exist; the
 * portal records only the middle one (agency price) and NEVER the customer
 * price. Computed server-side — a client-supplied price is never trusted.
 *
 *   base rate         → per-night rate from CRS (Decision D1)
 *   agency price      = base × (1 + markup%)   ← displayed, booked, owed
 *   customer price    → out of scope, never stored
 */

export interface PriceBreakdown {
  nights: number;
  baseRatePerNight: number;
  /** base rate × nights */
  baseTotal: number;
  markupPct: number;
  /** baseTotal × (1 + markup%), rounded to 2 dp */
  agencyPrice: number;
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeAgencyPrice(
  baseRatePerNight: number,
  nights: number,
  markupPct: number,
): PriceBreakdown {
  if (nights <= 0) {
    throw new Error('Stay must be at least one night');
  }
  const baseTotal = round2(baseRatePerNight * nights);
  const agencyPrice = round2(baseTotal * (1 + markupPct / 100));
  return { nights, baseRatePerNight, baseTotal, markupPct, agencyPrice };
}
