import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseIdentity } from '../../../src/lib/identity/supabaseIdentity';

// The adapter's contract with Supabase Auth (GoTrue): which endpoints it calls, with what, and
// how answers map to portal outcomes. HTTP and the database are stubbed.

const { SUPABASE_URL, JWT_SECRET, queryRaw, executeRaw } = vi.hoisted(() => ({
  SUPABASE_URL: 'https://project.example.supabase.co',
  JWT_SECRET: 'unit-test-legacy-jwt-secret-0123456789',
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));
const USER = '11111111-1111-4111-8111-111111111111';
const FACTOR = '22222222-2222-4222-8222-222222222222';

vi.mock('../../../src/config/env', () => ({
  env: {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_key',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

const secret = new TextEncoder().encode(JWT_SECRET);
async function accessToken(claims: Record<string, unknown> = {}, issuer = `${SUPABASE_URL}/auth/v1`) {
  return new SignJWT({ role: 'authenticated', session_id: 'session-1', aal: 'aal1', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(secret);
}

let calls: Array<{ url: string; init: RequestInit }>;
let respond: (url: string, init: RequestInit) => Response;

beforeEach(() => {
  calls = [];
  queryRaw.mockReset();
  executeRaw.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return respond(url, init);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('SupabaseIdentity grants', () => {
  it('signs in with the password grant and maps the session', async () => {
    const token = await accessToken();
    respond = () => json({ access_token: token, refresh_token: 'refresh-1', expires_in: 3600, expires_at: 2_000_000_000, user: { id: USER } });

    const session = await new SupabaseIdentity().signInWithPassword('a@example.com', 'pw');

    expect(calls[0].url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('sb_publishable_key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@example.com', password: 'pw' });
    expect(session).toEqual({ accessToken: token, refreshToken: 'refresh-1', expiresAt: 2_000_000_000, userId: USER, sessionId: 'session-1' });
  });

  it('treats a rejected password as bad credentials, but an outage as unavailable', async () => {
    respond = () => json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    await expect(new SupabaseIdentity().signInWithPassword('a@example.com', 'nope')).resolves.toBeNull();

    respond = () => json({ message: 'upstream down' }, 502);
    await expect(new SupabaseIdentity().signInWithPassword('a@example.com', 'pw')).rejects.toMatchObject({ statusCode: 503 });

    respond = () => json({ message: 'slow down' }, 429);
    await expect(new SupabaseIdentity().signInWithPassword('a@example.com', 'pw')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('reports a refused refresh token as reused only when Supabase had already rotated it out', async () => {
    respond = () => json({ error: 'invalid_grant' }, 400);
    queryRaw.mockResolvedValueOnce([{ user_id: 'user-9' }]);
    await expect(new SupabaseIdentity().refresh('old-token')).resolves.toEqual({ status: 'reused', userId: 'user-9' });

    queryRaw.mockResolvedValueOnce([]);
    await expect(new SupabaseIdentity().refresh('unknown-token')).resolves.toEqual({ status: 'invalid' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refresh_token: 'old-token' });
    expect(calls[0].url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  });
});

describe('SupabaseIdentity token verification', () => {
  it('accepts a user token from this project and reads its session and assurance level', async () => {
    const identity = new SupabaseIdentity();
    await expect(identity.verifyAccessToken(await accessToken({ aal: 'aal2' }))).resolves.toEqual({
      userId: USER,
      sessionId: 'session-1',
      aal: 'aal2',
    });
  });

  it('rejects tokens from another issuer, API-key tokens, and forgeries', async () => {
    const identity = new SupabaseIdentity();
    await expect(identity.verifyAccessToken(await accessToken({}, 'https://other.supabase.co/auth/v1'))).resolves.toBeNull();
    await expect(identity.verifyAccessToken(await accessToken({ role: 'service_role' }))).resolves.toBeNull();
    const forged = (await accessToken()).replace(/\.[^.]+$/, '.forged-signature');
    await expect(identity.verifyAccessToken(forged)).resolves.toBeNull();
    // A token signed with someone else's key.
    const foreign = await new SignJWT({ role: 'authenticated', session_id: 's' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('u').setIssuer(`${SUPABASE_URL}/auth/v1`).setAudience('authenticated')
      .setExpirationTime('1h').sign(new TextEncoder().encode('a-different-secret-0123456789012345'));
    await expect(identity.verifyAccessToken(foreign)).resolves.toBeNull();
  });
});

describe('SupabaseIdentity sessions and users', () => {
  it('revokes sessions in auth.sessions, keeping the caller\'s own when asked', async () => {
    executeRaw.mockResolvedValue(2);
    await expect(new SupabaseIdentity().revokeUserSessions('user-1', { exceptSessionId: 'keep-me' })).resolves.toBe(2);
    const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toMatch(/delete from auth\.sessions[\s\S]*user_id = \?::uuid[\s\S]*id <> \?::uuid/);
    expect(values).toEqual(['user-1', 'keep-me', 'keep-me']);
  });

  it('creates confirmed logins through the admin API and maps a duplicate email to a conflict', async () => {
    respond = (url) => url.endsWith('/admin/users') ? json({ id: 'new-user', email: 'n@example.com' }) : json({}, 404);
    await expect(new SupabaseIdentity().createUser({ email: 'n@example.com', password: 'Temp!Pass123' }))
      .resolves.toEqual({ id: 'new-user', passwordHash: null });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ email: 'n@example.com', password: 'Temp!Pass123', email_confirm: true });

    respond = () => json({ code: 'email_exists', msg: 'A user with this email address has already been registered' }, 422);
    await expect(new SupabaseIdentity().createUser({ email: 'n@example.com', password: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('SupabaseIdentity TOTP', () => {
  it('verifies a code through challenge + verify and returns the upgraded session', async () => {
    const pending = await accessToken();
    const upgraded = await accessToken({ aal: 'aal2' });
    respond = (url) => {
      if (url.includes(`/admin/users/${USER}/factors`)) {
        // The admin endpoint answers with a bare array; supabase-js wraps it as { factors }.
        return json([{ id: FACTOR, factor_type: 'totp', status: 'verified', created_at: '2026-01-01T00:00:00Z' }]);
      }
      if (url.endsWith(`/factors/${FACTOR}/challenge`)) return json({ id: 'challenge-1' });
      if (url.endsWith(`/factors/${FACTOR}/verify`)) return json({ access_token: upgraded, refresh_token: 'refresh-2', expires_in: 3600, user: { id: USER } });
      return json({}, 404);
    };

    const session = await new SupabaseIdentity().verifyTotp(pending, '123456');

    const verify = calls.find((c) => c.url.endsWith('/verify'))!;
    expect((verify.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${pending}`);
    expect(JSON.parse(String(verify.init.body))).toEqual({ challenge_id: 'challenge-1', code: '123456' });
    expect(session?.accessToken).toBe(upgraded);
    expect(session?.refreshToken).toBe('refresh-2');
  });

  it('a wrong code is a null result, not an error', async () => {
    respond = (url) => {
      if (url.includes(`/admin/users/${USER}/factors`)) {
        // The admin endpoint answers with a bare array; supabase-js wraps it as { factors }.
        return json([{ id: FACTOR, factor_type: 'totp', status: 'verified', created_at: '2026-01-01T00:00:00Z' }]);
      }
      if (url.endsWith('/challenge')) return json({ id: 'challenge-1' });
      return json({ code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }, 422);
    };
    await expect(new SupabaseIdentity().verifyTotp(await accessToken(), '000000')).resolves.toBeNull();
  });
});
