import crypto from 'node:crypto';
import type { ActorRole, Booking, Invoice, Payment, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getPaymentGateway } from '../../lib/payments';
import { broadcast } from '../../lib/realtime';
import { logger } from '../../lib/logger';
import { ApiError } from '../../utils/apiError';
import { recordAuditLogSafe } from '../audit/audit.service';
import { notify } from '../notifications/notification.service';
import { computeCancellation } from './cancellation';
import { computeGst, generateIrn } from './gst';
import { getInvoiceNumberFormat } from '../settings/settings.service';
import { enqueueCrsEvent, flushOutbox } from './crsOutbox.service';

function invoiceNumber(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  // Admin-configurable template (System Settings → Financial). Supported tokens:
  // {YYYY} {YY} {MM} {RAND}. {RAND} guarantees uniqueness.
  const template = getInvoiceNumberFormat() || 'INV-{YYYY}{MM}-{RAND}';
  const out = template
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{RAND\}/g, rand)
    .replace(/\{SEQ\}/gi, rand); // {seq} alias → random (no global counter)
  // Always ensure a random component so numbers stay unique even if the template omits {RAND}.
  return /\{?RAND|SEQ/i.test(template) || out.includes(rand) ? out : `${out}-${rand}`;
}

function creditNoteNumber(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `CN-${ym}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** GST tax fields for a booking's invoice (v3 §6.1). Recipient = agency GSTIN. */
async function gstFieldsFor(booking: Booking) {
  const agency = await prisma.agency.findUnique({ where: { id: booking.agencyId }, select: { gstin: true } });
  const g = computeGst({
    taxableValue: Number(booking.agencyPrice),
    nights: booking.nights,
    resortId: booking.resortId,
    recipientGstin: agency?.gstin,
  });
  return {
    gstRate: g.gstRate,
    sac: g.sac,
    placeOfSupply: g.placeOfSupply,
    supplierGstin: g.supplierGstin,
    recipientGstin: g.recipientGstin,
    cgst: g.cgst,
    sgst: g.sgst,
    igst: g.igst,
    invoiceTotal: g.invoiceTotal,
    irn: generateIrn(`${booking.correlationId}:invoice`),
  };
}

/** GST split for a credit note, mirroring the original invoice's rate & place-of-supply. */
function creditNoteGst(invoice: Invoice, reductionTaxable: number) {
  const rate = invoice.gstRate;
  const inter = Number(invoice.igst) > 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (rate > 0) {
    const tax = round2((reductionTaxable * rate) / 100);
    if (inter) igst = tax;
    else {
      cgst = round2(tax / 2);
      sgst = round2(tax - cgst);
    }
  }
  return { gstRate: rate, cgst, sgst, igst, total: round2(reductionTaxable + cgst + sgst + igst) };
}

function parseNetDays(terms: string): number {
  const m = /(\d+)/.exec(terms);
  return m ? Number(m[1]) : 15;
}

/** Deliver outbox events immediately in dev (in addition to the worker). */
async function flushInline(): Promise<void> {
  if (!env.CRS_FLUSH_INLINE) return;
  try {
    await flushOutbox();
  } catch (err) {
    logger.error('Inline CRS flush failed (worker will retry)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Balance owed on credit: unsettled CREDIT invoices, net of any partial payments
 * (v3 §5.3). AR = Σ(amount − amountPaid) over ISSUED/PARTIALLY_PAID credit invoices.
 * This feeds the credit gate.
 */
export async function getOutstanding(agencyId: string): Promise<number> {
  const agg = await prisma.invoice.aggregate({
    where: { agencyId, paymentMode: 'CREDIT', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
    _sum: { amount: true, amountPaid: true },
  });
  const billed = agg._sum.amount ? Number(agg._sum.amount) : 0;
  const paid = agg._sum.amountPaid ? Number(agg._sum.amountPaid) : 0;
  return round2(Math.max(0, billed - paid));
}

/**
 * Records a credit booking's obligation: an ISSUED credit invoice (due per the
 * agency's payment terms) plus a CRS BOOKING_OBLIGATION event, atomically.
 */
export async function recordBookingObligation(booking: Booking, paymentTerms: string): Promise<Invoice> {
  const dueDate = new Date(Date.now() + parseNetDays(paymentTerms) * 24 * 60 * 60 * 1000);
  const amount = Number(booking.agencyPrice);
  const gst = await gstFieldsFor(booking);
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        number: invoiceNumber(),
        agencyId: booking.agencyId,
        bookingId: booking.id,
        correlationId: booking.correlationId,
        amount: booking.agencyPrice,
        paymentMode: 'CREDIT',
        status: 'ISSUED',
        dueDate,
        ...gst,
      },
    });
    await enqueueCrsEvent(tx, {
      eventType: 'BOOKING_OBLIGATION',
      correlationId: booking.correlationId,
      payload: { bookingId: booking.id, agencyId: booking.agencyId, amount, paymentMode: 'CREDIT' },
    });
    return inv;
  });
  await recordAuditLogSafe({
    entityType: 'Invoice',
    entityId: invoice.id,
    event: 'INVOICE_ISSUED',
    actorId: null,
    actorRole: 'SYSTEM',
    after: { number: invoice.number, amount, paymentMode: 'CREDIT' },
  });
  await flushInline();
  return invoice;
}

/**
 * Collects payment for a pay-first booking: captures via the gateway, then
 * atomically records a SUCCEEDED payment, a PAID invoice, and a CRS PAYMENT
 * event. Throws (leaving the booking unpaid) if capture fails.
 */
export async function collectPaymentForBooking(booking: Booking): Promise<Invoice> {
  const amount = Number(booking.agencyPrice);
  const capture = await getPaymentGateway().capture({
    correlationId: booking.correlationId,
    amount,
    agencyId: booking.agencyId,
  });
  if (capture.status !== 'SUCCEEDED') {
    throw ApiError.badRequest('Payment was not completed');
  }

  const gst = await gstFieldsFor(booking);
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        number: invoiceNumber(),
        agencyId: booking.agencyId,
        bookingId: booking.id,
        correlationId: booking.correlationId,
        amount: booking.agencyPrice,
        paymentMode: 'PREPAY',
        status: 'PAID',
        paidAt: new Date(),
        ...gst,
      },
    });
    await tx.payment.create({
      data: {
        agencyId: booking.agencyId,
        bookingId: booking.id,
        invoiceId: inv.id,
        correlationId: booking.correlationId,
        amount: booking.agencyPrice,
        direction: 'INBOUND',
        status: 'SUCCEEDED',
        // Record which gateway actually captured this (mock in dev) instead of
        // relying on the schema's historical "airpay" default.
        gateway: env.PAYMENT_PROVIDER,
        gatewayRef: capture.gatewayRef,
        completedAt: new Date(),
      },
    });
    await enqueueCrsEvent(tx, {
      eventType: 'PAYMENT',
      correlationId: booking.correlationId,
      payload: { bookingId: booking.id, agencyId: booking.agencyId, amount, gatewayRef: capture.gatewayRef },
    });
    return inv;
  });
  await recordAuditLogSafe({
    entityType: 'Invoice',
    entityId: invoice.id,
    event: 'PAYMENT_COLLECTED',
    actorId: null,
    actorRole: 'SYSTEM',
    after: { number: invoice.number, amount, gatewayRef: capture.gatewayRef },
  });
  await flushInline();
  return invoice;
}

/**
 * Applies the cancellation policy to a booking on cancel: computes the charge +
 * refund, adjusts the invoice/AR, refunds any paid amount via the gateway, and
 * posts CRS CANCELLATION_CHARGE (+ REFUND) events.
 */
export async function applyCancellation(
  booking: Booking,
  cancelledAt: Date,
  override?: { chargePct: number },
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
  const price = Number(booking.agencyPrice);
  // Resort-initiated changes (§7.3) force a full refund; otherwise apply the D4 bands.
  const outcome = override
    ? { chargePct: override.chargePct, chargeAmount: round2((price * override.chargePct) / 100), refundAmount: round2(price - round2((price * override.chargePct) / 100)) }
    : computeCancellation(price, booking.checkIn, cancelledAt);

  // Refund cash only for a paid (prepay) invoice.
  let refundRef: string | undefined;
  if (invoice && invoice.status === 'PAID' && outcome.refundAmount > 0) {
    const payment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, direction: 'INBOUND', status: 'SUCCEEDED' },
    });
    if (payment?.gatewayRef) {
      const r = await getPaymentGateway().refund(payment.gatewayRef, outcome.refundAmount);
      refundRef = r.refundRef;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (invoice) {
      if (invoice.status === 'PAID') {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'REFUNDED' } });
        if (refundRef) {
          await tx.payment.create({
            data: {
              agencyId: booking.agencyId,
              bookingId: booking.id,
              invoiceId: invoice.id,
              correlationId: booking.correlationId,
              amount: outcome.refundAmount,
              direction: 'OUTBOUND',
              status: 'SUCCEEDED',
              gateway: env.PAYMENT_PROVIDER,
              gatewayRef: refundRef,
              completedAt: new Date(),
            },
          });
        }
      } else if (invoice.status === 'ISSUED') {
        // Credit booking: agency now owes only the cancellation charge.
        if (outcome.chargeAmount > 0) {
          await tx.invoice.update({ where: { id: invoice.id }, data: { amount: outcome.chargeAmount } });
        } else {
          await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'VOID' } });
        }
      }

      // v3 §6.4 — issue a GST credit note for the reduced/refunded portion.
      if (outcome.refundAmount > 0) {
        const cn = creditNoteGst(invoice, outcome.refundAmount);
        await tx.creditNote.create({
          data: {
            number: creditNoteNumber(),
            invoiceId: invoice.id,
            agencyId: booking.agencyId,
            correlationId: booking.correlationId,
            reason: `Cancellation — ${outcome.chargePct}% charge applied`,
            taxableValue: outcome.refundAmount,
            ...cn,
            irn: generateIrn(`${booking.correlationId}:creditnote`),
          },
        });
      }
    }

    if (outcome.chargeAmount > 0) {
      await enqueueCrsEvent(tx, {
        eventType: 'CANCELLATION_CHARGE',
        correlationId: booking.correlationId,
        payload: { bookingId: booking.id, agencyId: booking.agencyId, chargeAmount: outcome.chargeAmount, chargePct: outcome.chargePct },
      });
    }
    if (outcome.refundAmount > 0 && invoice?.status === 'PAID') {
      await enqueueCrsEvent(tx, {
        eventType: 'REFUND',
        correlationId: booking.correlationId,
        payload: { bookingId: booking.id, agencyId: booking.agencyId, refundAmount: outcome.refundAmount, refundRef: refundRef ?? null },
      });
    }
  });

  await recordAuditLogSafe({
    entityType: 'Booking',
    entityId: booking.id,
    event: 'CANCELLATION_SETTLED',
    actorId: null,
    actorRole: 'SYSTEM',
    after: { ...outcome },
  });
  await flushInline();
}

/**
 * Agency settles an outstanding credit invoice via the gateway. Supports partial
 * payments (v3 §5.3): `amount` defaults to the full remaining balance; a smaller
 * amount pays it down and leaves the invoice PARTIALLY_PAID until fully cleared.
 */
export async function settleInvoice(invoiceId: string, agencyId: string, amount?: number): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.agencyId !== agencyId) throw ApiError.notFound('Invoice not found');
  if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') throw ApiError.conflict('Invoice is not payable');

  const remaining = round2(Number(invoice.amount) - Number(invoice.amountPaid));
  if (remaining <= 0) throw ApiError.conflict('Invoice is already settled');
  const pay = amount === undefined ? remaining : round2(amount);
  if (pay <= 0) throw ApiError.badRequest('Payment amount must be greater than zero');
  if (pay > remaining) throw ApiError.badRequest(`Payment exceeds the outstanding balance of ${remaining}`);

  const capture = await getPaymentGateway().capture({ correlationId: invoice.correlationId, amount: pay, agencyId });
  if (capture.status !== 'SUCCEEDED') throw ApiError.badRequest('Payment was not completed');

  const newPaid = round2(Number(invoice.amountPaid) + pay);
  const fullySettled = newPaid >= Number(invoice.amount) - 0.001;

  const paid = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newPaid,
        status: fullySettled ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: fullySettled ? new Date() : null,
      },
    });
    await tx.payment.create({
      data: {
        agencyId,
        bookingId: invoice.bookingId,
        invoiceId: invoice.id,
        correlationId: invoice.correlationId,
        amount: pay,
        direction: 'INBOUND',
        status: 'SUCCEEDED',
        gateway: env.PAYMENT_PROVIDER,
        gatewayRef: capture.gatewayRef,
        completedAt: new Date(),
      },
    });
    await enqueueCrsEvent(tx, {
      eventType: 'PAYMENT',
      correlationId: invoice.correlationId,
      payload: { invoiceId: invoice.id, agencyId, amount: pay, gatewayRef: capture.gatewayRef, settlement: true, partial: !fullySettled },
    });
    return updated;
  });
  await recordAuditLogSafe({
    entityType: 'Invoice',
    entityId: invoice.id,
    event: fullySettled ? 'INVOICE_SETTLED' : 'INVOICE_PARTIALLY_PAID',
    actorId: null,
    actorRole: 'SYSTEM',
    after: { number: invoice.number, amount: pay, amountPaid: newPaid, invoiceAmount: Number(invoice.amount) },
  });
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { contactEmail: true, contactPhone: true } });
  if (agency) {
    await notify(
      { event: 'PAYMENT_RECEIVED', number: invoice.number, amount: pay },
      { email: agency.contactEmail, phone: agency.contactPhone },
      { entityType: 'Invoice', entityId: invoice.id },
    );
  }
  await flushInline();
  await broadcast(['finance'], { agencyId });
  return paid;
}

/**
 * Records a chargeback (v3 §5.3): a previously SUCCEEDED inbound payment is
 * disputed and reversed by the gateway. Reverses the settled amount on the linked
 * invoice (re-opening AR), books an OUTBOUND CHARGEBACK payment, posts a CRS
 * CHARGEBACK event, and notifies the agency. Admin-initiated.
 */
export async function recordChargeback(
  paymentId: string,
  reason: string,
  actor: { actorId: string | null; actorRole: ActorRole },
): Promise<Payment> {
  const original = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!original) throw ApiError.notFound('Payment not found');
  if (original.direction !== 'INBOUND' || original.status !== 'SUCCEEDED') {
    throw ApiError.conflict('Only a successful inbound payment can be charged back');
  }
  const already = await prisma.payment.findFirst({
    where: { correlationId: original.correlationId, status: 'CHARGEBACK', gatewayRef: original.gatewayRef },
  });
  if (already) throw ApiError.conflict('This payment has already been charged back');

  const amount = Number(original.amount);
  const invoice = original.invoice;

  const chargeback = await prisma.$transaction(async (tx) => {
    const cb = await tx.payment.create({
      data: {
        agencyId: original.agencyId,
        bookingId: original.bookingId,
        invoiceId: original.invoiceId,
        correlationId: original.correlationId,
        amount,
        direction: 'OUTBOUND',
        status: 'CHARGEBACK',
        // A chargeback reverses the ORIGINAL payment — carry its gateway.
        gateway: original.gateway,
        gatewayRef: original.gatewayRef,
        completedAt: new Date(),
      },
    });
    if (invoice) {
      // Reverse the settled amount; re-open AR (ISSUED/PARTIALLY_PAID) unless it was a refund basis.
      const newPaid = round2(Math.max(0, Number(invoice.amountPaid) - amount));
      const status = newPaid <= 0 ? 'ISSUED' : 'PARTIALLY_PAID';
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: newPaid, status, paidAt: null },
      });
    }
    await enqueueCrsEvent(tx, {
      eventType: 'CHARGEBACK',
      correlationId: original.correlationId,
      payload: { paymentId: original.id, agencyId: original.agencyId, amount, gatewayRef: original.gatewayRef, reason },
    });
    return cb;
  });

  await recordAuditLogSafe({
    entityType: 'Payment',
    entityId: original.id,
    event: 'PAYMENT_CHARGEBACK',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { amount, reason, chargebackId: chargeback.id, invoiceId: original.invoiceId },
  });
  const agency = await prisma.agency.findUnique({
    where: { id: original.agencyId },
    select: { contactEmail: true, contactPhone: true },
  });
  if (agency) {
    await notify(
      { event: 'PAYMENT_CHARGEBACK', number: invoice?.number ?? original.gatewayRef ?? original.id, amount, reason },
      { email: agency.contactEmail, phone: agency.contactPhone },
      { entityType: 'Payment', entityId: original.id },
    );
  }
  await flushInline();
  await broadcast(['finance'], { agencyId: original.agencyId });
  return chargeback;
}

/** Admin — recent inbound payments with settlement/chargeback state (v3 §5.3). */
export async function listPayments(page: number, pageSize: number) {
  const where: Prisma.PaymentWhereInput = { direction: 'INBOUND' };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { agency: { select: { legalName: true } }, invoice: { select: { number: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  // A payment is "charged back" if a CHARGEBACK row shares its gatewayRef/correlationId.
  const refs = rows.map((p) => p.gatewayRef).filter((r): r is string => !!r);
  const chargedBack = new Set(
    (await prisma.payment.findMany({ where: { status: 'CHARGEBACK', gatewayRef: { in: refs } }, select: { gatewayRef: true } }))
      .map((p) => p.gatewayRef!),
  );
  const items = rows.map((p) => ({
    id: p.id,
    agencyName: p.agency.legalName,
    invoiceNumber: p.invoice?.number ?? null,
    amount: Number(p.amount),
    status: p.status,
    gatewayRef: p.gatewayRef,
    createdAt: p.createdAt,
    chargedBack: !!p.gatewayRef && chargedBack.has(p.gatewayRef),
  }));
  return { items, total, page, pageSize };
}

export interface AgencyBalance {
  outstanding: number;
  creditLimit: number;
  available: number;
}

export async function getAgencyBalance(agencyId: string): Promise<AgencyBalance> {
  const [outstanding, config] = await Promise.all([
    getOutstanding(agencyId),
    prisma.commercialConfiguration.findFirst({ where: { agencyId, isCurrent: true } }),
  ]);
  const creditLimit = config ? Number(config.creditLimit) : 0;
  return { outstanding, creditLimit, available: Math.max(0, creditLimit - outstanding) };
}

export interface CreditAgencyBalance {
  agencyId: string;
  legalName: string;
  gstin: string | null;
  status: string;
  creditLimit: number;
  outstanding: number;
  available: number;
  advance: number;
  openInvoices: number;
}

/**
 * An agency's unapplied advance (credit) balance: money received offline beyond
 * what was owed at the time. Tracked as INBOUND `offline` payments not yet linked
 * to an invoice (invoiceId = null). Applying it (applyAgencyAdvance) links it to
 * open invoices, at which point it leaves this pool.
 */
export async function getAdvanceBalance(agencyId: string): Promise<number> {
  const agg = await prisma.payment.aggregate({
    where: { agencyId, gateway: 'offline', direction: 'INBOUND', status: 'SUCCEEDED', invoiceId: null },
    _sum: { amount: true },
  });
  return round2(Number(agg._sum.amount ?? 0));
}

export interface SettlementBalance {
  outstanding: number;
  creditLimit: number;
  available: number;
  advance: number;
}

/** Balance shape for the admin settlement view — gross AR plus the advance pool. */
export async function getSettlementBalance(agencyId: string): Promise<SettlementBalance> {
  const [outstanding, advance, config] = await Promise.all([
    getOutstanding(agencyId),
    getAdvanceBalance(agencyId),
    prisma.commercialConfiguration.findFirst({ where: { agencyId, isCurrent: true } }),
  ]);
  const creditLimit = config ? Number(config.creditLimit) : 0;
  return { outstanding, creditLimit, available: Math.max(0, round2(creditLimit - outstanding)), advance };
}

/**
 * Admin settlement view: every agency that operates on credit — i.e. has a
 * current CREDIT commercial config OR any open credit invoices — with their
 * live balances. `search` filters by legal name or GSTIN (case-insensitive).
 */
export async function listCreditAgencyBalances(search?: string): Promise<CreditAgencyBalance[]> {
  const [creditConfigs, invoiceAgg, advanceAgg] = await Promise.all([
    prisma.commercialConfiguration.findMany({
      where: { isCurrent: true, paymentMode: 'CREDIT' },
      select: { agencyId: true, creditLimit: true },
    }),
    prisma.invoice.groupBy({
      by: ['agencyId'],
      where: { paymentMode: 'CREDIT', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      _sum: { amount: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['agencyId'],
      where: { gateway: 'offline', direction: 'INBOUND', status: 'SUCCEEDED', invoiceId: null },
      _sum: { amount: true },
    }),
  ]);

  const limitByAgency = new Map(creditConfigs.map((c) => [c.agencyId, Number(c.creditLimit)]));
  const advanceByAgency = new Map(advanceAgg.map((g) => [g.agencyId, round2(Number(g._sum.amount ?? 0))]));
  const owedByAgency = new Map(
    invoiceAgg.map((g) => [
      g.agencyId,
      {
        outstanding: round2(Math.max(0, Number(g._sum.amount ?? 0) - Number(g._sum.amountPaid ?? 0))),
        openInvoices: g._count._all,
      },
    ]),
  );

  const agencyIds = Array.from(new Set([...limitByAgency.keys(), ...owedByAgency.keys(), ...advanceByAgency.keys()]));
  if (agencyIds.length === 0) return [];

  const where: Prisma.AgencyWhereInput = { id: { in: agencyIds } };
  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { legalName: { contains: q, mode: 'insensitive' } },
      { gstin: { contains: q, mode: 'insensitive' } },
    ];
  }
  const agencies = await prisma.agency.findMany({
    where,
    select: { id: true, legalName: true, gstin: true, status: true },
    orderBy: { legalName: 'asc' },
  });

  return agencies.map((a) => {
    const owed = owedByAgency.get(a.id);
    const creditLimit = limitByAgency.get(a.id) ?? 0;
    const outstanding = owed?.outstanding ?? 0;
    return {
      agencyId: a.id,
      legalName: a.legalName,
      gstin: a.gstin,
      status: a.status,
      creditLimit,
      outstanding,
      available: Math.max(0, round2(creditLimit - outstanding)),
      advance: advanceByAgency.get(a.id) ?? 0,
      openInvoices: owed?.openInvoices ?? 0,
    };
  });
}

export type SettlementMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'UPI' | 'OTHER';

export interface OfflineSettlementInput {
  agencyId: string;
  amount: number;
  method: SettlementMethod;
  reference?: string;
  note?: string;
}

export interface SettlementResult {
  applied: number; // amount applied to open invoices
  advanceRecorded: number; // overpayment parked as advance credit
  allocations: { invoiceId: string; number: string; applied: number; fullySettled: boolean }[];
  balance: SettlementBalance;
}

/**
 * Admin records an OFFLINE payment (cash / bank transfer / cheque / UPI) received
 * from a credit agency. The amount is applied FIFO across the agency's open credit
 * invoices (oldest due first), reducing outstanding AR and freeing available credit.
 * Any amount beyond the current outstanding is parked as an advance (credit) that
 * can later be applied to new invoices (applyAgencyAdvance). No gateway is involved;
 * each invoice allocation and the advance remainder book INBOUND `offline` payments.
 */
export async function recordOfflineSettlement(
  input: OfflineSettlementInput,
  actor: { actorId: string | null; actorRole: ActorRole },
): Promise<SettlementResult> {
  const agency = await prisma.agency.findUnique({
    where: { id: input.agencyId },
    select: { id: true, legalName: true, contactEmail: true, contactPhone: true },
  });
  if (!agency) throw ApiError.notFound('Agency not found');

  const amount = round2(input.amount);
  if (amount <= 0) throw ApiError.badRequest('Settlement amount must be greater than zero');

  const openInvoices = await prisma.invoice.findMany({
    where: { agencyId: input.agencyId, paymentMode: 'CREDIT', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
    orderBy: [{ dueDate: 'asc' }, { issuedAt: 'asc' }],
  });

  const refLabel = input.reference?.trim() ? `${input.method}:${input.reference.trim()}` : input.method;
  const allocations: SettlementResult['allocations'] = [];
  let remaining = amount;

  await prisma.$transaction(async (tx) => {
    for (const inv of openInvoices) {
      if (remaining <= 0.001) break;
      const invRemaining = round2(Number(inv.amount) - Number(inv.amountPaid));
      if (invRemaining <= 0) continue;
      const applied = round2(Math.min(remaining, invRemaining));
      const newPaid = round2(Number(inv.amountPaid) + applied);
      const fullySettled = newPaid >= Number(inv.amount) - 0.001;
      await tx.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: newPaid, status: fullySettled ? 'PAID' : 'PARTIALLY_PAID', paidAt: fullySettled ? new Date() : null },
      });
      await tx.payment.create({
        data: {
          agencyId: input.agencyId,
          bookingId: inv.bookingId,
          invoiceId: inv.id,
          correlationId: inv.correlationId,
          amount: applied,
          direction: 'INBOUND',
          status: 'SUCCEEDED',
          gateway: 'offline',
          gatewayRef: refLabel,
          completedAt: new Date(),
        },
      });
      await enqueueCrsEvent(tx, {
        eventType: 'PAYMENT',
        correlationId: inv.correlationId,
        payload: { invoiceId: inv.id, agencyId: input.agencyId, amount: applied, method: input.method, offline: true, settlement: true, partial: !fullySettled },
      });
      allocations.push({ invoiceId: inv.id, number: inv.number, applied, fullySettled });
      remaining = round2(remaining - applied);
    }

    // Overpayment → park the remainder as an unapplied advance (invoiceId = null).
    if (remaining > 0.001) {
      await tx.payment.create({
        data: {
          agencyId: input.agencyId,
          correlationId: crypto.randomUUID(),
          amount: remaining,
          direction: 'INBOUND',
          status: 'SUCCEEDED',
          gateway: 'offline',
          gatewayRef: input.reference?.trim() ? `ADVANCE:${input.method}:${input.reference.trim()}` : `ADVANCE:${input.method}`,
          completedAt: new Date(),
        },
      });
    }
  });

  const applied = round2(amount - remaining);
  const advanceRecorded = round2(remaining);
  await recordAuditLogSafe({
    entityType: 'Agency',
    entityId: input.agencyId,
    event: 'OFFLINE_SETTLEMENT_RECORDED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { amount, applied, advanceRecorded, method: input.method, reference: input.reference ?? null, note: input.note ?? null, allocations },
  });
  if (agency.contactEmail || agency.contactPhone) {
    await notify(
      { event: 'PAYMENT_RECEIVED', number: refLabel, amount },
      { email: agency.contactEmail, phone: agency.contactPhone },
      { entityType: 'Agency', entityId: input.agencyId },
    );
  }
  await flushInline();
  await broadcast(['finance'], { agencyId: input.agencyId });

  return { applied, advanceRecorded, allocations, balance: await getSettlementBalance(input.agencyId) };
}

const appliedRef = (ref: string | null) => (ref ? `${ref.replace(/^ADVANCE:/, '')}/APPLIED` : 'ADVANCE_APPLIED');

/**
 * Applies an agency's unapplied advance (credit) balance FIFO across its open
 * credit invoices. Advance payments are re-linked (or split) onto the invoices —
 * no new cash is created — so per-invoice ledgers and dashboard totals stay exact.
 */
export async function applyAgencyAdvance(
  agencyId: string,
  actor: { actorId: string | null; actorRole: ActorRole },
): Promise<{ applied: number; balance: SettlementBalance }> {
  const advance = await getAdvanceBalance(agencyId);
  if (advance <= 0) throw ApiError.conflict('This agency has no advance balance to apply');

  const openInvoices = await prisma.invoice.findMany({
    where: { agencyId, paymentMode: 'CREDIT', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
    orderBy: [{ dueDate: 'asc' }, { issuedAt: 'asc' }],
  });
  const outstanding = openInvoices.reduce((s, i) => round2(s + (Number(i.amount) - Number(i.amountPaid))), 0);
  if (outstanding <= 0) throw ApiError.conflict('This agency has no open invoices to apply the advance to');

  const advancePayments = await prisma.payment.findMany({
    where: { agencyId, gateway: 'offline', direction: 'INBOUND', status: 'SUCCEEDED', invoiceId: null },
    orderBy: { createdAt: 'asc' },
  });

  let appliedTotal = 0;
  await prisma.$transaction(async (tx) => {
    let ai = 0;
    let advRemaining = advancePayments.length ? round2(Number(advancePayments[0].amount)) : 0;

    for (const inv of openInvoices) {
      let need = round2(Number(inv.amount) - Number(inv.amountPaid));
      let appliedToInv = 0;
      while (need > 0.001 && ai < advancePayments.length) {
        if (advRemaining <= 0.001) {
          ai += 1;
          advRemaining = ai < advancePayments.length ? round2(Number(advancePayments[ai].amount)) : 0;
          continue;
        }
        const adv = advancePayments[ai];
        const take = round2(Math.min(need, advRemaining));
        if (take >= advRemaining - 0.001) {
          // Whole advance payment funds this invoice → re-link it.
          await tx.payment.update({
            where: { id: adv.id },
            data: { invoiceId: inv.id, bookingId: inv.bookingId, correlationId: inv.correlationId, gatewayRef: appliedRef(adv.gatewayRef) },
          });
        } else {
          // Split: shrink the advance payment, book the taken slice against the invoice.
          await tx.payment.update({ where: { id: adv.id }, data: { amount: round2(advRemaining - take) } });
          await tx.payment.create({
            data: {
              agencyId,
              bookingId: inv.bookingId,
              invoiceId: inv.id,
              correlationId: inv.correlationId,
              amount: take,
              direction: 'INBOUND',
              status: 'SUCCEEDED',
              gateway: 'offline',
              gatewayRef: appliedRef(adv.gatewayRef),
              completedAt: new Date(),
            },
          });
        }
        appliedToInv = round2(appliedToInv + take);
        need = round2(need - take);
        advRemaining = round2(advRemaining - take);
      }

      if (appliedToInv > 0.001) {
        const newPaid = round2(Number(inv.amountPaid) + appliedToInv);
        const fullySettled = newPaid >= Number(inv.amount) - 0.001;
        await tx.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: newPaid, status: fullySettled ? 'PAID' : 'PARTIALLY_PAID', paidAt: fullySettled ? new Date() : null },
        });
        await enqueueCrsEvent(tx, {
          eventType: 'PAYMENT',
          correlationId: inv.correlationId,
          payload: { invoiceId: inv.id, agencyId, amount: appliedToInv, offline: true, settlement: true, advanceApplied: true, partial: !fullySettled },
        });
        appliedTotal = round2(appliedTotal + appliedToInv);
      }
      if (ai >= advancePayments.length && advRemaining <= 0.001) break;
    }
  });

  await recordAuditLogSafe({
    entityType: 'Agency',
    entityId: agencyId,
    event: 'ADVANCE_APPLIED',
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    after: { applied: appliedTotal },
  });
  await flushInline();
  await broadcast(['finance'], { agencyId });

  return { applied: appliedTotal, balance: await getSettlementBalance(agencyId) };
}

export interface SettlementHistoryEntry {
  id: string;
  amount: number;
  reference: string | null;
  invoiceNumber: string | null;
  unapplied: boolean; // true = still an unapplied advance credit
  createdAt: Date;
}

/** Offline settlement/advance receipts for an agency, newest first (admin history view). */
export async function listAgencySettlementHistory(agencyId: string): Promise<SettlementHistoryEntry[]> {
  const rows = await prisma.payment.findMany({
    where: { agencyId, gateway: 'offline', direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, amount: true, gatewayRef: true, invoiceId: true, createdAt: true, invoice: { select: { number: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    reference: r.gatewayRef,
    invoiceNumber: r.invoice?.number ?? null,
    unapplied: r.invoiceId === null,
    createdAt: r.createdAt,
  }));
}

export async function listInvoices(agencyId: string, page: number, pageSize: number) {
  const where: Prisma.InvoiceWhereInput = { agencyId };
  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { creditNotes: true },
    }),
    prisma.invoice.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Admin — CRS outbox status: event counts + recent events (CRS/CRS sync visibility). */
export async function getCrsStatus() {
  const [pending, sent, failed, events] = await Promise.all([
    prisma.crsOutboxEvent.count({ where: { status: 'PENDING' } }),
    prisma.crsOutboxEvent.count({ where: { status: 'SENT' } }),
    prisma.crsOutboxEvent.count({ where: { status: 'FAILED' } }),
    prisma.crsOutboxEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, eventType: true, status: true, correlationId: true, attempts: true, lastError: true, createdAt: true },
    }),
  ]);
  return { counts: { pending, sent, failed, total: pending + sent + failed }, events };
}

/** Admin — invoices across all agencies (with agency label + overdue flag). */
export async function listAllInvoices(page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { agency: { select: { legalName: true } } },
    }),
    prisma.invoice.count(),
  ]);
  const now = new Date();
  const items = rows.map((i) => ({
    id: i.id,
    number: i.number,
    agencyName: i.agency.legalName,
    amount: Number(i.amount),
    amountPaid: Number(i.amountPaid),
    paymentMode: i.paymentMode,
    status: i.status,
    overdue: i.status !== 'PAID' && i.status !== 'VOID' && !!i.dueDate && i.dueDate < now,
    dueDate: i.dueDate,
    issuedAt: i.issuedAt,
  }));
  return { items, total, page, pageSize };
}

/** Admin — outbound money movements: cancellation refunds + chargebacks, newest first. */
export async function listRefunds(page: number, pageSize: number) {
  const where: Prisma.PaymentWhereInput = { direction: 'OUTBOUND' };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { agency: { select: { legalName: true } }, invoice: { select: { number: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  const items = rows.map((p) => ({
    id: p.id,
    agencyName: p.agency.legalName,
    invoiceNumber: p.invoice?.number ?? null,
    amount: Number(p.amount),
    type: (p.status === 'CHARGEBACK' ? 'Chargeback' : 'Refund') as 'Refund' | 'Chargeback',
    gatewayRef: p.gatewayRef,
    createdAt: p.createdAt,
  }));
  return { items, total, page, pageSize };
}
