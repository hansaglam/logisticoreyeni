import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  Timestamp,
  getFirestore,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import {
  CANONICAL_TRUCK_MARKET_CATALOG,
  VEHICLE_MARKETPLACE_BALANCE,
} from '../src/generated/canonicalInputs';
import type {
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from '../src/vehicleMarketplaceTypes';

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 200;
const WRITE_BATCH_LIMIT = 400;
const STATE_VERSION = 1;
const VALID_STATUSES = new Set([
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

interface MigrationReport {
  dryRun: boolean;
  projectId: string;
  scannedUsers: number;
  migratedUsers: number;
  existingStates: number;
  invalidSaves: number;
  duplicateTruckUsers: number;
  unsupportedTrucks: number;
  leasedTrucksSkipped: number;
  reconciliationConflicts: number;
  failures: number;
}

function userHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

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

function projectIdFromFirebaseConfig(): string {
  const configured = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (configured) return configured;
  const firebaseConfig = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', '.firebaserc'), 'utf8'),
  ) as { projects?: { default?: string } };
  const projectId = firebaseConfig.projects?.default;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID_NOT_CONFIGURED');
  return projectId;
}

function prepareFirebaseCliAdcIfNeeded(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return;
  }
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
  };
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken =
    cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) return;
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-adc-'));
  const credentialPath = resolve(directory, 'authorized-user.json');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      type: 'authorized_user',
      client_id: cliApi.clientId(),
      client_secret: cliApi.clientSecret(),
      refresh_token: refreshToken,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.once('exit', () => {
    rmSync(directory, { recursive: true, force: true });
  });
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

function migrateSave(
  uid: string,
  save: DocumentData,
  now: Timestamp,
  report: MigrationReport,
): MarketplacePlayerState | null {
  const gameState = record(save.gameState);
  const player = record(gameState.player);
  const rawTrucks = array(player.trucks);
  const ids = rawTrucks
    .map((item) => record(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length !== new Set(ids).size) {
    report.duplicateTruckUsers += 1;
    console.error('[vehicle-marketplace-migration]', {
      result: 'duplicate-truck-id',
      ownerUidHash: userHash(uid),
      sourceSaveVersion: save.saveVersion ?? null,
    });
    return null;
  }
  const canonicalCash = finite(player.money, Number.NaN);
  if (!Number.isFinite(canonicalCash) || !Array.isArray(player.trucks)) {
    report.invalidSaves += 1;
    console.error('[vehicle-marketplace-migration]', {
      result: 'invalid-save',
      ownerUidHash: userHash(uid),
      sourceSaveVersion: save.saveVersion ?? null,
    });
    return null;
  }

  const drivers = array(player.drivers).map(record);
  const trailers = array(player.trailers).map(record);
  const activeJobs = buildActiveJobs(gameState);
  const ownedTruckSnapshots: MarketplaceVehicleRecord[] = [];
  for (const rawValue of rawTrucks) {
    const truck = record(rawValue);
    const truckId = typeof truck.id === 'string' ? truck.id : '';
    const templateId =
      typeof truck.catalogId === 'string'
        ? truck.catalogId
        : truckId;
    const catalog = CANONICAL_TRUCK_MARKET_CATALOG.find(
      (item) => item.templateId === templateId,
    );
    if (!truckId || !catalog) {
      report.unsupportedTrucks += 1;
      continue;
    }
    if (truck.ownershipType === 'leased' || truck.leaseExpired === true) {
      report.leasedTrucksSkipped += 1;
      continue;
    }
    const fuelTankCapacityL = resolveTankCapacity(truck);
    const currentFuelL = Math.min(
      fuelTankCapacityL,
      Math.max(0, finite(truck.currentFuelL, fuelTankCapacityL)),
    );
    const attachedTrailer = trailers.find(
      (trailer) => trailer.attachedTruckId === truckId,
    );
    const assignedDriver = drivers.find(
      (driver) => driver.assignedTruckId === truckId,
    );
    const rawUpgrades = record(truck.upgrades);
    const status =
      typeof truck.status === 'string' && VALID_STATUSES.has(truck.status)
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
      currentFuelL,
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
    ownerUid: uid,
    canonicalCash,
    fleetLimit:
      VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceDefaultFleetLimit,
    ownedTruckSnapshots,
    activeListingIds: [],
    soldTruckTombstones: [],
    stateVersion: STATE_VERSION,
    migratedAt: now,
    sourceSaveVersion,
    updatedAt: now,
  };
}

function validateExistingState(
  uid: string,
  state: MarketplacePlayerState,
  save: DocumentData,
  report: MigrationReport,
): void {
  const validationReport: MigrationReport = {
    ...report,
    migratedUsers: 0,
    existingStates: 0,
    invalidSaves: 0,
    duplicateTruckUsers: 0,
    unsupportedTrucks: 0,
    leasedTrucksSkipped: 0,
    reconciliationConflicts: 0,
    failures: 0,
  };
  const expected = migrateSave(
    uid,
    save,
    state.migratedAt ?? Timestamp.now(),
    validationReport,
  );
  if (!expected) {
    report.reconciliationConflicts += 1;
    return;
  }
  const tombstones = new Set(state.soldTruckTombstones ?? []);
  const expectedIds = expected.ownedTruckSnapshots
    .map((truck) => truck.truckId)
    .filter((id) => !tombstones.has(id))
    .sort();
  const actualIds = state.ownedTruckSnapshots
    .map((truck) => truck.truckId)
    .sort();
  const statusMismatch =
    (state.activeListingIds?.length ?? 0) === 0 &&
    expected.ownedTruckSnapshots.some((truck) => {
      const actual = state.ownedTruckSnapshots.find(
        (candidate) => candidate.truckId === truck.truckId,
      );
      return actual && actual.status !== truck.status;
    });
  const conflict =
    state.ownerUid !== uid ||
    state.canonicalCash !== expected.canonicalCash ||
    JSON.stringify(actualIds) !== JSON.stringify(expectedIds) ||
    statusMismatch;
  if (conflict) {
    report.reconciliationConflicts += 1;
    console.error('[vehicle-marketplace-reconciliation]', {
      result: 'conflict',
      ownerUidHash: userHash(uid),
      cashMatches: state.canonicalCash === expected.canonicalCash,
      ownershipMatches:
        JSON.stringify(actualIds) === JSON.stringify(expectedIds),
      statusMatches: !statusMismatch,
    });
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const projectId = projectIdFromFirebaseConfig();
  prepareFirebaseCliAdcIfNeeded();
  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      credential: applicationDefault(),
    });
  const firestore = getFirestore(app);
  const report: MigrationReport = {
    dryRun: DRY_RUN,
    projectId,
    scannedUsers: 0,
    migratedUsers: 0,
    existingStates: 0,
    invalidSaves: 0,
    duplicateTruckUsers: 0,
    unsupportedTrucks: 0,
    leasedTrucksSkipped: 0,
    reconciliationConflicts: 0,
    failures: 0,
  };
  let cursor: QueryDocumentSnapshot | undefined;
  const pending: Array<{
    ref: FirebaseFirestore.DocumentReference;
    state: MarketplacePlayerState;
  }> = [];

  do {
    let query = firestore.collection('users').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const users = await query.get();
    if (users.empty) break;
    cursor = users.docs.at(-1);
    for (const user of users.docs) {
      report.scannedUsers += 1;
      try {
        const stateRef = user.ref.collection('marketplaceState').doc('current');
        const [existingState, save] = await Promise.all([
          stateRef.get(),
          user.ref.collection('saves').doc('current').get(),
        ]);
        if (existingState.exists) {
          report.existingStates += 1;
          if (save.exists) {
            validateExistingState(
              user.id,
              existingState.data() as MarketplacePlayerState,
              save.data() ?? {},
              report,
            );
          } else {
            report.reconciliationConflicts += 1;
          }
          continue;
        }
        if (!save.exists) {
          report.invalidSaves += 1;
          console.error('[vehicle-marketplace-migration]', {
            result: 'save-missing',
            ownerUidHash: userHash(user.id),
          });
          continue;
        }
        const state = migrateSave(
          user.id,
          save.data() ?? {},
          Timestamp.now(),
          report,
        );
        if (!state) continue;
        report.migratedUsers += 1;
        console.info('[vehicle-marketplace-migration]', {
          result: DRY_RUN ? 'would-migrate' : 'queued',
          ownerUidHash: userHash(user.id),
          sourceSaveVersion: state.sourceSaveVersion,
          ownedTruckCount: state.ownedTruckSnapshots.length,
        });
        if (!DRY_RUN) pending.push({ ref: stateRef, state });
      } catch (error) {
        report.failures += 1;
        console.error('[vehicle-marketplace-migration]', {
          result: 'user-failed',
          ownerUidHash: userHash(user.id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } while (cursor);

  if (!DRY_RUN) {
    for (let index = 0; index < pending.length; index += WRITE_BATCH_LIMIT) {
      const batch = firestore.batch();
      for (const item of pending.slice(index, index + WRITE_BATCH_LIMIT)) {
        batch.create(item.ref, item.state);
      }
      try {
        await batch.commit();
      } catch (error) {
        report.failures += 1;
        console.error('[vehicle-marketplace-migration]', {
          result: 'batch-failed',
          batchStart: index,
          batchSize: Math.min(WRITE_BATCH_LIMIT, pending.length - index),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.info('[vehicle-marketplace-migration]', {
    ...report,
    durationMs: Date.now() - startedAt,
    result: report.failures === 0 ? 'complete' : 'completed-with-failures',
  });
  if (
    report.failures > 0 ||
    report.duplicateTruckUsers > 0 ||
    report.reconciliationConflicts > 0
  ) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('[vehicle-marketplace-migration]', {
    result: 'fatal',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
