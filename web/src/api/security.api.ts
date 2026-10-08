import { httpClient } from './httpClient';

export interface Session {
  id: string;
  user: string;
  email: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface FailedLogin {
  email: string;
  role: string | null;
  attempts: number;
  lastAttempt: string;
}

export interface SecurityPolicy {
  password: { minLength: number; requires: string[] };
  mfa: { enabled: boolean; enforcedAdmin: boolean; enforcedAgency: boolean; enforcedAgent: boolean };
  session: { provider: string; refreshTokenTtlDays: number };
}

export interface Integration {
  key: string;
  name: string;
  provider: string;
  live: boolean;
  configured: boolean;
  category: string;
}

export async function listSessions(): Promise<Session[]> {
  return (await httpClient.get('/security/sessions')).data.items;
}

export async function revokeSession(id: string): Promise<{ revoked: boolean }> {
  return (await httpClient.post(`/security/sessions/${id}/revoke`)).data;
}

export async function listFailedLogins(): Promise<FailedLogin[]> {
  return (await httpClient.get('/security/failed-logins')).data.items;
}

export async function getPolicy(): Promise<SecurityPolicy> {
  return (await httpClient.get('/security/policy')).data;
}

export async function getIntegrations(): Promise<Integration[]> {
  return (await httpClient.get('/security/integrations')).data.items;
}
