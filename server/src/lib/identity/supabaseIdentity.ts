import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { logger } from '../logger';
import { prisma } from '../prisma';
import type {
  AccessClaims,
  CreatedIdentity,
  IdentityProvider,
  IdentitySession,
  RefreshOutcome,
  SessionSummary,
  TotpEnrollment,
} from './identity.types';

const TOTP_ISSUER = 'B2B Resort Booking Portal';
const REQUEST_TIMEOUT_MS = 10_000;

interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  user: { id: string };
}

interface GoTrueFactor {
  id: string;
  factor_type: string;
  status: 'verified' | 'unverified';
  created_at: string;
}

/**
 * Supabase Auth (GoTrue). Admin operations use the service-role key server-side; per-user grants
 * (password, refresh, TOTP) go to the Auth REST API directly so no client-side session state is
 * ever shared between requests. Sessions are read and revoked in `auth.sessions` through the
 * portal's own database connection — the same rows Supabase checks on every refresh.
 */
export class SupabaseIdentity implements IdentityProvider {
  readonly name = 'supabase' as const;
  private readonly authUrl: string;
  private readonly apiKey: string;
  private readonly admin: SupabaseClient;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly sharedSecret: Uint8Array | null;

  constructor() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('IDENTITY_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    this.authUrl = `${base}/auth/v1`;
    this.apiKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    this.admin = createClient(base, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.sharedSecret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;
    // Asymmetric signing keys are fetched once and cached; tokens then verify locally.
    this.jwks = this.sharedSecret ? null : createRemoteJWKSet(new URL(`${this.authUrl}/.well-known/jwks.json`));
  }

  // --- grants ---------------------------------------------------------------------------------

  async signInWithPassword(email: string, password: string): Promise<IdentitySession | null> {
    const res = await this.call('/token?grant_type=password', { body: { email, password } });
    if (res.status === 400 || res.status === 401) return null; // wrong email or password
    return toSession(await this.expectOk<GoTrueSession>(res, 'sign in'));
  }

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    const res = await this.call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
    if (res.status === 400 || res.status === 401 || res.status === 404) {
      // Refused. A token Supabase already rotated out (outside its short reuse window) is a replay.
      // Best effort: only tokens Supabase stores in auth.refresh_tokens can be traced to a user;
      // Supabase refuses replays either way.
      const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
        select user_id::text from auth.refresh_tokens where token = ${refreshToken} and revoked limit 1`;
      return rows[0] ? { status: 'reused', userId: rows[0].user_id } : { status: 'invalid' };
    }
    return { status: 'ok', session: toSession(await this.expectOk<GoTrueSession>(res, 'refresh the session')) };
  }

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const options = { issuer: this.authUrl, audience: 'authenticated' };
      const { payload } = this.sharedSecret
        ? await jwtVerify(token, this.sharedSecret, options)
        : await jwtVerify(token, this.jwks!, options);
      return toClaims(payload);
    } catch {
      return null;
    }
  }

  // --- sessions -------------------------------------------------------------------------------

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ active: boolean }>>`
      select exists(
        select 1 from auth.sessions
         where id = ${sessionId}::uuid and user_id = ${userId}::uuid
           and (not_after is null or not_after > now())
      ) as active`;
    return Boolean(rows[0]?.active);
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const count = await prisma.$executeRaw`delete from auth.sessions where id = ${sessionId}::uuid`;
    return count > 0;
  }

  async revokeUserSessions(userId: string, options: { exceptSessionId?: string } = {}): Promise<number> {
    const keep = options.exceptSessionId ?? null;
    return prisma.$executeRaw`
      delete from auth.sessions
       where user_id = ${userId}::uuid
         and (${keep}::uuid is null or id <> ${keep}::uuid)`;
  }

  async listSessions(limit: number): Promise<SessionSummary[]> {
    const rows = await prisma.$queryRaw<Array<{
      id: string; user_id: string; created_at: Date; refreshed_at: Date | null; user_agent: string | null; ip: string | null;
    }>>`
      select id::text, user_id::text, created_at, refreshed_at, user_agent, host(ip) as ip
        from auth.sessions
       where not_after is null or not_after > now()
       order by coalesce(refreshed_at, created_at) desc
       limit ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      createdAt: r.created_at,
      refreshedAt: r.refreshed_at,
      userAgent: r.user_agent,
      ip: r.ip,
    }));
  }

  // --- users ----------------------------------------------------------------------------------

  async createUser(input: { email: string; password: string }): Promise<CreatedIdentity> {
    const { data, error } = await this.admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
        throw ApiError.conflict('A login with this email already exists');
      }
      if (error?.code === 'weak_password') throw ApiError.badRequest(error.message || 'The password is too weak');
      if (error?.code === 'validation_failed' || error?.code === 'email_address_invalid') {
        throw ApiError.badRequest(error.message || 'The email address is not valid');
      }
      throw this.failure('create the login', error);
    }
    return { id: data.user.id, passwordHash: null };
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(userId, { password });
    if (error?.code === 'weak_password') throw ApiError.badRequest(error.message || 'The password is too weak');
    if (error) throw this.failure('set the password', error);
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404) throw this.failure('delete the login', error);
  }

  // --- TOTP -----------------------------------------------------------------------------------

  async enrollTotp(accessToken: string, email: string): Promise<TotpEnrollment> {
    const { sub } = decodeJwt(accessToken);
    // An abandoned enrolment would block a new one; only finished factors are kept.
    for (const factor of await this.factors(String(sub))) {
      if (factor.factor_type === 'totp' && factor.status === 'unverified') await this.deleteFactor(String(sub), factor.id);
    }
    const res = await this.call('/factors', {
      token: accessToken,
      body: { factor_type: 'totp', issuer: TOTP_ISSUER, friendly_name: `${email} · ${new Date().toISOString()}` },
    });
    const factor = await this.expectOk<{ id: string; totp: { qr_code: string; secret: string; uri: string } }>(res, 'start authenticator setup');
    return {
      factorId: factor.id,
      otpauthUrl: factor.totp.uri,
      qrCodeDataUrl: factor.totp.qr_code,
      manualEntryKey: factor.totp.secret,
    };
  }

  async verifyTotp(accessToken: string, code: string, factorId?: string): Promise<IdentitySession | null> {
    const { sub } = decodeJwt(accessToken);
    const totp = (await this.factors(String(sub))).filter((f) => f.factor_type === 'totp');
    // Login checks the confirmed factor; setup confirms the newest pending one.
    const factor = factorId
      ? totp.find((f) => f.id === factorId)
      : totp.find((f) => f.status === 'verified')
        ?? totp.filter((f) => f.status === 'unverified').sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!factor) return null;

    const challengeRes = await this.call(`/factors/${factor.id}/challenge`, { token: accessToken, body: {} });
    const challenge = await this.expectOk<{ id: string }>(challengeRes, 'start the authenticator check');
    const verifyRes = await this.call(`/factors/${factor.id}/verify`, {
      token: accessToken,
      body: { challenge_id: challenge.id, code },
    });
    if (verifyRes.status === 400 || verifyRes.status === 422) return null; // wrong or expired code
    return toSession(await this.expectOk<GoTrueSession>(verifyRes, 'verify the authenticator code'));
  }

  async hasVerifiedTotp(userId: string): Promise<boolean> {
    return (await this.factors(userId)).some((f) => f.factor_type === 'totp' && f.status === 'verified');
  }

  async removeTotp(userId: string): Promise<void> {
    for (const factor of await this.factors(userId)) {
      if (factor.factor_type === 'totp') await this.deleteFactor(userId, factor.id);
    }
  }

  // --- plumbing -------------------------------------------------------------------------------

  private async factors(userId: string): Promise<GoTrueFactor[]> {
    const { data, error } = await this.admin.auth.admin.mfa.listFactors({ userId });
    if (error) throw this.failure('read authenticator factors', error);
    return (data?.factors ?? []) as unknown as GoTrueFactor[];
  }

  private async deleteFactor(userId: string, id: string): Promise<void> {
    const { error } = await this.admin.auth.admin.mfa.deleteFactor({ userId, id });
    if (error && error.status !== 404) throw this.failure('remove an authenticator factor', error);
  }

  private async call(path: string, options: { body: unknown; token?: string }): Promise<Response> {
    try {
      return await fetch(`${this.authUrl}${path}`, {
        method: 'POST',
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/json',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.failure('reach Supabase Auth', error);
    }
  }

  private async expectOk<T>(res: Response, action: string): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429) throw ApiError.tooManyRequests('Too many attempts. Please wait a moment and try again.');
    // e.g. adding an authenticator from a session that has not passed the one it already has.
    if (res.status === 403) throw ApiError.forbidden('This step needs your current second factor first.');
    const detail = await res.text().catch(() => '');
    throw this.failure(action, { status: res.status, message: detail.slice(0, 300) });
  }

  private failure(action: string, error: unknown): ApiError {
    logger.error(`Supabase Auth: could not ${action}`, { error });
    return ApiError.serviceUnavailable('Sign-in is temporarily unavailable. Please try again.');
  }
}

function toClaims(payload: JWTPayload): AccessClaims | null {
  const sessionId = payload.session_id;
  // Only end-user tokens: never the anon or service-role keys, which are also signed JWTs.
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || typeof sessionId !== 'string') return null;
  return { userId: payload.sub, sessionId, aal: payload.aal === 'aal2' ? 'aal2' : 'aal1' };
}

function toSession(raw: GoTrueSession): IdentitySession {
  const claims = decodeJwt(raw.access_token);
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_at ?? Math.floor(Date.now() / 1000) + raw.expires_in,
    userId: raw.user?.id ?? String(claims.sub),
    sessionId: String(claims.session_id),
  };
}
