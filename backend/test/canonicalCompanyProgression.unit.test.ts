/**
 * Canonical company progression / ROAD reputation authority — in-memory tests (Step 29AF).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../src/canonicalCompanyProgression';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import { calculateXpToNextLevel, levelConfig } from '../../src/config/levelConfig';
import { REPUTATION_RULES } from '../../src/config/reputationRules';
import { calculateDeliveryXp } from '../../src/simulation/leveling';
import {
  CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
  CANONICAL_PROGRESSION_FORBIDDEN_CLIENT_KEYS,
  CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
  CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
  applyCanonicalCompanyXp,
  applyCanonicalReputationDelta,
  classifyCanonicalCompanyProgression,
  containsForbiddenProgressionClientKeys,
  createInitialCanonicalCompanyProgression,
  deriveCanonicalRoadCancelReputation,
  deriveCanonicalRoadCompletionReputation,
  deriveCanonicalRoadCompletionXp,
  deriveCanonicalRoadServerFailureReputation,
  hasOnlyCanonicalProgressionInitKeys,
  isCanonicalCompanyProgressionAllowed,
  planCanonicalProgressionMutation,
  resolveCanonicalProgressionForIssuance,
  type CanonicalCompanyProgressionState,
} from '../../src/domain/canonicalCompanyProgression';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';
import { createInternalFixtureRuntime } from '../../src/domain/canonicalFleetRuntimeLocation';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';

type Dump = Map<string, Record<string, unknown>>;

function createMemoryFirestore(): Firestore & { dump: Dump } {
  const dump: Dump = new Map();
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
  return firestore as unknown as Firestore & { dump: Dump };
}

const NOW = 1_700_000_000_000;
const HOUR_MS = 15_000;
const GATE = { envValue: 'INTERNAL_TEST' } as const;
const PROGRESSION = { progressionEnvValue: 'INTERNAL_TEST' } as const;

const ISSUANCE = {
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  productId: 'steel',
  amount: 10,
  originMarket: buildFixtureMarket({ currentPrice: 1900, basePrice: 2000, stock: 90, targetStock: 40 }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2400,
    basePrice: 2000,
    stock: 10,
    targetStock: 50,
    consumptionPerDay: 20,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 1,
};

function progressionPath(uid: string) {
  return `users/${uid}/canonicalCompanyProgression/current`;
}

function receiptKeys(db: { dump: Dump }, uid: string): string[] {
  return [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalProgressionReceipts/`));
}

async function acceptDelivery(
  db: Firestore & { dump: Dump },
  uid: string,
  sequence: number,
  startMs: number,
): Promise<{ deliveryId: string; deadlineHours: number; plannedHours: number }> {
  const issued = await issueCanonicalRoadContractTransaction(db, uid, { ...ISSUANCE, sequence }, startMs);
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error('issue failed');
  if (![...db.dump.keys()].some((key) => key.startsWith(`users/${uid}/canonicalFleetAssets/`))) {
    const fleet = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, GATE);
    assert.equal(fleet.ok, true);
  }
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    uid,
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    startMs,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) throw new Error(accepted.reason);
  const doc = db.dump.get(`users/${uid}/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`) as {
    timingSnapshot: { plannedTravelGameHours: number };
  };
  return {
    deliveryId: accepted.receipt.deliveryId,
    deadlineHours: accepted.receipt.deadlineHours,
    plannedHours: doc.timingSnapshot.plannedTravelGameHours,
  };
}

async function initAccount(db: Firestore & { dump: Dump }, uid: string) {
  const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, GATE);
  assert.equal(init.ok, true);
  return init;
}

function seedIssuanceWorld(db: { dump: Dump }, uid: string) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      db.dump.set(`canonicalWorldMarkets/${city.id}_${productId}`, {
        cityId: city.id,
        productId,
        stock: 1,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
}

test('gate, policies, initial state and client key rejection', () => {
  assert.equal(isCanonicalCompanyProgressionAllowed({ envValue: null }), false);
  assert.equal(isCanonicalCompanyProgressionAllowed({ envValue: undefined }), false);
  assert.equal(isCanonicalCompanyProgressionAllowed({ envValue: 'ON' }), false);
  assert.equal(isCanonicalCompanyProgressionAllowed({ envValue: 'INTERNAL_TEST' }), true);
  const state = createInitialCanonicalCompanyProgression('uid-a', NOW);
  assert.equal(state.level, 1);
  assert.equal(state.xp, 0);
  assert.equal(state.totalXp, 0);
  assert.equal(state.xpToNextLevel, 100);
  assert.equal(state.reputation, 50);
  assert.equal(state.progressionRevision, 1);
  assert.equal(state.progressionPolicyVersion, 'canonical-company-progression-v1');
  assert.equal(state.reputationPolicyVersion, 'canonical-road-reputation-v1');
  for (const key of [
    'level',
    'xp',
    'experience',
    'reputation',
    'reputationDelta',
    'xpDelta',
    'newLevel',
    'companyLevel',
    'companyXp',
    'progressionRevision',
    'score',
    'companyScore',
  ]) {
    assert.equal((CANONICAL_PROGRESSION_FORBIDDEN_CLIENT_KEYS as readonly string[]).includes(key), true, key);
    assert.equal(containsForbiddenProgressionClientKeys({ canonicalSchemaVersion: 1, [key]: 99 }), true, key);
    assert.equal(hasOnlyCanonicalProgressionInitKeys({ canonicalSchemaVersion: 1, [key]: 99 }), false, key);
  }
  assert.equal(hasOnlyCanonicalProgressionInitKeys({ canonicalSchemaVersion: 1 }), true);
  const unknownPolicy = classifyCanonicalCompanyProgression(
    { ...state, progressionPolicyVersion: 'canonical-company-progression-v9' },
    'uid-a',
  );
  assert.equal(unknownPolicy.authorityClass, 'UNSUPPORTED');
  const wrongOwner = classifyCanonicalCompanyProgression({ ...state }, 'uid-b');
  assert.equal(wrongOwner.authorityClass, 'UNSUPPORTED');
  const forgedLevel = classifyCanonicalCompanyProgression({ ...state, level: 20 }, 'uid-a');
  assert.equal(forgedLevel.authorityClass, 'UNSUPPORTED');
  const legacy = classifyCanonicalCompanyProgression(
    { authorityClass: 'LEGACY_CLIENT_UNVERIFIED', level: 20, reputation: 100 },
    'uid-a',
  );
  assert.equal(legacy.authorityClass, 'LEGACY_CLIENT_UNVERIFIED');
  assert.equal(classifyCanonicalCompanyProgression(undefined, 'uid-a').authorityClass, 'UNINITIALIZED');
});

test('golden level vectors reuse production thresholds', () => {
  const base = createInitialCanonicalCompanyProgression('uid-a', NOW);
  assert.equal(calculateXpToNextLevel(1), 100);
  assert.equal(calculateXpToNextLevel(2), 273);
  assert.equal(calculateXpToNextLevel(3), 492);
  const below = applyCanonicalCompanyXp(base, 99);
  assert.deepEqual([below.level, below.xp, below.totalXp], [1, 99, 99]);
  const exact = applyCanonicalCompanyXp(base, 100);
  assert.deepEqual([exact.level, exact.xp, exact.xpToNextLevel, exact.totalXp], [2, 0, 273, 100]);
  const above = applyCanonicalCompanyXp(base, 101);
  assert.deepEqual([above.level, above.xp], [2, 1]);
  const multi = applyCanonicalCompanyXp(base, 100 + 273 + 492 + 5);
  assert.deepEqual([multi.level, multi.xp, multi.newLevels], [4, 5, [2, 3, 4]]);
  let total = 0;
  for (let level = 1; level < levelConfig.maxLevel; level += 1) total += calculateXpToNextLevel(level);
  const max = applyCanonicalCompanyXp(base, total + 5000);
  assert.equal(max.level, levelConfig.maxLevel);
  assert.equal(max.level, 30);
  assert.equal(max.xp, 0);
  assert.equal(max.xpToNextLevel, calculateXpToNextLevel(30));
  assert.equal(max.totalXp, total + 5000);
  const atMax = applyCanonicalCompanyXp(max, 70);
  assert.equal(atMax.level, 30);
  assert.equal(atMax.xp, 0);
  assert.equal(atMax.totalXp, total + 5070);
  const negative = applyCanonicalCompanyXp(base, -50);
  assert.deepEqual([negative.level, negative.xp, negative.totalXp], [1, 0, 0]);
});

test('golden reputation vectors reuse production rules and clamps', () => {
  assert.equal(REPUTATION_RULES.deliveryEarly, 3);
  assert.equal(REPUTATION_RULES.deliveryOnTime, 2);
  assert.equal(REPUTATION_RULES.deliveryLateMinor, -2);
  assert.equal(REPUTATION_RULES.deliveryLateMajor, -4);
  assert.equal(REPUTATION_RULES.contractCancelled, -6);
  assert.equal(REPUTATION_RULES.deliveryFailed, -6);
  const d = 10;
  const p = 8;
  const rep = (band: 'EARLY' | 'ON_TIME' | 'LATE_MINOR' | 'LATE_MAJOR', actual: number, contractType?: string) =>
    deriveCanonicalRoadCompletionReputation({
      band,
      actualTravelHours: actual,
      deadlineHours: d,
      plannedTravelGameHours: p,
      contractType,
    });
  assert.deepEqual(rep('EARLY', p * 0.92), { ok: true, delta: 3, reasons: ['delivery-early'] });
  assert.deepEqual(rep('ON_TIME', p * 0.93), { ok: true, delta: 2, reasons: ['delivery-on-time'] });
  assert.deepEqual(rep('LATE_MINOR', d * 1.1), { ok: true, delta: -2, reasons: ['delivery-late-minor'] });
  assert.deepEqual(rep('LATE_MAJOR', d * 1.11), { ok: true, delta: -4, reasons: ['delivery-late-major'] });
  assert.deepEqual(rep('LATE_MAJOR', d * 1.99), { ok: true, delta: -4, reasons: ['delivery-late-major'] });
  const bonus = rep('ON_TIME', p * 0.95, 'high_reputation');
  assert.equal(bonus.ok && bonus.delta, 3);
  const noLateBonus = rep('LATE_MINOR', d * 1.05, 'high_reputation');
  assert.equal(noLateBonus.ok && noLateBonus.delta, -2);
  assert.equal(rep('EARLY', d * 1.5).ok, false);
  assert.deepEqual(deriveCanonicalRoadCancelReputation(), { delta: -6, reasons: ['contract-cancelled'] });
  assert.deepEqual(deriveCanonicalRoadServerFailureReputation(), { delta: -6, reasons: ['delivery-failed'] });
  assert.deepEqual(applyCanonicalReputationDelta(50, 3), { reputation: 53, appliedDelta: 3 });
  assert.deepEqual(applyCanonicalReputationDelta(99, 3), { reputation: 100, appliedDelta: 1 });
  assert.deepEqual(applyCanonicalReputationDelta(100, 3), { reputation: 100, appliedDelta: 0 });
  assert.deepEqual(applyCanonicalReputationDelta(4, -6), { reputation: 0, appliedDelta: -4 });
  assert.deepEqual(applyCanonicalReputationDelta(0, -6), { reputation: 0, appliedDelta: 0 });
  assert.deepEqual(applyCanonicalReputationDelta(50.5, -2), { reputation: 48.5, appliedDelta: -2 });
});

test('completion XP is blocked without a trusted risk tier; formula matches production when trusted', () => {
  const blocked = deriveCanonicalRoadCompletionXp({ distanceKm: 400, netProfit: 12_000, riskTier: null });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.xp, 0);
  assert.equal(blocked.xpAuthority, CANONICAL_ROAD_COMPLETION_XP_AUTHORITY);
  const trusted = deriveCanonicalRoadCompletionXp({ distanceKm: 400, netProfit: 12_000, riskTier: 'medium' });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.xp, calculateDeliveryXp(400, 12_000, 'medium'));
  assert.equal(trusted.xp, Math.round(25 + 400 / 20 + 12_000 / 1000 + 10));
});

test('initialization is server-only, idempotent and never imports legacy progression', async () => {
  const db = createMemoryFirestore();
  const off = await initializeCanonicalCompanyProgressionForNewAccount(db, 'uid-a', NOW, { envValue: null });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_OFF');
  assert.equal(db.dump.has(progressionPath('uid-a')), false);
  const first = await initAccount(db, 'uid-a');
  assert.equal(first.ok && first.alreadyInitialized, false);
  const second = await initializeCanonicalCompanyProgressionForNewAccount(db, 'uid-a', NOW + 5000, GATE);
  assert.equal(second.ok && second.alreadyInitialized, true);
  assert.equal(db.dump.get(progressionPath('uid-a'))?.progressionRevision, 1);
  assert.equal(db.dump.get(progressionPath('uid-a'))?.initializedAtMs, NOW);

  db.dump.set('users/legacy/saves/current', { player: { level: 20, reputation: 100, xp: 900 } });
  const legacy = await initializeCanonicalCompanyProgressionForNewAccount(db, 'legacy', NOW, GATE);
  assert.equal(legacy.ok, false);
  if (!legacy.ok) {
    assert.equal(legacy.reason, 'CANONICAL_PROGRESSION_LEGACY_SAVE_PRESENT');
    assert.equal(legacy.authorityClass, 'LEGACY_CLIENT_UNVERIFIED');
  }
  assert.equal(db.dump.has(progressionPath('legacy')), false);

  db.dump.set('users/migrated/serverState/current', {
    migrationSource: 'legacy-save',
    companyLevel: 20,
    reputation: 100,
  });
  const migrated = await initializeCanonicalCompanyProgressionForNewAccount(db, 'migrated', NOW, GATE);
  assert.equal(migrated.ok, false);
  assert.equal(db.dump.has(progressionPath('migrated')), false);

  db.dump.set('users/fixture/canonicalCompanyProgression/current', { level: 5, reputation: 70 });
  const fixture = await initializeCanonicalCompanyProgressionForNewAccount(db, 'fixture', NOW, GATE);
  assert.equal(fixture.ok, false);
  assert.equal(db.dump.get(progressionPath('fixture'))?.level, 5);
});

test('completion applies exact reputation once; retry and second device do not reapply', async () => {
  const db = createMemoryFirestore();
  const uid = 'prog-complete';
  db.dump.set(`users/${uid}/serverState/current`, {
    cash: 20_000,
    migrationSource: 'default',
    completedDeliveries: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
  });
  db.dump.set(`users/${uid}`, { money: 20_000 });
  await initAccount(db, uid);
  const { deliveryId, plannedHours } = await acceptDelivery(db, uid, 1, NOW);
  const completeAt = NOW + realMsForCanonicalGameHours(plannedHours * 0.5);
  const report = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    'COMPLETED',
    completeAt,
    0.01,
    PROGRESSION,
  );
  assert.equal(report.ok, true);
  if (!report.ok) return;
  assert.equal(report.timingClassification, 'EARLY');
  assert.equal(report.progressionApplication, 'APPLIED');
  const state = db.dump.get(progressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
  assert.equal(state.reputation, 53);
  assert.equal(state.xp, 0);
  assert.equal(state.level, 1);
  assert.equal(state.progressionRevision, 2);
  const receipt = db.dump.get(`users/${uid}/canonicalProgressionReceipts/progression:delivery:${deliveryId}:completion`);
  assert.ok(receipt);
  assert.equal(receipt?.sourceType, 'ROAD_DELIVERY_COMPLETION');
  assert.equal(receipt?.sourceId, deliveryId);
  assert.equal(receipt?.xpDelta, 0);
  assert.equal(receipt?.xpAuthority, CANONICAL_ROAD_COMPLETION_XP_AUTHORITY);
  assert.equal(receipt?.reputationDelta, 3);
  assert.equal(receipt?.reputationBefore, 50);
  assert.equal(receipt?.reputationAfter, 53);
  assert.equal(receipt?.levelBefore, 1);
  assert.equal(receipt?.levelAfter, 1);
  assert.equal(receipt?.policyVersion, CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION);
  assert.equal(receipt?.reputationPolicyVersion, CANONICAL_ROAD_REPUTATION_POLICY_VERSION);
  assert.equal(receipt?.createdAtMs, completeAt);

  const retry = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    'COMPLETED',
    completeAt + 30_000,
    null,
    PROGRESSION,
  );
  assert.equal(retry.ok && retry.alreadyReported, true);
  const device2 = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    'COMPLETED',
    completeAt + 60_000,
    null,
    PROGRESSION,
  );
  assert.equal(device2.ok && device2.alreadyReported, true);
  const failLater = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    'FAILED',
    completeAt + 90_000,
    null,
    PROGRESSION,
  );
  assert.equal(failLater.ok, false);
  const cancelLater = await cancelCanonicalRoadDeliveryTransaction(db, uid, deliveryId, completeAt + 99_000, PROGRESSION);
  assert.equal(cancelLater.ok, false);
  assert.equal(db.dump.get(progressionPath(uid))?.reputation, 53);
  assert.equal(db.dump.get(progressionPath(uid))?.progressionRevision, 2);
  assert.equal(receiptKeys(db, uid).length, 1);
  assert.equal(db.dump.get(`users/${uid}/serverState/current`)?.cash, 20_000);
  assert.equal(db.dump.get(`users/${uid}`)?.money, 20_000);
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);
});

test('late bands, cancel, server failure and client FAILED map to exact progression outcomes', async () => {
  const cases: Array<{ label: string; ratio: 'late-minor' | 'late-major' | 'too-late'; expected: number; band: string }> = [
    { label: 'late-minor', ratio: 'late-minor', expected: 48, band: 'LATE_MINOR' },
    { label: 'late-major', ratio: 'late-major', expected: 46, band: 'LATE_MAJOR' },
    { label: 'server-failure', ratio: 'too-late', expected: 44, band: 'FAILED' },
  ];
  for (const item of cases) {
    const db = createMemoryFirestore();
    const uid = `prog-${item.label}`;
    await initAccount(db, uid);
    const { deliveryId, deadlineHours } = await acceptDelivery(db, uid, 1, NOW);
    const hours =
      item.ratio === 'late-minor' ? deadlineHours * 1.05 : item.ratio === 'late-major' ? deadlineHours * 1.5 : deadlineHours * 2.5;
    const report = await reportCanonicalRoadDeliveryCompletedTransaction(
      db,
      uid,
      deliveryId,
      'COMPLETED',
      NOW + realMsForCanonicalGameHours(hours),
      null,
      PROGRESSION,
    );
    assert.equal(report.ok, true, item.label);
    if (!report.ok) continue;
    if (item.ratio === 'too-late') {
      assert.equal(report.lifecycleState, 'FAILED', item.label);
      assert.equal(
        db.dump.get(`users/${uid}/canonicalRoadDeliveries/${deliveryId}`)?.failureAuthorityClass,
        'SERVER_DERIVED_FAILURE',
      );
    } else {
      assert.equal(report.timingClassification, item.band, item.label);
    }
    assert.equal(db.dump.get(progressionPath(uid))?.reputation, item.expected, item.label);
    assert.equal(db.dump.get(progressionPath(uid))?.xp, 0, item.label);
    const op = item.ratio === 'too-late' ? 'failure' : 'completion';
    const receipt = db.dump.get(`users/${uid}/canonicalProgressionReceipts/progression:delivery:${deliveryId}:${op}`);
    assert.ok(receipt, item.label);
    if (item.ratio === 'too-late') {
      assert.equal(receipt?.sourceType, 'ROAD_DELIVERY_SERVER_FAILURE');
      assert.equal(receipt?.xpAuthority, 'PRODUCTION_NO_XP');
    }
  }

  const db = createMemoryFirestore();
  const uid = 'prog-cancel';
  await initAccount(db, uid);
  const cancelled = await acceptDelivery(db, uid, 1, NOW);
  const cancel = await cancelCanonicalRoadDeliveryTransaction(db, uid, cancelled.deliveryId, NOW + HOUR_MS, PROGRESSION);
  assert.equal(cancel.ok, true);
  if (cancel.ok) assert.equal(cancel.progressionApplication, 'APPLIED');
  assert.equal(db.dump.get(progressionPath(uid))?.reputation, 44);
  const cancelRetry = await cancelCanonicalRoadDeliveryTransaction(db, uid, cancelled.deliveryId, NOW + 2 * HOUR_MS, PROGRESSION);
  assert.equal(cancelRetry.ok && cancelRetry.alreadyCancelled, true);
  assert.equal(db.dump.get(progressionPath(uid))?.reputation, 44);
  const cancelReceipt = db.dump.get(
    `users/${uid}/canonicalProgressionReceipts/progression:delivery:${cancelled.deliveryId}:cancel`,
  );
  assert.equal(cancelReceipt?.reputationDelta, -6);
  assert.equal(cancelReceipt?.xpDelta, 0);
  assert.equal(cancelReceipt?.xpAuthority, 'PRODUCTION_NO_XP');
  const completeAfterCancel = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    cancelled.deliveryId,
    'COMPLETED',
    NOW + 3 * HOUR_MS,
    null,
    PROGRESSION,
  );
  assert.equal(completeAfterCancel.ok, false);

  const unverified = await acceptDelivery(db, uid, 2, NOW + 10 * HOUR_MS);
  const clientFailed = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    unverified.deliveryId,
    'FAILED',
    NOW + 10 * HOUR_MS + realMsForCanonicalGameHours(unverified.deadlineHours * 0.5),
    null,
    PROGRESSION,
  );
  assert.equal(clientFailed.ok, true);
  if (clientFailed.ok) assert.equal(clientFailed.progressionApplication, 'PROGRESSION_BLOCKED_UNVERIFIED_FAILURE');
  assert.equal(db.dump.get(progressionPath(uid))?.reputation, 44);
  assert.equal(receiptKeys(db, uid).length, 1);
  assert.equal(
    db.dump.get(`users/${uid}/canonicalRoadDeliveries/${unverified.deliveryId}`)?.progressionApplication,
    'PROGRESSION_BLOCKED_UNVERIFIED_FAILURE',
  );
});

test('receipt conflict fails closed; gate OFF and uninitialized accounts are not mutated', async () => {
  const db = createMemoryFirestore();
  const uid = 'prog-conflict';
  await initAccount(db, uid);
  const { deliveryId, plannedHours } = await acceptDelivery(db, uid, 1, NOW);
  db.dump.set(`users/${uid}/canonicalProgressionReceipts/progression:delivery:${deliveryId}:completion`, {
    operationId: `progression:delivery:${deliveryId}:completion`,
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: deliveryId,
    xpDelta: 150,
    requestedReputationDelta: 3,
    policyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    reputationPolicyVersion: CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
  });
  const conflict = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    'COMPLETED',
    NOW + realMsForCanonicalGameHours(plannedHours * 0.5),
    null,
    PROGRESSION,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_PROGRESSION_RECEIPT_CONFLICT');
  assert.equal(db.dump.get(progressionPath(uid))?.reputation, 50);
  assert.equal(db.dump.get(progressionPath(uid))?.progressionRevision, 1);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadDeliveries/${deliveryId}`)?.lifecycleState, 'ACCEPTED');

  const off = createMemoryFirestore();
  await initAccount(off, 'prog-off');
  const offDelivery = await acceptDelivery(off, 'prog-off', 1, NOW);
  const offReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    off,
    'prog-off',
    offDelivery.deliveryId,
    'COMPLETED',
    NOW + realMsForCanonicalGameHours(offDelivery.plannedHours * 0.5),
  );
  assert.equal(offReport.ok, true);
  if (offReport.ok) assert.equal(offReport.progressionApplication, null);
  assert.equal(off.dump.get(progressionPath('prog-off'))?.reputation, 50);
  assert.equal(receiptKeys(off, 'prog-off').length, 0);

  const uninit = createMemoryFirestore();
  const uninitDelivery = await acceptDelivery(uninit, 'prog-uninit', 1, NOW);
  const uninitReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    uninit,
    'prog-uninit',
    uninitDelivery.deliveryId,
    'COMPLETED',
    NOW + realMsForCanonicalGameHours(uninitDelivery.plannedHours * 0.5),
    null,
    PROGRESSION,
  );
  assert.equal(uninitReport.ok, true);
  if (uninitReport.ok) assert.equal(uninitReport.progressionApplication, 'NOT_APPLIED_UNINITIALIZED');
  assert.equal(uninit.dump.has(progressionPath('prog-uninit')), false);
  assert.equal(receiptKeys(uninit, 'prog-uninit').length, 0);
});

test('issuance trusts only server progression; legacy and fixtures fail closed under the gate', () => {
  const state = createInitialCanonicalCompanyProgression('uid-a', NOW);
  const trusted = resolveCanonicalProgressionForIssuance({ ...state }, 'uid-a', { progressionGateAllowed: true });
  assert.equal(trusted.ok && trusted.level, 1);
  assert.equal(trusted.ok && trusted.reputation, 50);
  const fixtureOn = resolveCanonicalProgressionForIssuance({ level: 20, reputation: 100 }, 'uid-a', {
    progressionGateAllowed: true,
  });
  assert.equal(fixtureOn.ok, false);
  if (!fixtureOn.ok) assert.equal(fixtureOn.reason, 'CANONICAL_PROGRESSION_FIXTURE_NOT_TRUSTED');
  const fixtureOff = resolveCanonicalProgressionForIssuance({ level: 1, reputation: 0 }, 'uid-a', {
    progressionGateAllowed: false,
  });
  assert.equal(fixtureOff.ok && fixtureOff.authorityClass, 'INTERNAL_TEST_PROGRESSION_FIXTURE');
  const legacy = resolveCanonicalProgressionForIssuance(
    { authorityClass: 'LEGACY_CLIENT_UNVERIFIED', level: 20, reputation: 100 },
    'uid-a',
    { progressionGateAllowed: false },
  );
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_LEGACY_PROGRESSION');
  const missing = resolveCanonicalProgressionForIssuance(undefined, 'uid-a', { progressionGateAllowed: true });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION');
  const noReputation = resolveCanonicalProgressionForIssuance({ level: 1 }, 'uid-a', { progressionGateAllowed: false });
  assert.equal(noReputation.ok, false);
  if (!noReputation.ok) assert.equal(noReputation.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_REPUTATION');
});

test('end-to-end INTERNAL vector and refresh uses new level/reputation while the batch stays frozen', async () => {
  const db = createMemoryFirestore();
  const uid = 'prog-e2e';
  const gates = {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
    eventEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
    refreshEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  } as const;
  seedIssuanceWorld(db, uid);
  db.dump.set(
    `users/${uid}/canonicalFleetRuntime/truck-1`,
    createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
  );
  const before = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(before.ok, false);
  if (!before.ok) assert.equal(before.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION');

  await initAccount(db, uid);
  const initial = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(initial.ok, true, initial.ok ? '' : initial.reason);
  if (!initial.ok) return;
  const initialBatch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${initial.batchId}`);
  assert.equal(initialBatch?.playerLevel, 1);
  assert.equal(initialBatch?.playerReputation, 50);
  const offerKeys = [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalRoadContracts/rcprod_`));
  assert.equal(offerKeys.length > 0, true);
  const firstOffer = { ...db.dump.get(offerKeys[0]!)! };
  assert.equal(firstOffer.playerLevel, 1);
  assert.equal(firstOffer.playerReputation, 50);

  const current = db.dump.get(progressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
  const toLevel4 = planCanonicalProgressionMutation(current, {
    operationId: 'progression:test:level4',
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: 'server-fixture',
    xpDelta: 100 + 273 + 492 + 10,
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: 3,
    reputationReasons: ['delivery-early'],
    nowMs: NOW + 1,
  });
  assert.equal(toLevel4.next.level, 4);
  assert.equal(toLevel4.next.progressionRevision, 2);
  const toLevel5 = planCanonicalProgressionMutation(toLevel4.next, {
    operationId: 'progression:test:level5',
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: 'server-fixture-2',
    xpDelta: calculateXpToNextLevel(4),
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: 2,
    reputationReasons: ['delivery-on-time'],
    nowMs: NOW + 2,
  });
  assert.equal(toLevel5.next.level, 5);
  assert.equal(toLevel5.next.reputation, 55);
  assert.equal(toLevel5.next.progressionRevision, 3);
  db.dump.set(progressionPath(uid), { ...toLevel5.next });

  const replay = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + HOUR_MS, gates);
  assert.equal(replay.ok && replay.alreadyApplied, true);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractBatches/${initial.batchId}`)?.playerLevel, 1);
  assert.equal(db.dump.get(offerKeys[0]!)?.playerLevel, 1);
  assert.equal(db.dump.get(offerKeys[0]!)?.payment, firstOffer.payment);

  const tooSoon = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 2 * HOUR_MS, {
    ...gates,
    refreshIntentId: 'prog-refresh-soon',
  });
  assert.equal(tooSoon.ok, false);
  if (!tooSoon.ok) assert.equal(tooSoon.reason, 'CONTRACT_REFRESH_COOLDOWN_ACTIVE');

  const refreshed = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, {
    ...gates,
    refreshIntentId: 'prog-refresh-1',
  });
  assert.equal(refreshed.ok, true, refreshed.ok ? '' : refreshed.reason);
  if (!refreshed.ok) return;
  assert.equal(refreshed.refreshSequence, 1);
  const refreshedBatch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed.batchId}`);
  assert.equal(refreshedBatch?.playerLevel, 5);
  assert.equal(refreshedBatch?.playerReputation, 55);
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractBatches/${initial.batchId}`)?.playerLevel, 1);
  assert.equal(db.dump.get(`users/${uid}`)?.money, 22_000);
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);
});

test('legacy account with save level 20 / rep 100 and no canonical doc stays blocked', async () => {
  const db = createMemoryFirestore();
  const uid = 'prog-legacy';
  seedIssuanceWorld(db, uid);
  db.dump.set(`users/${uid}/saves/current`, { player: { level: 20, reputation: 100 } });
  db.dump.set(`users/${uid}/serverState/current`, { companyLevel: 20, reputation: 100, migrationSource: 'legacy-save' });
  const blocked = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, {
    ...GATE,
    progressionEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION');
  const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, GATE);
  assert.equal(init.ok, false);
  const stillBlocked = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, {
    ...GATE,
    progressionEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(stillBlocked.ok, false);
  assert.equal(db.dump.has(progressionPath(uid)), false);
  db.dump.set(progressionPath(uid), { level: 20, reputation: 100 });
  const fixtureUnderGate = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, {
    ...GATE,
    progressionEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(fixtureUnderGate.ok, false);
  if (!fixtureUnderGate.ok) assert.equal(fixtureUnderGate.reason, 'CANONICAL_PROGRESSION_FIXTURE_NOT_TRUSTED');
});
