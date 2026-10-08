import type { Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getIdentity, type IdentitySession } from '../../lib/identity';
import { ApiError } from '../../utils/apiError';
import { recordAuditLogSafe } from '../audit/audit.service';
import { isMaintenanceMode, getMfaPolicy } from '../settings/settings.service';
import { assertStrongPassword } from './passwordPolicy';
import { sendLoginEmailOtp, verifyEmailLoginCode } from './mfa/mfa.service';

/**
 * v3 §10.2 — mandatory-MFA matrix, now admin-configurable at runtime (System
 * Settings → Security). Master switch off ⇒ MFA never required. Otherwise
 * ADMIN/VERIFIER, AGENCY and AGENT are each enforced per their flag; anyone not
 * force-enrolled still follows their own opt-in mfaEnabled flag.
 */
export function isMfaRequiredForRole(role: Role, mfaEnabled: boolean): boolean {
  const policy = getMfaPolicy();
  if (!policy.mfaEnabled) return false; // master switch off
  if (policy.enforceAdmin && (role === 'ADMIN' || role === 'VERIFIER')) return true;
  if (policy.enforceAgency && role === 'AGENCY') return true;
  if (policy.enforceAgent && role === 'AGENT') return true;
  return mfaEnabled;
}

export interface SafeUser {
  id: string;
  email: string;
  role: Role;
  agencyId: string | null;
  mfaEnabled: boolean;
  mfaMethod: 'NONE' | 'TOTP' | 'EMAIL';
  mustChangePassword: boolean;
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    agencyId: user.agencyId,
    mfaEnabled: user.mfaEnabled,
    mfaMethod: user.mfaMethod,
    mustChangePassword: user.mustChangePassword,
  };
}

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/**
 * Every outcome carries the Supabase session: the controller keeps its refresh token in the
 * httpOnly cookie. A session that still owes MFA can only reach the MFA routes
 * (middleware/auth.ts), so handing it out before the second factor grants nothing else.
 */
export type LoginResult =
  | { status: 'ok'; user: SafeUser; session: IdentitySession }
  | { status: 'mfa_required'; mfaMethod: 'TOTP' | 'EMAIL'; session: IdentitySession }
  | { status: 'mfa_setup_required'; session: IdentitySession };

const audit = (user: Pick<User, 'id' | 'role'>, event: string) =>
  recordAuditLogSafe({ entityType: 'User', entityId: user.id, event, actorId: user.id, actorRole: user.role });

export async function login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const identity = getIdentity();
  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    identity.signInWithPassword(email, password, meta),
  ]);

  if (!session) {
    if (user) await audit(user, 'LOGIN_FAILED');
    throw ApiError.unauthorized('Invalid email or password');
  }
  // An Auth account with no portal user behind it (or a different one) grants nothing.
  if (!user || user.id !== session.userId) {
    await identity.revokeSession(session.sessionId);
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (user.status === 'SUSPENDED') {
    await identity.revokeSession(session.sessionId);
    await audit(user, 'LOGIN_BLOCKED_SUSPENDED');
    throw ApiError.forbidden('This account has been suspended');
  }

  // Maintenance mode (System Settings → Portal): only staff (ADMIN/VERIFIER) may
  // sign in; agency/agent logins are blocked until it is turned off.
  if (isMaintenanceMode() && user.role !== 'ADMIN' && user.role !== 'VERIFIER') {
    await identity.revokeSession(session.sessionId);
    await audit(user, 'LOGIN_BLOCKED_MAINTENANCE');
    throw ApiError.forbidden('The portal is under maintenance. Please try again later.');
  }

  const mfaRequired = isMfaRequiredForRole(user.role, user.mfaEnabled);
  // A TOTP user whose authenticator is no longer registered with Supabase Auth (e.g. accounts
  // moved over from the previous login system) enrols again rather than being locked out.
  const factorReady = user.mfaMethod !== 'TOTP' || (await identity.hasVerifiedTotp(user.id));

  if (mfaRequired && (!user.mfaEnabled || !factorReady)) {
    await audit(user, 'LOGIN_MFA_SETUP_REQUIRED');
    return { status: 'mfa_setup_required', session };
  }

  if (mfaRequired) {
    if (user.mfaMethod === 'EMAIL') await sendLoginEmailOtp(user.id, user.email);
    await audit(user, 'LOGIN_MFA_PENDING');
    return { status: 'mfa_required', mfaMethod: user.mfaMethod as 'TOTP' | 'EMAIL', session };
  }

  await audit(user, 'LOGIN_SUCCESS');
  return { status: 'ok', user: toSafeUser(user), session };
}

export interface MfaVerifyResult {
  user: SafeUser;
  accessToken: string;
  /** Set when the provider rotated the session's tokens (TOTP); the cookie must follow. */
  session: IdentitySession | null;
}

/**
 * Completes a login that owes its second factor. TOTP is checked by Supabase Auth and upgrades
 * the session to aal2; an EMAIL code is checked here and recorded against the session id.
 */
export async function verifyMfaAndLogin(mfaPendingToken: string, code: string): Promise<MfaVerifyResult> {
  const identity = getIdentity();
  const claims = await identity.verifyAccessToken(mfaPendingToken);
  if (!claims || !(await identity.isSessionActive(claims.sessionId))) {
    throw ApiError.unauthorized('MFA session expired, please log in again');
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.userId } });

  let session: IdentitySession | null = null;
  let valid: boolean;
  if (user.mfaMethod === 'TOTP') {
    session = await identity.verifyTotp(mfaPendingToken, code);
    valid = session !== null;
  } else {
    valid = await verifyEmailLoginCode(user.id, code);
    if (valid) await recordEmailMfa(claims.sessionId, user.id);
  }

  if (!valid) {
    await audit(user, 'LOGIN_MFA_FAILED');
    throw ApiError.unauthorized('Invalid or expired code');
  }

  await audit(user, 'LOGIN_SUCCESS_MFA');
  return { user: toSafeUser(user), accessToken: session?.accessToken ?? mfaPendingToken, session };
}

/** Marks an Auth session as having passed the EMAIL second factor. */
export async function recordEmailMfa(sessionId: string, userId: string): Promise<void> {
  await prisma.mfaSession.upsert({
    where: { sessionId },
    create: { sessionId, userId },
    update: { verifiedAt: new Date() },
  });
}

/**
 * Rotates the refresh token. A suspended account's session is ended rather than renewed. A
 * replayed (already rotated) token is treated as stolen: it is refused, audited, and every
 * session of that user is ended so the thief's copy dies with the owner's.
 */
export async function refreshSession(refreshToken: string): Promise<IdentitySession> {
  const identity = getIdentity();
  const outcome = await identity.refresh(refreshToken);
  if (outcome.status === 'reused') {
    await identity.revokeUserSessions(outcome.userId);
    await recordAuditLogSafe({
      entityType: 'User',
      entityId: outcome.userId,
      event: 'TOKEN_REUSE_DETECTED',
      actorRole: 'SYSTEM',
    });
  }
  if (outcome.status !== 'ok') throw ApiError.unauthorized('Refresh token is no longer valid');
  const { session } = outcome;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } });
  if (!user || user.status === 'SUSPENDED') {
    await identity.revokeSession(session.sessionId);
    throw ApiError.unauthorized('Refresh token is no longer valid');
  }
  return session;
}

/** Ends the caller's session — identified by the bearer token, or failing that by the cookie. */
export async function logout(accessToken: string | undefined, refreshToken: string | undefined): Promise<void> {
  const identity = getIdentity();
  const claims = accessToken ? await identity.verifyAccessToken(accessToken) : null;
  if (claims) {
    await identity.revokeSession(claims.sessionId);
    return;
  }
  if (refreshToken) {
    const outcome = await identity.refresh(refreshToken).catch(() => null);
    if (outcome?.status === 'ok') await identity.revokeSession(outcome.session.sessionId);
  }
}

export interface ChangePasswordResult {
  user: SafeUser;
}

/**
 * v3 §10.2 — self-service password change. Verifies the current password, enforces the policy
 * on the new one, clears mustChangePassword and ends every OTHER session (a changed password
 * invalidates other devices). The caller's own session — including any completed second
 * factor — stays signed in.
 */
export async function changePassword(
  userId: string,
  sessionId: string | undefined,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const identity = getIdentity();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const check = await identity.signInWithPassword(user.email, currentPassword);
  if (!check) {
    await audit(user, 'PASSWORD_CHANGE_FAILED');
    throw ApiError.badRequest('Current password is incorrect');
  }
  // The check itself must not leave a session behind.
  await identity.revokeSession(check.sessionId);

  assertStrongPassword(newPassword);
  if (newPassword === currentPassword) {
    throw ApiError.badRequest('New password must be different from the current one');
  }

  await identity.setPassword(user.id, newPassword);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
  await identity.revokeUserSessions(user.id, { exceptSessionId: sessionId });
  await audit(user, 'PASSWORD_CHANGED');
  return { user: toSafeUser(updated) };
}
