import { httpClient } from './httpClient';
import type { AuthUser, LoginResponse } from '../types/auth';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await httpClient.post<LoginResponse>('/auth/login', { email, password });
  return res.data;
}

export async function verifyMfa(
  mfaPendingToken: string,
  code: string,
): Promise<{ user: AuthUser; accessToken: string }> {
  const res = await httpClient.post('/auth/mfa/verify', { mfaPendingToken, code });
  return res.data;
}

export async function setupTotp(
  mfaPendingTokenOrAccessToken: string,
): Promise<{ factorId: string; otpauthUrl: string; qrCodeDataUrl: string; manualEntryKey: string }> {
  const res = await httpClient.post(
    '/auth/mfa/setup/totp',
    {},
    { headers: { Authorization: `Bearer ${mfaPendingTokenOrAccessToken}` } },
  );
  return res.data;
}

/**
 * Confirms enrolment. Supabase Auth upgrades the session to aal2 and rotates its tokens: the
 * returned access token (and the refresh cookie the server sets) replace the previous ones.
 */
export async function confirmTotp(
  mfaPendingTokenOrAccessToken: string,
  code: string,
  factorId: string,
): Promise<{ mfaEnabled: boolean; mfaMethod: string; accessToken: string }> {
  const res = await httpClient.post(
    '/auth/mfa/setup/totp/confirm',
    { code, factorId },
    { headers: { Authorization: `Bearer ${mfaPendingTokenOrAccessToken}` } },
  );
  return res.data;
}

export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout');
}

/** v3 §10.2 — change password (policy-enforced; revokes other sessions). */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ user: AuthUser; accessToken: string }> {
  const res = await httpClient.post('/auth/change-password', { currentPassword, newPassword });
  return res.data;
}

export async function getMe(): Promise<AuthUser> {
  const res = await httpClient.get<AuthUser>('/users/me');
  return res.data;
}

/** The signed-in user for a token that is not stored yet (right after an MFA step). */
export async function getMeWithToken(accessToken: string): Promise<AuthUser> {
  const res = await httpClient.get<AuthUser>('/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.data;
}
