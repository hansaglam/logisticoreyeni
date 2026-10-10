/**
 * Canonical ROAD delivery records (Map V2 Step 29F).
 * No cash mutation. Does not write canonicalDeliveryCompletions.
 * Issuance uses trusted server markets only — not a client money API.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_ROAD_CONTRACTS_COLLECTION,
  CANONICAL_ROAD_DELIVERIES_COLLECTION,
  CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
  createCanonicalRoadDeliveryId,
  hasOnlyCanonicalRoadAcceptKeys,
  hasOnlyCanonicalRoadCompleteKeys,
  isValidCanonicalRoadDocId,
  type CanonicalRoadAcceptRequest,
  type CanonicalRoadLifecycleState,
} from '../../src/domain/canonicalRoadDelivery';
import type { CanonicalRoadSettlementState } from '../../src/domain/canonicalRoadServerCashShadow';
import {
  issueCanonicalRoadContractFromTrustedState,
  prepareCanonicalRoadDeliverySettlement,
  type CanonicalRoadCompletionOutcome,
  type CanonicalRoadContractSnapshot,
  type TrustedRoadIssuanceInput,
} from '../../src/domain/canonicalRoadEconomics';
import {
  type CanonicalRoadExecutionEconomicsSnapshot,
} from '../../src/domain/canonicalRoadExecutionEconomics';
import {
  CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
  CANONICAL_FLEET_ASSETS_COLLECTION,
  classifyCanonicalFleetSelection,
  freezeExecutionEconomicsFromCanonicalFleet,
  parseCanonicalFleetAsset,
  type CanonicalFleetAssetDocument,
} from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_CONTRACT_CLOCK_COLLECTION,
  CANONICAL_CONTRACT_CLOCK_DOC_ID,
  advanceCanonicalContractClock,
  isCanonicalContractExpiryAllowed,
  isCanonicalOfferExpiredAtGameHours,
  validateCanonicalContractClockState,
  type CanonicalContractClockState,
} from '../../src/domain/canonicalContractGameTimeExpiry';
import { CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4 } from '../../src/domain/canonicalProductionRoadContractIssuance';
import { readEnabledCanonicalFleetRuntime } from './canonicalFleetRuntime';
import {
  CANONICAL_FLEET_RUNTIME_COLLECTION,
  isCanonicalFleetRuntimeAllowed,
  planCanonicalFleetRuntimeTransition,
  type CanonicalFleetRuntimeState,
} from '../../src/domain/canonicalFleetRuntimeLocation';
import { resolveAssetTrustClass } from '../../src/domain/canonicalProductionFleet';
import {
  classifyCanonicalRoadTimingBand,
  closeCanonicalRoadTimingSnapshot,
  deriveCanonicalRoadTiming,
  freezeCanonicalRoadTimingSnapshot,
  type CanonicalRoadTimingSnapshot,
} from '../../src/domain/canonicalRoadTiming';
import {
  classifyCanonicalFailureAuthority,
  deriveCanonicalRoadIncidentPlan,
  isCanonicalRoadExecutionAuthorityAllowed,
  type CanonicalRoadIncidentPlan,
  type CanonicalFailureAuthorityClass,
} from '../../src/domain/canonicalRoadIncidentFragileFailure';
import { applyCanonicalFuelAcceptBurnInTransaction } from './canonicalFuel';
import { applyCanonicalProgressiveFuelInTransaction } from './canonicalProgressiveFuel';
import { createInitialCanonicalProgressiveFuelState } from '../../src/domain/canonicalProgressiveFuel';
import type { CanonicalProgressiveFuelState } from '../../src/domain/canonicalProgressiveFuel';
import {
  isCanonicalExecutionTimingPolicy,
  isCanonicalRoadExecutionTimingAllowed,
} from '../../src/domain/canonicalRoadExecutionTiming';
import {
  PROGRESSION_BLOCKED_UNVERIFIED_FAILURE,
  deriveCanonicalRoadCancelReputation,
  deriveCanonicalRoadCompletionReputation,
  deriveCanonicalRoadServerFailureReputation,
  progressionDeliveryCancelOperationId,
  progressionDeliveryCompletionOperationId,
  progressionDeliveryFailureOperationId,
  type CanonicalProgressionApplication,
  type CanonicalProgressionMutationInput,
} from '../../src/domain/canonicalCompanyProgression';
import {
  commitCanonicalProgressionWrite,
  planCanonicalProgressionWrite,
  readCanonicalProgressionContext,
  type CanonicalProgressionWritePlan,
} from './canonicalCompanyProgression';

import {
  commitCanonicalDriverAssignment,
  commitCanonicalDriverRelease,
  readCanonicalDriverForRelease,
  readCanonicalDriverRiskForAccept,
} from './canonicalDeliveryRiskDriver';
import {
  deriveCanonicalRoadCompletionXpForDelivery,
  type CanonicalDriverRuntimeReleaseReason,
  type CanonicalRoadDeliveryRiskSnapshot,
  type CanonicalRoadDriverSnapshot,
} from '../../src/domain/canonicalDeliveryRiskDriver';

export { hasOnlyCanonicalRoadAcceptKeys, hasOnlyCanonicalRoadCompleteKeys };

export type CanonicalRoadDeliveryDocument = CanonicalRoadContractSnapshot & {
  ownerUid: string;
  deliveryId: string;
  sourceCanonicalContractId: string;
  lifecycleState: CanonicalRoadLifecycleState;
  acceptedAtMs: number;
  completionReportedAtMs: number | null;
  completionOutcome: CanonicalRoadCompletionOutcome | null;
  actualTravelHours: number | null;
  derivedSettlement: ReturnType<typeof prepareCanonicalRoadDeliverySettlement> | null;
  executionEconomicsSnapshot: CanonicalRoadExecutionEconomicsSnapshot | null;
  timingSnapshot: CanonicalRoadTimingSnapshot | null;
  settlementState: CanonicalRoadSettlementState;
  wearApplicationState?: 'NOT_APPLIED' | 'APPLIED' | 'NOT_ELIGIBLE';
  wearOperationId?: string | null;
  incidentConditionAuthority?: 'NONE' | 'UNRESOLVED' | 'RESOLVED';
  incidentPlan?: CanonicalRoadIncidentPlan | null;
  executionEvents?: unknown[] | null;
  failureAuthorityClass?: CanonicalFailureAuthorityClass | null;
  executionFinalizedAtMs?: number | null;
  progressiveFuel?: CanonicalProgressiveFuelState | null;
  contractType?: string;
  progressionApplication?: CanonicalProgressionApplication | null;
  progressionOperationId?: string | null;
  canonicalDriverSnapshot?: CanonicalRoadDriverSnapshot | null;
  deliveryRiskSnapshot?: CanonicalRoadDeliveryRiskSnapshot | null;
  driverAssignmentState?: 'ASSIGNED' | 'RELEASED' | null;
  driverReleaseReason?: CanonicalDriverRuntimeReleaseReason | null;
};

export type CanonicalRoadContractDocument = CanonicalRoadContractSnapshot & {
  ownerUid: string;
  issuedAtMs: number;
  expiresAtMs: number;
  status: 'AVAILABLE' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'SUPERSEDED';
  batchId: string;
  issuancePolicyVersion?: string;
  generationSeed?: number;
};

export type AcceptCanonicalRoadResult =
  | {
      ok: true;
      receipt: {
        deliveryId: string;
        contractId: string;
        acceptedAtMs: number;
        alreadyAccepted: boolean;
        payment: number;
        deadlineHours: number;
        distanceKm: number;
        tollCost: number;
        canonicalSchemaVersion: typeof CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION;
      };
    }
  | { ok: false; reason: string };

export type ReportCanonicalRoadResult =
  | {
      ok: true;
      deliveryId: string;
      lifecycleState: CanonicalRoadLifecycleState;
      alreadyReported: boolean;
      derivedSettlement: ReturnType<typeof prepareCanonicalRoadDeliverySettlement> | null;
      completedAtServerMs?: number;
      actualTravelGameSeconds?: number;
      actualTravelHours?: number;
      timingClassification?: string | null;
      clientActualTravelHoursIgnored?: boolean;
      progressionApplication?: CanonicalProgressionApplication | null;
    }
  | { ok: false; reason: string; deliveryId: string };

function planDeliveryCompletionProgression(input: {
  deliveryId: string;
  existing: CanonicalRoadDeliveryDocument;
  failureAuthorityClass: CanonicalFailureAuthorityClass;
  timingClassification: ReturnType<typeof classifyCanonicalRoadTimingBand>;
  actualTravelHours: number;
  plannedTravelGameHours: number;
  derivedSettlement: ReturnType<typeof prepareCanonicalRoadDeliverySettlement> | null;
  nowMs: number;
}):
  | { ok: true; mutation: CanonicalProgressionMutationInput | null }
  | { ok: false; reason: string } {
  if (input.failureAuthorityClass === 'SERVER_DERIVED_FAILURE') {
    const rep = deriveCanonicalRoadServerFailureReputation();
    return {
      ok: true,
      mutation: {
        operationId: progressionDeliveryFailureOperationId(input.deliveryId),
        sourceType: 'ROAD_DELIVERY_SERVER_FAILURE',
        sourceId: input.deliveryId,
        xpDelta: 0,
        xpAuthority: 'PRODUCTION_NO_XP',
        reputationDelta: rep.delta,
        reputationReasons: rep.reasons,
        nowMs: input.nowMs,
      },
    };
  }
  if (input.failureAuthorityClass !== 'NOT_A_FAILURE' || !input.derivedSettlement) {
    return { ok: true, mutation: null };
  }
  const rep = deriveCanonicalRoadCompletionReputation({
    band: input.timingClassification,
    actualTravelHours: input.actualTravelHours,
    deadlineHours: input.existing.deadlineHours,
    plannedTravelGameHours: input.plannedTravelGameHours,
    contractType: input.existing.contractType,
  });
  if (!rep.ok) return { ok: false, reason: rep.reason };
  const xp = deriveCanonicalRoadCompletionXpForDelivery({
    delivery: input.existing,
    derivedSettlement: input.derivedSettlement,
  });
  return {
    ok: true,
    mutation: {
      operationId: progressionDeliveryCompletionOperationId(input.deliveryId),
      sourceType: 'ROAD_DELIVERY_COMPLETION',
      sourceId: input.deliveryId,
      xpDelta: xp.xp,
      xpAuthority: xp.xpAuthority,
      reputationDelta: rep.delta,
      reputationReasons: rep.reasons,
      xpEvidence: xp.xpEvidence,
      nowMs: input.nowMs,
    },
  };
}

function contractRef(uid: string, contractId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_CONTRACTS_COLLECTION}/${contractId}`;
}

function deliveryRef(uid: string, deliveryId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_DELIVERIES_COLLECTION}/${deliveryId}`;
}

function isAuthenticatedUid(uid: string): boolean {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

export async function issueCanonicalRoadContractTransaction(
  firestore: Firestore,
  uid: string,
  input: TrustedRoadIssuanceInput,
  nowMs: number,
): Promise<IssueCanonicalRoadContractFromTrustedStateWrap> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  const issued = issueCanonicalRoadContractFromTrustedState(input);
  if (!issued.ok) return issued;
  if (!isValidCanonicalRoadDocId(issued.snapshot.contractId)) {
    return { ok: false, reason: 'INVALID_CONTRACT_ID' };
  }
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(contractRef(uid, issued.snapshot.contractId));
    const snap = await transaction.get(ref);
    if (snap.exists) {
      const existing = snap.data() as CanonicalRoadContractDocument;
      if (
        existing.payment === issued.snapshot.payment &&
        existing.deadlineHours === issued.snapshot.deadlineHours &&
        existing.amount === issued.snapshot.amount
      ) {
        return { ok: true as const, snapshot: existing, alreadyIssued: true };
      }
      return { ok: false as const, reason: 'CANONICAL_ROAD_CONTRACT_CONFLICT' };
    }
    const doc: CanonicalRoadContractDocument = {
      ...issued.snapshot,
      ownerUid: uid,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 24 * 60 * 60 * 1000,
      status: 'AVAILABLE',
      batchId: 'fixture',
    };
    transaction.create(ref, doc);
    return { ok: true as const, snapshot: doc, alreadyIssued: false };
  });
}

type IssueCanonicalRoadContractFromTrustedStateWrap =
  | { ok: true; snapshot: CanonicalRoadContractSnapshot; alreadyIssued?: boolean }
  | { ok: false; reason: string };

function snapshotsConflict(
  existing: CanonicalRoadContractSnapshot,
  request: CanonicalRoadAcceptRequest,
): boolean {
  if (request.originCityId && existing.originCityId !== request.originCityId) return true;
  if (request.destinationCityId && existing.destinationCityId !== request.destinationCityId) {
    return true;
  }
  if (request.productId && existing.productId !== request.productId) return true;
  if (
    request.cargoAmount != null &&
    Number.isFinite(request.cargoAmount) &&
    existing.amount !== request.cargoAmount
  ) {
    return true;
  }
  return false;
}

export async function acceptCanonicalRoadDeliveryTransaction(
  firestore: Firestore,
  uid: string,
  request: CanonicalRoadAcceptRequest,
  nowMs: number,
  options?: {
    executionEnvValue?: string | null;
    fuelEnvValue?: string | null;
    progressiveEnvValue?: string | null;
    timingEnvValue?: string | null;
    runtimeEnvValue?: string | null;
    expiryEnvValue?: string | null;
    driverRiskEnvValue?: string | null;
    eventEnvValue?: string | null;
  },
): Promise<AcceptCanonicalRoadResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  if (request.canonicalSchemaVersion !== CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (!isValidCanonicalRoadDocId(request.contractId)) {
    return { ok: false, reason: 'INVALID_CONTRACT_ID' };
  }
  const deliveryId = createCanonicalRoadDeliveryId(request.contractId);
  if (!isValidCanonicalRoadDocId(deliveryId)) {
    return { ok: false, reason: 'INVALID_DELIVERY_ID' };
  }

  return firestore.runTransaction(async (transaction) => {
    const cRef = firestore.doc(contractRef(uid, request.contractId));
    const dRef = firestore.doc(deliveryRef(uid, deliveryId));
    const [contractSnap, deliverySnap] = await Promise.all([
      transaction.get(cRef),
      transaction.get(dRef),
    ]);

    if (!contractSnap.exists) {
      return { ok: false as const, reason: 'CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED' };
    }
    const contract = contractSnap.data() as CanonicalRoadContractDocument;
    if (contract.ownerUid !== uid) {
      return { ok: false as const, reason: 'UNAUTHENTICATED' };
    }
    if (snapshotsConflict(contract, request)) {
      return { ok: false as const, reason: 'CANONICAL_ROAD_DELIVERY_CONFLICT' };
    }
    const offerRow = contract as CanonicalRoadContractDocument & {
      policyVersion?: string;
      expiryAuthority?: string;
      expiresAtGameHours?: number;
    };
    if (contract.status === 'SUPERSEDED') {
      return { ok: false as const, reason: 'CONTRACT_SUPERSEDED' };
    }
    const gameTimeOffer =
      offerRow.expiryAuthority === 'CANONICAL_GAME_TIME' ||
      offerRow.policyVersion === CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4 ||
      offerRow.policyVersion === 'canonical-road-contract-issuance-internal-production-parity-v5';
    let clockNext: CanonicalContractClockState | null = null;
    const clockRef = firestore.doc(
      `users/${uid}/${CANONICAL_CONTRACT_CLOCK_COLLECTION}/${CANONICAL_CONTRACT_CLOCK_DOC_ID}`,
    );
    if (gameTimeOffer && offerRow.status === 'AVAILABLE') {
      if (!isCanonicalContractExpiryAllowed({ envValue: options?.expiryEnvValue })) {
        return { ok: false as const, reason: 'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_OFF' };
      }
      if (!Number.isFinite(offerRow.expiresAtGameHours)) {
        return { ok: false as const, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
      }
      const clockSnap = await transaction.get(clockRef);
      const parsedClock = clockSnap.exists
        ? validateCanonicalContractClockState(clockSnap.data())
        : { ok: false as const, reason: 'CONTRACT_CLOCK_STATE_INVALID' as const };
      if (!parsedClock.ok) return { ok: false as const, reason: parsedClock.reason };
      const advanced = advanceCanonicalContractClock(parsedClock.state, nowMs);
      if (!advanced.ok) return { ok: false as const, reason: advanced.reason };
      clockNext = advanced.state;
      if (isCanonicalOfferExpiredAtGameHours(advanced.state.currentGameHours, offerRow.expiresAtGameHours!)) {
        transaction.update(cRef, { status: 'EXPIRED' });
        transaction.set(clockRef, { ...advanced.state });
        return { ok: false as const, reason: 'CONTRACT_EXPIRED' };
      }
    } else if (
      !gameTimeOffer &&
      (contract.status === 'EXPIRED' ||
        (contract.expiresAtMs != null && contract.expiresAtMs <= nowMs && contract.status === 'AVAILABLE'))
    ) {
      if (contract.status === 'AVAILABLE') {
        transaction.update(cRef, { status: 'EXPIRED' });
      }
      return { ok: false as const, reason: 'CONTRACT_EXPIRED' };
    } else if (gameTimeOffer && contract.status === 'EXPIRED') {
      return { ok: false as const, reason: 'CONTRACT_EXPIRED' };
    }
    if (contract.status === 'CANCELLED') {
      return { ok: false as const, reason: 'CONTRACT_NOT_FOUND' };
    }

    if (deliverySnap.exists) {
      const existing = deliverySnap.data() as CanonicalRoadDeliveryDocument;
      if (snapshotsConflict(existing, request) || existing.payment !== contract.payment) {
        return { ok: false as const, reason: 'CANONICAL_ROAD_DELIVERY_CONFLICT' };
      }
      return {
        ok: true as const,
        receipt: {
          deliveryId: existing.deliveryId,
          contractId: existing.contractId,
          acceptedAtMs: existing.acceptedAtMs,
          alreadyAccepted: true,
          payment: existing.payment,
          deadlineHours: existing.deadlineHours,
          distanceKm: existing.distanceKm,
          tollCost: existing.tollCost,
          canonicalSchemaVersion: CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
        },
      };
    }

    if (contract.status === 'ACCEPTED') {
      return { ok: false as const, reason: 'CONTRACT_ALREADY_ACCEPTED' };
    }

    const truckAssetId =
      request.canonicalTruckAssetId ??
      request.selectedTruckId ??
      CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID;
    const trailerAssetId = request.canonicalTrailerAssetId ?? request.selectedTrailerId ?? null;
    if (classifyCanonicalFleetSelection(truckAssetId) === 'LEGACY') {
      return { ok: false as const, reason: 'LEGACY_CLIENT_FLEET_UNVERIFIED' };
    }
    if (
      trailerAssetId &&
      trailerAssetId !== 'none' &&
      classifyCanonicalFleetSelection(trailerAssetId) === 'LEGACY'
    ) {
      return { ok: false as const, reason: 'LEGACY_CLIENT_FLEET_UNVERIFIED' };
    }

    const truckRef = firestore.doc(
      `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${truckAssetId}`,
    );
    const truckSnap = await transaction.get(truckRef);
    const parsedTruck = parseCanonicalFleetAsset(
      truckSnap.exists ? (truckSnap.data() as CanonicalFleetAssetDocument) : undefined,
      'TRUCK',
    );
    if (!parsedTruck.ok) {
      return { ok: false as const, reason: parsedTruck.reason };
    }
    if (parsedTruck.asset.ownerUid !== uid) {
      return { ok: false as const, reason: 'CANONICAL_TRUCK_NOT_OWNED' };
    }
    if (
      classifyCanonicalFleetSelection(truckAssetId) === 'PRODUCTION_CANONICAL' &&
      resolveAssetTrustClass(parsedTruck.asset) !== 'SERVER_CANONICAL'
    ) {
      return { ok: false as const, reason: 'FLEET_AUTHORITY_NOT_AVAILABLE' };
    }

    let runtimeNext: CanonicalFleetRuntimeState | null = null;
    const runtimeRef = firestore.doc(
      `users/${uid}/${CANONICAL_FLEET_RUNTIME_COLLECTION}/${truckAssetId}`,
    );
    if (isCanonicalFleetRuntimeAllowed({ envValue: options?.runtimeEnvValue })) {
      const loadedRuntime = await readEnabledCanonicalFleetRuntime(
        transaction,
        firestore,
        uid,
        truckAssetId,
        options?.runtimeEnvValue,
      );
      if (!loadedRuntime.enabled || !loadedRuntime.ok) {
        return { ok: false as const, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
      }
      const plannedRuntime = planCanonicalFleetRuntimeTransition(
        loadedRuntime.state,
        {
          kind: 'START',
          deliveryId,
          originCityId: contract.originCityId,
          destinationCityId: contract.destinationCityId,
        },
        nowMs,
      );
      if (!plannedRuntime.ok) return { ok: false as const, reason: plannedRuntime.reason };
      runtimeNext = plannedRuntime.state;
    }

    let trailerAsset: CanonicalFleetAssetDocument | null = null;
    if (trailerAssetId && trailerAssetId !== 'none' && trailerAssetId !== '') {
      const trailerRef = firestore.doc(
        `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${trailerAssetId}`,
      );
      const trailerSnap = await transaction.get(trailerRef);
      const parsedTrailer = parseCanonicalFleetAsset(
        trailerSnap.exists ? (trailerSnap.data() as CanonicalFleetAssetDocument) : undefined,
        'TRAILER',
      );
      if (!parsedTrailer.ok) {
        return { ok: false as const, reason: parsedTrailer.reason };
      }
      if (parsedTrailer.asset.ownerUid !== uid) {
        return { ok: false as const, reason: 'CANONICAL_TRAILER_NOT_OWNED' };
      }
      trailerAsset = parsedTrailer.asset;
    }

    const driverRisk = await readCanonicalDriverRiskForAccept(transaction, firestore, {
      uid,
      deliveryId,
      selectedDriverId: request.selectedDriverId,
      contract,
      truckAsset: parsedTruck.asset,
      nowMs,
      driverRiskEnvValue: options?.driverRiskEnvValue,
      eventEnvValue: options?.eventEnvValue,
    });
    if (driverRisk.enabled && !driverRisk.ok) {
      return { ok: false as const, reason: driverRisk.reason };
    }
    const driverAssignment = driverRisk.enabled && driverRisk.ok ? driverRisk : null;

    const frozen = freezeExecutionEconomicsFromCanonicalFleet({
      contract,
      truckAsset: parsedTruck.asset,
      trailerAsset,
      selectedDriverId: request.selectedDriverId,
      driverAware: driverAssignment?.driverAware ?? null,
      createdAtMs: nowMs,
    });
    if (!frozen.ok) {
      return { ok: false as const, reason: frozen.reason };
    }

    const timingSnapshot = freezeCanonicalRoadTimingSnapshot({
      startedAtServerMs: nowMs,
      plannedTravelGameHours: frozen.snapshot.acceptedTravelBasis.expectedDurationHours,
      deadlineHours: contract.deadlineHours,
    });

    if (
      parsedTruck.asset.activeCanonicalRoadDeliveryId &&
      parsedTruck.asset.activeCanonicalRoadDeliveryId !== deliveryId
    ) {
      return { ok: false as const, reason: 'ASSET_RESERVED_BY_OTHER_DELIVERY' };
    }

    const fuelBurn = await applyCanonicalFuelAcceptBurnInTransaction(
      transaction,
      firestore,
      uid,
      parsedTruck.asset,
      deliveryId,
      {
        originCityId: contract.originCityId,
        destinationCityId: contract.destinationCityId,
        amount: contract.amount,
        payment: contract.payment,
        driverFuelSaving: driverAssignment?.driverSnapshot.fuelSaving ?? null,
      },
      nowMs,
      { envValue: options?.fuelEnvValue, progressiveEnvValue: options?.progressiveEnvValue },
    );
    if (!fuelBurn.ok) {
      return { ok: false as const, reason: fuelBurn.reason };
    }

    const incidentPlan = deriveCanonicalRoadIncidentPlan({
      uid,
      deliveryId,
      enabled: isCanonicalRoadExecutionAuthorityAllowed({
        envValue: options?.executionEnvValue,
      }),
    });
    const incidentConditionAuthority =
      incidentPlan.events.length > 0 ? ('UNRESOLVED' as const) : ('NONE' as const);
    const doc: CanonicalRoadDeliveryDocument = {
      ...contract,
      ownerUid: uid,
      deliveryId,
      sourceCanonicalContractId: contract.contractId,
      lifecycleState: 'ACCEPTED',
      acceptedAtMs: nowMs,
      completionReportedAtMs: null,
      completionOutcome: null,
      actualTravelHours: null,
      derivedSettlement: null,
      executionEconomicsSnapshot: frozen.snapshot,
      timingSnapshot,
      settlementState: 'NOT_SETTLED',
      wearApplicationState: 'NOT_APPLIED',
      wearOperationId: null,
      incidentConditionAuthority,
      incidentPlan,
      executionEvents: [],
      failureAuthorityClass: null,
      executionFinalizedAtMs: null,
      progressiveFuel: fuelBurn.progressiveHold
        ? createInitialCanonicalProgressiveFuelState({
            nowMs,
            distanceKm: contract.distanceKm,
            travelHours: frozen.snapshot.acceptedTravelBasis.expectedDurationHours,
            fuelLitersTotal: fuelBurn.requiredFuelL ?? 0,
            fuelLitersAtStart: fuelBurn.asset.currentFuelL ?? 0,
            fuelCapacityL: fuelBurn.asset.fuelCapacityL ?? 0,
            executionTiming: isCanonicalRoadExecutionTimingAllowed({
              envValue: options?.timingEnvValue,
            }),
          })
        : null,
      ...(driverAssignment
        ? {
            canonicalDriverSnapshot: driverAssignment.driverSnapshot,
            deliveryRiskSnapshot: driverAssignment.riskSnapshot,
            driverAssignmentState: 'ASSIGNED' as const,
          }
        : {}),
    };
    transaction.create(dRef, doc);
    transaction.update(cRef, { status: 'ACCEPTED' });
    if (driverAssignment) {
      commitCanonicalDriverAssignment(transaction, firestore, driverAssignment, deliveryId, nowMs);
    }
    transaction.update(truckRef, {
      activeCanonicalRoadDeliveryId: deliveryId,
      reservedAtMs: nowMs,
      reservationRevision: parsedTruck.asset.economicRevision,
      updatedAtMs: nowMs,
      ...(fuelBurn.skipped || fuelBurn.alreadyApplied
        ? {}
        : {
            fuelStateSchemaVersion: 1,
            currentFuelL: fuelBurn.asset.currentFuelL,
            fuelCapacityL: fuelBurn.asset.fuelCapacityL,
            fuelRevision: fuelBurn.asset.fuelRevision,
            fuelPolicyVersion: fuelBurn.asset.fuelPolicyVersion,
          }),
    });
    if (runtimeNext) {
      transaction.set(runtimeRef, { ...runtimeNext });
    }
    if (clockNext) {
      transaction.set(clockRef, { ...clockNext });
    }
    return {
      ok: true as const,
      receipt: {
        deliveryId,
        contractId: contract.contractId,
        acceptedAtMs: nowMs,
        alreadyAccepted: false,
        payment: contract.payment,
        deadlineHours: contract.deadlineHours,
        distanceKm: contract.distanceKm,
        tollCost: contract.tollCost,
        canonicalSchemaVersion: CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
      },
    };
  });
}

export async function reportCanonicalRoadDeliveryCompletedTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  outcome: CanonicalRoadCompletionOutcome,
  nowMs: number,
  clientActualTravelHours?: number | null,
  options?: { runtimeEnvValue?: string | null; progressionEnvValue?: string | null },
): Promise<ReportCanonicalRoadResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED', deliveryId };
  }
  if (!isValidCanonicalRoadDocId(deliveryId)) {
    return { ok: false, reason: 'INVALID_DELIVERY_ID', deliveryId };
  }
  if (outcome !== 'COMPLETED' && outcome !== 'FAILED') {
    return { ok: false, reason: 'INVALID_OUTCOME', deliveryId };
  }

  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryRef(uid, deliveryId));
    const snap = await transaction.get(dRef);
    if (!snap.exists) {
      return { ok: false as const, reason: 'DELIVERY_NOT_FOUND', deliveryId };
    }
    const existing = snap.data() as CanonicalRoadDeliveryDocument;
    if (existing.ownerUid !== uid) {
      return { ok: false as const, reason: 'UNAUTHENTICATED', deliveryId };
    }
    const truckAssetId = existing.executionEconomicsSnapshot?.truckEconomicProfile.truckId;
    const truckRef = truckAssetId
      ? firestore.doc(`users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${truckAssetId}`)
      : null;
    const truckSnap = truckRef ? await transaction.get(truckRef) : null;
    if (existing.lifecycleState === 'CANCELLED') {
      return { ok: false as const, reason: 'DELIVERY_CANCELLED', deliveryId };
    }
    const driverRelease =
      existing.lifecycleState === 'ACCEPTED'
        ? await readCanonicalDriverForRelease(transaction, firestore, uid, existing)
        : ({ present: false } as const);
    const progressionContext =
      existing.lifecycleState === 'ACCEPTED'
        ? await readCanonicalProgressionContext(
            transaction,
            firestore,
            uid,
            [
              progressionDeliveryCompletionOperationId(deliveryId),
              progressionDeliveryFailureOperationId(deliveryId),
            ],
            options?.progressionEnvValue,
          )
        : ({ enabled: false } as const);
    if (existing.lifecycleState === 'SETTLED' || existing.settlementState === 'SETTLED') {
      return { ok: false as const, reason: 'DELIVERY_ALREADY_SETTLED', deliveryId };
    }
    if (
      existing.lifecycleState === 'COMPLETION_REPORTED' ||
      existing.lifecycleState === 'FAILED'
    ) {
      const sameOutcome =
        existing.completionOutcome === outcome ||
        (existing.failureAuthorityClass === 'SERVER_DERIVED_FAILURE' &&
          existing.completionOutcome === 'FAILED' &&
          outcome === 'COMPLETED');
      if (sameOutcome) {
        return {
          ok: true as const,
          deliveryId,
          lifecycleState: existing.lifecycleState,
          alreadyReported: true,
          derivedSettlement: existing.derivedSettlement,
          completedAtServerMs: existing.timingSnapshot?.completedAtServerMs ?? existing.completionReportedAtMs ?? undefined,
          actualTravelGameSeconds:
            existing.timingSnapshot?.derivedActualTravelGameSeconds ?? undefined,
          actualTravelHours: existing.actualTravelHours ?? undefined,
          timingClassification: existing.timingSnapshot?.derivedTimingClassification ?? null,
          clientActualTravelHoursIgnored: true,
        };
      }
      return { ok: false as const, reason: 'COMPLETION_CONFLICT', deliveryId };
    }
    const runtimeLoaded =
      truckAssetId == null
        ? ({ enabled: false } as const)
        : await readEnabledCanonicalFleetRuntime(
            transaction,
            firestore,
            uid,
            truckAssetId,
            options?.runtimeEnvValue,
          );
    if (runtimeLoaded.enabled && !runtimeLoaded.ok) {
      return { ok: false as const, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE', deliveryId };
    }
    if (isCanonicalFleetRuntimeAllowed({ envValue: options?.runtimeEnvValue }) && !truckAssetId) {
      return { ok: false as const, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE', deliveryId };
    }
    if (existing.lifecycleState === 'ACCEPTED' && existing.progressiveFuel) {
      const applied = await applyCanonicalProgressiveFuelInTransaction(
        transaction,
        firestore,
        uid,
        existing,
        nowMs,
      );
      if (!applied.ok) {
        return { ok: false as const, reason: applied.reason, deliveryId };
      }
      if (outcome === 'COMPLETED' && applied.state.progress < 1 - 1e-6) {
        transaction.update(dRef, { progressiveFuel: applied.state });
        if (runtimeLoaded.enabled && runtimeLoaded.ok && applied.state.pauseReason === 'OUT_OF_FUEL') {
          const stranded = planCanonicalFleetRuntimeTransition(runtimeLoaded.state, { kind: 'FUEL_OUT' }, nowMs);
          if (!stranded.ok) return { ok: false as const, reason: stranded.reason, deliveryId };
          transaction.set(firestore.doc(runtimeLoaded.path), { ...stranded.state });
        }
        return { ok: false as const, reason: 'PROGRESS_INCOMPLETE', deliveryId };
      }
      existing.progressiveFuel = applied.state;
    }
    const timingBase =
      existing.timingSnapshot ??
      freezeCanonicalRoadTimingSnapshot({
        startedAtServerMs: existing.acceptedAtMs,
        plannedTravelGameHours:
          existing.executionEconomicsSnapshot?.acceptedTravelBasis.expectedDurationHours ??
          existing.deadlineHours,
        deadlineHours: existing.deadlineHours,
      });
    let derivation = deriveCanonicalRoadTiming({
      timing: timingBase,
      completedAtServerMs: nowMs,
      outcome,
    });
    const executionFuel = existing.progressiveFuel;
    if (executionFuel && isCanonicalExecutionTimingPolicy(executionFuel.timingPolicyVersion)) {
      const hours = executionFuel.accumulatedGameHours;
      const completedAt = executionFuel.completedAtServerMs ?? nowMs;
      derivation = {
        completedAtServerMs: completedAt,
        elapsedRealMs: Math.max(0, completedAt - existing.acceptedAtMs),
        derivedActualTravelGameSeconds: Math.floor(hours * 3600),
        derivedActualTravelHours: hours,
        timingClassification: classifyCanonicalRoadTimingBand({
          outcome,
          actualTravelHours: hours,
          deadlineHours: existing.deadlineHours,
          plannedTravelGameHours: timingBase.plannedTravelGameHours,
        }),
      };
    }
    const failureAuthorityClass = classifyCanonicalFailureAuthority({
      clientOutcome: outcome,
      actualTravelHours: derivation.derivedActualTravelHours,
      deadlineHours: existing.deadlineHours,
    });
    const effectiveOutcome: CanonicalRoadCompletionOutcome =
      failureAuthorityClass === 'SERVER_DERIVED_FAILURE' ? 'FAILED' : outcome;
    const closedTiming = closeCanonicalRoadTimingSnapshot(timingBase, derivation);
    const derivedSettlement =
      failureAuthorityClass === 'CLIENT_REPORTED_UNVERIFIED_FAILURE'
        ? null
        : prepareCanonicalRoadDeliverySettlement({
            snapshot: existing,
            deliveryId,
            outcome: effectiveOutcome,
            actualTravelHours: derivation.derivedActualTravelHours,
            executionEconomics: existing.executionEconomicsSnapshot,
          });
    const lifecycleState: CanonicalRoadLifecycleState =
      effectiveOutcome === 'FAILED' ? 'FAILED' : 'COMPLETION_REPORTED';
    const driverReleaseReason: CanonicalDriverRuntimeReleaseReason =
      failureAuthorityClass === 'CLIENT_REPORTED_UNVERIFIED_FAILURE'
        ? 'CLIENT_UNVERIFIED_FAILURE_TERMINAL'
        : failureAuthorityClass === 'SERVER_DERIVED_FAILURE'
          ? 'SERVER_DERIVED_FAILURE'
          : 'COMPLETED';
    let progressionApplication: CanonicalProgressionApplication | null = null;
    let progressionOperationId: string | null = null;
    let progressionPlan: CanonicalProgressionWritePlan | null = null;
    if (progressionContext.enabled) {
      const planned = planDeliveryCompletionProgression({
        deliveryId,
        existing,
        failureAuthorityClass,
        timingClassification: derivation.timingClassification,
        actualTravelHours: derivation.derivedActualTravelHours,
        plannedTravelGameHours: timingBase.plannedTravelGameHours,
        derivedSettlement,
        nowMs,
      });
      if (!planned.ok) return { ok: false as const, reason: planned.reason, deliveryId };
      if (planned.mutation) {
        progressionPlan = planCanonicalProgressionWrite(progressionContext, planned.mutation);
        if (!progressionPlan.ok) {
          return { ok: false as const, reason: progressionPlan.reason, deliveryId };
        }
        progressionApplication = progressionPlan.application;
        progressionOperationId = planned.mutation.operationId;
      } else {
        progressionApplication = PROGRESSION_BLOCKED_UNVERIFIED_FAILURE;
      }
    }
    transaction.update(dRef, {
      lifecycleState,
      completionReportedAtMs: nowMs,
      completionOutcome: effectiveOutcome,
      actualTravelHours: derivation.derivedActualTravelHours,
      derivedSettlement,
      timingSnapshot: closedTiming,
      failureAuthorityClass,
      progressiveFuel: existing.progressiveFuel ?? null,
      wearApplicationState:
        effectiveOutcome === 'FAILED' && failureAuthorityClass !== 'SERVER_DERIVED_FAILURE'
          ? 'NOT_ELIGIBLE'
          : existing.wearApplicationState ?? 'NOT_APPLIED',
      ...(progressionContext.enabled ? { progressionApplication, progressionOperationId } : {}),
      ...(driverRelease.present
        ? { driverAssignmentState: 'RELEASED' as const, driverReleaseReason }
        : {}),
    });
    if (progressionPlan) {
      commitCanonicalProgressionWrite(transaction, firestore, uid, progressionPlan);
    }
    commitCanonicalDriverRelease(transaction, driverRelease, deliveryId, driverReleaseReason, nowMs);
    if (effectiveOutcome === 'FAILED' && truckRef && truckSnap?.exists) {
      const truck = truckSnap.data() as CanonicalFleetAssetDocument;
      if (
        truck.activeCanonicalRoadDeliveryId === deliveryId &&
        failureAuthorityClass === 'CLIENT_REPORTED_UNVERIFIED_FAILURE'
      ) {
        transaction.update(truckRef, {
          activeCanonicalRoadDeliveryId: null,
          reservedAtMs: null,
          reservationRevision: null,
          updatedAtMs: nowMs,
        });
      }
    }
    if (runtimeLoaded.enabled && runtimeLoaded.ok) {
      const runtimeKind =
        failureAuthorityClass === 'CLIENT_REPORTED_UNVERIFIED_FAILURE'
          ? ('FAIL_CLIENT_UNVERIFIED' as const)
          : effectiveOutcome === 'FAILED'
            ? ('FAIL_SERVER' as const)
            : ('COMPLETE' as const);
      const moved = planCanonicalFleetRuntimeTransition(runtimeLoaded.state, { kind: runtimeKind }, nowMs);
      if (!moved.ok) return { ok: false as const, reason: moved.reason, deliveryId };
      transaction.set(firestore.doc(runtimeLoaded.path), { ...moved.state });
    }
    return {
      ok: true as const,
      deliveryId,
      lifecycleState,
      alreadyReported: false,
      derivedSettlement,
      completedAtServerMs: derivation.completedAtServerMs,
      actualTravelGameSeconds: derivation.derivedActualTravelGameSeconds,
      actualTravelHours: derivation.derivedActualTravelHours,
      timingClassification: derivation.timingClassification,
      clientActualTravelHoursIgnored: clientActualTravelHours != null,
      progressionApplication,
    };
  });
}

export type CancelCanonicalRoadResult =
  | {
      ok: true;
      deliveryId: string;
      alreadyCancelled: boolean;
      progressionApplication?: CanonicalProgressionApplication | null;
    }
  | { ok: false; reason: string; deliveryId: string };

export async function cancelCanonicalRoadDeliveryTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  nowMs: number,
  options?: { runtimeEnvValue?: string | null; progressionEnvValue?: string | null },
): Promise<CancelCanonicalRoadResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED', deliveryId };
  }
  if (!isValidCanonicalRoadDocId(deliveryId)) {
    return { ok: false, reason: 'INVALID_DELIVERY_ID', deliveryId };
  }
  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryRef(uid, deliveryId));
    const snap = await transaction.get(dRef);
    if (!snap.exists) {
      return { ok: false as const, reason: 'DELIVERY_NOT_FOUND', deliveryId };
    }
    const existing = snap.data() as CanonicalRoadDeliveryDocument;
    if (existing.ownerUid !== uid) {
      return { ok: false as const, reason: 'UNAUTHENTICATED', deliveryId };
    }
    const truckAssetId = existing.executionEconomicsSnapshot?.truckEconomicProfile.truckId;
    const truckRef = truckAssetId
      ? firestore.doc(`users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${truckAssetId}`)
      : null;
    const truckSnap = truckRef ? await transaction.get(truckRef) : null;
    if (existing.lifecycleState === 'CANCELLED') {
      return { ok: true as const, deliveryId, alreadyCancelled: true };
    }
    if (existing.lifecycleState !== 'ACCEPTED') {
      return { ok: false as const, reason: 'DELIVERY_NOT_CANCELLABLE', deliveryId };
    }
    const driverRelease = await readCanonicalDriverForRelease(transaction, firestore, uid, existing);
    const cancelOperationId = progressionDeliveryCancelOperationId(deliveryId);
    const progressionContext = await readCanonicalProgressionContext(
      transaction,
      firestore,
      uid,
      [cancelOperationId],
      options?.progressionEnvValue,
    );
    const runtimeLoaded =
      truckAssetId == null
        ? ({ enabled: false } as const)
        : await readEnabledCanonicalFleetRuntime(
            transaction,
            firestore,
            uid,
            truckAssetId,
            options?.runtimeEnvValue,
          );
    if (runtimeLoaded.enabled && !runtimeLoaded.ok) {
      return { ok: false as const, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE', deliveryId };
    }
    if (isCanonicalFleetRuntimeAllowed({ envValue: options?.runtimeEnvValue }) && !truckAssetId) {
      return { ok: false as const, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE', deliveryId };
    }
    if (existing.lifecycleState === 'ACCEPTED' && existing.progressiveFuel) {
      const applied = await applyCanonicalProgressiveFuelInTransaction(
        transaction,
        firestore,
        uid,
        existing,
        nowMs,
      );
      if (!applied.ok) {
        return { ok: false as const, reason: applied.reason, deliveryId };
      }
      existing.progressiveFuel = applied.state;
    }
    let progressionPlan: CanonicalProgressionWritePlan | null = null;
    if (progressionContext.enabled) {
      const rep = deriveCanonicalRoadCancelReputation();
      progressionPlan = planCanonicalProgressionWrite(progressionContext, {
        operationId: cancelOperationId,
        sourceType: 'ROAD_DELIVERY_CANCEL',
        sourceId: deliveryId,
        xpDelta: 0,
        xpAuthority: 'PRODUCTION_NO_XP',
        reputationDelta: rep.delta,
        reputationReasons: rep.reasons,
        nowMs,
      });
      if (!progressionPlan.ok) {
        return { ok: false as const, reason: progressionPlan.reason, deliveryId };
      }
    }
    const progressionApplication =
      progressionPlan && progressionPlan.ok ? progressionPlan.application : null;
    transaction.update(dRef, {
      lifecycleState: 'CANCELLED' as const,
      wearApplicationState: 'NOT_ELIGIBLE',
      progressiveFuel: existing.progressiveFuel ?? null,
      ...(progressionContext.enabled
        ? { progressionApplication, progressionOperationId: cancelOperationId }
        : {}),
      ...(driverRelease.present
        ? { driverAssignmentState: 'RELEASED' as const, driverReleaseReason: 'CANCELLED' as const }
        : {}),
    });
    if (progressionPlan) {
      commitCanonicalProgressionWrite(transaction, firestore, uid, progressionPlan);
    }
    commitCanonicalDriverRelease(transaction, driverRelease, deliveryId, 'CANCELLED', nowMs);
    if (truckRef && truckSnap?.exists) {
      const truck = truckSnap.data() as CanonicalFleetAssetDocument;
      if (truck.activeCanonicalRoadDeliveryId === deliveryId) {
        transaction.update(truckRef, {
          activeCanonicalRoadDeliveryId: null,
          reservedAtMs: null,
          reservationRevision: null,
          updatedAtMs: nowMs,
        });
      }
    }
    if (runtimeLoaded.enabled && runtimeLoaded.ok) {
      const moved = planCanonicalFleetRuntimeTransition(runtimeLoaded.state, { kind: 'CANCEL' }, nowMs);
      if (!moved.ok) return { ok: false as const, reason: moved.reason, deliveryId };
      transaction.set(firestore.doc(runtimeLoaded.path), { ...moved.state });
    }
    return { ok: true as const, deliveryId, alreadyCancelled: false, progressionApplication };
  });
}
