/**
 * Map V2 Step 29AI canonical client-reward XP authority (missions, milestones, local weekly objectives).
 * Run: node --import tsx scripts/map-v2-canonical-client-reward-xp-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { Firestore } from 'firebase-admin/firestore';

import { claimCanonicalClientRewardTransaction } from '../backend/src/canonicalClientRewardXp';
import { claimCanonicalLocalRewardTransaction } from '../backend/src/canonicalLocalReward';
import { purchaseCanonicalCatalogAssetTransaction } from '../backend/src/canonicalCatalogPurchase';
import { hireCanonicalDriverTransaction } from '../backend/src/canonicalCoreVehicleStaffCash';
import { openCanonicalWarehouseTransaction } from '../backend/src/canonicalWarehouse';
import { buyCanonicalCargoTransaction, sellCanonicalCargoTransaction } from '../backend/src/canonicalCargoMarket';
import { serverStateCurrentRef } from '../backend/src/canonicalCashTransaction';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../backend/src/canonicalCompanyProgression';
import { generateCanonicalProductionRoadBatchTransaction } from '../backend/src/canonicalProductionRoadContractIssuance';
import { REPUTATION_RULES } from '../src/config/reputationRules';
import { levelBalance } from '../src/config/balance';
import { CITIES } from '../src/data/cities';
import { PRODUCT_IDS } from '../src/data/products';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_PROGRESSION_READINESS,
  CANONICAL_PROGRESSION_REMAINING_BLOCKERS,
  applyCanonicalCompanyXp,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
  deriveCanonicalRoadCompletionReputation,
  deriveCanonicalRoadCompletionXp,
  type CanonicalCompanyProgressionState,
} from '../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS,
  CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS,
  CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
  CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS,
  CANONICAL_MILESTONE_REWARD_CATALOG,
  CANONICAL_MILESTONE_REWARD_COVERAGE,
  CANONICAL_MISSION_REWARD_CATALOG,
  CANONICAL_MISSION_REWARD_COVERAGE,
  CANONICAL_WEEKLY_REWARD_COVERAGE,
  CLIENT_REWARD_XP_AUDIT,
  CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED,
  CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED,
  LEGACY_REWARD_PROGRESS_UNVERIFIED,
  REWARD_CYCLE_NOT_CURRENT,
  REWARD_NOT_ELIGIBLE,
  buildCanonicalWeeklyObjectiveCatalog,
  clientRewardAuditHasUnknown,
  hasOnlyCanonicalClientRewardClaimKeys,
  isCanonicalClientRewardXpAllowed,
  resolveCanonicalWeeklyCycle,
} from '../src/domain/canonicalClientRewardXp';
import {
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../src/domain/canonicalProductionMarketTick';
import { createInternalFixtureRuntime } from '../src/domain/canonicalFleetRuntimeLocation';
import { createCanonicalWarehouseId } from '../src/domain/canonicalWarehouseState';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { calculateDeliveryXp } from '../src/simulation/leveling';
import { getWeeklySeasonKey } from '../src/utils/leaderboardSeason';
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
type Tx = {
  get: (ref: { path: string; _col?: boolean }) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  }>;
  create: (ref: { path: string }, data: Record<string, unknown>) => void;
  update: (ref: { path: string }, data: Record<string, unknown>) => void;
  set: (ref: { path: string }, data: Record<string, unknown>) => void;
};

/** Serialized transactions with buffered writes (serializable isolation + rollback on throw). */
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
    runTransaction<T>(operation: (transaction: Tx) => Promise<T>): Promise<T> {
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
const WH = createCanonicalWarehouseId('izmir', 'standard');

function seedAccount(db: { dump: Dump }, uid: string, cash = 50_000_000) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  db.dump.set(`users/${uid}`, { money: 31_337 });
}
async function world(uid: string) {
  const db = createMemoryFirestore();
  seedAccount(db, uid);
  const r = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, { envValue: 'INTERNAL_TEST' });
  if (!r.ok) throw new Error(r.reason);
  return db;
}
function prog(db: { dump: Dump }, uid: string) {
  return db.dump.get(canonicalCompanyProgressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
}
function cash(db: { dump: Dump }, uid: string) {
  return Number(db.dump.get(serverStateCurrentRef(uid))?.cash);
}
function count(db: { dump: Dump }, uid: string, collection: string) {
  return [...db.dump.keys()].filter((k) => k.startsWith(`users/${uid}/${collection}/`)).length;
}
function seedDelivery(db: { dump: Dump }, uid: string, id: string, overrides: Record<string, unknown> = {}) {
  db.dump.set(`users/${uid}/canonicalRoadDeliveries/${id}`, {
    ownerUid: uid,
    lifecycleState: 'SETTLED',
    completionOutcome: 'COMPLETED',
    completionReportedAtMs: NOW,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    actualTravelHours: 5,
    deadlineHours: 10,
    ...overrides,
  });
}
function seedTruck(db: { dump: Dump }, uid: string, id: string, overrides: Record<string, unknown> = {}) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/${id}`, {
    assetType: 'TRUCK',
    ownerUid: uid,
    capacity: 10,
    ownershipType: 'owned',
    lifecycleStatus: 'ACTIVE',
    authoritySource: 'CATALOG_PURCHASE_FOUNDATION',
    ...overrides,
  });
}
function claim(db: Firestore & { dump: Dump }, uid: string, rewardId: unknown, nowMs = NOW + 1, options: Record<string, unknown> = ON) {
  return claimCanonicalClientRewardTransaction(db, uid, rewardId, nowMs, options);
}
function weekly(slot: string, cycleId = CYCLE.cycleId) {
  return buildCanonicalWeeklyObjectiveCatalog(cycleId).find((row) => row.rewardId.endsWith(`_${slot}`))!;
}
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

async function main(): Promise<void> {
  console.log('\n=== Map V2 Canonical Client-Reward XP Authority (Step 29AI) ===\n');

  const store = read('src/store/gameStore.ts');
  const missionsScreen = read('src/screens/MissionsScreen.tsx');
  const contractsScreen = read('src/screens/ContractsScreen.tsx');
  const index = read('backend/src/index.ts');
  const rules = read('firestore.rules');
  const backend = read('backend/src/canonicalClientRewardXp.ts');
  const domain = read('src/domain/canonicalClientRewardXp.ts');

  // A–C public mission / milestone / weekly UI unchanged
  assert(store.includes("get().addCompanyXp(xpReward, 'mission_reward')"), 'A public mission XP stays local');
  assert(store.includes("get().addCompanyXp(xpReward, 'milestone_reward')"), 'B public milestone XP stays local');
  assert(store.includes("get().addCompanyXp(xpReward, 'weekly_objective_reward')"), 'C public weekly XP stays local');
  for (const [name, source] of [['store', store], ['MissionsScreen', missionsScreen], ['ContractsScreen', contractsScreen]] as const) {
    assert(!/canonicalClientRewardXp|claimCanonicalClientReward|canonicalRewardClaims|canonicalProgressionReceipts/.test(source), `A–C ${name} not wired`);
  }

  // D guest unchanged
  const guest = await claimCanonicalClientRewardTransaction(createMemoryFirestore(), '', 'first_delivery', NOW, ON);
  assert(!guest.ok && guest.reason === 'UNAUTHENTICATED', 'D guest claim rejected');

  // E gate default OFF
  assert(isCanonicalClientRewardXpAllowed({ envValue: undefined }) === false, 'E missing OFF');
  assert(isCanonicalClientRewardXpAllowed({ envValue: null }) === false, 'E null OFF');
  assert(isCanonicalClientRewardXpAllowed({ envValue: 'true' }) === false, 'E other OFF');
  assert(isCanonicalClientRewardXpAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'E INTERNAL_TEST');
  const offDb = await world('gate-off');
  seedDelivery(offDb, 'gate-off', 'd1', { ownerUid: 'gate-off' });
  const off = await claim(offDb, 'gate-off', 'first_delivery', NOW, { ...ON, clientRewardXpEnvValue: null });
  assert(!off.ok && off.reason === 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_OFF', 'E claim off by default');
  assert(/export const claimCanonicalClientReward = onCall/.test(index), 'E callable exported');
  assert(/if \(isCanonicalClientRewardXpAllowed\(\)\) \{\s*return claimCanonicalClientRewardTransaction/.test(index), 'E 29W callable routes only when gate on');

  // F audit has no UNKNOWN
  assert(clientRewardAuditHasUnknown() === false, 'F no UNKNOWN');
  assert(CLIENT_REWARD_XP_AUDIT.length === 12 + 41 + 5 + 7, 'F audit covers every reward row + families');
  const familyStatus = (family: string) => CLIENT_REWARD_XP_AUDIT.find((row) => row.family === family)?.canonicalStatus;
  assert(familyStatus('SERVER_WEEKLY_MISSION') === 'SERVER_WEEKLY_MISSION_NO_XP', 'F server weekly no XP');
  assert(familyStatus('AD_REWARD') === 'AD_REWARD_NO_XP_AUTHORITY_BLOCKED_VERIFICATION', 'F ads unchanged');
  assert(familyStatus('OPERATION_CHOICE') === 'OPERATION_CHOICE_XP_CLIENT_OWNED_DORMANT', 'F operation choice dormant');
  assert(familyStatus('DEBUG') === 'DEBUG_XP_DEV_ONLY_NOT_CANONICAL', 'F debug not canonical');
  assert(
    read('backend/src/weeklyMissionCatalog.ts').includes("if ('xp' in template.reward || 'reputation' in template.reward) {"),
    'F server weekly catalog rejects XP rewards',
  );

  // G–I exact XP-bearing counts
  assert(CANONICAL_MISSION_REWARD_COVERAGE.total === 12 && CANONICAL_MISSION_REWARD_COVERAGE.xpBearing === 12, 'G missions 12/12');
  assert(CANONICAL_MISSION_REWARD_COVERAGE.canonical === 7 && CANONICAL_MISSION_REWARD_COVERAGE.blocked === 5, 'G missions 7 canonical / 5 blocked');
  assert(CANONICAL_MILESTONE_REWARD_COVERAGE.total === 41 && CANONICAL_MILESTONE_REWARD_COVERAGE.xpBearing === 41, 'H milestones 41/41');
  assert(CANONICAL_MILESTONE_REWARD_COVERAGE.canonical === 30 && CANONICAL_MILESTONE_REWARD_COVERAGE.blocked === 11, 'H milestones 30 / 11');
  assert(CANONICAL_WEEKLY_REWARD_COVERAGE.total === 5 && CANONICAL_WEEKLY_REWARD_COVERAGE.canonical === 5, 'I weekly 5/5');

  // J–M client progress / completed / XP / eligibility rejected
  for (const key of ['progress', 'completed', 'xp', 'xpReward', 'rewardXp', 'eligible', 'claimable', 'target', 'cycleId', 'reputation', 'rewardAmount']) {
    assert(!hasOnlyCanonicalClientRewardClaimKeys({ rewardId: 'first_delivery', canonicalSchemaVersion: 1, [key]: 1 }), `J–M rejects ${key}`);
  }
  assert(/hasOnlyCanonicalClientRewardClaimKeys\(record\)/.test(index), 'J–M callable enforces keys');
  const forged = await world('forged');
  forged.dump.set('users/forged/saves/current', { player: { completedContracts: 99 }, missions: { progress: { first_delivery: 1 } } });
  forged.dump.set('users/forged/canonicalRewardProgress/first_delivery', { progress: 1, completed: true, claimable: true });
  const forgedClaim = await claim(forged, 'forged', 'first_delivery');
  assert(!forgedClaim.ok && forgedClaim.reason === REWARD_NOT_ELIGIBLE, 'J/K forged progress & completion ignored');
  assert(prog(forged, 'forged').totalXp === 0, 'L no XP from forged state');
  const objectId = await claim(forged, 'forged', { rewardId: 'first_delivery', eligible: true });
  assert(!objectId.ok && objectId.reason === 'UNKNOWN_REWARD', 'M non-string reward selector rejected');

  // N catalog server-owned
  assert(/CANONICAL_MISSION_REWARD_CATALOG[\s\S]*ALL_MISSIONS\.map/.test(domain), 'N mission catalog from production config');
  assert(/MILESTONE_DEFINITIONS\.map/.test(domain), 'N milestone catalog from production config');
  assert(/generateWeeklyObjectives\(cycleId\)/.test(domain), 'N weekly catalog from production generator');
  assert(!/request\.data|record\.xp|record\.progress/.test(backend), 'N backend reads nothing but rewardId');

  // O delivery progress
  const d = await world('deliv');
  seedDelivery(d, 'deliv', 'd1', { ownerUid: 'deliv' });
  seedDelivery(d, 'deliv', 'd2', { ownerUid: 'deliv', lifecycleState: 'FAILED', completionOutcome: 'FAILED' });
  const firstDelivery = await claim(d, 'deliv', 'first_delivery');
  assert(firstDelivery.ok && firstDelivery.receipt.progress === 1, 'O delivery progress from canonical deliveries (failed excluded)');

  // P purchase progress
  const p = await world('purchase');
  await purchaseCanonicalCatalogAssetTransaction(p, 'purchase', 'truck-ford-cargo', 'rgtruck01', 'TRUCK', NOW, OP);
  await purchaseCanonicalCatalogAssetTransaction(p, 'purchase', 'truck-ford-cargo', 'rgtruck02', 'TRUCK', NOW, OP);
  const cashBeforeTrucks = cash(p, 'purchase');
  const own2 = await claim(p, 'purchase', 'own_2_trucks');
  assert(own2.ok && own2.receipt.progress === 2, 'P purchase progress from canonical fleet');

  // Q driver hire progress: no production reward counts hires
  const h = await world('hire');
  const hired = await hireCanonicalDriverTransaction(h, 'hire', 'driver-can-t', 'rg-hire-01', NOW, OP);
  assert(hired.ok, 'Q hire ok');
  assert(
    [...CANONICAL_MISSION_REWARD_CATALOG, ...CANONICAL_MILESTONE_REWARD_CATALOG].every((row) => !/HIRE/.test(row.metric?.kind ?? '')),
    'Q no reward derives from driver hire (driver_level_3 blocked on driver level authority)',
  );

  // R warehouse / S cargo progress
  const w = await world('ware');
  w.dump.set('canonicalWorldMarkets/izmir_steel', { cityId: 'izmir', productId: 'steel', stock: 10_000, currentPrice: 2000, basePrice: 2000, marketRevision: 1, authorityMode: 'INTERNAL_TEST_FIXTURE', lastUpdatedAtMs: NOW });
  await openCanonicalWarehouseTransaction(w, 'ware', 'izmir', 'standard', 'rg-open-01', NOW, OP);
  await buyCanonicalCargoTransaction(w, 'ware', 'izmir', 'steel', 20, WH, 'rg-buy-001', NOW, OP);
  const activeMs = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'WAREHOUSE_STOCK_ACTIVE')!;
  const activeClaim = await claim(w, 'ware', activeMs.rewardId);
  assert(activeClaim.ok && activeClaim.application === 'APPLIED', 'R warehouse stock milestone from canonical inventory');
  const firstTrade = await claim(w, 'ware', 'first_trade');
  assert(firstTrade.ok, 'S first_trade from canonical BUY receipt');
  w.dump.set('canonicalWorldMarkets/izmir_steel', { ...w.dump.get('canonicalWorldMarkets/izmir_steel')!, currentPrice: 9000 });
  await sellCanonicalCargoTransaction(w, 'ware', 'izmir', 'steel', 20, WH, 'rg-sell-01', NOW + 2, OP);
  const tradeProfit = await claim(w, 'ware', 'earn_10000_trade_profit', NOW + 3);
  assert(tradeProfit.ok && tradeProfit.receipt.evidenceClass === 'EXACT', 'S trade profit from canonical receipts (zero-decay)');
  const weeklyTrade = await claim(w, 'ware', weekly('trade').rewardId, NOW + 4);
  assert(weeklyTrade.ok && weeklyTrade.application === 'APPLIED', 'S weekly trade from 29AH server-derived sale profit');

  // T legacy local progress ignored / U save tampering ignored
  const legacy = await world('legacy');
  seedTruck(legacy, 'legacy', 'l1', { authoritySource: 'LEGACY_SAVE_IMPORT' });
  seedTruck(legacy, 'legacy', 'l2');
  const legacyClaim = await claim(legacy, 'legacy', 'own_2_trucks');
  assert(!legacyClaim.ok && legacyClaim.reason === LEGACY_REWARD_PROGRESS_UNVERIFIED, 'T legacy truck never completes a target');
  legacy.dump.set('users/legacy/saves/current', { retention: { milestones: { ms_first_delivery: { progress: 1 } } }, player: { completedContracts: 50 } });
  const tampered = await claim(legacy, 'legacy', 'complete_10_deliveries');
  assert(!tampered.ok && tampered.reason === REWARD_NOT_ELIGIBLE, 'U save tampering ignored');

  // V one source operation cannot double-progress; W several rewards from one operation
  const multi = await world('multi');
  seedDelivery(multi, 'multi', 'only', { ownerUid: 'multi' });
  const a = await claim(multi, 'multi', 'first_delivery');
  const b = await claim(multi, 'multi', 'first_contract_start');
  const msOne = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'DELIVERIES_COMPLETED' && row.target === 1)!;
  const c = await claim(multi, 'multi', msOne.rewardId);
  assert(a.ok && b.ok && c.ok, 'W one delivery feeds mission + mission + milestone');
  const again = await claim(multi, 'multi', 'first_delivery');
  assert(again.ok && again.application === 'ALREADY_APPLIED', 'V same reward never progressed twice');
  const five = await claim(multi, 'multi', 'complete_5_deliveries');
  assert(!five.ok && five.progress === 1, 'V a delivery counts once');

  // X–Z below / exact / above target
  const t = await world('target');
  for (let i = 0; i < 4; i += 1) seedDelivery(t, 'target', `d${i}`, { ownerUid: 'target' });
  const below = await claim(t, 'target', 'complete_5_deliveries');
  assert(!below.ok && below.reason === REWARD_NOT_ELIGIBLE && below.progress === 4, 'X below target rejected');
  seedDelivery(t, 'target', 'd4', { ownerUid: 'target' });
  const exact = await claim(t, 'target', 'complete_5_deliveries');
  assert(exact.ok && exact.receipt.progress === 5, 'Y exact target accepted');
  for (let i = 5; i < 12; i += 1) seedDelivery(t, 'target', `d${i}`, { ownerUid: 'target' });
  const above = await claim(t, 'target', 'complete_10_deliveries');
  assert(above.ok && above.receipt.progress === 12, 'Z above target accepted');

  // AA–AC exact XP
  assert(prog(t, 'target').totalXp === 100 + 200, 'AA mission XP exact');
  const msTarget = CANONICAL_MILESTONE_REWARD_CATALOG.find((row) => row.metric?.kind === 'DELIVERIES_COMPLETED' && row.target === 10)!;
  const msXpBefore = prog(t, 'target').totalXp;
  const msClaim = await claim(t, 'target', msTarget.rewardId);
  assert(msClaim.ok && prog(t, 'target').totalXp === msXpBefore + msTarget.xpReward, 'AB milestone XP exact');
  const wk = await world('weekly');
  const wdef = weekly('delivery');
  for (let i = 0; i < wdef.target; i += 1) seedDelivery(wk, 'weekly', `w${i}`, { ownerUid: 'weekly', completionReportedAtMs: CYCLE.startMs + i });
  const weeklyClaim = await claim(wk, 'weekly', wdef.rewardId);
  assert(weeklyClaim.ok && prog(wk, 'weekly').totalXp === wdef.xpReward, 'AC weekly XP exact');

  // AD progression receipt exact / AE claim receipt exact
  const pr = d.dump.get(canonicalProgressionReceiptPath('deliv', 'progression:reward:mission:first_delivery'))!;
  assert(pr.sourceType === 'CLIENT_REWARD_MISSION' && pr.xpDelta === 50 && pr.requestedReputationDelta === 1 && pr.xpAuthority === 'SERVER_DERIVED', 'AD progression receipt exact');
  assert(JSON.stringify(pr.reputationReasons) === JSON.stringify(['mission-reward']), 'AD reputation reason');
  const cr = d.dump.get('users/deliv/canonicalRewardClaims/reward:mission:first_delivery')!;
  assert(cr.rewardXpPolicyVersion === CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION && cr.xpReward === 50 && cr.progressionOperationId === 'progression:reward:mission:first_delivery', 'AE claim receipt exact');
  assert((cr.cash as Record<string, unknown>).granted === false, 'AE mission cash not granted without authority');

  // AF retry / AG two-device
  for (let i = 0; i < 3; i += 1) await claim(d, 'deliv', 'first_delivery', NOW + 10 + i);
  assert(prog(d, 'deliv').totalXp === 50, 'AF retries add nothing');
  const two = await world('two');
  seedDelivery(two, 'two', 'd1', { ownerUid: 'two' });
  const both = await Promise.all([claim(two, 'two', 'first_delivery', NOW + 1), claim(two, 'two', 'first_delivery', NOW + 2)]);
  assert(both.filter((r) => r.ok && r.application === 'APPLIED').length === 1, 'AG exactly one device applies');
  assert(prog(two, 'two').totalXp === 50 && count(two, 'two', 'canonicalProgressionReceipts') === 1, 'AG no duplicate XP');

  // AH historical 29W claim: no retroactive XP
  const hist = await world('hist');
  seedTruck(hist, 'hist', 't1');
  seedTruck(hist, 'hist', 't2');
  await claimCanonicalLocalRewardTransaction(hist, 'hist', 'own_2_trucks', NOW, { envValue: 'INTERNAL_TEST', clientRewardXpEnvValue: null });
  const histCash = cash(hist, 'hist');
  const histClaim = await claim(hist, 'hist', 'own_2_trucks');
  assert(histClaim.ok && histClaim.application === CLIENT_REWARD_XP_HISTORICAL_CLAIM_UNAPPLIED, 'AH historical claim unapplied');
  assert(prog(hist, 'hist').totalXp === 0 && cash(hist, 'hist') === histCash, 'AH no retroactive XP or cash');

  // AI–AK weekly cycle / reset / boundary
  assert(CYCLE.cycleId === getWeeklySeasonKey(new Date(NOW)), 'AI cycle = production ISO week key on server clock');
  assert(resolveCanonicalWeeklyCycle(CYCLE.endMs - 1).cycleId === CYCLE.cycleId, 'AK last ms in cycle');
  assert(resolveCanonicalWeeklyCycle(CYCLE.endMs).cycleId !== CYCLE.cycleId, 'AK next Monday 00:00 UTC is a new cycle');
  const closed = await claim(wk, 'weekly', wdef.rewardId, CYCLE.endMs);
  assert(!closed.ok && closed.reason === REWARD_CYCLE_NOT_CURRENT, 'AK closed cycle not claimable');
  const next = resolveCanonicalWeeklyCycle(CYCLE.endMs);
  const nextDef = weekly('delivery', next.cycleId);
  const reset = await claim(wk, 'weekly', nextDef.rewardId, next.startMs + 1);
  assert(!reset.ok && reset.reason === REWARD_NOT_ELIGIBLE && reset.progress === 0, 'AJ progress resets with the cycle');

  // AL cash coexistence / AM no unsafe cash write
  assert(cash(p, 'purchase') === cashBeforeTrucks + 3000, 'AL own_2_trucks keeps its 29W cash exactly once');
  const legacyPath = await claimCanonicalLocalRewardTransaction(p, 'purchase', 'own_2_trucks', NOW, { envValue: 'INTERNAL_TEST', clientRewardXpEnvValue: 'INTERNAL_TEST' });
  assert(!legacyPath.ok && legacyPath.reason === CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED, 'AL 29W path defers to the XP claim path');
  assert(cash(d, 'deliv') === 50_000_000 && cash(t, 'target') === 50_000_000 && cash(wk, 'weekly') === 50_000_000, 'AM non-29W rewards write no cash');
  assert(count(d, 'deliv', 'canonicalCashTransactions') === 0, 'AM no cash transaction for mission XP');
  assert(d.dump.get('users/deliv')?.money === 31_337, 'AM public save money untouched');

  // AN reputation per production
  assert(prog(d, 'deliv').reputation === 51, 'AN production mission reputation +1');
  assert(prog(wk, 'weekly').reputation === 50 + (wdef.reputationReward ?? 0), 'AN weekly reputation per production reward');

  // AO level-up / AP existing batch / AQ next refresh
  const lv = createMemoryFirestore();
  const gates = { envValue: 'INTERNAL_TEST', runtimeEnvValue: 'INTERNAL_TEST', eventEnvValue: 'INTERNAL_TEST', expiryEnvValue: 'INTERNAL_TEST', refreshEnvValue: 'INTERNAL_TEST', progressionEnvValue: 'INTERNAL_TEST' } as const;
  seedIssuanceWorld(lv, 'levelup');
  lv.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  seedAccount(lv, 'levelup');
  await initializeCanonicalCompanyProgressionForNewAccount(lv, 'levelup', NOW, { envValue: 'INTERNAL_TEST' });
  const batch = await generateCanonicalProductionRoadBatchTransaction(lv, 'levelup', NOW, gates);
  const lvState = prog(lv, 'levelup');
  lv.dump.set(canonicalCompanyProgressionPath('levelup'), { ...lvState, xp: lvState.xpToNextLevel - 5, totalXp: lvState.xpToNextLevel - 5 });
  for (let i = 0; i < 10; i += 1) seedDelivery(lv, 'levelup', `d${i}`, { ownerUid: 'levelup' });
  const expected = applyCanonicalCompanyXp(prog(lv, 'levelup'), 200);
  await claim(lv, 'levelup', 'complete_10_deliveries');
  assert(prog(lv, 'levelup').level === expected.level && expected.level >= 2 && prog(lv, 'levelup').xp === expected.xp, 'AO level-up exact');
  if (batch.ok) {
    assert(lv.dump.get(`users/levelup/canonicalRoadContractBatches/${batch.batchId}`)?.playerLevel === 1, 'AP existing batch frozen');
    const refreshed = await generateCanonicalProductionRoadBatchTransaction(lv, 'levelup', NOW + 3 * HOUR_MS, { ...gates, refreshIntentId: 'rg-refresh-1' });
    assert(refreshed.ok && lv.dump.get(`users/levelup/canonicalRoadContractBatches/${refreshed.batchId}`)?.playerLevel === expected.level, 'AQ next refresh uses new level');
  } else {
    assert(false, `AP batch ${batch.reason}`);
  }

  // AR 29AH operational XP / AS 29AG delivery XP unchanged
  assert(levelBalance.xpRewards.truckPurchase === 30 && levelBalance.xpRewards.driverHire === 10, 'AR operational XP constants unchanged');
  assert(p.dump.get(canonicalProgressionReceiptPath('purchase', 'progression:truck-purchase:rgtruck01'))?.xpDelta === 30, 'AR 29AH purchase XP still applied');
  const deliveryXp = deriveCanonicalRoadCompletionXp({ distanceKm: 450, netProfit: 12_000, riskTier: 'medium' });
  assert(deliveryXp.ok && deliveryXp.xp === calculateDeliveryXp(450, 12_000, 'medium'), 'AS delivery XP unchanged');
  const rep = deriveCanonicalRoadCompletionReputation({ band: 'ON_TIME', actualTravelHours: 10, deadlineHours: 20, plannedTravelGameHours: 10, contractType: 'standard' });
  assert(rep.ok && rep.delta === REPUTATION_RULES.deliveryOnTime, 'AS ROAD reputation unchanged');

  // AT–BA invariants
  assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AT cashAuthorityVersion 0');
  assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AU HUD overlay off');
  assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AV cash listener off');
  assert(
    canUseServerAuthoritativeSettlement({
      signedInLinked: true,
      cashAuthorityVersion: 0,
      serverStateCashPresent: true,
      reconciliationActive: true,
      staleSaveProtectionActive: true,
    }).ready === false,
    'AW settlement false',
  );
  const coverage = getSignedInCashAuthorityCoverage();
  assert(coverage.criticalSignedInCashPathsTotal === 24, 'AX coverage total 24');
  assert(coverage.criticalCanonicalizedCount === 0, 'AX coverage canonical 0');
  assert(coverage.criticalBlockedCount === 24, 'AX coverage blocked 24');
  assert(SAVE_GAME_VERSION === 6, 'AY SAVE_GAME_VERSION 6');
  assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AZ rail');
  assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AZ sea');
  assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AZ air');
  assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BA multimodal off');

  // readiness + rules
  assert(CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS === 'CANONICAL_CLIENT_REWARD_XP_AUTHORITY_PASS_PARTIAL', 'status PASS_PARTIAL');
  assert(CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS === 'CLIENT_REWARD_XP_INTERNAL_PARTIAL', 'internal readiness partial');
  assert(CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS === 'CLIENT_REWARD_XP_BLOCKED_LEGACY_HISTORY', 'public readiness legacy history');
  assert(CANONICAL_PROGRESSION_READINESS === 'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS', 'progression readiness');
  assert(CANONICAL_PROGRESSION_REMAINING_BLOCKERS.length === 4, 'progression blockers');
  assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'issuance readiness unchanged');
  assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED'), 'issuance blocker narrowed');
  assert(/match \/canonicalRewardClaims\/\{claimId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'rules reward claims server-only');
  assert(/match \/canonicalRewardProgress\/\{progressId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'rules reward progress server-only');
  assert(/match \/canonicalProgressionReceipts\/\{receiptId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'rules progression receipts server-only');

  if (fail > 0) {
    console.error(`\nFAILED ${fail} / ${pass + fail}`);
    process.exit(1);
  }
  console.log(`OK ${pass} assertions`);
  console.log(
    JSON.stringify({
      CANONICAL_CLIENT_REWARD_XP_AUTHORITY_STATUS,
      CLIENT_REWARD_XP_POLICY: CANONICAL_CLIENT_REWARD_XP_POLICY_VERSION,
      MISSIONS: CANONICAL_MISSION_REWARD_COVERAGE,
      MILESTONES: CANONICAL_MILESTONE_REWARD_COVERAGE,
      WEEKLY: CANONICAL_WEEKLY_REWARD_COVERAGE,
      INTERNAL_READINESS: CANONICAL_CLIENT_REWARD_XP_INTERNAL_READINESS,
      PUBLIC_READINESS: CANONICAL_CLIENT_REWARD_XP_PUBLIC_READINESS,
      PROGRESSION_READINESS: CANONICAL_PROGRESSION_READINESS,
      ISSUANCE_READINESS: ROAD_CONTRACT_ISSUANCE_READINESS,
      CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
      CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
      CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    }),
  );
}

void main();
