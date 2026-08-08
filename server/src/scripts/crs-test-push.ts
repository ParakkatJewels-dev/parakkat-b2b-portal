/**
 * One-off: send a single sample event to the company CRS HotSoft ingest
 * endpoint so the CRS team can confirm receipt and map our data shape.
 *
 *   npm run crs:test-push
 *
 * Reads CRS_INGEST_URL and CRS_TOKEN from the environment (.env) — the token is
 * never passed on the command line or printed. This posts ONE representative
 * PAYMENT event; it does not touch the database or the real outbox.
 */
import crypto from 'node:crypto';
import { env } from '../config/env';
import { buildCrsEnvelope, extractCrsRef } from '../lib/crs';

async function main(): Promise<void> {
  const url = env.CRS_INGEST_URL;
  const token = env.CRS_TOKEN;
  if (!url || !token) {
    console.error(
      'Missing CRS_INGEST_URL and/or CRS_TOKEN.\n' +
        'Set both in server/.env (do not paste the token on the command line), then re-run.',
    );
    process.exit(1);
  }

  // A representative pay-first booking PAYMENT event — same envelope the live
  // client posts, populated with realistic (clearly-marked test) values.
  const correlationId = `TEST-${crypto.randomUUID()}`;
  const envelope = buildCrsEnvelope({
    eventType: 'PAYMENT',
    correlationId,
    payload: {
      test: true,
      bookingId: `bkg_${crypto.randomBytes(4).toString('hex')}`,
      agencyId: `agy_${crypto.randomBytes(4).toString('hex')}`,
      agencyName: 'Sample Travels Pvt Ltd',
      invoiceNumber: 'INV-202607-SAMPLE',
      amount: 12500.0,
      currency: 'INR',
      paymentMode: 'PREPAY',
      gatewayRef: 'PAY-SAMPLE01',
      resortId: 'parakkat-munnar',
      checkIn: '2026-08-01',
      checkOut: '2026-08-03',
      nights: 2,
    },
  });
  const body = JSON.stringify(envelope);

  console.log('POST', url);
  console.log('Authorization: Bearer ****(redacted)');
  console.log('Content-Type: application/json');
  console.log(`Body (${Buffer.byteLength(body, 'utf8')} bytes):`);
  console.log(JSON.stringify(envelope, null, 2));
  console.log('---');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(env.CRS_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('Request failed (network/timeout):', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const text = await res.text();
  console.log(`Response: ${res.status} ${res.statusText}`);
  console.log('Body:', text || '(empty)');

  if (!res.ok) {
    console.error('CRS ingest did NOT accept the push.');
    process.exit(1);
  }
  const crsRef = extractCrsRef(text);
  console.log('\n✓ CRS accepted the test push.', crsRef ? `Reference: ${crsRef}` : '(no reference returned)');
  console.log(`correlationId sent: ${correlationId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
