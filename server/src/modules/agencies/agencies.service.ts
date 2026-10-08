import type { ActorRole } from '@prisma/client';
import crypto from 'node:crypto';
import { getStorage } from '../../lib/storage';
import { prisma } from '../../lib/prisma';
import { broadcast } from '../../lib/realtime';
import { ApiError } from '../../utils/apiError';
import { recordAuditLog, recordAuditLogSafe } from '../audit/audit.service';
import { transitionApplication } from '../lifecycle/lifecycle.service';
import { notify } from '../notifications/notification.service';
import { generateStrongPassword } from '../auth/passwordPolicy';
import { getIdentity } from '../../lib/identity';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { getTierPreset } from '../commercial/tiers';
import { resolveCommercialTerms } from '../commercial/commercial.mapping';

interface Actor {
  actorId: string;
  actorRole: ActorRole;
}

export interface CreateAgencyInput {
  legalName: string;
  gstin?: string;
  pan: string;
  contactEmail: string;
  contactPhone: string;
  tier: string;
  isIndependent?: boolean;
}

export interface AgencyDocsInput {
  registrationProof?: { buffer: Buffer; originalname: string; mimetype: string };
  addressProof?: { buffer: Buffer; originalname: string; mimetype: string };
}

/**
 * Admin-initiated agency creation (Decision D7 exception path) — bypasses
 * self-service onboarding to create an already-active agency directly.
 */
export async function createAgency(
  input: CreateAgencyInput,
  docs: AgencyDocsInput,
  actor: Actor,
) {
  const preset = getTierPreset(input.tier);
  if (!preset) {
    throw ApiError.badRequest(`Unknown tier: ${input.tier}`);
  }
  const terms = resolveCommercialTerms(preset);

  // The agency user's Auth login is created inside the transaction below; if anything after it
  // fails, the database rolls back and the login is removed here, so nothing is left half-made.
  let newLoginId: string | undefined;
  const { agency, temporaryPassword } = await prisma.$transaction(async (tx) => {
    // 1. Create the dummy/linked AgencyApplication record
    const app = await tx.agencyApplication.create({
      data: {
        legalName: input.legalName,
        gstin: input.gstin || null,
        pan: input.pan,
        businessContactEmail: input.contactEmail,
        businessContactPhone: input.contactPhone,
        isIndependent: !!input.isIndependent,
        lifecycleState: 'ACTIVE',
        submittedAt: new Date(),
        decidedAt: new Date(),
        decision: 'APPROVED',
      },
    });

    // 2. Create the Agency record
    const createdAgency = await tx.agency.create({
      data: {
        applicationId: app.id,
        legalName: input.legalName,
        gstin: input.gstin || '',
        pan: input.pan,
        isIndependent: !!input.isIndependent,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });

    // 3. Create default CommercialConfiguration
    await tx.commercialConfiguration.create({
      data: {
        agencyId: createdAgency.id,
        tier: input.tier.toUpperCase(),
        paymentMode: terms.paymentMode,
        creditLimit: terms.creditLimit,
        paymentTerms: terms.paymentTerms,
        markupPct: terms.markupPct,
        effectiveFrom: new Date(),
        updatedById: actor.actorId,
        isCurrent: true,
      },
    });

    // 4. Upload KYC documents if provided
    if (docs.registrationProof) {
      const file = docs.registrationProof;
      const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const storageKey = `applications/${app.id}/${crypto.randomUUID()}-${file.originalname}`;
      await getStorage().put(storageKey, file.buffer, file.mimetype);
      await tx.document.create({
        data: {
          applicationId: app.id,
          agencyId: createdAgency.id,
          docType: 'REGISTRATION_PROOF',
          storageKey,
          checksum,
          status: 'UPLOADED',
          uploadedById: actor.actorId,
          fileName: file.originalname,
          contentType: file.mimetype,
        },
      });
    }

    if (docs.addressProof) {
      const file = docs.addressProof;
      const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const storageKey = `applications/${app.id}/${crypto.randomUUID()}-${file.originalname}`;
      await getStorage().put(storageKey, file.buffer, file.mimetype);
      await tx.document.create({
        data: {
          applicationId: app.id,
          agencyId: createdAgency.id,
          docType: 'ADDRESS_PROOF',
          storageKey,
          checksum,
          status: 'UPLOADED',
          uploadedById: actor.actorId,
          fileName: file.originalname,
          contentType: file.mimetype,
        },
      });
    }

    // 5. Create the initial agency user (role = AGENCY)
    const agencyUserEmail = createdAgency.contactEmail;
    const existing = await tx.user.findUnique({ where: { email: agencyUserEmail } });
    let tempPassword = '';
    if (!existing) {
      tempPassword = generateStrongPassword(14);
      const login = await getIdentity().createUser({ email: agencyUserEmail, password: tempPassword });
      newLoginId = login.id;
      const user = await tx.user.create({
        data: {
          id: login.id,
          email: agencyUserEmail,
          passwordHash: login.passwordHash,
          role: 'AGENCY',
          agencyId: createdAgency.id,
          mustChangePassword: true,
        },
      });
      await recordAuditLog({
        entityType: 'User',
        entityId: user.id,
        event: 'AGENCY_USER_CREATED',
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        after: { email: agencyUserEmail, agencyId: createdAgency.id },
      }, tx);
    }

    // 6. Record the agency creation audit log
    await recordAuditLog({
      entityType: 'Agency',
      entityId: createdAgency.id,
      event: 'AGENCY_CREATED_BY_ADMIN',
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      after: { legalName: createdAgency.legalName, gstin: createdAgency.gstin, tier: input.tier },
    }, tx);

    return { agency: createdAgency, temporaryPassword: tempPassword || undefined };
  }).catch(async (error: unknown) => {
    if (newLoginId) {
      await getIdentity().deleteUser(newLoginId).catch((cleanupError: unknown) =>
        logger.error('Could not remove the login of an agency that failed to save', { userId: newLoginId, cleanupError }),
      );
    }
    throw error;
  });

  // 5. Send notification with credentials
  if (temporaryPassword) {
    await notify(
      { event: 'AGENCY_ACTIVATED', loginUrl: env.APP_BASE_URL, temporaryPassword },
      { email: agency.contactEmail, phone: agency.contactPhone },
      { entityType: 'Agency', entityId: agency.id },
    );
  }

  await broadcast(['agencies']);
  return agency;
}

/**
 * Hard-deletes an agency — only when it has no financial history (bookings,
 * invoices, payments), so nothing traceable is orphaned. Removes its users and
 * commercial configs in the same transaction.
 */
export async function deleteAgency(agencyId: string, actor: Actor) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');

  const [bookings, invoices, payments] = await Promise.all([
    prisma.booking.count({ where: { agencyId } }),
    prisma.invoice.count({ where: { agencyId } }),
    prisma.payment.count({ where: { agencyId } }),
  ]);
  if (bookings > 0 || invoices > 0 || payments > 0) {
    throw ApiError.conflict('Cannot delete an agency that has bookings, invoices, or payments');
  }

  const users = await prisma.user.findMany({ where: { agencyId }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { agencyId } });
    await tx.document.updateMany({ where: { agencyId }, data: { agencyId: null } });
    // commercialConfigurations cascade on agency delete.
    await tx.agency.delete({ where: { id: agencyId } });
  });
  for (const user of users) await getIdentity().deleteUser(user.id);
  await recordAuditLogSafe({
    entityType: 'Agency',
    entityId: agencyId,
    event: 'AGENCY_DELETED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: { legalName: agency.legalName },
  });
  await broadcast(['agencies'], { agencyId });
  return { deleted: true };
}

export interface ListAgenciesParams {
  page: number;
  pageSize: number;
}

export async function listAgencies({ page, pageSize }: ListAgenciesParams) {
  const [items, total] = await Promise.all([
    prisma.agency.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.agency.count(),
  ]);
  return { items, total, page, pageSize };
}

export async function getAgencyById(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: { commercialConfigurations: { where: { isCurrent: true } } },
  });
  if (!agency) {
    throw ApiError.notFound('Agency not found');
  }
  return agency;
}

/** An agency's own profile + current commercial terms + KYC documents (AGENCY self-view). */
export async function getMyAgencyProfile(agencyId: string) {
  const agency = await prisma.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: {
      id: true,
      legalName: true,
      gstin: true,
      pan: true,
      isIndependent: true,
      status: true,
      contactEmail: true,
      contactPhone: true,
      defaultResaleMarkupPct: true,
      activatedAt: true,
      createdAt: true,
      commercialConfigurations: {
        where: { isCurrent: true },
        take: 1,
        select: { tier: true, paymentMode: true, creditLimit: true, paymentTerms: true, markupPct: true },
      },
      documents: {
        select: { id: true, docType: true, fileName: true, status: true, uploadedAt: true },
        orderBy: { uploadedAt: 'desc' },
      },
    },
  });
  const { commercialConfigurations, ...rest } = agency;
  return { ...rest, commercial: commercialConfigurations[0] ?? null };
}

/** B2B resale layer — read the default markup (agents need it to prefill the booking form). */
export async function getMyResaleMarkup(agencyId: string) {
  return prisma.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { id: true, defaultResaleMarkupPct: true },
  });
}

/**
 * B2B resale layer — the agency sets the default markup % applied on top of its
 * buy price to make the customer-facing sell price (overridable per booking).
 */
export async function updateMyResaleMarkup(agencyId: string, resaleMarkupPct: number) {
  const agency = await prisma.agency.update({
    where: { id: agencyId },
    data: { defaultResaleMarkupPct: resaleMarkupPct },
    select: { id: true, defaultResaleMarkupPct: true },
  });
  return agency;
}

/**
 * Rich admin view of a single agency: profile, current commercial terms, its
 * users and KYC documents, plus a financial roll-up (bookings, invoiced, paid,
 * outstanding AR). Backs the admin agency detail page.
 */
export async function getAgencyDetail(id: string) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      commercialConfigurations: { where: { isCurrent: true }, take: 1 },
      users: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          canBook: true,
          canCancel: true,
          canModify: true,
          canViewReports: true,
          createdAt: true,
        },
      },
      documents: {
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          docType: true,
          status: true,
          fileName: true,
          uploadedAt: true,
        },
      },
    },
  });
  if (!agency) {
    throw ApiError.notFound('Agency not found');
  }

  const [bookings, invoiceAgg, paymentAgg] = await Promise.all([
    prisma.booking.count({ where: { agencyId: id } }),
    prisma.invoice.aggregate({
      where: { agencyId: id },
      _sum: { amount: true, amountPaid: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { agencyId: id, direction: 'INBOUND', status: 'SUCCEEDED' },
      _sum: { amount: true },
    }),
  ]);

  const invoiced = Number(invoiceAgg._sum.amount ?? 0);
  const settled = Number(invoiceAgg._sum.amountPaid ?? 0);

  const stats = {
    bookings,
    invoices: invoiceAgg._count,
    invoiced,
    paid: Number(paymentAgg._sum.amount ?? 0),
    outstanding: Math.max(0, invoiced - settled),
  };

  return { ...agency, stats };
}

export interface UpdateAgencyInput {
  legalName?: string;
  gstin?: string;
  pan?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/**
 * Admin edit of an agency's core profile fields. Commercial terms and status
 * have their own dedicated endpoints; this only touches identity/contact data.
 */
export async function updateAgency(
  agencyId: string,
  input: UpdateAgencyInput,
  actor: Actor,
) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');

  const data: UpdateAgencyInput = {};
  for (const key of ['legalName', 'gstin', 'pan', 'contactEmail', 'contactPhone'] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No editable fields provided');
  }

  const updated = await prisma.agency.update({ where: { id: agencyId }, data });
  await recordAuditLogSafe({
    entityType: 'Agency',
    entityId: agencyId,
    event: 'AGENCY_UPDATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: {
      legalName: agency.legalName,
      gstin: agency.gstin,
      pan: agency.pan,
      contactEmail: agency.contactEmail,
      contactPhone: agency.contactPhone,
    },
    after: data as Record<string, string>,
  });
  await broadcast(['agencies'], { agencyId });
  return updated;
}

export async function updateAgencyCommercialConfig(
  agencyId: string,
  tier: string,
  actor: Actor,
  overrides?: { markupPct?: number },
) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');

  const preset = getTierPreset(tier);
  if (!preset) {
    throw ApiError.badRequest(`Unknown tier: ${tier}`);
  }
  const terms = resolveCommercialTerms(preset);

  // v4 §1 — per-agency markup override ("personal bias"): the effective markup is
  // the tier default unless the admin sets an explicit per-agency value.
  const markupPct = overrides?.markupPct ?? terms.markupPct;
  if (markupPct < 0 || markupPct > 100) {
    throw ApiError.badRequest('Markup must be between 0 and 100%');
  }

  const configuration = await prisma.$transaction(async (tx) => {
    await tx.commercialConfiguration.updateMany({
      where: { agencyId, isCurrent: true },
      data: { isCurrent: false },
    });
    const created = await tx.commercialConfiguration.create({
      data: {
        agencyId,
        tier: tier.toUpperCase(),
        paymentMode: terms.paymentMode,
        creditLimit: terms.creditLimit,
        paymentTerms: terms.paymentTerms,
        markupPct,
        effectiveFrom: new Date(),
        updatedById: actor.actorId,
        isCurrent: true,
      },
    });
    await recordAuditLog({
      entityType: 'CommercialConfiguration',
      entityId: created.id,
      event: 'COMMERCIAL_CONFIG_UPDATED',
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      after: { tier: created.tier, ...terms, markupPct, markupOverridden: overrides?.markupPct != null },
    }, tx);
    return created;
  });

  await broadcast(['agencies'], { agencyId });
  return configuration;
}

/**
 * Suspends an active agency: application ACTIVE → SUSPENDED (audited via the
 * lifecycle module) plus agency.status = SUSPENDED. Balances remain due;
 * reversible via reactivate.
 */
export async function suspendAgency(agencyId: string, actor: Actor) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');
  // Onboarded agencies also move their application to SUSPENDED; admin-created
  // agencies (D7) have no application, so just flip the status.
  if (agency.applicationId) {
    await transitionApplication(agency.applicationId, 'SUSPENDED', actor, { reason: 'Agency suspended' });
  }
  const updated = await prisma.agency.update({ where: { id: agencyId }, data: { status: 'SUSPENDED' } });
  await notify(
    { event: 'AGENCY_SUSPENDED', legalName: agency.legalName },
    { email: agency.contactEmail, phone: agency.contactPhone },
    { entityType: 'Agency', entityId: agencyId },
  );
  await broadcast(['agencies'], { agencyId });
  return updated;
}

export async function reactivateAgency(agencyId: string, actor: Actor) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');
  if (agency.applicationId) {
    await transitionApplication(agency.applicationId, 'ACTIVE', actor, { reason: 'Agency reactivated' });
  }
  const updated = await prisma.agency.update({ where: { id: agencyId }, data: { status: 'ACTIVE' } });
  await notify(
    { event: 'AGENCY_REACTIVATED', legalName: agency.legalName },
    { email: agency.contactEmail, phone: agency.contactPhone },
    { entityType: 'Agency', entityId: agencyId },
  );
  await broadcast(['agencies'], { agencyId });
  return updated;
}
