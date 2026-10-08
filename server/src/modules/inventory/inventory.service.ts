import type { ActorRole, ChannelPolicyKind } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { RoomTypeAvailability } from '../../lib/inventory';
import { ApiError } from '../../utils/apiError';
import { recordAuditLogSafe } from '../audit/audit.service';

/**
 * v3 §3 — B2B channel inventory policy layer. Sits between live CRS
 * availability and what agencies can book: stop-sell/blackout dates, allocation
 * caps per room type, and per-agency allotments (§4.2). Read-only over CRS
 * — it never writes to it; it filters availability and is re-checked at commit.
 *
 * Non-cancelled bookings overlapping the requested stay are treated as consuming
 * the cap. Allotments add the requesting agency's reserved block on top.
 */

interface Actor {
  actorId: string;
  actorRole: ActorRole;
}

/** Adjusts a resort's room availability for the channel policy (used at search). */
export async function applyChannelPolicy(
  resortId: string,
  rooms: RoomTypeAvailability[],
  checkIn: Date,
  checkOut: Date,
  agencyId: string,
): Promise<RoomTypeAvailability[]> {
  if (rooms.length === 0) return rooms;

  const now = new Date();
  const [policies, allotments, bookedRaw, nonCommittedRaw] = await Promise.all([
    prisma.channelPolicy.findMany({ where: { resortId, startDate: { lte: checkOut }, endDate: { gte: checkIn } } }),
    prisma.allotment.findMany({ where: { agencyId, resortId, startDate: { lte: checkOut }, endDate: { gte: checkIn } } }),
    prisma.booking.groupBy({
      by: ['roomTypeId'],
      where: {
        resortId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        OR: [
          { state: { in: ['PAID', 'CONFIRMED', 'CONFIRMED_ON_CREDIT', 'COMMITTED', 'COMMIT_FAILED'] } },
          {
            state: 'AWAITING_PAYMENT',
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
      _count: true,
    }),
    prisma.booking.groupBy({
      by: ['roomTypeId'],
      where: {
        resortId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        OR: [
          { state: { in: ['PAID', 'CONFIRMED', 'CONFIRMED_ON_CREDIT', 'COMMIT_FAILED'] } },
          {
            state: 'AWAITING_PAYMENT',
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
      _count: true,
    }),
  ]);

  const bookedByRt = new Map(bookedRaw.map((b) => [b.roomTypeId, b._count]));
  const nonCommittedByRt = new Map(nonCommittedRaw.map((b) => [b.roomTypeId, b._count]));
  const allotByRt = new Map<string, number>();
  for (const a of allotments) allotByRt.set(a.roomTypeId, (allotByRt.get(a.roomTypeId) ?? 0) + a.rooms);

  const out: RoomTypeAvailability[] = [];
  for (const rt of rooms) {
    const applicable = policies.filter((p) => !p.roomTypeId || p.roomTypeId === rt.roomTypeId);
    if (applicable.some((p) => p.kind === 'STOP_SELL')) continue; // blackout → hide

    const nonCommitted = nonCommittedByRt.get(rt.roomTypeId) ?? 0;
    let effective = Math.max(0, rt.availableCount - nonCommitted);

    const caps = applicable.filter((p) => p.kind === 'CAP' && p.capPerDay != null).map((p) => p.capPerDay as number);
    if (caps.length) {
      const cap = Math.min(...caps);
      const already = bookedByRt.get(rt.roomTypeId) ?? 0;
      effective = Math.min(effective, Math.max(0, cap - already));
    }
    effective += allotByRt.get(rt.roomTypeId) ?? 0; // agency's reserved block on top

    if (effective <= 0) continue;
    out.push({ ...rt, availableCount: effective });
  }
  return out;
}

/** Re-checks a single room line at booking commit (§3: re-checked at hold/commit). */
export async function assertBookable(
  resortId: string,
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  agencyId: string,
  axisAvailable: number,
  requestedCount: number = 1,
): Promise<void> {
  const now = new Date();
  const [policies, allotments, already, nonCommitted] = await Promise.all([
    prisma.channelPolicy.findMany({
      where: { resortId, startDate: { lte: checkOut }, endDate: { gte: checkIn }, OR: [{ roomTypeId: null }, { roomTypeId }] },
    }),
    prisma.allotment.findMany({ where: { agencyId, resortId, roomTypeId, startDate: { lte: checkOut }, endDate: { gte: checkIn } } }),
    prisma.booking.count({
      where: {
        resortId,
        roomTypeId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        OR: [
          { state: { in: ['PAID', 'CONFIRMED', 'CONFIRMED_ON_CREDIT', 'COMMITTED', 'COMMIT_FAILED'] } },
          {
            state: 'AWAITING_PAYMENT',
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
    }),
    prisma.booking.count({
      where: {
        resortId,
        roomTypeId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        OR: [
          { state: { in: ['PAID', 'CONFIRMED', 'CONFIRMED_ON_CREDIT', 'COMMIT_FAILED'] } },
          {
            state: 'AWAITING_PAYMENT',
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
    }),
  ]);

  if (policies.some((p) => p.kind === 'STOP_SELL')) throw ApiError.conflict('These dates are closed for the B2B channel');

  let effective = Math.max(0, axisAvailable - nonCommitted);
  const caps = policies.filter((p) => p.kind === 'CAP' && p.capPerDay != null).map((p) => p.capPerDay as number);
  if (caps.length) effective = Math.min(effective, Math.max(0, Math.min(...caps) - already));
  effective += allotments.reduce((s, a) => s + a.rooms, 0);

  if (effective < requestedCount) {
    throw ApiError.conflict('Selected room type does not have enough availability for the requested rooms');
  }
}

// --- Admin CRUD --------------------------------------------------------------

export const listPolicies = () => prisma.channelPolicy.findMany({ orderBy: { startDate: 'desc' } });

export interface CreatePolicyInput {
  resortId: string;
  roomTypeId?: string | null;
  kind: ChannelPolicyKind;
  startDate: string;
  endDate: string;
  capPerDay?: number;
  note?: string;
}

export async function createPolicy(input: CreatePolicyInput, actor: Actor) {
  if (input.kind === 'CAP' && (input.capPerDay == null || input.capPerDay < 0)) {
    throw ApiError.badRequest('capPerDay is required for a CAP policy');
  }
  const policy = await prisma.channelPolicy.create({
    data: {
      resortId: input.resortId,
      roomTypeId: input.roomTypeId ?? null,
      kind: input.kind,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      capPerDay: input.kind === 'CAP' ? input.capPerDay : null,
      note: input.note,
    },
  });
  await recordAuditLogSafe({
    entityType: 'ChannelPolicy',
    entityId: policy.id,
    event: 'CHANNEL_POLICY_CREATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { resortId: policy.resortId, kind: policy.kind, capPerDay: policy.capPerDay },
  });
  return policy;
}

export async function deletePolicy(id: string, actor: Actor) {
  const existing = await prisma.channelPolicy.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Policy not found');
  await prisma.channelPolicy.delete({ where: { id } });
  await recordAuditLogSafe({
    entityType: 'ChannelPolicy',
    entityId: id,
    event: 'CHANNEL_POLICY_DELETED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: { resortId: existing.resortId, kind: existing.kind },
  });
  return { deleted: true };
}

export const listAllotments = () =>
  prisma.allotment.findMany({ include: { agency: { select: { legalName: true } } }, orderBy: { startDate: 'desc' } });

export interface CreateAllotmentInput {
  agencyId: string;
  resortId: string;
  roomTypeId: string;
  startDate: string;
  endDate: string;
  rooms: number;
  releaseDate?: string;
  note?: string;
}

export async function createAllotment(input: CreateAllotmentInput, actor: Actor) {
  const agency = await prisma.agency.findUnique({ where: { id: input.agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');
  const allotment = await prisma.allotment.create({
    data: {
      agencyId: input.agencyId,
      resortId: input.resortId,
      roomTypeId: input.roomTypeId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      rooms: input.rooms,
      releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
      note: input.note,
    },
  });
  await recordAuditLogSafe({
    entityType: 'Allotment',
    entityId: allotment.id,
    event: 'ALLOTMENT_CREATED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { agencyId: input.agencyId, resortId: input.resortId, rooms: input.rooms },
  });
  return allotment;
}

export async function deleteAllotment(id: string, actor: Actor) {
  const existing = await prisma.allotment.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Allotment not found');
  await prisma.allotment.delete({ where: { id } });
  await recordAuditLogSafe({
    entityType: 'Allotment',
    entityId: id,
    event: 'ALLOTMENT_DELETED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: { agencyId: existing.agencyId, resortId: existing.resortId },
  });
  return { deleted: true };
}
