import type { BookingState } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { businessToday, startOfBusinessDay } from '../../utils/businessDate';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  while (cur <= to) {
    days.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 6);
  return { from, to };
}

/** Company-wide dashboard data (ADMIN/VERIFIER) — real numbers from the ledger. */
export async function adminSummary(range: DateRange) {
  // Batch every independent read into ONE transaction so the whole dashboard
  // uses a single pooled connection (Supabase pool-friendly) rather than firing
  // ~15 concurrent queries. `totalRevenue` is derived from the payment-overview
  // groupBy below instead of a separate aggregate.
  const [
    totalBookings,
    activeAgents,
    activeAgencies,
    outstandingAgg,
    byStatus,
    topResortsRaw,
    recent,
    paymentsInRange,
    bookingsInRange,
    paymentsByStatus,
    revenueByAgencyRaw,
    bookByAgencyRaw,
    pendingApprovals,
    ekycPending,
  ] = await prisma.$transaction([
    prisma.booking.count(),
    prisma.user.count({ where: { role: 'AGENT', status: 'ACTIVE' } }),
    prisma.agency.count({ where: { status: 'ACTIVE', activatedAt: { not: null } } }),
    prisma.invoice.aggregate({ where: { status: 'ISSUED', paymentMode: 'CREDIT' }, _sum: { amount: true } }),
    prisma.booking.groupBy({ by: ['state'], _count: true, orderBy: { state: 'asc' } }),
    prisma.booking.groupBy({
      by: ['resortId', 'resortName'],
      where: { state: 'COMMITTED' },
      _sum: { agencyPrice: true },
      orderBy: { resortId: 'asc' },
    }),
    prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { agency: { select: { legalName: true } } },
    }),
    prisma.payment.findMany({
      where: { direction: 'INBOUND', status: 'SUCCEEDED', completedAt: { gte: range.from, lte: range.to } },
      select: { amount: true, completedAt: true },
    }),
    prisma.booking.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true },
    }),
    // Payment overview: sums grouped by direction+status (also gives total revenue).
    prisma.payment.groupBy({ by: ['direction', 'status'], _sum: { amount: true }, orderBy: { direction: 'asc' } }),
    // Top agencies by inbound revenue.
    prisma.payment.groupBy({
      by: ['agencyId'],
      where: { direction: 'INBOUND', status: 'SUCCEEDED' },
      _sum: { amount: true },
      orderBy: { agencyId: 'asc' },
    }),
    prisma.booking.groupBy({ by: ['agencyId'], _count: true, orderBy: { agencyId: 'asc' } }),
    prisma.agencyApplication.count({ where: { lifecycleState: 'REVIEW' } }),
    prisma.agencyApplication.count({ where: { lifecycleState: { in: ['VERIFICATION', 'REVIEW'] } } }),
  ]);

  // Time series (bookings + revenue per day).
  const days = eachDay(range.from, range.to);
  const revenueByDay = new Map<string, number>();
  for (const p of paymentsInRange) {
    if (!p.completedAt) continue;
    const k = dayKey(p.completedAt);
    revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + Number(p.amount));
  }
  const bookingsByDay = new Map<string, number>();
  for (const b of bookingsInRange) {
    const k = dayKey(b.createdAt);
    bookingsByDay.set(k, (bookingsByDay.get(k) ?? 0) + 1);
  }
  const series = days.map((day) => ({
    day,
    bookings: bookingsByDay.get(day) ?? 0,
    revenue: revenueByDay.get(day) ?? 0,
  }));

  const topResorts = topResortsRaw
    .map((r) => ({ resortId: r.resortId, resortName: r.resortName, revenue: Number(r._sum?.agencyPrice ?? 0) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Payment overview (paid / pending / failed / refunded).
  let paid = 0;
  let pendingPay = 0;
  let failedPay = 0;
  let refunded = 0;
  for (const p of paymentsByStatus) {
    const amt = Number(p._sum?.amount ?? 0);
    if (p.direction === 'OUTBOUND') {
      if (p.status === 'SUCCEEDED') refunded += amt;
    } else if (p.status === 'SUCCEEDED') paid += amt;
    else if (p.status === 'PENDING') pendingPay += amt;
    else if (p.status === 'FAILED') failedPay += amt;
  }

  // Top agencies by revenue.
  const revById = new Map(revenueByAgencyRaw.map((r) => [r.agencyId, Number(r._sum?.amount ?? 0)]));
  const bookById = new Map(bookByAgencyRaw.map((r) => [r.agencyId, r._count]));
  const topAgencyIds = [...revById.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  // Second (dependent) batch, again a single transaction → one connection.
  const [topAgencyRecords, outByAgency] = await prisma.$transaction([
    prisma.agency.findMany({ where: { id: { in: topAgencyIds } }, select: { id: true, legalName: true } }),
    prisma.invoice.groupBy({
      by: ['agencyId'],
      where: { agencyId: { in: topAgencyIds }, status: 'ISSUED', paymentMode: 'CREDIT' },
      _sum: { amount: true },
      orderBy: { agencyId: 'asc' },
    }),
  ]);
  const nameById = new Map(topAgencyRecords.map((a) => [a.id, a.legalName]));
  const outById = new Map(outByAgency.map((r) => [r.agencyId, Number(r._sum?.amount ?? 0)]));
  const topAgencies = topAgencyIds.map((id) => ({
    agencyId: id,
    agencyName: nameById.get(id) ?? '(unknown)',
    bookings: bookById.get(id) ?? 0,
    revenue: revById.get(id) ?? 0,
    outstanding: outById.get(id) ?? 0,
  }));

  return {
    kpis: {
      totalBookings,
      totalRevenue: paid, // derived from the payment-overview groupBy (no extra query)
      activeAgents,
      activeAgencies,
      outstandingAmount: Number(outstandingAgg._sum?.amount ?? 0),
    },
    bookingsByStatus: byStatus.map((s) => ({ state: s.state, count: s._count })),
    series,
    topResorts,
    topAgencies,
    paymentOverview: { paid, pending: pendingPay, failed: failedPay, refunded },
    approvals: { pendingReview: pendingApprovals, ekycPending },
    recentBookings: recent.map((b) => ({
      id: b.id,
      resortName: b.resortName,
      roomTypeName: b.roomTypeName,
      agencyName: b.agency.legalName,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      guests: b.guests,
      state: b.state,
      agencyPrice: Number(b.agencyPrice),
    })),
  };
}

/** Agency-scoped dashboard data (AGENCY/AGENT). */
/**
 * Agency dashboard summary. When `agentId` is supplied (agent's own overview),
 * the booking metrics are scoped to that agent; credit/AR stays agency-level (an
 * agent transacts on the agency's credit line), and `totalSpend` becomes the
 * agent's own booking value rather than agency-wide collections.
 */
export async function agencySummary(agencyId: string, range: DateRange, agentId?: string) {
  const bookingWhere = agentId ? { agencyId, agentId } : { agencyId };
  const startOfToday = startOfBusinessDay();
  const today = businessToday();
  const liveStates = { notIn: ['CANCELLED', 'EXPIRED'] as BookingState[] };
  // One transaction / one connection for the whole agency dashboard (incl. the
  // balance inputs, inlined so there's no nested query fan-out).
  const [outstandingAgg, config, totalBookings, byStatus, recent, revenueAgg, bookingsInRange, agentValueAgg, todayBookings, upcomingCheckIns, activeAgents] =
    await prisma.$transaction([
      prisma.invoice.aggregate({ where: { agencyId, paymentMode: 'CREDIT', status: 'ISSUED' }, _sum: { amount: true } }),
      prisma.commercialConfiguration.findFirst({ where: { agencyId, isCurrent: true } }),
      prisma.booking.count({ where: bookingWhere }),
      prisma.booking.groupBy({ by: ['state'], where: bookingWhere, _count: true, orderBy: { state: 'asc' } }),
      prisma.booking.findMany({ where: bookingWhere, orderBy: { createdAt: 'desc' }, take: 6 }),
      prisma.payment.aggregate({ where: { agencyId, direction: 'INBOUND', status: 'SUCCEEDED' }, _sum: { amount: true } }),
      prisma.booking.findMany({
        where: { ...bookingWhere, createdAt: { gte: range.from, lte: range.to } },
        select: { createdAt: true, agencyPrice: true },
      }),
      prisma.booking.aggregate({ where: { ...bookingWhere, state: liveStates }, _sum: { agencyPrice: true } }),
      prisma.booking.count({ where: { ...bookingWhere, createdAt: { gte: startOfToday } } }),
      prisma.booking.count({ where: { ...bookingWhere, checkIn: { gte: today }, state: liveStates } }),
      prisma.user.count({ where: { agencyId, role: 'AGENT', status: 'ACTIVE' } }),
    ]);

  const outstanding = Number(outstandingAgg._sum?.amount ?? 0);
  const creditLimit = config ? Number(config.creditLimit) : 0;
  const balance = { outstanding, creditLimit, available: Math.max(0, creditLimit - outstanding) };

  const days = eachDay(range.from, range.to);
  const spendByDay = new Map<string, number>();
  const countByDay = new Map<string, number>();
  for (const b of bookingsInRange) {
    const k = dayKey(b.createdAt);
    spendByDay.set(k, (spendByDay.get(k) ?? 0) + Number(b.agencyPrice));
    countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
  }
  const series = days.map((day) => ({
    day,
    bookings: countByDay.get(day) ?? 0,
    spend: spendByDay.get(day) ?? 0,
  }));

  return {
    kpis: {
      totalBookings,
      totalSpend: agentId ? Number(agentValueAgg._sum?.agencyPrice ?? 0) : Number(revenueAgg._sum?.amount ?? 0),
      outstanding: balance.outstanding,
      creditLimit: balance.creditLimit,
      available: balance.available,
      todayBookings,
      upcomingCheckIns,
      activeAgents,
    },
    bookingsByStatus: byStatus.map((s) => ({ state: s.state, count: s._count })),
    series,
    recentBookings: recent.map((b) => ({
      id: b.id,
      resortName: b.resortName,
      roomTypeName: b.roomTypeName,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      state: b.state,
      agencyPrice: Number(b.agencyPrice),
    })),
  };
}
