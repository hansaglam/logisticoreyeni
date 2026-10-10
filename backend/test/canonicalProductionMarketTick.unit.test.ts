/**
 * Production market tick — in-memory tests (Step 29Z).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  advanceCanonicalProductionMarketTickTransaction,
  stampCanonicalProductionMarketTickPolicyTransaction,
} from '../src/canonicalProductionMarketTick';
import {
  bootstrapInternalCanonicalCargoMarketTransaction,
  buyCanonicalCargoTransaction,
  sellCanonicalCargoTransaction,
} from '../src/canonicalCargoMarket';
import { openCanonicalWarehouseTransaction } from '../src/canonicalWarehouse';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import { createCanonicalWarehouseId as whId } from '../../src/domain/canonicalWarehouseState';
import {
  CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
  MARKET_OWNERSHIP_MODEL,
  PRODUCTION_MARKET_RNG_PARITY,
  PRODUCTION_MARKET_TICK_AUTHORITY_STATUS,
  ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS,
  ROAD_CONTRACT_MARKET_STATE_STATUS,
  canonicalMarketTickId,
  classifyEpochSupplyRatio,
  deriveCanonicalMarketEpoch,
  deriveCanonicalProductionMarketQuote,
  deriveTradableShortage,
  deriveTradableSurplus,
  hasOnlyCanonicalMarketTickKeys,
  isCanonicalProductionMarketTickAllowed,
  marketTickIntervalMs,
  planCanonicalProductionMarketTick,
} from '../../src/domain/canonicalProductionMarketTick';
import { buildGlobalEconomySnapshot } from '../../src/simulation/globalMarketSnapshot';
import { ECONOMY_CONFIG_VERSION } from '../../src/simulation/economyClock';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false as const };
    },
    collection(path: string) {
      return { path, _col: true as const };
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
        set: (ref: { path: string }, data: Record<string, unknown>) => void;
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
        set(ref, data) {
          dump.set(ref.path, { ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const TICK = { envValue: 'INTERNAL_TEST' as const };
const CARGO = { envValue: 'INTERNAL_TEST' as const };
const WH = { envValue: 'INTERNAL_TEST' as const };
const EPOCH = 48;
const SERVER_NOW = EPOCH * marketTickIntervalMs() + 5_000;

async function boot(db: ReturnType<typeof createMemoryFirestore>) {
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 500_000, ownerUid: 'uid-a' });
  db.dump.set('users/uid-a', { money: 22_000 });
  db.dump.set('users/uid-a/player', { money: 22_000 });
  db.dump.set('users/uid-a/financeLedger', { entries: 1 });
  const opened = await openCanonicalWarehouseTransaction(
    db,
    'uid-a',
    'izmir',
    'standard',
    'open-uid-a-1',
    SERVER_NOW,
    WH,
  );
  assert.equal(opened.ok, true);
  const bootstrapped = await bootstrapInternalCanonicalCargoMarketTransaction(
    db,
    'uid-a',
    SERVER_NOW,
    CARGO,
  );
  assert.equal(bootstrapped.ok, true);
}

test('gate, client keys, epoch identity, ownership', () => {
  assert.equal(isCanonicalProductionMarketTickAllowed({ envValue: null }), false);
  assert.equal(isCanonicalProductionMarketTickAllowed(TICK), true);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ canonicalSchemaVersion: 1 }), true);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ tickCount: 4, canonicalSchemaVersion: 1 }), false);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ elapsedMs: 9, canonicalSchemaVersion: 1 }), false);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ currentPrice: 10, canonicalSchemaVersion: 1 }), false);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ stock: 3, canonicalSchemaVersion: 1 }), false);
  assert.equal(
    hasOnlyCanonicalMarketTickKeys({ eventMultiplier: 2, canonicalSchemaVersion: 1 }),
    false,
  );
  assert.equal(hasOnlyCanonicalMarketTickKeys({ seed: 'client', canonicalSchemaVersion: 1 }), false);
  assert.equal(deriveCanonicalMarketEpoch(SERVER_NOW), EPOCH);
  assert.equal(hasOnlyCanonicalMarketTickKeys({ deviceNow: SERVER_NOW + 365 * 24 * 60 * 60 * 1000 }), false);
  assert.equal(canonicalMarketTickId(EPOCH), `marketTick:${EPOCH}`);
  assert.equal(MARKET_OWNERSHIP_MODEL, 'GLOBAL_SHARED_MARKET');
  assert.equal(
    PRODUCTION_MARKET_TICK_AUTHORITY_STATUS,
    'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY',
  );
  assert.equal(PRODUCTION_MARKET_RNG_PARITY.includes('NOT_LOCAL_MATH_RANDOM'), true);
  assert.equal(ROAD_CONTRACT_MARKET_STATE_STATUS, 'ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY');
  assert.equal(ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS.includes('LOCAL_CONTRACT_WORLD_EVENTS'), true);
  assert.equal(ECONOMY_CONFIG_VERSION, 1);
});

test('quote matches global snapshot and is stable', () => {
  const quote = deriveCanonicalProductionMarketQuote(EPOCH, 'izmir', 'steel');
  assert.ok(quote);
  const snapshot = buildGlobalEconomySnapshot({ epoch: EPOCH, configVersion: ECONOMY_CONFIG_VERSION });
  assert.equal(quote!.price, snapshot.cityMarketPrices.izmir?.steel);
  assert.equal(quote!.epochSupply, snapshot.supplyDemandState.izmir?.steel?.supply);
  assert.equal(quote!.status, snapshot.supplyDemandState.izmir?.steel?.status);
  assert.equal(quote!.status, classifyEpochSupplyRatio(quote!.epochSupply, quote!.targetStock));
  const again = deriveCanonicalProductionMarketQuote(EPOCH, 'izmir', 'steel');
  assert.equal(again!.price, quote!.price);
  assert.equal(again!.epochSupply, quote!.epochSupply);
  assert.deepEqual(again!.eventIds, quote!.eventIds);
  assert.ok(quote!.epochSupply >= 0);
  assert.equal(quote!.seed, 'logisticore-global-market-v2');
  const ankara = deriveCanonicalProductionMarketQuote(EPOCH, 'ankara', 'textile');
  assert.notEqual(ankara!.price, quote!.price);
  assert.equal(classifyEpochSupplyRatio(quote!.targetStock, quote!.targetStock), 'balanced');
  assert.equal(classifyEpochSupplyRatio(quote!.targetStock * 0.69, quote!.targetStock), 'shortage');
  assert.equal(classifyEpochSupplyRatio(quote!.targetStock * 1.21, quote!.targetStock), 'surplus');
  assert.equal(deriveTradableSurplus(quote!.targetStock + 25, quote!.targetStock), 25);
  assert.equal(deriveTradableShortage(quote!.targetStock - 25, quote!.targetStock), 25);
  assert.equal(deriveTradableSurplus(quote!.targetStock, quote!.targetStock), 0);
});

test('fixed snapshot is not ticked; stamped tick is idempotent and cash-free', async () => {
  const db = createMemoryFirestore();
  await boot(db);
  const before = { ...db.dump.get('canonicalWorldMarkets/izmir_steel')! };
  const cashAfterSetup = db.dump.get(serverStateCurrentRef('uid-a'))!.cash;
  const cashTxnCount = [...db.dump.keys()].filter((key) => key.includes('canonicalCashTransactions')).length;
  const off = await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, {
    envValue: null,
  });
  assert.equal(off.ok, false);
  const skipped = await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, TICK);
  assert.equal(skipped.ok, true);
  if (skipped.ok) {
    assert.equal(skipped.appliedRecordCount, 0);
    assert.ok(skipped.skippedFixedSnapshot > 0);
  }
  const untouched = db.dump.get('canonicalWorldMarkets/izmir_steel')!;
  assert.equal(untouched.currentPrice, before.currentPrice);
  assert.equal(untouched.stock, before.stock);
  assert.equal(untouched.marketRevision, before.marketRevision);
  assert.equal(untouched.tickPolicyVersion, undefined);

  const stamped = await stampCanonicalProductionMarketTickPolicyTransaction(db, SERVER_NOW, TICK);
  assert.equal(stamped.ok, true);
  const first = await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, TICK);
  assert.equal(first.ok, true);
  const row = db.dump.get('canonicalWorldMarkets/izmir_steel')!;
  const quote = deriveCanonicalProductionMarketQuote(EPOCH, 'izmir', 'steel')!;
  assert.equal(row.currentPrice, quote.price);
  assert.equal(row.stock, before.stock);
  assert.equal(row.marketRevision, Number(before.marketRevision) + 1);
  assert.equal(row.lastAppliedTickId, canonicalMarketTickId(EPOCH));
  assert.equal(row.tickPolicyVersion, CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION);
  assert.equal(row.supplyIndex, quote.epochSupply);
  assert.equal(row.marketStatus, quote.status);
  const second = await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, TICK);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.alreadyApplied, true);
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.marketRevision, row.marketRevision);
  assert.equal(db.dump.get('users/uid-a')!.money, 22_000);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))!.cash, cashAfterSetup);
  assert.equal(db.dump.get('users/uid-a/financeLedger')!.entries, 1);
  assert.equal(
    [...db.dump.keys()].filter((key) => key.includes('canonicalCashTransactions')).length,
    cashTxnCount,
  );
  const manifest = db.dump.get(`canonicalMarketTicks/${canonicalMarketTickId(EPOCH)}`)!;
  assert.equal(manifest.status, 'COMPLETE');
  assert.equal(manifest.fuelPricePerLiter, quote.fuelPricePerLiter);
  assert.equal(db.dump.get('canonicalMarketClock/current')!.lastAppliedTickIndex, EPOCH);
});

test('partial retry applies each record once and later epoch replaces price only', async () => {
  const db = createMemoryFirestore();
  await boot(db);
  await stampCanonicalProductionMarketTickPolicyTransaction(db, SERVER_NOW, TICK);
  const stockBefore = db.dump.get('canonicalWorldMarkets/izmir_steel')!.stock;
  await assert.rejects(
    () =>
      advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, {
        ...TICK,
        failAfterUpdates: 2,
      }),
    /TEST_PARTIAL_MARKET_TICK/,
  );
  const partialCount = [...db.dump.entries()].filter(
    ([key, value]) =>
      key.startsWith('canonicalWorldMarkets/') && value.lastAppliedTickIndex === EPOCH,
  ).length;
  assert.equal(partialCount, 2);
  const resumed = await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, TICK);
  assert.equal(resumed.ok, true);
  const after = [...db.dump.entries()].filter(
    ([key, value]) =>
      key.startsWith('canonicalWorldMarkets/') && value.lastAppliedTickIndex === EPOCH,
  );
  assert.equal(after.length, CITIES.length * PRODUCT_IDS.length);
  assert.equal(
    after.filter(([, value]) => value.marketRevision === 2).length,
    CITIES.length * PRODUCT_IDS.length,
  );
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.stock, stockBefore);

  const nextNow = (EPOCH + 3) * marketTickIntervalMs();
  const jumped = await advanceCanonicalProductionMarketTickTransaction(db, nextNow, TICK);
  assert.equal(jumped.ok, true);
  const jumpedQuote = deriveCanonicalProductionMarketQuote(EPOCH + 3, 'izmir', 'steel')!;
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.currentPrice, jumpedQuote.price);
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.stock, stockBefore);
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.marketRevision, 3);
  const sequentialDb = createMemoryFirestore();
  await boot(sequentialDb);
  await stampCanonicalProductionMarketTickPolicyTransaction(sequentialDb, SERVER_NOW, TICK);
  for (const epoch of [EPOCH, EPOCH + 1, EPOCH + 2, EPOCH + 3]) {
    const step = await advanceCanonicalProductionMarketTickTransaction(
      sequentialDb,
      epoch * marketTickIntervalMs() + 1,
      TICK,
    );
    assert.equal(step.ok, true);
  }
  assert.equal(
    sequentialDb.dump.get('canonicalWorldMarkets/izmir_steel')!.currentPrice,
    jumpedQuote.price,
  );
  assert.equal(sequentialDb.dump.get('canonicalWorldMarkets/izmir_steel')!.stock, stockBefore);
});

test('tick keeps buy and sell stock and uses the ticked price', async () => {
  const db = createMemoryFirestore();
  await boot(db);
  await stampCanonicalProductionMarketTickPolicyTransaction(db, SERVER_NOW, TICK);
  const bought = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    10,
    whId('izmir', 'standard'),
    'buy-intent-1',
    SERVER_NOW,
    CARGO,
  );
  assert.equal(bought.ok, true);
  const stockAfterBuy = db.dump.get('canonicalWorldMarkets/izmir_textile')!.stock;
  await advanceCanonicalProductionMarketTickTransaction(db, SERVER_NOW, TICK);
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_textile')!.stock, stockAfterBuy);
  const quote = deriveCanonicalProductionMarketQuote(EPOCH, 'izmir', 'textile')!;
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_textile')!.currentPrice, quote.price);
  const staleQuote = 1;
  assert.notEqual(staleQuote, quote.price);
  const boughtAgain = await buyCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    5,
    whId('izmir', 'standard'),
    'buy-intent-2',
    SERVER_NOW,
    CARGO,
  );
  assert.equal(boughtAgain.ok, true);
  if (boughtAgain.ok) assert.equal(boughtAgain.receipt.unitPrice, quote.price);
  const sold = await sellCanonicalCargoTransaction(
    db,
    'uid-a',
    'izmir',
    'textile',
    5,
    whId('izmir', 'standard'),
    'sell-intent-1',
    SERVER_NOW,
    CARGO,
  );
  assert.equal(sold.ok, true);
  if (sold.ok) assert.equal(sold.receipt.unitPrice, quote.price);
  assert.equal(
    db.dump.get('canonicalWorldMarkets/izmir_textile')!.stock,
    Number(stockAfterBuy) - 5 + 5,
  );
});

test('plan does not replay an applied epoch', () => {
  const row = {
    cityId: 'izmir',
    productId: 'steel' as const,
    stock: 80,
    currentPrice: 10,
    marketRevision: 4,
    tickPolicyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
    lastAppliedTickIndex: EPOCH,
  };
  const plan = planCanonicalProductionMarketTick({ epoch: EPOCH, rows: [row] });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.alreadyApplied, 1);
  const fixed = planCanonicalProductionMarketTick({
    epoch: EPOCH,
    rows: [{ ...row, tickPolicyVersion: undefined, lastAppliedTickIndex: undefined }],
  });
  assert.equal(fixed.skippedFixedSnapshot, 1);
  assert.equal(fixed.updates.length, 0);
});
