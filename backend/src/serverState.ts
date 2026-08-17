import { Timestamp, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';

import {
  calculateLeaderboardScore,
  extractCanonicalPlayerStateFromServerState,
} from './leaderboardScore';
import {
  CANONICAL_TRUCK_MARKET_CATALOG,
  VEHICLE_MARKETPLACE_BALANCE,
} from './generated/canonicalInputs';
import type {
  LegacyMigrationReport,
  ServerOwnedTruckRecord,
  ServerOwnedWarehouseSnapshot,
  ServerStateDocument,
  ServerStateFailureReason,
  ServerStateMigrationSource,
} from './serverStateTypes';
import { SERVER_STATE_SCHEMA_VERSION } from './serverStateTypes';
import type { MarketplacePlayerState } from './vehicleMarketplaceTypes';
import {
  buildMarketplaceStateFromCloudSave,
} from './vehicleMarketplaceState';
import {
  mergeCloudFleetIntoExistingMarketplaceState,
} from './authoritativeFleetReconciliation';

/** Matches client STARTING_MONEY — server-defined new-account baseline. */
export const SERVER_DEFAULT_CASH = 20_000;
export const SERVER_DEFAULT_COMPANY_LEVEL = 1;
export const SERVER_DEFAULT_REPUTATION = 50;
export const SERVER_DEFAULT_STARTER_TRUCK_ID = 'truck-starter-1';
export const SERVER_DEFAULT_STARTER_INSTANCE_ID = 'truck-starter-1';

export const LEGACY_MIGRATION_BOUNDS = {
  maxCash: 5_000_000,
  suspiciousCash: 500_000,
  maxLevel: 100,
  maxReputation: 100,
  maxCompletedDeliveries: 50_000,
  maxTrucks: 20,
  maxWarehouses: 10,
} as const;

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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolveTankCapacity(rawTruck: Record<string, unknown>): number {
  const explicit = finite(rawTruck.fuelTankCapacityL);
  if (explicit > 0) return explicit;
  const capacityTons = finite(rawTruck.capacity, 25);
  if (capacityTons >= 38) return 500;
  if (capacityTons >= 30) return 400;
  return 300;
}

function starterTruckRecord(): ServerOwnedTruckRecord {
  const catalog = CANONICAL_TRUCK_MARKET_CATALOG.find(
    (item) => item.templateId === SERVER_DEFAULT_STARTER_TRUCK_ID,
  );
  const purchasePrice = catalog?.purchasePrice ?? 45_000;
  const fuelTankCapacityL = 300;
  return {
    truckId: SERVER_DEFAULT_STARTER_INSTANCE_ID,
    templateId: SERVER_DEFAULT_STARTER_TRUCK_ID,
    customName: 'İzmir Express',
    currentCityId: 'izmir',
    condition: 88,
    totalMileageKm: 0,
    currentFuelL: fuelTankCapacityL,
    fuelTankCapacityL,
    purchasePrice,
    ownershipType: 'owned',
    status: 'idle',
    assignedDriverId: null,
    attachedTrailerId: null,
    activeJobIds: [],
    marketplaceListingId: null,
    upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
  };
}

function defaultWarehouses(): ServerOwnedWarehouseSnapshot[] {
  return [
    {
      id: 'warehouse-starter-1',
      cityId: 'izmir',
      capacityTons: 100,
      upgradeTier: 1,
    },
  ];
}

function recalculateLeaderboardScore(state: Omit<ServerStateDocument, 'leaderboardScore'>): number {
  const extracted = extractCanonicalPlayerStateFromServerState(state as ServerStateDocument);
  if (!extracted.ok) return 0;
  return calculateLeaderboardScore(extracted.player, extracted.gameState).totalScore;
}

export function serverStateRef(firestore: Firestore, uid: string) {
  return firestore.doc(`users/${uid}/serverState/current`);
}

export function buildDefaultServerState(uid: string, now: Timestamp): ServerStateDocument {
  const ownedTrucks = [starterTruckRecord()];
  const base: Omit<ServerStateDocument, 'leaderboardScore'> = {
    ownerUid: uid,
    cash: SERVER_DEFAULT_CASH,
    ownedTruckIds: ownedTrucks.map((truck) => truck.truckId),
    ownedTrailerIds: [],
    ownedTrucks,
    warehouses: defaultWarehouses(),
    companyLevel: SERVER_DEFAULT_COMPANY_LEVEL,
    reputation: SERVER_DEFAULT_REPUTATION,
    completedDeliveries: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
    companyName: 'LogistiCore Lojistik',
    schemaVersion: SERVER_STATE_SCHEMA_VERSION,
    initialized: true,
    migrationCompleted: false,
    migrationSource: 'default',
    sourceVersion: 1,
    suspiciousFlags: [],
    updatedAt: now,
    createdAt: now,
  };
  return {
    ...base,
    leaderboardScore: recalculateLeaderboardScore(base),
  };
}

export function buildServerStateFromMarketplaceState(
  uid: string,
  marketplaceState: MarketplacePlayerState,
  now: Timestamp,
): ServerStateDocument {
  const ownedTrucks: ServerOwnedTruckRecord[] = marketplaceState.ownedTruckSnapshots
    .filter((truck) => truck.ownershipType === 'owned')
    .map((truck) => ({
      truckId: truck.truckId,
      templateId: truck.templateId,
      ...(truck.customName ? { customName: truck.customName } : {}),
      currentCityId: truck.currentCityId,
      condition: truck.condition,
      totalMileageKm: truck.totalMileageKm,
      currentFuelL: truck.currentFuelL,
      fuelTankCapacityL: truck.fuelTankCapacityL,
      purchasePrice: truck.purchasePrice,
      ownershipType: 'owned' as const,
      status: truck.status,
      assignedDriverId: truck.assignedDriverId ?? null,
      attachedTrailerId: truck.attachedTrailerId ?? null,
      activeJobIds: truck.activeJobIds ?? [],
      marketplaceListingId: truck.marketplaceListingId ?? null,
      upgrades: truck.upgrades ?? {
        engine: 0,
        fuelEfficiency: 0,
        cargo: 0,
        durability: 0,
      },
    }));
  const base: Omit<ServerStateDocument, 'leaderboardScore'> = {
    ownerUid: uid,
    cash: Math.max(0, finite(marketplaceState.canonicalCash)),
    ownedTruckIds: ownedTrucks.map((truck) => truck.truckId),
    ownedTrailerIds: [],
    ownedTrucks,
    warehouses: defaultWarehouses(),
    companyLevel: SERVER_DEFAULT_COMPANY_LEVEL,
    reputation: SERVER_DEFAULT_REPUTATION,
    completedDeliveries: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
    companyName: 'LogistiCore Lojistik',
    schemaVersion: SERVER_STATE_SCHEMA_VERSION,
    initialized: true,
    migrationCompleted: true,
    migrationSource: 'marketplace',
    sourceVersion: Math.max(1, Math.floor(finite(marketplaceState.sourceSaveVersion, 1))),
    suspiciousFlags: [],
    updatedAt: now,
    createdAt: marketplaceState.migratedAt ?? now,
  };
  return {
    ...base,
    leaderboardScore: recalculateLeaderboardScore(base),
  };
}

function parseBoundedTrucksFromSave(
  rawTrucks: unknown[],
  homeCityId: string,
): { trucks: ServerOwnedTruckRecord[]; flags: string[]; rejected: number } {
  const flags: string[] = [];
  let rejected = 0;
  const trucks: ServerOwnedTruckRecord[] = [];
  const seenIds = new Set<string>();

  for (const rawValue of rawTrucks.slice(0, LEGACY_MIGRATION_BOUNDS.maxTrucks)) {
    const truck = record(rawValue);
    const truckId = typeof truck.id === 'string' ? truck.id : '';
    const templateId =
      typeof truck.catalogId === 'string' ? truck.catalogId : truckId;
    if (!truckId || seenIds.has(truckId)) {
      rejected += 1;
      continue;
    }
    const catalog = CANONICAL_TRUCK_MARKET_CATALOG.find(
      (item) => item.templateId === templateId,
    );
    if (
      !catalog ||
      truck.ownershipType === 'leased' ||
      truck.leaseExpired === true
    ) {
      rejected += 1;
      continue;
    }
    seenIds.add(truckId);
    const fuelTankCapacityL = resolveTankCapacity(truck);
    const rawUpgrades = record(truck.upgrades);
    trucks.push({
      truckId,
      templateId,
      ...(typeof truck.name === 'string' ? { customName: truck.name } : {}),
      currentCityId:
        typeof truck.currentCityId === 'string' ? truck.currentCityId : homeCityId,
      condition: clamp(finite(truck.condition, 100), 0, 100),
      totalMileageKm: Math.max(0, finite(truck.totalMileageKm)),
      currentFuelL: clamp(
        finite(truck.currentFuelL, fuelTankCapacityL),
        0,
        fuelTankCapacityL,
      ),
      fuelTankCapacityL,
      purchasePrice: catalog.purchasePrice,
      ownershipType: 'owned',
      status: 'idle',
      assignedDriverId: null,
      attachedTrailerId: null,
      activeJobIds: [],
      marketplaceListingId: null,
      upgrades: {
        engine: clamp(finite(rawUpgrades.engine), 0, 3),
        fuelEfficiency: clamp(finite(rawUpgrades.fuelEfficiency), 0, 3),
        cargo: clamp(finite(rawUpgrades.cargo), 0, 3),
        durability: clamp(finite(rawUpgrades.durability), 0, 3),
      },
    });
  }

  if (trucks.length === 0) {
    trucks.push(starterTruckRecord());
    flags.push('fallback-starter-truck');
  }
  if (rejected > 0) {
    flags.push(`rejected-trucks:${rejected}`);
  }
  return { trucks, flags, rejected };
}

function parseBoundedWarehousesFromSave(rawWarehouses: unknown[]): ServerOwnedWarehouseSnapshot[] {
  const warehouses: ServerOwnedWarehouseSnapshot[] = [];
  for (const raw of rawWarehouses.slice(0, LEGACY_MIGRATION_BOUNDS.maxWarehouses)) {
    const warehouse = record(raw);
    const id = typeof warehouse.id === 'string' ? warehouse.id : '';
    const cityId = typeof warehouse.cityId === 'string' ? warehouse.cityId : '';
    if (!id || !cityId) continue;
    warehouses.push({
      id,
      cityId,
      capacityTons: clamp(finite(warehouse.capacityTons, 100), 0, 10_000),
      upgradeTier: clamp(finite(warehouse.upgradeTier, 1), 1, 5),
    });
  }
  return warehouses.length > 0 ? warehouses : defaultWarehouses();
}

export function buildBoundedLegacyMigrationFromCloudSave(
  uid: string,
  save: DocumentData,
  now: Timestamp,
): { state: ServerStateDocument; report: LegacyMigrationReport } {
  const gameState = record(save.gameState);
  const player = record(gameState.player);
  const homeCityId =
    typeof player.homeCityId === 'string' ? player.homeCityId : 'izmir';
  const rawCash = finite(player.money, SERVER_DEFAULT_CASH);
  const cash = clamp(rawCash, 0, LEGACY_MIGRATION_BOUNDS.maxCash);
  const flags: string[] = [];
  if (rawCash > LEGACY_MIGRATION_BOUNDS.suspiciousCash) {
    flags.push('suspicious-cash');
  }
  if (rawCash !== cash) {
    flags.push('cash-clamped');
  }

  const companyLevel = clamp(
    Math.floor(finite(player.level, finite(player.companyLevel, 1))),
    1,
    LEGACY_MIGRATION_BOUNDS.maxLevel,
  );
  const reputation = clamp(
    finite(player.reputation, SERVER_DEFAULT_REPUTATION),
    0,
    LEGACY_MIGRATION_BOUNDS.maxReputation,
  );
  const completedDeliveries = clamp(
    Math.floor(finite(player.completedContracts)),
    0,
    LEGACY_MIGRATION_BOUNDS.maxCompletedDeliveries,
  );

  const truckParse = parseBoundedTrucksFromSave(array(player.trucks), homeCityId);
  flags.push(...truckParse.flags);

  const companyNameRaw =
    typeof player.companyName === 'string' ? player.companyName.trim() : '';
  const sourceVersion = Math.max(
    1,
    Math.floor(finite(save.saveVersion, finite(record(gameState.meta).saveVersion, 1))),
  );

  const base: Omit<ServerStateDocument, 'leaderboardScore'> = {
    ownerUid: uid,
    cash,
    ownedTruckIds: truckParse.trucks.map((truck) => truck.truckId),
    ownedTrailerIds: [],
    ownedTrucks: truckParse.trucks,
    warehouses: parseBoundedWarehousesFromSave(array(player.warehouses)),
    companyLevel,
    reputation,
    completedDeliveries,
    failedDeliveries: Math.max(0, Math.floor(finite(player.failedDeliveries))),
    lateDeliveries: Math.max(0, Math.floor(finite(player.lateDeliveries))),
    companyName:
      companyNameRaw.length > 0
        ? companyNameRaw.slice(0, 48)
        : 'LogistiCore Lojistik',
    schemaVersion: SERVER_STATE_SCHEMA_VERSION,
    initialized: true,
    migrationCompleted: true,
    migrationSource: 'legacy-save',
    sourceVersion,
    suspiciousFlags: flags,
    updatedAt: now,
    createdAt: now,
  };

  return {
    state: {
      ...base,
      leaderboardScore: recalculateLeaderboardScore(base),
    },
    report: {
      uid,
      dryRun: false,
      migrated: true,
      rejected: truckParse.rejected > 0,
      suspicious: flags.includes('suspicious-cash'),
      flags,
      cashBefore: rawCash,
      cashAfter: cash,
      truckCountBefore: array(player.trucks).length,
      truckCountAfter: truckParse.trucks.length,
    },
  };
}

function readCloudSaveSourceVersion(save: DocumentData, gameState: Record<string, unknown>): number {
  return Math.max(
    1,
    Math.floor(finite(save.saveVersion, finite(record(gameState.meta).saveVersion, 1))),
  );
}

export type MergeLeaderboardStatsOptions = {
  /** Marketplace filo/nakit otoritesini koru; yalnızca teslimat/itibar alanlarını güncelle. */
  preserveAuthoritativeFleet?: boolean;
};

/**
 * Cloud save'deki güncel ilerleme istatistiklerini serverState'e yansıtır.
 * Liderlik submit/seed skoru bu belgeye dayanır; migration sonrası stale kalmasın diye.
 */
export function mergeLeaderboardStatsFromCloudSave(
  uid: string,
  existing: ServerStateDocument,
  save: DocumentData,
  now: Timestamp,
  options?: MergeLeaderboardStatsOptions,
): ServerStateDocument {
  const gameState = record(save.gameState);
  const player = record(gameState.player);
  const homeCityId =
    typeof player.homeCityId === 'string' ? player.homeCityId : 'izmir';

  const companyLevel = clamp(
    Math.floor(finite(player.level, finite(player.companyLevel, existing.companyLevel))),
    1,
    LEGACY_MIGRATION_BOUNDS.maxLevel,
  );
  const reputation = clamp(
    finite(player.reputation, existing.reputation),
    0,
    LEGACY_MIGRATION_BOUNDS.maxReputation,
  );
  const completedDeliveries = clamp(
    Math.floor(finite(player.completedContracts, existing.completedDeliveries)),
    0,
    LEGACY_MIGRATION_BOUNDS.maxCompletedDeliveries,
  );
  const failedDeliveries = clamp(
    Math.floor(finite(player.failedDeliveries, existing.failedDeliveries)),
    0,
    LEGACY_MIGRATION_BOUNDS.maxCompletedDeliveries,
  );
  const lateDeliveries = clamp(
    Math.floor(finite(player.lateDeliveries, existing.lateDeliveries)),
    0,
    LEGACY_MIGRATION_BOUNDS.maxCompletedDeliveries,
  );
  const companyNameRaw =
    typeof player.companyName === 'string' ? player.companyName.trim() : '';
  const companyName =
    companyNameRaw.length > 0
      ? companyNameRaw.slice(0, 48)
      : existing.companyName;
  const sourceVersion = Math.max(
    existing.sourceVersion,
    readCloudSaveSourceVersion(save, gameState),
  );

  let ownedTrucks = existing.ownedTrucks;
  let ownedTruckIds = existing.ownedTruckIds;
  let warehouses = existing.warehouses;
  if (!options?.preserveAuthoritativeFleet) {
    const truckParse = parseBoundedTrucksFromSave(array(player.trucks), homeCityId);
    ownedTrucks = truckParse.trucks;
    ownedTruckIds = ownedTrucks.map((truck) => truck.truckId);
    warehouses = parseBoundedWarehousesFromSave(array(player.warehouses));
  }

  const base: Omit<ServerStateDocument, 'leaderboardScore'> = {
    ...existing,
    ownerUid: uid,
    companyLevel,
    reputation,
    completedDeliveries,
    failedDeliveries,
    lateDeliveries,
    companyName,
    sourceVersion,
    ownedTrucks,
    ownedTruckIds,
    warehouses,
    updatedAt: now,
  };

  return {
    ...base,
    leaderboardScore: recalculateLeaderboardScore(base),
  };
}

export function pickLeaderboardServerStatePersistPatch(
  state: ServerStateDocument,
): Partial<ServerStateDocument> {
  return {
    companyLevel: state.companyLevel,
    reputation: state.reputation,
    completedDeliveries: state.completedDeliveries,
    failedDeliveries: state.failedDeliveries,
    lateDeliveries: state.lateDeliveries,
    companyName: state.companyName,
    sourceVersion: state.sourceVersion,
    ownedTrucks: state.ownedTrucks,
    ownedTruckIds: state.ownedTruckIds,
    warehouses: state.warehouses,
    leaderboardScore: state.leaderboardScore,
    updatedAt: state.updatedAt,
  };
}

export function cloudSaveRef(firestore: Firestore, uid: string) {
  return firestore.doc(`users/${uid}/saves/current`);
}

export function mirrorServerStateFromMarketplace(
  marketplaceState: MarketplacePlayerState,
  existing: ServerStateDocument | null,
  now: Timestamp,
): Partial<ServerStateDocument> {
  const ownedTrucks: ServerOwnedTruckRecord[] = marketplaceState.ownedTruckSnapshots
    .filter((truck) => truck.ownershipType === 'owned')
    .map((truck) => ({
      truckId: truck.truckId,
      templateId: truck.templateId,
      ...(truck.customName ? { customName: truck.customName } : {}),
      currentCityId: truck.currentCityId,
      condition: truck.condition,
      totalMileageKm: truck.totalMileageKm,
      currentFuelL: truck.currentFuelL,
      fuelTankCapacityL: truck.fuelTankCapacityL,
      purchasePrice: truck.purchasePrice,
      ownershipType: 'owned' as const,
      status: truck.status,
      assignedDriverId: truck.assignedDriverId ?? null,
      attachedTrailerId: truck.attachedTrailerId ?? null,
      activeJobIds: truck.activeJobIds ?? [],
      marketplaceListingId: truck.marketplaceListingId ?? null,
      upgrades: truck.upgrades ?? {
        engine: 0,
        fuelEfficiency: 0,
        cargo: 0,
        durability: 0,
      },
    }));

  const merged: ServerStateDocument = {
    ...(existing ??
      buildDefaultServerState(marketplaceState.ownerUid, now)),
    cash: Math.max(0, finite(marketplaceState.canonicalCash)),
    ownedTruckIds: ownedTrucks.map((truck) => truck.truckId),
    ownedTrucks,
    sourceVersion: Math.max(
      existing?.sourceVersion ?? 1,
      Math.floor(finite(marketplaceState.sourceSaveVersion, 1)),
    ),
    initialized: true,
    updatedAt: now,
  };
  return {
    cash: merged.cash,
    ownedTruckIds: merged.ownedTruckIds,
    ownedTrucks: merged.ownedTrucks,
    sourceVersion: merged.sourceVersion,
    leaderboardScore: recalculateLeaderboardScore(merged),
    updatedAt: now,
  };
}

export type EnsureServerStateResult =
  | { ok: true; state: ServerStateDocument; created: boolean }
  | { ok: false; reason: ServerStateFailureReason };

/**
 * Transaction içinde server-owned canonical state oluşturur veya mevcut olanı döner.
 * Cloud save okunmaz; mevcut marketplaceState varsa korunur.
 */
export async function ensureServerStateInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  nowMs: number,
): Promise<EnsureServerStateResult> {
  const ref = serverStateRef(firestore, uid);
  const snap = await transaction.get(ref);
  if (snap.exists) {
    const state = snap.data() as ServerStateDocument;
    if (state.ownerUid === uid && state.initialized) {
      return { ok: true, state, created: false };
    }
    return { ok: false, reason: 'server-state-conflict' };
  }

  const now = Timestamp.fromMillis(nowMs);
  const marketplaceSnap = await transaction.get(
    firestore.doc(`users/${uid}/marketplaceState/current`),
  );
  let state: ServerStateDocument;
  if (marketplaceSnap.exists) {
    state = buildServerStateFromMarketplaceState(
      uid,
      marketplaceSnap.data() as MarketplacePlayerState,
      now,
    );
  } else {
    state = buildDefaultServerState(uid, now);
  }
  transaction.create(ref, state);
  return { ok: true, state, created: true };
}

export function validateServerState(
  uid: string,
  state: ServerStateDocument,
): ServerStateFailureReason | null {
  if (state.ownerUid !== uid) return 'server-state-conflict';
  if (!state.initialized || state.schemaVersion < SERVER_STATE_SCHEMA_VERSION) {
    return 'server-state-not-initialized';
  }
  if (
    !Number.isFinite(state.cash) ||
    !Array.isArray(state.ownedTrucks) ||
    state.ownedTruckIds.length !== new Set(state.ownedTruckIds).size
  ) {
    return 'invalid-player-state';
  }
  return null;
}

export async function migrateLegacyServerStateTransaction(
  firestore: Firestore,
  uid: string,
  dryRun: boolean,
  nowMs = Date.now(),
): Promise<
  | { ok: true; report: LegacyMigrationReport; state?: ServerStateDocument }
  | { ok: false; reason: ServerStateFailureReason; report?: LegacyMigrationReport }
> {
  const now = Timestamp.fromMillis(nowMs);
  const ref = serverStateRef(firestore, uid);

  return firestore.runTransaction(async (transaction) => {
    const existingSnap = await transaction.get(ref);
    if (existingSnap.exists) {
      const existing = existingSnap.data() as ServerStateDocument;
      if (existing.migrationCompleted) {
        return {
          ok: false,
          reason: 'migration-already-completed',
          report: {
            uid,
            dryRun,
            migrated: false,
            rejected: false,
            suspicious: existing.suspiciousFlags.length > 0,
            flags: [...existing.suspiciousFlags, 'already-migrated'],
            reason: 'migration-already-completed',
          },
        };
      }
    }

    const marketplaceSnap = await transaction.get(
      firestore.doc(`users/${uid}/marketplaceState/current`),
    );
    if (marketplaceSnap.exists) {
      const state = buildServerStateFromMarketplaceState(
        uid,
        marketplaceSnap.data() as MarketplacePlayerState,
        now,
      );
      const report: LegacyMigrationReport = {
        uid,
        dryRun,
        migrated: !dryRun,
        rejected: false,
        suspicious: false,
        flags: ['preserved-marketplace-canonical'],
        cashAfter: state.cash,
        truckCountAfter: state.ownedTrucks.length,
      };
      if (!dryRun) {
        if (existingSnap.exists) {
          transaction.set(ref, state, { merge: true });
        } else {
          transaction.create(ref, state);
        }
      }
      return dryRun ? { ok: true, report } : { ok: true, report, state };
    }

    const saveSnap = await transaction.get(
      firestore.doc(`users/${uid}/saves/current`),
    );
    if (!saveSnap.exists) {
      return {
        ok: false,
        reason: 'save-not-found',
        report: {
          uid,
          dryRun,
          migrated: false,
          rejected: true,
          suspicious: false,
          flags: ['save-not-found'],
          reason: 'save-not-found',
        },
      };
    }

    const built = buildBoundedLegacyMigrationFromCloudSave(
      uid,
      saveSnap.data() ?? {},
      now,
    );
    const marketplaceBuilt = buildMarketplaceStateFromCloudSave(
      uid,
      saveSnap.data() ?? {},
      now,
    );
    const report = { ...built.report, dryRun, migrated: !dryRun };
    if (!dryRun) {
      if (marketplaceBuilt.ok) {
        const marketplaceRef = firestore.doc(`users/${uid}/marketplaceState/current`);
        const nextMarketplace = marketplaceSnap.exists
          ? mergeCloudFleetIntoExistingMarketplaceState(
              marketplaceSnap.data() as MarketplacePlayerState,
              marketplaceBuilt.state,
              now,
            )
          : marketplaceBuilt.state;
        if (marketplaceSnap.exists) {
          transaction.set(marketplaceRef, nextMarketplace, { merge: true });
        } else {
          transaction.create(marketplaceRef, nextMarketplace);
        }
      }
      if (existingSnap.exists) {
        transaction.set(ref, built.state, { merge: true });
      } else {
        transaction.create(ref, built.state);
      }
    }
    return dryRun ? { ok: true, report } : { ok: true, report, state: built.state };
  });
}

export function getServerDefaultFleetLimit(): number {
  return VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceDefaultFleetLimit;
}
