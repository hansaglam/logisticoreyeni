import { readTruckFuelL } from './truckFleetState';
import type { Truck } from '../types/game';

export function traceFuelFromStore(
  phase: string,
  vehicleId: string,
  trucks: Truck[] | undefined,
  extras?: Record<string, unknown>,
): number | null {
  const truck = trucks?.find((candidate) => candidate.id === vehicleId);
  const fuel = readTruckFuelL(truck);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[FUEL_IOS_TRACE]', {
      phase,
      vehicleId,
      canonicalFuel: fuel,
      ...extras,
    });
  }
  return fuel;
}
