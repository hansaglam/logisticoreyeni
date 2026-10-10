/**
 * Canonical contract refresh game-time parity — in-memory tests (Step 29AE).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { acceptCanonicalRoadDeliveryTransaction } from '../src/canonicalRoadDelivery';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import {
  CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS,
  CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5,
  PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS,
  REFRESH_AD_OVERRIDE_CLASSIFICATION,
  canonicalRefreshRemainingGameHours,
  canonicalRefreshSeed,
  hasOnlyCanonicalRoadRefreshKeys,
  isCanonicalRefreshEligible,
  isCanonicalRoadContractRefreshAllowed,
} from '../../src/domain/canonicalContractRefresh';
import { setCanonicalContractClockPaused } from '../../src/domain/canonicalContractGameTimeExpiry';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
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
        id?: string;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
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
const HOUR_MS = 15_000;

function seedMarkets(db: { dump: Map<string, Record<string, unknown>> }, uid: string) {
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

const gates = {
  envValue: 'INTERNAL_TEST',
  expiryEnvValue: 'INTERNAL_TEST',
  refreshEnvValue: 'INTERNAL_TEST',
} as const;

test('refresh eligibility uses an inclusive 3 game-hour boundary and rejects client fields', () => {
  assert.equal(isCanonicalRoadContractRefreshAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadContractRefreshAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS, 3);
  assert.equal(CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS, 3);
  assert.equal(PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS, false);
  assert.equal(REFRESH_AD_OVERRIDE_CLASSIFICATION, 'REFRESH_AD_OVERRIDE_BLOCKED_VERIFICATION');
  assert.equal(isCanonicalRefreshEligible({ currentGameHours: 102.999, lastRefreshGameHours: 100 }), false);
  assert.equal(isCanonicalRefreshEligible({ currentGameHours: 103, lastRefreshGameHours: 100 }), true);
  assert.equal(isCanonicalRefreshEligible({ currentGameHours: 103.001, lastRefreshGameHours: 100 }), true);
  assert.equal(
    canonicalRefreshRemainingGameHours({ currentGameHours: 102.999, lastRefreshGameHours: 100 }) > 0,
    true,
  );
  assert.equal(canonicalRefreshSeed('uid', 1, 100) === canonicalRefreshSeed('uid', 0, 100), false);
  assert.equal(
    hasOnlyCanonicalRoadRefreshKeys({ canonicalSchemaVersion: 1, refreshIntentId: 'intent-0001' }),
    true,
  );
  for (const key of ['canRefresh', 'cooldown', 'elapsedGameHours', 'lastRefresh', 'refreshSequence', 'seed', 'eligible']) {
    assert.equal(hasOnlyCanonicalRoadRefreshKeys({ canonicalSchemaVersion: 1, [key]: 1 }), false);
  }
});

test('manual refresh waits 3 game hours, rerolls once, and keeps still-valid offers', async () => {
  const db = createMemoryFirestore();
  const uid = 'refresh-user';
  seedMarkets(db, uid);
  db.dump.set(`users/${uid}/canonicalRoadContracts/keep-valid`, {
    ownerUid: uid,
    status: 'AVAILABLE',
    expiryAuthority: 'CANONICAL_GAME_TIME',
    expiresAtGameHours: 100,
    payment: 500,
    deadlineHours: 12,
  });
  db.dump.set(`users/${uid}/canonicalRoadContracts/due-offer`, {
    ownerUid: uid,
    status: 'AVAILABLE',
    expiryAuthority: 'CANONICAL_GAME_TIME',
    expiresAtGameHours: 1,
    payment: 640,
    deadlineHours: 8,
  });
  db.dump.set(`users/${uid}/canonicalRoadContracts/accepted-offer`, {
    ownerUid: uid,
    status: 'ACCEPTED',
    expiryAuthority: 'CANONICAL_GAME_TIME',
    expiresAtGameHours: 1,
    payment: 777,
    deadlineHours: 9,
  });
  db.dump.set(`users/${uid}/serverState/current`, { cash: 1000 });

  const initial = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(initial.ok, true);
  if (!initial.ok) return;
  assert.equal(initial.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5);
  assert.equal(initial.refreshSequence, 0);
  assert.equal(initial.offerCount <= 10, true);
  const refreshState = db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`);
  assert.equal(refreshState?.lastRefreshGameHours, 0);
  assert.equal(refreshState?.refreshSequence, 0);

  const tooSoon = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 2 * HOUR_MS + 14_999, {
    ...gates,
    refreshIntentId: 'intent-too-soon',
  });
  assert.equal(tooSoon.ok, false);
  if (tooSoon.ok) return;
  assert.equal(tooSoon.reason, 'CONTRACT_REFRESH_COOLDOWN_ACTIVE');
  assert.equal((tooSoon.remainingGameHours ?? 0) > 0, true);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.refreshSequence, 0);

  const paused = setCanonicalContractClockPaused(
    db.dump.get(`users/${uid}/canonicalContractClock/current`) as never,
    true,
    NOW + HOUR_MS,
  );
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  db.dump.set(`users/${uid}/canonicalContractClock/current`, { ...paused.state });
  const pausedRefresh = await generateCanonicalProductionRoadBatchTransaction(
    db,
    uid,
    NOW + 48 * 60 * 60 * 1000,
    { ...gates, refreshIntentId: 'intent-paused' },
  );
  assert.equal(pausedRefresh.ok, false);
  if (pausedRefresh.ok) return;
  assert.equal(pausedRefresh.reason, 'CONTRACT_REFRESH_COOLDOWN_ACTIVE');

  const resumed = setCanonicalContractClockPaused(paused.state, false, NOW + HOUR_MS);
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  db.dump.set(`users/${uid}/canonicalContractClock/current`, { ...resumed.state });

  const blockedBoundary = await generateCanonicalProductionRoadBatchTransaction(
    db,
    uid,
    NOW + 3 * HOUR_MS - 1,
    { ...gates, refreshIntentId: 'intent-boundary-block' },
  );
  assert.equal(blockedBoundary.ok, false);

  const refreshed = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, {
    ...gates,
    refreshIntentId: 'intent-refresh-1',
  });
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) return;
  assert.equal(refreshed.refreshSequence, 1);
  assert.equal(refreshed.batchId, `rcbatch_${uid}_r1`);
  assert.equal(refreshed.offerCount <= CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS, true);
  const after = db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`);
  assert.equal(after?.lastRefreshGameHours, 3);
  assert.equal(after?.refreshSequence, 1);
  const batch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed.batchId}`);
  assert.equal(String(batch?.seed).includes(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5), true);
  assert.equal(String(batch?.seed).includes('|1|'), true);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/keep-valid`)?.status, 'AVAILABLE');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/keep-valid`)?.payment, 500);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/due-offer`)?.status, 'EXPIRED');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/due-offer`)?.payment, 640);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/accepted-offer`)?.status, 'ACCEPTED');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/accepted-offer`)?.payment, 777);
  assert.equal(db.dump.get(`users/${uid}/serverState/current`)?.cash, 1000);
  assert.equal(db.dump.has(`users/${uid}/canonicalCashTransactions/refresh`), false);

  const retry = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS + 5_000, {
    ...gates,
    refreshIntentId: 'intent-refresh-1',
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.batchId, refreshed.batchId);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.refreshSequence, 1);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.lastRefreshGameHours, 3);

  const secondDevice = await generateCanonicalProductionRoadBatchTransaction(
    db,
    uid,
    NOW + 3 * HOUR_MS + 6_000,
    { ...gates, refreshIntentId: 'intent-other-device' },
  );
  assert.equal(secondDevice.ok, false);
  if (secondDevice.ok) return;
  assert.equal(secondDevice.reason, 'CONTRACT_REFRESH_COOLDOWN_ACTIVE');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.refreshSequence, 1);
});

test('partial refresh retry keeps the same sequence and superseded offers reject', async () => {
  const db = createMemoryFirestore();
  const uid = 'refresh-partial';
  seedMarkets(db, uid);
  const initial = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(initial.ok, true);
  await assert.rejects(
    () =>
      generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, {
        ...gates,
        refreshIntentId: 'intent-partial',
        failAfterOffers: 1,
      }),
    /TEST_PARTIAL_ROAD_ISSUANCE/,
  );
  const mid = db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`);
  assert.equal(mid?.refreshSequence, 1);
  assert.equal(mid?.lastRefreshGameHours, 3);
  const retry = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS + HOUR_MS, {
    ...gates,
    refreshIntentId: 'intent-partial',
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.refreshSequence, 1);
  assert.equal(retry.batchId, `rcbatch_${uid}_r1`);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.refreshSequence, 1);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractRefresh/current`)?.lastRefreshGameHours, 3);
  const batch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${retry.batchId}`);
  assert.equal(batch?.status, 'COMPLETE');

  db.dump.set(`users/${uid}/canonicalRoadContracts/gone`, {
    ownerUid: uid,
    status: 'SUPERSEDED',
    payment: 10,
    deadlineHours: 4,
    expiresAtMs: NOW + 999999,
    issuedAtMs: NOW,
    batchId: 'old',
  });
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    uid,
    {
      canonicalSchemaVersion: 1,
      contractId: 'gone',
    },
    NOW + 3 * HOUR_MS,
    { envValue: 'INTERNAL_TEST', expiryEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, false);
  if (accepted.ok) return;
  assert.equal(accepted.reason, 'CONTRACT_SUPERSEDED');
});
