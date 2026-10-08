import { httpClient } from './httpClient';

/**
 * Self-service MFA management for an already-authenticated user (the access
 * token is injected by the httpClient interceptor). The login-time flow uses the
 * token-passing variants in auth.api; these are for enabling/disabling MFA from
 * account settings.
 */

export interface TotpSetup {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  manualEntryKey: string;
}

export async function startTotp(): Promise<TotpSetup> {
  return (await httpClient.post('/auth/mfa/setup/totp', {})).data;
}

/** Confirms enrolment; the session is upgraded and its tokens rotated (new access token returned). */
export async function confirmTotp(code: string): Promise<{ mfaEnabled: boolean; mfaMethod: string; accessToken: string }> {
  return (await httpClient.post('/auth/mfa/setup/totp/confirm', { code })).data;
}

export async function requestEmailOtp(): Promise<{ sent: boolean }> {
  return (await httpClient.post('/auth/mfa/setup/email/request', {})).data;
}

export async function confirmEmailOtp(code: string): Promise<{ mfaEnabled: boolean; mfaMethod: string }> {
  return (await httpClient.post('/auth/mfa/setup/email/confirm', { code })).data;
}

export async function disableMfa(): Promise<{ mfaEnabled: boolean }> {
  return (await httpClient.post('/auth/mfa/disable', {})).data;
}
