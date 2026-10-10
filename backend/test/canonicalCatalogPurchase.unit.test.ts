/**
 * Canonical catalog purchase — in-memory tests (Step 29P).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { purchaseCanonicalCatalogAssetTransaction } from '../src/canonicalCatalogPurchase';
import { serverStateCurrentRef, CANONICAL_CASH_TRANSACTIONS_COLLECTION } from '../src/canonicalCashTransaction';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_PURCHASE_RECEIPTS_COLLECTION,
  createCanonicalCatalogAssetId,
  createCanonicalCatalogPurchaseTransactionId,
  deriveCanonicalCatalogPurchasePrice,
  hasOnlyCanonicalCatalogPurchaseKeys,
  isCanonicalCatalogPurchaseAllowed,
} from '../../src/domain/remainingRoadCashPathCanonicalization';
import { findTruckMarketItem } from '../../src/data/trucks';
import { TRAILER_MARKET } from '../../src/data/trailers';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const GATE = { envValue: 'INTERNAL_TEST' as const };
const TRUCK_ID = 'truck-ford-cargo';
const TRAILER_ID = 'trailer-standard';

test('gate, keys, server-derived catalog price', () => {
  assert.equal(isCanonicalCatalogPurchaseAllowed({ envValue: null }), false);
  assert.equal(isCanonicalCatalogPurchaseAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalCatalogPurchaseKeys({
      catalogModelId: TRUCK_ID,
      purchaseId: 'purchase01',
      assetType: 'TRUCK',
      canonicalSchemaVersion: 1,
      purchasePrice: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalCatalogPurchaseKeys({
      catalogModelId: TRUCK_ID,
      purchaseId: 'purchase01',
      assetType: 'TRUCK',
      canonicalSchemaVersion: 1,
      condition: 50,
    }),
    false,
  );
  const truck = deriveCanonicalCatalogPurchasePrice(TRUCK_ID, 'TRUCK');
  assert.equal(truck.ok, true);
  if (truck.ok) {
    assert.equal(truck.price, findTruckMarketItem(TRUCK_ID)?.purchasePrice);
  }
  const trailer = deriveCanonicalCatalogPurchasePrice(TRAILER_ID, 'TRAILER');
  assert.equal(trailer.ok, true);
  if (trailer.ok) {
    assert.equal(trailer.price, TRAILER_MARKET.find((row) => row.id === TRAILER_ID)?.purchasePrice);
  }
  const unknown = deriveCanonicalCatalogPurchasePrice('not-a-model', 'TRUCK');
  assert.equal(unknown.ok, false);
});

test('auth, owner, insufficient cash, no profile mutation', async () => {
  const db = createMemoryFirestore();
  const unauth = await purchaseCanonicalCatalogAssetTransaction(
    db,
    '',
    TRUCK_ID,
    'purchase01',
    'TRUCK',
    1,
    GATE,
  );
  assert.equal(unauth.ok, false);
  if (!unauth.ok) assert.equal(unauth.reason, 'UNAUTHENTICATED');

  const off = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase01',
    'TRUCK',
    1,
    { envValue: null },
  );
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_CATALOG_PURCHASE_OFF');

  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 100, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 99_000 });
  const poor = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase01',
    'TRUCK',
    1,
    GATE,
  );
  assert.equal(poor.ok, false);
  if (!poor.ok) assert.equal(poor.reason, 'INSUFFICIENT_CASH');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 100);
  assert.equal(db.dump.get('users/uid-a')?.money, 99_000);
  assert.equal(
    [...db.dump.keys()].filter((key) => key.includes(CANONICAL_FLEET_ASSETS_COLLECTION)).length,
    0,
  );
});

test('truck purchase atomic, idempotent, ignores client price', async () => {
  const db = createMemoryFirestore();
  const priced = deriveCanonicalCatalogPurchasePrice(TRUCK_ID, 'TRUCK');
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 200_000, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 77_000 });
  const first = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase-aa',
    'TRUCK',
    10,
    GATE,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.alreadyApplied, false);
  assert.equal(first.receipt.price, priced.price);
  assert.equal(first.receipt.catalogId, TRUCK_ID);
  const assetId = createCanonicalCatalogAssetId('TRUCK', 'purchase-aa');
  assert.equal(first.receipt.assetId, assetId);
  assert.equal(
    first.receipt.transactionId,
    createCanonicalCatalogPurchaseTransactionId(assetId, 'purchase-aa'),
  );
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000 - priced.price);
  assert.equal(db.dump.get('users/uid-a')?.money, 77_000);
  const asset = db.dump.get(`users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`);
  assert.equal(asset?.catalogModelId, TRUCK_ID);
  assert.equal(asset?.economicCondition, 100);
  const cashTxn = db.dump.get(
    `users/uid-a/${CANONICAL_CASH_TRANSACTIONS_COLLECTION}/${first.receipt.transactionId}`,
  );
  assert.equal(cashTxn?.amountDelta, -priced.price);
  const receipt = db.dump.get(
    `users/uid-a/${CANONICAL_PURCHASE_RECEIPTS_COLLECTION}/purchase-aa`,
  );
  assert.equal(receipt?.price, priced.price);

  const retry = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase-aa',
    'TRUCK',
    11,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.transactionId, first.receipt.transactionId);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000 - priced.price);
  const assets = [...db.dump.keys()].filter((key) =>
    key.includes(`/${CANONICAL_FLEET_ASSETS_COLLECTION}/`),
  );
  assert.equal(assets.length, 1);
});

test('trailer purchase once', async () => {
  const db = createMemoryFirestore();
  const priced = deriveCanonicalCatalogPurchasePrice(TRAILER_ID, 'TRAILER');
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 80_000, ownerUid: 'uid-a', sourceVersion: 1 });
  const first = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRAILER_ID,
    'purchase-tr',
    'TRAILER',
    20,
    GATE,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.price, priced.price);
  assert.equal(first.receipt.assetType, 'TRAILER');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 80_000 - priced.price);
});

test('no public UI wiring, no generic cash delta, no multimodal settle', () => {
  const store = readFileSync(resolve(__dirname, '../../src/store/gameStore.ts'), 'utf8');
  assert.equal(store.includes('purchaseCanonicalCatalogAsset'), false);
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
});
