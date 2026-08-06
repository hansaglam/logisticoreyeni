import { Timestamp, type DocumentData } from 'firebase-admin/firestore';

import {
  CANONICAL_TRUCK_MARKET_CATALOG,
  VEHICLE_MARKETPLACE_BALANCE,
} from './generated/canonicalInputs';
import type {
  MarketplaceFailureReason,
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from './vehicleMarketplaceTypes';
import { getServerDefaultFleetLimit } from './serverState';
import type { ServerStateDocument } from './serverStateTypes';

const MARKETPLACE_STATE_VERSION = 1;
const VALID_TRUCK_STATUSES = new Set([
  'idle',
  'on_route',
  'maintenance',
  'transferring',
  'out_of_fuel',
]);
const ACTIVE_JOB_STATUSES = new Set([
  'preparing',
  'on_route',
  'active',
  'paused',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveTankCapacity(rawTruck: Record<string, unknown>): number {
  const explicit = finite(rawTruck.fuelTankCapacityL);
  if (explicit > 0) return explicit;
  const capacityTons = finite(rawTruck.capacity, 25);
  if (capacityTons >= 38) return 500;
  if (capacityTons >= 30) return 400;
  return 300;
}

function buildActiveJobs(gameState: Record<string, unknown>): Map<string, string[]> {
  const byTruck = new Map<string, string[]>();
  const sources = [
    ...array(gameState.activeDeliveries),
    ...array(gameState.activeTransfers),
    ...array(gameState.activeWarehouseStockTransfers),
  ];
  for (const item of sources) {
    const job = record(item);
    const truckId = typeof job.truckId === 'string' ? job.truckId : '';
    const status = typeof job.status === 'string' ? job.status : '';
    const id = typeof job.id === 'string' ? job.id : '';
    if (!truckId || !id || !ACTIVE_JOB_STATUSES.has(status)) continue;
    byTruck.set(truckId, [...(byTruck.get(truckId) ?? []), id]);
  }
  return byTruck;
}

export type MarketplaceStateBuildResult =
  | { ok: true; state: MarketplacePlayerState }
  | { ok: false; reason: MarketplaceFailureReason };

/**
 * Trusted cloud-save belgesinden canonical marketplace ownership görünümü üretir.
 * Client payload'ı kabul etmez; yalnız Admin SDK ile okunmuş save/current kullanılır.
 */
export function buildMarketplaceStateFromCloudSave(
  uid: string,
  save: DocumentData,
  now: Timestamp,
): MarketplaceStateBuildResult {
  const gameState = record(save.gameState);
  const player = record(gameState.player);
  const rawTrucks = array(player.trucks);
  const truckIds = rawTrucks
    .map((item) => record(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const canonicalCash = finite(player.money, Number.NaN);
  if (
    !Array.isArray(player.trucks) ||
    !Number.isFinite(canonicalCash) ||
    truckIds.length !== new Set(truckIds).size
  ) {
    return { ok: false, reason: 'save-conflict' };
  }

  const drivers = array(player.drivers).map(record);
  const trailers = array(player.trailers).map(record);
  const activeJobs = buildActiveJobs(gameState);
  const ownedTruckSnapshots: MarketplaceVehicleRecord[] = [];

  for (const rawValue of rawTrucks) {
    const truck = record(rawValue);
    const truckId = typeof truck.id === 'string' ? truck.id : '';
    const templateId =
      typeof truck.catalogId === 'string' ? truck.catalogId : truckId;
    const catalog = CANONICAL_TRUCK_MARKET_CATALOG.find(
      (item) => item.templateId === templateId,
    );
    if (
      !truckId ||
      !catalog ||
      truck.ownershipType === 'leased' ||
      truck.leaseExpired === true
    ) {
      continue;
    }
    const fuelTankCapacityL = resolveTankCapacity(truck);
    const rawUpgrades = record(truck.upgrades);
    const attachedTrailer = trailers.find(
      (trailer) => trailer.attachedTruckId === truckId,
    );
    const assignedDriver = drivers.find(
      (driver) => driver.assignedTruckId === truckId,
    );
    const status =
      typeof truck.status === 'string' && VALID_TRUCK_STATUSES.has(truck.status)
        ? (truck.status as MarketplaceVehicleRecord['status'])
        : 'idle';
    ownedTruckSnapshots.push({
      truckId,
      templateId,
      ...(typeof truck.name === 'string' ? { customName: truck.name } : {}),
      currentCityId:
        typeof truck.currentCityId === 'string'
          ? truck.currentCityId
          : typeof player.homeCityId === 'string'
            ? player.homeCityId
            : 'izmir',
      condition: Math.min(100, Math.max(0, finite(truck.condition, 100))),
      totalMileageKm: Math.max(0, finite(truck.totalMileageKm)),
      currentFuelL: Math.min(
        fuelTankCapacityL,
        Math.max(0, finite(truck.currentFuelL, fuelTankCapacityL)),
      ),
      fuelTankCapacityL,
      purchasePrice: Math.max(
        0,
        finite(truck.purchasePrice, catalog.purchasePrice),
      ),
      ownershipType: 'owned',
      status,
      assignedDriverId:
        typeof assignedDriver?.id === 'string' ? assignedDriver.id : null,
      attachedTrailerId:
        typeof attachedTrailer?.id === 'string' ? attachedTrailer.id : null,
      activeJobIds: activeJobs.get(truckId) ?? [],
      marketplaceListingId: null,
      upgrades: {
        engine: Math.min(3, Math.max(0, finite(rawUpgrades.engine))),
        fuelEfficiency: Math.min(
          3,
          Math.max(0, finite(rawUpgrades.fuelEfficiency)),
        ),
        cargo: Math.min(3, Math.max(0, finite(rawUpgrades.cargo))),
        durability: Math.min(
          3,
          Math.max(0, finite(rawUpgrades.durability)),
        ),
      },
    });
  }

  const sourceSaveVersion = Math.max(
    1,
    Math.floor(
      finite(save.saveVersion, finite(record(gameState.meta).saveVersion, 1)),
    ),
  );
  return {
    ok: true,
    state: {
      ownerUid: uid,
      canonicalCash,
      fleetLimit:
        VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceDefaultFleetLimit,
      ownedTruckSnapshots,
      activeListingIds: [],
      soldTruckTombstones: [],
      stateVersion: MARKETPLACE_STATE_VERSION,
      migratedAt: now,
      sourceSaveVersion,
      updatedAt: now,
    },
  };
}

/**
 * Server-owned canonical state'ten marketplace görünümü üretir.
 * Cloud save okunmaz.
 */
export function buildMarketplaceStateFromServerState(
  uid: string,
  serverState: ServerStateDocument,
  now: Timestamp,
): MarketplaceStateBuildResult {
  if (serverState.ownerUid !== uid || !serverState.initialized) {
    return { ok: false, reason: 'save-conflict' };
  }
  const ownedTruckSnapshots: MarketplaceVehicleRecord[] = serverState.ownedTrucks.map(
    (truck) => ({
      truckId: truck.truckId,
      templateId: truck.templateId,
      ...(truck.customName ? { customName: truck.customName } : {}),
      currentCityId: truck.currentCityId,
      condition: truck.condition,
      totalMileageKm: truck.totalMileageKm,
      currentFuelL: truck.currentFuelL,
      fuelTankCapacityL: truck.fuelTankCapacityL,
      purchasePrice: truck.purchasePrice,
      ownershipType: 'owned',
      status: truck.status,
      assignedDriverId: truck.assignedDriverId ?? null,
      attachedTrailerId: truck.attachedTrailerId ?? null,
      activeJobIds: truck.activeJobIds ?? [],
      marketplaceListingId: truck.marketplaceListingId ?? null,
      upgrades: truck.upgrades,
    }),
  );
  return {
    ok: true,
    state: {
      ownerUid: uid,
      canonicalCash: Math.max(0, serverState.cash),
      fleetLimit: getServerDefaultFleetLimit(),
      ownedTruckSnapshots,
      activeListingIds: [],
      soldTruckTombstones: [],
      stateVersion: MARKETPLACE_STATE_VERSION,
      migratedAt: now,
      sourceSaveVersion: Math.max(1, Math.floor(serverState.sourceVersion)),
      updatedAt: now,
    },
  };
}

export function validateMarketplaceState(
  uid: string,
  state: MarketplacePlayerState,
): MarketplaceFailureReason | null {
  if (state.ownerUid !== uid) return 'not-owner';
  if (
    !Number.isInteger(state.stateVersion) ||
    state.stateVersion < MARKETPLACE_STATE_VERSION ||
    !Number.isFinite(state.canonicalCash) ||
    !Array.isArray(state.ownedTruckSnapshots)
  ) {
    return 'save-conflict';
  }
  return null;
}
