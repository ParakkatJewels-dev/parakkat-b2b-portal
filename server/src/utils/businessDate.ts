/**
 * Calendar-day helpers that do not depend on the server's timezone.
 *
 * Stay dates (check-in, check-out, inventory ranges) are calendar days, stored as UTC midnight of
 * that day — the same value `new Date('YYYY-MM-DD')` gives and `toISOString().slice(0, 10)` reads
 * back. "Today" is the resorts' local date (India), so a check-in cannot be yesterday in India just
 * because the server runs in UTC.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

const ymdFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The business's local date for an instant, as YYYY-MM-DD. */
export function businessDateString(at: Date = new Date()): string {
  return ymdFormat.format(at);
}

/** A YYYY-MM-DD calendar day as UTC midnight; null if it is not a real date. */
export function calendarDay(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd ? null : d;
}

/** Today's business date as a calendar day (UTC midnight) — compare with stay dates. */
export function businessToday(): Date {
  return calendarDay(businessDateString())!;
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far the business timezone's wall clock is ahead of UTC at an instant, in ms. */
function zoneOffsetMs(at: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the business day began (midnight in India) — compare with timestamps like createdAt. */
export function startOfBusinessDay(at: Date = new Date()): Date {
  const day = calendarDay(businessDateString(at))!;
  return new Date(day.getTime() - zoneOffsetMs(day));
}

/** The business's local year and month, for document numbers. */
export function businessYearMonth(at: Date = new Date()): { yyyy: string; mm: string } {
  const [yyyy, mm] = businessDateString(at).split('-');
  return { yyyy, mm };
}
