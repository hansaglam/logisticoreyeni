/**
 * Production ROAD contract issuance parity — in-memory tests (Step 29AA).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  PRODUCTION_CONTRACT_RNG_PARITY,
  PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS,
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  canonicalProductionRoadSeed,
  generateCanonicalProductionRoadOffers,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
  isCanonicalProductionRoadIssuanceAllowed,
  oldIssuancePolicyRemainsSeparate,
} from '../../src/domain/canonicalProductionRoadContractIssuance';
import { CANONICAL_ROAD_ISSUANCE_POLICY_VERSION } from '../../src/domain/canonicalRoadContract';
import type { CanonicalTradableMarketRow } from '../../src/domain/canonicalProductionRoadContractIssuance';
import type { ProductId } from '../../src/types/game';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';

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
    async runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ data: () => Record<string, unknown> | undefined }>;
      }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) {
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

const GATE = { envValue: 'INTERNAL_TEST' as const };
const NOW = 1_700_000_000_000;

function catalogRows(): CanonicalTradableMarketRow[] {
  const rows: CanonicalTradableMarketRow[] = [];
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      rows.push({
        cityId: city.id,
        productId,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
  return rows;
}

function snapshot(rows: CanonicalTradableMarketRow[], uid = 'uid-a') {
  return {
    uid,
    serverNowMs: NOW,
    playerLevel: 1,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: rows,
    fuelPricePerLiter: 1.72,
  };
}

function seedAccount(db: ReturnType<typeof createMemoryFirestore>, uid = 'uid-a') {
  db.dump.set(`users/${uid}/canonicalCompanyProgression/current`, {
    level: 1,
    reputation: 0,
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  for (const row of catalogRows()) {
    db.dump.set(`canonicalWorldMarkets/${row.cityId}_${row.productId}`, {
      cityId: row.cityId,
      productId: row.productId,
        stock: row.tradableStock,
        epochSupply: row.epochSupply,
      currentPrice: row.currentPrice,
      marketRevision: row.marketRevision,
      lastAppliedTickIndex: row.lastAppliedTickIndex,
    });
  }
}

test('gate, client keys, old policy, blockers', () => {
  assert.equal(isCanonicalProductionRoadIssuanceAllowed({ envValue: null }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ playerLevel: 9 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ reputation: 10 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ fleetCapacity: 40 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ driverCount: 2 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ seed: 'x' }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ currentPrice: 1 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ stock: 4 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventMultiplier: 1.2 }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ canonicalSchemaVersion: 1 }), true);
  assert.equal(oldIssuancePolicyRemainsSeparate(), CANONICAL_ROAD_ISSUANCE_POLICY_VERSION);
  assert.equal(
    CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
    'canonical-road-contract-issuance-internal-production-parity-v1',
  );
  assert.equal(
    PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS,
    'PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_PASS_INTERNAL_ONLY',
  );
  assert.equal(ROAD_CONTRACT_ISSUANCE_READINESS, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION');
  assert.equal(PRODUCTION_CONTRACT_RNG_PARITY.includes('DIFFERENT_SEQUENCE'), true);
  assert.equal(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('PUBLIC_CONTRACTS_UI_UNWIRED'), true);
  assert.equal(
    generateCanonicalProductionRoadOffers(snapshot([])).ok,
    false,
  );
  const blockedLevel = generateCanonicalProductionRoadOffers({
    ...snapshot(catalogRows()),
    playerLevel: 0,
  });
  assert.equal(blockedLevel.ok, false);
  const mixed = generateCanonicalProductionRoadOffers(
    snapshot([
      { ...catalogRows()[0]!, lastAppliedTickIndex: 1 },
      { ...catalogRows()[1]!, lastAppliedTickIndex: 2 },
    ]),
  );
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.reason, 'MARKET_EPOCH_INCOHERENT');
});

test('same window is deterministic and ignores catalog stock when rows are empty of surplus', () => {
  const starved = generateCanonicalProductionRoadOffers(
    snapshot([
      {
        cityId: 'izmir',
        productId: 'steel' as ProductId,
        epochSupply: 0,
        tradableStock: 500,
        currentPrice: 100,
        targetStock: 100,
        marketRevision: 1,
        lastAppliedTickIndex: 3,
      },
    ]),
  );
  assert.equal(starved.ok, true);
  if (starved.ok) assert.equal(starved.offers.length, 0);

  const first = generateCanonicalProductionRoadOffers(snapshot(catalogRows()));
  const second = generateCanonicalProductionRoadOffers(snapshot(catalogRows()));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.ok(first.offers.length > 0);
    assert.equal(first.offers.length <= 10, true);
    assert.deepEqual(
      first.offers.map((offer) => offer.contractId),
      second.offers.map((offer) => offer.contractId),
    );
    assert.deepEqual(
      first.offers.map((offer) => offer.payment),
      second.offers.map((offer) => offer.payment),
    );
    assert.equal(first.offers[0]!.contractEventMultiplier, 1);
    assert.equal(first.seed, canonicalProductionRoadSeed('uid-a', first.windowIndex, first.marketEpoch));
    const otherWindow = generateCanonicalProductionRoadOffers({
      ...snapshot(catalogRows()),
      serverNowMs: NOW + 3 * 60 * 60 * 1000,
    });
    assert.equal(otherWindow.ok, true);
    if (otherWindow.ok) {
      assert.notEqual(otherWindow.batchId, first.batchId);
      assert.notEqual(otherWindow.seed, first.seed);
    }
    const otherUser = generateCanonicalProductionRoadOffers(snapshot(catalogRows(), 'uid-b'));
    assert.equal(otherUser.ok, true);
    if (otherUser.ok) assert.notEqual(otherUser.offers[0]?.contractId, first.offers[0]?.contractId);
  }
});

test('batch persists once, partial retry keeps slots, market and cash stay put', async () => {
  const db = createMemoryFirestore();
  const off = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, { envValue: null });
  assert.equal(off.ok, false);
  const legacy = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION');

  seedAccount(db);
  const stockBefore = db.dump.get('canonicalWorldMarkets/izmir_steel')!.stock;
  assert.equal(stockBefore, 1);
  await assert.rejects(
    () =>
      generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, {
        ...GATE,
        failAfterOffers: 1,
      }),
    /TEST_PARTIAL_ROAD_ISSUANCE/,
  );
  const partial = [...db.dump.keys()].filter((key) => key.startsWith('users/uid-a/canonicalRoadContracts/'));
  assert.equal(partial.length, 1);
  const firstPayment = db.dump.get(partial[0]!)!.payment;
  const resumed = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(resumed.ok, true);
  if (resumed.ok) {
    assert.equal(resumed.alreadyApplied, false);
    assert.ok(resumed.offerCount >= 1);
  }
  assert.equal(db.dump.get(partial[0]!)!.payment, firstPayment);
  const again = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.alreadyApplied, true);
  db.dump.set('canonicalWorldMarkets/izmir_steel', {
    ...db.dump.get('canonicalWorldMarkets/izmir_steel')!,
    stock: 7,
    currentPrice: 9,
  });
  db.dump.set('users/uid-a/canonicalCompanyProgression/current', {
    level: 20,
    reputation: 90,
    ownerUid: 'uid-a',
  });
  const frozen = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(frozen.ok, true);
  if (frozen.ok) assert.equal(frozen.alreadyApplied, true);
  assert.equal(db.dump.get(partial[0]!)!.payment, firstPayment);
  assert.equal(db.dump.get('canonicalWorldMarkets/izmir_steel')!.stock, 7);
  assert.equal(db.dump.get('users/uid-a')!.money, 22_000);
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);
  const batch = [...db.dump.values()].find((value) => value.policyVersion === CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION && value.status === 'COMPLETE');
  assert.ok(batch);
  assert.equal(batch!.contractEventMultiplier, 1);
  assert.equal(batch!.fleetSnapshotClass, 'CAPACITY_ONLY_LOCATION_UNVERIFIED');
});
