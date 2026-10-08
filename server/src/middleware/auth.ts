import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/apiError';
import { prisma } from '../lib/prisma';
import { getIdentity } from '../lib/identity';
import { isMfaRequiredForRole } from '../modules/auth/auth.service';

/**
 * Resolves the caller from a Supabase Auth access token.
 *
 * The token's signature proves who signed in; the database decides what that still means. Every
 * request therefore re-checks that the session has not been revoked (logout, force-logout,
 * password reset), that the account is not suspended, and that the session completed MFA when
 * the policy requires it — none of which waits for the token to expire.
 *
 * `allowPendingMfa` admits a session that still owes its second factor: only the MFA setup and
 * verification routes use it, with `req.user.mfaVerified = false`.
 */
async function resolveCaller(req: Request, allowPendingMfa: boolean): Promise<void> {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) throw ApiError.unauthorized('Missing bearer token');
  const token = header.slice('Bearer '.length);

  const identity = getIdentity();
  const claims = await identity.verifyAccessToken(token);
  if (!claims) throw ApiError.unauthorized('Invalid or expired token');

  const [user, sessionActive, emailMfa] = await Promise.all([
    prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, role: true, agencyId: true, status: true, mfaEnabled: true },
    }),
    identity.isSessionActive(claims.sessionId),
    prisma.mfaSession.findUnique({ where: { sessionId: claims.sessionId }, select: { userId: true } }),
  ]);
  if (!user || !sessionActive) throw ApiError.unauthorized('Invalid or expired token');
  if (user.status === 'SUSPENDED') throw ApiError.unauthorized('This account has been suspended');

  const mfaVerified = claims.aal === 'aal2' || emailMfa?.userId === user.id;
  if (!mfaVerified && !allowPendingMfa && isMfaRequiredForRole(user.role, user.mfaEnabled)) {
    throw ApiError.unauthorized('Multi-factor authentication is required');
  }

  req.user = {
    id: user.id,
    role: user.role,
    agencyId: user.agencyId,
    mfaVerified,
    sessionId: claims.sessionId,
    accessToken: token,
  };
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  resolveCaller(req, false).then(() => next(), next);
}

/**
 * Accepts a session that has signed in with a password but not yet completed a required second
 * factor. Only for the MFA setup and verification routes — such a session can never satisfy
 * `requireMfaSatisfied` or any route behind `authenticate`.
 */
export function authenticateOrMfaPending(req: Request, _res: Response, next: NextFunction): void {
  resolveCaller(req, true).then(() => next(), next);
}
