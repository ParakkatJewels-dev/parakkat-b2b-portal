import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';
import { enforceStaffMfa, resetMfaPolicy } from '../setup/mfaPolicy';

const app = createApp();

async function createUser(role: 'ADMIN' | 'AGENCY' = 'AGENCY') {
  const password = 'Sup3rSecret!23';
  const passwordHash = await hashPassword(password);
  const user = await testPrisma.user.create({
    data: { email: `audit-${Date.now()}-${Math.random()}@example.com`, passwordHash, role },
  });
  return { user, password };
}

async function eventsFor(entityId: string): Promise<string[]> {
  const rows = await testPrisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.event);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('audit trail', () => {
  it('records LOGIN_SUCCESS on a successful login', async () => {
    const { user, password } = await createUser('AGENCY');
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(await eventsFor(user.id)).toContain('LOGIN_SUCCESS');
  });

  it('records LOGIN_FAILED on a wrong password', async () => {
    const { user } = await createUser('AGENCY');
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong' });
    expect(await eventsFor(user.id)).toContain('LOGIN_FAILED');
  });

  it('records MFA_ENABLED when TOTP setup is confirmed', async () => {
    await enforceStaffMfa();
    const { user, password } = await createUser('ADMIN');
    const login1 = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const pendingToken = login1.body.mfaPendingToken as string;

    const setupRes = await request(app)
      .post('/api/auth/mfa/setup/totp')
      .set('Authorization', `Bearer ${pendingToken}`);
    const secret = /secret=([A-Z2-7]+)/.exec(setupRes.body.otpauthUrl)![1];
    const code = authenticator.generate(secret);

    await request(app)
      .post('/api/auth/mfa/setup/totp/confirm')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ code });

    expect(await eventsFor(user.id)).toContain('MFA_ENABLED');
    await resetMfaPolicy();
  });

  it('records TOKEN_REUSE_DETECTED when a revoked refresh token is replayed', async () => {
    const { user, password } = await createUser('AGENCY');
    const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const cookies = loginRes.headers['set-cookie'];

    await request(app).post('/api/auth/refresh').set('Cookie', cookies);
    // Replay the now-revoked original refresh cookie.
    await request(app).post('/api/auth/refresh').set('Cookie', cookies);

    expect(await eventsFor(user.id)).toContain('TOKEN_REUSE_DETECTED');
  });

  it('every AuditLog row carries a correlationId propagated from the request', async () => {
    const { user, password } = await createUser('AGENCY');
    const correlationId = 'test-correlation-id-123';
    await request(app)
      .post('/api/auth/login')
      .set('x-correlation-id', correlationId)
      .send({ email: user.email, password });

    const rows = await testPrisma.auditLog.findMany({ where: { entityId: user.id } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.correlationId).toBe(correlationId);
    }
  });
});
