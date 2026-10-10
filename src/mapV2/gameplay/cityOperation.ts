import { resolveTruckCityId } from '../../simulation/delivery';
import type { Delivery, DeliveryStatus, Truck, Warehouse } from '../../types/game';
import type { GameplayCityId, GeoCityId } from '../domain/ids';

/** Active jobs: in-flight only. Completed/failed/cancelled are not shown. */
export const CITY_ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'preparing',
  'on_route',
  'paused',
];

export type CityOperationalStatus = 'HOME' | 'OPERATION' | 'POINT';

/** One restrained map-node hint. Never stacked icons. Not geo infrastructure. */
export type CityNodeOperationHint = 'HOME' | 'WAREHOUSE' | 'ACTIVE' | 'NONE';

export type CityOperationViewModel = {
  legacyCityId: GameplayCityId;
  geoCityId: GeoCityId | null;
  displayName: string;
  isHomeCity: boolean;
  warehouseCount: number;
  ownedTruckCount: number;
  activeDeliveryCount: number;
  operationalStatus: CityOperationalStatus;
  canInspect: boolean;
};

export type CityOperationSnapshot = {
  homeCityId: string | null | undefined;
  warehouses: readonly Warehouse[] | null | undefined;
  trucks: readonly Truck[] | null | undefined;
  deliveries: readonly Delivery[] | null | undefined;
};

export function isActiveDeliveryStatus(status: DeliveryStatus | string | undefined): boolean {
  return status === 'preparing' || status === 'on_route' || status === 'paused';
}

export function selectWarehousesByCity(
  warehouses: readonly Warehouse[] | null | undefined,
  legacyCityId: string,
): Warehouse[] {
  if (!warehouses || !legacyCityId) return [];
  return warehouses.filter((warehouse) => warehouse?.cityId === legacyCityId);
}

/**
 * Player fleet currently located in the city.
 * Location: `resolveTruckCityId` (currentCityId, then truck.homeCityId, then player home).
 * Excludes marketplace-locked trucks. Leased fleet trucks still count — they are in player.trucks.
 */
export function selectOwnedTrucksByCity(
  trucks: readonly Truck[] | null | undefined,
  legacyCityId: string,
  playerHomeCityId?: string | null,
): Truck[] {
  if (!trucks || !legacyCityId) return [];
  return trucks.filter((truck) => {
    if (!truck || truck.status === 'marketplace_locked') return false;
    return resolveTruckCityId(truck, playerHomeCityId ?? undefined) === legacyCityId;
  });
}

/**
 * Active deliveries whose origin OR destination is the selected gameplay city.
 * Does not use generated available-contract lists.
 */
export function selectActiveDeliveriesByCity(
  deliveries: readonly Delivery[] | null | undefined,
  legacyCityId: string,
): Delivery[] {
  if (!deliveries || !legacyCityId) return [];
  return deliveries.filter((delivery) => {
    if (!delivery || !isActiveDeliveryStatus(delivery.status)) return false;
    return delivery.originCityId === legacyCityId || delivery.destinationCityId === legacyCityId;
  });
}

export function cityOperationalStatus(input: {
  isHomeCity: boolean;
  warehouseCount: number;
  ownedTruckCount: number;
  activeDeliveryCount: number;
}): CityOperationalStatus {
  if (input.isHomeCity) return 'HOME';
  if (input.warehouseCount > 0 || input.ownedTruckCount > 0 || input.activeDeliveryCount > 0) {
    return 'OPERATION';
  }
  return 'POINT';
}

export function cityNodeOperationHint(model: Pick<CityOperationViewModel, 'isHomeCity' | 'warehouseCount' | 'activeDeliveryCount'>): CityNodeOperationHint {
  if (model.isHomeCity) return 'HOME';
  if (model.warehouseCount > 0) return 'WAREHOUSE';
  if (model.activeDeliveryCount > 0) return 'ACTIVE';
  return 'NONE';
}

export function buildCityOperationViewModel(input: {
  legacyCityId: string;
  geoCityId: string | null | undefined;
  displayName: string;
  snapshot: CityOperationSnapshot;
}): CityOperationViewModel {
  const legacyCityId = input.legacyCityId;
  const homeCityId = input.snapshot.homeCityId ?? null;
  const isHomeCity = Boolean(homeCityId) && homeCityId === legacyCityId;
  const warehouseCount = selectWarehousesByCity(input.snapshot.warehouses, legacyCityId).length;
  const ownedTruckCount = selectOwnedTrucksByCity(
    input.snapshot.trucks,
    legacyCityId,
    homeCityId,
  ).length;
  const activeDeliveryCount = selectActiveDeliveriesByCity(input.snapshot.deliveries, legacyCityId).length;
  const geoCityId = input.geoCityId ?? null;
  return {
    legacyCityId,
    geoCityId,
    displayName: input.displayName,
    isHomeCity,
    warehouseCount,
    ownedTruckCount,
    activeDeliveryCount,
    operationalStatus: cityOperationalStatus({
      isHomeCity,
      warehouseCount,
      ownedTruckCount,
      activeDeliveryCount,
    }),
    canInspect: Boolean(geoCityId),
  };
}

export function truckStatusCaption(status: Truck['status'] | string | undefined): string {
  if (status === 'on_route') return 'Yolda';
  if (status === 'transferring') return 'Transfer';
  if (status === 'maintenance') return 'Bakım';
  if (status === 'out_of_fuel') return 'Yakıt yok';
  if (status === 'marketplace_locked') return 'Kilitli';
  return 'Hazır';
}
