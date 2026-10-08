import { loadSettings } from '../../src/modules/settings/settings.service';
import { testPrisma } from './testDb';

/**
 * Per-role MFA enforcement starts OFF (admins opt roles in from System Settings → Security), so
 * tests about mandatory MFA switch it on for staff the same way: through the stored setting.
 */
export async function enforceStaffMfa(): Promise<void> {
  const value = { mfaEnabled: true, enforceAdmin: true, enforceAgency: false, enforceAgent: false };
  await testPrisma.systemSetting.upsert({ where: { key: 'security' }, create: { key: 'security', value }, update: { value } });
  await loadSettings();
}

/** Back to the shipped defaults, so later tests in the same process are unaffected. */
export async function resetMfaPolicy(): Promise<void> {
  await testPrisma.systemSetting.deleteMany({ where: { key: 'security' } });
  await loadSettings();
}
