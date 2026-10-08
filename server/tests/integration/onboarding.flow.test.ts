import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
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

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('onboarding self-service flow', () => {
  it('creates a draft, resumes it, updates it, and submits (Draft → Verification)', async () => {
    // Create a blank draft.
    const createRes = await request(app).post('/api/onboarding/applications').send({});
    expect(createRes.status).toBe(201);
    const { applicationId, resumeToken } = createRes.body;
    expect(applicationId).toBeTypeOf('string');
    expect(resumeToken).toBeTypeOf('string');

    // Resume requires the token.
    const noTokenRes = await request(app).get(`/api/onboarding/applications/${applicationId}`);
    expect(noTokenRes.status).toBe(401);

    const wrongTokenRes = await request(app)
      .get(`/api/onboarding/applications/${applicationId}`)
      .set('x-resume-token', 'wrong');
    expect(wrongTokenRes.status).toBe(401);

    const resumeRes = await request(app)
      .get(`/api/onboarding/applications/${applicationId}`)
      .set('x-resume-token', resumeToken);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.application.resumeTokenHash).toBeUndefined();

    // Fill in the whole draft.
    const patchRes = await request(app)
      .patch(`/api/onboarding/applications/${applicationId}`)
      .set('x-resume-token', resumeToken)
      .send(completeDraft);
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.application.legalName).toBe(completeDraft.legalName);

    // Submit.
    const submitRes = await request(app)
      .post(`/api/onboarding/applications/${applicationId}/submit`)
      .set('x-resume-token', resumeToken);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.lifecycleState).toBe('VERIFICATION');

    // A lifecycle audit row exists.
    const audits = await testPrisma.auditLog.findMany({ where: { entityId: applicationId } });
    const events = audits.map((a) => a.event);
    expect(events).toContain('APPLICATION_DRAFT_CREATED');
    expect(events).toContain('LIFECYCLE_DRAFT_TO_VERIFICATION');

    // Cannot edit after submission.
    const editAfterSubmit = await request(app)
      .patch(`/api/onboarding/applications/${applicationId}`)
      .set('x-resume-token', resumeToken)
      .send({ legalName: 'Changed' });
    expect(editAfterSubmit.status).toBe(409);
  });

  it('rejects submission of an incomplete draft', async () => {
    const createRes = await request(app)
      .post('/api/onboarding/applications')
      .send({ legalName: 'Only a name' });
    const { applicationId, resumeToken } = createRes.body;

    const submitRes = await request(app)
      .post(`/api/onboarding/applications/${applicationId}/submit`)
      .set('x-resume-token', resumeToken);
    expect(submitRes.status).toBe(400);
  });

  it('blocks a duplicate submission for the same GSTIN/PAN already in the pipeline', async () => {
    // First application submitted.
    const first = await request(app).post('/api/onboarding/applications').send(completeDraft);
    await request(app)
      .post(`/api/onboarding/applications/${first.body.applicationId}/submit`)
      .set('x-resume-token', first.body.resumeToken);

    // Second application with the same GSTIN/PAN.
    const second = await request(app).post('/api/onboarding/applications').send(completeDraft);
    const dupRes = await request(app)
      .post(`/api/onboarding/applications/${second.body.applicationId}/submit`)
      .set('x-resume-token', second.body.resumeToken);
    expect(dupRes.status).toBe(409);
  });
});

describe('onboarding document upload', () => {
  it('uploads a document to a draft and lists it', async () => {
    const createRes = await request(app).post('/api/onboarding/applications').send(completeDraft);
    const { applicationId, resumeToken } = createRes.body;

    const uploadRes = await request(app)
      .post(`/api/onboarding/applications/${applicationId}/documents`)
      .set('x-resume-token', resumeToken)
      .field('docType', 'REGISTRATION_PROOF')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf'), {
        filename: 'registration.pdf',
        contentType: 'application/pdf',
      });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.docType).toBe('REGISTRATION_PROOF');

    const listRes = await request(app)
      .get(`/api/onboarding/applications/${applicationId}/documents`)
      .set('x-resume-token', resumeToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.documents).toHaveLength(1);
    expect(listRes.body.documents[0].fileName).toBe('registration.pdf');
  });

  it('rejects an unsupported file type', async () => {
    const createRes = await request(app).post('/api/onboarding/applications').send(completeDraft);
    const { applicationId, resumeToken } = createRes.body;

    const uploadRes = await request(app)
      .post(`/api/onboarding/applications/${applicationId}/documents`)
      .set('x-resume-token', resumeToken)
      .field('docType', 'REGISTRATION_PROOF')
      .attach('file', Buffer.from('malware'), {
        filename: 'evil.exe',
        contentType: 'application/x-msdownload',
      });
    expect(uploadRes.status).toBe(400);
  });
});

describe('admin applications view', () => {
  it('masks PII in the admin application detail', async () => {
    const create = await request(app).post('/api/onboarding/applications').send(completeDraft);
    await request(app)
      .post(`/api/onboarding/applications/${create.body.applicationId}/submit`)
      .set('x-resume-token', create.body.resumeToken);

    // Mint an admin access token directly (MFA flow covered elsewhere).
    const { hashPassword } = await import('../../src/modules/auth/password.service');
    const { tokenFor } = await import('../setup/identity');
    const admin = await testPrisma.user.create({
      data: {
        email: 'admin-apps@example.com',
        passwordHash: await hashPassword('AdminPass!23'),
        role: 'ADMIN',
      },
    });
    const token = await tokenFor({
      id: admin.id,
      role: admin.role,
      agencyId: admin.agencyId,
      mfaVerified: true,
    });

    const detail = await request(app)
      .get(`/api/applications/${create.body.applicationId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    // PAN masked, resume token hash never exposed.
    expect(detail.body.pan).toBe('******603R');
    expect(detail.body.bankAccount).toBe('********6789');
    expect(detail.body.resumeTokenHash).toBeUndefined();
  });
});
