import type { Truck } from '../types/game';

/**
 * Game-loop tick'leri başlangıçtaki truck snapshot'ı üzerinden çalışır.
 * Tick sırasında refuel gibi eşzamanlı player mutation'ları olursa,
 * stale `set({ player: { ...baselinePlayer, trucks }})` yeni yakıtı ezer.
 *
 * Bu helper yalnızca tick içinde gerçekten değişen kamyonları
 * en güncel live fleet üzerine uygular.
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

  return liveTrucks.map((truck) => changedById.get(truck.id) ?? truck);
}

export function didTruckListChange(
  baselineTrucks: Truck[],
  updatedTrucks: Truck[],
): boolean {
  return updatedTrucks !== baselineTrucks;
}
