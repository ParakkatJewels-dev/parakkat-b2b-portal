import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

const app = createApp();

async function adminToken(): Promise<string> {
  const user = await testPrisma.user.create({
    data: {
      email: `admin-${Date.now()}@example.com`,
      passwordHash: await hashPassword('Pass!23456'),
      role: 'ADMIN',
    },
  });
  return await tokenFor({ id: user.id, role: user.role, agencyId: user.agencyId, mfaVerified: true });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('Admin Direct Agency Creation Flow (D7 Exception)', () => {
  it('creates an agency directly with standard configurations, initial user, and audit logs', async () => {
    const token = await adminToken();

    const input = {
      legalName: 'Direct Travel Solutions Ltd',
      gstin: '27AABCU9603R1ZM',
      pan: 'AABCU9603R',
      contactEmail: 'admin@directtravel.example',
      contactPhone: '9876543210',
      tier: 'A',
    };

    const res = await request(app)
      .post('/api/agencies')
      .set('Authorization', `Bearer ${token}`)
      .send(input);

    expect(res.status).toBe(201);
    expect(res.body.legalName).toBe(input.legalName);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.activatedAt).not.toBeNull();
    const agencyId = res.body.id;

    // Verify Commercial Configuration exists and matches chosen tier
    const config = await testPrisma.commercialConfiguration.findFirst({
      where: { agencyId, isCurrent: true },
    });
    expect(config).not.toBeNull();
    expect(config?.tier).toBe('A');
    expect(config?.paymentMode).toBe('CREDIT');
    expect(config?.markupPct.toNumber()).toBe(10);

    // Verify initial agency user was created
    const user = await testPrisma.user.findFirst({
      where: { agencyId, role: 'AGENCY' },
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(input.contactEmail);
    expect(user?.mustChangePassword).toBe(true);

    // Verify Audit Logs exist
    const audits = await testPrisma.auditLog.findMany({
      where: { entityId: agencyId },
    });
    const events = audits.map((a) => a.event);
    expect(events).toContain('AGENCY_CREATED_BY_ADMIN');

    const userAudits = await testPrisma.auditLog.findMany({
      where: { entityId: user?.id },
    });
    expect(userAudits.map((a) => a.event)).toContain('AGENCY_USER_CREATED');
  });

  it('fails to create an agency with an invalid tier', async () => {
    const token = await adminToken();

    const input = {
      legalName: 'Invalid Agency Ltd',
      gstin: '27AABCU9603R1ZM',
      pan: 'AABCU9603R',
      contactEmail: 'invalid@directtravel.example',
      contactPhone: '9876543210',
      tier: 'SUPER_VIP_TIER_INVALID',
    };

    const res = await request(app)
      .post('/api/agencies')
      .set('Authorization', `Bearer ${token}`)
      .send(input);

    expect(res.status).toBe(400);
  });

  it('updates an active agency commercial configuration tier successfully', async () => {
    const token = await adminToken();

    // First create the agency with Tier A
    const input = {
      legalName: 'Update Travel Solutions Ltd',
      gstin: '27AABCU9603R1ZM',
      pan: 'AABCU9603R',
      contactEmail: 'update@directtravel.example',
      contactPhone: '9876543210',
      tier: 'A',
    };
    const createRes = await request(app)
      .post('/api/agencies')
      .set('Authorization', `Bearer ${token}`)
      .send(input);
    const agencyId = createRes.body.id;

    // Update the configuration to Tier B
    const updateRes = await request(app)
      .post(`/api/agencies/${agencyId}/commercial-config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'B' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.tier).toBe('B');
    expect(updateRes.body.paymentMode).toBe('CREDIT');
    expect(updateRes.body.creditLimit).toBe('200000'); // Decimal returned as string

    // Verify in DB that it is active and the old one is disabled
    const config = await testPrisma.commercialConfiguration.findFirst({
      where: { agencyId, isCurrent: true },
    });
    expect(config?.tier).toBe('B');

    const oldConfigs = await testPrisma.commercialConfiguration.findMany({
      where: { agencyId, isCurrent: false },
    });
    expect(oldConfigs).toHaveLength(1);
    expect(oldConfigs[0].tier).toBe('A');
  });
});
