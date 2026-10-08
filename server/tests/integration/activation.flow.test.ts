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

async function adminToken(role: 'ADMIN' | 'VERIFIER' = 'ADMIN'): Promise<string> {
  const user = await testPrisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: await hashPassword('Pass!23456'),
      role,
    },
  });
  return await tokenFor({ id: user.id, role: user.role, agencyId: user.agencyId, mfaVerified: true });
}

async function postWebhook(providerRef: string, status: 'passed' | 'failed') {
  const raw = JSON.stringify({ providerRef, status });
  return request(app)
    .post('/api/webhooks/digio')
    .set('Content-Type', 'application/json')
    .set('x-digio-signature', signDigioBody(raw))
    .send(raw);
}

async function refFor(applicationId: string, checkType: VerificationCheckType): Promise<string> {
  const v = await testPrisma.verification.findFirstOrThrow({ where: { applicationId, checkType } });
  return v.providerRef!;
}

/** Drives an application from submit → all checks passed → REVIEW. */
async function toReview(): Promise<string> {
  const create = await request(app).post('/api/onboarding/applications').send(completeDraft);
  await request(app)
    .post(`/api/onboarding/applications/${create.body.applicationId}/submit`)
    .set('x-resume-token', create.body.resumeToken);
  for (const checkType of MANDATORY_CHECKS) {
    await postWebhook(await refFor(create.body.applicationId, checkType), 'passed');
  }
  return create.body.applicationId;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('review → commercial config → agreement → eSign → active', () => {
  it('runs the full activation happy path', async () => {
    const applicationId = await toReview();
    const token = await adminToken('ADMIN');

    // Approve.
    const approve = await request(app)
      .post(`/api/applications/${applicationId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    // Commercial config from a tier — creates the agency + moves to COMMERCIAL_CONFIGURATION.
    const config = await request(app)
      .post(`/api/applications/${applicationId}/commercial-config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'A', overrides: { markupPct: 7 } });
    expect(config.status).toBe(200);
    expect(config.body.configuration.markupPct).toBe('7');
    const agencyId = config.body.agency.id as string;

    let appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('COMMERCIAL_CONFIGURATION');

    // Send agreement → initiates eSign.
    const send = await request(app)
      .post(`/api/applications/${applicationId}/agreement/send`)
      .set('Authorization', `Bearer ${token}`);
    expect(send.status).toBe(200);
    expect(send.body.signingUrl).toContain('esign');

    // eSign signed webhook → auto-activation.
    const esignRef = await refFor(applicationId, 'ESIGN');
    const signed = await postWebhook(esignRef, 'passed');
    expect(signed.status).toBe(200);

    appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('ACTIVE');

    const agency = await testPrisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
    expect(agency.status).toBe('ACTIVE');
    expect(agency.activatedAt).not.toBeNull();

    // Agency user was created and can be found.
    const agencyUser = await testPrisma.user.findFirst({ where: { agencyId, role: 'AGENCY' } });
    expect(agencyUser).not.toBeNull();

    // Signed agreement recorded as an audit event.
    const audits = await testPrisma.auditLog.findMany({ where: { entityId: applicationId } });
    expect(audits.map((a) => a.event)).toContain('LIFECYCLE_COMMERCIAL_CONFIGURATION_TO_ACTIVE');
  });

  it('refuses to activate without a signed agreement', async () => {
    const applicationId = await toReview();
    const token = await adminToken('ADMIN');
    await request(app).post(`/api/applications/${applicationId}/approve`).set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`/api/applications/${applicationId}/commercial-config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'B' });

    const activate = await request(app)
      .post(`/api/applications/${applicationId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(activate.status).toBe(409);
  });

  it('holds at commercial config when eSign is declined', async () => {
    const applicationId = await toReview();
    const token = await adminToken('ADMIN');
    await request(app).post(`/api/applications/${applicationId}/approve`).set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`/api/applications/${applicationId}/commercial-config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'B' });
    await request(app).post(`/api/applications/${applicationId}/agreement/send`).set('Authorization', `Bearer ${token}`);

    const esignRef = await refFor(applicationId, 'ESIGN');
    await postWebhook(esignRef, 'failed');

    const appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('COMMERCIAL_CONFIGURATION');
    const audits = await testPrisma.auditLog.findMany({ where: { entityId: applicationId } });
    expect(audits.map((a) => a.event)).toContain('ACTIVATION_HELD');
  });
});

describe('reject + suspend/reactivate', () => {
  it('rejects an application with a reason (terminal)', async () => {
    const applicationId = await toReview();
    const token = await adminToken('VERIFIER');
    const reject = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Documents could not be verified' });
    expect(reject.status).toBe(200);

    const appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('REJECTED');
    expect(appRow.decisionReason).toBe('Documents could not be verified');
  });

  it('rejects without a reason (400)', async () => {
    const applicationId = await toReview();
    const token = await adminToken('VERIFIER');
    const reject = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(reject.status).toBe(400);
  });

  it('suspends and reactivates an active agency', async () => {
    const applicationId = await toReview();
    const token = await adminToken('ADMIN');
    await request(app).post(`/api/applications/${applicationId}/approve`).set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`/api/applications/${applicationId}/commercial-config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'B' });
    await request(app).post(`/api/applications/${applicationId}/agreement/send`).set('Authorization', `Bearer ${token}`);
    const esignRef = await refFor(applicationId, 'ESIGN');
    await postWebhook(esignRef, 'passed');

    const agency = await testPrisma.agency.findFirstOrThrow({ where: { applicationId } });

    const suspend = await request(app)
      .post(`/api/agencies/${agency.id}/suspend`)
      .set('Authorization', `Bearer ${token}`);
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe('SUSPENDED');

    let appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('SUSPENDED');

    const reactivate = await request(app)
      .post(`/api/agencies/${agency.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.status).toBe('ACTIVE');

    appRow = await testPrisma.agencyApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(appRow.lifecycleState).toBe('ACTIVE');
  });
});
