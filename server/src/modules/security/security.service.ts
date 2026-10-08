import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getMfaPolicy } from '../settings/settings.service';

/** Active login sessions across all users (non-revoked, unexpired refresh tokens). */
export async function listActiveSessions() {
  const tokens = await prisma.refreshToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { email: true, name: true, role: true } } },
  });
  return tokens.map((t) => ({
    id: t.id,
    user: t.user.name ?? t.user.email,
    email: t.user.email,
    role: t.user.role,
    ip: t.ip,
    userAgent: t.userAgent,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
  }));
}

export async function revokeSession(id: string): Promise<{ revoked: boolean }> {
  const r = await prisma.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  return { revoked: r.count > 0 };
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
      accessTokenTtl: env.ACCESS_TOKEN_TTL,
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
