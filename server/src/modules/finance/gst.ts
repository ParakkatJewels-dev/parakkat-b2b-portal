import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * v3 §6.1 — India GST tax-invoice engine for accommodation (SAC 9963 / 996311).
 * Slabs, resort GST identity, and e-invoicing applicability are all configurable
 * (env), never hardcoded — GST Council changes are absorbed without a rebuild.
 */

interface Slab {
  upTo: number | null; // inclusive upper bound of room value / night; null = open-ended
  rate: number; // percent
}

// GST 2.0 (effective 22 Sep 2025) default slabs by room value per night.
const DEFAULT_SLABS: Slab[] = [
  { upTo: 1000, rate: 0 }, // ≤ ₹1,000 — exempt
  { upTo: 7500, rate: 5 }, // ₹1,001–7,500 — 5% (no ITC)
  { upTo: null, rate: 18 }, // > ₹7,500 — 18%
];

interface ResortGst {
  stateCode: string;
  gstin: string;
}

// State codes for the MOCK resorts keep the intra/inter-state (CGST/SGST vs
// IGST) math working in dev. GSTINs are EMPTY on purpose — a fabricated tax
// number must never print on an invoice; real per-property GSTINs are supplied
// via RESORT_GST_JSON at deployment.
const DEFAULT_RESORT_GST: Record<string, ResortGst> = {
  'resort-goa': { stateCode: '30', gstin: '' },
  'resort-munnar': { stateCode: '32', gstin: '' },
  'resort-udaipur': { stateCode: '08', gstin: '' },
};

let slabsCache: Slab[] | null = null;
function slabs(): Slab[] {
  if (slabsCache) return slabsCache;
  slabsCache = DEFAULT_SLABS;
  if (env.GST_SLABS_JSON) {
    try {
      slabsCache = (JSON.parse(env.GST_SLABS_JSON) as Slab[]).sort(
        (a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity),
      );
    } catch {
      logger.error('GST_SLABS_JSON is not valid JSON; using default slabs');
    }
  }
  return slabsCache;
}

let resortGstCache: Record<string, ResortGst> | null = null;
function resortGstMap(): Record<string, ResortGst> {
  if (resortGstCache) return resortGstCache;
  resortGstCache = DEFAULT_RESORT_GST;
  if (env.RESORT_GST_JSON) {
    try {
      resortGstCache = { ...DEFAULT_RESORT_GST, ...(JSON.parse(env.RESORT_GST_JSON) as Record<string, ResortGst>) };
    } catch {
      logger.error('RESORT_GST_JSON is not valid JSON; using default resort GST map');
    }
  }
  return resortGstCache;
}

function slabFor(valuePerNight: number): number {
  for (const s of slabs()) {
    if (s.upTo === null || valuePerNight <= s.upTo) return s.rate;
  }
  return 18;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface GstBreakup {
  taxableValue: number;
  gstRate: number;
  sac: string;
  placeOfSupply: string | null;
  supplierGstin: string | null;
  recipientGstin: string | null;
  cgst: number;
  sgst: number;
  igst: number;
  invoiceTotal: number;
  intraState: boolean;
}

export interface GstInput {
  taxableValue: number; // agency price (the value actually charged)
  nights: number;
  resortId: string;
  recipientGstin?: string | null;
}

/** Computes the GST breakup: slab by per-night value, place-of-supply split (CGST+SGST vs IGST). */
export function computeGst(input: GstInput): GstBreakup {
  const perNight = input.nights > 0 ? round2(input.taxableValue / input.nights) : input.taxableValue;
  const rate = slabFor(perNight);
  const resort = resortGstMap()[input.resortId] ?? null;
  const recipientState = input.recipientGstin?.slice(0, 2) ?? null;
  const intraState = !!resort && !!recipientState && resort.stateCode === recipientState;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (rate > 0) {
    const tax = round2((input.taxableValue * rate) / 100);
    if (intraState) {
      cgst = round2(tax / 2);
      sgst = round2(tax - cgst);
    } else {
      igst = tax;
    }
  }

  return {
    taxableValue: round2(input.taxableValue),
    gstRate: rate,
    sac: '996311',
    placeOfSupply: resort?.stateCode ?? null,
    supplierGstin: resort?.gstin || null,
    recipientGstin: input.recipientGstin ?? null,
    cgst,
    sgst,
    igst,
    invoiceTotal: round2(input.taxableValue + cgst + sgst + igst),
    intraState,
  };
}

/**
 * v3 §6.1 — e-invoicing (IRP/IRN). Returns a (mock) IRN + signed-QR placeholder
 * when EINVOICE_ENABLED, else null. The real IRP provider replaces the mock body
 * when live, keyed by the same call site.
 */
export function generateIrn(seed: string): string | null {
  if (!env.EINVOICE_ENABLED) return null;
  return `IRN${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32).toUpperCase()}`;
}
