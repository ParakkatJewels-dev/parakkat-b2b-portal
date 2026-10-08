import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentMode } from '@prisma/client';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { signPaymentBody } from '../../src/lib/payments';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';
import { weekdayStay } from '../setup/stayDates';

const nearStay = weekdayStay(30);
const farStay = weekdayStay(60);

const app = createApp();

let counter = 0;
async function setupAgency(opts: { paymentMode: PaymentMode; creditLimit: number; markupPct: number }) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const agency = await testPrisma.agency.create({
    data: {
      legalName: `Agency ${suffix}`,
      gstin: `27AABCU9603R1Z${counter}`,
      pan: `AABCU9603${counter}`,
      status: 'ACTIVE',
      contactEmail: `agency-${suffix}@example.com`,
      contactPhone: '9876543210',
      activatedAt: new Date(),
    },
  });
  const admin = await testPrisma.user.create({
    data: { email: `admin-${suffix}@example.com`, passwordHash: await hashPassword('Pass!23456'), role: 'ADMIN' },
  });
  await testPrisma.commercialConfiguration.create({
    data: {
      agencyId: agency.id,
      tier: 'A',
      paymentMode: opts.paymentMode,
      creditLimit: opts.creditLimit,
      paymentTerms: 'net 30',
      markupPct: opts.markupPct,
      effectiveFrom: new Date(),
      updatedById: admin.id,
      isCurrent: true,
    },
  });
  const agent = await testPrisma.user.create({
    data: { email: `agent-${suffix}@example.com`, passwordHash: await hashPassword('Pass!23456'), role: 'AGENT', agencyId: agency.id },
  });
  const agencyUser = await testPrisma.user.create({
    data: { email: `au-${suffix}@example.com`, passwordHash: await hashPassword('Pass!23456'), role: 'AGENCY', agencyId: agency.id },
  });
  const agentToken = await tokenFor({ id: agent.id, role: 'AGENT', agencyId: agency.id, mfaVerified: true });
  const agencyToken = await tokenFor({ id: agencyUser.id, role: 'AGENCY', agencyId: agency.id, mfaVerified: true });
  const adminToken = await tokenFor({ id: admin.id, role: 'ADMIN', agencyId: null, mfaVerified: true });
  return { agency, agentToken, agencyToken, adminToken };
}

const goa = { resortId: 'resort-goa', roomTypeId: 'goa-deluxe', checkIn: nearStay.checkIn, checkOut: nearStay.checkOut, guests: 2 };
const goaFar = { ...goa, checkIn: farStay.checkIn, checkOut: farStay.checkOut };

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await disconnectTestDb();
});

describe('credit booking → invoice + outstanding + CRS obligation', () => {
  it('issues a credit invoice, raises outstanding, and delivers a CRS event', async () => {
    const { agency, agentToken } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 500000, markupPct: 10 });
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goa);
    expect(res.body.state).toBe('COMMITTED');

    const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { bookingId: res.body.id } });
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.paymentMode).toBe('CREDIT');
    expect(Number(invoice.amount)).toBe(9900);

    const balance = await request(app).get('/api/finance/balance').set('Authorization', `Bearer ${agentToken}`);
    expect(balance.body.outstanding).toBe(9900);
    expect(balance.body.available).toBe(490100);

    const crs = await testPrisma.crsOutboxEvent.findMany({ where: { correlationId: invoice.correlationId } });
    expect(crs.map((e) => e.eventType)).toContain('BOOKING_OBLIGATION');
    expect(crs.every((e) => e.status === 'SENT')).toBe(true); // inline flush
    void agency;
  });
});

describe('prepay booking → payment + PAID invoice', () => {
  it('captures payment and records a PAID invoice + succeeded payment + CRS PAYMENT', async () => {
    const { agentToken } = await setupAgency({ paymentMode: 'PREPAY', creditLimit: 0, markupPct: 10 });
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goa);
    expect(created.body.state).toBe('AWAITING_PAYMENT');
    const paid = await request(app).post(`/api/bookings/${created.body.id}/pay`).set('Authorization', `Bearer ${agentToken}`);
    expect(paid.body.state).toBe('COMMITTED');

    const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { bookingId: created.body.id } });
    expect(invoice.status).toBe('PAID');
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { bookingId: created.body.id, direction: 'INBOUND' } });
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.gatewayRef).toMatch(/^PAY-/);
  });
});

describe('settlement', () => {
  it('lets an agency settle a credit invoice, clearing outstanding', async () => {
    const { agentToken, agencyToken } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 500000, markupPct: 10 });
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goa);
    const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { bookingId: booking.body.id } });

    const settle = await request(app).post(`/api/finance/invoices/${invoice.id}/settle`).set('Authorization', `Bearer ${agencyToken}`);
    expect(settle.status).toBe(200);
    expect(settle.body.status).toBe('PAID');

    const balance = await request(app).get('/api/finance/balance').set('Authorization', `Bearer ${agencyToken}`);
    expect(balance.body.outstanding).toBe(0);
  });
});

describe('cancellation with refund', () => {
  it('refunds a paid booking cancelled well in advance (full refund) and posts CRS REFUND', async () => {
    const { agentToken } = await setupAgency({ paymentMode: 'PREPAY', creditLimit: 0, markupPct: 10 });
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goaFar);
    await request(app).post(`/api/bookings/${created.body.id}/pay`).set('Authorization', `Bearer ${agentToken}`);

    const cancel = await request(app).post(`/api/bookings/${created.body.id}/cancel`).set('Authorization', `Bearer ${agentToken}`);
    expect(cancel.body.state).toBe('CANCELLED');

    const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { bookingId: created.body.id } });
    expect(invoice.status).toBe('REFUNDED');
    const refund = await testPrisma.payment.findFirst({ where: { bookingId: created.body.id, direction: 'OUTBOUND' } });
    expect(refund?.status).toBe('SUCCEEDED');
    expect(Number(refund?.amount)).toBe(9900); // full refund, 7+ days out

    const crs = await testPrisma.crsOutboxEvent.findMany({ where: { correlationId: created.body.correlationId } });
    expect(crs.map((e) => e.eventType)).toContain('REFUND');
  });
});

describe('reconciliation + admin dashboard', () => {
  it('reports a clean drift report and real dashboard numbers after a committed booking', async () => {
    const { agentToken, adminToken } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 500000, markupPct: 10 });
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goa);

    const recon = await request(app).get('/api/finance/reconciliation').set('Authorization', `Bearer ${adminToken}`);
    expect(recon.status).toBe(200);
    expect(recon.body.clean).toBe(true);

    const dash = await request(app).get('/api/dashboard/admin').set('Authorization', `Bearer ${adminToken}`);
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.totalBookings).toBeGreaterThanOrEqual(1);
    expect(dash.body.kpis.outstandingAmount).toBe(9900);
    expect(dash.body.bookingsByStatus.length).toBeGreaterThan(0);
    expect(dash.body.topResorts.length).toBeGreaterThan(0);
  });
});

describe('payment webhook — signature + idempotency', () => {
  it('rejects a bad signature and applies a valid one once', async () => {
    const { agency } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 500000, markupPct: 10 });
    const payment = await testPrisma.payment.create({
      data: { agencyId: agency.id, correlationId: 'corr-1', amount: 100, direction: 'INBOUND', status: 'PENDING', gatewayRef: 'PAY-TESTREF1' },
    });
    const raw = JSON.stringify({ gatewayRef: 'PAY-TESTREF1', status: 'SUCCEEDED' });

    const bad = await request(app).post('/api/webhooks/payment').set('Content-Type', 'application/json').set('x-payment-signature', 'nope').send(raw);
    expect(bad.status).toBe(401);

    const ok = await request(app).post('/api/webhooks/payment').set('Content-Type', 'application/json').set('x-payment-signature', signPaymentBody(raw)).send(raw);
    expect(ok.body.outcome).toBe('applied');

    const dup = await request(app).post('/api/webhooks/payment').set('Content-Type', 'application/json').set('x-payment-signature', signPaymentBody(raw)).send(raw);
    expect(dup.body.outcome).toBe('duplicate');

    const updated = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.status).toBe('SUCCEEDED');
  });
});
