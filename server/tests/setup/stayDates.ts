import { businessDateString } from '../../src/utils/businessDate';

/**
 * A two-night Monday→Wednesday stay starting at least `minDaysAhead` days after today in India, so
 * tests never age out and always price at the inventory mock's weekday rates.
 */
export function weekdayStay(minDaysAhead: number): { checkIn: string; checkOut: string } {
  const day = new Date(`${businessDateString()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + minDaysAhead);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7)); // forward to Monday
  const checkIn = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 2);
  return { checkIn, checkOut: day.toISOString().slice(0, 10) };
}
