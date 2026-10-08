import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMode } from '@prisma/client';
import { createApp } from '../../src/app';
import { getInventoryClient } from '../../src/lib/inventory';
import { hashPassword } from '../../src/modules/auth/password.service';
import { issueAccessToken } from '../../src/modules/auth/token.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

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
      tier: 'B',
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
  const token = issueAccessToken({ id: agent.id, role: 'AGENT', agencyId: agency.id, mfaVerified: true });
  return { agency, agent, token };
}

const goaDeluxe = { resortId: 'resort-goa', roomTypeId: 'goa-deluxe', checkIn: '2026-08-01', checkOut: '2026-08-03', guests: 2 };

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnectTestDb();
});

describe('catalog search', () => {
  it('returns availability with the agency price (base rate never exposed)', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    const res = await request(app)
      .get('/api/catalog/availability')
      .query({ resortId: 'resort-goa', checkIn: '2026-08-01', checkOut: '2026-08-03', guests: 2 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const deluxe = res.body.roomTypes.find((r: { roomTypeId: string }) => r.roomTypeId === 'goa-deluxe');
    expect(deluxe.agencyPricePerNight).toBe(4950); // 4500 + 10%
    expect(deluxe.agencyPriceTotal).toBe(9900); // 2 nights
    expect(deluxe.baseRatePerNight).toBeUndefined(); // margin not exposed
  });
});

describe('credit gate branches', () => {
  it('within limit → confirmed on credit → committed to CRS', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('COMMITTED');
    expect(res.body.paymentMode).toBe('CREDIT');
    expect(res.body.crsBookingRef).toMatch(/^AXR-/);
    expect(res.body.agencyPrice).toBe('9900');
  });

  it('prepay → awaiting payment → pay → committed', async () => {
    const { token } = await setupAgency({ paymentMode: 'PREPAY', creditLimit: 0, markupPct: 10 });
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(created.status).toBe(201);
    expect(created.body.state).toBe('AWAITING_PAYMENT');
    expect(created.body.paymentMode).toBe('PREPAY');
    expect(created.body.holdExpiresAt).toBeTruthy();
    expect(created.body.crsBookingRef).toBeNull();

    const paid = await request(app)
      .post(`/api/bookings/${created.body.id}/pay`)
      .set('Authorization', `Bearer ${token}`);
    expect(paid.status).toBe(200);
    expect(paid.body.state).toBe('COMMITTED');
    expect(paid.body.crsBookingRef).toMatch(/^AXR-/);
  });

  it('credit agency over its limit takes the pay-first branch (D3)', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 5000, markupPct: 10 });
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('AWAITING_PAYMENT'); // 9900 > 5000
  });

  it('accumulates outstanding balance across credit bookings', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 12000, markupPct: 10 });
    // First 9900 on credit → committed.
    const first = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(first.body.state).toBe('COMMITTED');
    // Second would push 19800 > 12000 → pay-first.
    const second = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(second.body.state).toBe('AWAITING_PAYMENT');
  });
});

describe('CRS downtime — block, do not queue', () => {
  it('blocks booking creation with 503 when CRS is down', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    vi.spyOn(getInventoryClient(), 'healthCheck').mockResolvedValue(false);
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(res.status).toBe(503);
    const count = await testPrisma.booking.count();
    expect(count).toBe(0); // nothing queued
  });
});

describe('tentative hold expiry', () => {
  it('rejects payment after the hold TTL has lapsed', async () => {
    const { token } = await setupAgency({ paymentMode: 'PREPAY', creditLimit: 0, markupPct: 10 });
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    // Force the hold into the past.
    await testPrisma.booking.update({
      where: { id: created.body.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    const paid = await request(app).post(`/api/bookings/${created.body.id}/pay`).set('Authorization', `Bearer ${token}`);
    expect(paid.status).toBe(409);
    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(booking.state).toBe('EXPIRED');
  });
});

describe('cancellation', () => {
  it('cancels a committed booking and reverses CRS', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    const cancelSpy = vi.spyOn(getInventoryClient(), 'cancelReservation');
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    const res = await request(app).post(`/api/bookings/${created.body.id}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('CANCELLED');
    expect(cancelSpy).toHaveBeenCalledWith(created.body.crsBookingRef);
  });
});

describe('tenant isolation + gating', () => {
  it("an agent cannot read another agency's booking", async () => {
    const a = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    const b = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${a.token}`).send(goaDeluxe);
    const res = await request(app).get(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(404);
  });

  it('a suspended agency cannot transact', async () => {
    const { agency, token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 50000, markupPct: 10 });
    await testPrisma.agency.update({ where: { id: agency.id }, data: { status: 'SUSPENDED' } });
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(goaDeluxe);
    expect(res.status).toBe(403);
  });
});

describe('overbooking and group booking limits', () => {
  const munnarVilla = { resortId: 'resort-munnar', roomTypeId: 'munnar-villa', checkIn: '2026-08-01', checkOut: '2026-08-03', guests: 2 };

  it('rejects group bookings where the total rooms of a type exceeds availability (only 1 villa available)', async () => {
    const { token } = await setupAgency({ paymentMode: 'CREDIT', creditLimit: 100000, markupPct: 10 });

    // Attempting to book 2 rooms of type munnar-villa (which has availableCount: 1)
    const res = await request(app)
      .post('/api/bookings/group')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lines: [
          { ...munnarVilla, plan: 'EP' },
          { ...munnarVilla, plan: 'EP' }
        ],
        guest: { name: 'Lead Guest', phone: '9876543210', email: 'guest@example.com' }
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Selected room type does not have enough availability');
  });

  it('subtracts active non-committed portal holds from availability', async () => {
    const { token } = await setupAgency({ paymentMode: 'PREPAY', creditLimit: 0, markupPct: 10 });

    // 1. Create a pay-first booking for the 1 available munnar-villa
    // This booking is in AWAITING_PAYMENT state (active non-committed portal hold)
    const holdRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(munnarVilla);
    expect(holdRes.status).toBe(201);
    expect(holdRes.body.state).toBe('AWAITING_PAYMENT');

    // 2. A second booking attempt for the same room type and dates should be rejected
    const secondRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(munnarVilla);

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.message).toContain('Selected room type does not have enough availability');
  });
});
