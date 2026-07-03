/**
 * LogistiCore - Kamyon kataloğu
 *
 * Başlangıç kamyonu ve satın alınabilir kamyon şablonları.
 */

import { getTruckRequiredLevel } from '../config/levelConfig';
import type { Truck } from '../types/game';

/** Satın alınabilir kamyon şablonu — id ve sahiplik durumu hariç */
export type TruckTemplate = Omit<Truck, 'currentCityId' | 'status' | 'catalogId'>;

/** Mağazada listelenen kamyon — level kilidi ile */
export interface TruckMarketItem extends TruckTemplate {
  /** Bu modeli satın almak için gereken şirket seviyesi */
  requiredLevel: number;
}

/** Oyuncunun oyuna başladığı varsayılan kamyon */
export const STARTER_TRUCK: Truck = {
  id: 'truck-starter-1',
  catalogId: 'truck-starter-1',
  name: 'İzmir Express',
  capacity: 25,
  fuelConsumptionPerKm: 0.32,
  speed: 72,
  reliability: 75,
  maintenanceCost: 0.18,
  comfort: 60,
  condition: 88,
  purchasePrice: 45_000,
  currentCityId: 'izmir',
  status: 'idle',
};

/** Galeride satın alınabilir kamyonlar — requiredLevel levelConfig ile senkron */
export const TRUCK_MARKET: TruckMarketItem[] = [
  {
    id: 'truck-ford-cargo',
    name: 'Ford Cargo 1833',
    capacity: 18,
    fuelConsumptionPerKm: 0.35,
    speed: 68,
    reliability: 70,
    maintenanceCost: 0.14,
    comfort: 55,
    condition: 100,
    purchasePrice: 52_000,
    requiredLevel: 1,
  },
  {
    id: 'truck-volvo-fh',
    name: 'Volvo FH 460',
    capacity: 30,
    fuelConsumptionPerKm: 0.28,
    speed: 78,
    reliability: 88,
    maintenanceCost: 0.22,
    comfort: 75,
    condition: 100,
    purchasePrice: 85_000,
    requiredLevel: 3,
  },
  {
    id: 'truck-mercedes-actros',
    name: 'Mercedes Actros',
    capacity: 28,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 85,
    maintenanceCost: 0.24,
    comfort: 82,
    condition: 100,
    purchasePrice: 92_000,
    requiredLevel: 4,
  },
  {
    id: 'truck-refrigerated',
    name: 'Soğutmalı Kamyon',
    capacity: 22,
    fuelConsumptionPerKm: 0.38,
    speed: 70,
    reliability: 82,
    maintenanceCost: 0.26,
    comfort: 65,
    condition: 100,
    purchasePrice: 98_000,
    requiredLevel: 7,
  },
  {
    id: 'truck-heavy-haul',
    name: 'Ağır Yük Kamyonu',
    capacity: 40,
    fuelConsumptionPerKm: 0.42,
    speed: 65,
    reliability: 90,
    maintenanceCost: 0.28,
    comfort: 70,
    condition: 100,
    purchasePrice: 125_000,
    requiredLevel: 8,
  },
];

/** @deprecated TRUCK_MARKET kullanın */
export const AVAILABLE_TRUCKS: TruckMarketItem[] = TRUCK_MARKET;

export function getTruckCatalogId(truck: Pick<Truck, 'id' | 'catalogId'>): string {
  return truck.catalogId ?? truck.id;
}

export function resolveTruckMarketRequiredLevel(item: TruckMarketItem): number {
  return item.requiredLevel ?? getTruckRequiredLevel(item.id) ?? 1;
}

export function countOwnedTrucksOfCatalog(
  trucks: Pick<Truck, 'id' | 'catalogId'>[],
  catalogId: string,
): number {
  return trucks.filter((truck) => getTruckCatalogId(truck) === catalogId).length;
}

export function findTruckMarketItem(catalogId: string): TruckMarketItem | undefined {
  return TRUCK_MARKET.find((item) => item.id === catalogId);
}
