import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

const app = createApp();

async function createAgencyWithUser(name: string) {
  const agency = await testPrisma.agency.create({
    data: {
      legalName: name,
      gstin: `GSTIN-${name}`,
      pan: `PAN-${name}`,
      contactEmail: `${name.toLowerCase()}@example.com`,
      contactPhone: '9999999999',
    },
  });
  const password = 'Sup3rSecret!23';
  const passwordHash = await hashPassword(password);
  const user = await testPrisma.user.create({
    data: {
      email: `${name.toLowerCase()}-user@example.com`,
      passwordHash,
      role: 'AGENCY',
      agencyId: agency.id,
    },
  });
  return { agency, user, password };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('tenant isolation', () => {
  it("denies an AGENCY user from reading another agency's record", async () => {
    const { agency: agencyA } = await createAgencyWithUser('AgencyA');
    const { user: userB, password: passwordB } = await createAgencyWithUser('AgencyB');

    const tokenB = await login(userB.email, passwordB);
    const res = await request(app)
      .get(`/api/agencies/${agencyA.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it('allows an AGENCY user to read their own agency', async () => {
    const { agency, user, password } = await createAgencyWithUser('AgencyC');
    const token = await login(user.email, password);
    const res = await request(app)
      .get(`/api/agencies/${agency.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(agency.id);
  });

  it('allows ADMIN to read any agency', async () => {
    const { agency } = await createAgencyWithUser('AgencyD');
    const passwordHash = await hashPassword('AdminPass!23');
    const admin = await testPrisma.user.create({
      data: { email: 'admin-rbac@example.com', passwordHash, role: 'ADMIN', mfaEnabled: false },
    });
    // ADMIN role mandates MFA, so login will return mfaSetupRequired rather
    // than a usable access token — bypass by minting a token directly for
    // this cross-tenant-read assertion, which is orthogonal to the MFA flow
    // already covered by auth.flow.test.ts.
    const { tokenFor } = await import('../setup/identity');
    const token = await tokenFor({
      id: admin.id,
      role: admin.role,
      agencyId: admin.agencyId,
      mfaVerified: true,
    });

    const res = await request(app)
      .get(`/api/agencies/${agency.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('role gating', () => {
  it('denies AGENT from the admin-only audit log endpoint', async () => {
    const agency = await testPrisma.agency.create({
      data: {
        legalName: 'AgencyE',
        gstin: 'GSTIN-E',
        pan: 'PAN-E',
        contactEmail: 'e@example.com',
        contactPhone: '9999999999',
      },
    });
    const passwordHash = await hashPassword('AgentPass!23');
    const agent = await testPrisma.user.create({
      data: {
        email: 'agent-rbac@example.com',
        passwordHash,
        role: 'AGENT',
        agencyId: agency.id,
      },
    });
    const token = await login(agent.email, 'AgentPass!23');
    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
