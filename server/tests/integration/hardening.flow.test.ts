import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { __resetAnomalyState } from '../../src/modules/onboarding/anomaly';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

const app = createApp();

async function adminToken(): Promise<string> {
  const admin = await testPrisma.user.create({
    data: { email: `admin-${Date.now()}-${Math.random()}@example.com`, passwordHash: await hashPassword('Pass!23456'), role: 'ADMIN' },
  });
  return await tokenFor({ id: admin.id, role: 'ADMIN', agencyId: null, mfaVerified: true });
}

const draft = {
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
  __resetAnomalyState();
});
afterAll(async () => {
  await disconnectTestDb();
});

describe('audit log query filters', () => {
  it('filters by event substring and actorRole', async () => {
    const token = await adminToken();
    // Generate some audited events.
    const create = await request(app).post('/api/onboarding/applications').send(draft);
    await request(app)
      .post(`/api/onboarding/applications/${create.body.applicationId}/submit`)
      .set('x-resume-token', create.body.resumeToken);

    const byEvent = await request(app).get('/api/audit-logs').query({ event: 'LIFECYCLE' }).set('Authorization', `Bearer ${token}`);
    expect(byEvent.status).toBe(200);
    expect(byEvent.body.items.length).toBeGreaterThan(0);
    expect(byEvent.body.items.every((e: { event: string }) => /LIFECYCLE/i.test(e.event))).toBe(true);

    const byRole = await request(app).get('/api/audit-logs').query({ actorRole: 'APPLICANT' }).set('Authorization', `Bearer ${token}`);
    expect(byRole.body.items.every((e: { actorRole: string }) => e.actorRole === 'APPLICANT')).toBe(true);
  });

  it('is admin-only', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });
});

describe('onboarding anomaly detection', () => {
  it('raises an audited anomaly event past the soft threshold', async () => {
    // Default threshold is 5 within the window.
    for (let i = 0; i < 6; i++) {
      await request(app).post('/api/onboarding/applications').send({ legalName: `A${i}` });
    }
    const anomalies = await testPrisma.auditLog.findMany({ where: { event: 'ONBOARDING_ANOMALY_DETECTED' } });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
  });
});

describe('reports summary', () => {
  it('returns totals + breakdowns for an admin', async () => {
    const token = await adminToken();
    const res = await request(app).get('/api/reports/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totals');
    expect(res.body).toHaveProperty('revenueByAgency');
    expect(res.body).toHaveProperty('bookingsByResort');
  });

  it('is admin-only', async () => {
    const res = await request(app).get('/api/reports/summary');
    expect(res.status).toBe(401);
  });
});
