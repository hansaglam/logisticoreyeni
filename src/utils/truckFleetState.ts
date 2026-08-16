import type { Truck } from '../types/game';
import { normalizeTruckFuel } from './truckFuel';

const CONCURRENT_REFUEL_EPSILON_L = 0.05;

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
