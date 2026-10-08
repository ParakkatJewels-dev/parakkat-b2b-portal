import type { ActorRole, AgencyApplication, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { broadcast } from '../../lib/realtime';
import { ApiError } from '../../utils/apiError';
import { recordAuditLog } from '../audit/audit.service';
import { type LifecycleState, validateTransition } from './lifecycle.machine';

export interface TransitionActor {
  actorId: string | null;
  actorRole: ActorRole;
}

export interface TransitionOptions {
  /**
   * Extra columns to set on the application in the same transaction. Unchecked
   * variant so callers can set scalar FKs (e.g. decidedById) directly.
   */
  data?: Prisma.AgencyApplicationUncheckedUpdateInput;
  /** Human-readable reason (required by callers for REJECTED; stored on the row by the caller via `data`). */
  reason?: string;
}

/**
 * The one function through which every agency-lifecycle transition flows.
 * It (1) loads the application, (2) validates the transition against the
 * state machine and the actor's permission, and (3) applies the state change
 * plus a matching audit-log row in a single transaction — so an application
 * can never change state without a legal, permitted, recorded transition.
 */
export async function transitionApplication(
  applicationId: string,
  toState: LifecycleState,
  actor: TransitionActor,
  options: TransitionOptions = {},
): Promise<AgencyApplication> {
  const application = await prisma.agencyApplication.findUnique({ where: { id: applicationId } });
  if (!application) {
    throw ApiError.notFound('Application not found');
  }

  const fromState = application.lifecycleState;
  const error = validateTransition(fromState, toState, actor.actorRole);
  if (error) {
    if (error.kind === 'forbidden_actor') {
      throw ApiError.forbidden(
        `Role ${actor.actorRole} may not move an application from ${fromState} to ${toState}`,
      );
    }
    throw ApiError.badRequest(`Illegal lifecycle transition ${fromState} → ${toState}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.agencyApplication.update({
      where: { id: applicationId },
      data: { lifecycleState: toState, ...options.data },
    });

    await recordAuditLog(
      {
        entityType: 'AgencyApplication',
        entityId: applicationId,
        event: `LIFECYCLE_${fromState}_TO_${toState}`,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        before: { lifecycleState: fromState },
        after: { lifecycleState: toState, reason: options.reason ?? null },
      },
      tx,
    );

    return updated;
  });

  // Live-update the admin queue/dashboard.
  await broadcast(['applications']);
  return result;
}
