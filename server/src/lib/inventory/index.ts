import { env } from '../../config/env';
import { MockInventoryClient } from './mockInventory';
import type { InventoryClient } from './inventory.types';

export type {
  InventoryClient,
  AvailabilityQuery,
  CreateReservationInput,
  CreateReservationResult,
  DayUseOption,
  OccupancyConfig,
  RatePlan,
  RatePlanCode,
  RatesQuery,
  ReservationRoom,
  Resort,
  Restrictions,
  RoomTypeAvailability,
  RoomTypeRates,
  StayType,
} from './inventory.types';

let instance: InventoryClient | undefined;

/**
 * Hotel inventory source. `mock` is the in-memory dev catalogue; `crs` will be
 * the hotel's CRS once its API documentation arrives (docs/CRS-API-REQUIREMENTS.md
 * is the request we sent them). Selecting `crs` before the client exists fails
 * loudly here rather than pretending to work.
 */
export function getInventoryClient(): InventoryClient {
  if (!instance) {
    if (env.INVENTORY_PROVIDER === 'crs') {
      throw new Error(
        'INVENTORY_PROVIDER=crs — the CRS inventory client is not implemented yet (waiting on CRS API docs); use INVENTORY_PROVIDER=mock',
      );
    }
    instance = new MockInventoryClient();
  }
  return instance;
}
