import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/modules/auth/password.service';
import { tokenFor } from '../setup/identity';
import { loadSettings } from '../../src/modules/settings/settings.service';
import { disconnectTestDb, resetDatabase, testPrisma } from '../setup/testDb';

const app = createApp();
const goa = { resortId: 'resort-goa', roomTypeId: 'goa-deluxe', checkIn: '2026-08-01', checkOut: '2026-08-03', guests: 2 };

// Read the response body as raw bytes so we can assert the %PDF magic header.
function pdfParser(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => { data += chunk; });
  res.on('end', () => cb(null, Buffer.from(data, 'binary')));
}
const getPdf = (url: string, token: string) =>
  request(app).get(url).set('Authorization', `Bearer ${token}`).buffer(true).parse(pdfParser as never);

let counter = 0;
async function setupAgencyWithBooking() {
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
      agencyId: agency.id, tier: 'A', paymentMode: 'CREDIT', creditLimit: 500000, paymentTerms: 'net 30',
      markupPct: 10, effectiveFrom: new Date(), updatedById: admin.id, isCurrent: true,
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

  // A committed credit booking → issued invoice.
  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${agentToken}`).send(goa);
  expect(booking.body.state).toBe('COMMITTED');
  const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { bookingId: booking.body.id } });

  return { agency, agentToken, agencyToken, adminToken, bookingId: booking.body.id as string, invoiceId: invoice.id };
}

async function otherAgencyToken() {
  counter += 1;
  const other = await testPrisma.agency.create({
    data: {
      legalName: `Other ${counter}`, gstin: `29AABCU9603R2Z${counter}`, pan: `ZZBCU9603${counter}`,
      status: 'ACTIVE', contactEmail: `other-${counter}@example.com`, contactPhone: '9000000000', activatedAt: new Date(),
    },
  });
  const user = await testPrisma.user.create({
    data: { email: `other-au-${counter}@example.com`, passwordHash: await hashPassword('Pass!23456'), role: 'AGENCY', agencyId: other.id },
  });
  return await tokenFor({ id: user.id, role: 'AGENCY', agencyId: other.id, mfaVerified: true });
}

const isPdf = (res: request.Response) => {
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect((res.body as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF');
};

beforeEach(async () => {
  await resetDatabase();
  await loadSettings();
});
afterAll(async () => {
  await disconnectTestDb();
});

describe('invoice PDF', () => {
  it('serves a valid PDF to the owning agency and to an admin, but 403s another agency', async () => {
    const { agencyToken, adminToken, invoiceId } = await setupAgencyWithBooking();

    isPdf(await getPdf(`/api/finance/invoices/${invoiceId}/pdf`, agencyToken));
    isPdf(await getPdf(`/api/finance/invoices/${invoiceId}/pdf`, adminToken));

    const other = await otherAgencyToken();
    const forbidden = await getPdf(`/api/finance/invoices/${invoiceId}/pdf`, other);
    expect(forbidden.status).toBe(403);
  });
});

describe('statements', () => {
  it('generates credit and account statement PDFs for the agency', async () => {
    const { agencyToken } = await setupAgencyWithBooking();
    isPdf(await getPdf('/api/finance/statements/credit', agencyToken));
    isPdf(await getPdf('/api/finance/statements/account', agencyToken));
  });
});

describe('booking voucher PDF', () => {
  it('serves the voucher to the booking agent and admin, but 403s another agency', async () => {
    const { agentToken, adminToken, bookingId } = await setupAgencyWithBooking();

    isPdf(await getPdf(`/api/bookings/${bookingId}/voucher`, agentToken));
    isPdf(await getPdf(`/api/bookings/${bookingId}/voucher`, adminToken));

    const other = await otherAgencyToken();
    const forbidden = await getPdf(`/api/bookings/${bookingId}/voucher`, other);
    expect(forbidden.status).toBe(403);
  });
});
