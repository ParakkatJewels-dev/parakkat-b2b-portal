/**
 * Identity provider seam (same adapter pattern as storage, mailer, payments...).
 *
 * Supabase Auth owns credentials and sessions: users, password hashes, refresh-token rotation,
 * session revocation and TOTP factors. The portal keeps its own `User` row (role, agency,
 * capability flags, MFA policy state) under the SAME id, and its own audit trail.
 *
 * The browser never talks to the provider directly: the API performs every grant on its behalf
 * (modules/auth), so the refresh token stays in an httpOnly cookie and every login, MFA step and
 * password change goes through the portal's suspension/maintenance gates and audit log.
 */

/** A provider session as the API hands it to the browser (refresh token goes in a cookie). */
export interface IdentitySession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  userId: string;
  sessionId: string;
}

/** What the API trusts from a verified access token. */
export interface AccessClaims {
  userId: string;
  sessionId: string;
  /** `aal2` once a TOTP factor was verified in this session. */
  aal: 'aal1' | 'aal2';
}

export interface TotpEnrollment {
  factorId: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  manualEntryKey: string;
}

export interface SessionSummary {
  id: string;
  userId: string;
  createdAt: Date;
  /** Last refresh; null when the session was never refreshed. */
  refreshedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
}

/**
 * `reused`: the token was already rotated out — a replay, i.e. it probably leaked. The provider
 * has refused it; the caller audits it and ends the user's other sessions.
 */
export type RefreshOutcome =
  | { status: 'ok'; session: IdentitySession }
  | { status: 'reused'; userId: string }
  | { status: 'invalid' };

export interface CreatedIdentity {
  id: string;
  /**
   * Only the offline mock keeps credentials in the portal's own `User.passwordHash`. Supabase
   * keeps them in Auth, so this is always null in production.
   */
  passwordHash: string | null;
}

export interface IdentityProvider {
  readonly name: 'supabase' | 'mock';

  /** A new session for valid credentials; null for a wrong email/password. */
  signInWithPassword(email: string, password: string, meta?: { ip?: string; userAgent?: string }): Promise<IdentitySession | null>;
  /** Rotates the refresh token. */
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  /** Verifies signature, expiry, issuer and audience. Null for anything untrustworthy. */
  verifyAccessToken(token: string): Promise<AccessClaims | null>;

  isSessionActive(sessionId: string): Promise<boolean>;
  revokeSession(sessionId: string): Promise<boolean>;
  /** Ends every session of a user, optionally keeping the caller's own. Returns the count. */
  revokeUserSessions(userId: string, options?: { exceptSessionId?: string }): Promise<number>;
  listSessions(limit: number): Promise<SessionSummary[]>;

  createUser(input: { email: string; password: string }): Promise<CreatedIdentity>;
  setPassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;

  /** Starts TOTP enrolment for the session's user (any unfinished enrolment is replaced). */
  enrollTotp(accessToken: string, email: string): Promise<TotpEnrollment>;
  /**
   * Verifies a TOTP code for the user's factor. Success upgrades the session to aal2 and returns
   * it (with rotated tokens); null for a wrong or expired code.
   */
  verifyTotp(accessToken: string, code: string, factorId?: string): Promise<IdentitySession | null>;
  hasVerifiedTotp(userId: string): Promise<boolean>;
  removeTotp(userId: string): Promise<void>;
}
