import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { prisma } from '../prisma';
import { hashPassword, verifyPassword } from '../../modules/auth/password.service';
import type {
  AccessClaims,
  CreatedIdentity,
  IdentityProvider,
  IdentitySession,
  RefreshOutcome,
  SessionSummary,
  TotpEnrollment,
} from './identity.types';

const ISSUER = 'mock-identity';
const TOKEN_TTL_SECONDS = 60 * 60;
const TOTP_ISSUER = 'B2B Resort Booking Portal';
// One step of clock drift either side, as Supabase Auth allows.
const totp = authenticator.clone({ window: 1 });

interface MockSession {
  id: string;
  userId: string;
  aal: 'aal1' | 'aal2';
  refreshToken: string;
  createdAt: Date;
  refreshedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
}

interface MockFactor {
  id: string;
  secret: string;
  verified: boolean;
}

/**
 * Offline stand-in for Supabase Auth — tests and local development without a Supabase project.
 *
 * Credentials live in `User.passwordHash` (bcrypt), which is why `createUser` hands back a hash
 * for the caller to store; sessions, refresh tokens and TOTP factors live in this process.
 * Behaviour mirrors the real provider where the portal depends on it: refresh rotation with
 * reuse detection, aal2 after a TOTP check, revocation by session or user.
 */
export class MockIdentity implements IdentityProvider {
  readonly name = 'mock' as const;
  private readonly secret = new TextEncoder().encode(env.IDENTITY_MOCK_JWT_SECRET);
  private readonly sessions = new Map<string, MockSession>();
  private readonly refreshTokens = new Map<string, string>(); // token -> session id
  private readonly usedRefreshTokens = new Map<string, string>(); // rotated-out token -> session id
  private readonly factors = new Map<string, MockFactor[]>(); // user id -> factors

  async signInWithPassword(email: string, password: string, meta: { ip?: string; userAgent?: string } = {}): Promise<IdentitySession | null> {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) return null;
    return this.issue(this.openSession(user.id, meta));
  }

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    const sessionId = this.refreshTokens.get(refreshToken);
    if (!sessionId) {
      // A rotated-out token coming back means it leaked: end that session, as Supabase does.
      const reusedSessionId = this.usedRefreshTokens.get(refreshToken);
      const reused = reusedSessionId ? this.sessions.get(reusedSessionId) : undefined;
      if (reusedSessionId) await this.revokeSession(reusedSessionId);
      return reused ? { status: 'reused', userId: reused.userId } : { status: 'invalid' };
    }
    const session = this.sessions.get(sessionId);
    if (!session) return { status: 'invalid' };
    this.refreshTokens.delete(refreshToken);
    this.usedRefreshTokens.set(refreshToken, sessionId);
    session.refreshToken = randomBytes(32).toString('base64url');
    session.refreshedAt = new Date();
    this.refreshTokens.set(session.refreshToken, sessionId);
    return { status: 'ok', session: await this.issue(session) };
  }

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: 'authenticated' });
      if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || typeof payload.session_id !== 'string') return null;
      return { userId: payload.sub, sessionId: payload.session_id, aal: payload.aal === 'aal2' ? 'aal2' : 'aal1' };
    } catch {
      return null;
    }
  }

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    return this.sessions.get(sessionId)?.userId === userId;
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.refreshTokens.delete(session.refreshToken);
    this.sessions.delete(sessionId);
    return true;
  }

  async revokeUserSessions(userId: string, options: { exceptSessionId?: string } = {}): Promise<number> {
    let count = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.userId === userId && session.id !== options.exceptSessionId && (await this.revokeSession(session.id))) count++;
    }
    return count;
  }

  async listSessions(limit: number): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .sort((a, b) => (b.refreshedAt ?? b.createdAt).getTime() - (a.refreshedAt ?? a.createdAt).getTime())
      .slice(0, limit)
      .map(({ id, userId, createdAt, refreshedAt, userAgent, ip }) => ({ id, userId, createdAt, refreshedAt, userAgent, ip }));
  }

  async createUser(input: { email: string; password: string }): Promise<CreatedIdentity> {
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw ApiError.conflict('A login with this email already exists');
    return { id: randomUUID(), passwordHash: await hashPassword(input.password) };
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.revokeUserSessions(userId);
    this.factors.delete(userId);
  }

  async enrollTotp(accessToken: string, email: string): Promise<TotpEnrollment> {
    const claims = await this.requireClaims(accessToken);
    const secret = authenticator.generateSecret();
    const factor: MockFactor = { id: randomUUID(), secret, verified: false };
    const kept = (this.factors.get(claims.userId) ?? []).filter((f) => f.verified);
    this.factors.set(claims.userId, [...kept, factor]);
    const otpauthUrl = authenticator.keyuri(email, TOTP_ISSUER, secret);
    return { factorId: factor.id, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl), manualEntryKey: secret };
  }

  async verifyTotp(accessToken: string, code: string, factorId?: string): Promise<IdentitySession | null> {
    const claims = await this.requireClaims(accessToken);
    const session = this.sessions.get(claims.sessionId);
    const factors = this.factors.get(claims.userId) ?? [];
    const factor = factorId
      ? factors.find((f) => f.id === factorId)
      : factors.find((f) => f.verified) ?? factors.filter((f) => !f.verified).at(-1);
    if (!session || !factor || !totp.verify({ token: code, secret: factor.secret })) return null;
    factor.verified = true;
    this.factors.set(claims.userId, factors.filter((f) => f.verified));
    session.aal = 'aal2';
    // Supabase rotates the session's tokens when it is upgraded.
    this.refreshTokens.delete(session.refreshToken);
    session.refreshToken = randomBytes(32).toString('base64url');
    this.refreshTokens.set(session.refreshToken, session.id);
    return this.issue(session);
  }

  async hasVerifiedTotp(userId: string): Promise<boolean> {
    return (this.factors.get(userId) ?? []).some((f) => f.verified);
  }

  async removeTotp(userId: string): Promise<void> {
    this.factors.delete(userId);
  }

  /**
   * Signs a user in without a password — for tests and local tooling only (this provider never
   * runs in production). `aal2` stands for a session that already completed its second factor.
   */
  async createSessionFor(userId: string, options: { aal?: 'aal1' | 'aal2' } = {}): Promise<IdentitySession> {
    const session = this.openSession(userId, {});
    session.aal = options.aal ?? 'aal1';
    return this.issue(session);
  }

  private openSession(userId: string, meta: { ip?: string; userAgent?: string }): MockSession {
    const session: MockSession = {
      id: randomUUID(),
      userId,
      aal: 'aal1',
      refreshToken: randomBytes(32).toString('base64url'),
      createdAt: new Date(),
      refreshedAt: null,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    };
    this.sessions.set(session.id, session);
    this.refreshTokens.set(session.refreshToken, session.id);
    return session;
  }

  private async issue(session: MockSession): Promise<IdentitySession> {
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const accessToken = await new SignJWT({ role: 'authenticated', session_id: session.id, aal: session.aal })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.userId)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.secret);
    return { accessToken, refreshToken: session.refreshToken, expiresAt, userId: session.userId, sessionId: session.id };
  }

  private async requireClaims(accessToken: string): Promise<AccessClaims> {
    const claims = await this.verifyAccessToken(accessToken);
    if (!claims || !(await this.isSessionActive(claims.sessionId, claims.userId))) {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    return claims;
  }
}
