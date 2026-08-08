import crypto from 'node:crypto';
import type { CrsEventType } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../logger';

/**
 * The CRS is the company's financial ledger of record (Instructions.md §3, §10).
 * The portal never keeps a second ledger — it posts financial events to the CRS.
 * Writes are idempotent on (correlationId, eventType) so retried outbox
 * deliveries never double-post. Mock only; the live client is a drop-in.
 */
export interface CrsEventInput {
  eventType: CrsEventType;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface CrsClient {
  postEvent(input: CrsEventInput): Promise<{ crsRef: string }>;
}

/** Max request size the HotSoft ingest endpoint accepts (2MB per the CRS team). */
const CRS_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The self-describing JSON envelope we push to the CRS ingest endpoint. The CRS
 * team asked for "a sample of the actual data"; this wraps our financial event
 * with enough context (source, type, correlation, timestamp) for them to map it.
 * Shared by LiveCrsClient and the crs:test-push script so the shapes never drift.
 */
export function buildCrsEnvelope(input: CrsEventInput) {
  return {
    source: 'parakkat-b2b-portal',
    eventType: input.eventType,
    correlationId: input.correlationId,
    occurredAt: new Date().toISOString(),
    data: input.payload,
  };
}

/** Best-effort CRS reference from the ingest ack (JSON with any of these keys, else undefined). */
export function extractCrsRef(responseBody: string): string | undefined {
  try {
    const json = JSON.parse(responseBody) as Record<string, unknown>;
    for (const key of ['crsRef', 'ref', 'reference', 'receiptId', 'ackId', 'id']) {
      const v = json[key];
      if (typeof v === 'string' && v) return v;
      if (typeof v === 'number') return String(v);
    }
  } catch {
    // Non-JSON ack (e.g. a plain "OK") — caller falls back to a synthesized ref.
  }
  return undefined;
}

class MockCrsClient implements CrsClient {
  private posted = new Map<string, string>(); // `${correlationId}:${eventType}` -> crsRef

  async postEvent(input: CrsEventInput): Promise<{ crsRef: string }> {
    const key = `${input.correlationId}:${input.eventType}`;
    const existing = this.posted.get(key);
    if (existing) return { crsRef: existing };
    const crsRef = `CRS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    this.posted.set(key, crsRef);
    logger.info('[MockCRS] event posted', { eventType: input.eventType, correlationId: input.correlationId, crsRef });
    return { crsRef };
  }
}

class LiveCrsClient implements CrsClient {
  async postEvent(input: CrsEventInput): Promise<{ crsRef: string }> {
    if (!env.CRS_INGEST_URL || !env.CRS_TOKEN) {
      throw new Error('LiveCrsClient requires CRS_INGEST_URL and CRS_TOKEN');
    }
    const body = JSON.stringify(buildCrsEnvelope(input));
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > CRS_MAX_BYTES) {
      throw new Error(`CRS payload is ${bytes} bytes, over the 2MB ingest limit`);
    }

    let res: Response;
    try {
      res = await fetch(env.CRS_INGEST_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.CRS_TOKEN}`,
        },
        body,
        signal: AbortSignal.timeout(env.CRS_TIMEOUT_MS),
      });
    } catch (err) {
      // Network/timeout — throw so the outbox increments attempts and retries.
      throw new Error(`CRS ingest request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`CRS ingest returned ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    const crsRef = extractCrsRef(text) ?? `CRS-ACK-${input.correlationId.slice(0, 8).toUpperCase()}`;
    logger.info('[CRS] event ingested', {
      eventType: input.eventType,
      correlationId: input.correlationId,
      status: res.status,
      crsRef,
    });
    return { crsRef };
  }
}

let instance: CrsClient | undefined;
export function getCrs(): CrsClient {
  if (!instance) {
    instance = env.CRS_PROVIDER === 'live' ? new LiveCrsClient() : new MockCrsClient();
  }
  return instance;
}
