import type { RatePlanCode } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { getInventoryClient } from '../../lib/inventory';
import type { OccupancyConfig, Resort, Restrictions, RoomTypeAvailability, RoomTypeRates } from '../../lib/inventory';
import { TtlCache } from '../../lib/inventory/cache';
import { ApiError } from '../../utils/apiError';
import { validateStayDates } from '../booking/dates';
import { pricePlansFromAxis, priceDayUseFromAxis, type ComposedCharge } from '../pricing/pricing.service';
import { applyChannelPolicy } from '../inventory/inventory.service';

// Short-TTL cache for availability reads (§10). Bypassed by the booking path's
// refresh-before-book fresh read.
const availabilityCache = new TtlCache<RoomTypeAvailability[]>(
  env.AVAILABILITY_CACHE_TTL_SECONDS * 1000,
);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function listResorts(): Promise<Resort[]> {
  return getInventoryClient().listResorts();
}

export interface BrowseRoom {
  resortId: string;
  resortName: string;
  location: string;
  roomTypeId: string;
  roomTypeName: string;
  maxOccupancy: number;
  /** Indicative "from" agency price per night (CRS base × agency markup, EP).
   *  The exact price is resolved once dates + occupancy + plan are chosen. */
  indicativePricePerNight: number;
}

/**
 * Dateless catalog browse (per the room-first flow): every resort's room types
 * from CRS with an indicative from-price, so agents can browse before
 * picking dates. Availability is NOT asserted here — it is verified per-date
 * against both CRS and the portal channel policy at the next step
 * (searchAvailability) and again at commit.
 */
export async function browseRooms(agencyId: string): Promise<BrowseRoom[]> {
  const config = await prisma.commercialConfiguration.findFirst({ where: { agencyId, isCurrent: true } });
  if (!config) throw ApiError.conflict('Agency has no commercial configuration');
  const markupPct = Number(config.markupPct);

  const axis = getInventoryClient();
  const resorts = await axis.listResorts();
  const perResort = await Promise.all(resorts.map((r) => axis.listRoomTypes(r.id)));

  const rooms: BrowseRoom[] = [];
  resorts.forEach((resort, i) => {
    for (const rt of perResort[i]) {
      rooms.push({
        resortId: resort.id,
        resortName: resort.name,
        location: resort.location,
        roomTypeId: rt.roomTypeId,
        roomTypeName: rt.roomTypeName,
        maxOccupancy: rt.maxOccupancy,
        indicativePricePerNight: round2(rt.baseRatePerNight * (1 + markupPct / 100)),
      });
    }
  });
  return rooms;
}

export interface CatalogAvailabilityQuery {
  resortId: string;
  checkIn: string;
  checkOut?: string; // optional for DAY_USE (same-day)
  stayType?: 'OVERNIGHT' | 'DAY_USE'; // default OVERNIGHT
  guests: number;
  adults?: number;
  children?: number;
  childAges?: number[];
  extraBeds?: number;
}

export interface PlanPrice {
  plan: RatePlanCode;
  pricePerNight: number;
  priceTotal: number;
  breakdown: ComposedCharge;
}

export interface PricedRoomType {
  roomTypeId: string;
  roomTypeName: string;
  maxOccupancy: number;
  availableCount: number;
  nights: number;
  // Rate-plan-aware pricing (v3 §2). Only the AGENCY price is exposed.
  plans: PlanPrice[];
  // Back-compat: the cheapest plan's price.
  agencyPricePerNight: number;
  agencyPriceTotal: number;
}

export async function searchAvailability(
  query: CatalogAvailabilityQuery,
  agencyId: string,
): Promise<PricedRoomType[]> {
  const config = await prisma.commercialConfiguration.findFirst({ where: { agencyId, isCurrent: true } });
  if (!config) throw ApiError.conflict('Agency has no commercial configuration');
  const markupPct = Number(config.markupPct);

  // v4 §1 — overnight or same-day day-use. Day-use collapses to a single date.
  const stayType = query.stayType ?? 'OVERNIGHT';
  const { checkIn: checkInDate, checkOut: checkOutDate, nights } = validateStayDates(query.checkIn, query.checkOut, stayType);
  const checkOutStr = stayType === 'DAY_USE' ? query.checkIn : query.checkOut!;

  const adults = query.adults ?? query.guests;
  const childAges = query.childAges;
  const children = childAges ? childAges.length : query.children ?? 0;
  const extraBeds = query.extraBeds ?? 0;
  const guests = adults + children;
  const occupancy = { adults, children, extraBeds, childAges };

  const key = `${query.resortId}:${query.checkIn}:${checkOutStr}:${stayType}:${guests}`;
  let rooms = availabilityCache.get(key);
  if (!rooms) {
    rooms = await getInventoryClient().searchAvailability({ resortId: query.resortId, checkIn: query.checkIn, checkOut: checkOutStr, stayType, guests });
    availabilityCache.set(key, rooms);
  }

  // v3 §3 — apply the B2B channel policy (stop-sell / caps / allotments) to the
  // live CRS availability before display. Per-agency, so applied post-cache.
  rooms = await applyChannelPolicy(query.resortId, rooms, checkInDate, checkOutDate, agencyId);

  const results: PricedRoomType[] = [];
  for (const rt of rooms) {
    // v4 §1 — rate plans, occupancy and restrictions come from CRS. The
    // enriched availability read carries them; fall back to a dated rates read.
    const rates: RoomTypeRates | null =
      rt.ratePlans && rt.occupancy
        ? {
            roomTypeId: rt.roomTypeId,
            roomTypeName: rt.roomTypeName,
            occupancy: rt.occupancy,
            ratePlans: rt.ratePlans,
            restrictions: rt.restrictions ?? { minNights: 1, closedToArrival: false, closedToDeparture: false, stopSell: false },
            dayUse: rt.dayUse,
          }
        : await getInventoryClient().getRoomTypeRates({
            resortId: query.resortId,
            roomTypeId: rt.roomTypeId,
            checkIn: query.checkIn,
            checkOut: checkOutStr,
            stayType,
          });
    if (!rates || rates.restrictions.stopSell) continue; // unavailable / stop-sold
    // v4 §1 — CTA/CTD: can't start a stay on a closed-to-arrival date, or end one on
    // a closed-to-departure date (CTD is overnight-only). Hide such rooms from results.
    if (rates.restrictions.closedToArrival) continue;
    if (stayType === 'OVERNIGHT' && rates.restrictions.closedToDeparture) continue;

    let charges: ComposedCharge[];
    if (stayType === 'DAY_USE') {
      if (!rates.dayUse?.available) continue; // day-use not offered for this room
      try {
        charges = [priceDayUseFromAxis(rates, occupancy, markupPct)];
      } catch {
        continue; // occupancy invalid for day-use
      }
    } else {
      charges = pricePlansFromAxis(rates, occupancy, markupPct);
    }
    if (charges.length === 0) continue; // occupancy invalid / no rate for this room

    const plans: PlanPrice[] = charges.map((c) => ({
      plan: c.plan,
      // Day-use has no nights — the per-"night" figure is the single use charge.
      pricePerNight: nights > 0 ? round2(c.agencyPrice / nights) : c.agencyPrice,
      priceTotal: c.agencyPrice,
      breakdown: c,
    }));
    results.push({
      roomTypeId: rt.roomTypeId,
      roomTypeName: rt.roomTypeName,
      maxOccupancy: rt.maxOccupancy,
      availableCount: rt.availableCount,
      nights,
      plans,
      agencyPricePerNight: plans[0].pricePerNight,
      agencyPriceTotal: plans[0].priceTotal,
    });
  }
  return results;
}

// --- Admin read-through of CRS rates/restrictions (v4 §1) ---------------
// CRS is the source of truth for rate plans, occupancy and restrictions.
// This gives Admin a read-only window into what CRS serves for a resort +
// date range (NET rates, before the per-agency markup the portal applies).

export interface AxisRatesRoom {
  resortId: string;
  resortName: string;
  roomTypeId: string;
  roomTypeName: string;
  availableCount: number;
  occupancy: OccupancyConfig;
  restrictions: Restrictions;
  dayUseRate: number | null;
  plans: { plan: RatePlanCode; nights: number; avgNightlyRate: number; totalRate: number }[];
}

export interface AxisRatesOverview {
  resorts: Resort[];
  resortId: string;
  rooms: AxisRatesRoom[];
}

export interface AdminCatalogResort {
  id: string;
  name: string;
  location: string;
  roomCount: number;
  rooms: { roomTypeId: string; roomTypeName: string; maxOccupancy: number; baseRatePerNight: number; dayUseRate: number | null }[];
}

/** Admin read-only catalog: every CRS resort with its room types (source of truth). */
export async function getAdminCatalog(): Promise<{ resorts: AdminCatalogResort[] }> {
  const axis = getInventoryClient();
  const resorts = await axis.listResorts();
  const out: AdminCatalogResort[] = [];
  for (const r of resorts) {
    const rooms = await axis.listRoomTypes(r.id);
    out.push({
      id: r.id,
      name: r.name,
      location: r.location,
      roomCount: rooms.length,
      rooms: rooms.map((rt) => ({
        roomTypeId: rt.roomTypeId,
        roomTypeName: rt.roomTypeName,
        maxOccupancy: rt.maxOccupancy,
        baseRatePerNight: rt.baseRatePerNight,
        dayUseRate: rt.dayUse?.available ? rt.dayUse.ratePerUse : null,
      })),
    });
  }
  return { resorts: out };
}

export async function getAxisRatesOverview(resortId: string | undefined, checkIn: string, checkOut: string): Promise<AxisRatesOverview> {
  const axis = getInventoryClient();
  const resorts = await axis.listResorts();
  const effectiveResortId = resortId ?? resorts[0]?.id;
  if (!effectiveResortId) return { resorts, resortId: '', rooms: [] };
  const resort = resorts.find((r) => r.id === effectiveResortId);
  if (!resort) throw ApiError.notFound('Resort not found');

  const catalog = await axis.listRoomTypes(effectiveResortId);
  const rooms: AxisRatesRoom[] = [];
  for (const rt of catalog) {
    const rates = await axis.getRoomTypeRates({ resortId: effectiveResortId, roomTypeId: rt.roomTypeId, checkIn, checkOut });
    if (!rates) continue;
    const plans = rates.ratePlans.map((rp) => {
      const nights = rp.dailyRates.length;
      const totalRate = round2(rp.dailyRates.reduce((s, d) => s + d.rate, 0));
      return { plan: rp.plan, nights, avgNightlyRate: nights ? round2(totalRate / nights) : totalRate, totalRate };
    });
    rooms.push({
      resortId: effectiveResortId,
      resortName: resort.name,
      roomTypeId: rt.roomTypeId,
      roomTypeName: rt.roomTypeName,
      availableCount: rt.availableCount,
      occupancy: rates.occupancy,
      restrictions: rates.restrictions,
      dayUseRate: rates.dayUse?.available ? rates.dayUse.ratePerUse : null,
      plans,
    });
  }
  return { resorts, resortId: effectiveResortId, rooms };
}
