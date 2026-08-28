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
  /** Backend could not serialize every ownedTruckSnapshot — do not apply cash alone. */
  incomplete?: boolean;
  droppedOwnedCount?: number;
}

export type MarketplaceReconcileRejectReason =
  | 'incomplete-vehicle-materialization'
  | 'cash-without-expected-trucks'
  | 'sold-trucks-without-cash';

export interface MarketplaceReconcileDiagnostics {
  expectedVehicleIds: string[];
  materializedAddedIds: string[];
  missingTemplateIds: string[];
  droppedVehicleIds: string[];
  removedSoldIds: string[];
  usedFallbackTemplateIds: string[];
}

export interface MarketplaceReconcileFleetResult {
  trucks: Truck[];
  cache: VehicleMarketplaceSaveCache;
  authoritativeCash?: number;
  diagnostics: MarketplaceReconcileDiagnostics;
  /**
   * When false, callers must not mutate local money/fleet from this payload
   * (partial apply would recreate the live data-loss bug).
   */
  isComplete: boolean;
  rejectReason?: MarketplaceReconcileRejectReason;
}

function resolveCatalogTemplate(templateId: string): {
  template: typeof STARTER_TRUCK | NonNullable<ReturnType<typeof findTruckMarketItem>>;
  usedFallback: boolean;
  missingFromCatalog: boolean;
} {
  if (templateId === STARTER_TRUCK.catalogId || templateId === STARTER_TRUCK.id) {
    return { template: STARTER_TRUCK, usedFallback: false, missingFromCatalog: false };
  }
  const market = findTruckMarketItem(templateId);
  if (market) {
    return { template: market, usedFallback: false, missingFromCatalog: false };
  }
  // Never drop an authoritative owned vehicle — structural fallback preserves ownership.
  return { template: STARTER_TRUCK, usedFallback: true, missingFromCatalog: true };
}

export function materializeTruckFromMarketplaceVehicle(
  vehicle: AuthoritativeMarketplaceReconciliation['vehicles'][number],
): { truck: Truck | null; usedFallback: boolean; missingFromCatalog: boolean } {
  if (
    typeof vehicle.truckId !== 'string' ||
    vehicle.truckId.length === 0 ||
    typeof vehicle.templateId !== 'string' ||
    vehicle.templateId.length === 0 ||
    typeof vehicle.currentCityId !== 'string' ||
    vehicle.currentCityId.length === 0
  ) {
    return { truck: null, usedFallback: false, missingFromCatalog: true };
  }

  const { template, usedFallback, missingFromCatalog } = resolveCatalogTemplate(
    vehicle.templateId,
  );
  const fuelTankCapacityL =
    Number.isFinite(vehicle.fuelTankCapacityL) && vehicle.fuelTankCapacityL > 0
      ? vehicle.fuelTankCapacityL
      : (template.fuelTankCapacityL ?? 300);
  const currentFuelL = Number.isFinite(vehicle.currentFuelL)
    ? Math.max(0, Math.min(fuelTankCapacityL, vehicle.currentFuelL))
    : fuelTankCapacityL;

  return {
    usedFallback,
    missingFromCatalog,
    truck: {
      ...structuredClone(template),
      id: vehicle.truckId,
      catalogId: vehicle.templateId,
      name: vehicle.customName ?? template.name,
      currentCityId: vehicle.currentCityId,
      homeCityId: vehicle.currentCityId,
      condition: Number.isFinite(vehicle.condition) ? vehicle.condition : template.condition,
      totalMileageKm: Number.isFinite(vehicle.totalMileageKm) ? vehicle.totalMileageKm : 0,
      currentFuelL,
      fuelTankCapacityL,
      upgrades: vehicle.upgrades ?? template.upgrades,
      ownershipType: 'owned',
      status: vehicle.status === 'marketplace_locked' ? 'marketplace_locked' : 'idle',
    },
  };
}

/**
 * Cloud restore / purchase reconcile: apply backend ownership atomically.
 * Incomplete materialization must not debit/credit cash alone.
 */
export function reconcileFleetWithVehicleMarketplace(
  localTrucks: Truck[],
  authoritative: AuthoritativeMarketplaceReconciliation,
): MarketplaceReconcileFleetResult {
  const soldIds = new Set(
    (authoritative.soldTruckIds ?? []).filter((id): id is string => typeof id === 'string'),
  );
  const vehicles = Array.isArray(authoritative.vehicles) ? authoritative.vehicles : [];
  const authoritativeById = new Map(vehicles.map((vehicle) => [vehicle.truckId, vehicle]));
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
  const expectedVehicleIds = vehicles
    .filter((vehicle) => !soldIds.has(vehicle.truckId))
    .map((vehicle) => vehicle.truckId);
  const materializedAddedIds: string[] = [];
  const droppedVehicleIds: string[] = [];
  const missingTemplateIds: string[] = [];
  const usedFallbackTemplateIds: string[] = [];
  const addedTrucks: Truck[] = [];

  for (const vehicle of vehicles) {
    if (soldIds.has(vehicle.truckId) || existingIds.has(vehicle.truckId)) {
      continue;
    }
    const materialized = materializeTruckFromMarketplaceVehicle(vehicle);
    if (!materialized.truck) {
      droppedVehicleIds.push(vehicle.truckId);
      if (vehicle.templateId) missingTemplateIds.push(vehicle.templateId);
      continue;
    }
    if (materialized.missingFromCatalog) {
      missingTemplateIds.push(vehicle.templateId);
    }
    if (materialized.usedFallback) {
      usedFallbackTemplateIds.push(vehicle.templateId);
    }
    materializedAddedIds.push(vehicle.truckId);
    existingIds.add(vehicle.truckId);
    addedTrucks.push(materialized.truck);
  }

  const removedSoldIds = localTrucks
    .filter((truck) => soldIds.has(truck.id))
    .map((truck) => truck.id);
  const trucks = [...reconciledExisting, ...addedTrucks];
  const authoritativeCash = Number.isFinite(authoritative.cash)
    ? Number(authoritative.cash)
    : undefined;

  const diagnostics: MarketplaceReconcileDiagnostics = {
    expectedVehicleIds,
    materializedAddedIds,
    missingTemplateIds: [...new Set(missingTemplateIds)],
    droppedVehicleIds,
    removedSoldIds,
    usedFallbackTemplateIds: [...new Set(usedFallbackTemplateIds)],
  };

  let isComplete = droppedVehicleIds.length === 0 && authoritative.incomplete !== true;
  let rejectReason: MarketplaceReconcileRejectReason | undefined;
  if (authoritative.incomplete === true) {
    isComplete = false;
    rejectReason = 'incomplete-vehicle-materialization';
  } else if (droppedVehicleIds.length > 0) {
    rejectReason = 'incomplete-vehicle-materialization';
  } else if (
    removedSoldIds.length > 0 &&
    authoritativeCash == null
  ) {
    // Seller path: never remove sold trucks without an authoritative cash figure.
    isComplete = false;
    rejectReason = 'sold-trucks-without-cash';
  }

  const finalTrucks = isComplete ? trucks : localTrucks.slice();
  return {
    trucks: finalTrucks,
    authoritativeCash: isComplete ? authoritativeCash : undefined,
    diagnostics,
    isComplete,
    rejectReason,
    cache: {
      activeMarketplaceListingIds: isComplete
        ? vehicles
            .map((vehicle) => vehicle.marketplaceListingId)
            .filter((id): id is string => Boolean(id))
        : [],
      marketplaceStateVersion: authoritative.marketplaceStateVersion,
      soldTruckIds: isComplete ? authoritative.soldTruckIds.slice(-100) : [],
      lastMarketplaceSyncAt: Date.now(),
    },
  };
}

/**
 * Buyer success path: apply cash + purchased truck in one mutation input.
 * Used when purchase receipt includes the transferred snapshot.
 */
export function buildLocalPurchaseApplyPatch(params: {
  localTrucks: Truck[];
  localCash: number;
  buyerCashAfter: number;
  vehicle: AuthoritativeMarketplaceReconciliation['vehicles'][number];
  marketplaceStateVersion?: number;
}): {
  ok: true;
  trucks: Truck[];
  money: number;
  cache: VehicleMarketplaceSaveCache;
} | {
  ok: false;
  reason: MarketplaceReconcileRejectReason;
} {
  if (!Number.isFinite(params.buyerCashAfter) || params.buyerCashAfter < 0) {
    return { ok: false, reason: 'cash-without-expected-trucks' };
  }
  if (params.localTrucks.some((truck) => truck.id === params.vehicle.truckId)) {
    return {
      ok: true,
      trucks: params.localTrucks,
      money: params.buyerCashAfter,
      cache: {
        activeMarketplaceListingIds: [],
        marketplaceStateVersion: params.marketplaceStateVersion,
        soldTruckIds: [],
        lastMarketplaceSyncAt: Date.now(),
      },
    };
  }
  const materialized = materializeTruckFromMarketplaceVehicle(params.vehicle);
  if (!materialized.truck) {
    return { ok: false, reason: 'incomplete-vehicle-materialization' };
  }
  return {
    ok: true,
    trucks: [...params.localTrucks, materialized.truck],
    money: params.buyerCashAfter,
    cache: {
      activeMarketplaceListingIds: [],
      marketplaceStateVersion: params.marketplaceStateVersion,
      soldTruckIds: [],
      lastMarketplaceSyncAt: Date.now(),
    },
  };
}
