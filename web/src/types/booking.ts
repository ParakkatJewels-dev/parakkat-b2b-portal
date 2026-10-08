export type BookingState =
  | 'DRAFT'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED_ON_CREDIT'
  | 'PAID'
  | 'CONFIRMED'
  | 'COMMITTED'
  | 'COMMIT_FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface Resort {
  id: string;
  name: string;
  location: string;
}

export type RatePlan = 'EP' | 'CP' | 'MAP' | 'AP';

export interface PlanPrice {
  plan: RatePlan;
  pricePerNight: number;
  priceTotal: number;
  breakdown: {
    plan: RatePlan;
    nights: number;
    occupancy: { adults: number; children: number; extraBeds: number; baseOccupancy: number };
    perNight: { base: number; extraAdults: number; extraAdultAmount: number; childAmount: number; extraBedAmount: number; total: number };
    roomChargeTotal: number;
    markupPct: number;
    agencyPrice: number;
  };
}

export interface PricedRoomType {
  roomTypeId: string;
  roomTypeName: string;
  maxOccupancy: number;
  availableCount: number;
  nights: number;
  plans: PlanPrice[];
  // Back-compat: cheapest plan.
  agencyPricePerNight: number;
  agencyPriceTotal: number;
}

export interface Booking {
  id: string;
  groupId?: string | null;
  resortName: string;
  roomTypeName: string;
  ratePlan?: RatePlan;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  agencyPrice: string;
  // B2B resale layer — agent's markup snapshot and customer-facing sell price
  // (null on bookings made before the feature existed).
  resaleMarkupPct?: string | null;
  sellPrice?: string | null;
  paymentMode: 'PREPAY' | 'CREDIT';
  state: BookingState;
  holdExpiresAt: string | null;
  crsBookingRef: string | null;
  createdAt: string;
  // v3 §8 — guest data (ID masked: only last-4 retained).
  leadGuestName?: string | null;
  leadGuestPhone?: string | null;
  leadGuestEmail?: string | null;
  specialRequests?: string | null;
  guestIdType?: string | null;
  guestIdLast4?: string | null;
}
