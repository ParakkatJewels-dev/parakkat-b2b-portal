import type { ActorRole, Prisma, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/apiError';
import { generateStrongPassword } from '../auth/passwordPolicy';
import { getIdentity, withNewLogin } from '../../lib/identity';
import { recordAuditLogSafe } from '../audit/audit.service';

export interface AgentActor {
  actorId: string;
  actorRole: ActorRole;
  agencyId: string | null;
  isAdmin: boolean;
}

export interface Permissions {
  canBook: boolean;
  canCancel: boolean;
  canModify: boolean;
  canViewReports: boolean;
}

const AGENT_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  canBook: true,
  canCancel: true,
  canModify: true,
  canViewReports: true,
  agencyId: true,
  createdAt: true,
  _count: { select: { bookings: true } },
} satisfies Prisma.UserSelect;

type AgentRow = Prisma.UserGetPayload<{ select: typeof AGENT_SELECT }>;
const shape = (a: AgentRow) => {
  const { _count, ...rest } = a;
  return { ...rest, bookings: _count.bookings };
};

// v3 §10.2 — temporary passwords satisfy the same policy as user-chosen ones.
const genTempPassword = () => generateStrongPassword(14);

export async function listAgents(agencyId: string) {
  const rows = await prisma.user.findMany({
    where: { agencyId, role: 'AGENT' },
    select: AGENT_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(shape);
}

export async function listAllAgents() {
  const rows = await prisma.user.findMany({
    where: { role: 'AGENT' },
    select: { ...AGENT_SELECT, agency: { select: { legalName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(({ agency, ...a }) => ({ ...shape(a), agencyName: agency?.legalName ?? '—' }));
}

async function loadAgent(agentId: string, actor: AgentActor) {
  const agent = await prisma.user.findUnique({ where: { id: agentId } });
  if (!agent || agent.role !== 'AGENT') throw ApiError.notFound('Agent not found');
  if (!actor.isAdmin && agent.agencyId !== actor.agencyId) throw ApiError.notFound('Agent not found');
  return agent;
}

export async function getAgentDetail(agentId: string, actor: AgentActor) {
  await loadAgent(agentId, actor);

  const [agent, bookings, recentBookings, recentActivity] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: agentId },
      select: {
        ...AGENT_SELECT,
        mfaEnabled: true,
        mustChangePassword: true,
        agency: { select: { id: true, legalName: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.booking.findMany({
      where: { agentId },
      select: { state: true, agencyPrice: true },
    }),
    prisma.booking.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, resortName: true, checkIn: true, checkOut: true, agencyPrice: true, state: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: 'User', entityId: agentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { event: true, actorRole: true, createdAt: true },
    }),
  ]);

  const cancelledStates = new Set(['CANCELLED', 'EXPIRED']);
  const revenueStates = new Set(['CONFIRMED_ON_CREDIT', 'PAID', 'CONFIRMED', 'COMMITTED']);
  const stats = bookings.reduce(
    (acc, b) => {
      if (cancelledStates.has(b.state)) acc.cancelledBookings += 1;
      if (revenueStates.has(b.state)) {
        acc.confirmedBookings += 1;
        acc.totalRevenue += Number(b.agencyPrice);
      }
      return acc;
    },
    { totalBookings: bookings.length, confirmedBookings: 0, cancelledBookings: 0, totalRevenue: 0 },
  );

  const { _count, agency, createdBy, ...rest } = agent;
  return {
    ...rest,
    agencyName: agency?.legalName ?? '—',
    createdBy: createdBy ?? null,
    stats,
    recentBookings: recentBookings.map((b) => ({ ...b, agencyPrice: Number(b.agencyPrice) })),
    recentActivity,
  };
}

export interface CreateAgentInput {
  name: string;
  email: string;
  password?: string;
  agencyId?: string;
  permissions?: Partial<Permissions>;
}

export async function createAgent(input: CreateAgentInput, actor: AgentActor) {
  const agencyId = actor.isAdmin ? input.agencyId : actor.agencyId;
  if (!agencyId) throw ApiError.badRequest('agencyId is required to create an agent');

  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('A user with this email already exists');

  const tempPassword = input.password ?? genTempPassword();

  const agent = await withNewLogin({ email: input.email, password: tempPassword }, (login) => prisma.user.create({
    data: {
      id: login.id,
      email: input.email,
      name: input.name,
      passwordHash: login.passwordHash,
      role: 'AGENT',
      agencyId,
      createdByUserId: actor.actorId,
      // v3 §10.2 — the creator knows the initial password; force a change at first login.
      mustChangePassword: true,
      canBook: input.permissions?.canBook ?? true,
      canCancel: input.permissions?.canCancel ?? false,
      canModify: input.permissions?.canModify ?? false,
      canViewReports: input.permissions?.canViewReports ?? false,
    },
    select: AGENT_SELECT,
  }));
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agent.id,
    event: 'AGENT_CREATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { email: agent.email, agencyId },
  });
  // Return the temp password once when the server generated it.
  return { agent: shape(agent), tempPassword: input.password ? undefined : tempPassword };
}

export async function updateAgent(
  agentId: string,
  input: { name?: string; permissions?: Partial<Permissions> },
  actor: AgentActor,
) {
  await loadAgent(agentId, actor);
  const agent = await prisma.user.update({
    where: { id: agentId },
    data: { name: input.name, ...input.permissions },
    select: AGENT_SELECT,
  });
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agentId,
    event: 'AGENT_UPDATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { name: agent.name, ...input.permissions },
  });
  return shape(agent);
}

export async function setAgentStatus(agentId: string, status: UserStatus, actor: AgentActor) {
  await loadAgent(agentId, actor);
  const agent = await prisma.user.update({ where: { id: agentId }, data: { status }, select: AGENT_SELECT });
  if (status === 'SUSPENDED') await getIdentity().revokeUserSessions(agentId); // disabling logs them out
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agentId,
    event: status === 'SUSPENDED' ? 'AGENT_DISABLED' : 'AGENT_ENABLED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });
  return shape(agent);
}

export async function resetAgentPassword(agentId: string, actor: AgentActor) {
  await loadAgent(agentId, actor);
  const tempPassword = genTempPassword();
  await getIdentity().setPassword(agentId, tempPassword);
  await prisma.user.update({ where: { id: agentId }, data: { mustChangePassword: true } });
  await getIdentity().revokeUserSessions(agentId);
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agentId,
    event: 'AGENT_PASSWORD_RESET',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });
  return { tempPassword };
}

export async function forceLogout(agentId: string, actor: AgentActor) {
  await loadAgent(agentId, actor);
  await getIdentity().revokeUserSessions(agentId);
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agentId,
    event: 'AGENT_FORCE_LOGOUT',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });
  return { ok: true };
}

export async function deleteAgent(agentId: string, actor: AgentActor) {
  const agent = await loadAgent(agentId, actor);
  const [bookings, audits] = await Promise.all([
    prisma.booking.count({ where: { agentId } }),
    prisma.auditLog.count({ where: { actorId: agentId } }),
  ]);
  if (bookings > 0 || audits > 0) {
    throw ApiError.conflict('Agent has activity history — disable the agent instead of deleting');
  }
  await prisma.$transaction(async (tx) => {
    await tx.otpCode.deleteMany({ where: { userId: agentId } });
    await tx.user.delete({ where: { id: agentId } });
  });
  await getIdentity().deleteUser(agentId);
  await recordAuditLogSafe({
    entityType: 'User',
    entityId: agentId,
    event: 'AGENT_DELETED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: { email: agent.email },
  });
  return { deleted: true };
}

/** Enforcement helper for capability-gated actions (booking/cancel). */
export async function assertAgentCan(userId: string, flag: keyof Permissions): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, canBook: true, canCancel: true, canModify: true, canViewReports: true },
  });
  if (!user) throw ApiError.unauthorized();
  if (user.role !== 'AGENT') return; // AGENCY/ADMIN are full-access
  if (!user[flag]) {
    const verb = flag === 'canBook' ? 'create bookings' : flag === 'canCancel' ? 'cancel bookings' : 'perform this action';
    throw ApiError.forbidden(`Your agency has not granted you permission to ${verb}`);
  }
}
