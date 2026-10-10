/**
 * Canonical client-reward XP authority — in-memory tests (Step 29AI).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { claimCanonicalClientRewardTransaction } from '../src/canonicalClientRewardXp';
import { claimCanonicalLocalRewardTransaction } from '../src/canonicalLocalReward';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { purchaseCanonicalCatalogAssetTransaction } from '../src/canonicalCatalogPurchase';
import { hireCanonicalDriverTransaction } from '../src/canonicalCoreVehicleStaffCash';
import { openCanonicalWarehouseTransaction } from '../src/canonicalWarehouse';
import { buyCanonicalCargoTransaction, sellCanonicalCargoTransaction } from '../src/canonicalCargoMarket';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../src/canonicalCompanyProgression';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { ALL_MISSIONS } from '../../src/config/missions';
import { MILESTONE_DEFINITIONS } from '../../src/data/milestones';
import { generateWeeklyObjectives } from '../../src/data/weeklyObjectives';
import { getWeeklySeasonKey } from '../../src/utils/leaderboardSeason';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import {
  CANONICAL_PROGRESSION_READINESS,
  CANONICAL_PROGRESSION_REMAINING_BLOCKERS,
  applyCanonicalCompanyXp,
  applyCanonicalReputationDelta,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
  type CanonicalCompanyProgressionState,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_CLIENT_REWARD_CLAIM_ALLOWED_KEYS,
  CANONICAL_CLIENT_REWARD_FORBIDDEN_CLIENT_KEYS,
  CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV,
  CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS,
  CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS,
  CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
  CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS,
  CANONICAL_MILESTONE_REWARD_CATALOG,
  CANONICAL_MILESTONE_REWARD_COVERAGE,
  CANONICAL_MISSION_REWARD_CATALOG,
  CANONICAL_MISSION_REWARD_COVERAGE,
  CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION,
  CANONICAL_WEEKLY_REWARD_COVERAGE,
  CLIENT_REWARD_CASH_AUTHORITY_REQUIRED,
  CLIENT_REWARD_XP_AUDIT,
  CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY,
  CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY,
  CLIENT_REWARD_XP_CLAIM_CONFLICT,
  CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED,
  CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED,
  CLIENT_REWARD_XP_POLICY_UNKNOWN,
  CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT,
  CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED,
  LEGACY_REWARD_PROGRESS_UNVERIFIED,
  LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE,
  REWARD_CYCLE_NOT_CURRENT,
  REWARD_NOT_ELIGIBLE,
  UNKNOWN_REWARD,
  buildCanonicalWeeklyObjectiveCatalog,
  classifyCanonicalClientRewardXpReadiness,
  clientRewardAuditHasUnknown,
  deriveCanonicalRewardProgress,
  hasOnlyCanonicalClientRewardClaimKeys,
  isCanonicalClientRewardXpAllowed,
  resolveCanonicalClientReward,
  resolveCanonicalWeeklyCycle,
  type CanonicalClientRewardDefinition,
  type CanonicalRewardEvidence,
} from '../../src/domain/canonicalClientRewardXp';
import { PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS } from '../../src/domain/canonicalProductionRoadContractIssuance';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';
import { createCanonicalWarehouseId } from '../../src/domain/canonicalWarehouseState';
import { createInternalFixtureRuntime } from '../../src/domain/canonicalFleetRuntimeLocation';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';

type Dump = Map<string, Record<string, unknown>>;

/** Serialized transactions with buffered writes (Firestore serializable isolation + rollback). */
function createMemoryFirestore(): Firestore & { dump: Dump } {
  const dump: Dump = new Map();
  let chain: Promise<unknown> = Promise.resolve();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false as const };
    },
    collection(path: string) {
      return { path, _col: true as const };
    },
    runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const writes: Array<() => void> = [];
        const result = await operation({
          async get(ref) {
            if (ref._col) {
              const prefix = `${ref.path.replace(/\/$/, '')}/`;
              const docs = [...dump.entries()]
                .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => ({ ...data }) }));
              return { exists: docs.length > 0, data: () => undefined, docs };
            }
            const data = dump.get(ref.path);
            return { exists: Boolean(data), data: () => (data ? { ...data } : undefined), docs: [] };
          },
          create(ref, data) {
            writes.push(() => {
              if (dump.has(ref.path)) throw new Error('already-exists');
              dump.set(ref.path, { ...data });
            });
          },
          update(ref, data) {
            writes.push(() => {
              const current = dump.get(ref.path);
              if (!current) throw new Error('missing');
              dump.set(ref.path, { ...current, ...data });
            });
          },
          set(ref, data) {
            writes.push(() => dump.set(ref.path, { ...data }));
          },
        });
        for (const write of writes) write();
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return firestore as unknown as Firestore & { dump: Dump };
}

const NOW = 1_700_000_000_000;
const HOUR_MS = 15_000;
const CYCLE = resolveCanonicalWeeklyCycle(NOW);
const ON = {
  clientRewardXpEnvValue: 'INTERNAL_TEST',
  progressionEnvValue: 'INTERNAL_TEST',
  localRewardEnvValue: 'INTERNAL_TEST',
  weeklyBackendEnvValue: null,
} as const;
const OP = { envValue: 'INTERNAL_TEST', nonDeliveryXpEnvValue: 'INTERNAL_TEST', progressionEnvValue: 'INTERNAL_TEST' } as const;
const STEEL_WH = createCanonicalWarehouseId('izmir', 'standard');

function seedAccount(db: { dump: Dump }, uid: string, cash = 5_000_000) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  db.dump.set(`users/${uid}`, { money: 22_000 });
}

async function initProgression(db: Firestore & { dump: Dump }, uid: string) {
  const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, { envValue: 'INTERNAL_TEST' });
  assert.equal(init.ok, true, init.ok ? '' : init.reason);
}

async function world(uid: string, cash = 5_000_000) {
  const db = createMemoryFirestore();
  seedAccount(db, uid, cash);
  await initProgression(db, uid);
  return db;
}

function progression(db: { dump: Dump }, uid: string) {
  return db.dump.get(canonicalCompanyProgressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
}

function cashOf(db: { dump: Dump }, uid: string) {
  return Number(db.dump.get(serverStateCurrentRef(uid))?.cash);
}

function keysUnder(db: { dump: Dump }, uid: string, collection: string) {
  return [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/${collection}/`));
}

function seedDelivery(db: { dump: Dump }, uid: string, id: string, overrides: Record<string, unknown> = {}) {
  db.dump.set(`users/${uid}/canonicalRoadDeliveries/${id}`, {
    ownerUid: uid,
    deliveryId: id,
    lifecycleState: 'COMPLETION_REPORTED',
    completionOutcome: 'COMPLETED',
    completionReportedAtMs: NOW,
    acceptedAtMs: NOW - 1000,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    actualTravelHours: 5,
    deadlineHours: 10,
    ...overrides,
  });
}

function seedTruck(db: { dump: Dump }, uid: string, id: string, overrides: Record<string, unknown> = {}) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/${id}`, {
    assetId: id,
    assetType: 'TRUCK',
    ownerUid: uid,
    capacity: 10,
    ownershipType: 'owned',
    lifecycleStatus: 'ACTIVE',
    authoritySource: 'CATALOG_PURCHASE_FOUNDATION',
    ...overrides,
  });
}

function seedCargoReceipt(db: { dump: Dump }, uid: string, id: string, overrides: Record<string, unknown>) {
  db.dump.set(`users/${uid}/canonicalCargoMarketReceipts/${id}`, {
    operationId: id,
    ownerUid: uid,
    warehouseId: STEEL_WH,
    productId: 'steel',
    quantity: 1,
    totalCashDelta: 0,
    inventoryAfter: 0,
    createdAtMs: NOW,
    ...overrides,
  });
}

function mission(id: string) {
  return CANONICAL_MISSION_REWARD_CATALOG.find((row) => row.rewardId === id)!;
}
function milestone(id: string) {
  return CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.rewardId === id)!;
}
function milestoneByMetric(kind: string, target?: number) {
  return CANONICAL_MILESTONE_REWARD_CATALOG.find(
    (row) => row.metric?.kind === kind && (target === undefined || row.target === target),
  )!;
}
function weekly(slot: string, cycleId = CYCLE.cycleId) {
  return buildCanonicalWeeklyObjectiveCatalog(cycleId).find((row) => row.rewardId.endsWith(`_${slot}`))!;
}
function evidence(uid: string, rows: Partial<CanonicalRewardEvidence> = {}): CanonicalRewardEvidence {
  return { uid, nowMs: NOW, cycle: CYCLE, ...rows };
}
function claim(db: Firestore & { dump: Dump }, uid: string, rewardId: unknown, nowMs = NOW + 1, options: Record<string, unknown> = ON) {
  return claimCanonicalClientRewardTransaction(db, uid, rewardId, nowMs, options);
}

test('gate, policy, statuses, forbidden client keys, readiness', () => {
  assert.equal(CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV, 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY');
  assert.equal(isCanonicalClientRewardXpAllowed({ envValue: undefined }), false);
  assert.equal(isCanonicalClientRewardXpAllowed({ envValue: null }), false);
  assert.equal(isCanonicalClientRewardXpAllowed({ envValue: 'ON' }), false);
  assert.equal(isCanonicalClientRewardXpAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(isCanonicalClientRewardXpAllowed(), process.env.CANONICAL_CLIENT_REWARD_XP_AUTHORITY === 'INTERNAL_TEST');
  assert.equal(CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION, 'canonical-client-reward-xp-v1');
  assert.equal(CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS, 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL');
  for (const key of ['progress', 'target', 'completed', 'claimed', 'xp', 'xpReward', 'rewardXp', 'cashReward', 'rewardAmount', 'cycleProgress', 'missionProgress', 'milestoneProgress', 'weeklyProgress', 'eligible', 'claimable', 'cycleId', 'reputation', 'amount', 'money']) {
    assert.ok((CANONICAL_CLIENT_REWARD_FORBIDDEN_CLIENT_KEYS as readonly string[]).includes(key), key);
    assert.equal(hasOnlyCanonicalClientRewardClaimKeys({ rewardId: 'first_delivery', canonicalSchemaVersion: 1, [key]: 1 }), false, key);
  }
  assert.deepEqual([...CANONICAL_CLIENT_REWARD_CLAIM_ALLOWED_KEYS], ['rewardId', 'canonicalSchemaVersion']);
  assert.equal(hasOnlyCanonicalClientRewardClaimKeys({ rewardId: 'first_delivery', canonicalSchemaVersion: 1 }), true);
  assert.equal(hasOnlyCanonicalClientRewardClaimKeys({ rewardId: 'first_delivery', note: 'x' }), false);

  assert.equal(CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS, 'CLIENT_REWARD_XP_INTERNAL_PARTIAL');
  assert.equal(CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS, 'CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY');
  const base = {
    scope: 'INTERNAL_NEW_CANONICAL_ACCOUNTS' as const,
    legacyRewardProgressImported: false,
    weeklyCycleServerOwned: true,
    deliveryProgressNeedsIncidentParity: false,
    canonicalRewardCount: 10,
    blockedByCashAuthority: 0,
    blockedOther: 0,
  };
  assert.equal(classifyCanonicalClientRewardXpReadiness(base), 'CLIENT_REWARD_XP_CANONICAL_READY');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, blockedByCashAuthority: 2 }), 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, blockedOther: 1 }), 'CLIENT_REWARD_XP_INTERNAL_PARTIAL');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, canonicalRewardCount: 0 }), 'CLIENT_REWARD_XP_BLOCKED_CLIENT_PROGRESS');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, weeklyCycleServerOwned: false }), 'CLIENT_REWARD_XP_BLOCKED_WEEKLY_CLOCK');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, deliveryProgressNeedsIncidentParity: true }), 'CLIENT_REWARD_XP_BLOCKED_INCIDENT_PARITY');
  assert.equal(classifyCanonicalClientRewardXpReadiness({ ...base, scope: 'PUBLIC' }), 'CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY');

  assert.equal(CANONICAL_PROGRESSION_READINESS, 'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS');
  assert.deepEqual([...CANONICAL_PROGRESSION_REMAINING_BLOCKERS], [
    'UNSUPPORTED_REWARD_PROGRESS',
    'CARGO_QUALITY_AUTHORITY',
    'LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT',
    'PUBLIC_PROGRESSION_UI',
  ]);
  assert.ok(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL'));
  assert.ok(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED'));
  assert.equal((PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS as readonly string[]).includes('COMPANY_XP_CLIENT_REWARD_SOURCES_CLIENT_OWNED'), false);
});

test('catalog validation: server catalog mirrors production definitions exactly; audit has no UNKNOWN', () => {
  assert.equal(CANONICAL_MISSION_REWARD_CATALOG.length, ALL_MISSIONS.length);
  assert.equal(CANONICAL_MILESTONE_REWARD_CATALOG.length, MILESTONE_DEFINITIONS.length);
  for (const production of ALL_MISSIONS) {
    const row = mission(production.id);
    assert.equal(row.xpReward, production.reward.xp ?? 0, production.id);
    assert.equal(row.reputationReward, production.reward.reputation ?? 0, production.id);
    assert.equal(row.productionCashReward, production.reward.money ?? 0, production.id);
    assert.equal(row.target, production.targetValue, production.id);
    assert.equal(row.policyVersion, CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION);
    assert.ok(row.metric !== null || row.blockedAuthority !== null, production.id);
  }
  for (const production of MILESTONE_DEFINITIONS) {
    const row = milestone(production.id);
    assert.equal(row.xpReward, production.reward.xp, production.id);
    assert.equal(row.reputationReward, production.reward.reputation ?? 0, production.id);
    assert.equal(row.target, production.target, production.id);
  }
  assert.deepEqual(CANONICAL_MISSION_REWARD_COVERAGE, { total: 12, xpBearing: 12, canonical: 7, conditional: 1, blocked: 5, unsupported: 0 });
  assert.deepEqual(CANONICAL_MILESTONE_REWARD_COVERAGE, { total: 41, xpBearing: 41, canonical: 30, conditional: 0, blocked: 11, unsupported: 0 });
  assert.deepEqual(CANONICAL_WEEKLY_REWARD_COVERAGE, { total: 5, xpBearing: 5, canonical: 5, conditional: 1, blocked: 0, unsupported: 0 });
  const golden: Record<string, number> = {
    first_contract_start: 25,
    first_delivery: 50,
    complete_5_deliveries: 100,
    complete_10_deliveries: 200,
    first_trade: 50,
    own_2_trucks: 120,
    earn_10000_trade_profit: 150,
  };
  for (const [id, xp] of Object.entries(golden)) {
    assert.equal(mission(id).xpReward, xp, id);
    assert.ok(mission(id).metric, id);
  }
  assert.equal(mission('first_profit').blockedAuthority, 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY');
  assert.equal(mission('open_market').blockedAuthority, 'CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT');
  assert.equal(mission('reach_company_score_150k').blockedAuthority, 'CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY');
  assert.equal(mission('reach_warehouse_value_25000').blockedAuthority, 'CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY');
  assert.equal(mission('operate_in_3_cities').blockedAuthority, 'CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY');
  assert.equal(mission('own_2_trucks').cashAuthority, 'CANONICAL_29W_INTERNAL');
  assert.equal(milestone('ms_second_truck').cashAuthority, 'CANONICAL_29W_INTERNAL');
  assert.equal(mission('first_delivery').cashAuthority, 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY');
  assert.equal(mission('open_market').cashAuthority, 'NO_CASH_COMPONENT');

  const production = generateWeeklyObjectives(CYCLE.cycleId);
  const server = buildCanonicalWeeklyObjectiveCatalog(CYCLE.cycleId);
  assert.equal(server.length, 5);
  for (const [index, row] of server.entries()) {
    assert.equal(row.rewardId, production[index].id);
    assert.equal(row.target, production[index].target);
    assert.equal(row.xpReward, production[index].reward.xp);
    assert.equal(row.reputationReward, production[index].reward.reputation ?? 0);
    assert.equal(row.cycleId, CYCLE.cycleId);
    assert.equal(row.cashAuthority, 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY');
  }

  assert.equal(clientRewardAuditHasUnknown(), false);
  assert.equal(CLIENT_REWARD_XP_AUDIT.length, 12 + 41 + 5 + 7);
  for (const row of CLIENT_REWARD_XP_AUDIT) {
    for (const key of ['rewardId', 'family', 'xpAmount', 'cashAmount', 'otherReward', 'progressCondition', 'progressSource', 'resetCycle', 'claimModel', 'canonicalStatus'] as const) {
      assert.ok(String(row[key]).length > 0, `${row.rewardId}.${key}`);
    }
  }
  const family = (name: string) => CLIENT_REWARD_XP_AUDIT.find((row) => row.family === name)!.canonicalStatus;
  assert.equal(family('SERVER_WEEKLY_MISSION'), 'SERVER_WEEKLY_MISSION_NO_XP');
  assert.equal(family('SEASON_REWARD'), 'SEASON_REWARD_NO_XP');
  assert.equal(family('CHALLENGE_REWARD'), 'CHALLENGE_REWARD_NO_XP');
  assert.equal(family('ACHIEVEMENT'), 'ACHIEVEMENT_CATALOG_NO_XP');
  assert.equal(family('AD_REWARD'), 'AD_REWARD_NO_XP_AUTHORITY_BLOCKED_VERIFICATION');
  assert.equal(family('OPERATION_CHOICE'), 'OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT');
  assert.equal(family('DEBUG'), 'DEBUG_XP_DEV_ONLY_NOT_CANONICAL');

  assert.deepEqual(resolveCanonicalClientReward('nope', NOW), { ok: false, reason: UNKNOWN_REWARD });
  assert.deepEqual(resolveCanonicalClientReward(42, NOW), { ok: false, reason: UNKNOWN_REWARD });
  assert.deepEqual(resolveCanonicalClientReward('weekly_weekly_2020-W01_delivery', NOW), { ok: false, reason: REWARD_CYCLE_NOT_CURRENT });
  assert.deepEqual(resolveCanonicalClientReward(`weekly_${CYCLE.cycleId}_roundtrip`, NOW), { ok: false, reason: UNKNOWN_REWARD });
});

test('weekly cycle: ISO week UTC on the server clock, exact boundaries, production key parity', () => {
  assert.equal(CYCLE.policyVersion, CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION);
  assert.equal(CYCLE.cycleId, getWeeklySeasonKey(new Date(NOW)));
  assert.equal(new Date(CYCLE.startMs).getUTCDay(), 1);
  assert.equal(new Date(CYCLE.startMs).getUTCHours(), 0);
  assert.equal(CYCLE.endMs - CYCLE.startMs, 7 * 86_400_000);
  assert.equal(resolveCanonicalWeeklyCycle(CYCLE.startMs).cycleId, CYCLE.cycleId);
  assert.equal(resolveCanonicalWeeklyCycle(CYCLE.endMs - 1).cycleId, CYCLE.cycleId);
  assert.notEqual(resolveCanonicalWeeklyCycle(CYCLE.endMs).cycleId, CYCLE.cycleId);
  assert.notEqual(resolveCanonicalWeeklyCycle(CYCLE.startMs - 1).cycleId, CYCLE.cycleId);
  for (let ms = Date.UTC(2026, 11, 20); ms < Date.UTC(2027, 0, 12); ms += 5 * 3_600_000) {
    const cycle = resolveCanonicalWeeklyCycle(ms);
    assert.equal(cycle.cycleId, getWeeklySeasonKey(new Date(ms)), new Date(ms).toISOString());
    assert.ok(ms >= cycle.startMs && ms < cycle.endMs);
    assert.equal(resolveCanonicalWeeklyCycle(cycle.startMs).cycleId, cycle.cycleId);
  }
});

test('progress derivation: deliveries, cities, contract types, fleet, warehouse, reputation, fleet receipts', () => {
  const uid = 'derive';
  const done = { ownerUid: uid, lifecycleState: 'SETTLED', completionOutcome: 'COMPLETED', completionReportedAtMs: NOW };
  const deliveries = [
    { ...done, originCityId: 'istanbul', destinationCityId: 'ankara', contractType: 'urgent' },
    { ...done, originCityId: 'ankara', destinationCityId: 'istanbul' },
    { ...done, lifecycleState: 'COMPLETION_REPORTED', originCityId: 'izmir', destinationCityId: 'istanbul', contractType: 'fragile' },
    { ...done, completionOutcome: 'FAILED', lifecycleState: 'FAILED', originCityId: 'istanbul', destinationCityId: 'bursa' },
    { ...done, lifecycleState: 'ACCEPTED', completionOutcome: null, completionReportedAtMs: null },
    { ...done, ownerUid: 'other', originCityId: 'istanbul', destinationCityId: 'bursa' },
  ];
  const ev = evidence(uid, { deliveries });
  const get = (def: CanonicalClientRewardDefinition) => deriveCanonicalRewardProgress(def, ev);
  assert.deepEqual(get(mission('first_contract_start')), { ok: true, progress: 1, target: 1, eligible: true, evidenceClass: 'EXACT', sourceCount: 5 });
  const completed = get(mission('complete_5_deliveries'));
  assert.equal(completed.ok && completed.progress, 3);
  assert.equal(completed.ok && completed.eligible, false);
  const istanbul = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'CITY_DELIVERIES' && 'cityId' in row.metric && row.metric.cityId === 'istanbul');
  if (istanbul) {
    const city = get(istanbul);
    assert.equal(city.ok && city.progress, 3, 'origin and destination both count (production cityDeliveryCounts)');
  }
  const urgent = get(milestoneByMetric('CONTRACT_TYPE_COMPLETED', milestoneByMetric('CONTRACT_TYPE_COMPLETED').target));
  assert.equal(urgent.ok, true);
  const urgentRow = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'CONTRACT_TYPE_COMPLETED' && 'contractType' in row.metric && row.metric.contractType === 'urgent')!;
  const urgentDerived = get(urgentRow);
  assert.equal(urgentDerived.ok && urgentDerived.progress, 1);
  const prestige = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'CONTRACT_TYPE_COMPLETED' && 'contractType' in row.metric && row.metric.contractType === 'high_reputation')!;
  const prestigeDerived = get(prestige);
  assert.equal(prestigeDerived.ok && prestigeDerived.progress, 0, 'missing contractType is standard');

  const trusted = { assetType: 'TRUCK', ownerUid: uid, lifecycleStatus: 'ACTIVE', ownershipType: 'owned', authoritySource: 'CATALOG_PURCHASE_FOUNDATION', capacity: 26 };
  const fleet = [
    trusted,
    { ...trusted, authoritySource: 'INTERNAL_TEST_FIXTURE', capacity: 10 },
    { ...trusted, lifecycleStatus: 'SOLD' },
    { ...trusted, ownershipType: 'leased', lifecycleStatus: 'LEASE_EXPIRED' },
    { ...trusted, assetType: 'TRAILER' },
  ] as unknown as CanonicalRewardEvidence['fleet'];
  const twoTrucks = deriveCanonicalRewardProgress(mission('own_2_trucks'), evidence(uid, { fleet }));
  assert.deepEqual(twoTrucks, { ok: true, progress: 2, target: 2, eligible: true, evidenceClass: 'EXACT', sourceCount: 2 });
  const legacyFleet = [trusted, { ...trusted, authoritySource: 'LEGACY_SAVE_IMPORT' }] as unknown as CanonicalRewardEvidence['fleet'];
  const legacy = deriveCanonicalRewardProgress(mission('own_2_trucks'), evidence(uid, { fleet: legacyFleet }));
  assert.equal(!legacy.ok && legacy.reason, LEGACY_REWARD_PROGRESS_UNVERIFIED, 'legacy truck never completes a target');
  const lowerBound = deriveCanonicalRewardProgress(
    milestoneByMetric('ACTIVE_TRUCKS', 2),
    evidence(uid, { fleet: [...(fleet ?? []), { ...trusted, authorityClass: 'LEGACY_CLIENT_UNVERIFIED' }] as unknown as CanonicalRewardEvidence['fleet'] }),
  );
  assert.equal(lowerBound.ok && lowerBound.evidenceClass, 'LOWER_BOUND');
  const highCap = deriveCanonicalRewardProgress(milestoneByMetric('HIGH_CAPACITY_TRUCK'), evidence(uid, { fleet }));
  assert.equal(highCap.ok && highCap.progress, 1);

  const inventory = [
    { ownerUid: uid, warehouseId: 'wh-a', quantity: 12 },
    { ownerUid: uid, warehouseId: 'wh-b', quantity: 8 },
    { ownerUid: uid, warehouseId: 'wh-c', quantity: 0 },
    { ownerUid: 'other', warehouseId: 'wh-d', quantity: 500 },
  ];
  const warehouses = [
    { ownerUid: uid, warehouseId: 'wh-a', cityId: 'izmir', warehouseType: 'standard' },
    { ownerUid: uid, warehouseId: 'wh-b', cityId: 'ankara', warehouseType: 'standard' },
    { ownerUid: uid, warehouseId: 'wh-c', cityId: 'bursa', warehouseType: 'standard' },
  ] as unknown as CanonicalRewardEvidence['warehouses'];
  const tons = deriveCanonicalRewardProgress(milestoneByMetric('WAREHOUSE_STOCK_TONS'), evidence(uid, { inventory: inventory as never, warehouses }));
  assert.equal(tons.ok && tons.progress, 20);
  const cities = deriveCanonicalRewardProgress(milestoneByMetric('WAREHOUSE_STOCK_CITIES'), evidence(uid, { inventory: inventory as never, warehouses }));
  assert.equal(cities.ok && cities.progress, 2, 'empty warehouse city does not count');
  const active = deriveCanonicalRewardProgress(milestoneByMetric('WAREHOUSE_STOCK_ACTIVE'), evidence(uid, { inventory: [] }));
  assert.equal(active.ok && active.progress, 0);

  const reputation = deriveCanonicalRewardProgress(milestoneByMetric('REPUTATION'), evidence(uid, { progression: { reputation: 71 } }));
  assert.equal(reputation.ok && reputation.progress, 71);

  const mutations = [
    { ownerUid: uid, operationType: 'REPAIR', derivedCost: 120 },
    { ownerUid: uid, operationType: 'REPAIR', derivedCost: 0 },
    { ownerUid: uid, operationType: 'UPGRADE', derivedCost: 5000 },
    { ownerUid: 'other', operationType: 'UPGRADE', derivedCost: 5000 },
  ] as never;
  const repairs = deriveCanonicalRewardProgress(milestoneByMetric('TRUCK_REPAIRS'), evidence(uid, { fleetMutations: mutations }));
  assert.equal(repairs.ok && repairs.progress, 1, 'zero-cost repair is not a production repair');
  const upgrades = deriveCanonicalRewardProgress(milestoneByMetric('TRUCK_UPGRADES'), evidence(uid, { fleetMutations: mutations }));
  assert.equal(upgrades.ok && upgrades.progress, 1);

  for (const row of [...CANONICAL_MISSION_REWARD_CATALOG, ...CANONICAL_MILESTONE_REWARD_CATALOG].filter((r) => r.blockedAuthority)) {
    const derived = deriveCanonicalRewardProgress(row, evidence(uid, { deliveries, fleet, inventory: inventory as never, warehouses }));
    assert.equal(!derived.ok && derived.reason, row.blockedAuthority, row.rewardId);
  }
});

test('progress derivation: trade cash flow and weekly windows (deliveries, on-time, cities, stock replay, trade profit)', () => {
  const uid = 'derive-weekly';
  const warehouses = [{ ownerUid: uid, warehouseId: STEEL_WH, cityId: 'izmir', warehouseType: 'standard' }] as never;
  const trade = deriveCanonicalRewardProgress(
    mission('earn_10000_trade_profit'),
    evidence(uid, {
      warehouses,
      cargoReceipts: [
        { ownerUid: uid, operationId: 'b1', operationType: 'BUY', productId: 'steel', warehouseId: STEEL_WH, quantity: 10, totalCashDelta: -20_000, createdAtMs: NOW },
        { ownerUid: uid, operationId: 's1', operationType: 'SELL', productId: 'steel', warehouseId: STEEL_WH, quantity: 10, totalCashDelta: 30_000, createdAtMs: NOW + 1 },
      ] as never,
    }),
  );
  assert.deepEqual(trade, { ok: true, progress: 10_000, target: 10_000, eligible: true, evidenceClass: 'EXACT', sourceCount: 2 });
  const decaying = deriveCanonicalRewardProgress(
    mission('earn_10000_trade_profit'),
    evidence(uid, {
      warehouses: [{ ownerUid: uid, warehouseId: 'wh-elec', cityId: 'izmir', warehouseType: 'standard' }] as never,
      cargoReceipts: [
        { ownerUid: uid, operationId: 's2', operationType: 'SELL', productId: 'electronics', warehouseId: 'wh-elec', quantity: 10, totalCashDelta: 90_000, createdAtMs: NOW },
      ] as never,
    }),
  );
  assert.equal(!decaying.ok && decaying.reason, CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY);

  const inCycle = CYCLE.startMs + 1000;
  const deliveries = [
    { ownerUid: uid, lifecycleState: 'SETTLED', completionOutcome: 'COMPLETED', completionReportedAtMs: CYCLE.startMs, originCityId: 'a', destinationCityId: 'b', actualTravelHours: 10, deadlineHours: 10 },
    { ownerUid: uid, lifecycleState: 'SETTLED', completionOutcome: 'COMPLETED', completionReportedAtMs: inCycle, originCityId: 'b', destinationCityId: 'c', actualTravelHours: 10.01, deadlineHours: 10 },
    { ownerUid: uid, lifecycleState: 'SETTLED', completionOutcome: 'COMPLETED', completionReportedAtMs: CYCLE.startMs - 1, originCityId: 'x', destinationCityId: 'y', actualTravelHours: 1, deadlineHours: 10 },
    { ownerUid: uid, lifecycleState: 'SETTLED', completionOutcome: 'COMPLETED', completionReportedAtMs: CYCLE.endMs, originCityId: 'x', destinationCityId: 'z', actualTravelHours: 1, deadlineHours: 10 },
  ];
  const w = (slot: string) => deriveCanonicalRewardProgress(weekly(slot), evidence(uid, { deliveries }));
  const delivered = w('delivery');
  assert.equal(delivered.ok && delivered.progress, 2, 'window is [Monday 00:00 UTC, next Monday)');
  const onTime = w('reputation');
  assert.equal(onTime.ok && onTime.progress, 1, 'production onTime = !(actual > deadline)');
  const cities = w('bonus');
  assert.equal(cities.ok && cities.progress, 3);

  const target = weekly('warehouse').target;
  const stockRows = [
    { ownerUid: uid, operationId: 'pre-buy', operationType: 'BUY', warehouseId: STEEL_WH, productId: 'steel', quantity: target + 50, inventoryAfter: target + 50, inventoryRevisionAfter: 1, createdAtMs: CYCLE.startMs - 10 },
    { ownerUid: uid, operationId: 'pre-sell', operationType: 'SELL', warehouseId: STEEL_WH, productId: 'steel', quantity: 51, inventoryAfter: target - 1, inventoryRevisionAfter: 2, createdAtMs: CYCLE.startMs - 5 },
  ];
  const carried = deriveCanonicalRewardProgress(weekly('warehouse'), evidence(uid, { cargoReceipts: stockRows as never }));
  assert.equal(carried.ok && carried.progress, target - 1, 'stock peak before the cycle does not count; carried-in stock does');
  assert.equal(carried.ok && carried.eligible, false);
  const reached = deriveCanonicalRewardProgress(
    weekly('warehouse'),
    evidence(uid, {
      cargoReceipts: [
        ...stockRows,
        { ownerUid: uid, operationId: 'in-buy', operationType: 'BUY', warehouseId: STEEL_WH, productId: 'steel', quantity: 1, inventoryAfter: target, inventoryRevisionAfter: 3, createdAtMs: inCycle },
        { ownerUid: uid, operationId: 'in-sell', operationType: 'SELL', warehouseId: STEEL_WH, productId: 'steel', quantity: target, inventoryAfter: 0, inventoryRevisionAfter: 4, createdAtMs: inCycle + 1 },
      ] as never,
    }),
  );
  assert.equal(reached.ok && reached.progress, target, 'peak inside the cycle is kept after selling');
  assert.equal(reached.ok && reached.eligible, true);

  const tradeTarget = weekly('trade').target;
  const sale = (id: string, at: number) => ({ ownerUid: uid, operationId: id, operationType: 'SELL', warehouseId: STEEL_WH, productId: 'steel', quantity: 1, totalCashDelta: 1, inventoryAfter: 0, createdAtMs: at });
  const receipts = new Map<string, Record<string, unknown>>([
    ['progression:cargo-sale:t1', { xpAuthority: 'SERVER_DERIVED', xpEvidence: { profit: tradeTarget - 100 } }],
    ['progression:cargo-sale:t2', { xpAuthority: 'SERVER_DERIVED', xpEvidence: { profit: -5000 } }],
    ['progression:cargo-sale:t3', { xpAuthority: 'SERVER_DERIVED', xpEvidence: { profit: 100 } }],
    ['progression:cargo-sale:old', { xpAuthority: 'SERVER_DERIVED', xpEvidence: { profit: 1_000_000 } }],
    ['progression:cargo-sale:q1', { xpAuthority: 'CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY', xpEvidence: {} }],
  ]);
  const exactTrade = deriveCanonicalRewardProgress(
    weekly('trade'),
    evidence(uid, { cargoReceipts: [sale('t1', inCycle), sale('t2', inCycle + 1), sale('t3', inCycle + 2), sale('old', CYCLE.startMs - 1)] as never, cargoSaleProgression: receipts }),
  );
  assert.deepEqual(exactTrade, { ok: true, progress: tradeTarget, target: tradeTarget, eligible: true, evidenceClass: 'EXACT', sourceCount: 3 });
  const qualityBlocked = deriveCanonicalRewardProgress(
    weekly('trade'),
    evidence(uid, { cargoReceipts: [sale('t1', inCycle), sale('q1', inCycle + 1)] as never, cargoSaleProgression: receipts }),
  );
  assert.equal(!qualityBlocked.ok && qualityBlocked.reason, CLIENT_REWARD_XP_BLOCKED_CARGO_QUALITY_AUTHORITY);
  const noEvidence = deriveCanonicalRewardProgress(
    weekly('trade'),
    evidence(uid, { cargoReceipts: [sale('missing', inCycle)] as never, cargoSaleProgression: new Map() }),
  );
  assert.equal(!noEvidence.ok && noEvidence.reason, CLIENT_REWARD_XP_BLOCKED_TRADE_PROFIT_AUTHORITY);
  const lowerBoundEnough = deriveCanonicalRewardProgress(
    weekly('trade'),
    evidence(uid, { cargoReceipts: [sale('t1', inCycle), sale('t3', inCycle), sale('q1', inCycle)] as never, cargoSaleProgression: receipts }),
  );
  assert.equal(lowerBoundEnough.ok && lowerBoundEnough.evidenceClass, 'LOWER_BOUND');
  assert.equal(lowerBoundEnough.ok && lowerBoundEnough.eligible, true);
});

async function realDeliveryWorld(uid: string) {
  const db = createMemoryFirestore();
  seedAccount(db, uid);
  db.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  const fleet = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, { envValue: 'INTERNAL_TEST' });
  assert.equal(fleet.ok, true);
  await initProgression(db, uid);
  return db;
}

async function completeRealDelivery(db: Firestore & { dump: Dump }, uid: string, sequence: number, startMs = NOW) {
  const issued = await issueCanonicalRoadContractTransaction(
    db,
    uid,
    {
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      amount: 10,
      originMarket: buildFixtureMarket({ currentPrice: 1900, basePrice: 2000, stock: 90, targetStock: 40 }),
      destinationMarket: buildFixtureMarket({ currentPrice: 2400, basePrice: 2000, stock: 10, targetStock: 50, consumptionPerDay: 20 }),
      fuelPricePerLiter: 1.72,
      sequence,
    },
    startMs,
  );
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error('issue');
  const accepted = await acceptCanonicalRoadDeliveryTransaction(db, uid, { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 }, startMs, {});
  assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.reason);
  if (!accepted.ok) throw new Error(accepted.reason);
  const deliveryId = accepted.receipt.deliveryId;
  const planned = (db.dump.get(`users/${uid}/canonicalRoadDeliveries/${deliveryId}`) as { timingSnapshot: { plannedTravelGameHours: number } }).timingSnapshot.plannedTravelGameHours;
  const at = startMs + realMsForCanonicalGameHours(planned * 0.5);
  const report = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, deliveryId, 'COMPLETED', at, null, { progressionEnvValue: 'INTERNAL_TEST' });
  assert.equal(report.ok, true, report.ok ? '' : report.reason);
  return { deliveryId, at };
}

test('delivery integration: a real completed delivery unlocks first_delivery; XP, reputation and receipts exact; retry is idempotent', async () => {
  const uid = 'reward-delivery';
  const db = await realDeliveryWorld(uid);
  const early = await claim(db, uid, 'first_delivery');
  assert.deepEqual(early, { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 0, target: 1 });
  assert.equal(keysUnder(db, uid, 'canonicalRewardClaims').length, 0);

  const { deliveryId, at } = await completeRealDelivery(db, uid, 1);
  const deliveryReceipt = db.dump.get(canonicalProgressionReceiptPath(uid, `progression:delivery:${deliveryId}:completion`));
  assert.ok(deliveryReceipt, '29AG/29AF delivery progression still written by the report');
  const before = progression(db, uid);
  const cashBefore = cashOf(db, uid);

  const result = await claim(db, uid, 'first_delivery', at + 10);
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  if (!result.ok) return;
  assert.equal(result.application, 'APPLIED');
  const expectedXp = applyCanonicalCompanyXp(before, 50);
  const expectedRep = applyCanonicalReputationDelta(before.reputation, 1);
  const after = progression(db, uid);
  assert.equal(after.totalXp, before.totalXp + 50);
  assert.equal(after.level, expectedXp.level);
  assert.equal(after.xp, expectedXp.xp);
  assert.equal(after.reputation, expectedRep.reputation);
  assert.equal(after.progressionRevision, before.progressionRevision + 1);
  assert.equal(cashOf(db, uid), cashBefore, 'mission cash has no server authority: no cash write');

  const opId = 'progression:reward:mission:first_delivery';
  const pReceipt = db.dump.get(canonicalProgressionReceiptPath(uid, opId))!;
  assert.equal(pReceipt.operationId, opId);
  assert.equal(pReceipt.sourceType, 'CLIENT_REWARD_MISSION');
  assert.equal(pReceipt.sourceId, 'first_delivery');
  assert.equal(pReceipt.xpDelta, 50);
  assert.equal(pReceipt.xpAuthority, 'SERVER_DERIVED');
  assert.equal(pReceipt.requestedReputationDelta, 1);
  assert.deepEqual(pReceipt.reputationReasons, ['mission-reward']);
  assert.equal(pReceipt.totalXpBefore, before.totalXp);
  assert.equal(pReceipt.totalXpAfter, before.totalXp + 50);
  const xpEvidence = pReceipt.xpEvidence as Record<string, unknown>;
  assert.equal(xpEvidence.policyVersion, CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION);
  assert.equal(xpEvidence.claimId, 'reward:mission:first_delivery');
  assert.equal(xpEvidence.progress, 1);
  assert.equal(xpEvidence.metric, 'DELIVERIES_COMPLETED');

  const cReceipt = db.dump.get(`users/${uid}/canonicalRewardClaims/reward:mission:first_delivery`)!;
  assert.equal(cReceipt.claimSchemaVersion, 2);
  assert.equal(cReceipt.rewardXpPolicyVersion, CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION);
  assert.equal(cReceipt.rewardFamily, 'MISSION');
  assert.equal(cReceipt.cycleId, null);
  assert.equal(cReceipt.xpReward, 50);
  assert.equal(cReceipt.reputationReward, 1);
  assert.equal(cReceipt.progress, 1);
  assert.equal(cReceipt.target, 1);
  assert.equal(cReceipt.evidenceClass, 'EXACT');
  assert.equal(cReceipt.progressionOperationId, opId);
  assert.equal(cReceipt.ownerUid, uid);
  assert.equal(cReceipt.multiplicity, 'ONE_TIME');
  assert.deepEqual(cReceipt.cash, {
    productionCashReward: ALL_MISSIONS.find((row) => row.id === 'first_delivery')!.reward.money,
    authority: 'CASH_BLOCKED_NO_SERVER_CASH_AUTHORITY',
    granted: false,
    cashTransactionId: null,
  });

  for (let i = 0; i < 3; i += 1) {
    const retry = await claim(db, uid, 'first_delivery', at + 100 + i);
    assert.equal(retry.ok && retry.application, 'ALREADY_APPLIED');
  }
  assert.equal(progression(db, uid).totalXp, before.totalXp + 50);
  assert.equal(keysUnder(db, uid, 'canonicalRewardClaims').length, 1);

  const again = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, deliveryId, 'COMPLETED', at + 5, null, { progressionEnvValue: 'INTERNAL_TEST' });
  assert.equal(again.ok && again.alreadyReported, true);
  const five = deriveCanonicalRewardProgress(mission('complete_5_deliveries'), evidence(uid, {
    deliveries: keysUnder(db, uid, 'canonicalRoadDeliveries').map((key) => db.dump.get(key)!),
  }));
  assert.equal(five.ok && five.progress, 1, 'a replayed report does not progress twice');
});

test('one operation feeds several rewards once each; below / exact / above target', async () => {
  const uid = 'reward-multi';
  const db = await world(uid);
  seedDelivery(db, uid, 'd1');
  const opsBefore = progression(db, uid).totalXp;
  for (const id of ['first_contract_start', 'first_delivery']) {
    const result = await claim(db, uid, id);
    assert.equal(result.ok && result.application, 'APPLIED', id);
  }
  const ms = milestoneByMetric('DELIVERIES_COMPLETED', 1);
  assert.ok(ms, 'a completed_contracts milestone with target 1 exists');
  const msResult = await claim(db, uid, ms.rewardId);
  assert.equal(msResult.ok && msResult.application, 'APPLIED');
  assert.equal(progression(db, uid).totalXp, opsBefore + 25 + 50 + ms.xpReward);

  for (let i = 2; i <= 4; i += 1) seedDelivery(db, uid, `d${i}`);
  assert.deepEqual(await claim(db, uid, 'complete_5_deliveries'), { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 4, target: 5 });
  seedDelivery(db, uid, 'd5');
  const exact = await claim(db, uid, 'complete_5_deliveries');
  assert.equal(exact.ok && exact.receipt.progress, 5);

  const db2 = await world('reward-above');
  for (let i = 1; i <= 7; i += 1) seedDelivery(db2, 'reward-above', `d${i}`, { ownerUid: 'reward-above' });
  const above = await claim(db2, 'reward-above', 'complete_5_deliveries');
  assert.equal(above.ok && above.receipt.progress, 7);
  assert.equal(progression(db2, 'reward-above').totalXp, 100);
});

test('client override rejection: forged save, forged progress docs and forged request fields grant nothing', async () => {
  const uid = 'reward-forge';
  const db = await world(uid);
  db.dump.set(`users/${uid}/saves/current`, {
    player: { completedContracts: 999, reputation: 100, trucks: [{}, {}, {}] },
    missions: { claimedMissionRewardIds: [], progress: { complete_10_deliveries: 10 } },
    retention: { milestones: { ms_first_delivery: { progress: 1, isClaimed: false } } },
  });
  db.dump.set(`users/${uid}/canonicalRewardProgress/complete_10_deliveries`, { progress: 10, completed: true, claimable: true });
  db.dump.set(`users/${uid}/canonicalRewardProgress/reward:mission:complete_10_deliveries`, { progress: 10, eligible: true });
  const denied = await claim(db, uid, 'complete_10_deliveries');
  assert.deepEqual(denied, { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 0, target: 10 });
  const forgedId = await claim(db, uid, { rewardId: 'complete_10_deliveries', xp: 9999 });
  assert.deepEqual(forgedId, { ok: false, reason: UNKNOWN_REWARD });
  assert.equal(hasOnlyCanonicalClientRewardClaimKeys({ rewardId: 'complete_10_deliveries', canonicalSchemaVersion: 1, progress: 10, completed: true, xpReward: 9999 }), false);
  assert.equal(progression(db, uid).totalXp, 0);
  assert.equal(keysUnder(db, uid, 'canonicalRewardClaims').length, 0);
  assert.equal(keysUnder(db, uid, 'canonicalProgressionReceipts').length, 0);
  seedTruck(db, uid, 'legacy-a', { authoritySource: 'LEGACY_SAVE_IMPORT' });
  seedTruck(db, uid, 'legacy-b', { authorityClass: 'SERVER_CANONICAL_PENDING_MIGRATION' });
  const legacy = await claim(db, uid, 'own_2_trucks');
  assert.equal(!legacy.ok && legacy.reason, LEGACY_REWARD_PROGRESS_UNVERIFIED);
});

test('blocked rewards fail closed with their exact authority; gates and progression conditions', async () => {
  const uid = 'reward-blocked';
  const db = await world(uid);
  const blocked: Record<string, string> = {
    first_profit: 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY',
    open_market: 'CLIENT_REWARD_XP_BLOCKED_CLIENT_UI_EVENT',
    reach_company_score_150k: 'CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY',
    reach_warehouse_value_25000: 'CLIENT_REWARD_XP_BLOCKED_MARKET_PRICE_AUTHORITY',
    operate_in_3_cities: 'CLIENT_REWARD_XP_BLOCKED_FLEET_LOCATION_AUTHORITY',
    ms_cash_100k: 'CLIENT_REWARD_XP_BLOCKED_CASH_AUTHORITY',
    ms_company_score_500k: 'CLIENT_REWARD_XP_BLOCKED_COMPANY_SCORE_AUTHORITY',
    ms_driver_level_3: 'CLIENT_REWARD_XP_BLOCKED_DRIVER_LEVEL_AUTHORITY',
    ms_first_trade: 'CLIENT_REWARD_XP_BLOCKED_LEDGER_WINDOW_PARITY',
  };
  for (const [id, reason] of Object.entries(blocked)) {
    assert.deepEqual(await claim(db, uid, id), { ok: false, reason }, id);
  }
  seedDelivery(db, uid, 'd1');
  assert.deepEqual(await claim(db, uid, 'first_delivery', NOW, { ...ON, clientRewardXpEnvValue: null }), { ok: false, reason: 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_OFF' });
  assert.deepEqual(await claim(db, uid, 'first_delivery', NOW, { ...ON, progressionEnvValue: null }), { ok: false, reason: 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_OFF' });
  assert.deepEqual(await claimCanonicalClientRewardTransaction(db, '', 'first_delivery', NOW, ON), { ok: false, reason: 'UNAUTHENTICATED' });
  assert.equal(keysUnder(db, uid, 'canonicalRewardClaims').length, 0);

  const fresh = createMemoryFirestore();
  seedAccount(fresh, 'reward-uninit');
  seedDelivery(fresh, 'reward-uninit', 'd1', { ownerUid: 'reward-uninit' });
  assert.deepEqual(await claim(fresh, 'reward-uninit', 'first_delivery'), { ok: false, reason: CLIENT_REWARD_XP_PROGRESSION_UNINITIALIZED });
  assert.equal(keysUnder(fresh, 'reward-uninit', 'canonicalRewardClaims').length, 0);

  db.dump.set(canonicalProgressionReceiptPath(uid, 'progression:reward:mission:first_delivery'), { operationId: 'forged' });
  assert.deepEqual(await claim(db, uid, 'first_delivery'), { ok: false, reason: CLIENT_REWARD_XP_PROGRESSION_RECEIPT_CONFLICT });
  db.dump.set(`users/${uid}/canonicalRewardClaims/reward:mission:first_contract_start`, { ownerUid: uid, rewardId: 'first_contract_start', rewardXpPolicyVersion: 'canonical-client-reward-xp-v0' });
  assert.deepEqual(await claim(db, uid, 'first_contract_start'), { ok: false, reason: CLIENT_REWARD_XP_POLICY_UNKNOWN });
  db.dump.set(`users/${uid}/canonicalRewardClaims/reward:mission:first_contract_start`, { ownerUid: uid, rewardId: 'first_contract_start' });
  assert.deepEqual(await claim(db, uid, 'first_contract_start'), { ok: false, reason: CLIENT_REWARD_XP_POLICY_UNKNOWN }, 'no policy and not a 29W reward');
  const tamperDb = await world('reward-tamper');
  seedDelivery(tamperDb, 'reward-tamper', 'd1', { ownerUid: 'reward-tamper' });
  const ok = await claim(tamperDb, 'reward-tamper', 'first_delivery');
  assert.equal(ok.ok, true);
  const path = 'users/reward-tamper/canonicalRewardClaims/reward:mission:first_delivery';
  tamperDb.dump.set(path, { ...tamperDb.dump.get(path)!, xpReward: 5000 });
  assert.deepEqual(await claim(tamperDb, 'reward-tamper', 'first_delivery'), { ok: false, reason: CLIENT_REWARD_XP_CLAIM_CONFLICT });
  assert.equal(progression(tamperDb, 'reward-tamper').totalXp, 50);
});

test('two devices claim at once: exactly one grant', async () => {
  const uid = 'reward-2dev';
  const db = await world(uid);
  for (let i = 1; i <= 10; i += 1) seedDelivery(db, uid, `d${i}`);
  const results = await Promise.all([
    claim(db, uid, 'complete_10_deliveries', NOW + 1),
    claim(db, uid, 'complete_10_deliveries', NOW + 2),
    claim(db, uid, 'complete_10_deliveries', NOW + 3),
  ]);
  const applications = results.map((row) => (row.ok ? row.application : row.reason)).sort();
  assert.deepEqual(applications, ['ALREADY_APPLIED', 'ALREADY_APPLIED', 'APPLIED']);
  assert.equal(progression(db, uid).totalXp, 200);
  assert.equal(progression(db, uid).reputation, 52);
  assert.equal(keysUnder(db, uid, 'canonicalProgressionReceipts').length, 1);
});

test('29W coexistence: own_2_trucks grants XP + the existing canonical cash once; historical 29W claims get no retroactive XP', async () => {
  const uid = 'reward-29w';
  const db = await world(uid, 50_000_000);
  const buy1 = await purchaseCanonicalCatalogAssetTransaction(db, uid, 'truck-ford-cargo', 'rwtruck01', 'TRUCK', NOW, OP);
  assert.equal(buy1.ok, true, buy1.ok ? '' : buy1.reason);
  assert.deepEqual(await claim(db, uid, 'own_2_trucks'), { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 1, target: 2 });
  const buy2 = await purchaseCanonicalCatalogAssetTransaction(db, uid, 'truck-ford-cargo', 'rwtruck02', 'TRUCK', NOW, OP);
  assert.equal(buy2.ok, true);
  const xpBefore = progression(db, uid).totalXp;
  const cashBefore = cashOf(db, uid);

  const legacyPath = await claimCanonicalLocalRewardTransaction(db, uid, 'own_2_trucks', NOW, { envValue: 'INTERNAL_TEST', clientRewardXpEnvValue: 'INTERNAL_TEST' });
  assert.deepEqual(legacyPath, { ok: false, reason: CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED });
  assert.deepEqual(await claim(db, uid, 'own_2_trucks', NOW, { ...ON, localRewardEnvValue: null }), { ok: false, reason: CLIENT_REWARD_CASH_AUTHORITY_REQUIRED });
  assert.equal(cashOf(db, uid), cashBefore);

  const granted = await claim(db, uid, 'own_2_trucks');
  assert.equal(granted.ok && granted.application, 'APPLIED', granted.ok ? '' : granted.reason);
  if (!granted.ok) return;
  assert.equal(progression(db, uid).totalXp, xpBefore + 120);
  assert.equal(cashOf(db, uid), cashBefore + 3000);
  const receipt = granted.receipt;
  assert.equal(receipt.cashTransactionId, 'reward:mission:own_2_trucks');
  assert.equal(receipt.rewardAmount, 3000);
  assert.equal(receipt.eligibilityPolicyVersion, 'canonical-local-reward-internal-v1');
  assert.deepEqual(receipt.cash, { productionCashReward: 3000, authority: 'CANONICAL_29W_INTERNAL', granted: true, cashTransactionId: 'reward:mission:own_2_trucks' });
  assert.ok(db.dump.has(`users/${uid}/canonicalCashTransactions/reward:mission:own_2_trucks`));
  const retry = await claim(db, uid, 'own_2_trucks');
  assert.equal(retry.ok && retry.application, 'ALREADY_APPLIED');
  const gateOffReplay = await claimCanonicalLocalRewardTransaction(db, uid, 'own_2_trucks', NOW, { envValue: 'INTERNAL_TEST', clientRewardXpEnvValue: null });
  assert.equal(gateOffReplay.ok && gateOffReplay.alreadyApplied, true, 'a 29AI receipt still replays on the 29W path');
  assert.equal(cashOf(db, uid), cashBefore + 3000);
  assert.equal(progression(db, uid).totalXp, xpBefore + 120);

  const ms = await claim(db, uid, 'ms_second_truck');
  assert.equal(ms.ok && ms.application, 'APPLIED');
  assert.equal(cashOf(db, uid), cashBefore + 3000 + 2500);

  const hist = 'reward-29w-hist';
  const hdb = await world(hist);
  seedTruck(hdb, hist, 't1');
  seedTruck(hdb, hist, 't2');
  const old = await claimCanonicalLocalRewardTransaction(hdb, hist, 'own_2_trucks', NOW, { envValue: 'INTERNAL_TEST', clientRewardXpEnvValue: null });
  assert.equal(old.ok && !old.alreadyApplied, true);
  const cashAfterOld = cashOf(hdb, hist);
  const later = await claim(hdb, hist, 'own_2_trucks', NOW + 50);
  assert.equal(later.ok && later.application, CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED);
  assert.equal(progression(hdb, hist).totalXp, 0, 'no retroactive XP');
  assert.equal(cashOf(hdb, hist), cashAfterOld, 'no second cash');
  assert.equal(keysUnder(hdb, hist, 'canonicalProgressionReceipts').length, 0);
  assert.equal(hdb.dump.get(`users/${hist}/canonicalRewardClaims/reward:mission:own_2_trucks`)?.rewardXpPolicyVersion, undefined, 'old claim immutable');
});

test('weekly objectives: exact cycle, reset, boundary, backend weekly mode, XP exact', async () => {
  const uid = 'reward-weekly';
  const db = await world(uid);
  const def = weekly('delivery');
  for (let i = 0; i < def.target; i += 1) {
    seedDelivery(db, uid, `prev-${i}`, { completionReportedAtMs: CYCLE.startMs - 1 - i });
  }
  assert.deepEqual(await claim(db, uid, def.rewardId), { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 0, target: def.target });
  for (let i = 0; i < def.target - 1; i += 1) seedDelivery(db, uid, `cur-${i}`, { completionReportedAtMs: CYCLE.startMs + i });
  assert.deepEqual(await claim(db, uid, def.rewardId), { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: def.target - 1, target: def.target });
  seedDelivery(db, uid, 'cur-last', { completionReportedAtMs: CYCLE.endMs - 1 });
  assert.deepEqual(await claim(db, uid, def.rewardId, CYCLE.startMs + 5, { ...ON, weeklyBackendEnvValue: 'true' }), { ok: false, reason: LOCAL_WEEKLY_OBJECTIVE_DISABLED_BACKEND_WEEKLY_MODE });
  const granted = await claim(db, uid, def.rewardId, CYCLE.endMs - 1);
  assert.equal(granted.ok && granted.application, 'APPLIED', granted.ok ? '' : granted.reason);
  if (!granted.ok) return;
  assert.equal(progression(db, uid).totalXp, def.xpReward);
  assert.equal(granted.receipt.cycleId, CYCLE.cycleId);
  assert.equal(granted.receipt.cyclePolicyVersion, CANONICAL_WEEKLY_OBJECTIVE_CYCLE_POLICY_VERSION);
  assert.equal(granted.receipt.multiplicity, 'ONE_PER_CYCLE');
  const claimId = `reward:weekly:${CYCLE.cycleId}:${def.rewardId}`;
  assert.ok(db.dump.has(`users/${uid}/canonicalRewardClaims/${claimId}`));
  const opId = `progression:reward:weekly:${CYCLE.cycleId}:${def.rewardId}`;
  assert.equal(db.dump.get(canonicalProgressionReceiptPath(uid, opId))?.sourceType, 'CLIENT_REWARD_WEEKLY_OBJECTIVE');

  assert.deepEqual(await claim(db, uid, def.rewardId, CYCLE.endMs), { ok: false, reason: REWARD_CYCLE_NOT_CURRENT }, 'cycle closes at next Monday 00:00 UTC');

  const next = resolveCanonicalWeeklyCycle(CYCLE.endMs);
  const nextDef = weekly('delivery', next.cycleId);
  const nextEarly = await claim(db, uid, nextDef.rewardId, next.startMs + 1);
  assert.deepEqual(nextEarly, { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 0, target: nextDef.target }, 'progress resets with the cycle');
  for (let i = 0; i < nextDef.target; i += 1) seedDelivery(db, uid, `next-${i}`, { completionReportedAtMs: next.startMs + i });
  const nextGrant = await claim(db, uid, nextDef.rewardId, next.startMs + 100);
  assert.equal(nextGrant.ok && nextGrant.application, 'APPLIED');
  assert.equal(progression(db, uid).totalXp, def.xpReward + nextDef.xpReward);

  const rep = weekly('reputation', next.cycleId);
  const repDb = await world('reward-weekly-rep');
  for (let i = 0; i < rep.target; i += 1) {
    seedDelivery(repDb, 'reward-weekly-rep', `r-${i}`, { ownerUid: 'reward-weekly-rep', completionReportedAtMs: next.startMs + i, actualTravelHours: 10, deadlineHours: 10 });
  }
  const repGrant = await claim(repDb, 'reward-weekly-rep', rep.rewardId, next.startMs + 1000);
  assert.equal(repGrant.ok && repGrant.application, 'APPLIED');
  assert.equal(progression(repDb, 'reward-weekly-rep').reputation, applyCanonicalReputationDelta(50, rep.reputationReward).reputation);
});

test('purchase, driver hire, warehouse and cargo integrations use real canonical operations', async () => {
  const uid = 'reward-ops';
  const db = await world(uid, 50_000_000);
  db.dump.set('canonicalWorldMarkets/izmir_steel', {
    cityId: 'izmir',
    productId: 'steel',
    stock: 10_000,
    currentPrice: 2000,
    basePrice: 2000,
    marketRevision: 1,
    authorityMode: 'INTERNAL_TEST_FIXTURE',
    lastUpdatedAtMs: NOW,
  });
  const hire = await hireCanonicalDriverTransaction(db, uid, 'driver-can-t', 'reward-hire-1', NOW, OP);
  assert.equal(hire.ok, true);
  for (const row of [...CANONICAL_MISSION_REWARD_CATALOG, ...CANONICAL_MILESTONE_REWARD_CATALOG]) {
    assert.notEqual(row.metric?.kind, 'DRIVER_HIRES' as never, 'no production reward counts hires');
  }
  assert.deepEqual(await claim(db, uid, 'first_trade'), { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 0, target: 1 });
  const open = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'reward-open-1', NOW, OP);
  assert.equal(open.ok, true, open.ok ? '' : open.reason);
  const buy = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'reward-buy-1', NOW, OP);
  assert.equal(buy.ok, true, buy.ok ? '' : buy.reason);
  const firstTrade = await claim(db, uid, 'first_trade');
  assert.equal(firstTrade.ok && firstTrade.application, 'APPLIED');
  const active = milestoneByMetric('WAREHOUSE_STOCK_ACTIVE');
  const activeClaim = await claim(db, uid, active.rewardId);
  assert.equal(activeClaim.ok && activeClaim.application, 'APPLIED');

  db.dump.set('canonicalWorldMarkets/izmir_steel', { ...db.dump.get('canonicalWorldMarkets/izmir_steel')!, currentPrice: 9000 });
  const sell = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'reward-sell-1', NOW + 2, OP);
  assert.equal(sell.ok, true, sell.ok ? '' : sell.reason);
  const saleProfit = Number((db.dump.get(canonicalProgressionReceiptPath(uid, 'progression:cargo-sale:reward-sell-1'))?.xpEvidence as Record<string, unknown>).profit);
  const tradeWeekly = weekly('trade');
  const tradeClaim = await claim(db, uid, tradeWeekly.rewardId, NOW + 3);
  if (saleProfit >= tradeWeekly.target) {
    assert.equal(tradeClaim.ok && tradeClaim.application, 'APPLIED');
    assert.equal(tradeClaim.ok && tradeClaim.receipt.progress, saleProfit);
  } else {
    assert.deepEqual(tradeClaim, { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: saleProfit, target: tradeWeekly.target });
  }
  const cashFlow = await claim(db, uid, 'earn_10000_trade_profit', NOW + 4);
  assert.equal(cashFlow.ok && cashFlow.application, 'APPLIED', cashFlow.ok ? '' : cashFlow.reason);
  const warehouseWeekly = weekly('warehouse');
  const stockClaim = await claim(db, uid, warehouseWeekly.rewardId, NOW + 5);
  if (warehouseWeekly.target <= 20) assert.equal(stockClaim.ok, true);
  else assert.deepEqual(stockClaim, { ok: false, reason: REWARD_NOT_ELIGIBLE, progress: 20, target: warehouseWeekly.target });
});

function seedIssuanceWorld(db: { dump: Dump }, uid: string) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, { assetType: 'TRUCK', capacity: 25, lifecycleStatus: 'ACTIVE', ownerUid: uid });
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

test('level-up from reward XP; existing batch frozen; next refresh sees the new level', async () => {
  const uid = 'reward-level';
  const db = createMemoryFirestore();
  const gates = {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
    eventEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
    refreshEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  } as const;
  seedIssuanceWorld(db, uid);
  db.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  const batch = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(batch.ok, true, batch.ok ? '' : batch.reason);
  if (!batch.ok) return;
  const batchPath = `users/${uid}/canonicalRoadContractBatches/${batch.batchId}`;
  assert.equal(db.dump.get(batchPath)?.playerLevel, 1);

  const state = progression(db, uid);
  db.dump.set(canonicalCompanyProgressionPath(uid), { ...state, xp: state.xpToNextLevel - 10, totalXp: state.xpToNextLevel - 10 });
  for (let i = 1; i <= 10; i += 1) seedDelivery(db, uid, `lv-${i}`);
  const before = progression(db, uid);
  const expected = applyCanonicalCompanyXp(before, 200);
  const result = await claim(db, uid, 'complete_10_deliveries');
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  const after = progression(db, uid);
  assert.equal(after.level, expected.level);
  assert.ok(after.level >= 2);
  assert.equal(after.xp, expected.xp);
  assert.equal(after.totalXp, before.totalXp + 200);
  assert.equal(db.dump.get(batchPath)?.playerLevel, 1, 'existing batch frozen');
  const refreshed = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, { ...gates, refreshIntentId: 'reward-refresh-1' });
  assert.equal(refreshed.ok, true, refreshed.ok ? '' : refreshed.reason);
  if (!refreshed.ok) return;
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed.batchId}`)?.playerLevel, after.level);

  const clampDb = await world('reward-clamp');
  const clampState = progression(clampDb, 'reward-clamp');
  clampDb.dump.set(canonicalCompanyProgressionPath('reward-clamp'), { ...clampState, reputation: 100 });
  seedDelivery(clampDb, 'reward-clamp', 'd1', { ownerUid: 'reward-clamp' });
  const clamp = await claim(clampDb, 'reward-clamp', 'first_delivery');
  assert.equal(clamp.ok, true);
  const clampReceipt = clampDb.dump.get(canonicalProgressionReceiptPath('reward-clamp', 'progression:reward:mission:first_delivery'))!;
  assert.equal(clampReceipt.requestedReputationDelta, 1);
  assert.equal(clampReceipt.reputationDelta, 0, 'production reputation clamp');
  assert.equal(progression(clampDb, 'reward-clamp').reputation, 100);
});
