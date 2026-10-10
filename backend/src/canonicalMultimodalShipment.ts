/**
 * Server-owned canonical multimodal shipment (Map V2 Step 29C).
 * No money mutation. No ROAD canonicalDeliveryCompletions reuse.
 */

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_MULTIMODAL_AUTHORITY_SCOPE,
  CANONICAL_MULTIMODAL_SHIPMENT_COLLECTION,
  CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
  computeCanonicalMultimodalRailAcceptance,
  isValidCanonicalMultimodalShipmentId,
  snapshotsConflict,
  type CanonicalMultimodalEconomicsSnapshot,
} from '../../src/domain/canonicalMultimodalRailEconomics';

export { isValidCanonicalMultimodalShipmentId };
import type { MultimodalRoadTransferAccessArtifactV1 } from '../../src/domain/multimodalRoadAccess';
import { runFirestoreTransactionWithRetry } from './firestoreTransactionUtils';

import turkeyRoadTransferAccess from '../../src/mapV2/generated/multimodal/turkey-road-transfer-access.json';

export type CanonicalMultimodalLifecycleState =
  | 'ACCEPTED'
  | 'COMPLETION_REPORTED'
  | 'SETTLED'
  | 'CANCELLED';

export type CanonicalMultimodalShipmentDocument = CanonicalMultimodalEconomicsSnapshot & {
  ownerUid: string;
  lifecycleState: CanonicalMultimodalLifecycleState;
  acceptedAtMs: number;
  completedAtMs: number | null;
  cancelledAtMs: number | null;
  recordVersion: number;
};

export type CanonicalAcceptanceReceipt = {
  shipmentId: string;
  canonicalSchemaVersion: typeof CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION;
  acceptedAtMs: number;
  sourceOfferId: string;
  playerPayment: number;
  railCarrierCost: number;
  estimatedRoadOperatingCost: number;
  expectedGrossMargin: number;
  currency: CanonicalMultimodalEconomicsSnapshot['currency'];
  policyVersions: {
    railTariffPolicyVersion: CanonicalMultimodalEconomicsSnapshot['railTariffPolicyVersion'];
    offerEconomicsPolicyVersion: CanonicalMultimodalEconomicsSnapshot['offerEconomicsPolicyVersion'];
  };
  canonicalRecordVersion: number;
  alreadyAccepted: boolean;
  authorityScope: typeof CANONICAL_MULTIMODAL_AUTHORITY_SCOPE;
};

export type AcceptCanonicalResult =
  | { ok: true; receipt: CanonicalAcceptanceReceipt }
  | {
      ok: false;
      reason: string;
      shipmentId?: string;
    };

export type ReportCanonicalResult =
  | {
      ok: true;
      shipmentId: string;
      lifecycleState: CanonicalMultimodalLifecycleState;
      alreadyReported: boolean;
    }
  | { ok: false; reason: string; shipmentId: string };

export type CancelCanonicalResult =
  | {
      ok: true;
      shipmentId: string;
      lifecycleState: 'CANCELLED';
      alreadyCancelled: boolean;
    }
  | { ok: false; reason: string; shipmentId: string };

const ACCEPT_KEYS = [
  'generationSeed',
  'originCityId',
  'destinationCityId',
  'productId',
  'cargoQuantity',
  'sourceOfferId',
  'transportPattern',
  'playerLevel',
  'canonicalSchemaVersion',
] as const;

export function canonicalMultimodalShipmentRef(
  firestore: Firestore,
  uid: string,
  shipmentId: string,
) {
  return firestore.doc(`users/${uid}/${CANONICAL_MULTIMODAL_SHIPMENT_COLLECTION}/${shipmentId}`);
}

export function getCanonicalRoadTransferAccessArtifact(): MultimodalRoadTransferAccessArtifactV1 {
  return turkeyRoadTransferAccess as MultimodalRoadTransferAccessArtifactV1;
}

export function isCanonicalInternalTestAuthorityEnabled(
  envValue: string | undefined = process.env.MULTIMODAL_INTERNAL_TEST_AUTHORITY,
): boolean {
  return envValue === 'INTERNAL_TEST';
}

export function hasOnlyAcceptKeys(data: Record<string, unknown>): boolean {
  const allowed = new Set<string>(ACCEPT_KEYS);
  return Object.keys(data).every((key) => allowed.has(key));
}

function snapshotFromDoc(data: Record<string, unknown>): CanonicalMultimodalEconomicsSnapshot | null {
  if (
    typeof data.shipmentId !== 'string' ||
    typeof data.sourceOfferId !== 'string' ||
    typeof data.originCityId !== 'string' ||
    typeof data.destinationCityId !== 'string' ||
    typeof data.productId !== 'string' ||
    typeof data.cargoQuantity !== 'number' ||
    typeof data.playerPayment !== 'number' ||
    typeof data.railCarrierCost !== 'number' ||
    typeof data.generationSeed !== 'string' ||
    data.currency !== 'USD_GAME_INTEGER'
  ) {
    return null;
  }
  return data as unknown as CanonicalMultimodalEconomicsSnapshot;
}

function receiptFromDoc(
  data: CanonicalMultimodalShipmentDocument,
  alreadyAccepted: boolean,
): CanonicalAcceptanceReceipt {
  return {
    shipmentId: data.shipmentId,
    canonicalSchemaVersion: CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
    acceptedAtMs: data.acceptedAtMs,
    sourceOfferId: data.sourceOfferId,
    playerPayment: data.playerPayment,
    railCarrierCost: data.railCarrierCost,
    estimatedRoadOperatingCost: data.estimatedRoadOperatingCost,
    expectedGrossMargin: data.expectedGrossMargin,
    currency: data.currency,
    policyVersions: {
      railTariffPolicyVersion: data.railTariffPolicyVersion,
      offerEconomicsPolicyVersion: data.offerEconomicsPolicyVersion,
    },
    canonicalRecordVersion: data.recordVersion,
    alreadyAccepted,
    authorityScope: CANONICAL_MULTIMODAL_AUTHORITY_SCOPE,
  };
}

export async function acceptCanonicalMultimodalShipmentTransaction(
  firestore: Firestore,
  uid: string,
  request: Record<string, unknown>,
  nowMs = Date.now(),
  options?: { allowAcceptance?: boolean },
): Promise<AcceptCanonicalResult> {
  if (!uid) {
    return { ok: false, reason: 'auth-required' };
  }
  const allow =
    options?.allowAcceptance ?? isCanonicalInternalTestAuthorityEnabled();
  const computed = computeCanonicalMultimodalRailAcceptance({
    generationSeed: request.generationSeed,
    originCityId: request.originCityId,
    destinationCityId: request.destinationCityId,
    productId: request.productId,
    cargoQuantity: request.cargoQuantity,
    sourceOfferId: request.sourceOfferId,
    transportPattern: request.transportPattern,
    playerLevel: request.playerLevel,
    canonicalSchemaVersion: request.canonicalSchemaVersion,
    allowAcceptance: allow,
    accessArtifact: getCanonicalRoadTransferAccessArtifact(),
  });
  if (computed.status !== 'READY') {
    return { ok: false, reason: computed.reason };
  }
  const snapshot = computed.snapshot;
  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const ref = canonicalMultimodalShipmentRef(firestore, uid, snapshot.shipmentId);
      const existingSnap = await transaction.get(ref);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as CanonicalMultimodalShipmentDocument;
        const existingSnapshot = snapshotFromDoc(existing as unknown as Record<string, unknown>);
        if (!existingSnapshot || snapshotsConflict(existingSnapshot, snapshot)) {
          return { ok: false as const, reason: 'CANONICAL_ACCEPTANCE_CONFLICT', shipmentId: snapshot.shipmentId };
        }
        if (existing.lifecycleState === 'CANCELLED') {
          return { ok: false as const, reason: 'CANCELLED_SHIPMENT', shipmentId: snapshot.shipmentId };
        }
        return {
          ok: true as const,
          receipt: receiptFromDoc(existing, true),
        };
      }
      const acceptedAt = Timestamp.fromMillis(nowMs);
      const document: CanonicalMultimodalShipmentDocument = {
        ...snapshot,
        ownerUid: uid,
        lifecycleState: 'ACCEPTED',
        acceptedAtMs: nowMs,
        completedAtMs: null,
        cancelledAtMs: null,
        recordVersion: 1,
      };
      transaction.create(ref, {
        ...document,
        acceptedAt,
      });
      return {
        ok: true as const,
        receipt: receiptFromDoc(document, false),
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable', shipmentId: snapshot.shipmentId };
  }
}

export async function reportCanonicalMultimodalShipmentCompletedTransaction(
  firestore: Firestore,
  uid: string,
  shipmentId: unknown,
  nowMs = Date.now(),
): Promise<ReportCanonicalResult> {
  const id = typeof shipmentId === 'string' ? shipmentId : '';
  if (!uid) {
    return { ok: false, reason: 'auth-required', shipmentId: id };
  }
  if (!isValidCanonicalMultimodalShipmentId(id)) {
    return { ok: false, reason: 'invalid-request', shipmentId: id };
  }
  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const ref = canonicalMultimodalShipmentRef(firestore, uid, id);
      const snap = await transaction.get(ref);
      if (!snap.exists) {
        return { ok: false as const, reason: 'SHIPMENT_NOT_FOUND', shipmentId: id };
      }
      const data = snap.data() as CanonicalMultimodalShipmentDocument;
      if (data.lifecycleState === 'CANCELLED') {
        return { ok: false as const, reason: 'CANCELLED_SHIPMENT', shipmentId: id };
      }
      if (data.lifecycleState === 'SETTLED' || data.lifecycleState === 'COMPLETION_REPORTED') {
        return {
          ok: true as const,
          shipmentId: id,
          lifecycleState: data.lifecycleState,
          alreadyReported: true,
        };
      }
      if (data.lifecycleState !== 'ACCEPTED') {
        return { ok: false as const, reason: 'INVALID_LIFECYCLE', shipmentId: id };
      }
      transaction.update(ref, {
        lifecycleState: 'COMPLETION_REPORTED',
        completedAtMs: nowMs,
        completedAt: Timestamp.fromMillis(nowMs),
        recordVersion: (data.recordVersion ?? 1) + 1,
      });
      return {
        ok: true as const,
        shipmentId: id,
        lifecycleState: 'COMPLETION_REPORTED' as const,
        alreadyReported: false,
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable', shipmentId: id };
  }
}

export async function cancelCanonicalMultimodalShipmentTransaction(
  firestore: Firestore,
  uid: string,
  shipmentId: unknown,
  nowMs = Date.now(),
): Promise<CancelCanonicalResult> {
  const id = typeof shipmentId === 'string' ? shipmentId : '';
  if (!uid) {
    return { ok: false, reason: 'auth-required', shipmentId: id };
  }
  if (!isValidCanonicalMultimodalShipmentId(id)) {
    return { ok: false, reason: 'invalid-request', shipmentId: id };
  }
  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const ref = canonicalMultimodalShipmentRef(firestore, uid, id);
      const snap = await transaction.get(ref);
      if (!snap.exists) {
        return { ok: false as const, reason: 'SHIPMENT_NOT_FOUND', shipmentId: id };
      }
      const data = snap.data() as CanonicalMultimodalShipmentDocument;
      if (data.lifecycleState === 'SETTLED') {
        return { ok: false as const, reason: 'ALREADY_SETTLED', shipmentId: id };
      }
      if (data.lifecycleState === 'CANCELLED') {
        return {
          ok: true as const,
          shipmentId: id,
          lifecycleState: 'CANCELLED' as const,
          alreadyCancelled: true,
        };
      }
      transaction.update(ref, {
        lifecycleState: 'CANCELLED',
        cancelledAtMs: nowMs,
        cancelledAt: Timestamp.fromMillis(nowMs),
        recordVersion: (data.recordVersion ?? 1) + 1,
      });
      return {
        ok: true as const,
        shipmentId: id,
        lifecycleState: 'CANCELLED' as const,
        alreadyCancelled: false,
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable', shipmentId: id };
  }
}
