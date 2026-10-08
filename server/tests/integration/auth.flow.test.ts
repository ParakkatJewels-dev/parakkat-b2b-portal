import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';
import { enforceStaffMfa, resetMfaPolicy } from '../setup/mfaPolicy';

const app = createApp();

async function createUser(overrides: Partial<{ email: string; role: 'ADMIN' | 'AGENCY' | 'AGENT' | 'VERIFIER'; password: string }> = {}) {
  const password = overrides.password ?? 'Sup3rSecret!23';
  const passwordHash = await hashPassword(password);
  const user = await testPrisma.user.create({
    data: {
      email: overrides.email ?? `user-${Date.now()}-${Math.random()}@example.com`,
      passwordHash,
      role: overrides.role ?? 'AGENCY',
    },
  });
  return { user, password };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('auth flow — role without mandatory MFA (AGENCY, MFA not enabled)', () => {
  it('logs in directly and can access a protected route', async () => {
    const { user, password } = await createUser({ role: 'AGENCY' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeTypeOf('string');
    const setCookie = loginRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();

    const meRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(user.email);
  });

  it('rejects an invalid password', async () => {
    const { user } = await createUser({ role: 'AGENCY' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });
});

describe('auth flow — role with mandatory MFA (ADMIN), first login', () => {
  beforeEach(enforceStaffMfa);
  afterEach(resetMfaPolicy);

  it('returns mfaSetupRequired, completes TOTP setup, then logs in with MFA', async () => {
    const { user, password } = await createUser({ role: 'ADMIN' });

    const firstLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.mfaSetupRequired).toBe(true);
    const pendingToken = firstLogin.body.mfaPendingToken as string;
    expect(pendingToken).toBeTypeOf('string');
    // A session that still owes its second factor reaches the MFA routes and nothing else.
    const blocked = await request(app).get('/api/users/me').set('Authorization', `Bearer ${pendingToken}`);
    expect(blocked.status).toBe(401);

    const setupRes = await request(app)
      .post('/api/auth/mfa/setup/totp')
      .set('Authorization', `Bearer ${pendingToken}`);
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.otpauthUrl).toContain('otpauth://');

    const secretMatch = /secret=([A-Z2-7]+)/.exec(setupRes.body.otpauthUrl);
    const secret = secretMatch![1];
    const code = authenticator.generate(secret);

    const confirmRes = await request(app)
      .post('/api/auth/mfa/setup/totp/confirm')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ code });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.mfaEnabled).toBe(true);

    // Now MFA is enabled — logging in again should go through the mfa_required branch.
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password });
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.mfaRequired).toBe(true);
    expect(secondLogin.body.mfaMethod).toBe('TOTP');

    const loginCode = authenticator.generate(secret);
    const verifyRes = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaPendingToken: secondLogin.body.mfaPendingToken, code: loginCode });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.accessToken).toBeTypeOf('string');

    const meRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${verifyRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.role).toBe('ADMIN');
  });

  it('rejects an incorrect MFA code', async () => {
    const { user, password } = await createUser({ role: 'ADMIN' });
    const firstLogin = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const pendingToken = firstLogin.body.mfaPendingToken as string;

    const setupRes = await request(app)
      .post('/api/auth/mfa/setup/totp')
      .set('Authorization', `Bearer ${pendingToken}`);
    const secretMatch = /secret=([A-Z2-7]+)/.exec(setupRes.body.otpauthUrl);
    const secret = secretMatch![1];
    const code = authenticator.generate(secret);
    await request(app)
      .post('/api/auth/mfa/setup/totp/confirm')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ code });

    const secondLogin = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const verifyRes = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ mfaPendingToken: secondLogin.body.mfaPendingToken, code: '000000' });
    expect(verifyRes.status).toBe(401);
  });
});

describe('refresh + logout', () => {
  it('rotates the refresh token and logout revokes it', async () => {
    const { user, password } = await createUser({ role: 'AGENCY' });
    const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const cookies = loginRes.headers['set-cookie'];

    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', cookies);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTypeOf('string');
    const newCookies = refreshRes.headers['set-cookie'];

    // Old cookie is now revoked; using it again should be treated as reuse and fail.
    const reuseRes = await request(app).post('/api/auth/refresh').set('Cookie', cookies);
    expect(reuseRes.status).toBe(401);

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', newCookies);
    expect(logoutRes.status).toBe(204);

    const postLogoutRefresh = await request(app).post('/api/auth/refresh').set('Cookie', newCookies);
    expect(postLogoutRefresh.status).toBe(401);
  });
});
