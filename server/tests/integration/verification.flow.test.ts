import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VerificationCheckType } from '@prisma/client';
import { createApp } from '../../src/app';
import { signDigioBody } from '../../src/lib/digio/signature';
import { MANDATORY_CHECKS } from '../../src/lib/digio';
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

async function submitApplication(): Promise<string> {
  const create = await request(app).post('/api/onboarding/applications').send(completeDraft);
  await request(app)
    .post(`/api/onboarding/applications/${create.body.applicationId}/submit`)
    .set('x-resume-token', create.body.resumeToken);
  return create.body.applicationId;
}

/** Posts a correctly-signed Digio webhook for a provider ref. */
async function postWebhook(providerRef: string, status: 'passed' | 'failed' | 'manual_review') {
  const raw = JSON.stringify({ providerRef, status });
  const signature = signDigioBody(raw);
  return request(app)
    .post('/api/webhooks/digio')
    .set('Content-Type', 'application/json')
    .set('x-digio-signature', signature)
    .send(raw);
}

async function providerRefFor(applicationId: string, checkType: VerificationCheckType): Promise<string> {
  const v = await testPrisma.verification.findFirstOrThrow({ where: { applicationId, checkType } });
  return v.providerRef!;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('verification pipeline', () => {
  it('initiates all mandatory checks on submit (status IN_PROGRESS)', async () => {
    const applicationId = await submitApplication();
    const verifications = await testPrisma.verification.findMany({ where: { applicationId } });
    expect(verifications).toHaveLength(MANDATORY_CHECKS.length);
    expect(verifications.every((v) => v.status === 'IN_PROGRESS')).toBe(true);
    expect(verifications.every((v) => v.providerRef)).toBe(true);
  });

  it('auto-progresses to REVIEW after all checks pass', async () => {
    const applicationId = await submitApplication();
    for (const checkType of MANDATORY_CHECKS) {
      const ref = await providerRefFor(applicationId, checkType);
      const res = await postWebhook(ref, 'passed');
      expect(res.status).toBe(200);
    }
    const app2 = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app2.lifecycleState).toBe('REVIEW');

    const audits = await testPrisma.auditLog.findMany({ where: { entityId: applicationId } });
    expect(audits.map((a) => a.event)).toContain('LIFECYCLE_VERIFICATION_TO_REVIEW');
  });

  it('progresses to REVIEW flagged when a check fails', async () => {
    const applicationId = await submitApplication();
    for (const checkType of MANDATORY_CHECKS) {
      const ref = await providerRefFor(applicationId, checkType);
      await postWebhook(ref, checkType === 'BANK' ? 'failed' : 'passed');
    }
    const app2 = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app2.lifecycleState).toBe('REVIEW');
    const audits = await testPrisma.auditLog.findMany({ where: { entityId: applicationId } });
    expect(audits.map((a) => a.event)).toContain('VERIFICATION_FLAGGED_FOR_REVIEW');
  });

  it('does not progress while a check is still outstanding', async () => {
    const applicationId = await submitApplication();
    const checks = MANDATORY_CHECKS.slice(0, MANDATORY_CHECKS.length - 1);
    for (const checkType of checks) {
      const ref = await providerRefFor(applicationId, checkType);
      await postWebhook(ref, 'passed');
    }
    const app2 = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app2.lifecycleState).toBe('VERIFICATION');
  });
});

describe('webhook security + idempotency', () => {
  it('rejects a webhook with an invalid signature and changes no state', async () => {
    const applicationId = await submitApplication();
    const ref = await providerRefFor(applicationId, 'GST');
    const raw = JSON.stringify({ providerRef: ref, status: 'passed' });

    const res = await request(app)
      .post('/api/webhooks/digio')
      .set('Content-Type', 'application/json')
      .set('x-digio-signature', 'not-a-valid-signature')
      .send(raw);
    expect(res.status).toBe(401);

    const v = await testPrisma.verification.findFirstOrThrow({
      where: { applicationId, checkType: 'GST' },
    });
    expect(v.status).toBe('IN_PROGRESS'); // unchanged

    const audits = await testPrisma.auditLog.findMany({ where: { event: 'WEBHOOK_SIGNATURE_REJECTED' } });
    expect(audits.length).toBeGreaterThan(0);
  });

  it('is idempotent: a retried webhook for a terminal check does not re-apply', async () => {
    const applicationId = await submitApplication();
    const ref = await providerRefFor(applicationId, 'GST');

    const first = await postWebhook(ref, 'passed');
    expect(first.body.outcome).toBe('applied');

    const second = await postWebhook(ref, 'failed'); // attempt to flip result
    expect(second.body.outcome).toBe('duplicate');

    const v = await testPrisma.verification.findFirstOrThrow({
      where: { applicationId, checkType: 'GST' },
    });
    expect(v.status).toBe('PASSED'); // not flipped to FAILED
  });

  it('ignores a webhook for an unknown provider ref', async () => {
    const res = await postWebhook('mock-gst-does-not-exist', 'passed');
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('unknown_ref');
  });
});

describe('admin manual override', () => {
  it('lets a verifier override a check and re-evaluates progression', async () => {
    const applicationId = await submitApplication();

    // Pass 4 of 5 checks via webhook.
    for (const checkType of MANDATORY_CHECKS.filter((c) => c !== 'DOCUMENT')) {
      const ref = await providerRefFor(applicationId, checkType);
      await postWebhook(ref, 'passed');
    }

    // Mint a verifier token directly.
    const { hashPassword } = await import('../../src/modules/auth/password.service');
    const { tokenFor } = await import('../setup/identity');
    const verifier = await testPrisma.user.create({
      data: {
        email: 'verifier-override@example.com',
        passwordHash: await hashPassword('VerifierPass!23'),
        role: 'VERIFIER',
      },
    });
    const token = await tokenFor({
      id: verifier.id,
      role: verifier.role,
      agencyId: verifier.agencyId,
      mfaVerified: true,
    });

    const res = await request(app)
      .post(`/api/applications/${applicationId}/verifications/DOCUMENT/override`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PASSED' });
    expect(res.status).toBe(200);

    const app2 = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app2.lifecycleState).toBe('REVIEW');

    const audits = await testPrisma.auditLog.findMany({ where: { event: 'VERIFICATION_MANUAL_OVERRIDE' } });
    expect(audits.length).toBe(1);
  });
});
