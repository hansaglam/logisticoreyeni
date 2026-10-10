/**
 * Canonical ROAD execution finalization (Step 29O).
 * INTERNAL_TEST gated. Applies server-issued incident plan exactly once.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION, parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION } from '../../src/domain/canonicalFleetConditionWear';
import {
  applyCanonicalIncidentCondition,
  buildCanonicalIncidentExecutionEvent,
  createCanonicalIncidentCashTransactionId,
  createCanonicalIncidentMutationOperationId,
  deriveCanonicalIncidentCatalogEffects,
  hasOnlyCanonicalRoadFinalizeKeys,
  isCanonicalRoadExecutionAuthorityAllowed,
  CANONICAL_INCIDENT_OPERATION_TYPE,
  CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
  type CanonicalExecutionEventRecord,
  type CanonicalFleetIncidentMutationReceipt,
} from '../../src/domain/canonicalRoadIncidentFragileFailure';
import { CANONICAL_ROAD_DELIVERIES_COLLECTION, isValidCanonicalRoadDocId } from '../../src/domain/canonicalRoadDelivery';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
  type CanonicalCashMutationInput,
} from './canonicalCashTransaction';
import type { CanonicalRoadDeliveryDocument } from './canonicalRoadDelivery';

export { hasOnlyCanonicalRoadFinalizeKeys };

export type FinalizeCanonicalRoadExecutionResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      deliveryId: string;
      completionTruckCondition: number;
      events: CanonicalExecutionEventRecord[];
    }
  | { ok: false; reason: string; deliveryId?: string };

function deliveryPath(uid: string, deliveryId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_DELIVERIES_COLLECTION}/${deliveryId}`;
}

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

function receiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION}/${operationId}`;
}

export async function finalizeCanonicalRoadExecutionTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<FinalizeCanonicalRoadExecutionResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED', deliveryId };
  }
  if (!isCanonicalRoadExecutionAuthorityAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_ROAD_EXECUTION_AUTHORITY_OFF', deliveryId };
  }
  if (!isValidCanonicalRoadDocId(deliveryId)) {
    return { ok: false, reason: 'INVALID_DELIVERY_ID', deliveryId };
  }

  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryPath(uid, deliveryId));
    const deliverySnap = await transaction.get(dRef);
    if (!deliverySnap.exists) {
      return { ok: false as const, reason: 'DELIVERY_NOT_FOUND', deliveryId };
    }
    const delivery = deliverySnap.data() as CanonicalRoadDeliveryDocument;
    if (delivery.ownerUid !== uid) {
      return { ok: false as const, reason: 'UNAUTHENTICATED', deliveryId };
    }
    if (delivery.lifecycleState === 'CANCELLED') {
      return { ok: false as const, reason: 'MANUAL_CANCEL_NOT_FAILURE', deliveryId };
    }
    if (delivery.executionFinalizedAtMs != null || delivery.incidentConditionAuthority === 'RESOLVED') {
      const condition =
        delivery.executionEconomicsSnapshot?.completionTruckCondition ??
        delivery.executionEconomicsSnapshot?.truckEconomicProfile.condition ??
        0;
      return {
        ok: true as const,
        alreadyApplied: true,
        deliveryId,
        completionTruckCondition: condition,
        events: (delivery.executionEvents as CanonicalExecutionEventRecord[]) ?? [],
      };
    }

    const assetId = delivery.executionEconomicsSnapshot?.truckEconomicProfile.truckId;
    if (!assetId) {
      return { ok: false as const, reason: 'LEGACY_FLEET_UNVERIFIED', deliveryId };
    }
    const aRef = firestore.doc(assetPath(uid, assetId));
    const assetSnap = await transaction.get(aRef);
    const parsed = parseCanonicalFleetAsset(
      assetSnap.exists ? (assetSnap.data() as Record<string, unknown>) : undefined,
      'TRUCK',
    );
    if (!parsed.ok) {
      return { ok: false as const, reason: parsed.reason, deliveryId };
    }
    const asset = parsed.asset;
    if (asset.ownerUid !== uid) {
      return { ok: false as const, reason: 'LEGACY_FLEET_UNVERIFIED', deliveryId };
    }

    const plan = delivery.incidentPlan;
    const events: CanonicalExecutionEventRecord[] = [];
    let condition = asset.economicCondition;
    let revision = asset.economicRevision;
    const cashMutations: CanonicalCashMutationInput[] = [];
    let incidentReceipt: CanonicalFleetIncidentMutationReceipt | null = null;

    for (const planned of plan?.events ?? []) {
      const derived = deriveCanonicalIncidentCatalogEffects(
        planned.incidentType,
        planned.canonicalChoiceId,
      );
      if (!derived.ok) {
        return { ok: false as const, reason: derived.reason, deliveryId };
      }
      const event = buildCanonicalIncidentExecutionEvent({
        event: planned,
        effects: derived.effects,
        nowMs,
      });
      events.push(event);
      const nextCondition = applyCanonicalIncidentCondition(condition, derived.truckConditionDelta);
      const cashDelta = Math.round(derived.netCashDelta);
      if (cashDelta !== 0) {
        cashMutations.push({
          uid,
          transactionId: createCanonicalIncidentCashTransactionId(deliveryId, planned.eventId),
          operationType: 'CANONICAL_ROAD_INCIDENT',
          sourceId: deliveryId,
          amountDelta: cashDelta,
          nowMs,
          metadata: {
            policyVersion: CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
            eventId: planned.eventId,
          },
        });
      }
      if (derived.truckConditionDelta !== 0) {
        incidentReceipt = {
          operationId: createCanonicalIncidentMutationOperationId(assetId, deliveryId, planned.eventId),
          operationType: CANONICAL_INCIDENT_OPERATION_TYPE,
          assetId,
          ownerUid: uid,
          sourceDeliveryId: deliveryId,
          eventId: planned.eventId,
          revisionBefore: revision,
          revisionAfter: revision + 1,
          conditionBefore: condition,
          conditionDelta: derived.truckConditionDelta,
          conditionAfter: nextCondition,
          cashTransactionId:
            cashDelta !== 0
              ? createCanonicalIncidentCashTransactionId(deliveryId, planned.eventId)
              : null,
          cashDelta,
          policyVersion: CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
          createdAtMs: nowMs,
          authoritySource: asset.authoritySource,
        };
        condition = nextCondition;
        revision += 1;
      } else {
        condition = nextCondition;
      }
    }

    if (cashMutations.length > 0) {
      const cash = await applyCanonicalCashMutationsInTransaction(
        transaction,
        firestore,
        uid,
        cashMutations,
        nowMs,
      );
      if (!cash.ok) {
        return { ok: false as const, reason: cash.reason, deliveryId };
      }
    }

    if (incidentReceipt) {
      const rRef = firestore.doc(receiptPath(uid, incidentReceipt.operationId));
      const existingReceipt = await transaction.get(rRef);
      if (existingReceipt.exists) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', deliveryId };
      }
      transaction.create(rRef, incidentReceipt);
      transaction.update(aRef, {
        economicCondition: incidentReceipt.conditionAfter,
        economicRevision: incidentReceipt.revisionAfter,
        updatedAtMs: nowMs,
      });
    }

    const snapshot = delivery.executionEconomicsSnapshot;
    transaction.update(dRef, {
      incidentConditionAuthority: 'RESOLVED',
      executionEvents: events,
      executionFinalizedAtMs: nowMs,
      executionEconomicsSnapshot: snapshot
        ? { ...snapshot, completionTruckCondition: condition }
        : snapshot,
    });

    return {
      ok: true as const,
      alreadyApplied: false,
      deliveryId,
      completionTruckCondition: condition,
      events,
    };
  });
}