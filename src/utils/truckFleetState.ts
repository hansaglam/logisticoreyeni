import type { Truck } from '../types/game';
import { normalizeTruckFuel } from './truckFuel';

const CONCURRENT_REFUEL_EPSILON_L = 0.05;

let devStateRevision = 0;

/** Monotonic revision bumped on canonical truck mutations (dev diagnostics). */
export function bumpCanonicalStateRevision(reason: string): number {
  devStateRevision += 1;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[canonical-state-revision]', { revision: devStateRevision, reason });
  }
  return devStateRevision;
}

export function getCanonicalStateRevision(): number {
  return devStateRevision;
}

export function patchTruckById(
  trucks: Truck[],
  truckId: string,
  patch: (truck: Truck) => Truck,
): Truck[] {
  let changed = false;
  const next = trucks.map((truck) => {
    if (truck.id !== truckId) return truck;
    const updated = patch(truck);
    if (updated !== truck) changed = true;
    return updated;
  });
  return changed ? next : trucks;
}

export function readTruckFuelL(truck: Truck | null | undefined): number | null {
  if (!truck) return null;
  return normalizeTruckFuel(truck).currentFuelL ?? null;
}

export type VehicleConsistencySnapshot = {
  vehicleId: string;
  canonicalFuel: number | null;
  fleetFuel: number | null;
  mapFuel?: number | null;
  deliveryFuel?: number | null;
  selectedVehicleFuel?: number | null;
};

/** Dev-only: log when multiple runtime views of the same truck diverge. */
export function assertVehicleConsistency(
  snapshot: VehicleConsistencySnapshot,
): boolean {
  const values = [
    snapshot.canonicalFuel,
    snapshot.fleetFuel,
    snapshot.mapFuel,
    snapshot.deliveryFuel,
    snapshot.selectedVehicleFuel,
  ].filter((value): value is number => value != null);
  if (values.length < 2) return true;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min <= CONCURRENT_REFUEL_EPSILON_L) return true;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[VEHICLE_STATE_DIVERGENCE]', snapshot);
  }
  return false;
}

export function logFuelIosTrace(payload: {
  phase: string;
  vehicleId: string;
  fuelBefore?: number | null;
  litersPurchased?: number | null;
  fuelAfterMutation?: number | null;
  canonicalFuelAfterMutation?: number | null;
  persistedFuel?: number | null;
  fuelAfterModalDismiss?: number | null;
  fuelAfterScreenFocus?: number | null;
  fuelAfterHydration?: number | null;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.log('[FUEL_IOS_TRACE]', payload);
}

/**
 * Game-loop tick'leri başlangıçtaki truck snapshot'ı üzerinden çalışır.
 * Tick sırasında refuel gibi eşzamanlı player mutation'ları olursa,
 * stale `set({ player: { ...baselinePlayer, trucks }})` yeni yakıtı ezer.
 *
 * Bu helper yalnızca tick içinde gerçekten değişen kamyonları
 * en güncel live fleet üzerine uygular.
 *
 * If the player refueled (city or roadside) after the tick snapshot,
 * keep that higher live fuel. iOS hits this race more often because
 * the display-link tick can commit while a Modal purchase is applying.
 */
export function mergeTruckTickUpdates(
  liveTrucks: Truck[],
  baselineTrucks: Truck[],
  updatedTrucks: Truck[],
): Truck[] {
  if (updatedTrucks === baselineTrucks) {
    return liveTrucks;
  }

  const baselineById = new Map(baselineTrucks.map((truck) => [truck.id, truck]));
  const changedById = new Map<string, Truck>();
  for (const truck of updatedTrucks) {
    if (baselineById.get(truck.id) !== truck) {
      changedById.set(truck.id, truck);
    }
  }

  if (changedById.size === 0) {
    return liveTrucks;
  }

  return liveTrucks.map((liveTruck) => {
    const tickTruck = changedById.get(liveTruck.id);
    if (!tickTruck) return liveTruck;

    const baselineTruck = baselineById.get(liveTruck.id);
    if (!baselineTruck) return tickTruck;

    const liveFuel = normalizeTruckFuel(liveTruck).currentFuelL ?? 0;
    const tickFuel = normalizeTruckFuel(tickTruck).currentFuelL ?? 0;
    const baseFuel = normalizeTruckFuel(baselineTruck).currentFuelL ?? 0;
    const playerRefueledDuringTick =
      liveFuel > baseFuel + CONCURRENT_REFUEL_EPSILON_L &&
      liveFuel > tickFuel + CONCURRENT_REFUEL_EPSILON_L;

    if (!playerRefueledDuringTick) {
      return tickTruck;
    }

    return {
      ...tickTruck,
      currentFuelL: liveFuel,
      status:
        liveFuel > 1e-6 && tickTruck.status === 'out_of_fuel'
          ? liveTruck.status
          : tickTruck.status,
    };
  });
}

export function didTruckListChange(
  baselineTrucks: Truck[],
  updatedTrucks: Truck[],
): boolean {
  return updatedTrucks !== baselineTrucks;
}
