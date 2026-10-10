/**
 * Canonical ROAD contract batch issuance (Map V2 Step 29G).
 * Internal policy only. No cash mutation. Client cannot choose economics.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_ROAD_CONTRACT_BATCHES_COLLECTION,
  CANONICAL_ROAD_CONTRACT_SCHEMA_VERSION,
  CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK,
  hasOnlyCanonicalRoadIssuanceKeys,
  prepareCanonicalRoadContractBatch,
} from '../../src/domain/canonicalRoadContract';
import { CANONICAL_ROAD_CONTRACTS_COLLECTION } from '../../src/domain/canonicalRoadDelivery';
import type { CanonicalRoadContractDocument } from './canonicalRoadDelivery';

export { hasOnlyCanonicalRoadIssuanceKeys };

export type CanonicalRoadBatchDocument = {
  ownerUid: string;
  batchId: string;
  windowId: number;
  issuedAtMs: number;
  expiresAtMs: number;
  generationSeed: number;
  policyVersion: string;
  contractIds: string[];
};

export type GetOrIssueCanonicalRoadContractsResult =
  | {
      ok: true;
      batchId: string;
      issuedAtMs: number;
      expiresAtMs: number;
      alreadyIssued: boolean;
      contracts: Array<{
        contractId: string;
        originCityId: string;
        destinationCityId: string;
        productId: string;
        cargoAmount: number;
        payment: number;
        deadlineHours: number;
        distanceKm: number;
        tollCost: number;
        requiredLevel: number;
        status: string;
      }>;
    }
  | { ok: false; reason: string };

function isAuthenticatedUid(uid: string): boolean {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

function batchRef(uid: string, batchId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_CONTRACT_BATCHES_COLLECTION}/${batchId}`;
}

function contractRef(uid: string, contractId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_CONTRACTS_COLLECTION}/${contractId}`;
}

function toPublicContract(doc: CanonicalRoadContractDocument) {
  return {
    contractId: doc.contractId,
    originCityId: doc.originCityId,
    destinationCityId: doc.destinationCityId,
    productId: doc.productId,
    cargoAmount: doc.amount,
    payment: doc.payment,
    deadlineHours: doc.deadlineHours,
    distanceKm: doc.distanceKm,
    tollCost: doc.tollCost,
    requiredLevel: doc.requiredLevel,
    status: doc.status,
  };
}

export async function getOrIssueCanonicalRoadContractsTransaction(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  fuelPricePerLiter = CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK,
): Promise<GetOrIssueCanonicalRoadContractsResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }
  const prepared = prepareCanonicalRoadContractBatch({ uid, nowMs, fuelPricePerLiter });
  if ('ok' in prepared && prepared.ok === false) {
    return { ok: false, reason: prepared.reason };
  }
  const batch = prepared as Exclude<typeof prepared, { ok: false; reason: string }>;

  return firestore.runTransaction(async (transaction) => {
    const bRef = firestore.doc(batchRef(uid, batch.batchId));
    const existingBatch = await transaction.get(bRef);
    if (existingBatch.exists) {
      const data = existingBatch.data() as CanonicalRoadBatchDocument;
      const contracts: CanonicalRoadContractDocument[] = [];
      for (const contractId of data.contractIds) {
        const snap = await transaction.get(firestore.doc(contractRef(uid, contractId)));
        if (snap.exists) {
          contracts.push(snap.data() as CanonicalRoadContractDocument);
        }
      }
      return {
        ok: true as const,
        batchId: data.batchId,
        issuedAtMs: data.issuedAtMs,
        expiresAtMs: data.expiresAtMs,
        alreadyIssued: true,
        contracts: contracts.map(toPublicContract),
      };
    }

    const batchDoc: CanonicalRoadBatchDocument = {
      ownerUid: uid,
      batchId: batch.batchId,
      windowId: batch.windowId,
      issuedAtMs: batch.issuedAtMs,
      expiresAtMs: batch.expiresAtMs,
      generationSeed: batch.generationSeed,
      policyVersion: CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
      contractIds: batch.contracts.map((item) => item.contractId),
    };
    transaction.create(bRef, batchDoc);
    const created: CanonicalRoadContractDocument[] = [];
    for (const snapshot of batch.contracts) {
      const doc: CanonicalRoadContractDocument = {
        ...snapshot,
        ownerUid: uid,
        issuedAtMs: batch.issuedAtMs,
        expiresAtMs: batch.expiresAtMs,
        status: 'AVAILABLE',
        batchId: batch.batchId,
        issuancePolicyVersion: CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
        generationSeed: batch.generationSeed,
      };
      transaction.create(firestore.doc(contractRef(uid, snapshot.contractId)), doc);
      created.push(doc);
    }
    return {
      ok: true as const,
      batchId: batch.batchId,
      issuedAtMs: batch.issuedAtMs,
      expiresAtMs: batch.expiresAtMs,
      alreadyIssued: false,
      contracts: created.map(toPublicContract),
    };
  });
}

export function assertIssuanceSchema(schemaVersion: unknown): boolean {
  return Number(schemaVersion) === CANONICAL_ROAD_CONTRACT_SCHEMA_VERSION;
}
