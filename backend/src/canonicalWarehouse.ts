/**
 * INTERNAL_TEST canonical warehouse open/upgrade (Step 29T).
 * Server derives city/type/price/level/capacity/opex. Public UI unwired.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import {
  CANONICAL_WAREHOUSE_AUTHORITY_VERSION,
  CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
  CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION,
  CANONICAL_WAREHOUSE_SCHEMA_VERSION,
  CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION,
  CANONICAL_WAREHOUSES_COLLECTION,
  buildCanonicalWarehouseDocument,
  canOpenCanonicalWarehouseSlot,
  createCanonicalWarehouseOpenTransactionId,
  createCanonicalWarehouseUpgradeTransactionId,
  deriveCanonicalWarehouseOpenQuote,
  deriveCanonicalWarehouseUpgradeQuote,
  isCanonicalWarehouseAllowed,
  isValidCanonicalWarehouseIntentId,
  type CanonicalWarehouseDocument,
  type CanonicalWarehouseReceipt,
} from '../../src/domain/canonicalWarehouseState';
import {
  buildCanonicalWarehouseProgressionInput,
  progressionWarehouseOpenOperationId,
  progressionWarehouseUpgradeOperationId,
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

export type CanonicalWarehouseMutationResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalWarehouseReceipt;
      warehouse: CanonicalWarehouseDocument;
      progression: CanonicalNonDeliveryXpOutcome;
    }
  | { ok: false; reason: string };

function warehousePath(uid: string, warehouseId: string): string {
  return `users/${uid}/${CANONICAL_WAREHOUSES_COLLECTION}/${warehouseId}`;
}
function receiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION}/${operationId}`;
}

function isCollectionQuerySnap(
  snap: unknown,
): snap is { docs: Array<{ data: () => Record<string, unknown> | undefined }> } {
  return Boolean(snap && typeof snap === 'object' && Array.isArray((snap as { docs?: unknown }).docs));
}

async function listCollectionDocs(
  transaction: Transaction,
  firestore: Firestore,
  collectionPath: string,
): Promise<Record<string, unknown>[]> {
  const collection = (
    firestore as Firestore & {
      collection?: (path: string) => { path: string };
    }
  ).collection?.(collectionPath);
  if (!collection) return [];
  const snap = await transaction.get(collection as never);
  if (isCollectionQuerySnap(snap)) {
    return snap.docs
      .map((doc) => doc.data())
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  return [];
}

export async function openCanonicalWarehouseTransaction(
  firestore: Firestore,
  uid: string,
  cityId: string,
  warehouseType: string,
  openIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<CanonicalWarehouseMutationResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalWarehouseAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_WAREHOUSE_AUTHORITY_OFF' };
  }
  if (!isValidCanonicalWarehouseIntentId(openIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID' };
  }
  const quote = deriveCanonicalWarehouseOpenQuote({ cityId, warehouseType });
  if (!quote.ok) return quote;
  const transactionId = createCanonicalWarehouseOpenTransactionId(quote.cityId, quote.warehouseType);
  const progressionOperationId = progressionWarehouseOpenOperationId(quote.warehouseId);

  return firestore.runTransaction(async (transaction) => {
    const wRef = firestore.doc(warehousePath(uid, quote.warehouseId));
    const rRef = firestore.doc(receiptPath(uid, openIntentId));
    const [warehouseSnap, receiptSnap, existingRows] = await Promise.all([
      transaction.get(wRef),
      transaction.get(rRef),
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_WAREHOUSES_COLLECTION}`),
    ]);
    const xpContext = await readNonDeliveryXpContext(
      transaction,
      firestore,
      uid,
      progressionOperationId,
      options,
    );

    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalWarehouseReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.warehouseId !== quote.warehouseId ||
        existing.cashTransactionId !== transactionId ||
        existing.operationType !== 'OPEN' ||
        existing.operationId !== openIntentId
      ) {
        return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };
      }
      if (!warehouseSnap.exists) {
        return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };
      }
      const replay = resolveNonDeliveryXpReplay(xpContext, progressionOperationId, 'COMPANY_WAREHOUSE_OPEN');
      if (!replay.ok) return replay;
      return {
        ok: true as const,
        alreadyApplied: true,
        receipt: existing,
        warehouse: warehouseSnap.data() as CanonicalWarehouseDocument,
        progression: replay.outcome,
      };
    }

    if (warehouseSnap.exists) {
      return { ok: false as const, reason: 'DUPLICATE_WAREHOUSE' };
    }
    if (!canOpenCanonicalWarehouseSlot(existingRows.length)) {
      return { ok: false as const, reason: 'WAREHOUSE_LIMIT_REACHED' };
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
          operationType: 'CANONICAL_WAREHOUSE_OPEN',
          sourceId: quote.warehouseId,
          amountDelta: -quote.price,
          nowMs,
          metadata: {
            cityId: quote.cityId,
            warehouseType: quote.warehouseType,
            policyVersion: CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };

    const warehouse = buildCanonicalWarehouseDocument({ uid, quote, nowMs });
    const receipt: CanonicalWarehouseReceipt = {
      operationId: openIntentId,
      operationType: 'OPEN',
      warehouseId: warehouse.warehouseId,
      cityId: warehouse.cityId,
      warehouseType: warehouse.warehouseType,
      revisionBefore: 0,
      revisionAfter: 1,
      levelBefore: 0,
      levelAfter: warehouse.level,
      capacityBefore: 0,
      capacityAfter: warehouse.capacityTons,
      cashBefore: cash.cashBefore,
      cashDelta: -quote.price,
      cashAfter: cash.cashAfter,
      cashTransactionId: transactionId,
      policyVersion: CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
      createdAtMs: nowMs,
      authoritySource: 'INTERNAL_TEST',
      ownerUid: uid,
      authorityVersion: CANONICAL_WAREHOUSE_AUTHORITY_VERSION,
    };
    transaction.create(wRef, warehouse);
    transaction.create(rRef, receipt);
    const progression = applyNonDeliveryXpInTransaction(
      transaction,
      firestore,
      uid,
      xpContext,
      buildCanonicalWarehouseProgressionInput(receipt, nowMs),
    );
    return { ok: true as const, alreadyApplied: false, receipt, warehouse, progression };
  });
}

export async function upgradeCanonicalWarehouseTransaction(
  firestore: Firestore,
  uid: string,
  warehouseId: string,
  upgradeIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<CanonicalWarehouseMutationResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalWarehouseAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_WAREHOUSE_AUTHORITY_OFF' };
  }
  if (!isValidCanonicalWarehouseIntentId(upgradeIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID' };
  }
  if (typeof warehouseId !== 'string' || warehouseId.length < 3 || warehouseId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_WAREHOUSE' };
  }

  return firestore.runTransaction(async (transaction) => {
    const wRef = firestore.doc(warehousePath(uid, warehouseId));
    const rRef = firestore.doc(receiptPath(uid, upgradeIntentId));
    const [warehouseSnap, receiptSnap] = await Promise.all([
      transaction.get(wRef),
      transaction.get(rRef),
    ]);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalWarehouseReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.warehouseId !== warehouseId ||
        existing.operationType !== 'UPGRADE' ||
        existing.operationId !== upgradeIntentId
      ) {
        return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };
      }
      if (!warehouseSnap.exists) {
        return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };
      }
      const replayOperationId = progressionWarehouseUpgradeOperationId(
        existing.warehouseId,
        existing.levelBefore,
        existing.levelAfter,
      );
      const replayContext = await readNonDeliveryXpContext(
        transaction,
        firestore,
        uid,
        replayOperationId,
        options,
      );
      const replay = resolveNonDeliveryXpReplay(replayContext, replayOperationId, 'COMPANY_WAREHOUSE_UPGRADE');
      if (!replay.ok) return replay;
      return {
        ok: true as const,
        alreadyApplied: true,
        receipt: existing,
        warehouse: warehouseSnap.data() as CanonicalWarehouseDocument,
        progression: replay.outcome,
      };
    }
    if (!warehouseSnap.exists) return { ok: false as const, reason: 'UNKNOWN_WAREHOUSE' };
    const warehouse = warehouseSnap.data() as CanonicalWarehouseDocument;
    if (warehouse.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (warehouse.schemaVersion !== CANONICAL_WAREHOUSE_SCHEMA_VERSION) {
      return { ok: false as const, reason: 'UNSUPPORTED_SCHEMA' };
    }

    const quote = deriveCanonicalWarehouseUpgradeQuote(warehouse);
    if (!quote.ok) return quote;
    const transactionId = createCanonicalWarehouseUpgradeTransactionId(
      warehouse.warehouseId,
      quote.nextLevel,
    );
    const progressionOperationId = progressionWarehouseUpgradeOperationId(
      warehouse.warehouseId,
      warehouse.level,
      quote.nextLevel,
    );
    const xpContext = await readNonDeliveryXpContext(
      transaction,
      firestore,
      uid,
      progressionOperationId,
      options,
    );
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
          operationType: 'CANONICAL_WAREHOUSE_UPGRADE',
          sourceId: warehouse.warehouseId,
          amountDelta: -quote.price,
          nowMs,
          metadata: {
            nextLevel: quote.nextLevel,
            policyVersion: CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_WAREHOUSE_CONFLICT' };

    const nextWarehouse: CanonicalWarehouseDocument = {
      ...warehouse,
      level: quote.nextLevel,
      capacityTons: quote.nextCapacity,
      economicRevision: warehouse.economicRevision + 1,
      updatedAtMs: nowMs,
    };
    const receipt: CanonicalWarehouseReceipt = {
      operationId: upgradeIntentId,
      operationType: 'UPGRADE',
      warehouseId: warehouse.warehouseId,
      cityId: warehouse.cityId,
      warehouseType: warehouse.warehouseType,
      revisionBefore: warehouse.economicRevision,
      revisionAfter: nextWarehouse.economicRevision,
      levelBefore: warehouse.level,
      levelAfter: nextWarehouse.level,
      capacityBefore: warehouse.capacityTons,
      capacityAfter: nextWarehouse.capacityTons,
      cashBefore: cash.cashBefore,
      cashDelta: -quote.price,
      cashAfter: cash.cashAfter,
      cashTransactionId: transactionId,
      policyVersion: CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION,
      createdAtMs: nowMs,
      authoritySource: 'INTERNAL_TEST',
      ownerUid: uid,
      authorityVersion: CANONICAL_WAREHOUSE_AUTHORITY_VERSION,
    };
    transaction.update(wRef, {
      level: nextWarehouse.level,
      capacityTons: nextWarehouse.capacityTons,
      economicRevision: nextWarehouse.economicRevision,
      updatedAtMs: nowMs,
    });
    transaction.create(rRef, receipt);
    const progression = applyNonDeliveryXpInTransaction(
      transaction,
      firestore,
      uid,
      xpContext,
      buildCanonicalWarehouseProgressionInput(receipt, nowMs),
    );
    return { ok: true as const, alreadyApplied: false, receipt, warehouse: nextWarehouse, progression };
  });
}
