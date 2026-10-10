/**
 * INTERNAL_TEST canonical cargo market (Step 29U).
 * Fixed snapshots. Buy/sell mutate world stock + user inventory + serverState.cash.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import type { ProductId } from '../../src/types/game';
import {
  CANONICAL_CARGO_INVENTORY_COLLECTION,
  CANONICAL_CARGO_MARKET_AUTHORITY_VERSION,
  CANONICAL_CARGO_MARKET_POLICY_VERSION,
  CANONICAL_CARGO_MARKET_RECEIPTS_COLLECTION,
  CANONICAL_CARGO_MARKET_SCHEMA_VERSION,
  CANONICAL_WORLD_MARKETS_COLLECTION,
  buildCanonicalWorldMarketBootstrapRecords,
  createCanonicalCargoBuyTransactionId,
  createCanonicalCargoInventoryId,
  createCanonicalCargoSellTransactionId,
  createCanonicalWorldMarketId,
  deriveCanonicalBuyTotal,
  deriveCanonicalSellTotal,
  isCanonicalCargoCityId,
  isCanonicalCargoMarketAllowed,
  isCanonicalCargoProductId,
  isProductCompatibleWithWarehouseType,
  isValidCanonicalCargoIntentId,
  sumCanonicalWarehouseOccupiedTons,
  validateCanonicalTradeQuantity,
  type CanonicalCargoInventoryDocument,
  type CanonicalCargoMarketReceipt,
  type CanonicalWorldMarketDocument,
} from '../../src/domain/canonicalCargoMarketWorldState';
import {
  CANONICAL_WAREHOUSES_COLLECTION,
  type CanonicalWarehouseDocument,
} from '../../src/domain/canonicalWarehouseState';
import {
  buildCanonicalCargoSaleProgressionInput,
  planCanonicalCargoCostBasisAfterBuy,
  progressionCargoSaleOperationId,
  readCanonicalCargoCostBasis,
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
  resolveNonDeliveryXpGate,
  resolveNonDeliveryXpReplay,
  type NonDeliveryXpOptions,
} from './canonicalNonDeliveryCompanyXp';

export type CanonicalCargoResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalCargoMarketReceipt | null;
      progression?: CanonicalNonDeliveryXpOutcome;
    }
  | { ok: false; reason: string };

function marketPath(cityId: string, productId: ProductId): string {
  return `${CANONICAL_WORLD_MARKETS_COLLECTION}/${createCanonicalWorldMarketId(cityId, productId)}`;
}
function inventoryPath(uid: string, warehouseId: string, productId: ProductId): string {
  return `users/${uid}/${CANONICAL_CARGO_INVENTORY_COLLECTION}/${createCanonicalCargoInventoryId(warehouseId, productId)}`;
}
function receiptPath(uid: string, operationId: string): string {
  return `users/${uid}/${CANONICAL_CARGO_MARKET_RECEIPTS_COLLECTION}/${operationId}`;
}
function warehousePath(uid: string, warehouseId: string): string {
  return `users/${uid}/${CANONICAL_WAREHOUSES_COLLECTION}/${warehouseId}`;
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
    firestore as Firestore & { collection?: (path: string) => { path: string } }
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

export async function bootstrapInternalCanonicalCargoMarketTransaction(
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<CanonicalCargoResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCargoMarketAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CARGO_MARKET_AUTHORITY_OFF' };
  }
  const records = buildCanonicalWorldMarketBootstrapRecords(nowMs);
  return firestore.runTransaction(async (transaction) => {
    const refs = records.map((row) =>
      firestore.doc(marketPath(row.cityId, row.productId)),
    );
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
    let existingCount = 0;
    for (let i = 0; i < snaps.length; i += 1) {
      if (!snaps[i]!.exists) continue;
      existingCount += 1;
      const existing = snaps[i]!.data() as CanonicalWorldMarketDocument;
      const expected = records[i]!;
      if (
        existing.cityId !== expected.cityId ||
        existing.productId !== expected.productId ||
        existing.basePrice !== expected.basePrice ||
        existing.policyVersion !== expected.policyVersion ||
        existing.schemaVersion !== expected.schemaVersion
      ) {
        return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_BOOTSTRAP_CONFLICT' };
      }
    }
    if (existingCount === records.length) {
      return { ok: true as const, alreadyApplied: true, receipt: null };
    }
    if (existingCount > 0) {
      return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_BOOTSTRAP_CONFLICT' };
    }
    for (let i = 0; i < records.length; i += 1) {
      transaction.create(refs[i]!, records[i]!);
    }
    return { ok: true as const, alreadyApplied: false, receipt: null };
  });
}

export async function buyCanonicalCargoTransaction(
  firestore: Firestore,
  uid: string,
  cityId: string,
  productIdRaw: string,
  quantityRaw: number,
  warehouseId: string,
  purchaseIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<CanonicalCargoResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCargoMarketAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CARGO_MARKET_AUTHORITY_OFF' };
  }
  if (!isValidCanonicalCargoIntentId(purchaseIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID' };
  }
  if (!isCanonicalCargoCityId(cityId) || !isCanonicalCargoProductId(productIdRaw)) {
    return { ok: false, reason: cityId && !isCanonicalCargoCityId(cityId) ? 'UNKNOWN_CITY' : 'UNKNOWN_PRODUCT' };
  }
  const productId = productIdRaw;
  const qty = validateCanonicalTradeQuantity(quantityRaw);
  if (!qty.ok) return qty;
  if (typeof warehouseId !== 'string' || warehouseId.length < 3 || warehouseId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_WAREHOUSE' };
  }
  const transactionId = createCanonicalCargoBuyTransactionId(cityId, productId, purchaseIntentId);

  return firestore.runTransaction(async (transaction) => {
    const rRef = firestore.doc(receiptPath(uid, purchaseIntentId));
    const mRef = firestore.doc(marketPath(cityId, productId));
    const wRef = firestore.doc(warehousePath(uid, warehouseId));
    const iRef = firestore.doc(inventoryPath(uid, warehouseId, productId));
    const [receiptSnap, marketSnap, warehouseSnap, inventorySnap, inventoryRows] = await Promise.all([
      transaction.get(rRef),
      transaction.get(mRef),
      transaction.get(wRef),
      transaction.get(iRef),
      listCollectionDocs(
        transaction,
        firestore,
        `users/${uid}/${CANONICAL_CARGO_INVENTORY_COLLECTION}`,
      ),
    ]);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalCargoMarketReceipt;
      if (existing.ownerUid !== uid || existing.cashTransactionId !== transactionId) {
        return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_OPERATION_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }
    if (!marketSnap.exists) return { ok: false as const, reason: 'MARKET_NOT_BOOTSTRAPPED' };
    if (!warehouseSnap.exists) return { ok: false as const, reason: 'UNKNOWN_WAREHOUSE' };
    const warehouse = warehouseSnap.data() as CanonicalWarehouseDocument;
    if (warehouse.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (warehouse.cityId !== cityId) return { ok: false as const, reason: 'WAREHOUSE_CITY_MISMATCH' };
    if (!isProductCompatibleWithWarehouseType(productId, warehouse.warehouseType)) {
      return { ok: false as const, reason: 'INCOMPATIBLE_WAREHOUSE' };
    }
    const market = marketSnap.data() as CanonicalWorldMarketDocument;
    if (market.stock < qty.quantity) return { ok: false as const, reason: 'INSUFFICIENT_STOCK' };
    const occupied = sumCanonicalWarehouseOccupiedTons(
      inventoryRows as unknown as CanonicalCargoInventoryDocument[],
      warehouseId,
    );
    if (occupied + qty.quantity > warehouse.capacityTons) {
      return { ok: false as const, reason: 'INSUFFICIENT_CAPACITY' };
    }
    const unitPrice = market.currentPrice;
    const total = deriveCanonicalBuyTotal(unitPrice, qty.quantity);
    if (!Number.isSafeInteger(total) || total <= 0) {
      return { ok: false as const, reason: 'INVALID_TRADE_TOTAL' };
    }
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_CARGO_BUY',
          sourceId: createCanonicalWorldMarketId(cityId, productId),
          amountDelta: -total,
          nowMs,
          metadata: { quantity: qty.quantity, policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_OPERATION_CONFLICT' };

    const inventoryBefore = inventorySnap.exists
      ? Number((inventorySnap.data() as CanonicalCargoInventoryDocument).quantity)
      : 0;
    const inventoryRevisionBefore = inventorySnap.exists
      ? Number((inventorySnap.data() as CanonicalCargoInventoryDocument).inventoryRevision)
      : 0;
    const inventoryAfter = inventoryBefore + qty.quantity;
    const costBasis = planCanonicalCargoCostBasisAfterBuy({
      xpGateEnabled: resolveNonDeliveryXpGate(options),
      inventoryBefore,
      existing: inventorySnap.exists ? (inventorySnap.data() as Record<string, unknown>) : null,
      addedQuantity: qty.quantity,
      unitPrice,
    });
    const costBasisFields = costBasis.kind === 'UNCHANGED' ? {} : costBasis.fields;
    const nextInventory: CanonicalCargoInventoryDocument = {
      schemaVersion: CANONICAL_CARGO_MARKET_SCHEMA_VERSION,
      warehouseId,
      productId,
      quantity: inventoryAfter,
      inventoryRevision: inventoryRevisionBefore + 1,
      ownerUid: uid,
      updatedAtMs: nowMs,
      authorityMode: 'INTERNAL_TEST_FIXTURE',
      ...costBasisFields,
    };
    const receipt: CanonicalCargoMarketReceipt = {
      operationId: purchaseIntentId,
      operationType: 'BUY',
      cityId,
      productId,
      warehouseId,
      quantity: qty.quantity,
      unitPrice,
      totalCashDelta: -total,
      cashBefore: cash.cashBefore,
      cashAfter: cash.cashAfter,
      marketStockBefore: market.stock,
      marketStockAfter: market.stock - qty.quantity,
      marketRevisionBefore: market.marketRevision,
      marketRevisionAfter: market.marketRevision + 1,
      inventoryBefore,
      inventoryAfter,
      inventoryRevisionBefore,
      inventoryRevisionAfter: nextInventory.inventoryRevision,
      policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION,
      createdAtMs: nowMs,
      authorityMode: market.authorityMode,
      ownerUid: uid,
      authorityVersion: CANONICAL_CARGO_MARKET_AUTHORITY_VERSION,
      cashTransactionId: transactionId,
    };
    transaction.update(mRef, {
      stock: market.stock - qty.quantity,
      marketRevision: market.marketRevision + 1,
      lastUpdatedAtMs: nowMs,
    });
    if (inventorySnap.exists) {
      transaction.update(iRef, {
        quantity: nextInventory.quantity,
        inventoryRevision: nextInventory.inventoryRevision,
        updatedAtMs: nowMs,
        ...costBasisFields,
      });
    } else {
      transaction.create(iRef, nextInventory);
    }
    transaction.create(rRef, receipt);
    return {
      ok: true as const,
      alreadyApplied: false,
      receipt,
      progression: { application: 'PRODUCTION_NO_XP' as const, operationId: null, receipt: null },
    };
  });
}

export async function sellCanonicalCargoTransaction(
  firestore: Firestore,
  uid: string,
  cityId: string,
  productIdRaw: string,
  quantityRaw: number,
  warehouseId: string,
  saleIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<CanonicalCargoResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCargoMarketAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CARGO_MARKET_AUTHORITY_OFF' };
  }
  if (!isValidCanonicalCargoIntentId(saleIntentId)) {
    return { ok: false, reason: 'INVALID_INTENT_ID' };
  }
  if (!isCanonicalCargoCityId(cityId) || !isCanonicalCargoProductId(productIdRaw)) {
    return { ok: false, reason: !isCanonicalCargoCityId(cityId) ? 'UNKNOWN_CITY' : 'UNKNOWN_PRODUCT' };
  }
  const productId = productIdRaw;
  const qty = validateCanonicalTradeQuantity(quantityRaw);
  if (!qty.ok) return qty;
  if (typeof warehouseId !== 'string' || warehouseId.length < 3 || warehouseId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_WAREHOUSE' };
  }
  const transactionId = createCanonicalCargoSellTransactionId(cityId, productId, saleIntentId);
  const progressionOperationId = progressionCargoSaleOperationId(saleIntentId);

  return firestore.runTransaction(async (transaction) => {
    const rRef = firestore.doc(receiptPath(uid, saleIntentId));
    const mRef = firestore.doc(marketPath(cityId, productId));
    const wRef = firestore.doc(warehousePath(uid, warehouseId));
    const iRef = firestore.doc(inventoryPath(uid, warehouseId, productId));
    const [receiptSnap, marketSnap, warehouseSnap, inventorySnap] = await Promise.all([
      transaction.get(rRef),
      transaction.get(mRef),
      transaction.get(wRef),
      transaction.get(iRef),
    ]);
    const xpContext = await readNonDeliveryXpContext(
      transaction,
      firestore,
      uid,
      progressionOperationId,
      options,
    );
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalCargoMarketReceipt;
      if (existing.ownerUid !== uid || existing.cashTransactionId !== transactionId) {
        return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_OPERATION_CONFLICT' };
      }
      const replay = resolveNonDeliveryXpReplay(xpContext, progressionOperationId, 'COMPANY_CARGO_SALE');
      if (!replay.ok) return replay;
      return { ok: true as const, alreadyApplied: true, receipt: existing, progression: replay.outcome };
    }
    if (!marketSnap.exists) return { ok: false as const, reason: 'MARKET_NOT_BOOTSTRAPPED' };
    if (!warehouseSnap.exists) return { ok: false as const, reason: 'UNKNOWN_WAREHOUSE' };
    const warehouse = warehouseSnap.data() as CanonicalWarehouseDocument;
    if (warehouse.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (warehouse.cityId !== cityId) return { ok: false as const, reason: 'WAREHOUSE_CITY_MISMATCH' };
    if (!inventorySnap.exists) return { ok: false as const, reason: 'INSUFFICIENT_INVENTORY' };
    const inventory = inventorySnap.data() as CanonicalCargoInventoryDocument;
    if (inventory.ownerUid !== uid || inventory.quantity < qty.quantity) {
      return { ok: false as const, reason: 'INSUFFICIENT_INVENTORY' };
    }
    const market = marketSnap.data() as CanonicalWorldMarketDocument;
    const unitPrice = market.currentPrice;
    const total = deriveCanonicalSellTotal(unitPrice, qty.quantity);
    if (!Number.isSafeInteger(total) || total <= 0) {
      return { ok: false as const, reason: 'INVALID_TRADE_TOTAL' };
    }
    const precheck = precheckNonDeliveryXpForNewOperation(xpContext, progressionOperationId);
    if (!precheck.ok) return precheck;
    const costBasis = readCanonicalCargoCostBasis(inventory as unknown as Record<string, unknown>);
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_CARGO_SELL',
          sourceId: createCanonicalWorldMarketId(cityId, productId),
          amountDelta: total,
          nowMs,
          metadata: { quantity: qty.quantity, policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_CARGO_MARKET_OPERATION_CONFLICT' };

    const inventoryAfter = inventory.quantity - qty.quantity;
    const receipt: CanonicalCargoMarketReceipt = {
      operationId: saleIntentId,
      operationType: 'SELL',
      cityId,
      productId,
      warehouseId,
      quantity: qty.quantity,
      unitPrice,
      totalCashDelta: total,
      cashBefore: cash.cashBefore,
      cashAfter: cash.cashAfter,
      marketStockBefore: market.stock,
      marketStockAfter: market.stock + qty.quantity,
      marketRevisionBefore: market.marketRevision,
      marketRevisionAfter: market.marketRevision + 1,
      inventoryBefore: inventory.quantity,
      inventoryAfter,
      inventoryRevisionBefore: inventory.inventoryRevision,
      inventoryRevisionAfter: inventory.inventoryRevision + 1,
      policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION,
      createdAtMs: nowMs,
      authorityMode: market.authorityMode,
      ownerUid: uid,
      authorityVersion: CANONICAL_CARGO_MARKET_AUTHORITY_VERSION,
      cashTransactionId: transactionId,
    };
    transaction.update(mRef, {
      stock: market.stock + qty.quantity,
      marketRevision: market.marketRevision + 1,
      lastUpdatedAtMs: nowMs,
    });
    transaction.update(iRef, {
      quantity: inventoryAfter,
      inventoryRevision: inventory.inventoryRevision + 1,
      updatedAtMs: nowMs,
    });
    transaction.create(rRef, receipt);
    const progression = applyNonDeliveryXpInTransaction(
      transaction,
      firestore,
      uid,
      xpContext,
      buildCanonicalCargoSaleProgressionInput(
        receipt,
        { warehouseType: warehouse.warehouseType, costBasis },
        nowMs,
      ),
    );
    return { ok: true as const, alreadyApplied: false, receipt, progression };
  });
}
