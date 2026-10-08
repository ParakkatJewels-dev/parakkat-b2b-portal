import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  businessDateString,
  businessToday,
  businessYearMonth,
  calendarDay,
  startOfBusinessDay,
} from '../../../src/utils/businessDate';
import { validateStayDates } from '../../../src/modules/booking/dates';

describe('business dates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a calendar day as UTC midnight, whatever the server timezone', () => {
    expect(calendarDay('2026-11-10')?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });

  it('rejects malformed and impossible days', () => {
    expect(calendarDay('2026-11-1')).toBeNull();
    expect(calendarDay('2026-02-30')).toBeNull();
    expect(calendarDay('not-a-date')).toBeNull();
  });

  it("uses India's date: 20:00 UTC on 9 Nov is already 10 Nov", () => {
    const at = new Date('2026-11-09T20:00:00Z');
    expect(businessDateString(at)).toBe('2026-11-10');
    expect(startOfBusinessDay(at).toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(businessYearMonth(new Date('2026-10-31T19:00:00Z'))).toEqual({ yyyy: '2026', mm: '11' });
  });

  it('keeps the stay dates a user picked', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T06:00:00Z'));
    const stay = validateStayDates('2026-11-10', '2026-11-12');
    expect(stay.checkIn.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(stay.checkOut.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(stay.nights).toBe(2);
  });

  it("refuses India's yesterday even while it is still that date in UTC", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T20:00:00Z')); // 01:30 on 10 Nov in India
    expect(businessToday().toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(() => validateStayDates('2026-11-09', '2026-11-11')).toThrow(/past/);
    expect(validateStayDates('2026-11-10', '2026-11-11').nights).toBe(1);
  });
});
