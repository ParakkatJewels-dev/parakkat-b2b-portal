import { afterEach, describe, expect, it } from 'vitest';
import { getCompanyProfile, setCompanyProfileOverride } from '../../../src/config/company';

// getCompanyProfile merges a runtime override (from System Settings) over the
// code defaults — the source of the company header on generated PDFs.
describe('company profile', () => {
  const original = getCompanyProfile();
  afterEach(() => setCompanyProfileOverride(original)); // restore between tests

  it('returns sensible defaults', () => {
    const p = getCompanyProfile();
    expect(p.name).toContain('Parakkat');
    // Identity fields with no real value default EMPTY (never a fabricated
    // GSTIN/phone) — admins supply the real ones via System Settings.
    expect(p.gstin).toBe('');
    expect(p.phone).toBe('');
    expect(Array.isArray(p.addressLines)).toBe(true);
    expect(p.addressLines.length).toBeGreaterThan(0);
  });

  it('applies an override and leaves untouched fields at their default', () => {
    setCompanyProfileOverride({ name: 'ACME Test Co' });
    const p = getCompanyProfile();
    expect(p.name).toBe('ACME Test Co');
    expect(p.gstin).toBe(original.gstin); // unchanged
  });

  it('merges successive overrides rather than replacing the whole profile', () => {
    setCompanyProfileOverride({ name: 'One' });
    setCompanyProfileOverride({ email: 'ops@example.com' });
    const p = getCompanyProfile();
    expect(p.name).toBe('One');
    expect(p.email).toBe('ops@example.com');
  });
});
