import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { getMailer } from '../../src/lib/mailer';
import { hashPassword } from '../../src/modules/auth/password.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';
import { enforceStaffMfa, resetMfaPolicy } from '../setup/mfaPolicy';

// Sessions now belong to the identity provider (Supabase Auth; the mock here) and are checked on
// every request, so revoking one takes effect immediately rather than when a token expires.

const app = createApp();
const PASSWORD = 'Sup3rSecret!23';

async function agencyWithUser() {
  const agency = await testPrisma.agency.create({
    data: { legalName: 'Sessions Travel', gstin: 'GSTIN-S', pan: 'PAN-S', contactEmail: 's@example.com', contactPhone: '9999999999' },
  });
  const owner = await testPrisma.user.create({
    data: { email: 'owner@example.com', passwordHash: await hashPassword(PASSWORD), role: 'AGENCY', agencyId: agency.id },
  });
  return { agency, owner };
}

async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, cookies: res.headers['set-cookie'] as unknown as string[], body: res.body, status: res.status };
}

const me = (token: string) => request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('agent credentials live with the identity provider', () => {
  it('a created agent signs in with the issued temporary password, which a reset replaces', async () => {
    const { owner } = await agencyWithUser();
    const ownerSession = await login(owner.email);

    const created = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ name: 'Asha', email: 'asha@example.com' });
    expect(created.status).toBe(201);
    const tempPassword = created.body.tempPassword as string;
    expect(tempPassword).toBeTypeOf('string');

    const agent = await login('asha@example.com', tempPassword);
    expect(agent.status).toBe(200);
    expect(agent.body.user.mustChangePassword).toBe(true);

    const reset = await request(app)
      .post(`/api/agents/${created.body.agent.id}/reset-password`)
      .set('Authorization', `Bearer ${ownerSession.token}`);
    expect(reset.status).toBe(200);
    // The reset ends the agent's session at once and the old password stops working.
    expect((await me(agent.token)).status).toBe(401);
    expect((await login('asha@example.com', tempPassword)).status).toBe(401);
    expect((await login('asha@example.com', reset.body.tempPassword)).status).toBe(200);
  });
});

describe('revocation is immediate', () => {
  it('force-logout and suspension end an agent session before its token expires', async () => {
    const { owner } = await agencyWithUser();
    const ownerSession = await login(owner.email);
    const created = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ name: 'Ravi', email: 'ravi@example.com', password: 'An0ther!Secret' });
    const agentId = created.body.agent.id as string;

    const first = await login('ravi@example.com', 'An0ther!Secret');
    expect((await me(first.token)).status).toBe(200);
    await request(app).post(`/api/agents/${agentId}/force-logout`).set('Authorization', `Bearer ${ownerSession.token}`);
    expect((await me(first.token)).status).toBe(401);
    // Its refresh token died with it.
    expect((await request(app).post('/api/auth/refresh').set('Cookie', first.cookies)).status).toBe(401);

    const second = await login('ravi@example.com', 'An0ther!Secret');
    await request(app)
      .post(`/api/agents/${agentId}/status`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ status: 'SUSPENDED' });
    expect((await me(second.token)).status).toBe(401);
    expect((await login('ravi@example.com', 'An0ther!Secret')).status).toBe(403);
  });

  it('logout ends only the current session', async () => {
    const { owner } = await agencyWithUser();
    const phone = await login(owner.email);
    const laptop = await login(owner.email);
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${phone.token}`).set('Cookie', phone.cookies);
    expect(out.status).toBe(204);
    expect((await me(phone.token)).status).toBe(401);
    expect((await me(laptop.token)).status).toBe(200);
  });
});

describe('password change', () => {
  it('keeps this session, ends the others and clears the change-password prompt', async () => {
    const { owner } = await agencyWithUser();
    await testPrisma.user.update({ where: { id: owner.id }, data: { mustChangePassword: true } });
    const here = await login(owner.email);
    const elsewhere = await login(owner.email);

    const wrong = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${here.token}`)
      .send({ currentPassword: 'not-it', newPassword: 'Brand!New2026x' });
    expect(wrong.status).toBe(400);

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${here.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Brand!New2026x' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    expect((await me(here.token)).status).toBe(200);
    expect((await me(elsewhere.token)).status).toBe(401);
    expect((await login(owner.email)).status).toBe(401);
    expect((await login(owner.email, 'Brand!New2026x')).status).toBe(200);
  });
});

describe('email second factor', () => {
  beforeEach(enforceStaffMfa);
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetMfaPolicy();
  });

  it('a session that passed the email code is MFA-satisfied, and stays so across a refresh', async () => {
    const verifier = await testPrisma.user.create({
      data: { email: 'verifier@example.com', passwordHash: await hashPassword(PASSWORD), role: 'VERIFIER', mfaEnabled: true, mfaMethod: 'EMAIL' },
    });
    const sent: string[] = [];
    vi.spyOn(getMailer(), 'send').mockImplementation(async (mail) => {
      sent.push(mail.text ?? '');
    });

    const pending = await login(verifier.email);
    expect(pending.body.mfaRequired).toBe(true);
    expect(pending.body.mfaMethod).toBe('EMAIL');
    const pendingToken = pending.body.mfaPendingToken as string;
    expect((await me(pendingToken)).status).toBe(401);

    const code = /(\d{6})/.exec(sent.at(-1) ?? '')![1];
    const wrong = await request(app).post('/api/auth/mfa/verify').send({ mfaPendingToken: pendingToken, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(401);
    // The browser sends the parked refresh cookie along (its path covers the MFA routes).
    const verified = await request(app).post('/api/auth/mfa/verify').set('Cookie', pending.cookies).send({ mfaPendingToken: pendingToken, code });
    expect(verified.status).toBe(200);
    expect((await me(verified.body.accessToken)).status).toBe(200);

    // Before the second factor only the MFA routes see the session's refresh token…
    expect((await request(app).post('/api/auth/refresh').set('Cookie', pending.cookies)).status).toBe(401);
    // …afterwards it is an ordinary session that refreshes and stays MFA-satisfied.
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', verified.headers['set-cookie'] as unknown as string[]);
    expect(refreshed.status).toBe(200);
    expect((await me(refreshed.body.accessToken)).status).toBe(200);
  });
});

describe('security console', () => {
  it('lists live sessions with their users and revokes one', async () => {
    const { owner } = await agencyWithUser();
    const session = await login(owner.email);
    const admin = await testPrisma.user.create({
      data: { email: 'admin@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN' },
    });
    const adminSession = await login(admin.email);

    const list = await request(app).get('/api/security/sessions').set('Authorization', `Bearer ${adminSession.token}`);
    expect(list.status).toBe(200);
    const ownerRow = (list.body.items as Array<{ id: string; email: string }>).find((s) => s.email === owner.email);
    expect(ownerRow).toBeDefined();

    const revoked = await request(app)
      .post(`/api/security/sessions/${ownerRow!.id}/revoke`)
      .set('Authorization', `Bearer ${adminSession.token}`);
    expect(revoked.status).toBe(200);
    expect((await me(session.token)).status).toBe(401);
  });
});

describe('second-factor hardening', () => {
  beforeEach(enforceStaffMfa);
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetMfaPolicy();
  });

  const captureMail = () => {
    const sent: string[] = [];
    vi.spyOn(getMailer(), 'send').mockImplementation(async (mail) => {
      sent.push(mail.text ?? '');
    });
    return () => /(\d{6})/.exec(sent.at(-1) ?? '')![1];
  };

  it('a password-only session of an enrolled account cannot enrol a new factor to skip its own', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'enrolled@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN', mfaEnabled: true, mfaMethod: 'EMAIL' },
    });
    captureMail();
    const pending = await login(user.email);
    expect(pending.body.mfaRequired).toBe(true);
    const bearer = `Bearer ${pending.body.mfaPendingToken}`;

    expect((await request(app).post('/api/auth/mfa/setup/totp').set('Authorization', bearer)).status).toBe(403);
    expect((await request(app).post('/api/auth/mfa/setup/totp/confirm').set('Authorization', bearer)
      .send({ code: '123456', factorId: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
    expect((await request(app).post('/api/auth/mfa/setup/email/request').set('Authorization', bearer)).status).toBe(403);
    expect((await request(app).post('/api/auth/mfa/setup/email/confirm').set('Authorization', bearer).send({ code: '123456' })).status).toBe(403);
    expect((await me(pending.body.mfaPendingToken)).status).toBe(401);
  });

  it('a TOTP account whose authenticator is not registered signs in with an emailed code instead', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'moved@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN', mfaEnabled: true, mfaMethod: 'TOTP' },
    });
    const lastCode = captureMail();
    const pending = await login(user.email);
    expect(pending.body.mfaRequired).toBe(true);
    expect(pending.body.mfaMethod).toBe('EMAIL');
    const verified = await request(app).post('/api/auth/mfa/verify')
      .send({ mfaPendingToken: pending.body.mfaPendingToken, code: lastCode() });
    expect(verified.status).toBe(200);
    expect((await me(verified.body.accessToken)).status).toBe(200);
  });

  it('a login that still owes MFA cannot be extended through /auth/refresh, even outside a browser', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'pending@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN', mfaEnabled: true, mfaMethod: 'EMAIL' },
    });
    captureMail();
    const pending = await login(user.email);
    const parked = pending.cookies.find((c) => c.startsWith('mfaPendingRefreshToken='))!;
    const rawToken = decodeURIComponent(parked.split(';')[0].split('=')[1]).split('.').slice(1).join('.');
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${rawToken}`);
    expect(refreshed.status).toBe(401);
  });

  it('completing MFA promotes only the parked token of that same login', async () => {
    const [a, b] = await Promise.all(['a', 'b'].map(async (n) => testPrisma.user.create({
      data: { email: `${n}@example.com`, passwordHash: await hashPassword(PASSWORD), role: 'ADMIN', mfaEnabled: true, mfaMethod: 'EMAIL' },
    })));
    const lastCode = captureMail();
    const pendingA = await login(a.email);
    const codeA = lastCode();
    const pendingB = await login(b.email); // same browser: B's parked cookie replaced A's
    const verifiedA = await request(app).post('/api/auth/mfa/verify')
      .set('Cookie', pendingB.cookies)
      .send({ mfaPendingToken: pendingA.body.mfaPendingToken, code: codeA });
    expect(verifiedA.status).toBe(200);
    const setCookies = (verifiedA.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(setCookies.some((c) => c.startsWith('refreshToken=') && !c.startsWith('refreshToken=;'))).toBe(false);
  });

  it('a signed-in TOTP user can move to a new authenticator, confirmed by the new one', async () => {
    const admin = await testPrisma.user.create({
      data: { email: 'mover@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN' },
    });
    const first = await login(admin.email);
    const pendingBearer = `Bearer ${first.body.mfaPendingToken}`;
    const oldSetup = await request(app).post('/api/auth/mfa/setup/totp').set('Authorization', pendingBearer);
    const oldSecret = oldSetup.body.manualEntryKey as string;
    const enrolled = await request(app).post('/api/auth/mfa/setup/totp/confirm').set('Authorization', pendingBearer)
      .send({ code: authenticator.generate(oldSecret), factorId: oldSetup.body.factorId });
    expect(enrolled.status).toBe(200);

    const signedIn = `Bearer ${enrolled.body.accessToken}`;
    const newSetup = await request(app).post('/api/auth/mfa/setup/totp').set('Authorization', signedIn);
    expect(newSetup.status).toBe(200);
    const newSecret = newSetup.body.manualEntryKey as string;
    const wrongDevice = await request(app).post('/api/auth/mfa/setup/totp/confirm').set('Authorization', signedIn)
      .send({ code: authenticator.generate(oldSecret), factorId: newSetup.body.factorId });
    expect(wrongDevice.status).toBe(400);
    const moved = await request(app).post('/api/auth/mfa/setup/totp/confirm').set('Authorization', signedIn)
      .send({ code: authenticator.generate(newSecret), factorId: newSetup.body.factorId });
    expect(moved.status).toBe(200);
  });
});

describe('security console shows the browser, not the API', () => {
  it('records the signing-in browser for each session', async () => {
    const { owner } = await agencyWithUser();
    await request(app).post('/api/auth/login').set('User-Agent', 'PortalTestBrowser/1.0').send({ email: owner.email, password: PASSWORD });
    const admin = await testPrisma.user.create({
      data: { email: 'console@example.com', passwordHash: await hashPassword(PASSWORD), role: 'ADMIN' },
    });
    const adminSession = await login(admin.email);
    const list = await request(app).get('/api/security/sessions').set('Authorization', `Bearer ${adminSession.token}`);
    const row = (list.body.items as Array<{ email: string; userAgent: string | null }>).find((s) => s.email === owner.email);
    expect(row?.userAgent).toBe('PortalTestBrowser/1.0');
  });
});
