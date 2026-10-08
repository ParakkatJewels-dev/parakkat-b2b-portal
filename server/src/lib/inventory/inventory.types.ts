/**
 * CRS is the source of truth for resorts, room types, availability,
 * inventory, RATE PLANS and RESTRICTIONS (read-only for the portal), and receives
 * reservation writes on commit / reversals on cancel (Instructions.md §10, data
 * ownership §3). The portal keeps NO local master tables for this data — the
 * portal's only pricing responsibility is applying the agency's markup to the
 * CRS net rate.
 *
 * Phase 1 (v4) widens this contract to match Parakkat's real CRS model:
 * rate plans (EP/CP/MAP/AP) with per-date net rates, occupancy-based pricing,
 * booking restrictions, day-use stays, and multi-room reservations. New fields
 * are optional so the live adapter can be filled in incrementally; the mock
 * supplies them all.
 */

/** Meal/rate plan codes (mirror Prisma's RatePlanCode; kept local to decouple the integration lib). */
export type RatePlanCode = 'EP' | 'CP' | 'MAP' | 'AP';

/** Overnight stay vs same-day day-use. CRS exposes day-use as a distinct product. */
export type StayType = 'OVERNIGHT' | 'DAY_USE';

export interface Resort {
  id: string;
  name: string;
  location: string;
}

/** Occupancy pricing config for a room type, sourced from CRS. */
export interface OccupancyConfig {
  baseOccupancy: number; // guests the base rate covers
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdultCharge: number; // per extra adult / night
  childCharge: number; // per child / night (fallback when no age bands)
  extraBedCharge: number; // per extra bed / night
  /** Optional child age bands: charge per child / night by age. */
  childBands?: { minAge: number; maxAge: number; charge: number }[];
}

/** Net (pre-markup) rate for a single date. */
export interface DailyRate {
  date: string; // YYYY-MM-DD
  rate: number; // CRS net rate for that night
}

/** A rate plan offered for a room type, with per-date net rates over the queried range. */
export interface RatePlan {
  plan: RatePlanCode;
  dailyRates: DailyRate[];
}

/** Booking restrictions pushed by CRS for a room type / date range. */
export interface Restrictions {
  minNights: number; // minimum length of stay (1 = no restriction)
  maxNights?: number;
  closedToArrival: boolean; // CTA — cannot check in on these dates
  closedToDeparture: boolean; // CTD — cannot check out on these dates
  stopSell: boolean; // no sell regardless of remaining inventory
}

/** Day-use (same-day) option for a room type. */
export interface DayUseOption {
  available: boolean;
  ratePerUse: number; // CRS net day-use rate
  earliestStart?: string; // HH:mm
  latestEnd?: string; // HH:mm
}

export interface RoomTypeAvailability {
  roomTypeId: string;
  roomTypeName: string;
  /** Rooms available for the requested dates/occupancy. */
  availableCount: number;
  maxOccupancy: number;
  /** Cheapest nightly net rate (kept for back-compat; = EP nightly where present). */
  baseRatePerNight: number;
  // --- v4 CRS-sourced enrichment (optional; populated by search/getRoomTypeRates) ---
  occupancy?: OccupancyConfig;
  ratePlans?: RatePlan[];
  restrictions?: Restrictions;
  dayUse?: DayUseOption;
}

export interface AvailabilityQuery {
  resortId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD (= checkIn for DAY_USE)
  guests: number; // total (= adults + children); kept for back-compat
  adults?: number;
  children?: number;
  childAges?: number[];
  stayType?: StayType; // default OVERNIGHT
}

/** Dated read of rate plans + restrictions for one room type (the ARI pull). */
export interface RatesQuery {
  resortId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  stayType?: StayType; // default OVERNIGHT
}

export interface RoomTypeRates {
  roomTypeId: string;
  roomTypeName: string;
  occupancy: OccupancyConfig;
  ratePlans: RatePlan[];
  restrictions: Restrictions;
  dayUse?: DayUseOption;
}

/** One room line of a (possibly multi-room) reservation. */
export interface ReservationRoom {
  roomTypeId: string;
  plan: RatePlanCode;
  adults: number;
  children: number;
}

export interface CreateReservationInput {
  /** Booking correlation id — reused as the idempotency key for the write. */
  correlationId: string;
  resortId: string;
  roomTypeId: string; // single-room; ignored when `rooms` is provided
  checkIn: string;
  checkOut: string;
  guests: number;
  stayType?: StayType; // default OVERNIGHT
  plan?: RatePlanCode; // single-room plan
  rooms?: ReservationRoom[]; // multi-room; when set, takes precedence over roomTypeId/plan
}

export interface CreateReservationResult {
  crsBookingRef: string;
}

export interface InventoryClient {
  /** Health probe used before allowing a commit (§10 — block, don't queue, on downtime). */
  healthCheck(): Promise<boolean>;
  listResorts(): Promise<Resort[]>;
  /** Catalog read — all room types for a resort, WITHOUT a date/availability filter
   *  (used for the dateless browse view; availability is verified later per-date). */
  listRoomTypes(resortId: string): Promise<RoomTypeAvailability[]>;
  searchAvailability(query: AvailabilityQuery): Promise<RoomTypeAvailability[]>;
  /** Fresh read for a single room type — used to refresh-before-book. */
  getRoomType(resortId: string, roomTypeId: string): Promise<RoomTypeAvailability | null>;
  /** v4 — dated ARI pull: rate plans + restrictions + occupancy for one room type.
   *  The portal prices bookings from this (markup on the CRS net rate). */
  getRoomTypeRates(query: RatesQuery): Promise<RoomTypeRates | null>;
  createReservation(input: CreateReservationInput): Promise<CreateReservationResult>;
  cancelReservation(crsBookingRef: string): Promise<void>;
}
