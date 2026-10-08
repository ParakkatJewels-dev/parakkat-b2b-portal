import type { ActorRole, Prisma, VerificationCheckType, VerificationStatus } from '@prisma/client';
import { broadcast } from '../../lib/realtime';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getDigio, MANDATORY_CHECKS } from '../../lib/digio';
import type { DigioResultStatus, DigioWebhookPayload } from '../../lib/digio';
import { ApiError } from '../../utils/apiError';
import { recordAuditLog, recordAuditLogSafe } from '../audit/audit.service';
import { transitionApplication } from '../lifecycle/lifecycle.service';
import { decideProgression } from './verification.progression';

const DIGIO_STATUS_MAP: Record<DigioResultStatus, VerificationStatus> = {
  passed: 'PASSED',
  failed: 'FAILED',
  manual_review: 'MANUAL_REVIEW',
};

/**
 * Kicks off the mandatory Digio checks for an application entering VERIFICATION.
 * Idempotent per (application, checkType): an existing check is left alone.
 * Resilient per check — a Digio hiccup on one check leaves that row PENDING for
 * later re-initiation rather than failing the whole batch.
 */
export async function initiateChecksForApplication(applicationId: string): Promise<void> {
  const application = await prisma.agencyApplication.findUnique({ where: { id: applicationId } });
  if (!application) {
    throw ApiError.notFound('Application not found');
  }

  const digio = getDigio();

  for (const checkType of MANDATORY_CHECKS) {
    if (checkType === 'GST' && application.isIndependent) {
      continue;
    }
    const existing = await prisma.verification.findFirst({
      where: { applicationId, checkType },
    });
    if (existing) continue;

    const verification = await prisma.verification.create({
      data: { applicationId, checkType, status: 'PENDING' },
    });

    try {
      const result = await digio.initiateCheck({
        applicationId,
        checkType,
        gstin: application.gstin,
        pan: application.pan,
        repAadhaarRef: application.repAadhaarRef,
        bankAccount: application.bankAccount,
        ifsc: application.ifsc,
        legalName: application.legalName,
      });
      await prisma.verification.update({
        where: { id: verification.id },
        data: {
          status: 'IN_PROGRESS',
          providerRef: result.providerRef,
          requestPayload: result.requestPayload as Prisma.InputJsonValue,
          initiatedAt: new Date(),
        },
      });
      await recordAuditLogSafe({
        entityType: 'Verification',
        entityId: verification.id,
        event: 'VERIFICATION_INITIATED',
        actorId: null,
        actorRole: 'SYSTEM',
        after: { checkType, providerRef: result.providerRef },
      });
    } catch (err) {
      logger.error('Failed to initiate Digio check', {
        applicationId,
        checkType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Resets the named checks and re-initiates them (verifier requested
 * re-submission). Deletes the old rows so initiateChecksForApplication —
 * which is idempotent per (application, checkType) — recreates them fresh.
 */
export async function reinitiateChecks(
  applicationId: string,
  checkTypes: VerificationCheckType[],
): Promise<void> {
  await prisma.verification.deleteMany({
    where: { applicationId, checkType: { in: checkTypes } },
  });
  await initiateChecksForApplication(applicationId);
}

export interface WebhookResult {
  outcome: 'applied' | 'duplicate' | 'unknown_ref';
}

/**
 * Applies a Digio webhook result. Idempotent: a check that has already reached
 * a terminal state (completedAt set) is not re-applied, so retried callbacks
 * never double-process. Signature validation happens in the route before this.
 */
export async function processWebhook(payload: DigioWebhookPayload): Promise<WebhookResult> {
  const verification = await prisma.verification.findFirst({
    where: { providerRef: payload.providerRef },
  });
  if (!verification) {
    logger.warn('Digio webhook for unknown providerRef', { providerRef: payload.providerRef });
    return { outcome: 'unknown_ref' };
  }
  if (verification.completedAt) {
    return { outcome: 'duplicate' };
  }

  // eSign results follow a different post-processing path (activation), not
  // KYB auto-progression. Delegated to the agreement module.
  if (verification.checkType === 'ESIGN') {
    const { handleESignResult } = await import('../agreement/agreement.service');
    await handleESignResult(verification, payload.status, payload.data);
    return { outcome: 'applied' };
  }

  const status = DIGIO_STATUS_MAP[payload.status];

  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verification.id },
      data: {
        status,
        responsePayload: (payload.data ?? {}) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    await recordAuditLog(
      {
        entityType: 'Verification',
        entityId: verification.id,
        event: 'VERIFICATION_RESULT',
        actorId: null,
        actorRole: 'DIGIO',
        before: { status: verification.status },
        after: { status, providerRef: payload.providerRef },
      },
      tx,
    );
  });

  await evaluateAutoProgression(verification.applicationId);
  // A check result changes the admin queue/detail even without a transition.
  await broadcast(['applications']);
  return { outcome: 'applied' };
}

/**
 * Manual verifier/admin override of a single check (Instructions.md §6 — audited
 * as a verification event). Also re-evaluates auto-progression.
 */
export async function overrideVerification(
  applicationId: string,
  checkType: VerificationCheckType,
  status: VerificationStatus,
  actor: { actorId: string; actorRole: ActorRole },
): Promise<void> {
  const verification = await prisma.verification.findFirst({
    where: { applicationId, checkType },
  });
  if (!verification) {
    throw ApiError.notFound(`No ${checkType} check for this application`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verification.id },
      data: { status, completedAt: new Date() },
    });
    await recordAuditLog(
      {
        entityType: 'Verification',
        entityId: verification.id,
        event: 'VERIFICATION_MANUAL_OVERRIDE',
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        before: { status: verification.status },
        after: { status },
      },
      tx,
    );
  });

  await evaluateAutoProgression(applicationId);
}

/**
 * If the application is still in VERIFICATION and auto-progression is enabled,
 * moves it to REVIEW once all mandatory checks reach a terminal status. Flagged
 * (non-clean) progressions record an extra audit event for the verifier.
 */
export async function evaluateAutoProgression(applicationId: string): Promise<void> {
  if (!env.VERIFICATION_AUTO_PROGRESS) return;

  const application = await prisma.agencyApplication.findUnique({ where: { id: applicationId } });
  if (!application || application.lifecycleState !== 'VERIFICATION') return;

  const verifications = await prisma.verification.findMany({
    where: { applicationId, checkType: { in: MANDATORY_CHECKS } },
  });
  const statuses = verifications.map((v) => v.status);
  const expectedCount = application.isIndependent ? MANDATORY_CHECKS.length - 1 : MANDATORY_CHECKS.length;
  const decision = decideProgression(statuses, expectedCount);

  if (decision.action === 'wait') return;

  await transitionApplication(
    applicationId,
    'REVIEW',
    { actorId: null, actorRole: 'SYSTEM' },
    { reason: decision.action === 'progress_flagged' ? 'One or more checks require manual review' : 'All checks passed' },
  );

  if (decision.action === 'progress_flagged') {
    await recordAuditLogSafe({
      entityType: 'AgencyApplication',
      entityId: applicationId,
      event: 'VERIFICATION_FLAGGED_FOR_REVIEW',
      actorId: null,
      actorRole: 'SYSTEM',
    });
  }
}
