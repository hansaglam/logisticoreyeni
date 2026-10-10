/**
 * Canonical contract game-time expiry — in-memory tests (Step 29AD).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { acceptCanonicalRoadDeliveryTransaction } from '../src/canonicalRoadDelivery';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import { contractExpiryBalance } from '../../src/config/balance';
import {
  advanceCanonicalContractClock,
  createInitialCanonicalContractClock,
  isCanonicalContractExpiryAllowed,
  isCanonicalOfferExpiredAtGameHours,
  setCanonicalContractClockPaused,
  setCanonicalContractClockSpeed,
} from '../../src/domain/canonicalContractGameTimeExpiry';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4,
  generateCanonicalProductionRoadOffers,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import { calculateContractExpiresAt } from '../../src/simulation/contracts';
import { hasOnlyCanonicalRoadAcceptKeys } from '../../src/domain/canonicalRoadDelivery';
import type { CanonicalTradableMarketRow } from '../../src/domain/canonicalProductionRoadContractIssuance';

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
        docs: Array<{ id?: string; data: () => Record<string, unknown> }>;
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
              .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
              .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
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

const NOW = 1_700_000_000_000;

function seedMarkets(db: { dump: Map<string, Record<string, unknown>> }, uid = 'uid-expiry') {
  db.dump.set(`users/${uid}/canonicalCompanyProgression/current`, { level: 1, reputation: 0 });
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      const row: CanonicalTradableMarketRow = {
        cityId: city.id,
        productId,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      };
      db.dump.set(`canonicalWorldMarkets/${row.cityId}_${row.productId}`, { ...row, stock: 1 });
    }
  }
}

test('clock pause, speed, offline cap, and boundary match production', () => {
  assert.equal(isCanonicalContractExpiryAllowed({ envValue: null }), false);
  const urgent = calculateContractExpiresAt(100, 8, 0.9) - 100;
  assert.equal(urgent >= contractExpiryBalance.urgentMinHours && urgent <= contractExpiryBalance.urgentMaxHours, true);
  const normal = calculateContractExpiresAt(100, 8, 0.2) - 100;
  assert.equal(normal >= contractExpiryBalance.normalMinHours && normal <= contractExpiryBalance.normalMaxHours, true);
  const long = calculateContractExpiresAt(100, 20, 0.2) - 100;
  assert.equal(long >= contractExpiryBalance.longMinHours && long <= contractExpiryBalance.longMaxHours, true);
  assert.equal(isCanonicalOfferExpiredAtGameHours(100, 100), true);
  assert.equal(isCanonicalOfferExpiredAtGameHours(99.999, 100), false);

  let clock = createInitialCanonicalContractClock(NOW);
  const oneHour = advanceCanonicalContractClock(clock, NOW + 15_000);
  assert.equal(oneHour.ok, true);
  if (!oneHour.ok) return;
  assert.equal(oneHour.state.currentGameHours, 1);
  const paused = setCanonicalContractClockPaused(oneHour.state, true, NOW + 15_000);
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  const held = advanceCanonicalContractClock(paused.state, NOW + 15_000 + 10 * 60 * 60 * 1000);
  assert.equal(held.ok && held.state.currentGameHours, 1);
  const resumed = setCanonicalContractClockPaused(held.ok ? held.state : paused.state, false, NOW + 15_000 + 10 * 60 * 60 * 1000);
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  const afterResume = advanceCanonicalContractClock(resumed.state, resumed.state.lastAdvancedAtServerMs + 15_000);
  assert.equal(afterResume.ok && afterResume.state.currentGameHours, 2);

  const fast = setCanonicalContractClockSpeed(createInitialCanonicalContractClock(NOW), 8, NOW);
  assert.equal(fast.ok, true);
  if (!fast.ok) return;
  const fastHour = advanceCanonicalContractClock(fast.state, NOW + 1_000);
  assert.equal(fastHour.ok && fastHour.state.currentGameHours === 1, true);
  const slow = advanceCanonicalContractClock(createInitialCanonicalContractClock(NOW), NOW + 1_000);
  assert.equal(slow.ok && slow.state.currentGameHours < 1, true);

  const away = advanceCanonicalContractClock(createInitialCanonicalContractClock(NOW), NOW + 48 * 60 * 60 * 1000);
  assert.equal(away.ok && away.state.currentGameHours, 24);
  const rewound = advanceCanonicalContractClock(away.ok ? away.state : clock, NOW);
  assert.equal(rewound.ok && away.ok && rewound.state.currentGameHours === away.state.currentGameHours, true);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ gameTime: 1, expiresAt: 2, elapsedGameHours: 3 }), false);
  assert.equal(hasOnlyCanonicalRoadAcceptKeys({ contractId: 'a', canonicalSchemaVersion: 1, gameTime: 1 }), false);
});

test('v4 freezes game-hour expiry and retry does not extend it', async () => {
  const db = createMemoryFirestore();
  seedMarkets(db);
  const legacy = generateCanonicalProductionRoadOffers({
    uid: 'uid-a',
    serverNowMs: NOW,
    playerLevel: 1,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: [],
    fuelPricePerLiter: 1.7,
  });
  assert.equal(legacy.ok, false);

  let thrown = false;
  try {
    await generateCanonicalProductionRoadBatchTransaction(db, 'uid-expiry', NOW, {
      envValue: 'INTERNAL_TEST',
      expiryEnvValue: 'INTERNAL_TEST',
      failAfterOffers: 1,
    });
  } catch (error) {
    thrown = error instanceof Error && error.message === 'TEST_PARTIAL_ROAD_ISSUANCE';
  }
  assert.equal(thrown, true);
  const partial = [...db.dump.values()].find((value) => value.status === 'PARTIAL');
  assert.ok(partial);
  const issuedHours = partial!.issuedAtCanonicalGameHours;
  const offerKey = [...db.dump.keys()].find((key) => key.includes('canonicalRoadContracts/'));
  assert.ok(offerKey);
  const first = db.dump.get(offerKey!)!;
  assert.equal(first.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4);
  assert.equal(first.expiryAuthority, 'CANONICAL_GAME_TIME');
  assert.equal(Number(first.expiresAtGameHours) > Number(issuedHours), true);
  assert.notEqual(first.expiresAtGameHours, first.deadlineHours);
  const payment = first.payment;
  const deadline = first.deadlineHours;
  const retry = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-expiry', NOW + 60_000, {
    envValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4);
  assert.equal(db.dump.get(offerKey!)!.issuedAtGameHours, issuedHours);
  const batch = [...db.dump.values()].find((value) => value.status === 'COMPLETE');
  assert.equal(batch?.issuedAtCanonicalGameHours, issuedHours);
  assert.equal(db.dump.get(offerKey!)!.payment, payment);
  assert.equal(db.dump.get(offerKey!)!.deadlineHours, deadline);
  assert.equal(db.dump.get(offerKey!)!.expiresAtGameHours, first.expiresAtGameHours);

  const wall = generateCanonicalProductionRoadOffers({
    uid: 'uid-a',
    serverNowMs: NOW,
    playerLevel: 1,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: [{
      cityId: 'izmir',
      productId: 'steel',
      tradableStock: 1,
      epochSupply: 100,
      currentPrice: 10,
      targetStock: 20,
      marketRevision: 1,
      lastAppliedTickIndex: 100,
    }, {
      cityId: 'ankara',
      productId: 'steel',
      tradableStock: 1,
      epochSupply: 0,
      currentPrice: 40,
      targetStock: 20,
      marketRevision: 1,
      lastAppliedTickIndex: 100,
    }],
    fuelPricePerLiter: 1.7,
  });
  if (wall.ok) {
    assert.equal(wall.offers[0]?.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION);
    assert.equal(wall.offers[0]?.expiryAuthority, 'SERVER_WINDOW');
  }
});

test('acceptance uses the server clock and ignores a later wall window', async () => {
  const db = createMemoryFirestore();
  const contractPath = 'users/uid-a/canonicalRoadContracts/offer-1';
  db.dump.set(contractPath, {
    ownerUid: 'uid-a',
    contractId: 'offer-1',
    status: 'AVAILABLE',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    payment: 500,
    deadlineHours: 12,
    distanceKm: 100,
    tollCost: 0,
    expiresAtMs: NOW + 3 * 60 * 60 * 1000,
    expiresAtGameHours: 10,
    expiryAuthority: 'CANONICAL_GAME_TIME',
    policyVersion: CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4,
  });
  db.dump.set('users/uid-a/canonicalContractClock/current', {
    ...createInitialCanonicalContractClock(NOW),
    currentGameHours: 9,
  });
  const before = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: 'offer-1', canonicalSchemaVersion: 1 },
    NOW + 14_999,
    { expiryEnvValue: 'INTERNAL_TEST' },
  );
  assert.notEqual(before.ok ? '' : before.reason, 'CONTRACT_EXPIRED');
  assert.equal(db.dump.get(contractPath)!.payment, 500);
  db.dump.set('users/uid-a/canonicalContractClock/current', {
    ...createInitialCanonicalContractClock(NOW),
    currentGameHours: 9,
  });
  db.dump.set(contractPath, { ...db.dump.get(contractPath)!, status: 'AVAILABLE' });
  const expired = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: 'offer-1', canonicalSchemaVersion: 1 },
    NOW + 15_000,
    { expiryEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, 'CONTRACT_EXPIRED');
  assert.equal(db.dump.get(contractPath)!.payment, 500);
  assert.equal(db.dump.get(contractPath)!.deadlineHours, 12);
});
