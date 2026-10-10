/**
 * INTERNAL_TEST canonical catalog purchase (Step 29P).
 * Server derives catalog price and mints canonicalFleetAsset atomically with cash.
 * Does not mutate player.money / users/{uid}.money / saves.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { buildCanonicalFleetAssetFromCatalogPurchase } from '../../src/domain/canonicalProductionFleet';
import {
  CANONICAL_CATALOG_PURCHASE_POLICY_VERSION,
  CANONICAL_PURCHASE_AUTHORITY_VERSION,
  CANONICAL_PURCHASE_RECEIPTS_COLLECTION,
  createCanonicalCatalogAssetId,
  createCanonicalCatalogPurchaseTransactionId,
  deriveCanonicalCatalogPurchasePrice,
  isCanonicalCatalogAssetType,
  isCanonicalCatalogPurchaseAllowed,
  isValidCanonicalPurchaseId,
  type CanonicalPurchaseReceipt,
} from '../../src/domain/remainingRoadCashPathCanonicalization';
import {
  buildCanonicalTruckPurchaseProgressionInput,
  progressionTruckPurchaseOperationId,
  type CanonicalNonDeliveryXpOutcome,
} from '../../src/domain/canonicalNonDeliveryCompanyXp';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
} from './canonicalCashTransaction';
import {
  applyNonDeliveryXpInTransaction,
  precheckNonDeliveryXpForNewOperation,
  readNonDeliveryXpContext,
  resolveNonDeliveryXpReplay,
  type NonDeliveryXpOptions,
} from './canonicalNonDeliveryCompanyXp';

export type PurchaseCanonicalCatalogResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalPurchaseReceipt;
      progression: CanonicalNonDeliveryXpOutcome;
    }
  | { ok: false; reason: string };

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

function receiptPath(uid: string, purchaseId: string): string {
  return `users/${uid}/${CANONICAL_PURCHASE_RECEIPTS_COLLECTION}/${purchaseId}`;
}

export async function purchaseCanonicalCatalogAssetTransaction(
  firestore: Firestore,
  uid: string,
  catalogModelId: string,
  purchaseId: string,
  assetTypeRaw: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<PurchaseCanonicalCatalogResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCatalogPurchaseAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CATALOG_PURCHASE_OFF' };
  }
  if (!isValidCanonicalPurchaseId(purchaseId)) {
    return { ok: false, reason: 'INVALID_PURCHASE_ID' };
  }
  if (!isCanonicalCatalogAssetType(assetTypeRaw)) {
    return { ok: false, reason: 'INVALID_ASSET_TYPE' };
  }
  if (typeof catalogModelId !== 'string' || catalogModelId.length < 1 || catalogModelId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_CATALOG_MODEL' };
  }

  const priced = deriveCanonicalCatalogPurchasePrice(catalogModelId, assetTypeRaw);
  if (!priced.ok) return priced;
  const built = buildCanonicalFleetAssetFromCatalogPurchase({
    uid,
    catalogModelId: priced.catalogId,
    purchaseId,
    nowMs,
    assetType: assetTypeRaw,
  });
  if (!built.ok) return built;

  const assetId = createCanonicalCatalogAssetId(assetTypeRaw, purchaseId);
  if (built.asset.assetId !== assetId) {
    return { ok: false, reason: 'CANONICAL_FLEET_ASSET_CONFLICT' };
  }
  const transactionId = createCanonicalCatalogPurchaseTransactionId(assetId, purchaseId);
  const progressionOperationId =
    assetTypeRaw === 'TRUCK' ? progressionTruckPurchaseOperationId(purchaseId) : null;

  return firestore.runTransaction(async (transaction) => {
    const aRef = firestore.doc(assetPath(uid, assetId));
    const rRef = firestore.doc(receiptPath(uid, purchaseId));
    const [assetSnap, receiptSnap] = await Promise.all([
      transaction.get(aRef),
      transaction.get(rRef),
    ]);
    const xpContext = await readNonDeliveryXpContext(
      transaction,
      firestore,
      uid,
      progressionOperationId,
      options,
    );

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalPurchaseReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.purchaseId !== purchaseId ||
        existing.assetId !== assetId ||
        existing.catalogId !== priced.catalogId ||
        existing.price !== priced.price ||
        existing.transactionId !== transactionId
      ) {
        return { ok: false as const, reason: 'CANONICAL_PURCHASE_CONFLICT' };
      }
      if (!assetSnap.exists) {
        return { ok: false as const, reason: 'CANONICAL_PURCHASE_CONFLICT' };
      }
      const replay = resolveNonDeliveryXpReplay(xpContext, progressionOperationId, 'COMPANY_TRUCK_PURCHASE');
      if (!replay.ok) return replay;
      return { ok: true as const, alreadyApplied: true, receipt: existing, progression: replay.outcome };
    }

    if (assetSnap.exists) {
      return { ok: false as const, reason: 'CANONICAL_PURCHASE_CONFLICT' };
    }
    const precheck = precheckNonDeliveryXpForNewOperation(xpContext, progressionOperationId);
    if (!precheck.ok) return precheck;

    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_CATALOG_PURCHASE',
          sourceId: assetId,
          amountDelta: -priced.price,
          nowMs,
          metadata: {
            catalogId: priced.catalogId,
            assetType: assetTypeRaw,
            policyVersion: CANONICAL_CATALOG_PURCHASE_POLICY_VERSION,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) {
      return { ok: false as const, reason: cash.reason };
    }
    if (cash.alreadyApplied) {
      return { ok: false as const, reason: 'CANONICAL_PURCHASE_CONFLICT' };
    }

    const receipt: CanonicalPurchaseReceipt = {
      purchaseId,
      assetId,
      catalogId: priced.catalogId,
      assetType: assetTypeRaw,
      cashBefore: cash.cashBefore,
      price: priced.price,
      cashAfter: cash.cashAfter,
      transactionId,
      createdAt: nowMs,
      authorityVersion: CANONICAL_PURCHASE_AUTHORITY_VERSION,
      policyVersion: CANONICAL_CATALOG_PURCHASE_POLICY_VERSION,
      ownerUid: uid,
    };
    transaction.create(aRef, built.asset);
    transaction.create(rRef, receipt);
    const progression = applyNonDeliveryXpInTransaction(
      transaction,
      firestore,
      uid,
      xpContext,
      buildCanonicalTruckPurchaseProgressionInput(receipt, nowMs),
    );
    return { ok: true as const, alreadyApplied: false, receipt, progression };
  });
}
