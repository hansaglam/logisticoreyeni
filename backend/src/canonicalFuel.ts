/**
 * Canonical fuel purchase / accept-burn (Step 29Q).
 * INTERNAL_TEST. Mutates canonical tank + optional serverState.cash.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION, parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { isValidCanonicalFleetAssetId } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_FUEL_CONSUMPTION_POLICY_VERSION,
  CANONICAL_FUEL_PRICE_POLICY_VERSION,
  CANONICAL_FUEL_RECEIPTS_COLLECTION,
  CANONICAL_FUEL_STATE_POLICY_VERSION,
  createCanonicalFuelConsumptionOperationId,
  createCanonicalFuelPurchaseOperationId,
  deriveCanonicalFuelPricePerLiter,
  deriveCanonicalRoadFuelRequirement,
  isCanonicalFuelAuthorityAllowed,
  isCanonicalFuelPurchaseMode,
  isValidCanonicalFuelIntentId,
  quoteCanonicalFuelPurchase,
  withCanonicalFuelState,
  type CanonicalFuelPurchaseMode,
  type CanonicalFuelReceipt,
} from '../../src/domain/canonicalFuelTankPrice';
import { isCanonicalProgressiveFuelAllowed } from '../../src/domain/canonicalProgressiveFuel';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
} from './canonicalCashTransaction';

export type PurchaseCanonicalFuelResult =
  | { ok: true; alreadyApplied: boolean; notNeeded?: boolean; receipt: CanonicalFuelReceipt | null }
  | { ok: false; reason: string };

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

function receiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_FUEL_RECEIPTS_COLLECTION}/${operationId}`;
}

export async function purchaseCanonicalFuelTransaction(
  firestore: Firestore,
  uid: string,
  assetId: string,
  fuelPurchaseIntentId: string,
  modeRaw: string,
  nowMs: number,
  options?: {
    envValue?: string | null;
    requestedLiters?: number;
    fuelPriceRaw?: unknown;
  },
): Promise<PurchaseCanonicalFuelResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalFuelAuthorityAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_FUEL_AUTHORITY_OFF' };
  }
  if (!isValidCanonicalFleetAssetId(assetId)) {
    return { ok: false, reason: 'LEGACY_FLEET_UNVERIFIED' };
  }
  if (!isValidCanonicalFuelIntentId(fuelPurchaseIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID' };
  }
  if (!isCanonicalFuelPurchaseMode(modeRaw)) {
    return { ok: false, reason: 'INVALID_FUEL_MODE' };
  }
  const mode: CanonicalFuelPurchaseMode = modeRaw;
  const priced = deriveCanonicalFuelPricePerLiter(options?.fuelPriceRaw);
  const operationId = createCanonicalFuelPurchaseOperationId(assetId, fuelPurchaseIntentId);

  return firestore.runTransaction(async (transaction) => {
    const aRef = firestore.doc(assetPath(uid, assetId));
    const rRef = firestore.doc(receiptPath(uid, operationId));
    const [assetSnap, receiptSnap] = await Promise.all([
      transaction.get(aRef),
      transaction.get(rRef),
    ]);
    const parsed = parseCanonicalFleetAsset(
      assetSnap.exists ? (assetSnap.data() as Record<string, unknown>) : undefined,
      'TRUCK',
    );
    if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
    if (parsed.asset.ownerUid !== uid) return { ok: false as const, reason: 'CANONICAL_TRUCK_NOT_OWNED' };

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalFuelReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.assetId !== assetId ||
        existing.operationId !== operationId ||
        existing.operationType !== 'PURCHASE'
      ) {
        return { ok: false as const, reason: 'CANONICAL_FUEL_OPERATION_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }

    const fueled = withCanonicalFuelState(parsed.asset);
    const quote = quoteCanonicalFuelPurchase({
      asset: fueled,
      mode,
      requestedLiters: options?.requestedLiters,
      pricePerLiter: priced.pricePerLiter,
    });
    if (!quote.ok) return quote;
    if (quote.notNeeded) {
      return { ok: true as const, alreadyApplied: false, notNeeded: true, receipt: null };
    }
    if (quote.cost <= 0) {
      return { ok: false as const, reason: 'INVALID_REQUESTED_LITERS' };
    }

    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId: operationId,
          operationType: 'CANONICAL_FUEL_PURCHASE',
          sourceId: assetId,
          amountDelta: -quote.cost,
          nowMs,
          metadata: {
            mode,
            liters: quote.litersToAdd,
            pricePerLiter: priced.pricePerLiter,
            policyVersion: CANONICAL_FUEL_PRICE_POLICY_VERSION,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) {
      return { ok: false as const, reason: 'CANONICAL_FUEL_OPERATION_CONFLICT' };
    }

    const receipt: CanonicalFuelReceipt = {
      operationId,
      operationType: 'PURCHASE',
      assetId,
      ownerUid: uid,
      mode,
      litersDelta: quote.litersToAdd,
      fuelBefore: quote.fuelBefore,
      fuelAfter: quote.fuelAfter,
      fuelCapacityL: quote.fuelCapacityL,
      pricePerLiter: priced.pricePerLiter,
      cost: quote.cost,
      cashBefore: cash.cashBefore,
      cashAfter: cash.cashAfter,
      cashTransactionId: operationId,
      fuelRevisionBefore: fueled.fuelRevision ?? 1,
      fuelRevisionAfter: (fueled.fuelRevision ?? 1) + 1,
      pricePolicyVersion: CANONICAL_FUEL_PRICE_POLICY_VERSION,
      fuelPolicyVersion: CANONICAL_FUEL_STATE_POLICY_VERSION,
      consumptionPolicyVersion: null,
      deliveryId: null,
      createdAtMs: nowMs,
      authoritySource: fueled.authoritySource,
    };
    transaction.update(aRef, {
      fuelStateSchemaVersion: 1,
      currentFuelL: quote.fuelAfter,
      fuelCapacityL: quote.fuelCapacityL,
      fuelRevision: receipt.fuelRevisionAfter,
      fuelPolicyVersion: CANONICAL_FUEL_STATE_POLICY_VERSION,
      updatedAtMs: nowMs,
    });
    transaction.create(rRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export async function applyCanonicalFuelAcceptBurnInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  asset: ReturnType<typeof withCanonicalFuelState>,
  deliveryId: string,
  contract: {
    originCityId: string;
    destinationCityId: string;
    amount: number;
    payment: number;
    urgency?: number;
    driverFuelSaving?: number | null;
  },
  nowMs: number,
  options?: { envValue?: string | null; progressiveEnvValue?: string | null },
): Promise<
  | {
      ok: true;
      asset: ReturnType<typeof withCanonicalFuelState>;
      alreadyApplied: boolean;
      skipped?: boolean;
      progressiveHold?: boolean;
      requiredFuelL?: number;
    }
  | { ok: false; reason: string }
> {
  const fueled = withCanonicalFuelState(asset);
  if (isCanonicalProgressiveFuelAllowed({ envValue: options?.progressiveEnvValue })) {
    const required = deriveCanonicalRoadFuelRequirement({
      truckAsset: fueled,
      trailerAsset: null,
      originCityId: contract.originCityId,
      destinationCityId: contract.destinationCityId,
      amount: contract.amount,
      payment: contract.payment,
      urgency: contract.urgency,
      driverFuelSaving: contract.driverFuelSaving,
    });
    if (!required.ok) return required;
    const fuelBefore = fueled.currentFuelL ?? 0;
    if (fuelBefore + 1e-6 < required.requiredFuelL) {
      return { ok: false, reason: 'CANONICAL_FUEL_INSUFFICIENT' };
    }
    return {
      ok: true,
      asset: fueled,
      alreadyApplied: false,
      skipped: true,
      progressiveHold: true,
      requiredFuelL: required.requiredFuelL,
    };
  }
  if (!isCanonicalFuelAuthorityAllowed(options)) {
    return { ok: true, asset, alreadyApplied: false, skipped: true };
  }
  const operationId = createCanonicalFuelConsumptionOperationId(fueled.assetId, deliveryId);
  const rRef = firestore.doc(receiptPath(uid, operationId));
  const receiptSnap = await transaction.get(rRef);
  if (receiptSnap.exists) {
    const existing = receiptSnap.data() as CanonicalFuelReceipt;
    if (existing.ownerUid !== uid || existing.deliveryId !== deliveryId) {
      return { ok: false, reason: 'CANONICAL_FUEL_OPERATION_CONFLICT' };
    }
    return { ok: true, asset: fueled, alreadyApplied: true };
  }
  const required = deriveCanonicalRoadFuelRequirement({
    truckAsset: fueled,
    trailerAsset: null,
    originCityId: contract.originCityId,
    destinationCityId: contract.destinationCityId,
    amount: contract.amount,
    payment: contract.payment,
    urgency: contract.urgency,
    driverFuelSaving: contract.driverFuelSaving,
  });
  if (!required.ok) return required;
  const fuelBefore = fueled.currentFuelL ?? 0;
  if (fuelBefore + 1e-6 < required.requiredFuelL) {
    return { ok: false, reason: 'CANONICAL_FUEL_INSUFFICIENT' };
  }
  const fuelAfter = Math.round((fuelBefore - required.requiredFuelL) * 1000) / 1000;
  const receipt: CanonicalFuelReceipt = {
    operationId,
    operationType: 'CONSUMPTION',
    assetId: fueled.assetId,
    ownerUid: uid,
    mode: 'ACCEPT_BURN',
    litersDelta: -required.requiredFuelL,
    fuelBefore,
    fuelAfter,
    fuelCapacityL: fueled.fuelCapacityL ?? 0,
    pricePerLiter: null,
    cost: 0,
    cashBefore: null,
    cashAfter: null,
    cashTransactionId: null,
    fuelRevisionBefore: fueled.fuelRevision ?? 1,
    fuelRevisionAfter: (fueled.fuelRevision ?? 1) + 1,
    pricePolicyVersion: null,
    fuelPolicyVersion: CANONICAL_FUEL_STATE_POLICY_VERSION,
    consumptionPolicyVersion: CANONICAL_FUEL_CONSUMPTION_POLICY_VERSION,
    deliveryId,
    createdAtMs: nowMs,
    authoritySource: fueled.authoritySource,
  };
  transaction.create(rRef, receipt);
  return {
    ok: true,
    alreadyApplied: false,
    asset: {
      ...fueled,
      currentFuelL: fuelAfter,
      fuelRevision: receipt.fuelRevisionAfter,
    },
  };
}
