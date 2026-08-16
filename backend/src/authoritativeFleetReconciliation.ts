import { createHash } from 'node:crypto';

import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import {
  buildServerStateFromMarketplaceState,
  mirrorServerStateFromMarketplace,
  serverStateRef,
} from './serverState';
import type { ServerStateDocument } from './serverStateTypes';
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
): MarketplacePlayerState {
  const tombstones = new Set(existing.soldTruckTombstones ?? []);
  const lockedVehicles = new Map<string, MarketplaceVehicleRecord>();
  for (const vehicle of existing.ownedTruckSnapshots) {
    if (vehicle.marketplaceListingId || vehicle.status === 'marketplace_locked') {
      lockedVehicles.set(vehicle.truckId, vehicle);
    }
  }

  const mergedSnapshots: MarketplaceVehicleRecord[] = [];
  for (const cloudTruck of fromCloud.ownedTruckSnapshots) {
    if (tombstones.has(cloudTruck.truckId)) continue;
    const locked = lockedVehicles.get(cloudTruck.truckId);
    mergedSnapshots.push(
      locked
        ? {
            ...cloudTruck,
            status: locked.status,
            marketplaceListingId: locked.marketplaceListingId ?? null,
            assignedDriverId: locked.assignedDriverId ?? cloudTruck.assignedDriverId ?? null,
            attachedTrailerId: locked.attachedTrailerId ?? cloudTruck.attachedTrailerId ?? null,
            activeJobIds: locked.activeJobIds ?? cloudTruck.activeJobIds ?? [],
          }
        : cloudTruck,
    );
    lockedVehicles.delete(cloudTruck.truckId);
  }

  for (const locked of lockedVehicles.values()) {
    mergedSnapshots.push(locked);
  }

  return {
    ...existing,
    ownerUid: fromCloud.ownerUid,
    canonicalCash: fromCloud.canonicalCash,
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
  cloudDeviceUpdatedAt: number,
  options?: { requestedVehicleId?: string; force?: boolean },
): boolean {
  if (options?.force) return true;
  if (!existing) return true;
  if (
    options?.requestedVehicleId &&
    !fleetIdSet(existing).has(options.requestedVehicleId)
  ) {
    return true;
  }
  const cloudIds = fleetIdSet(cloudBuilt);
  const existingIds = fleetIdSet(existing);
  for (const id of cloudIds) {
    if (!existingIds.has(id)) return true;
  }
  const marketplaceUpdatedAt = timestampToMillis(existing.updatedAt);
  if (cloudDeviceUpdatedAt > marketplaceUpdatedAt + 1_000) return true;
  if (cloudBuilt.sourceSaveVersion > existing.sourceSaveVersion) return true;
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

  if (!needsReconcile && existing) {
    const serverState =
      existingServer ??
      buildServerStateFromMarketplaceState(uid, existing, now);
    return { ok: true, state: existing, reconciled: false, serverState };
  }

  const merged = existing
    ? mergeCloudFleetIntoExistingMarketplaceState(existing, built.state, now)
    : built.state;

  if (options?.write !== false) {
    if (existing) {
      transaction.set(playerRef, merged, { merge: true });
    } else {
      transaction.create(playerRef, merged);
    }
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
