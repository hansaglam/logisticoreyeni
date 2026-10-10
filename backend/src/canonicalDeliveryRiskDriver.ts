/**
 * Step 29AG — canonical driver assignment + accept-time risk snapshot (INTERNAL_TEST).
 * Driver runtime is only mutated inside canonical ROAD accept / complete / cancel transactions.
 * No generic driver-busy endpoint. No cash.
 */

import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_DRIVERS_COLLECTION,
  ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION,
  activeMaintenanceWorldEvents,
  buildInternalTestCanonicalDriverFixture,
  classifyCanonicalDriverForAssignment,
  freezeCanonicalRoadDeliveryRiskSnapshot,
  isCanonicalRoadDriverRiskAllowed,
  isValidCanonicalRoadDriverSnapshot,
  planCanonicalDriverAssign,
  planCanonicalDriverRelease,
  resolveCanonicalAcceptFuelPrice,
  resolveCanonicalContractTypeEconomics,
  type CanonicalDriverRuntimeReleaseReason,
  type CanonicalMaintenanceEventAuthority,
  type CanonicalRoadDeliveryRiskSnapshot,
  type CanonicalRoadDriverSnapshot,
} from '../../src/domain/canonicalDeliveryRiskDriver';
import {
  CANONICAL_ROAD_CONTRACT_EVENTS_DOC,
  isCanonicalContractWorldEventAllowed,
  planCanonicalContractEventAdvance,
  type CanonicalContractEventState,
} from '../../src/domain/canonicalContractWorldEvents';
import { isValidCanonicalRoadDocId } from '../../src/domain/canonicalRoadDelivery';
import {
  isCanonicalRoadInternalFleetBootstrapAllowed,
  type CanonicalFleetAssetDocument,
  freezeExecutionEconomicsFromCanonicalFleet,
} from '../../src/domain/canonicalRoadFleet';
import type { WorldEvent } from '../../src/types/game';

type DriverAware = NonNullable<Parameters<typeof freezeExecutionEconomicsFromCanonicalFleet>[0]['driverAware']>;

export type CanonicalDriverRiskAcceptRead =
  | { enabled: false }
  | { enabled: true; ok: false; reason: string }
  | {
      enabled: true;
      ok: true;
      driverRef: DocumentReference;
      driverDoc: Record<string, unknown>;
      driverSnapshot: CanonicalRoadDriverSnapshot;
      riskSnapshot: CanonicalRoadDeliveryRiskSnapshot;
      driverAware: DriverAware;
      eventRef: DocumentReference;
      eventStateToWrite: CanonicalContractEventState | null;
    };

export function canonicalDriverPath(uid: string, driverId: string): string {
  return `users/${uid}/${CANONICAL_DRIVERS_COLLECTION}/${driverId}`;
}

/** All reads for driver assignment; call before any transaction write. */
export async function readCanonicalDriverRiskForAccept(
  transaction: Transaction,
  firestore: Firestore,
  input: {
    uid: string;
    deliveryId: string;
    selectedDriverId: unknown;
    contract: {
      originCityId: string;
      destinationCityId: string;
      amount: number;
      cargoWeight?: number | null;
      contractType?: unknown;
      recommendedTruckCondition?: unknown;
      requiredDriverLevel?: unknown;
    };
    truckAsset: CanonicalFleetAssetDocument;
    nowMs: number;
    driverRiskEnvValue?: string | null;
    eventEnvValue?: string | null;
  },
): Promise<CanonicalDriverRiskAcceptRead> {
  if (!isCanonicalRoadDriverRiskAllowed({ envValue: input.driverRiskEnvValue })) {
    return { enabled: false };
  }
  const driverId = input.selectedDriverId;
  if (typeof driverId !== 'string' || driverId.length === 0) {
    return { enabled: true, ok: false, reason: 'CANONICAL_DRIVER_REQUIRED' };
  }
  if (!isValidCanonicalRoadDocId(driverId)) {
    return { enabled: true, ok: false, reason: 'INVALID_DRIVER_ID' };
  }
  const typeEconomics = resolveCanonicalContractTypeEconomics(input.contract.contractType);
  if (!typeEconomics.ok) return { enabled: true, ok: false, reason: typeEconomics.reason };

  const driverRef = firestore.doc(canonicalDriverPath(input.uid, driverId));
  const ecoRef = firestore.doc('globalEconomy/current');
  const eventRef = firestore.doc(CANONICAL_ROAD_CONTRACT_EVENTS_DOC);
  const [driverSnap, ecoSnap] = await Promise.all([transaction.get(driverRef), transaction.get(ecoRef)]);
  const driverDoc = driverSnap.exists ? (driverSnap.data() as Record<string, unknown>) : null;
  const classified = classifyCanonicalDriverForAssignment(driverDoc, {
    uid: input.uid,
    driverId,
    deliveryId: input.deliveryId,
    requiredDriverLevel: input.contract.requiredDriverLevel,
    nowMs: input.nowMs,
  });
  if (!classified.ok || !driverDoc) {
    return { enabled: true, ok: false, reason: classified.ok ? 'LEGACY_DRIVER_UNVERIFIED' : classified.reason };
  }

  let activeEvents: WorldEvent[] = [];
  let maintenanceEventAuthority: CanonicalMaintenanceEventAuthority = 'UNRESOLVED_EVENT_AUTHORITY_OFF';
  let eventStateToWrite: CanonicalContractEventState | null = null;
  if (isCanonicalContractWorldEventAllowed({ envValue: input.eventEnvValue })) {
    const eventSnap = await transaction.get(eventRef);
    const planned = planCanonicalContractEventAdvance(eventSnap.exists ? eventSnap.data() : null, input.nowMs);
    if (planned.ok) {
      activeEvents = activeMaintenanceWorldEvents(planned.state.events);
      maintenanceEventAuthority = 'CANONICAL_CONTRACT_WORLD_EVENTS';
      if (!eventSnap.exists || planned.advanced) eventStateToWrite = planned.state;
    } else {
      maintenanceEventAuthority = 'UNRESOLVED_EVENT_STATE_INVALID';
    }
  }

  const risk = freezeCanonicalRoadDeliveryRiskSnapshot({
    truckAsset: input.truckAsset,
    driverSnapshot: classified.snapshot,
    contract: input.contract,
    nowMs: input.nowMs,
  });
  if (!risk.ok) return { enabled: true, ok: false, reason: risk.reason };

  const fuelPrice = resolveCanonicalAcceptFuelPrice(
    ecoSnap.exists ? (ecoSnap.data() as Record<string, unknown>) : null,
  );
  const recommended = input.contract.recommendedTruckCondition;
  return {
    enabled: true,
    ok: true,
    driverRef,
    driverDoc,
    driverSnapshot: classified.snapshot,
    riskSnapshot: risk.snapshot,
    driverAware: {
      driver: {
        driverId,
        speed: classified.snapshot.speed,
        fuelSaving: classified.snapshot.fuelSaving,
        tier: classified.snapshot.tier,
      },
      activeEvents,
      driverEconomics: {
        policyVersion: ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION,
        fuelPriceAuthority: fuelPrice.authority,
        maintenanceEventAuthority,
      },
      fuelPricePerLiter: fuelPrice.pricePerLiter,
      contractType: typeEconomics.contractType,
      penaltyMultiplier: typeEconomics.penaltyMultiplier,
      recommendedTruckCondition:
        typeof recommended === 'number' && Number.isFinite(recommended) ? recommended : undefined,
    },
    eventRef,
    eventStateToWrite,
  };
}

export function commitCanonicalDriverAssignment(
  transaction: Transaction,
  _firestore: Firestore,
  read: Extract<CanonicalDriverRiskAcceptRead, { ok: true }>,
  deliveryId: string,
  nowMs: number,
): void {
  transaction.update(read.driverRef, planCanonicalDriverAssign(read.driverDoc, deliveryId, nowMs));
  if (read.eventStateToWrite) {
    transaction.set(read.eventRef, { ...read.eventStateToWrite });
  }
}

export type CanonicalDriverReleaseRead =
  | { present: false }
  | { present: true; driverRef: DocumentReference; driverDoc: Record<string, unknown> | null };

/** Read the assigned driver for a delivery accepted with a driver snapshot (independent of gate). */
export async function readCanonicalDriverForRelease(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  delivery: { canonicalDriverSnapshot?: unknown },
): Promise<CanonicalDriverReleaseRead> {
  const snapshot = delivery.canonicalDriverSnapshot;
  if (!isValidCanonicalRoadDriverSnapshot(snapshot)) return { present: false };
  const driverRef = firestore.doc(canonicalDriverPath(uid, snapshot.driverId));
  const snap = await transaction.get(driverRef);
  return {
    present: true,
    driverRef,
    driverDoc: snap.exists ? (snap.data() as Record<string, unknown>) : null,
  };
}

/** Releases only when the driver is still assigned to this delivery. Returns whether it wrote. */
export function commitCanonicalDriverRelease(
  transaction: Transaction,
  read: CanonicalDriverReleaseRead,
  deliveryId: string,
  reason: CanonicalDriverRuntimeReleaseReason,
  nowMs: number,
): boolean {
  if (!read.present) return false;
  const patch = planCanonicalDriverRelease(read.driverDoc, deliveryId, reason, nowMs);
  if (!patch) return false;
  transaction.update(read.driverRef, patch);
  return true;
}

/**
 * Server-only INTERNAL_TEST driver fixture. Not a client callable; requires both the internal
 * fleet bootstrap gate and the driver-risk gate. Never overwrites an existing driver.
 */
export async function bootstrapInternalCanonicalDriverFixtureTransaction(
  firestore: Firestore,
  uid: string,
  poolId: string,
  nowMs: number,
  options: { envValue?: string | null; driverRiskEnvValue?: string | null },
): Promise<{ ok: true; driverId: string; alreadyExists: boolean } | { ok: false; reason: string }> {
  if (!isCanonicalRoadInternalFleetBootstrapAllowed({ envValue: options.envValue })) {
    return { ok: false, reason: 'CANONICAL_ROAD_INTERNAL_TEST_OFF' };
  }
  if (!isCanonicalRoadDriverRiskAllowed({ envValue: options.driverRiskEnvValue })) {
    return { ok: false, reason: 'CANONICAL_ROAD_DRIVER_RISK_AUTHORITY_OFF' };
  }
  const built = buildInternalTestCanonicalDriverFixture({ uid, poolId, nowMs });
  if (!built.ok) return built;
  const driverId = String(built.driver.driverId);
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(canonicalDriverPath(uid, driverId));
    const snap = await transaction.get(ref);
    if (snap.exists) return { ok: true as const, driverId, alreadyExists: true };
    transaction.create(ref, built.driver);
    return { ok: true as const, driverId, alreadyExists: false };
  });
}
