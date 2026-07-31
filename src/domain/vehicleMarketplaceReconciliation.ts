import type { Truck } from '../types/game';
import { findTruckMarketItem, STARTER_TRUCK } from '../data/trucks';
import type {
  TransferableTruckSnapshot,
  VehicleMarketplaceSaveCache,
} from '../types/vehicleMarketplace';

export interface AuthoritativeMarketplaceReconciliation {
  marketplaceStateVersion: number;
  cash?: number;
  fleetLimit?: number;
  soldTruckIds: string[];
  vehicles: Array<
    TransferableTruckSnapshot & {
      status: 'idle' | 'marketplace_locked';
      marketplaceListingId?: string | null;
    }
  >;
}

/**
 * Cloud restore sonrasında backend sahiplik sonucunu local filoya uygular.
 * Satılmış araçlar eski save'den geri gelemez; backend'deki kilitler korunur.
 */
export function reconcileFleetWithVehicleMarketplace(
  localTrucks: Truck[],
  authoritative: AuthoritativeMarketplaceReconciliation,
): {
  trucks: Truck[];
  cache: VehicleMarketplaceSaveCache;
  authoritativeCash?: number;
} {
  const soldIds = new Set(authoritative.soldTruckIds);
  const authoritativeById = new Map(
    authoritative.vehicles.map((vehicle) => [vehicle.truckId, vehicle]),
  );
  const reconciledExisting = localTrucks
    .filter((truck) => !soldIds.has(truck.id))
    .map((truck) => {
      const vehicle = authoritativeById.get(truck.id);
      if (!vehicle) return truck;
      return {
        ...truck,
        name: vehicle.customName ?? truck.name,
        catalogId: vehicle.templateId,
        currentCityId: vehicle.currentCityId,
        condition: vehicle.condition,
        totalMileageKm: vehicle.totalMileageKm,
        currentFuelL: vehicle.currentFuelL,
        fuelTankCapacityL: vehicle.fuelTankCapacityL,
        upgrades: vehicle.upgrades ?? truck.upgrades,
        status: vehicle.status,
      };
    });
  const existingIds = new Set(reconciledExisting.map((truck) => truck.id));
  const addedTrucks = authoritative.vehicles
    .filter((vehicle) => !soldIds.has(vehicle.truckId) && !existingIds.has(vehicle.truckId))
    .flatMap((vehicle): Truck[] => {
      const template =
        vehicle.templateId === STARTER_TRUCK.catalogId
          ? STARTER_TRUCK
          : findTruckMarketItem(vehicle.templateId);
      if (!template) return [];
      return [{
        ...structuredClone(template),
        id: vehicle.truckId,
        catalogId: vehicle.templateId,
        name: vehicle.customName ?? template.name,
        currentCityId: vehicle.currentCityId,
        homeCityId: vehicle.currentCityId,
        condition: vehicle.condition,
        totalMileageKm: vehicle.totalMileageKm,
        currentFuelL: vehicle.currentFuelL,
        fuelTankCapacityL: vehicle.fuelTankCapacityL,
        upgrades: vehicle.upgrades,
        ownershipType: 'owned',
        status: vehicle.status,
      }];
    });
  const trucks = [...reconciledExisting, ...addedTrucks];
  return {
    trucks,
    authoritativeCash: Number.isFinite(authoritative.cash)
      ? authoritative.cash
      : undefined,
    cache: {
      activeMarketplaceListingIds: authoritative.vehicles
        .map((vehicle) => vehicle.marketplaceListingId)
        .filter((id): id is string => Boolean(id)),
      marketplaceStateVersion: authoritative.marketplaceStateVersion,
      soldTruckIds: authoritative.soldTruckIds.slice(-100),
      lastMarketplaceSyncAt: Date.now(),
    },
  };
}
