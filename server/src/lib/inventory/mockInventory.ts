import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../logger';
import type {
  AvailabilityQuery,
  InventoryClient,
  CreateReservationInput,
  CreateReservationResult,
  DailyRate,
  OccupancyConfig,
  RatePlan,
  RatePlanCode,
  RatesQuery,
  Resort,
  Restrictions,
  RoomTypeAvailability,
  RoomTypeRates,
} from './inventory.types';

interface MockRoomType {
  resortId: string;
  roomTypeId: string;
  roomTypeName: string;
  availableCount: number;
  epBaseRate: number; // EP (room-only) net rate per night
  occupancy: OccupancyConfig;
}

// EP is the base; other plans uplift for meals (CP=+breakfast, MAP=+1 meal, AP=all meals).
const PLAN_UPLIFT: Record<RatePlanCode, number> = { EP: 1, CP: 1.1, MAP: 1.25, AP: 1.4 };

const RESORTS: Resort[] = [
  { id: 'resort-goa', name: 'Parakkat Goa Beach Resort', location: 'Goa' },
  { id: 'resort-munnar', name: 'Parakkat Munnar Hills', location: 'Munnar, Kerala' },
  { id: 'resort-udaipur', name: 'Parakkat Udaipur Lake Palace', location: 'Udaipur, Rajasthan' },
];

const occ = (base: number, over: Partial<OccupancyConfig> = {}): OccupancyConfig => ({
  baseOccupancy: 2,
  maxAdults: 3,
  maxChildren: 2,
  maxOccupancy: 4,
  extraAdultCharge: Math.round(base * 0.3),
  childCharge: Math.round(base * 0.15),
  extraBedCharge: Math.round(base * 0.2),
  ...over,
});

const ROOM_TYPES: MockRoomType[] = [
  { resortId: 'resort-goa', roomTypeId: 'goa-deluxe', roomTypeName: 'Deluxe Sea View', availableCount: 5, epBaseRate: 4500, occupancy: occ(4500, { maxOccupancy: 2, maxAdults: 3 }) },
  { resortId: 'resort-goa', roomTypeId: 'goa-suite', roomTypeName: 'Beach Suite', availableCount: 2, epBaseRate: 8200, occupancy: occ(8200, { maxOccupancy: 4, maxAdults: 4 }) },
  { resortId: 'resort-munnar', roomTypeId: 'munnar-cottage', roomTypeName: 'Tea Garden Cottage', availableCount: 4, epBaseRate: 5200, occupancy: occ(5200, { maxOccupancy: 3, maxAdults: 3 }) },
  { resortId: 'resort-munnar', roomTypeId: 'munnar-villa', roomTypeName: 'Hilltop Villa', availableCount: 1, epBaseRate: 11000, occupancy: occ(11000, { maxOccupancy: 6, maxAdults: 5 }) },
  { resortId: 'resort-udaipur', roomTypeId: 'udaipur-lakeview', roomTypeName: 'Lake View Room', availableCount: 6, epBaseRate: 6800, occupancy: occ(6800, { maxOccupancy: 2, maxAdults: 3 }) },
];

/** Inclusive list of stay nights between checkIn and checkOut (YYYY-MM-DD). */
function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out.length ? out : [checkIn];
}

// Deterministic per-date "seasonality" so rates vary by date like a real ARI feed
// (weekends priced higher). Purely illustrative until the live adapter lands.
function seasonalFactor(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6 ? 1.15 : 1; // Fri/Sat uplift
}

function ratePlansFor(rt: MockRoomType, nights: string[]): RatePlan[] {
  return (Object.keys(PLAN_UPLIFT) as RatePlanCode[]).map((plan) => {
    const dailyRates: DailyRate[] = nights.map((date) => ({
      date,
      rate: Math.round(rt.epBaseRate * PLAN_UPLIFT[plan] * seasonalFactor(date)),
    }));
    return { plan, dailyRates };
  });
}

const dayOfMonth = (d: string) => Number(d.slice(8, 10));

function restrictionsFor(rt: MockRoomType, checkIn: string, checkOut: string): Restrictions {
  // Illustrative until the live ARI feed lands: the scarcest room enforces a
  // 2-night minimum; no arrivals on the 15th (CTA); no departures on the 20th (CTD).
  return {
    minNights: rt.availableCount <= 1 ? 2 : 1,
    closedToArrival: dayOfMonth(checkIn) === 15,
    closedToDeparture: dayOfMonth(checkOut) === 20,
    stopSell: false,
  };
}

function dayUseFor(rt: MockRoomType) {
  return { available: true, ratePerUse: Math.round(rt.epBaseRate * 0.5), earliestStart: '09:00', latestEnd: '18:00' };
}

function toAvailability(rt: MockRoomType, range?: { checkIn: string; checkOut: string }): RoomTypeAvailability {
  const today = new Date().toISOString().slice(0, 10);
  const checkIn = range?.checkIn ?? today;
  const checkOut = range?.checkOut ?? today;
  const nights = range ? nightsBetween(range.checkIn, range.checkOut) : [today];
  return {
    roomTypeId: rt.roomTypeId,
    roomTypeName: rt.roomTypeName,
    availableCount: rt.availableCount,
    maxOccupancy: rt.occupancy.maxOccupancy,
    baseRatePerNight: rt.epBaseRate,
    occupancy: rt.occupancy,
    ratePlans: ratePlansFor(rt, nights),
    restrictions: restrictionsFor(rt, checkIn, checkOut),
    dayUse: dayUseFor(rt),
  };
}

/**
 * In-memory CRS stand-in for dev/test. Availability, rate plans (EP/CP/MAP/AP
 * with per-date net rates), occupancy config, restrictions and day-use are served
 * so the portal's markup + booking pipeline can run end-to-end without the live API.
 * Reservations are tracked by correlationId so writes are idempotent. Downtime can be
 * simulated with INVENTORY_FORCE_DOWN=true to exercise the block-don't-queue path.
 */
export class MockInventoryClient implements InventoryClient {
  private reservations = new Map<string, string>(); // correlationId -> crsBookingRef

  async healthCheck(): Promise<boolean> {
    return !env.INVENTORY_FORCE_DOWN;
  }

  async listResorts(): Promise<Resort[]> {
    return RESORTS;
  }

  async listRoomTypes(resortId: string): Promise<RoomTypeAvailability[]> {
    return ROOM_TYPES.filter((r) => r.resortId === resortId).map((r) => toAvailability(r));
  }

  async searchAvailability(query: AvailabilityQuery): Promise<RoomTypeAvailability[]> {
    const guests = query.adults != null ? query.adults + (query.children ?? 0) : query.guests;
    return ROOM_TYPES.filter(
      (r) => r.resortId === query.resortId && r.occupancy.maxOccupancy >= guests && r.availableCount > 0,
    ).map((r) => toAvailability(r, { checkIn: query.checkIn, checkOut: query.checkOut }));
  }

  async getRoomType(resortId: string, roomTypeId: string): Promise<RoomTypeAvailability | null> {
    const rt = ROOM_TYPES.find((r) => r.resortId === resortId && r.roomTypeId === roomTypeId);
    return rt ? toAvailability(rt) : null;
  }

  async getRoomTypeRates(query: RatesQuery): Promise<RoomTypeRates | null> {
    const rt = ROOM_TYPES.find((r) => r.resortId === query.resortId && r.roomTypeId === query.roomTypeId);
    if (!rt) return null;
    const stayType = query.stayType ?? 'OVERNIGHT';
    const nights = stayType === 'DAY_USE' ? [query.checkIn] : nightsBetween(query.checkIn, query.checkOut);
    return {
      roomTypeId: rt.roomTypeId,
      roomTypeName: rt.roomTypeName,
      occupancy: rt.occupancy,
      ratePlans: ratePlansFor(rt, nights),
      restrictions: restrictionsFor(rt, query.checkIn, stayType === 'DAY_USE' ? query.checkIn : query.checkOut),
      dayUse: dayUseFor(rt),
    };
  }

  async createReservation(input: CreateReservationInput): Promise<CreateReservationResult> {
    const existing = this.reservations.get(input.correlationId);
    if (existing) {
      return { crsBookingRef: existing }; // idempotent
    }
    const crsBookingRef = `RSV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    this.reservations.set(input.correlationId, crsBookingRef);
    logger.info('[MockCRS] reservation created', {
      correlationId: input.correlationId,
      crsBookingRef,
      stayType: input.stayType ?? 'OVERNIGHT',
      rooms: input.rooms?.length ?? 1,
    });
    return { crsBookingRef };
  }

  async cancelReservation(crsBookingRef: string): Promise<void> {
    for (const [key, ref] of this.reservations.entries()) {
      if (ref === crsBookingRef) this.reservations.delete(key);
    }
    logger.info('[MockCRS] reservation cancelled', { crsBookingRef });
  }
}
