import { httpClient } from './httpClient';

export type RatePlan = 'EP' | 'CP' | 'MAP' | 'AP';

// --- v4 §1 — CRS read-through (source of truth; net rates, pre-markup) ---
export interface AxisRatesRoom {
  resortId: string;
  resortName: string;
  roomTypeId: string;
  roomTypeName: string;
  availableCount: number;
  occupancy: {
    baseOccupancy: number;
    maxAdults: number;
    maxChildren: number;
    maxOccupancy: number;
    extraAdultCharge: number;
    childCharge: number;
    extraBedCharge: number;
  };
  restrictions: {
    minNights: number;
    maxNights?: number;
    closedToArrival: boolean;
    closedToDeparture: boolean;
    stopSell: boolean;
  };
  dayUseRate: number | null;
  plans: { plan: RatePlan; nights: number; avgNightlyRate: number; totalRate: number }[];
}

export interface AxisRatesOverview {
  resorts: { id: string; name: string; location: string }[];
  resortId: string;
  rooms: AxisRatesRoom[];
}

export async function getAxisRates(params: { resortId?: string; checkIn: string; checkOut: string }): Promise<AxisRatesOverview> {
  return (await httpClient.get('/catalog/axis-rates', { params })).data;
}

// --- Admin catalog (CRS resorts + room types; read-only) ----------------
export interface CatalogRoom {
  roomTypeId: string;
  roomTypeName: string;
  maxOccupancy: number;
  baseRatePerNight: number;
  dayUseRate: number | null;
}
export interface CatalogResort {
  id: string;
  name: string;
  location: string;
  roomCount: number;
  rooms: CatalogRoom[];
}

export async function getAdminCatalog(): Promise<{ resorts: CatalogResort[] }> {
  return (await httpClient.get('/catalog/admin/overview')).data;
}
