import type { Request, Response } from 'express';
import type { ActorRole } from '@prisma/client';
import { ApiError } from '../../utils/apiError';
import type { AuthUser } from '../../types/express';
import { assertAgentCan } from '../agents/agents.service';
import * as bookingService from './booking.service';
import * as bookingVoucher from './voucher.service';

const adminActor = (user: AuthUser) => ({ actorId: user.id, actorRole: user.role as ActorRole });

/** Every booking action is agency-scoped; the actor must belong to an agency. */
function agentActor(user: AuthUser): bookingService.AgentActor {
  if (!user.agencyId) {
    throw ApiError.forbidden('Only agency users can transact');
  }
  return { userId: user.id, agencyId: user.agencyId };
}

export async function create(req: Request, res: Response): Promise<void> {
  await assertAgentCan(req.user!.id, 'canBook');
  const booking = await bookingService.createBooking(req.body, agentActor(req.user!));
  res.status(201).json(booking);
}

/** v3 §4 — create a multi-room group booking (aggregate credit gate). */
export async function createGroup(req: Request, res: Response): Promise<void> {
  await assertAgentCan(req.user!.id, 'canBook');
  const bookings = await bookingService.createGroupBooking(req.body.lines, agentActor(req.user!));
  res.status(201).json({ groupId: bookings[0]?.groupId, bookings });
}

/** Pay all awaiting-payment lines of a group in one checkout. */
export async function payGroup(req: Request, res: Response): Promise<void> {
  const bookings = await bookingService.payGroup(req.params.groupId, agentActor(req.user!));
  res.status(200).json({ bookings });
}

export async function pay(req: Request, res: Response): Promise<void> {
  const booking = await bookingService.payBooking(req.params.id, agentActor(req.user!));
  res.status(200).json(booking);
}

export async function cancel(req: Request, res: Response): Promise<void> {
  await assertAgentCan(req.user!.id, 'canCancel');
  const booking = await bookingService.cancelBooking(req.params.id, agentActor(req.user!));
  res.status(200).json(booking);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const booking = await bookingService.getBooking(req.params.id, agentActor(req.user!));
  res.status(200).json(booking);
}

export async function list(req: Request, res: Response): Promise<void> {
  const { agencyId } = agentActor(req.user!);
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await bookingService.listBookings(agencyId, page, pageSize);
  res.status(200).json(result);
}

/** Guests derived from lead-guest data on bookings. Agency sees all; agent sees own. */
export async function guests(req: Request, res: Response): Promise<void> {
  const { agencyId } = agentActor(req.user!);
  const agentId = req.user!.role === 'AGENT' ? req.user!.id : undefined;
  res.status(200).json(await bookingService.listGuests(agencyId, agentId));
}

/** Booking voucher PDF. ADMIN any; AGENCY own agency; AGENT own bookings. */
export async function voucherPdf(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const scope =
    user.role === 'ADMIN'
      ? {}
      : { agencyId: agentActor(user).agencyId, agentId: user.role === 'AGENT' ? user.id : undefined };
  const { buffer, fileName } = await bookingVoucher.renderVoucherPdf(req.params.id, scope);
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

/** Admin-wide list across all agencies (read-only oversight). */
export async function adminList(req: Request, res: Response): Promise<void> {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await bookingService.listAllBookings(page, pageSize);
  res.status(200).json(result);
}

/** v3 §7.2 — admin records a no-show (policy charge applied). */
export async function adminNoShow(req: Request, res: Response): Promise<void> {
  const booking = await bookingService.adminCancelBooking(req.params.id, { kind: 'NO_SHOW' }, adminActor(req.user!));
  res.status(200).json(booking);
}

/** v3 §7.3 — admin cancels on the resort's behalf (full refund + reason). */
export async function adminResortCancel(req: Request, res: Response): Promise<void> {
  const booking = await bookingService.adminCancelBooking(req.params.id, { kind: 'RESORT_CANCEL', reason: req.body.reason }, adminActor(req.user!));
  res.status(200).json(booking);
}

/** v3 §5.2 — admin: list the open rebook queue (commit-failed / abandoned). */
export async function rebookQueue(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ items: await bookingService.listRebookQueue() });
}

/** v3 §5.2 — admin: process the pending rebook queue now. */
export async function runRebookQueue(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await bookingService.processRebookQueue());
}

/** v3 §5.2 — admin: force-retry a single commit-failed booking. */
export async function retryRebook(req: Request, res: Response): Promise<void> {
  res.status(200).json(await bookingService.retryRebook(req.params.id));
}

/** Admin: expire lapsed pay-first holds now (also run on a timer by the scheduler). */
export async function runHoldSweep(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ expired: await bookingService.expireStaleHolds() });
}
