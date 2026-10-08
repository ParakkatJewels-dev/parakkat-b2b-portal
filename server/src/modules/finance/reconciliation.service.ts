import { prisma } from '../../lib/prisma';

/**
 * Reconciliation (Instructions.md §10) — flags drift between the portal, the
 * reservation system, and the CRS so Admin can investigate. Every confirmed
 * booking, payment and refund should be traceable across all three by
 * correlation id with zero unexplained drift.
 */
export interface DriftReport {
  committedWithoutAxisRef: number; // committed bookings missing a reservation ref
  committedWithoutInvoice: number; // committed bookings with no invoice
  pendingCrsEvents: number; // CRS postings not yet delivered
  failedCrsEvents: number; // CRS postings that exhausted retries
  // v3 §5.3 — payment settlement reconciliation.
  paymentsAwaitingSettlement: number; // captured but not yet confirmed by the gateway
  unmatchedPayments: number; // SUCCEEDED payments with no gateway ref (unreconcilable)
  openChargebacks: number; // disputed/reversed payments
  invoiceLedgerMismatches: number; // invoice.amountPaid != net inbound settled
  generatedAt: string;
  clean: boolean;
}

export async function runReconciliation(): Promise<DriftReport> {
  const [
    committedWithoutAxisRef,
    committedBookings,
    invoiceBookingIds,
    pendingCrsEvents,
    failedCrsEvents,
    paymentsAwaitingSettlement,
    unmatchedPayments,
    openChargebacks,
    settledInvoices,
  ] = await Promise.all([
    prisma.booking.count({ where: { state: 'COMMITTED', crsBookingRef: null } }),
    prisma.booking.findMany({ where: { state: 'COMMITTED' }, select: { id: true } }),
    prisma.invoice.findMany({ select: { bookingId: true } }),
    prisma.crsOutboxEvent.count({ where: { status: 'PENDING' } }),
    prisma.crsOutboxEvent.count({ where: { status: 'FAILED' } }),
    prisma.payment.count({ where: { direction: 'INBOUND', status: 'PENDING' } }),
    prisma.payment.count({ where: { direction: 'INBOUND', status: 'SUCCEEDED', gatewayRef: null } }),
    prisma.payment.count({ where: { status: 'CHARGEBACK' } }),
    prisma.invoice.findMany({
      where: { status: { in: ['PARTIALLY_PAID', 'PAID'] } },
      select: {
        id: true,
        amountPaid: true,
        payments: {
          where: { OR: [{ direction: 'INBOUND', status: 'SUCCEEDED' }, { status: 'CHARGEBACK' }] },
          select: { amount: true, status: true },
        },
      },
    }),
  ]);

  const invoiced = new Set(invoiceBookingIds.map((i) => i.bookingId));
  const committedWithoutInvoice = committedBookings.filter((b) => !invoiced.has(b.id)).length;

  // The recorded amountPaid should equal net settled inbound: Σ(SUCCEEDED inbound) − Σ(CHARGEBACK).
  // Flag any invoice where the payment ledger and the invoice ledger disagree.
  const invoiceLedgerMismatches = settledInvoices.filter((inv) => {
    const settled = inv.payments.reduce(
      (s, p) => s + (p.status === 'CHARGEBACK' ? -Number(p.amount) : Number(p.amount)),
      0,
    );
    return Math.abs(settled - Number(inv.amountPaid)) > 0.01;
  }).length;

  const clean =
    committedWithoutAxisRef === 0 &&
    committedWithoutInvoice === 0 &&
    pendingCrsEvents === 0 &&
    failedCrsEvents === 0 &&
    unmatchedPayments === 0 &&
    openChargebacks === 0 &&
    invoiceLedgerMismatches === 0;

  return {
    committedWithoutAxisRef,
    committedWithoutInvoice,
    pendingCrsEvents,
    failedCrsEvents,
    paymentsAwaitingSettlement,
    unmatchedPayments,
    openChargebacks,
    invoiceLedgerMismatches,
    generatedAt: new Date().toISOString(),
    clean,
  };
}
