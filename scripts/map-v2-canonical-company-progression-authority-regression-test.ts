/**
 * Map V2 Step 29AF canonical company progression / ROAD reputation authority.
 * Run: node --import tsx scripts/map-v2-canonical-company-progression-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../backend/src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../backend/src/canonicalFleet';
import { generateCanonicalProductionRoadBatchTransaction } from '../backend/src/canonicalProductionRoadContractIssuance';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../backend/src/canonicalCompanyProgression';
import { calculateXpToNextLevel, levelConfig } from '../src/config/levelConfig';
import { REPUTATION_RULES } from '../src/config/reputationRules';
import { CITIES } from '../src/data/cities';
import { PRODUCT_IDS } from '../src/data/products';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS,
  CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
  CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
  CANONICAL_ROAD_REPUTATION_AUTHORITY_STATUS,
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
  isCanonicalCompanyProgressionAllowed,
  planCanonicalProgressionMutation,
  type CanonicalCompanyProgressionState,
} from '../src/domain/canonicalCompanyProgression';
import { hasOnlyCanonicalRoadRefreshKeys } from '../src/domain/canonicalContractRefresh';
import {
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { hasOnlyCanonicalRoadCompleteKeys } from '../src/domain/canonicalRoadDelivery';
import { buildFixtureMarket } from '../src/domain/canonicalRoadEconomics';
import { realMsForCanonicalGameHours } from '../src/domain/canonicalRoadTiming';
import { createInternalFixtureRuntime } from '../src/domain/canonicalFleetRuntimeLocation';
import { deriveCanonicalProductionMarketQuote } from '../src/domain/canonicalProductionMarketTick';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { calculateDeliveryXp } from '../src/simulation/leveling';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';

let pass = 0;
let fail = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

type Dump = Map<string, Record<string, unknown>>;
function createMemoryFirestore(): Firestore & { dump: Dump } {
  const dump: Dump = new Map();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false };
    },
    collection(path: string) {
      return { path, _col: true };
    },
    async runTransaction<T>(operation: (transaction: unknown) => Promise<T>) {
      return operation({
        async get(ref: { path: string; _col?: boolean }) {
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
        create(ref: { path: string }, data: Record<string, unknown>) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref: { path: string }, data: Record<string, unknown>) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
        set(ref: { path: string }, data: Record<string, unknown>) {
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
const progressionPath = (uid: string) => `users/${uid}/canonicalCompanyProgression/current`;
const receipts = (db: { dump: Dump }, uid: string) =>
  [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalProgressionReceipts/`));

async function acceptDelivery(db: Firestore & { dump: Dump }, uid: string, sequence: number, startMs: number) {
  const issued = await issueCanonicalRoadContractTransaction(db, uid, { ...ISSUANCE, sequence }, startMs);
  if (!issued.ok) throw new Error('issue');
  if (![...db.dump.keys()].some((key) => key.startsWith(`users/${uid}/canonicalFleetAssets/`))) {
    await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, GATE);
  }
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    uid,
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    startMs,
  );
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

function seedIssuanceWorld(db: { dump: Dump }, uid: string) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  db.dump.set(
    `users/${uid}/canonicalFleetRuntime/truck-1`,
    createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
  );
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      db.dump.set(`canonicalWorldMarkets/${city.id}_${productId}`, {
        cityId: city.id,
        productId,
        stock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
}

async function main(): Promise<void> {
  console.log('\n=== Map V2 Canonical Company Progression Authority (Step 29AF) ===\n');

  const store = read('src/store/gameStore.ts');
  const saveGame = read('src/storage/saveGame.ts');
  const contractsScreen = read('src/screens/ContractsScreen.tsx');
  const index = read('backend/src/index.ts');
  const rules = read('firestore.rules');
  const issuanceBackend = read('backend/src/canonicalProductionRoadContractIssuance.ts');
  const progressionBackend = read('backend/src/canonicalCompanyProgression.ts');
  const progressionDomain = read('src/domain/canonicalCompanyProgression.ts');

  assert(!store.includes('canonicalCompanyProgression'), 'A store does not read canonical progression');
  assert(!saveGame.includes('canonicalCompanyProgression'), 'A save does not mirror canonical progression');
  assert(store.includes("addCompanyXp(xpGain, 'delivery_completed')"), 'A public XP stays local');
  assert(!contractsScreen.includes('canonicalCompanyProgression'), 'A no public UI wiring');
  assert(store.includes('guest') || store.includes('Guests'), 'B guest path present');
  const guestInit = await initializeCanonicalCompanyProgressionForNewAccount(createMemoryFirestore(), '', NOW, GATE);
  assert(!guestInit.ok && guestInit.reason === 'UNAUTHENTICATED', 'B guest cannot initialize');
  assert(isCanonicalCompanyProgressionAllowed() === false, 'C gate OFF by default');
  assert(isCanonicalCompanyProgressionAllowed({ envValue: null }) === false, 'C gate missing OFF');
  assert(isCanonicalCompanyProgressionAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C gate on');

  const initial = createInitialCanonicalCompanyProgression('uid-a', NOW);
  assert(initial.xp === 0 && initial.totalXp === 0, 'D starting XP 0');
  assert(initial.level === 1 && initial.xpToNextLevel === 100, 'E starting level 1');
  assert(initial.reputation === 50, 'F starting reputation 50');
  assert(store.includes('reputation: reputationBalance.initial'), 'F production initial reputation source');

  for (const key of ['level', 'companyLevel', 'newLevel']) {
    assert(containsForbiddenProgressionClientKeys({ [key]: 20 }), `G client ${key} rejected`);
    assert(!hasOnlyCanonicalProductionRoadIssuanceKeys({ canonicalSchemaVersion: 1, [key]: 20 }), `G issuance ${key}`);
  }
  for (const key of ['xp', 'experience', 'xpDelta', 'companyXp', 'progressionRevision']) {
    assert(containsForbiddenProgressionClientKeys({ [key]: 999 }), `H client ${key} rejected`);
    assert(!hasOnlyCanonicalProductionRoadIssuanceKeys({ canonicalSchemaVersion: 1, [key]: 999 }), `H issuance ${key}`);
  }
  for (const key of ['reputation', 'reputationDelta', 'score', 'companyScore']) {
    assert(containsForbiddenProgressionClientKeys({ [key]: 100 }), `I client ${key} rejected`);
    assert(!hasOnlyCanonicalProductionRoadIssuanceKeys({ canonicalSchemaVersion: 1, [key]: 100 }), `I issuance ${key}`);
  }
  assert(
    !hasOnlyCanonicalRoadCompleteKeys({ deliveryId: 'd', outcome: 'COMPLETED', canonicalSchemaVersion: 1, reputation: 99 }),
    'I complete rejects reputation',
  );
  assert(!hasOnlyCanonicalRoadRefreshKeys({ canonicalSchemaVersion: 1, refreshIntentId: 'intent-0001', level: 9 }), 'G refresh rejects level');

  assert(!/export const (setLevel|setXP|setXp|setCompanyLevel)\b/.test(index), 'J no setLevel endpoint');
  assert(!/export const (addXP|addXp|addCompanyXp|grantXp)\b/.test(index), 'K no addXP endpoint');
  assert(!/export const (addReputation|setReputation|updateReputation)\b/.test(index), 'L no addReputation endpoint');
  assert(index.includes('initializeCanonicalCompanyProgressionInternal'), 'M init callable');
  assert(index.includes('hasOnlyCanonicalProgressionInitKeys'), 'M init allow-list');

  const db = createMemoryFirestore();
  const first = await initializeCanonicalCompanyProgressionForNewAccount(db, 'prog-new', NOW, GATE);
  const second = await initializeCanonicalCompanyProgressionForNewAccount(db, 'prog-new', NOW + 9_000, GATE);
  assert(first.ok && !first.alreadyInitialized, 'M first init');
  assert(second.ok && second.alreadyInitialized, 'M second init idempotent');
  assert(db.dump.get(progressionPath('prog-new'))?.progressionRevision === 1, 'M revision stays 1');

  db.dump.set('users/prog-legacy/saves/current', { player: { level: 20, reputation: 100, xp: 5000 } });
  const legacyInit = await initializeCanonicalCompanyProgressionForNewAccount(db, 'prog-legacy', NOW, GATE);
  assert(!legacyInit.ok && legacyInit.authorityClass === 'LEGACY_CLIENT_UNVERIFIED', 'N legacy save not imported');
  assert(!db.dump.has(progressionPath('prog-legacy')), 'N no canonical doc for legacy');

  const exact = applyCanonicalCompanyXp(initial, 100);
  const below = applyCanonicalCompanyXp(initial, 99);
  assert(below.level === 1 && exact.level === 2 && exact.xp === 0, 'O threshold exact');
  assert(calculateXpToNextLevel(2) === 273, 'O production curve');
  let total = 0;
  for (let level = 1; level < levelConfig.maxLevel; level += 1) total += calculateXpToNextLevel(level);
  const max = applyCanonicalCompanyXp(initial, total + 1000);
  assert(max.level === 30 && max.xp === 0 && max.totalXp === total + 1000, 'P max level exact');
  assert(applyCanonicalReputationDelta(3, -6).reputation === 0, 'Q min clamp');
  assert(applyCanonicalReputationDelta(99, 3).reputation === 100, 'R max clamp');

  const rep = (band: 'EARLY' | 'ON_TIME' | 'LATE_MINOR' | 'LATE_MAJOR', actual: number) =>
    deriveCanonicalRoadCompletionReputation({
      band,
      actualTravelHours: actual,
      deadlineHours: 10,
      plannedTravelGameHours: 8,
      contractType: 'standard',
    });
  const early = rep('EARLY', 7);
  const onTime = rep('ON_TIME', 9);
  const lateMinor = rep('LATE_MINOR', 10.5);
  const lateMajor = rep('LATE_MAJOR', 15);
  assert(early.ok && early.delta === 3 && REPUTATION_RULES.deliveryEarly === 3, 'S early +3');
  assert(onTime.ok && onTime.delta === 2, 'T on-time +2');
  assert(lateMinor.ok && lateMinor.delta === -2, 'U late-minor -2');
  assert(lateMajor.ok && lateMajor.delta === -4, 'V late-major -4');
  assert(deriveCanonicalRoadCancelReputation().delta === -6, 'W cancel -6');
  assert(deriveCanonicalRoadServerFailureReputation().delta === -6, 'X server failure -6 (not -8)');
  assert(REPUTATION_RULES.deliveryFailed === -6, 'X production failed -6');

  const flow = createMemoryFirestore();
  const uid = 'prog-flow';
  await initializeCanonicalCompanyProgressionForNewAccount(flow, uid, NOW, GATE);
  flow.dump.set(`users/${uid}`, { money: 12_345 });
  const d2 = await acceptDelivery(flow, uid, 2, NOW);
  const cancelled = await cancelCanonicalRoadDeliveryTransaction(flow, uid, d2.deliveryId, NOW + HOUR_MS, PROGRESSION);
  const cancelReceipt = flow.dump.get(`users/${uid}/canonicalProgressionReceipts/progression:delivery:${d2.deliveryId}:cancel`);
  assert(cancelled.ok && flow.dump.get(progressionPath(uid))?.reputation === 44, 'W cancel applied atomically');
  assert(cancelReceipt?.xpDelta === 0 && cancelReceipt?.xpAuthority === 'PRODUCTION_NO_XP', 'AA cancel XP none');
  const cancelRetry = await cancelCanonicalRoadDeliveryTransaction(flow, uid, d2.deliveryId, NOW + 2 * HOUR_MS, PROGRESSION);
  assert(cancelRetry.ok && cancelRetry.alreadyCancelled && flow.dump.get(progressionPath(uid))?.reputation === 44, 'W no double -6');

  const d1Start = NOW + 3 * HOUR_MS;
  const d1 = await acceptDelivery(flow, uid, 1, d1Start);
  const completeAt = d1Start + realMsForCanonicalGameHours(d1.plannedHours * 0.5);
  const completed = await reportCanonicalRoadDeliveryCompletedTransaction(flow, uid, d1.deliveryId, 'COMPLETED', completeAt, 0, PROGRESSION);
  const afterComplete = flow.dump.get(progressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
  const completionReceipt = flow.dump.get(
    `users/${uid}/canonicalProgressionReceipts/progression:delivery:${d1.deliveryId}:completion`,
  );
  assert(completed.ok && completed.progressionApplication === 'APPLIED', 'AC completion applied');
  assert(afterComplete.reputation === 47, 'S early completion +3');
  assert(Boolean(completionReceipt), 'AC receipt written');
  assert(
    completionReceipt?.xpDelta === 0 && completionReceipt?.xpAuthority === CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
    'Z completion XP blocked: risk tier untrusted',
  );
  const trustedXp = deriveCanonicalRoadCompletionXp({ distanceKm: 300, netProfit: 5000, riskTier: 'low' });
  assert(trustedXp.ok && trustedXp.xp === calculateDeliveryXp(300, 5000, 'low'), 'Z formula matches production when trusted');
  const retry = await reportCanonicalRoadDeliveryCompletedTransaction(flow, uid, d1.deliveryId, 'COMPLETED', completeAt + 1000, null, PROGRESSION);
  const device2 = await reportCanonicalRoadDeliveryCompletedTransaction(flow, uid, d1.deliveryId, 'COMPLETED', completeAt + 2000, null, PROGRESSION);
  assert(retry.ok && retry.alreadyReported, 'AD retry replay');
  assert(flow.dump.get(progressionPath(uid))?.xp === 0, 'AD no duplicate XP');
  assert(flow.dump.get(progressionPath(uid))?.reputation === 47, 'AE no duplicate reputation');
  assert(device2.ok && device2.alreadyReported && receipts(flow, uid).length === 2, 'AF two-device one application');
  assert(flow.dump.get(progressionPath(uid))?.progressionRevision === 3, 'AJ revision 1 + two mutations');
  const cancelAfterComplete = await cancelCanonicalRoadDeliveryTransaction(flow, uid, d1.deliveryId, completeAt + 3000, PROGRESSION);
  assert(!cancelAfterComplete.ok, 'AF completed delivery cannot be cancelled later');

  const late = createMemoryFirestore();
  const luid = 'prog-late';
  await initializeCanonicalCompanyProgressionForNewAccount(late, luid, NOW, GATE);
  const d3 = await acceptDelivery(late, luid, 3, NOW);
  const tooLate = await reportCanonicalRoadDeliveryCompletedTransaction(
    late,
    luid,
    d3.deliveryId,
    'COMPLETED',
    NOW + realMsForCanonicalGameHours(d3.deadlineHours * 2.5),
    null,
    PROGRESSION,
  );
  const failureReceipt = late.dump.get(`users/${luid}/canonicalProgressionReceipts/progression:delivery:${d3.deliveryId}:failure`);
  assert(tooLate.ok && tooLate.lifecycleState === 'FAILED', 'X server-derived failure');
  assert(late.dump.get(progressionPath(luid))?.reputation === 44, 'X failure -6 applied');
  assert(failureReceipt?.xpDelta === 0 && failureReceipt?.xpAuthority === 'PRODUCTION_NO_XP', 'AB failure XP none');
  assert(!/addCompanyXp\([^)]*(fail|cancel)/i.test(store), 'AB production grants no failure/cancel XP');

  const unverified = createMemoryFirestore();
  const uuid = 'prog-unverified';
  await initializeCanonicalCompanyProgressionForNewAccount(unverified, uuid, NOW, GATE);
  const d4 = await acceptDelivery(unverified, uuid, 4, NOW + 40 * HOUR_MS);
  const clientFailed = await reportCanonicalRoadDeliveryCompletedTransaction(
    unverified,
    uuid,
    d4.deliveryId,
    'FAILED',
    NOW + 40 * HOUR_MS + realMsForCanonicalGameHours(d4.deadlineHours * 0.5),
    null,
    PROGRESSION,
  );
  assert(
    clientFailed.ok && clientFailed.progressionApplication === 'PROGRESSION_BLOCKED_UNVERIFIED_FAILURE',
    'Y client FAILED classified',
  );
  assert(
    unverified.dump.get(progressionPath(uuid))?.reputation === 50 && receipts(unverified, uuid).length === 0,
    'Y no trusted mutation',
  );
  assert(receipts(late, luid).length === 1, 'AC one receipt per trusted mutation');

  const conflictDb = createMemoryFirestore();
  const cuid = 'prog-conflict';
  await initializeCanonicalCompanyProgressionForNewAccount(conflictDb, cuid, NOW, GATE);
  const d5 = await acceptDelivery(conflictDb, cuid, 5, NOW + 60 * HOUR_MS);
  conflictDb.dump.set(`users/${cuid}/canonicalProgressionReceipts/progression:delivery:${d5.deliveryId}:completion`, {
    operationId: `progression:delivery:${d5.deliveryId}:completion`,
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: d5.deliveryId,
    xpDelta: 150,
    requestedReputationDelta: 3,
    policyVersion: CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
    reputationPolicyVersion: CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
  });
  const conflict = await reportCanonicalRoadDeliveryCompletedTransaction(
    conflictDb,
    cuid,
    d5.deliveryId,
    'COMPLETED',
    NOW + 60 * HOUR_MS + realMsForCanonicalGameHours(d5.plannedHours * 0.5),
    null,
    PROGRESSION,
  );
  assert(!conflict.ok && conflict.reason === 'CANONICAL_PROGRESSION_RECEIPT_CONFLICT', 'AG conflict fails closed');
  assert(conflictDb.dump.get(progressionPath(cuid))?.reputation === 50, 'AG state untouched');
  assert(conflictDb.dump.get(progressionPath(cuid))?.progressionRevision === 1, 'AG revision untouched');
  assert(flow.dump.get(`users/${uid}`)?.money === 12_345, 'AT users money unchanged');
  assert(![...flow.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), 'AS no cash transaction');

  const lvl = planCanonicalProgressionMutation(initial, {
    operationId: 'progression:test:a',
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: 'a',
    xpDelta: 100,
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: 0,
    reputationReasons: [],
    nowMs: NOW,
  });
  assert(lvl.next.level === 2 && lvl.receipt.levelBefore === 1 && lvl.receipt.levelAfter === 2, 'AH level-up server-side');
  const multi = applyCanonicalCompanyXp(initial, 100 + 273 + 492);
  assert(multi.level === 4 && multi.newLevels.length === 3, 'AI multi-level jump');
  assert(lvl.next.progressionRevision === 2, 'AJ revision increments on mutation');
  const noop = planCanonicalProgressionMutation({ ...initial, reputation: 100 }, {
    operationId: 'progression:test:b',
    sourceType: 'ROAD_DELIVERY_COMPLETION',
    sourceId: 'b',
    xpDelta: 0,
    xpAuthority: 'PRODUCTION_NO_XP',
    reputationDelta: 3,
    reputationReasons: ['delivery-early'],
    nowMs: NOW,
  });
  assert(noop.next.progressionRevision === 1 && noop.receipt.reputationDelta === 0, 'AJ clamped no-op keeps revision');

  const world = createMemoryFirestore();
  const wuid = 'prog-world';
  const gates = {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
    eventEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
    refreshEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  } as const;
  seedIssuanceWorld(world, wuid);
  const missing = await generateCanonicalProductionRoadBatchTransaction(world, wuid, NOW, gates);
  assert(!missing.ok && missing.reason === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION', 'AO missing progression blocks');
  await initializeCanonicalCompanyProgressionForNewAccount(world, wuid, NOW, GATE);
  world.dump.set(`users/${wuid}/saves/current`, { player: { level: 20, companyLevel: 20, reputation: 100, xp: 9000 } });
  world.dump.set(`users/${wuid}/serverState/current`, { companyLevel: 20, reputation: 100, migrationSource: 'legacy-save' });
  const batch0 = await generateCanonicalProductionRoadBatchTransaction(world, wuid, NOW, gates);
  assert(batch0.ok, 'AN v5 batch from server progression');
  if (batch0.ok) {
    const frozen = world.dump.get(`users/${wuid}/canonicalRoadContractBatches/${batch0.batchId}`);
    assert(frozen?.playerLevel === 1, 'AP save level cannot override canonical level');
    assert(frozen?.playerReputation === 50, 'AQ save reputation cannot override canonical reputation');
    const state = world.dump.get(progressionPath(wuid)) as unknown as CanonicalCompanyProgressionState;
    const up = planCanonicalProgressionMutation(state, {
      operationId: 'progression:test:world',
      sourceType: 'ROAD_DELIVERY_COMPLETION',
      sourceId: 'world',
      xpDelta: 100 + 273 + 492 + calculateXpToNextLevel(4),
      xpAuthority: 'SERVER_DERIVED',
      reputationDelta: 3,
      reputationReasons: ['delivery-early'],
      nowMs: NOW + 1,
    });
    world.dump.set(progressionPath(wuid), { ...up.next });
    const replay = await generateCanonicalProductionRoadBatchTransaction(world, wuid, NOW + HOUR_MS, gates);
    assert(replay.ok && replay.alreadyApplied, 'AK replay returns frozen batch');
    assert(world.dump.get(`users/${wuid}/canonicalRoadContractBatches/${batch0.batchId}`)?.playerLevel === 1, 'AK existing batch unchanged');
    const early2 = await generateCanonicalProductionRoadBatchTransaction(world, wuid, NOW + 2 * HOUR_MS, {
      ...gates,
      refreshIntentId: 'prog-world-soon',
    });
    assert(!early2.ok && early2.reason === 'CONTRACT_REFRESH_COOLDOWN_ACTIVE', 'AL level-up does not bypass cooldown');
    const refreshed = await generateCanonicalProductionRoadBatchTransaction(world, wuid, NOW + 3 * HOUR_MS, {
      ...gates,
      refreshIntentId: 'prog-world-1',
    });
    const refreshedBatch = refreshed.ok
      ? world.dump.get(`users/${wuid}/canonicalRoadContractBatches/${refreshed.batchId}`)
      : undefined;
    assert(refreshedBatch?.playerLevel === 5, 'AL next refresh uses new level');
    assert(refreshedBatch?.playerReputation === 53, 'AM next refresh uses new reputation');
  }
  assert(world.dump.get(`users/${wuid}`)?.money === 22_000, 'AT issuance keeps money');
  assert(issuanceBackend.includes('resolveCanonicalProgressionForIssuance'), 'AN issuance uses server resolver');
  assert(!issuanceBackend.includes('saves/current'), 'AN issuance never reads save');
  assert(classifyCanonicalCompanyProgression({ ...initial, progressionPolicyVersion: 'x' }, 'uid-a').authorityClass === 'UNSUPPORTED', 'AN unknown policy fails closed');

  assert(
    !/serverState\.cash|\.money|money:|financeLedger|canonicalCashTransaction|applyCanonicalCash/.test(progressionBackend),
    'AR no server cash effect',
  );
  assert(!/serverState\.cash|financeLedger|canonicalCashTransactions/.test(progressionDomain), 'AS domain no cash');
  assert(!progressionDomain.includes('player.money'), 'AU no player.money');
  assert(!progressionBackend.includes('financeLedger'), 'AV no financeLedger');
  assert(rules.includes('match /canonicalCompanyProgression/{progressionId}'), 'rules progression');
  assert(rules.includes('match /canonicalProgressionReceipts/{receiptId}'), 'rules receipts');
  assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AW HUD overlay off');
  assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AX listener off');
  assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AY cashAuthorityVersion 0');
  assert(
    canUseServerAuthoritativeSettlement({
      signedInLinked: true,
      cashAuthorityVersion: 0,
      serverStateCashPresent: true,
      reconciliationActive: true,
      staleSaveProtectionActive: true,
    }).ready === false,
    'AZ settlement false',
  );
  assert(SAVE_GAME_VERSION === 6, 'BA save version 6');
  assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'BB rail');
  assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'BB sea');
  assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'BB air');
  assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BC multimodal off');

  assert(
    CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS === 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_PASS_INTERNAL_ONLY',
    'status pass internal only (Step 29AG risk snapshot)',
  );
  assert(CANONICAL_ROAD_REPUTATION_AUTHORITY_STATUS === 'CANONICAL_ROAD_REPUTATION_PASS_INTERNAL_ONLY', 'reputation status');
  assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'readiness unchanged');
  assert(
    PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_DELIVERY_RISK_INTERNAL_CANONICAL_DRIVER_ONLY'),
    'xp risk blocker narrowed to internal canonical driver',
  );
  assert(
    PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED'),
    'unsupported reward progress xp blocker listed (Step 29AI narrowed client reward blocker)',
  );
  assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('REPUTATION_NOT_PUBLIC'), 'public reputation blocker kept');
  const coverage = getSignedInCashAuthorityCoverage();
  assert(coverage.criticalSignedInCashPathsTotal === 24, 'coverage total');
  assert(coverage.criticalCanonicalizedCount === 0, 'coverage canonical');
  assert(coverage.criticalBlockedCount === 24, 'coverage blocked');

  if (fail > 0) {
    console.error(`\nFAILED ${fail} / ${pass + fail}`);
    process.exit(1);
  }
  console.log(`OK ${pass} assertions`);
  console.log(
    JSON.stringify({
      CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS,
      CANONICAL_ROAD_REPUTATION_AUTHORITY_STATUS,
      ROAD_CONTRACT_ISSUANCE_READINESS,
      CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
      CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
      CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    }),
  );
}

void main();
