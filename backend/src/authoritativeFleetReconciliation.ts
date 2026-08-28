import { createHash } from 'node:crypto';

import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import {
  buildServerStateFromMarketplaceState,
  mirrorServerStateFromMarketplace,
  serverStateRef,
} from './serverState';
import type { ServerStateDocument } from './serverStateTypes';
import { resolveStaleCloudMarketplaceOverwrite } from '../../src/domain/vehicleMarketplaceCloudMerge';
import {
  buildMarketplaceStateFromCloudSave,
} from './vehicleMarketplaceState';
import type {
  MarketplaceFailureReason,
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from './vehicleMarketplaceTypes';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampToMillis(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return finite(value);
}

function cloudSaveDeviceUpdatedAt(save: Record<string, unknown>): number {
  const gameState = record(save.gameState);
  const meta = record(gameState.meta);
  return Math.max(
    timestampToMillis(save.deviceUpdatedAt),
    timestampToMillis(meta.savedAt),
    timestampToMillis(save.updatedAt),
  );
}

function fleetIdSet(state: MarketplacePlayerState): Set<string> {
  return new Set(state.ownedTruckSnapshots.map((truck) => truck.truckId));
}

export function mergeCloudFleetIntoExistingMarketplaceState(
  existing: MarketplacePlayerState,
  fromCloud: MarketplacePlayerState,
  now: Timestamp,
  options?: { requestedVehicleId?: string },
): MarketplacePlayerState {
  const tombstones = new Set(existing.soldTruckTombstones ?? []);
  const mergedSnapshots: MarketplaceVehicleRecord[] = [...existing.ownedTruckSnapshots];
  const mergedIds = new Set(mergedSnapshots.map((truck) => truck.truckId));

  const requestedVehicleId = options?.requestedVehicleId;
  if (
    requestedVehicleId &&
    !mergedIds.has(requestedVehicleId) &&
    !tombstones.has(requestedVehicleId)
  ) {
    const cloudTruck = fromCloud.ownedTruckSnapshots.find(
      (truck) => truck.truckId === requestedVehicleId,
    );
    if (cloudTruck) {
      mergedSnapshots.push(cloudTruck);
      mergedIds.add(cloudTruck.truckId);
    }
  }

  const overwrite = resolveStaleCloudMarketplaceOverwrite({
    existingCash: existing.canonicalCash,
    cloudCash: fromCloud.canonicalCash,
    existingVehicleIds: existing.ownedTruckSnapshots.map((truck) => truck.truckId),
    cloudVehicleIds: fromCloud.ownedTruckSnapshots.map((truck) => truck.truckId),
    soldTruckIds: existing.soldTruckTombstones ?? [],
    existingMarketplaceStateVersion: existing.stateVersion,
    cloudSourceSaveVersion: fromCloud.sourceSaveVersion,
  });

  if (overwrite.keptMarketplaceMutation) {
    console.info('[MARKETPLACE_CLOUD_MERGE] kept marketplace mutation', {
      rejectedStaleCashRestore: overwrite.rejectedStaleCashRestore,
      rejectedStaleVehicleRemoval: overwrite.rejectedStaleVehicleRemoval,
      existingCash: existing.canonicalCash,
      cloudCash: fromCloud.canonicalCash,
    });
  }

  return {
    ...existing,
    ownerUid: fromCloud.ownerUid,
    canonicalCash: existing.canonicalCash,
    ownedTruckSnapshots: mergedSnapshots,
    activeListingIds: existing.activeListingIds ?? [],
    soldTruckTombstones: existing.soldTruckTombstones ?? [],
    sourceSaveVersion: Math.max(
      existing.sourceSaveVersion,
      fromCloud.sourceSaveVersion,
    ),
    stateVersion: existing.stateVersion + 1,
    updatedAt: now,
  };
}

export function shouldReconcileFleetFromCloud(
  existing: MarketplacePlayerState | null,
  cloudBuilt: MarketplacePlayerState,
  _cloudDeviceUpdatedAt: number,
  options?: { requestedVehicleId?: string; force?: boolean },
): boolean {
  if (!existing) return false;

  const tombstones = new Set(existing.soldTruckTombstones ?? []);
  const cloudIds = fleetIdSet(cloudBuilt);
  const existingIds = fleetIdSet(existing);

  if ([...cloudIds].some((id) => tombstones.has(id))) {
    return false;
  }

  for (const id of existingIds) {
    if (!cloudIds.has(id) && !tombstones.has(id)) {
      return false;
    }
  }

  if (tombstones.size > 0 && existing.canonicalCash > cloudBuilt.canonicalCash + 1e-9) {
    return false;
  }

  const requestedVehicleId = options?.requestedVehicleId;
  if (requestedVehicleId) {
    if (tombstones.has(requestedVehicleId)) return false;
    if (!existingIds.has(requestedVehicleId)) {
      return cloudBuilt.ownedTruckSnapshots.some(
        (truck) => truck.truckId === requestedVehicleId,
      );
    }
  }

  if (options?.force) {
    return Boolean(
      requestedVehicleId &&
        !existingIds.has(requestedVehicleId) &&
        cloudBuilt.ownedTruckSnapshots.some(
          (truck) => truck.truckId === requestedVehicleId,
        ),
    );
  }

  return false;
}

export type FleetReconcileResult =
  | {
      ok: true;
      state: MarketplacePlayerState;
      reconciled: boolean;
      serverState: ServerStateDocument;
    }
  | { ok: false; reason: MarketplaceFailureReason };

export async function reconcileAuthoritativeFleetInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: {
    existing?: MarketplacePlayerState | null;
    requestedVehicleId?: string;
    force?: boolean;
    write?: boolean;
  },
): Promise<FleetReconcileResult> {
  const now = Timestamp.fromMillis(nowMs);
  const saveSnap = await transaction.get(
    firestore.doc(`users/${uid}/saves/current`),
  );
  if (!saveSnap.exists) {
    return { ok: false, reason: 'marketplace-state-missing' };
  }

  const saveData = record(saveSnap.data());
  if (typeof saveData.ownerUid === 'string' && saveData.ownerUid !== uid) {
    return { ok: false, reason: 'not-owner' };
  }

  const built = buildMarketplaceStateFromCloudSave(uid, saveData, now);
  if (!built.ok) {
    return { ok: false, reason: built.reason };
  }

  const playerRef = firestore.doc(`users/${uid}/marketplaceState/current`);
  const marketplaceSnap = await transaction.get(playerRef);
  const existing =
    options?.existing ??
    (marketplaceSnap.exists
      ? (marketplaceSnap.data() as MarketplacePlayerState)
      : null);

  if (!existing) {
    return { ok: false, reason: 'marketplace-state-missing' };
  }

  const cloudUpdatedAt = cloudSaveDeviceUpdatedAt(saveData);
  const needsReconcile = shouldReconcileFleetFromCloud(
    existing,
    built.state,
    cloudUpdatedAt,
    options,
  );

  const serverRef = serverStateRef(firestore, uid);
  const serverSnap = await transaction.get(serverRef);
  const existingServer = serverSnap.exists
    ? (serverSnap.data() as ServerStateDocument)
    : null;

  if (!needsReconcile) {
    const serverState =
      existingServer ??
      buildServerStateFromMarketplaceState(uid, existing, now);
    return { ok: true, state: existing, reconciled: false, serverState };
  }

  const merged = mergeCloudFleetIntoExistingMarketplaceState(
    existing,
    built.state,
    now,
    { requestedVehicleId: options?.requestedVehicleId },
  );

  if (options?.write !== false) {
    transaction.set(playerRef, merged, { merge: true });
    const serverPatch = mirrorServerStateFromMarketplace(
      merged,
      existingServer,
      now,
    );
    if (existingServer) {
      transaction.set(serverRef, {
        ...serverPatch,
        ownerUid: uid,
        migrationCompleted: true,
        migrationSource: 'cloud-save-reconcile',
      }, { merge: true });
    } else {
      const fullServer = buildServerStateFromMarketplaceState(uid, merged, now);
      transaction.set(
        serverRef,
        {
          ...fullServer,
          ...serverPatch,
          migrationCompleted: true,
          migrationSource: 'cloud-save-reconcile',
        },
        { merge: true },
      );
    }
  }

  const serverState = {
    ...(existingServer ?? buildServerStateFromMarketplaceState(uid, merged, now)),
    ...mirrorServerStateFromMarketplace(merged, existingServer, now),
    ownerUid: uid,
    migrationCompleted: true,
  } as ServerStateDocument;

  console.info('[MARKETPLACE_FLEET_RECONCILE]', {
    uidHash: createHash('sha256').update(uid).digest('hex').slice(0, 12),
    reconciled: true,
    requestedVehicleId: options?.requestedVehicleId ?? null,
    cloudTruckIds: built.state.ownedTruckSnapshots.map((truck) => truck.truckId),
    mergedTruckIds: merged.ownedTruckSnapshots.map((truck) => truck.truckId),
    cloudDeviceUpdatedAt: cloudUpdatedAt,
    cloudSourceSaveVersion: built.state.sourceSaveVersion,
    previousSourceSaveVersion: existing?.sourceSaveVersion ?? null,
  });

  return { ok: true, state: merged, reconciled: true, serverState };
}

export async function reconcileAuthoritativeFleetTransaction(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
  options?: {
    requestedVehicleId?: string;
    force?: boolean;
  },
): Promise<FleetReconcileResult> {
  return firestore.runTransaction(async (transaction) =>
    reconcileAuthoritativeFleetInTransaction(
      transaction,
      firestore,
      uid,
      nowMs,
      { ...options, write: true },
    ),
  );
}
