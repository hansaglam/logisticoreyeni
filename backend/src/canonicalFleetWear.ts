/**
 * Canonical ROAD delivery-wear persistence (Step 29M).
 * No cash mutation. Client cannot supply wear/condition.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_ROAD_DELIVERIES_COLLECTION,
  CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
  isValidCanonicalRoadDocId,
} from '../../src/domain/canonicalRoadDelivery';
import { CANONICAL_FLEET_ASSETS_COLLECTION, parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION,
  CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2,
  buildCanonicalDeliveryWearReceipt,
  classifyCanonicalDeliveryWear,
  createCanonicalDeliveryWearOperationId,
  deriveCanonicalDeliveryWearFromFrozenSnapshot,
  isCanonicalDeliveryWearReady,
  type CanonicalFleetWearMutationReceipt,
} from '../../src/domain/canonicalFleetConditionWear';
import { isValidCanonicalRoadDriverSnapshot } from '../../src/domain/canonicalDeliveryRiskDriver';
import { isAuthenticatedUid } from './canonicalCashTransaction';
import { deriveCanonicalMileageIncrementKm } from '../../src/domain/canonicalCoreVehicleStaffCash';
import type { CanonicalRoadDeliveryDocument } from './canonicalRoadDelivery';

export type ApplyCanonicalRoadWearResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalFleetWearMutationReceipt;
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

export async function applyCanonicalRoadDeliveryWearTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  nowMs: number,
): Promise<ApplyCanonicalRoadWearResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED', deliveryId };
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
    const assetId = delivery.executionEconomicsSnapshot?.truckEconomicProfile.truckId;
    if (!assetId) {
      return { ok: false as const, reason: 'LEGACY_FLEET_UNVERIFIED', deliveryId };
    }
    const operationId = createCanonicalDeliveryWearOperationId(assetId, deliveryId);
    const aRef = firestore.doc(assetPath(uid, assetId));
    const rRef = firestore.doc(receiptPath(uid, operationId));
    const [assetSnap, receiptSnap] = await Promise.all([
      transaction.get(aRef),
      transaction.get(rRef),
    ]);

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalFleetWearMutationReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.sourceDeliveryId !== deliveryId ||
        existing.assetId !== assetId ||
        existing.operationType !== 'ROAD_DELIVERY_WEAR'
      ) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', deliveryId };
      }
      const parsedExisting = parseCanonicalFleetAsset(
        assetSnap.exists ? (assetSnap.data() as Record<string, unknown>) : undefined,
        'TRUCK',
      );
      if (
        parsedExisting.ok &&
        parsedExisting.asset.economicRevision === existing.revisionAfter &&
        parsedExisting.asset.economicCondition === existing.conditionAfter
      ) {
        return { ok: true as const, alreadyApplied: true, receipt: existing };
      }
      return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', deliveryId };
    }

    const parsed = parseCanonicalFleetAsset(
      assetSnap.exists ? (assetSnap.data() as Record<string, unknown>) : undefined,
      'TRUCK',
    );
    const asset = parsed.ok ? parsed.asset : null;
    const eligibility = classifyCanonicalDeliveryWear({
      delivery: {
        deliveryId: delivery.deliveryId,
        ownerUid: delivery.ownerUid,
        lifecycleState: delivery.lifecycleState,
        completionOutcome: delivery.completionOutcome,
        wearApplicationState: delivery.wearApplicationState,
        incidentConditionAuthority: delivery.incidentConditionAuthority ?? 'NONE',
        failureAuthorityClass: delivery.failureAuthorityClass ?? null,
        executionEconomicsSnapshot: delivery.executionEconomicsSnapshot,
      },
      asset,
      callerUid: uid,
    });
    if (!isCanonicalDeliveryWearReady(eligibility) || !asset || !parsed.ok) {
      return { ok: false as const, reason: eligibility, deliveryId };
    }
    if (!delivery.executionEconomicsSnapshot) {
      return { ok: false as const, reason: 'SCHEMA_UNSUPPORTED', deliveryId };
    }
    const driverSnapshot = (delivery as { canonicalDriverSnapshot?: unknown }).canonicalDriverSnapshot;
    const wearDriverAttention = isValidCanonicalRoadDriverSnapshot(driverSnapshot)
      ? driverSnapshot.attention
      : undefined;
    const derived = deriveCanonicalDeliveryWearFromFrozenSnapshot(
      delivery.executionEconomicsSnapshot,
      {
        originCityId: delivery.originCityId,
        destinationCityId: delivery.destinationCityId,
        productId: delivery.productId,
        amount: delivery.amount,
        distanceKm: delivery.distanceKm,
      },
      asset,
      wearDriverAttention,
    );
    if (!derived.ok) {
      return { ok: false as const, reason: derived.reason, deliveryId };
    }
    const wearAmount =
      delivery.failureAuthorityClass === 'SERVER_DERIVED_FAILURE'
        ? derived.wear * 0.5
        : derived.wear;
    const receipt = buildCanonicalDeliveryWearReceipt({
      asset,
      deliveryId,
      wearAmount,
      nowMs,
      ...(wearDriverAttention != null
        ? { policyVersion: CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2, wearDriverAttention }
        : {}),
    });
    const mileage = deriveCanonicalMileageIncrementKm({
      completionOutcome: delivery.completionOutcome,
      failureAuthorityClass: delivery.failureAuthorityClass,
      distanceKm: delivery.distanceKm,
    });
    const mileageIncrement = mileage.ok ? mileage.incrementKm : 0;
    transaction.create(rRef, receipt);
    transaction.update(aRef, {
      economicCondition: receipt.conditionAfter,
      economicRevision: receipt.revisionAfter,
      updatedAtMs: nowMs,
      activeCanonicalRoadDeliveryId: null,
      reservedAtMs: null,
      reservationRevision: null,
      mileageKm: (asset.mileageKm ?? 0) + mileageIncrement,
      mileageRevision: (asset.mileageRevision ?? 1) + (mileageIncrement > 0 ? 1 : 0),
    });
    transaction.update(dRef, {
      wearApplicationState: 'APPLIED',
      wearOperationId: receipt.operationId,
    });
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export { CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION };
