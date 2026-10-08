import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { loadSettings } from '../../src/modules/settings/settings.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';
import { weekdayStay } from '../setup/stayDates';

const nearStay = weekdayStay(30);

const app = createApp();
const PASSWORD = 'Pass!23456';

let counter = 0;
async function setup() {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const agency = await testPrisma.agency.create({
    data: {
      legalName: `Agency ${suffix}`,
      gstin: `27AABCU9603R1Z${counter}`,
      pan: `AABCU9603${counter}`,
      status: 'ACTIVE',
      contactEmail: `agency-${suffix}@example.com`,
      contactPhone: '9876543210',
      activatedAt: new Date(),
    },
  });
  const admin = await testPrisma.user.create({
    data: { email: `admin-${suffix}@example.com`, passwordHash: await hashPassword(PASSWORD), role: 'ADMIN' },
  });
  await testPrisma.commercialConfiguration.create({
    data: {
      agencyId: agency.id,
      tier: 'A',
      paymentMode: 'CREDIT',
      creditLimit: 500000,
      paymentTerms: 'net 30',
      markupPct: 10,
      effectiveFrom: new Date(),
      updatedById: admin.id,
      isCurrent: true,
    },
  });
  const agent = await testPrisma.user.create({
    data: { email: `agent-${suffix}@example.com`, passwordHash: await hashPassword(PASSWORD), role: 'AGENT', agencyId: agency.id },
  });
  const agencyUser = await testPrisma.user.create({
    data: { email: `au-${suffix}@example.com`, passwordHash: await hashPassword(PASSWORD), role: 'AGENCY', agencyId: agency.id },
  });
  return {
    agency,
    adminEmail: admin.email,
    agencyEmail: agencyUser.email,
    adminToken: await tokenFor({ id: admin.id, role: 'ADMIN', agencyId: null, mfaVerified: true }),
    agencyToken: await tokenFor({ id: agencyUser.id, role: 'AGENCY', agencyId: agency.id, mfaVerified: true }),
    agentToken: await tokenFor({ id: agent.id, role: 'AGENT', agencyId: agency.id, mfaVerified: true }),
  };
}

const login = (email: string) => request(app).post('/api/auth/login').send({ email, password: PASSWORD });

beforeEach(async () => {
  await resetDatabase();
  await loadSettings(); // reset the in-process settings cache to defaults (DB is now empty)
});
afterAll(async () => {
  await disconnectTestDb();
});

describe('settings access control', () => {
  it('returns all groups to an admin and rejects non-admins / invalid bodies', async () => {
    const { adminToken, agencyToken } = await setup();

    const get = await request(app).get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(Object.keys(get.body).sort()).toEqual(['booking', 'company', 'financial', 'portal', 'security']);

    const forbidden = await request(app).put('/api/settings/security').set('Authorization', `Bearer ${agencyToken}`).send({ mfaEnabled: true });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app).put('/api/settings/financial').set('Authorization', `Bearer ${adminToken}`).send({ defaultGstRate: 99 });
    expect(invalid.status).toBe(400);
  });
});

describe('MFA enforcement round-trip', () => {
  it('forces MFA setup for an agency once enforcement is saved, and stops once disabled', async () => {
    const { adminToken, agencyEmail } = await setup();

    // Baseline: master off → password-only login works.
    expect((await login(agencyEmail)).body.accessToken).toBeTruthy();

    const on = await request(app).put('/api/settings/security').set('Authorization', `Bearer ${adminToken}`).send({ mfaEnabled: true, enforceAgency: true });
    expect(on.status).toBe(200);

    const enforced = await login(agencyEmail);
    expect(enforced.body.mfaSetupRequired).toBe(true);
    expect(enforced.body.accessToken).toBeUndefined();

    await request(app).put('/api/settings/security').set('Authorization', `Bearer ${adminToken}`).send({ mfaEnabled: false });
    expect((await login(agencyEmail)).body.accessToken).toBeTruthy();
  });
});

describe('maintenance mode', () => {
  it('blocks agency logins but still lets admins in', async () => {
    const { adminToken, adminEmail, agencyEmail } = await setup();

    await request(app).put('/api/settings/portal').set('Authorization', `Bearer ${adminToken}`).send({ maintenanceMode: true });

    const blocked = await login(agencyEmail);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/maintenance/i);

    expect((await login(adminEmail)).body.accessToken).toBeTruthy();
  });
});

describe('booking window enforcement', () => {
  it('rejects a check-in beyond the configured advance window', async () => {
    const { adminToken, agentToken } = await setup();

    await request(app).put('/api/settings/booking').set('Authorization', `Bearer ${adminToken}`).send({ bookingWindowDays: 3 });

    const far = { resortId: 'resort-goa', roomTypeId: 'goa-deluxe', checkIn: nearStay.checkIn, checkOut: nearStay.checkOut, guests: 2 };
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(far);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3 days/);
  });
});
