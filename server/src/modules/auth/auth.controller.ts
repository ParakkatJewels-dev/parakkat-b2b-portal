import type { Request, Response } from 'express';
import { env } from '../../config/env';
import type { IdentitySession } from '../../lib/identity';
import { ApiError } from '../../utils/apiError';
import * as authService from './auth.service';

/**
 * The Supabase Auth refresh token, kept out of reach of page scripts. Only /api/auth reads it
 * (refresh, logout); every other request carries the short-lived access token as a bearer.
 */
const REFRESH_COOKIE_NAME = 'refreshToken';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function setSessionCookie(res: Response, session: IdentitySession): void {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions());
}

/**
 * A login that still owes its second factor parks its refresh token here instead: visible only
 * to the MFA routes and short-lived, so /auth/refresh can never extend a half-finished login.
 */
const PENDING_COOKIE_NAME = 'mfaPendingRefreshToken';
const PENDING_COOKIE_PATH = '/api/auth/mfa';

function setPendingSessionCookie(res: Response, session: IdentitySession): void {
  // Tagged with its session id, so only the login that passes MFA can promote it (another login
  // started in the same browser would have replaced it).
  res.cookie(PENDING_COOKIE_NAME, `${session.sessionId}.${session.refreshToken}`, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: PENDING_COOKIE_PATH,
    maxAge: 15 * 60 * 1000,
  });
}

/**
 * Session `sessionId` has passed its second factor: it becomes a normal signed-in session.
 * `session` is given when the provider rotated the tokens (TOTP); otherwise the parked refresh
 * token is promoted — only if it belongs to that same session.
 */
export function completeMfaSession(
  req: Request,
  res: Response,
  sessionId: string | undefined,
  session?: IdentitySession | null,
): void {
  let refreshToken = session?.refreshToken;
  if (!refreshToken && sessionId) {
    const parked = String(req.cookies?.[PENDING_COOKIE_NAME] ?? '');
    const separator = parked.indexOf('.');
    if (separator > 0 && parked.slice(0, separator) === sessionId) refreshToken = parked.slice(separator + 1);
  }
  if (refreshToken) res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  res.clearCookie(PENDING_COOKIE_NAME, { path: PENDING_COOKIE_PATH });
}

function requestMeta(req: Request) {
  return { userAgent: req.header('user-agent'), ip: req.ip };
}

function bearer(req: Request): string | undefined {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body.email, req.body.password, requestMeta(req));

  if (result.status === 'ok') {
    setSessionCookie(res, result.session);
    res.clearCookie(PENDING_COOKIE_NAME, { path: PENDING_COOKIE_PATH });
    res.status(200).json({ user: result.user, accessToken: result.session.accessToken });
    return;
  }

  setPendingSessionCookie(res, result.session);

  // The pending token is the session's own access token; until the second factor is done it is
  // accepted only by the MFA routes.
  if (result.status === 'mfa_setup_required') {
    res.status(200).json({ mfaSetupRequired: true, mfaPendingToken: result.session.accessToken });
    return;
  }

  res.status(200).json({
    mfaRequired: true,
    mfaMethod: result.mfaMethod,
    mfaPendingToken: result.session.accessToken,
  });
}

export async function verifyMfa(req: Request, res: Response): Promise<void> {
  const result = await authService.verifyMfaAndLogin(req.body.mfaPendingToken, req.body.code);
  completeMfaSession(req, res, result.sessionId, result.session);
  res.status(200).json({ user: result.user, accessToken: result.accessToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) {
    throw ApiError.unauthorized('No refresh token provided');
  }
  const session = await authService.refreshSession(rawToken);
  setSessionCookie(res, session);
  res.status(200).json({ accessToken: session.accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(bearer(req), req.cookies?.[REFRESH_COOKIE_NAME]);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.status(204).send();
}

/** v3 §10.2 — authenticated self-service password change. */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const result = await authService.changePassword(
    req.user!.id,
    req.user!.sessionId,
    req.body.currentPassword,
    req.body.newPassword,
  );
  res.status(200).json({ user: result.user, accessToken: req.user!.accessToken });
}
