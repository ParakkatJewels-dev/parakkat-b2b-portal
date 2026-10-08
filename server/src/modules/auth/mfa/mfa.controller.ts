import type { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { getIdentity } from '../../../lib/identity';
import { ApiError } from '../../../utils/apiError';
import { recordAuditLog } from '../../audit/audit.service';
import { isMfaRequiredForRole, recordEmailMfa } from '../auth.service';
import { completeMfaSession } from '../auth.controller';
import * as mfaService from './mfa.service';

/** Starts authenticator-app enrolment with Supabase Auth and returns the QR code to scan. */
export async function setupTotp(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const result = await getIdentity().enrollTotp(req.user!.accessToken!, user.email);
  res.status(200).json(result);
}

/**
 * Confirms enrolment with a code from the app. Supabase Auth verifies it and upgrades this
 * session to aal2 with rotated tokens, which the response and cookie carry forward — so a
 * first-login enrolment also completes that login.
 */
export async function confirmTotp(req: Request, res: Response): Promise<void> {
  const session = await getIdentity().verifyTotp(req.user!.accessToken!, req.body.code);
  if (!session) {
    throw ApiError.badRequest('Invalid TOTP code');
  }
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.user!.id },
      data: { mfaEnabled: true, mfaMethod: 'TOTP', mfaSecret: null },
    });
    await recordAuditLog(
      { entityType: 'User', entityId: updated.id, event: 'MFA_ENABLED', actorId: updated.id, actorRole: updated.role },
      tx,
    );
    return updated;
  });
  completeMfaSession(req, res, session);
  res.status(200).json({ mfaEnabled: true, mfaMethod: 'TOTP', accessToken: session.accessToken, userId: user.id });
}

export async function requestEmailSetup(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  await mfaService.requestEmailOtpSetup(user.id, user.email);
  res.status(202).json({ sent: true });
}

/** Confirms email-code MFA; proving the code also satisfies MFA for the current session. */
export async function confirmEmailSetup(req: Request, res: Response): Promise<void> {
  await mfaService.confirmEmailOtpSetup(req.user!.id, req.body.code);
  if (req.user!.sessionId) await recordEmailMfa(req.user!.sessionId, req.user!.id);
  completeMfaSession(req, res);
  res.status(200).json({ mfaEnabled: true, mfaMethod: 'EMAIL' });
}

export async function disableMfa(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  // Cannot opt out if MFA is force-enrolled for this role by the current policy.
  if (isMfaRequiredForRole(user.role, false)) {
    throw ApiError.forbidden('MFA is mandatory for your role and cannot be disabled');
  }
  if (user.mfaMethod === 'TOTP') await getIdentity().removeTotp(user.id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaMethod: 'NONE', mfaSecret: null },
    });
    await tx.mfaSession.deleteMany({ where: { userId: user.id } });
    await recordAuditLog(
      { entityType: 'User', entityId: user.id, event: 'MFA_DISABLED', actorId: user.id, actorRole: user.role },
      tx,
    );
  });
  res.status(200).json({ mfaEnabled: false });
}
