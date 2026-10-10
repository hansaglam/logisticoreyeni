/**
 * Canonical fleet repair / upgrade persistence (Step 29N).
 * INTERNAL_TEST gated. Mutates serverState.cash + fleet asset atomically.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION, parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION,
  CANONICAL_FLEET_REPAIR_ACTION,
  CANONICAL_FLEET_REPAIR_POLICY_VERSION,
  CANONICAL_FLEET_UPGRADE_POLICY_VERSION,
  classifyCanonicalFleetRepair,
  classifyCanonicalFleetUpgrade,
  createCanonicalFleetRepairOperationId,
  createCanonicalFleetUpgradeOperationId,
  deriveCanonicalFleetRepair,
  deriveCanonicalFleetUpgrade,
  isCanonicalFleetMutationsAllowed,
  isCanonicalTruckUpgradeType,
  isValidCanonicalFleetIntentId,
  type CanonicalFleetRepairUpgradeReceipt,
} from '../../src/domain/canonicalFleetRepairUpgrade';
import { isValidCanonicalFleetAssetId } from '../../src/domain/canonicalRoadFleet';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
} from './canonicalCashTransaction';

export type RepairCanonicalFleetResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      notNeeded?: boolean;
      receipt: CanonicalFleetRepairUpgradeReceipt | null;
    }
  | { ok: false; reason: string; assetId?: string };

export type UpgradeCanonicalFleetResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalFleetRepairUpgradeReceipt;
    }
  | { ok: false; reason: string; assetId?: string };

function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}

function receiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION}/${operationId}`;
}

function receiptsMatchAfter(
  existing: CanonicalFleetRepairUpgradeReceipt,
  asset: { economicRevision: number; economicCondition: number },
): boolean {
  return existing.revisionAfter === asset.economicRevision;
}

export async function repairCanonicalFleetAssetTransaction(
  firestore: Firestore,
  uid: string,
  assetId: string,
  repairIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null; repairAction?: string },
): Promise<RepairCanonicalFleetResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED', assetId };
  if (!isCanonicalFleetMutationsAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_FLEET_MUTATIONS_OFF', assetId };
  }
  if (!isValidCanonicalFleetAssetId(assetId)) {
    return { ok: false, reason: 'LEGACY_FLEET_UNVERIFIED', assetId };
  }
  if (!isValidCanonicalFleetIntentId(repairIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID', assetId };
  }
  if (
    options?.repairAction != null &&
    options.repairAction !== CANONICAL_FLEET_REPAIR_ACTION
  ) {
    return { ok: false, reason: 'UNSUPPORTED_REPAIR_ACTION', assetId };
  }

  const operationId = createCanonicalFleetRepairOperationId(assetId, repairIntentId);
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
    const asset = parsed.ok ? parsed.asset : null;

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalFleetRepairUpgradeReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.assetId !== assetId ||
        existing.operationType !== 'REPAIR' ||
        existing.operationId !== operationId
      ) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
      }
      if (!asset || !receiptsMatchAfter(existing, asset)) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }

    const eligibility = classifyCanonicalFleetRepair(asset, uid);
    if (eligibility === 'REPAIR_NOT_NEEDED') {
      return { ok: true as const, alreadyApplied: false, notNeeded: true, receipt: null };
    }
    if (eligibility !== 'CANONICAL_FLEET_REPAIR_READY' || !asset) {
      return { ok: false as const, reason: eligibility, assetId };
    }
    const derived = deriveCanonicalFleetRepair(asset);
    if (!Number.isSafeInteger(derived.repairCost) || derived.repairCost <= 0) {
      return { ok: false as const, reason: 'REPAIR_NOT_NEEDED', assetId };
    }

    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId: operationId,
          operationType: 'CANONICAL_FLEET_REPAIR',
          sourceId: assetId,
          amountDelta: -derived.repairCost,
          nowMs,
          metadata: { policyVersion: CANONICAL_FLEET_REPAIR_POLICY_VERSION },
        },
      ],
      nowMs,
    );
    if (!cash.ok) {
      return { ok: false as const, reason: cash.reason, assetId };
    }
    if (cash.alreadyApplied) {
      return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
    }

    const receipt: CanonicalFleetRepairUpgradeReceipt = {
      operationId,
      operationType: 'REPAIR',
      assetId,
      ownerUid: uid,
      revisionBefore: asset.economicRevision,
      revisionAfter: asset.economicRevision + 1,
      conditionBefore: derived.conditionBefore,
      conditionAfter: derived.targetCondition,
      upgradeType: null,
      upgradeLevelBefore: null,
      upgradeLevelAfter: null,
      cashTransactionId: operationId,
      cashBefore: cash.cashBefore,
      cashDelta: -derived.repairCost,
      cashAfter: cash.cashAfter,
      derivedCost: derived.repairCost,
      policyVersion: CANONICAL_FLEET_REPAIR_POLICY_VERSION,
      createdAtMs: nowMs,
      authoritySource: asset.authoritySource,
    };
    transaction.update(aRef, {
      economicCondition: 100,
      economicRevision: receipt.revisionAfter,
      updatedAtMs: nowMs,
    });
    transaction.create(rRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export async function upgradeCanonicalFleetAssetTransaction(
  firestore: Firestore,
  uid: string,
  assetId: string,
  upgradeTypeRaw: string,
  upgradeIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<UpgradeCanonicalFleetResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED', assetId };
  if (!isCanonicalFleetMutationsAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_FLEET_MUTATIONS_OFF', assetId };
  }
  if (!isValidCanonicalFleetAssetId(assetId)) {
    return { ok: false, reason: 'LEGACY_FLEET_UNVERIFIED', assetId };
  }
  if (!isValidCanonicalFleetIntentId(upgradeIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID', assetId };
  }
  if (!isCanonicalTruckUpgradeType(upgradeTypeRaw)) {
    return { ok: false, reason: 'UNSUPPORTED_UPGRADE_TYPE', assetId };
  }
  const upgradeType = upgradeTypeRaw;
  const operationId = createCanonicalFleetUpgradeOperationId(assetId, upgradeType, upgradeIntentId);

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
    const asset = parsed.ok ? parsed.asset : null;

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalFleetRepairUpgradeReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.assetId !== assetId ||
        existing.operationType !== 'UPGRADE' ||
        existing.upgradeType !== upgradeType
      ) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
      }
      if (!asset || !receiptsMatchAfter(existing, asset)) {
        return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }

    const eligibility = classifyCanonicalFleetUpgrade(asset, uid, upgradeType);
    if (eligibility !== 'CANONICAL_FLEET_UPGRADE_READY' || !asset) {
      return { ok: false as const, reason: eligibility, assetId };
    }
    const derived = deriveCanonicalFleetUpgrade(asset, upgradeType);
    if (!Number.isSafeInteger(derived.derivedCost) || derived.derivedCost <= 0) {
      return { ok: false as const, reason: 'UPGRADE_MAX_LEVEL', assetId };
    }

    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId: operationId,
          operationType: 'CANONICAL_FLEET_UPGRADE',
          sourceId: assetId,
          amountDelta: -derived.derivedCost,
          nowMs,
          metadata: {
            policyVersion: CANONICAL_FLEET_UPGRADE_POLICY_VERSION,
            upgradeType,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) {
      return { ok: false as const, reason: cash.reason, assetId };
    }
    if (cash.alreadyApplied) {
      return { ok: false as const, reason: 'CANONICAL_FLEET_MUTATION_CONFLICT', assetId };
    }

    const receipt: CanonicalFleetRepairUpgradeReceipt = {
      operationId,
      operationType: 'UPGRADE',
      assetId,
      ownerUid: uid,
      revisionBefore: asset.economicRevision,
      revisionAfter: asset.economicRevision + 1,
      conditionBefore: asset.economicCondition,
      conditionAfter: asset.economicCondition,
      upgradeType,
      upgradeLevelBefore: derived.currentLevel,
      upgradeLevelAfter: derived.nextLevel,
      cashTransactionId: operationId,
      cashBefore: cash.cashBefore,
      cashDelta: -derived.derivedCost,
      cashAfter: cash.cashAfter,
      derivedCost: derived.derivedCost,
      policyVersion: CANONICAL_FLEET_UPGRADE_POLICY_VERSION,
      createdAtMs: nowMs,
      authoritySource: asset.authoritySource,
    };
    transaction.update(aRef, {
      economicUpgradeIds: derived.upgradesAfter,
      capacity: derived.capacityAfter,
      economicRevision: receipt.revisionAfter,
      updatedAtMs: nowMs,
    });
    transaction.create(rRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}
