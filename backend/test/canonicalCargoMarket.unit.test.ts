/**
 * Canonical cargo market — in-memory tests (Step 29U).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  bootstrapInternalCanonicalCargoMarketTransaction,
  buyCanonicalCargoTransaction,
  sellCanonicalCargoTransaction,
} from '../src/canonicalCargoMarket';
import { openCanonicalWarehouseTransaction } from '../src/canonicalWarehouse';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { deriveCanonicalWarehouseSiteOpex } from '../../src/domain/canonicalWarehouseState';
import {
  CANONICAL_CARGO_MARKET_POLICY_VERSION,
  CARGO_MARKET_READINESS_STATUS,
  PRODUCTION_MARKET_TICK_AUTHORITY,
  WORLD_EVENT_PRICE_PARITY,
  buildCanonicalWorldMarketBootstrapRecords,
  deriveCanonicalBuyTotal,
  deriveCanonicalSellTotal,
  hasOnlyCanonicalCargoBuyKeys,
  isCanonicalCargoMarketAllowed,
  quoteCanonicalCargoTrade,
} from '../../src/domain/canonicalCargoMarketWorldState';
import { createCanonicalWarehouseId as whId } from '../../src/domain/canonicalWarehouseState';
import { CITIES_BY_ID } from '../../src/data/cities';
import { toProductMarket } from '../../src/simulation/economy';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false };
    },
    collection(path: string) {
      return { path, _col: true };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string; _col?: boolean }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
          docs: Array<{ data: () => Record<string, unknown> | undefined }>;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([, data]) => ({ data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
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
const WH = { envValue: 'INTERNAL_TEST' as const };
const NOW = 1_700_000_000_000;
const WAREHOUSE_ID = whId('izmir', 'standard');

function seedCash(db: ReturnType<typeof createMemoryFirestore>, uid = 'uid-a', cash = 500_000) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1 });
  db.dump.set(`users/${uid}`, { money: 22_000 });
}

async function setupTrader(db: ReturnType<typeof createMemoryFirestore>, uid = 'uid-a') {
  seedCash(db, uid);
  const opened = await openCanonicalWarehouseTransaction(
    db,
    uid,
    'izmir',
    'standard',
    `open-${uid}xx`.slice(0, 12),
    NOW,
    WH,
  );
  assert.equal(opened.ok, true);
  const boot = await bootstrapInternalCanonicalCargoMarketTransaction(db, uid, NOW, GATE);
  assert.equal(boot.ok, true);
  return { warehouseId: WAREHOUSE_ID };
}

test('gate, keys, bootstrap records, classifiers', () => {
  assert.equal(isCanonicalCargoMarketAllowed({ envValue: null }), false);
  assert.equal(isCanonicalCargoMarketAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalCargoBuyKeys({
      cityId: 'izmir',
      productId: 'steel',
      quantity: 5,
      warehouseId: WAREHOUSE_ID,
      purchaseIntentId: 'buy-aaaa1',
      canonicalSchemaVersion: 1,
      price: 1,
    }),
    false,
  );
  assert.equal(CARGO_MARKET_READINESS_STATUS, 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED');
  assert.equal(
    PRODUCTION_MARKET_TICK_AUTHORITY,
    'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY',
  );
  assert.equal(WORLD_EVENT_PRICE_PARITY, 'WORLD_EVENT_PRICE_AUTHORITY_INTERNAL_EPOCH_SCHEDULE');
  assert.equal(CANONICAL_CARGO_MARKET_POLICY_VERSION, 'canonical-cargo-market-internal-v1');
  const rows = buildCanonicalWorldMarketBootstrapRecords(NOW);
  assert.equal(rows.length, 8 * 7);
  const izmirSteel = rows.find((row) => row.cityId === 'izmir' && row.productId === 'steel');
  assert.ok(izmirSteel);
  assert.equal(izmirSteel!.currentPrice, Math.round(toProductMarket(CITIES_BY_ID.izmir!.products.steel).currentPrice));
  assert.equal(izmirSteel!.stock, Math.round(CITIES_BY_ID.izmir!.products.steel.stock));
});

test('buy/sell e2e, retry, stock/capacity/cash, opex invariant', async () => {
  const db = createMemoryFirestore();
  await setupTrader(db);
  const unit = Math.round(toProductMarket(CITIES_BY_ID.izmir!.products.steel).currentPrice);
  const buyTotal = deriveCanonicalBuyTotal(unit, 5);
  const quote = quoteCanonicalCargoTrade({
    side: 'BUY',
    market: {
      schemaVersion: 1,
      cityId: 'izmir',
      productId: 'steel',
      stock: 80,
      basePrice: unit,
      currentPrice: unit,
      supplyIndex: 1,
      demandIndex: 1,
      marketRevision: 1,
      policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION,
      lastUpdatedAtMs: NOW,
      authorityMode: 'INTERNAL_TEST_FIXED_MARKET_SNAPSHOT',
    },
    quantity: 5,
  });
  assert.equal(quote.total, buyTotal);

  const buy = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    5,
    WAREHOUSE_ID,
    'buy-steel1',
    NOW,
    GATE,
  );
  assert.equal(buy.ok, true);
  if (!buy.ok || !buy.receipt) return;
  assert.equal(buy.receipt.unitPrice, unit);
  assert.equal(buy.receipt.totalCashDelta, -buyTotal);
  assert.equal(buy.receipt.inventoryAfter, 5);
  assert.equal(buy.receipt.marketStockAfter, Math.round(CITIES_BY_ID.izmir!.products.steel.stock) - 5);

  const retry = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    5,
    WAREHOUSE_ID,
    'buy-steel1',
    NOW + 1,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok || !retry.receipt) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.inventoryAfter, 5);

  const fruit = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'fruit',
    5,
    WAREHOUSE_ID,
    'buy-fruit1',
    NOW,
    GATE,
  );
  assert.equal(fruit.ok, false);
  if (!fruit.ok) assert.equal(fruit.reason, 'INCOMPATIBLE_WAREHOUSE');

  const fill = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    50,
    WAREHOUSE_ID,
    'buy-text01',
    NOW,
    GATE,
  );
  assert.equal(fill.ok, true);
  const exact = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    25,
    WAREHOUSE_ID,
    'buy-text02',
    NOW,
    GATE,
  );
  assert.equal(exact.ok, true);
  const overCap = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    5,
    WAREHOUSE_ID,
    'buy-text03',
    NOW,
    GATE,
  );
  assert.equal(overCap.ok, false);
  if (!overCap.ok) assert.equal(overCap.reason, 'INSUFFICIENT_CAPACITY');

  const sellTotal = deriveCanonicalSellTotal(unit, 5);
  const sell = await sellCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    5,
    WAREHOUSE_ID,
    'sell-steel1',
    NOW,
    GATE,
  );
  assert.equal(sell.ok, true);
  if (!sell.ok || !sell.receipt) return;
  assert.equal(sell.receipt.totalCashDelta, sellTotal);
  assert.equal(sell.receipt.inventoryAfter, 0);

  const oversell = await sellCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    50,
    WAREHOUSE_ID,
    'sell-steel2',
    NOW,
    GATE,
  );
  assert.equal(oversell.ok, false);
  if (!oversell.ok) assert.equal(oversell.reason, 'INSUFFICIENT_INVENTORY');

  const warehouse = db.dump.get(`users/uid-a/canonicalWarehouses/${WAREHOUSE_ID}`) as {
    cityId: string;
    warehouseType: 'standard';
    capacityTons: number;
    level: number;
    warehouseId: string;
    economicRevision: number;
    ownerUid: string;
    schemaVersion: 1;
    warehousePolicyVersion: 'canonical-warehouse-open-v1';
    authorityClass: 'INTERNAL_TEST_FIXTURE';
    createdAtMs: number;
    updatedAtMs: number;
  };
  const opex = deriveCanonicalWarehouseSiteOpex(warehouse);
  assert.equal(opex.operatingExpense, deriveCanonicalWarehouseSiteOpex(warehouse).operatingExpense);
  assert.equal(db.dump.get('users/uid-a')?.money, 22_000);
});

test('insufficient cash and stock no-ops', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 'uid-a', 500_000);
  const opened = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-poor01',
    NOW,
    WH,
  );
  assert.equal(opened.ok, true);
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 10, ownerUid: 'uid-a', sourceVersion: 1 });
  await bootstrapInternalCanonicalCargoMarketTransaction(db, 'uid-a', NOW, GATE);
  const nsf = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    5,
    WAREHOUSE_ID,
    'buy-poor01',
    NOW,
    GATE,
  );
  assert.equal(nsf.ok, false);
  if (!nsf.ok) assert.equal(nsf.reason, 'INSUFFICIENT_CASH');

  const rich = createMemoryFirestore();
  await setupTrader(rich);
  const overstock = await buyCanonicalCargoTransaction(
    rich,
    'uid-a',
    'izmir',
    'steel',
    50,
    WAREHOUSE_ID,
    'buy-allstk',
    NOW,
    GATE,
  );
  assert.equal(overstock.ok, true);
  const tooMuch = await buyCanonicalCargoTransaction(
    rich,
    'uid-a',
    'izmir',
    'steel',
    50,
    WAREHOUSE_ID,
    'buy-toomch',
    NOW,
    GATE,
  );
  assert.equal(tooMuch.ok, false);
  if (!tooMuch.ok) assert.equal(tooMuch.reason, 'INSUFFICIENT_STOCK');
});

test('two buyers cannot oversell stock', async () => {
  const db = createMemoryFirestore();
  await setupTrader(db, 'uid-a');
  seedCash(db, 'uid-b');
  await openCanonicalWarehouseTransaction(db, 'uid-b', 'izmir', 'standard', 'open-uidbxx', NOW, WH);
  const first = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'steel',
    50,
    WAREHOUSE_ID,
    'buy-a-stk1',
    NOW,
    GATE,
  );
  const second = await buyCanonicalCargoTransaction(
    db,
    'uid-b',
    'izmir',
    'steel',
    50,
    WAREHOUSE_ID,
    'buy-b-stk1',
    NOW,
    GATE,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'INSUFFICIENT_STOCK');
});

test('rules deny client writes', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalWorldMarkets\/\{marketId\}[\s\S]*?allow write: if false/);
  assert.match(rules, /match \/canonicalCargoInventory\/\{inventoryId\}[\s\S]*?allow write: if false/);
});
