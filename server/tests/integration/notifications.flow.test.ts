import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VerificationCheckType } from '@prisma/client';
import { createApp } from '../../src/app';
import { signDigioBody } from '../../src/lib/digio/signature';
import { MANDATORY_CHECKS } from '../../src/lib/digio';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

const app = createApp();

const completeDraft = {
  legalName: 'Acme Travels Pvt Ltd',
  gstin: '27AABCU9603R1ZM',
  pan: 'AABCU9603R',
  addressLine1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'India',
  businessContactEmail: 'ops@acmetravels.example',
  businessContactPhone: '9876543210',
  repName: 'Priya Sharma',
  repDesignation: 'Director',
  repEmail: 'priya@acmetravels.example',
  repMobile: '9876543211',
  repAadhaarRef: 'aadhaar-ref-token-123',
  bankAccount: '000123456789',
  ifsc: 'HDFC0001234',
  accountHolder: 'Acme Travels Pvt Ltd',
};

async function notificationEvents(entityId: string): Promise<string[]> {
  const rows = await testPrisma.auditLog.findMany({
    where: { entityId, event: 'NOTIFICATION_SENT' },
  });
  return rows.map((r) => (r.after as { notification: string }).notification);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('notifications are emitted and audit-logged', () => {
  it('sends registration + verification-started notifications on submit', async () => {
    const create = await request(app).post('/api/onboarding/applications').send(completeDraft);
    const applicationId = create.body.applicationId as string;
    await request(app)
      .post(`/api/onboarding/applications/${applicationId}/submit`)
      .set('x-resume-token', create.body.resumeToken);

    const events = await notificationEvents(applicationId);
    expect(events).toContain('REGISTRATION_RECEIVED');
    expect(events).toContain('VERIFICATION_STARTED');

    // Every NOTIFICATION_SENT row records the channels used and a masked recipient.
    const row = await testPrisma.auditLog.findFirst({
      where: { entityId: applicationId, event: 'NOTIFICATION_SENT' },
    });
    const after = row?.after as { channels: string[]; to: string };
    expect(after.channels).toContain('email');
    expect(after.to).toContain('@');
    expect(after.to).not.toBe('ops@acmetravels.example'); // masked
  });

  it('sends an approval notification when a verifier approves', async () => {
    const create = await request(app).post('/api/onboarding/applications').send(completeDraft);
    const applicationId = create.body.applicationId as string;
    await request(app)
      .post(`/api/onboarding/applications/${applicationId}/submit`)
      .set('x-resume-token', create.body.resumeToken);
    for (const checkType of MANDATORY_CHECKS as VerificationCheckType[]) {
      const v = await testPrisma.verification.findFirstOrThrow({ where: { applicationId, checkType } });
      const raw = JSON.stringify({ providerRef: v.providerRef, status: 'passed' });
      await request(app)
        .post('/api/webhooks/digio')
        .set('Content-Type', 'application/json')
        .set('x-digio-signature', signDigioBody(raw))
        .send(raw);
    }

    const verifier = await testPrisma.user.create({
      data: { email: 'verifier-notif@example.com', passwordHash: await hashPassword('Pass!23456'), role: 'VERIFIER' },
    });
    const token = await tokenFor({ id: verifier.id, role: verifier.role, agencyId: null, mfaVerified: true });

    await request(app)
      .post(`/api/applications/${applicationId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(await notificationEvents(applicationId)).toContain('APPLICATION_APPROVED');
  });
});
