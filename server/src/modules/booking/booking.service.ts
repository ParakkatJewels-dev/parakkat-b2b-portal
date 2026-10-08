import crypto from 'node:crypto';
import type { Booking } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getInventoryClient } from '../../lib/inventory';
import { broadcast } from '../../lib/realtime';
import { logger } from '../../lib/logger';
import { ApiError } from '../../utils/apiError';
import { recordAuditLogSafe } from '../audit/audit.service';
import {
  applyCancellation,
  collectPaymentForBooking,
  getOutstanding,
  recordBookingObligation,
} from '../finance/finance.service';
import { notify, type EntityRef } from '../notifications/notification.service';
import type { NotificationPayload } from '../notifications/templates';
import { evaluateCreditGate } from './creditGate';
import { validateStayDates } from './dates';
import { priceRoomFromAxis, priceDayUseFromAxis, applyResaleMarkup } from '../pricing/pricing.service';
import { assertBookable } from '../inventory/inventory.service';
import { Prisma, type ActorRole, type RatePlanCode } from '@prisma/client';

export interface AgentActor {
  userId: string;
  agencyId: string;
}

export interface CreateBookingInput {
  resortId: string;
  roomTypeId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut?: string; // optional for DAY_USE (same-day)
  stayType?: 'OVERNIGHT' | 'DAY_USE'; // v4 §1 — defaults to OVERNIGHT
  guests: number;
  plan?: RatePlanCode; // v3 §2 — defaults to EP
  adults?: number; // defaults to guests
  children?: number;
  childAges?: number[]; // v3 §2.2 — drives age-band child pricing
  extraBeds?: number;
  // B2B resale layer — the agent's own markup on top of agencyPrice for this
  // booking; falls back to the agency's defaultResaleMarkupPct when omitted.
  resaleMarkupPct?: number;
  // v3 §8 — guest data (full ID is minimised out; only last-4 is retained).
  guest?: {
    name?: string;
    phone?: string;
    email?: string;
    specialRequests?: string;
    idType?: string;
    idNumber?: string;
    roomingList?: string[];
  };
}

/** No agency transacts before Active (§7); a suspended agency is blocked. */
async function assertAgencyCanTransact(agencyId: string) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw ApiError.notFound('Agency not found');
  if (agency.status !== 'ACTIVE' || !agency.activatedAt) {
    throw ApiError.forbidden('Agency is not active and cannot transact');
  }
  return agency;
}

async function getCurrentConfigOrThrow(agencyId: string) {
  const config = await prisma.commercialConfiguration.findFirst({
    where: { agencyId, isCurrent: true },
  });
  if (!config) throw ApiError.conflict('Agency has no commercial configuration');
  return config;
}

/**
 * Pushes the reservation to CRS and marks the booking COMMITTED
 * (idempotent on correlationId). v3 §5.2 — a push failure does NOT throw: the
 * booking is parked in COMMIT_FAILED and queued for automatic rebook, so a
 * payment already collected is never lost. Returns the COMMITTED or COMMIT_FAILED
 * booking; callers must check `state` before recording obligations / notifying.
 */
async function commitToCrs(booking: Booking): Promise<Booking> {
  const axis = getInventoryClient();
  try {
    if (!(await axis.healthCheck())) throw new Error('CRS health check failed');
    const { crsBookingRef } = await axis.createReservation({
      correlationId: booking.correlationId,
      resortId: booking.resortId,
      roomTypeId: booking.roomTypeId,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      guests: booking.guests,
      stayType: booking.stayType,
    });
    const committed = await prisma.booking.update({
      where: { id: booking.id },
      data: { state: 'COMMITTED', crsBookingRef, committedAt: new Date() },
    });
    await recordAuditLogSafe({
      entityType: 'Booking',
      entityId: booking.id,
      event: 'BOOKING_COMMITTED',
      actorId: null,
      actorRole: 'SYSTEM',
      after: { crsBookingRef, correlationId: booking.correlationId },
    });
    return committed;
  } catch (err) {
    return handleCommitFailure(booking, err);
  }
}

/**
 * v3 §5.2 — records/advances a rebook task after a failed CRS push. Moves
 * the booking to COMMIT_FAILED, increments attempts, and parks it as ABANDONED
 * once the retry ceiling is hit (manual admin resolution). Funds stay held.
 */
async function handleCommitFailure(booking: Booking, err: unknown): Promise<Booking> {
  const message = err instanceof Error ? err.message : String(err);
  const existing = await prisma.rebookTask.findUnique({ where: { bookingId: booking.id } });
  const attempts = (existing?.attempts ?? 0) + 1;
  const abandoned = attempts >= env.REBOOK_MAX_ATTEMPTS;

  const failed = await prisma.booking.update({ where: { id: booking.id }, data: { state: 'COMMIT_FAILED' } });
  await prisma.rebookTask.upsert({
    where: { bookingId: booking.id },
    create: { bookingId: booking.id, attempts, lastError: message, status: abandoned ? 'ABANDONED' : 'PENDING' },
    update: { attempts, lastError: message, status: abandoned ? 'ABANDONED' : 'PENDING', resolvedAt: null },
  });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: abandoned ? 'BOOKING_COMMIT_ABANDONED' : 'BOOKING_COMMIT_FAILED',
    actorId: null,
    actorRole: 'SYSTEM',
    after: { error: message, attempts },
  });
  logger.error('CRS commit failed — booking queued for rebook', {
    bookingId: booking.id,
    correlationId: booking.correlationId,
    attempts,
    abandoned,
    error: message,
  });
  await notifyAgency(
    booking.agencyId,
    abandoned
      ? { event: 'BOOKING_CONFIRMATION_FAILED', resortName: booking.resortName }
      : { event: 'BOOKING_PENDING_CONFIRMATION', resortName: booking.resortName },
    { entityType: 'Booking', entityId: booking.id },
  );
  await broadcast(['bookings'], { agencyId: booking.agencyId });
  return failed;
}

/** v3 §5.2 — finalise a successful (re)commit: close the task, record any deferred
 *  credit obligation, and send the confirmation the failed attempt withheld. */
async function onRebookResolved(booking: Booking): Promise<void> {
  await prisma.rebookTask.update({
    where: { bookingId: booking.id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), lastError: null },
  });
  if (booking.paymentMode === 'CREDIT') {
    const invoice = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
    if (!invoice) {
      const config = await prisma.commercialConfiguration.findFirst({ where: { agencyId: booking.agencyId, isCurrent: true } });
      await recordBookingObligation(booking, config?.paymentTerms ?? 'Net 15');
    }
  }
  await notifyAgency(
    booking.agencyId,
    { event: 'BOOKING_CONFIRMED', resortName: booking.resortName, rooms: 1, checkIn: booking.checkIn.toISOString() },
    { entityType: 'Booking', entityId: booking.id },
  );
  await broadcast(['bookings', 'finance'], { agencyId: booking.agencyId });
}

/** v3 §5.2 — retry one queued booking (worker + manual admin retry share this). */
async function attemptRebook(booking: Booking): Promise<Booking> {
  const committed = await commitToCrs(booking);
  if (committed.state === 'COMMITTED') await onRebookResolved(committed);
  return committed;
}

/** v3 §5.2 — process the pending rebook queue (worker / admin-triggered). */
export async function processRebookQueue(limit = 50): Promise<{ resolved: number; stillPending: number; abandoned: number }> {
  const tasks = await prisma.rebookTask.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let resolved = 0;
  let stillPending = 0;
  let abandoned = 0;
  for (const task of tasks) {
    const booking = await prisma.booking.findUnique({ where: { id: task.bookingId } });
    if (!booking || booking.state !== 'COMMIT_FAILED') continue; // stale (cancelled/resolved elsewhere)
    const committed = await attemptRebook(booking);
    if (committed.state === 'COMMITTED') resolved += 1;
    else {
      const after = await prisma.rebookTask.findUnique({ where: { bookingId: booking.id } });
      if (after?.status === 'ABANDONED') abandoned += 1;
      else stillPending += 1;
    }
  }
  return { resolved, stillPending, abandoned };
}

/** v3 §5.2 — close an open rebook task (booking cancelled elsewhere; stop retrying). */
async function closeRebookTask(bookingId: string): Promise<void> {
  await prisma.rebookTask.updateMany({
    where: { bookingId, status: { in: ['PENDING', 'ABANDONED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date(), lastError: 'closed: booking cancelled' },
  });
}

/** v3 §5.2 — admin: force a retry of a single commit-failed booking. */
export async function retryRebook(bookingId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.state === 'COMMITTED') return booking;
  if (booking.state !== 'COMMIT_FAILED') throw ApiError.conflict(`Booking is ${booking.state}, not awaiting rebook`);
  return attemptRebook(booking);
}

/** v3 §5.2 — admin: the open rebook queue (pending + abandoned) for oversight. */
export async function listRebookQueue() {
  const tasks = await prisma.rebookTask.findMany({
    where: { status: { in: ['PENDING', 'ABANDONED'] } },
    orderBy: { createdAt: 'asc' },
    include: {
      booking: {
        select: {
          id: true,
          resortName: true,
          roomTypeName: true,
          paymentMode: true,
          agencyPrice: true,
          checkIn: true,
          checkOut: true,
          state: true,
          agency: { select: { legalName: true } },
        },
      },
    },
  });
  return tasks.map((t) => ({
    id: t.id,
    bookingId: t.bookingId,
    status: t.status,
    attempts: t.attempts,
    lastError: t.lastError,
    createdAt: t.createdAt,
    agencyName: t.booking.agency.legalName,
    resortName: t.booking.resortName,
    roomTypeName: t.booking.roomTypeName,
    paymentMode: t.booking.paymentMode,
    agencyPrice: t.booking.agencyPrice,
    checkIn: t.booking.checkIn,
    checkOut: t.booking.checkOut,
    bookingState: t.booking.state,
  }));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Loads an agency's contact and emits a notification (never throws into the flow). */
async function notifyAgency(agencyId: string, payload: NotificationPayload, ref: EntityRef): Promise<void> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { contactEmail: true, contactPhone: true } });
  if (agency) await notify(payload, { email: agency.contactEmail, phone: agency.contactPhone }, ref);
}

function datesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * Prices + validates ONE room line (refresh-before-book, occupancy check,
 * server-side rate-plan composition) and returns the Prisma create-data `base`
 * plus the line's agency price. Shared by single and multi-room booking.
 */
async function resolveLine(
  input: CreateBookingInput,
  markupPct: number,
  defaultResaleMarkupPct: number,
  axis: ReturnType<typeof getInventoryClient>,
  actor: AgentActor,
  resolvedSoFar: { base: LineBase; agencyPrice: number }[] = [],
) {
  // v4 §1 — overnight vs same-day day-use. Authoritative stay-date validation
  // (no past dates, max stay, advance window); day-use is same-day (nights = 0).
  const stayType = input.stayType ?? 'OVERNIGHT';
  const { checkIn, checkOut, nights } = validateStayDates(input.checkIn, input.checkOut, stayType);

  // Day-use is plan-agnostic (a same-day slot); meal plans apply to overnight only.
  const plan: RatePlanCode = stayType === 'DAY_USE' ? 'EP' : input.plan ?? 'EP';
  const adults = input.adults ?? input.guests;
  // v3 §2.2 — child ages, when supplied, define the child count authoritatively.
  const childAges = input.childAges;
  const children = childAges ? childAges.length : input.children ?? 0;
  const extraBeds = input.extraBeds ?? 0;
  const totalGuests = adults + children;

  const roomType = await axis.getRoomType(input.resortId, input.roomTypeId);
  if (!roomType || roomType.availableCount < 1) throw ApiError.conflict('Selected room type is no longer available');
  if (roomType.maxOccupancy < totalGuests) throw ApiError.badRequest('Room type does not accommodate the requested occupancy');

  // Count how many lines of the same room type and overlapping dates are already resolved in this transaction
  const inGroupCount = resolvedSoFar.filter((r) =>
    r.base.roomTypeId === input.roomTypeId &&
    datesOverlap(r.base.checkIn, r.base.checkOut, checkIn, checkOut)
  ).length;
  const requestedCount = inGroupCount + 1;

  // v3 §3 — re-check the B2B channel policy at commit (stop-sell / cap / allotment).
  await assertBookable(input.resortId, input.roomTypeId, checkIn, checkOut, actor.agencyId, roomType.availableCount, requestedCount);
  const resort = (await axis.listResorts()).find((r) => r.id === input.resortId);
  if (!resort) throw ApiError.notFound('Resort not found');

  // v4 §1 — rates, occupancy and restrictions come from CRS (source of truth);
  // the portal applies only the agency markup. Use the raw YYYY-MM-DD inputs (not the
  // parsed Dates) so the ARI date keys aren't shifted by timezone on toISOString().
  // input.checkOut is guaranteed for OVERNIGHT (validateStayDates throws otherwise).
  const checkOutStr = stayType === 'DAY_USE' ? input.checkIn : input.checkOut!;
  const rates = await axis.getRoomTypeRates({
    resortId: input.resortId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: checkOutStr,
    stayType,
  });
  if (!rates) throw ApiError.conflict('Rates are not available for this room on the selected date(s)');
  if (rates.restrictions.stopSell) throw ApiError.conflict('This room is not available for the selected date(s)');
  // v4 §1 — CTA/CTD: no arrivals on a closed-to-arrival date; no departures on a
  // closed-to-departure date (CTD applies to overnight only — day-use has no departure).
  if (rates.restrictions.closedToArrival) {
    throw ApiError.badRequest('Check-in is not allowed on this date (closed to arrival)');
  }
  if (stayType === 'OVERNIGHT' && rates.restrictions.closedToDeparture) {
    throw ApiError.badRequest('Check-out is not allowed on this date (closed to departure)');
  }
  // Min-stay applies to overnight stays only.
  if (stayType === 'OVERNIGHT' && nights < rates.restrictions.minNights) {
    throw ApiError.badRequest(`This room requires a minimum stay of ${rates.restrictions.minNights} night(s)`);
  }
  const occupancy = { adults, children, extraBeds, childAges };
  const charge = stayType === 'DAY_USE' ? priceDayUseFromAxis(rates, occupancy, markupPct) : priceRoomFromAxis(rates, plan, occupancy, markupPct);

  // B2B resale layer — the agent's sell price to their customer. The override
  // (validated 0–500 at the route) wins over the agency default; the snapshot
  // makes profit reporting reproducible even if the default changes later.
  const resaleMarkupPct = round2(input.resaleMarkupPct ?? defaultResaleMarkupPct);
  const sellPrice = applyResaleMarkup(charge.agencyPrice, resaleMarkupPct);

  const base = {
    agencyId: actor.agencyId,
    agentId: actor.userId,
    resortId: input.resortId,
    resortName: resort.name,
    roomTypeId: input.roomTypeId,
    roomTypeName: roomType.roomTypeName,
    checkIn,
    checkOut,
    nights,
    stayType,
    guests: totalGuests,
    ratePlan: plan,
    adults,
    children,
    extraBeds,
    priceBreakdown: charge as unknown as Prisma.InputJsonValue,
    baseRate: charge.roomChargeTotal,
    agencyPrice: charge.agencyPrice,
    markupPct,
    resaleMarkupPct,
    sellPrice,
    // v3 §8 — persist guest data; DPDP data-minimisation keeps only the ID last-4.
    leadGuestName: input.guest?.name || null,
    leadGuestPhone: input.guest?.phone || null,
    leadGuestEmail: input.guest?.email || null,
    specialRequests: input.guest?.specialRequests || null,
    guestIdType: input.guest?.idNumber ? input.guest.idType || null : null,
    guestIdLast4: input.guest?.idNumber ? input.guest.idNumber.replace(/\s/g, '').slice(-4) : null,
    roomingList: input.guest?.roomingList?.length ? (input.guest.roomingList as unknown as Prisma.InputJsonValue) : undefined,
  };
  return { base, agencyPrice: charge.agencyPrice };
}

type LineBase = Awaited<ReturnType<typeof resolveLine>>['base'];

/** Confirm-on-credit line: create → commit to CRS → record the credit obligation. */
async function createCreditLine(base: LineBase, actor: AgentActor, paymentTerms: string, projectedBalance: number, groupId?: string): Promise<Booking> {
  const booking = await prisma.booking.create({ data: { ...base, groupId, paymentMode: 'CREDIT', state: 'CONFIRMED_ON_CREDIT' } });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: 'BOOKING_CONFIRMED_ON_CREDIT',
    actorId: actor.userId,
    actorRole: 'AGENT',
    after: { agencyPrice: base.agencyPrice, projectedBalance, groupId },
  });
  const committed = await commitToCrs(booking);
  // v3 §5.2 — only bill the agency once the reservation actually lands. If the
  // push failed (COMMIT_FAILED), the obligation is recorded when the rebook
  // succeeds (onRebookResolved), so a queued booking never owes prematurely.
  if (committed.state === 'COMMITTED') await recordBookingObligation(committed, paymentTerms);
  return committed;
}

/** Pay-first line: tentative portal hold (NOT CRS) with a TTL. */
async function createPrepayLine(base: LineBase, actor: AgentActor, holdExpiresAt: Date, groupId?: string): Promise<Booking> {
  const booking = await prisma.booking.create({ data: { ...base, groupId, paymentMode: 'PREPAY', state: 'AWAITING_PAYMENT', holdExpiresAt } });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: 'BOOKING_AWAITING_PAYMENT',
    actorId: actor.userId,
    actorRole: 'AGENT',
    after: { agencyPrice: base.agencyPrice, holdExpiresAt, groupId },
  });
  return booking;
}

export async function createBooking(input: CreateBookingInput, actor: AgentActor): Promise<Booking> {
  const agency = await assertAgencyCanTransact(actor.agencyId);
  const config = await getCurrentConfigOrThrow(actor.agencyId);
  const axis = getInventoryClient();
  // Block, don't queue: health-check before we let a booking proceed (§10).
  if (!(await axis.healthCheck())) throw ApiError.serviceUnavailable('CRS is unavailable — booking is temporarily disabled');

  const { base, agencyPrice } = await resolveLine(input, Number(config.markupPct), Number(agency.defaultResaleMarkupPct), axis, actor);
  const outstanding = await getOutstanding(actor.agencyId);
  const gate = evaluateCreditGate({
    paymentMode: config.paymentMode,
    outstandingBalance: outstanding,
    agencyPrice,
    effectiveCreditLimit: Number(config.creditLimit),
  });

  const booking =
    gate.branch === 'confirm_on_credit'
      ? await createCreditLine(base, actor, config.paymentTerms, gate.projectedBalance)
      : await createPrepayLine(base, actor, new Date(Date.now() + env.BOOKING_HOLD_TTL_MINUTES * 60 * 1000));
  await broadcast(['bookings', 'finance'], { agencyId: actor.agencyId });
  // COMMIT_FAILED lines already got a "pending confirmation" notice; only the
  // ones that actually committed get the confirmation here.
  if (gate.branch === 'confirm_on_credit' && booking.state === 'COMMITTED') {
    await notifyAgency(
      actor.agencyId,
      { event: 'BOOKING_CONFIRMED', resortName: booking.resortName, rooms: 1, checkIn: booking.checkIn.toISOString() },
      { entityType: 'Booking', entityId: booking.id },
    );
  }
  return booking;
}

/**
 * v3 §4 — group / multi-room booking. Prices every line server-side, runs the
 * credit gate on the AGGREGATE total (one decision for the whole cart), then
 * creates all lines under a shared groupId. Per-line invoices/refunds/credit
 * notes (§4.3/§6.4) fall out of the existing per-booking finance flow.
 */
export async function createGroupBooking(lines: CreateBookingInput[], actor: AgentActor): Promise<Booking[]> {
  if (lines.length === 0) throw ApiError.badRequest('A booking must contain at least one room');
  const agency = await assertAgencyCanTransact(actor.agencyId);
  const config = await getCurrentConfigOrThrow(actor.agencyId);
  const axis = getInventoryClient();
  if (!(await axis.healthCheck())) throw ApiError.serviceUnavailable('CRS is unavailable — booking is temporarily disabled');

  const markupPct = Number(config.markupPct);
  const defaultResalePct = Number(agency.defaultResaleMarkupPct);
  const resolved: { base: LineBase; agencyPrice: number }[] = [];
  for (const line of lines) resolved.push(await resolveLine(line, markupPct, defaultResalePct, axis, actor, resolved));
  const aggregate = round2(resolved.reduce((s, r) => s + r.agencyPrice, 0));

  const outstanding = await getOutstanding(actor.agencyId);
  const gate = evaluateCreditGate({
    paymentMode: config.paymentMode,
    outstandingBalance: outstanding,
    agencyPrice: aggregate,
    effectiveCreditLimit: Number(config.creditLimit),
  });

  const groupId = crypto.randomUUID();
  const created: Booking[] = [];
  if (gate.branch === 'confirm_on_credit') {
    for (const r of resolved) created.push(await createCreditLine(r.base, actor, config.paymentTerms, gate.projectedBalance, groupId));
  } else {
    const holdExpiresAt = new Date(Date.now() + env.BOOKING_HOLD_TTL_MINUTES * 60 * 1000);
    for (const r of resolved) created.push(await createPrepayLine(r.base, actor, holdExpiresAt, groupId));
  }
  await broadcast(['bookings', 'finance'], { agencyId: actor.agencyId });
  const committedLines = created.filter((b) => b.state === 'COMMITTED');
  if (gate.branch === 'confirm_on_credit' && committedLines.length) {
    await notifyAgency(
      actor.agencyId,
      { event: 'BOOKING_CONFIRMED', resortName: committedLines[0].resortName, rooms: committedLines.length, checkIn: committedLines[0].checkIn.toISOString() },
      { entityType: 'Booking', entityId: committedLines[0].id },
    );
  }
  return created;
}

/** Pays every awaiting-payment line in a group (single checkout for the cart). */
export async function payGroup(groupId: string, actor: AgentActor): Promise<Booking[]> {
  const lines = await prisma.booking.findMany({
    where: { groupId, agencyId: actor.agencyId, state: 'AWAITING_PAYMENT' },
  });
  if (lines.length === 0) throw ApiError.notFound('No payable rooms in this group');
  const paid: Booking[] = [];
  for (const line of lines) paid.push(await payBookingInternal(line.id, actor));
  await broadcast(['bookings', 'finance'], { agencyId: actor.agencyId });
  const committedLines = paid.filter((b) => b.state === 'COMMITTED');
  if (committedLines.length) {
    await notifyAgency(
      actor.agencyId,
      { event: 'BOOKING_CONFIRMED', resortName: committedLines[0].resortName, rooms: committedLines.length, checkIn: committedLines[0].checkIn.toISOString() },
      { entityType: 'Booking', entityId: committedLines[0].id },
    );
  }
  return paid;
}

/** Lazily expires a hold that has passed its TTL. Returns the (possibly updated) booking. */
async function expireIfLapsed(booking: Booking): Promise<Booking> {
  if (
    booking.state === 'AWAITING_PAYMENT' &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt.getTime() < Date.now()
  ) {
    const expired = await prisma.booking.update({
      where: { id: booking.id },
      data: { state: 'EXPIRED' },
    });
    await recordAuditLogSafe({
      entityType: 'Booking',
      entityId: booking.id,
      event: 'BOOKING_HOLD_EXPIRED',
      actorId: null,
      actorRole: 'SYSTEM',
    });
    return expired;
  }
  return booking;
}

async function loadOwnedBooking(bookingId: string, agencyId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.agencyId !== agencyId) {
    throw ApiError.notFound('Booking not found');
  }
  return booking;
}

/**
 * Marks a pay-first booking paid and commits it. Payment is mocked here — the
 * real gateway (Decision D2-a) + CRS posting arrive in Phase 7. Only valid
 * while the tentative hold is still live.
 */
/** Pay + commit one line, WITHOUT broadcast/notify (so a group pays once). */
async function payBookingInternal(bookingId: string, actor: AgentActor): Promise<Booking> {
  let booking = await loadOwnedBooking(bookingId, actor.agencyId);
  booking = await expireIfLapsed(booking);
  if (booking.state === 'EXPIRED') {
    throw ApiError.conflict('The tentative hold expired — please create a new booking');
  }
  if (booking.state !== 'AWAITING_PAYMENT') {
    throw ApiError.conflict(`Booking is not awaiting payment (state: ${booking.state})`);
  }

  // Collect payment via the gateway → records a SUCCEEDED payment, a PAID
  // invoice, and a CRS PAYMENT event. Throws if capture fails, leaving the
  // booking awaiting payment.
  await collectPaymentForBooking(booking);

  const paid = await prisma.booking.update({
    where: { id: booking.id },
    data: { state: 'PAID', paidAt: new Date() },
  });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: 'BOOKING_PAID',
    actorId: actor.userId,
    actorRole: 'AGENT',
  });
  // Converge with the credit branch: confirm + commit to CRS.
  return commitToCrs({ ...paid, state: 'CONFIRMED' });
}

export async function payBooking(bookingId: string, actor: AgentActor): Promise<Booking> {
  const committed = await payBookingInternal(bookingId, actor);
  await broadcast(['bookings', 'finance'], { agencyId: actor.agencyId });
  // v3 §5.2 — if the post-payment commit failed, the payment is captured but the
  // booking is COMMIT_FAILED and queued; the agent already got a "pending" notice.
  if (committed.state === 'COMMITTED') {
    await notifyAgency(
      actor.agencyId,
      { event: 'BOOKING_CONFIRMED', resortName: committed.resortName, rooms: 1, checkIn: committed.checkIn.toISOString() },
      { entityType: 'Booking', entityId: committed.id },
    );
  }
  return committed;
}

export async function cancelBooking(bookingId: string, actor: AgentActor): Promise<Booking> {
  const booking = await loadOwnedBooking(bookingId, actor.agencyId);
  if (booking.state === 'CANCELLED' || booking.state === 'EXPIRED') {
    throw ApiError.conflict(`Booking is already ${booking.state.toLowerCase()}`);
  }

  // Reverse the CRS reservation if one was committed.
  if (booking.state === 'COMMITTED' && booking.crsBookingRef) {
    await getInventoryClient().cancelReservation(booking.crsBookingRef);
  }

  const cancelledAt = new Date();
  // Apply the cancellation policy: charge/refund + balance adjustment + CRS
  // events. Only relevant once an invoice exists (i.e. the booking committed).
  if (booking.state === 'COMMITTED') {
    await applyCancellation(booking, cancelledAt);
  } else if (booking.state === 'COMMIT_FAILED') {
    // v3 §5.2 — never committed at the resort: full refund of any held funds, and
    // close the rebook task so the worker stops retrying.
    await applyCancellation(booking, cancelledAt, { chargePct: 0 });
    await closeRebookTask(booking.id);
  }

  const cancelled = await prisma.booking.update({
    where: { id: booking.id },
    data: { state: 'CANCELLED', cancelledAt },
  });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: 'BOOKING_CANCELLED',
    actorId: actor.userId,
    actorRole: 'AGENT',
    before: { state: booking.state },
  });
  await broadcast(['bookings', 'finance'], { agencyId: actor.agencyId });
  await notifyAgency(
    actor.agencyId,
    { event: 'BOOKING_CANCELLED', resortName: cancelled.resortName },
    { entityType: 'Booking', entityId: cancelled.id },
  );
  return cancelled;
}

/**
 * v3 §7 — admin/resort-side cancellation. NO_SHOW applies the cancellation
 * policy (100% for a past check-in); RESORT_CANCEL forces a full refund with a
 * mandatory reason. Operates on any booking (no agency scope) and notifies the
 * agency. Relocation is handled as resort-cancel + a manual re-book.
 */
export async function adminCancelBooking(
  bookingId: string,
  opts: { kind: 'NO_SHOW' | 'RESORT_CANCEL'; reason?: string },
  actor: { actorId: string; actorRole: ActorRole },
): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.state === 'CANCELLED' || booking.state === 'EXPIRED') {
    throw ApiError.conflict(`Booking is already ${booking.state.toLowerCase()}`);
  }

  const cancelledAt = new Date();
  if (booking.state === 'COMMITTED' && booking.crsBookingRef) {
    await getInventoryClient().cancelReservation(booking.crsBookingRef);
  }
  if (booking.state === 'COMMITTED') {
    // Resort-initiated → full refund (0%); no-show → policy bands (100% for past check-in).
    await applyCancellation(booking, cancelledAt, opts.kind === 'RESORT_CANCEL' ? { chargePct: 0 } : undefined);
  } else if (booking.state === 'COMMIT_FAILED') {
    // v3 §5.2 — resolving an abandoned/queued booking: full refund of held funds + close the task.
    await applyCancellation(booking, cancelledAt, { chargePct: 0 });
    await closeRebookTask(booking.id);
  }

  const cancelled = await prisma.booking.update({ where: { id: booking.id }, data: { state: 'CANCELLED', cancelledAt } });
  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: opts.kind === 'NO_SHOW' ? 'BOOKING_NO_SHOW' : 'BOOKING_RESORT_CANCELLED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    before: { state: booking.state },
    after: { reason: opts.reason ?? null },
  });
  await broadcast(['bookings', 'finance'], { agencyId: booking.agencyId });
  await notifyAgency(
    booking.agencyId,
    opts.kind === 'NO_SHOW'
      ? { event: 'NO_SHOW_RECORDED', resortName: booking.resortName, checkIn: booking.checkIn.toISOString() }
      : { event: 'BOOKING_CANCELLED', resortName: booking.resortName, reason: opts.reason },
    { entityType: 'Booking', entityId: booking.id },
  );
  return cancelled;
}

export async function getBooking(bookingId: string, actor: AgentActor): Promise<Booking> {
  const booking = await loadOwnedBooking(bookingId, actor.agencyId);
  return expireIfLapsed(booking);
}

export async function listBookings(agencyId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.booking.count({ where: { agencyId } }),
  ]);
  return { items, total, page, pageSize };
}

export interface GuestSummary {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  stays: number;
  lastStay: string | null;
  totalSpend: number;
  frequent: boolean;
  bookings: { id: string; resortName: string; checkIn: Date; checkOut: Date; state: string; agencyPrice: number }[];
}

/**
 * v3 §8 — guests are not a separate master; they are derived from the lead-guest
 * data captured on bookings, grouped by email / phone / name. Scoped to the agency
 * (or a single agent when `agentId` is set).
 */
export async function listGuests(agencyId: string, agentId?: string): Promise<{ guests: GuestSummary[]; totalStays: number }> {
  const bookings = await prisma.booking.findMany({
    where: { agencyId, ...(agentId ? { agentId } : {}), leadGuestName: { not: null } },
    orderBy: { checkIn: 'desc' },
    select: {
      id: true,
      leadGuestName: true,
      leadGuestPhone: true,
      leadGuestEmail: true,
      resortName: true,
      checkIn: true,
      checkOut: true,
      state: true,
      agencyPrice: true,
    },
  });

  const map = new Map<string, GuestSummary & { _lastStay: Date | null }>();
  for (const b of bookings) {
    const key = (b.leadGuestEmail || b.leadGuestPhone || b.leadGuestName || '').toLowerCase();
    if (!key) continue;
    let g = map.get(key);
    if (!g) {
      g = { key, name: b.leadGuestName ?? '—', email: b.leadGuestEmail, phone: b.leadGuestPhone, stays: 0, lastStay: null, totalSpend: 0, frequent: false, bookings: [], _lastStay: null };
      map.set(key, g);
    }
    g.stays += 1;
    g.totalSpend = Math.round((g.totalSpend + Number(b.agencyPrice)) * 100) / 100;
    if (!g._lastStay || b.checkIn > g._lastStay) g._lastStay = b.checkIn;
    g.bookings.push({ id: b.id, resortName: b.resortName, checkIn: b.checkIn, checkOut: b.checkOut, state: b.state, agencyPrice: Number(b.agencyPrice) });
  }

  const guests = [...map.values()]
    .map(({ _lastStay, ...g }) => ({ ...g, lastStay: _lastStay ? _lastStay.toISOString() : null, frequent: g.stays >= 3 }))
    .sort((a, b) => b.stays - a.stays);
  return { guests, totalStays: bookings.length };
}

/** Admin-wide booking list across all agencies (read-only oversight). */
export async function listAllBookings(page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { agency: { select: { legalName: true } } },
    }),
    prisma.booking.count(),
  ]);
  const items = rows.map(({ agency, ...b }) => ({ ...b, agencyName: agency.legalName }));
  return { items, total, page, pageSize };
}

/** Sweeps expired holds (for a scheduled worker). Returns the number expired. */
export async function expireStaleHolds(): Promise<number> {
  const stale = await prisma.booking.findMany({
    where: { state: 'AWAITING_PAYMENT', holdExpiresAt: { lt: new Date() } },
  });
  for (const booking of stale) {
    await expireIfLapsed(booking);
  }
  return stale.length;
}
