import { env } from '../../config/env';
import { getIdentity } from '../../lib/identity';
import { prisma } from '../../lib/prisma';
import { getMfaPolicy } from '../settings/settings.service';

/** Live Supabase Auth sessions of portal users, most recently active first. */
export async function listActiveSessions() {
  const sessions = await getIdentity().listSessions(200);
  const [users, infos] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...new Set(sessions.map((s) => s.userId))] } },
      select: { id: true, email: true, name: true, role: true },
    }),
    // The browser's address and agent, recorded at sign-in (Supabase only saw the API's).
    prisma.authSessionInfo.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const infoBySession = new Map(infos.map((i) => [i.sessionId, i]));
  return sessions.flatMap((s) => {
    const user = byId.get(s.userId);
    if (!user) return []; // an Auth account the portal does not know grants nothing; not listed
    const info = infoBySession.get(s.id);
    return [{
      id: s.id,
      user: user.name ?? user.email,
      email: user.email,
      role: user.role,
      ip: info?.ip ?? s.ip,
      userAgent: info?.userAgent ?? s.userAgent,
      createdAt: s.createdAt,
      lastActiveAt: s.refreshedAt ?? s.createdAt,
    }];
  });
}

export async function revokeSession(id: string): Promise<{ revoked: boolean }> {
  return { revoked: await getIdentity().revokeSession(id) };
}

/** Recent failed-login attempts, grouped by user with attempt counts (from the audit log). */
export async function recentFailedLogins() {
  const logs = await prisma.auditLog.findMany({
    where: { event: 'LOGIN_FAILED' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { email: true, role: true } } },
  });
  const map = new Map<string, { email: string; role: string | null; attempts: number; lastAttempt: Date }>();
  for (const l of logs) {
    const email = l.actor?.email ?? l.entityId;
    const cur = map.get(email) ?? { email, role: l.actor?.role ?? null, attempts: 0, lastAttempt: l.createdAt };
    cur.attempts += 1;
    if (l.createdAt > cur.lastAttempt) cur.lastAttempt = l.createdAt;
    map.set(email, cur);
  }
  return [...map.values()].sort((a, b) => b.lastAttempt.getTime() - a.lastAttempt.getTime());
}

/** Effective authentication/security policy (from runtime config). */
export function getSecurityPolicy() {
  return {
    password: {
      minLength: env.PASSWORD_MIN_LENGTH,
      requires: ['One upper-case letter', 'One lower-case letter', 'One digit', 'One symbol'],
    },
    mfa: (() => {
      const p = getMfaPolicy();
      return {
        enabled: p.mfaEnabled,
        enforcedAdmin: p.enforceAdmin,
        enforcedAgency: p.enforceAgency,
        enforcedAgent: p.enforceAgent,
      };
    })(),
    session: {
      provider: 'Supabase Auth',
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    },
  };
}

/** Live status of the third-party integrations, derived from runtime config. */
export function getIntegrationsStatus() {
  const airpay = env.PAYMENT_PROVIDER === 'airpay';
  return [
    { key: 'payment', name: 'Payment Gateway', provider: env.PAYMENT_PROVIDER, live: airpay, configured: airpay ? !!env.AIRPAY_MERCHANT_ID && !!env.AIRPAY_SECRET : true, category: 'Payments' },
    { key: 'email', name: 'Email', provider: env.MAILER_PROVIDER, live: env.MAILER_PROVIDER === 'resend', configured: true, category: 'Messaging' },
    { key: 'sms', name: 'SMS', provider: env.SMS_PROVIDER, live: env.SMS_PROVIDER === 'msg91' && env.SMS_NOTIFICATIONS_ENABLED, configured: env.SMS_NOTIFICATIONS_ENABLED, category: 'Messaging' },
    { key: 'whatsapp', name: 'WhatsApp', provider: env.WHATSAPP_PROVIDER, live: env.WHATSAPP_PROVIDER === 'meta' && env.WHATSAPP_NOTIFICATIONS_ENABLED, configured: env.WHATSAPP_NOTIFICATIONS_ENABLED, category: 'Messaging' },
    { key: 'ekyc', name: 'eKYC (Digio)', provider: env.DIGIO_PROVIDER, live: env.DIGIO_PROVIDER === 'live', configured: env.DIGIO_PROVIDER === 'live' ? !!env.DIGIO_CLIENT_ID : true, category: 'Verification' },
    { key: 'inventory', name: 'Hotel Inventory', provider: env.INVENTORY_PROVIDER, live: env.INVENTORY_PROVIDER === 'crs', configured: true, category: 'Inventory' },
    { key: 'crs', name: 'CRS', provider: env.CRS_PROVIDER, live: env.CRS_PROVIDER === 'live', configured: env.CRS_PROVIDER === 'live' ? !!env.CRS_API_KEY : true, category: 'Inventory' },
    { key: 'einvoice', name: 'E-Invoicing (IRP)', provider: env.EINVOICE_ENABLED ? 'enabled' : 'disabled', live: env.EINVOICE_ENABLED, configured: true, category: 'Finance' },
  ];
}
