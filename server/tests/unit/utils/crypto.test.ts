import { describe, expect, it } from 'vitest';
import { generateNumericOtp, sha256Hex, timingSafeEqual } from '../../../src/utils/crypto';

describe('crypto utils', () => {
  it('sha256Hex is deterministic', () => {
    expect(sha256Hex('hello')).toEqual(sha256Hex('hello'));
    expect(sha256Hex('hello')).not.toEqual(sha256Hex('world'));
  });

  it('timingSafeEqual compares correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('generateNumericOtp produces a code of the requested length', () => {
    const code = generateNumericOtp(6);
    expect(code).toMatch(/^\d{6}$/);
  });
});
