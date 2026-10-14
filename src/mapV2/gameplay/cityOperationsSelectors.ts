import type { Contract, Delivery, Truck, Warehouse } from '../../types/game';
import { resolveStationaryTruckCityId } from './fleetLocation';
import { isActiveDeliveryStatus } from './cityOperation';

/**
 * Trucks counted as present in a city.
 * Stationary only: idle, maintenance, or out of fuel.
 * City id is currentCityId, or the truck homeCityId when currentCityId is absent.
 * on_route and transferring trucks are excluded even if an origin id remains.
 * The player home city is never used as a fallback.
 * Fleet map markers use the same resolveStationaryTruckCityId helper.
 */

export type CityWarehousePresence = {
  present: boolean;
  level: number | null;
  capacityTons: number | null;
};

export type CityOperationsSnapshot = {
  cityId: string;
  /** Available contracts whose origin is this city. Destinations are not counted. */
  availableContractCount: number;
  vehicleCount: number;
  /** Active deliveries whose origin or destination is this city. Not a live position. */
  activeShipmentLinkCount: number;
  warehouse: CityWarehousePresence;
  isHomeCity: boolean;
};

export function countContractsOriginatingInCity(
  contracts: readonly Pick<Contract, 'status' | 'originCityId'>[] | null | undefined,
  cityId: string,
): number {
  if (!contracts || !cityId) return 0;
  return contracts.filter((contract) => contract.status === 'available' && contract.originCityId === cityId).length;
}

export function countStationaryVehiclesInCity(
  trucks: readonly Pick<Truck, 'status' | 'currentCityId' | 'homeCityId'>[] | null | undefined,
  cityId: string,
): number {
  if (!trucks || !cityId) return 0;
  return trucks.filter((truck) => resolveStationaryTruckCityId(truck) === cityId).length;
}

export function countActiveShipmentLinks(
  deliveries: readonly Pick<Delivery, 'status' | 'originCityId' | 'destinationCityId'>[] | null | undefined,
  cityId: string,
): number {
  if (!deliveries || !cityId) return 0;
  return deliveries.filter((delivery) => {
    if (!isActiveDeliveryStatus(delivery.status)) return false;
    return delivery.originCityId === cityId || delivery.destinationCityId === cityId;
  }).length;
}

export function warehousePresenceInCity(
  warehouses: readonly Pick<Warehouse, 'cityId' | 'upgradeTier' | 'capacityTons' | 'capacityTon'>[] | null | undefined,
  cityId: string,
): CityWarehousePresence {
  const match = warehouses?.find((warehouse) => warehouse.cityId === cityId);
  if (!match) {
    return { present: false, level: null, capacityTons: null };
  }
  const capacity = match.capacityTons ?? match.capacityTon ?? null;
  return {
    present: true,
    level: typeof match.upgradeTier === 'number' ? match.upgradeTier : null,
    capacityTons: typeof capacity === 'number' ? capacity : null,
  };
}

/** Read-only city operations. Does not create contracts or move trucks. */
export function getCityOperationsSnapshot(input: {
  cityId: string;
  homeCityId?: string | null;
  contracts?: readonly Pick<Contract, 'status' | 'originCityId'>[] | null;
  trucks?: readonly Pick<Truck, 'status' | 'currentCityId' | 'homeCityId'>[] | null;
  deliveries?: readonly Pick<Delivery, 'status' | 'originCityId' | 'destinationCityId'>[] | null;
  warehouses?: readonly Pick<Warehouse, 'cityId' | 'upgradeTier' | 'capacityTons' | 'capacityTon'>[] | null;
}): CityOperationsSnapshot {
  const cityId = input.cityId;
  return {
    cityId,
    availableContractCount: countContractsOriginatingInCity(input.contracts, cityId),
    vehicleCount: countStationaryVehiclesInCity(input.trucks, cityId),
    activeShipmentLinkCount: countActiveShipmentLinks(input.deliveries, cityId),
    warehouse: warehousePresenceInCity(input.warehouses, cityId),
    isHomeCity: Boolean(input.homeCityId) && input.homeCityId === cityId,
  };
}
