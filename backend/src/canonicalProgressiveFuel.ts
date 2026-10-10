/**
 * Canonical progressive ROAD fuel application (Step 29X).
 * INTERNAL_TEST. Fuel burn does not move cash.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { CANONICAL_ROAD_DELIVERIES_COLLECTION } from '../../src/domain/canonicalRoadDelivery';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION,
  hasOnlyCanonicalProgressiveAdvanceKeys,
  isCanonicalProgressiveFuelAllowed,
  isSupportedCanonicalGameSpeed,
  setCanonicalProgressiveGameSpeed,
  setCanonicalProgressivePaused,
  settleCanonicalProgressiveFuelState,
  type CanonicalProgressiveFuelState,
} from '../../src/domain/canonicalProgressiveFuel';
import { isAuthenticatedUid } from './canonicalCashTransaction';
import { readEnabledCanonicalFleetRuntime } from './canonicalFleetRuntime';
import {
  isCanonicalFleetRuntimeAllowed,
  planCanonicalFleetRuntimeTransition,
} from '../../src/domain/canonicalFleetRuntimeLocation';

type DeliveryFuelCarrier = {
  ownerUid: string;
  lifecycleState: string;
  progressiveFuel?: CanonicalProgressiveFuelState | null;
  executionEconomicsSnapshot?: { truckEconomicProfile: { truckId: string } } | null;
};

export { hasOnlyCanonicalProgressiveAdvanceKeys };

function deliveryPath(uid: string, deliveryId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_DELIVERIES_COLLECTION}/${deliveryId}`;
}

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

type FuelApplyResult =
  | {
      ok: true;
      state: CanonicalProgressiveFuelState;
      currentFuelL: number;
      fuelRevision: number;
      changed: boolean;
    }
  | { ok: false; reason: string };

export async function applyCanonicalProgressiveFuelInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  delivery: DeliveryFuelCarrier,
  nowMs: number,
  mutation?:
    | { kind: 'speed'; gameSpeed: number }
    | { kind: 'pause'; paused: boolean },
): Promise<FuelApplyResult> {
  const state = delivery.progressiveFuel;
  if (!state || state.schemaVersion !== CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION) {
    return { ok: false, reason: 'PROGRESSIVE_FUEL_STATE_MISSING' };
  }
  if (state.fuelPolicyVersion !== 'canonical-road-progressive-fuel-v1') {
    return { ok: false, reason: 'UNSUPPORTED_FUEL_POLICY' };
  }
  const truckId = delivery.executionEconomicsSnapshot?.truckEconomicProfile.truckId;
  if (!truckId) return { ok: false, reason: 'CANONICAL_TRUCK_MISSING' };
  const truckRef = firestore.doc(assetPath(uid, truckId));
  const truckSnap = await transaction.get(truckRef);
  if (!truckSnap.exists) return { ok: false, reason: 'CANONICAL_TRUCK_MISSING' };
  const truck = truckSnap.data() as {
    ownerUid?: string;
    currentFuelL?: number;
    fuelRevision?: number;
    fuelCapacityL?: number;
  };
  if (truck.ownerUid !== uid) return { ok: false, reason: 'CANONICAL_TRUCK_NOT_OWNED' };
  const tank = truck.currentFuelL ?? state.fuelLitersAtStart;
  let nextState = state;
  let nextFuel = tank;
  if (mutation?.kind === 'speed') {
    const sped = setCanonicalProgressiveGameSpeed(state, mutation.gameSpeed, nowMs, tank);
    if (!sped.ok) return sped;
    nextState = sped.state;
    nextFuel = sped.currentFuelL;
  } else if (mutation?.kind === 'pause') {
    const paused = setCanonicalProgressivePaused(state, mutation.paused, nowMs, tank);
    if (!paused.ok) return paused;
    nextState = paused.state;
    nextFuel = paused.currentFuelL;
  } else {
    const settled = settleCanonicalProgressiveFuelState(state, nowMs, tank);
    nextState = settled.state;
    nextFuel = settled.currentFuelL;
  }
  const fuelChanged = Math.abs(nextFuel - tank) > 1e-6;
  const fuelRevision = (truck.fuelRevision ?? 1) + (fuelChanged ? 1 : 0);
  if (fuelChanged) {
    transaction.update(truckRef, {
      currentFuelL: nextFuel,
      fuelRevision,
      updatedAtMs: nowMs,
    });
  }
  return { ok: true, state: nextState, currentFuelL: nextFuel, fuelRevision, changed: fuelChanged || nextState.progressRevision !== state.progressRevision };
}

async function applyProgressiveFuelWithRuntime(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  delivery: DeliveryFuelCarrier,
  nowMs: number,
  runtimeEnvValue: string | null | undefined,
  mutation?:
    | { kind: 'speed'; gameSpeed: number }
    | { kind: 'pause'; paused: boolean },
): Promise<FuelApplyResult> {
  const truckId = delivery.executionEconomicsSnapshot?.truckEconomicProfile.truckId ?? null;
  if (isCanonicalFleetRuntimeAllowed({ envValue: runtimeEnvValue }) && !truckId) {
    return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
  }
  const runtime = truckId
    ? await readEnabledCanonicalFleetRuntime(transaction, firestore, uid, truckId, runtimeEnvValue)
    : ({ enabled: false } as const);
  if (runtime.enabled && !runtime.ok) return { ok: false, reason: runtime.reason };
  const applied = await applyCanonicalProgressiveFuelInTransaction(
    transaction,
    firestore,
    uid,
    delivery,
    nowMs,
    mutation,
  );
  if (!applied.ok || !runtime.enabled || !runtime.ok) return applied;
  const nextPause = applied.state.pauseReason;
  const previous = runtime.state.runtimeStatus;
  const kind =
    nextPause === 'OUT_OF_FUEL' && previous === 'on_route'
      ? ('FUEL_OUT' as const)
      : previous === 'out_of_fuel' && nextPause !== 'OUT_OF_FUEL'
        ? ('ROADSIDE_REFUEL_RESUME' as const)
        : null;
  if (!kind) return applied;
  const planned = planCanonicalFleetRuntimeTransition(runtime.state, { kind }, nowMs);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  transaction.set(firestore.doc(runtime.path), { ...planned.state });
  return applied;
}

export async function advanceCanonicalRoadExecutionTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  schemaVersion: number,
  nowMs: number,
  options?: { envValue?: string | null; runtimeEnvValue?: string | null },
): Promise<
  | { ok: true; alreadyApplied: boolean; state: CanonicalProgressiveFuelState; currentFuelL: number }
  | { ok: false; reason: string }
> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressiveFuelAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_PROGRESSIVE_FUEL_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryPath(uid, deliveryId));
    const snap = await transaction.get(dRef);
    if (!snap.exists) return { ok: false as const, reason: 'DELIVERY_NOT_FOUND' };
    const delivery = snap.data() as DeliveryFuelCarrier;
    if (delivery.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (delivery.lifecycleState !== 'ACCEPTED') {
      return { ok: false as const, reason: 'DELIVERY_NOT_ACTIVE' };
    }
    const applied = await applyProgressiveFuelWithRuntime(
      transaction,
      firestore,
      uid,
      delivery,
      nowMs,
      options?.runtimeEnvValue,
    );
    if (!applied.ok) return applied;
    transaction.update(dRef, { progressiveFuel: applied.state });
    return {
      ok: true as const,
      alreadyApplied: !applied.changed,
      state: applied.state,
      currentFuelL: applied.currentFuelL,
    };
  });
}

export async function setCanonicalRoadExecutionSpeedTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  gameSpeed: number,
  schemaVersion: number,
  nowMs: number,
  options?: { envValue?: string | null; runtimeEnvValue?: string | null },
): Promise<{ ok: true; state: CanonicalProgressiveFuelState; currentFuelL: number } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressiveFuelAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_PROGRESSIVE_FUEL_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (!isSupportedCanonicalGameSpeed(gameSpeed)) {
    return { ok: false, reason: 'UNSUPPORTED_GAME_SPEED' };
  }
  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryPath(uid, deliveryId));
    const snap = await transaction.get(dRef);
    if (!snap.exists) return { ok: false as const, reason: 'DELIVERY_NOT_FOUND' };
    const delivery = snap.data() as DeliveryFuelCarrier;
    if (delivery.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (delivery.lifecycleState !== 'ACCEPTED') {
      return { ok: false as const, reason: 'DELIVERY_NOT_ACTIVE' };
    }
    const applied = await applyProgressiveFuelWithRuntime(
      transaction,
      firestore,
      uid,
      delivery,
      nowMs,
      options?.runtimeEnvValue,
      { kind: 'speed', gameSpeed },
    );
    if (!applied.ok) return applied;
    transaction.update(dRef, { progressiveFuel: applied.state });
    return { ok: true as const, state: applied.state, currentFuelL: applied.currentFuelL };
  });
}

export async function setCanonicalRoadExecutionPausedTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  paused: boolean,
  schemaVersion: number,
  nowMs: number,
  options?: { envValue?: string | null; runtimeEnvValue?: string | null },
): Promise<{ ok: true; state: CanonicalProgressiveFuelState; currentFuelL: number } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalProgressiveFuelAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_PROGRESSIVE_FUEL_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryPath(uid, deliveryId));
    const snap = await transaction.get(dRef);
    if (!snap.exists) return { ok: false as const, reason: 'DELIVERY_NOT_FOUND' };
    const delivery = snap.data() as DeliveryFuelCarrier;
    if (delivery.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (delivery.lifecycleState !== 'ACCEPTED') {
      return { ok: false as const, reason: 'DELIVERY_NOT_ACTIVE' };
    }
    const applied = await applyProgressiveFuelWithRuntime(
      transaction,
      firestore,
      uid,
      delivery,
      nowMs,
      options?.runtimeEnvValue,
      { kind: 'pause', paused },
    );
    if (!applied.ok) return applied;
    transaction.update(dRef, { progressiveFuel: applied.state });
    return { ok: true as const, state: applied.state, currentFuelL: applied.currentFuelL };
  });
}
