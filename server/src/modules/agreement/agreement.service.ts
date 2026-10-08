import crypto from 'node:crypto';
import type { ActorRole, Agency, CommercialConfiguration, Verification } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getStorage } from '../../lib/storage';
import { getDigio } from '../../lib/digio';
import { ApiError } from '../../utils/apiError';
import { recordAuditLog, recordAuditLogSafe } from '../audit/audit.service';
import { withNewLogin } from '../../lib/identity';
import { generateStrongPassword } from '../auth/passwordPolicy';
import { transitionApplication } from '../lifecycle/lifecycle.service';
import { notify } from '../notifications/notification.service';

interface Actor {
  actorId: string | null;
  actorRole: ActorRole;
}

/** Builds the partnership agreement HTML embedding the agreed commercial terms + standard clauses. */
export function buildAgreementHtml(
  agency: Agency,
  config: CommercialConfiguration,
): string {
  return `<!doctype html><html><body>
  <h1>Partnership Agreement</h1>
  <p>This agreement is between the Company and <strong>${agency.legalName}</strong>
     (GSTIN ${agency.gstin}, PAN ${agency.pan}).</p>
  <h2>Commercial terms</h2>
  <ul>
    <li>Tier: ${config.tier}</li>
    <li>Payment mode: ${config.paymentMode}</li>
    <li>Credit limit: ₹${config.creditLimit.toString()}</li>
    <li>Payment terms: ${config.paymentTerms}</li>
    <li>Agency markup: ${config.markupPct.toString()}%</li>
  </ul>
  <h2>Standard clauses</h2>
  <p>The agency price is computed as base rate × (1 + markup%). All financial
     obligations are settled on the agency price. The portal is for business
     partners only; end customers do not access it.</p>
  </body></html>`;
}

export interface AgreementSentResult {
  agreementDocumentId: string;
  esignVerificationId: string;
  signingUrl: string;
}

/**
 * Generates the agreement, stores it, initiates Digio Aadhaar eSign, records an
 * ESIGN verification row, and emails the signing link to the representative.
 * Only valid while the application is in COMMERCIAL_CONFIGURATION.
 */
export async function generateAndSendAgreement(
  applicationId: string,
  actor: Actor,
): Promise<AgreementSentResult> {
  const application = await prisma.agencyApplication.findUnique({
    where: { id: applicationId },
    include: { agency: { include: { commercialConfigurations: { where: { isCurrent: true } } } } },
  });
  if (!application) throw ApiError.notFound('Application not found');
  if (application.lifecycleState !== 'COMMERCIAL_CONFIGURATION') {
    throw ApiError.conflict('Agreement can only be sent after commercial configuration');
  }
  const agency = application.agency;
  const config = agency?.commercialConfigurations[0];
  if (!agency || !config) {
    throw ApiError.conflict('Commercial configuration must be set before sending the agreement');
  }

  const html = buildAgreementHtml(agency, config);
  const buffer = Buffer.from(html, 'utf8');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const storageKey = `agreements/${applicationId}/agreement-${crypto.randomUUID()}.html`;
  await getStorage().put(storageKey, buffer, 'text/html');

  const agreementDoc = await prisma.document.create({
    data: {
      applicationId,
      agencyId: agency.id,
      docType: 'AGREEMENT',
      storageKey,
      checksum,
      fileName: 'agreement.html',
      contentType: 'text/html',
      status: 'UPLOADED',
    },
  });

  const esign = await getDigio().initiateESign({
    applicationId,
    documentStorageKey: storageKey,
    signerName: application.repName,
    signerEmail: application.repEmail,
    signerAadhaarRef: application.repAadhaarRef,
  });

  const verification = await prisma.verification.create({
    data: {
      applicationId,
      checkType: 'ESIGN',
      status: 'IN_PROGRESS',
      providerRef: esign.providerRef,
      requestPayload: { event: 'sent', signingUrl: esign.signingUrl },
      initiatedAt: new Date(),
    },
  });

  await recordAuditLog({
    entityType: 'AgencyApplication',
    entityId: applicationId,
    event: 'AGREEMENT_SENT',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { providerRef: esign.providerRef, agreementDocumentId: agreementDoc.id },
  });

  await notify(
    { event: 'AGREEMENT_ESIGN_REQUEST', applicationId, signingUrl: esign.signingUrl },
    { email: application.repEmail, phone: application.repMobile },
    { entityType: 'AgencyApplication', entityId: applicationId },
  );

  return {
    agreementDocumentId: agreementDoc.id,
    esignVerificationId: verification.id,
    signingUrl: esign.signingUrl,
  };
}

/**
 * Handles an eSign webhook result for an ESIGN verification. On signed →
 * stores the signed document and activates the agency. On declined/expired →
 * holds at COMMERCIAL_CONFIGURATION and notifies admin. Idempotency (terminal
 * check already applied) is enforced by the caller.
 */
export async function handleESignResult(
  verification: Verification,
  status: 'passed' | 'failed' | 'manual_review',
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const mapped = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : 'MANUAL_REVIEW';

  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verification.id },
      data: { status: mapped, responsePayload: (data ?? {}) as object, completedAt: new Date() },
    });
    await recordAuditLog(
      {
        entityType: 'Verification',
        entityId: verification.id,
        event: status === 'passed' ? 'AGREEMENT_SIGNED' : 'AGREEMENT_DECLINED',
        actorId: null,
        actorRole: 'DIGIO',
        after: { status: mapped, event: data?.event ?? null },
      },
      tx,
    );
  });

  if (status === 'passed') {
    await activateAgencyForApplication(verification.applicationId, { actorId: null, actorRole: 'SYSTEM' });
  } else {
    await recordAuditLogSafe({
      entityType: 'AgencyApplication',
      entityId: verification.applicationId,
      event: 'ACTIVATION_HELD',
      actorId: null,
      actorRole: 'SYSTEM',
      after: { reason: `eSign ${status}` },
    });
  }
}

/** Admin manual-activate fallback — refuses to activate without a signed agreement (§8). */
export async function activateIfSigned(applicationId: string, actor: Actor): Promise<ActivationResult> {
  const esign = await prisma.verification.findFirst({
    where: { applicationId, checkType: 'ESIGN' },
    orderBy: { initiatedAt: 'desc' },
  });
  if (!esign || esign.status !== 'PASSED') {
    throw ApiError.conflict('Cannot activate — the agreement has not been signed');
  }
  return activateAgencyForApplication(applicationId, actor);
}

export interface ActivationResult {
  agencyId: string;
  agencyUserEmail: string;
  temporaryPassword?: string;
}

/**
 * Activates the agency: stores the signed agreement, transitions
 * COMMERCIAL_CONFIGURATION → ACTIVE, stamps activatedAt, and creates the
 * agency's initial AGENCY-role user with a temporary password (idempotent — a
 * re-run won't duplicate the user). Shared by the eSign webhook and the admin
 * manual-activate fallback.
 */
export async function activateAgencyForApplication(
  applicationId: string,
  actor: Actor,
): Promise<ActivationResult> {
  const application = await prisma.agencyApplication.findUnique({
    where: { id: applicationId },
    include: { agency: true },
  });
  if (!application) throw ApiError.notFound('Application not found');
  if (!application.agency) throw ApiError.conflict('No agency to activate for this application');

  const agency = application.agency;
  const agencyUserEmail = agency.contactEmail;

  // Transition + activate the agency record.
  if (application.lifecycleState === 'COMMERCIAL_CONFIGURATION') {
    await transitionApplication(applicationId, 'ACTIVE', actor, { reason: 'Agreement signed' });
  } else if (application.lifecycleState !== 'ACTIVE') {
    throw ApiError.conflict(`Cannot activate an application in state ${application.lifecycleState}`);
  }
  await prisma.agency.update({
    where: { id: agency.id },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });

  // Create the initial agency user (idempotent).
  const existing = await prisma.user.findUnique({ where: { email: agencyUserEmail } });
  let temporaryPassword: string | undefined;
  if (!existing) {
    // v3 §10.2 — policy-compliant temp password; force a change at first login.
    temporaryPassword = generateStrongPassword(14);
    const user = await withNewLogin({ email: agencyUserEmail, password: temporaryPassword }, (login) => prisma.user.create({
      data: {
        id: login.id,
        email: agencyUserEmail,
        passwordHash: login.passwordHash,
        role: 'AGENCY',
        agencyId: agency.id,
        mustChangePassword: true,
      },
    }));
    await recordAuditLogSafe({
      entityType: 'User',
      entityId: user.id,
      event: 'AGENCY_USER_CREATED',
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      after: { email: agencyUserEmail, agencyId: agency.id },
    });
  }

  await notify(
    { event: 'AGENCY_ACTIVATED', loginUrl: env.APP_BASE_URL, temporaryPassword },
    { email: agencyUserEmail, phone: application.repMobile },
    { entityType: 'Agency', entityId: agency.id },
  );

  await recordAuditLogSafe({
    entityType: 'Agency',
    entityId: agency.id,
    event: 'AGENCY_ACTIVATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });

  return { agencyId: agency.id, agencyUserEmail, temporaryPassword };
}
