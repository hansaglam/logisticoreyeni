import type { Truck, TruckStatus } from '../../types/game';

/**
 * City used by both the City Inspector vehicle count and the fleet map.
 * Stationary only: idle, maintenance, or out of fuel.
 * currentCityId wins. The truck's own homeCityId is used only when currentCityId is absent.
 * The player home city is never consulted.
 * on_route, transferring, and marketplace_locked trucks are not placed in a city.
 */
const STATIONARY_TRUCK_STATUSES = new Set<TruckStatus>(['idle', 'maintenance', 'out_of_fuel']);

export function resolveStationaryTruckCityId(
  truck: Pick<Truck, 'status'> & {
    currentCityId?: string | null;
    homeCityId?: string | null;
  },
): string | null {
  if (!STATIONARY_TRUCK_STATUSES.has(truck.status)) return null;
  const cityId = truck.currentCityId ?? truck.homeCityId ?? null;
  if (!cityId) return null;
  return cityId;
}
