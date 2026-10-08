import type { CompanyProfile } from '../lib/pdf/pdf';

/**
 * Canonical company/supplier identity used on generated documents (invoices,
 * vouchers, statements). Defaults live here; the System Settings store overrides
 * them at runtime via {@link setCompanyProfileOverride} so admins can edit the
 * company profile without a redeploy.
 */
const DEFAULT_COMPANY: CompanyProfile = {
  name: 'Parakkat Resorts & Holidays',
  addressLines: ['Parakkat Nature Resort', 'Munnar, Idukki, Kerala 685612, India'],
  // GSTIN and phone intentionally EMPTY by default: never print a fabricated
  // tax number or contact on real documents. Admins set the real values in
  // System Settings; PDF rendering skips empty fields.
  gstin: '',
  email: 'support@parakkatjewels.com',
  phone: '',
  website: '',
};

let override: Partial<CompanyProfile> = {};

export function getCompanyProfile(): CompanyProfile {
  return { ...DEFAULT_COMPANY, ...override };
}

/** Merge persisted System-Settings values over the defaults. */
export function setCompanyProfileOverride(patch: Partial<CompanyProfile>): void {
  override = { ...override, ...patch };
}
