/**
 * Step 29AN — canonical progression eligibility authority.
 * Run: node --import tsx scripts/map-v2-canonical-progression-eligibility-authority-regression-test.ts
 */
import './test-globals';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canOpenMoreWarehouses,
  isWarehouseCityUnlocked,
} from '../src/config/levelConfig';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV,
  CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_STATUS,
  CANONICAL_PROGRESSION_ELIGIBILITY_POLICY_VERSION,
  CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE,
  PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY,
  PROGRESSION_ELIGIBILITY_READINESS,
  isCanonicalProgressionEligibilityAllowed,
  resolveProgressionEligibilityAuthority,
  type EffectiveProgressionEligibility,
} from '../src/domain/canonicalProgressionEligibility';
import {
  CANONICAL_PROGRESSION_READ_AUTHORITY_ENV,
  type EffectiveCompanyProgression,
} from '../src/domain/canonicalProgressionReadAuthority';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { resolveTruckMarketRequiredLevel, TRUCK_MARKET } from '../src/data/trucks';
import {
  buildPlayerProgressionSnapshot,
  evaluateRequirement,
} from '../src/mapV2/gameplay/cityProgression';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const eligibility = read('src/domain/canonicalProgressionEligibility.ts');
const reader = read('src/services/canonicalProgressionEligibility.ts');
const subscription = read('src/services/canonicalProgressionService.ts');
const shop = read('src/screens/ShopScreen.tsx');
const warehouse = read('src/screens/WarehouseScreen.tsx');
const warehouseModel = read('src/utils/warehouseScreenViewModel.ts');
const mapV2 = read('src/mapV2/screens/MapV2WorldScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const tabBar = read('src/components/navigation/GameTabBar.tsx');
const mapScreen = read('src/screens/MapScreen.tsx');
const assignment = read('src/components/ContractAssignmentModal.tsx');
const quick = read('src/components/contracts/ContractQuickActionSheet.tsx');
const ads = read('src/components/monetization/AdRewardButton.tsx');
const daily = read('src/components/monetization/DashboardDailyOpsBonusCard.tsx');
const boost = read('src/components/monetization/DeliveryBoostPanel.tsx');
const gameStore = read('src/store/gameStore.ts');

const previousEligibility = process.env[CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV];
const previousRead = process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
delete process.env[CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV];
delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];

const lockedTruck = TRUCK_MARKET.find((item) => item.requiredLevel >= 7);
assert.ok(lockedTruck, 'shop catalog fixture');

function projection(partial: Partial<EffectiveCompanyProgression> & Pick<EffectiveCompanyProgression, 'status' | 'authorityClass' | 'source'>): EffectiveCompanyProgression {
  return {
    level: null,
    xp: null,
    xpToNextLevel: null,
    totalXp: null,
    reputation: null,
    revision: null,
    reason: null,
    ...partial,
  };
}

function decide(
  eligibilityGateEnabled: boolean,
  progression: EffectiveCompanyProgression,
  localLevel = 30,
  localReputation = 100,
): EffectiveProgressionEligibility {
  return resolveProgressionEligibilityAuthority({
    eligibilityGateEnabled,
    progression,
    localLevel,
    localReputation,
  });
}

assert.equal(isCanonicalProgressionEligibilityAllowed(), false, 'A gate default off');
assert.equal(
  isCanonicalProgressionEligibilityAllowed({ envValue: 'INTERNAL_TEST', readGateEnabled: false }),
  false,
  'A eligibility requires read gate',
);
assert.equal(
  isCanonicalProgressionEligibilityAllowed({ envValue: 'INTERNAL_TEST', readGateEnabled: true }),
  true,
  'A both gates',
);

const guestProgression = projection({
  status: 'ready',
  authorityClass: 'GUEST_LOCAL',
  source: 'LOCAL_GUEST',
  level: 4,
  reputation: 40,
});
const guest = decide(true, guestProgression, 4, 40);
assert.equal(guest.level, 4, 'B guest level');
assert.equal(guest.reputation, 40, 'B guest reputation');
assert.equal(guest.canEvaluate, true, 'B guest evaluates');
const guestLater = decide(true, { ...guestProgression, level: 6, reputation: 41 }, 6, 41);
assert.equal(guestLater.level, 6, 'B guest follows local change');

const legacy = decide(
  true,
  projection({
    status: 'ready',
    authorityClass: 'SIGNED_IN_LEGACY_LOCAL',
    source: 'LOCAL_LEGACY',
    level: 8,
    reputation: 55,
  }),
  8,
  55,
);
assert.equal(legacy.level, 8, 'C legacy level');
assert.equal(legacy.reputation, 55, 'C legacy reputation');

const canonical = projection({
  status: 'ready',
  authorityClass: 'SIGNED_IN_CANONICAL_SERVER',
  source: 'CANONICAL_SERVER',
  level: 5,
  reputation: 60,
  revision: 3,
});
const migrated = decide(true, canonical);
assert.equal(migrated.level, 5, 'D canonical level');
assert.equal(migrated.reputation, 60, 'E canonical reputation');
const requiredShopLevel = resolveTruckMarketRequiredLevel(lockedTruck!);
assert.equal(migrated.level! < requiredShopLevel, true, 'D shop lock at canonical 5');
assert.equal(30 < requiredShopLevel, false, 'local 30 would unlock the same truck');
assert.equal(isWarehouseCityUnlocked('diyarbakir', migrated.level!), false, 'P warehouse city locked at 5');
assert.equal(isWarehouseCityUnlocked('diyarbakir', 30), true, 'local 30 would unlock diyarbakir');
assert.equal(canOpenMoreWarehouses(migrated.level!, 3), false, 'P slot blocked at canonical 5');
assert.equal(canOpenMoreWarehouses(30, 3), true, 'local 30 would open another warehouse');

const tamper = decide(true, canonical, 30, 100);
assert.equal(tamper.level, 5, 'F local level tamper ignored');
assert.equal(tamper.reputation, 60, 'G local reputation tamper ignored');

const updated = decide(true, { ...canonical, level: 6, reputation: 61, revision: 4 });
assert.equal(updated.level, 6, 'H canonical level update');
assert.equal(updated.reputation, 61, 'H canonical reputation update');
const unlocked = decide(true, { ...canonical, level: 9, reputation: 70, revision: 5 });
assert.equal(unlocked.level! < requiredShopLevel, false, 'H shop unlocks when canonical level passes the requirement');
assert.equal(isWarehouseCityUnlocked('diyarbakir', unlocked.level!), true, 'H warehouse city unlocks at canonical 9');

const afterLocalWrite = decide(true, canonical, 11, 74);
assert.equal(afterLocalWrite.level, 5, 'I local post-cutover level ignored');
assert.equal(afterLocalWrite.reputation, 60, 'I local post-cutover reputation ignored');

const loading = decide(
  true,
  projection({ status: 'loading', authorityClass: 'SIGNED_IN_CANONICAL_LOADING', source: 'UNAVAILABLE', reason: 'CANONICAL_PROGRESSION_LOADING' }),
);
assert.equal(loading.canEvaluate, false, 'J loading');
assert.equal(loading.level, null, 'J no local level');
assert.equal(loading.reputation, null, 'J no local reputation');
assert.equal(loading.reason, 'DISABLED_LOADING', 'J reason');

const unavailable = decide(
  true,
  projection({ status: 'unavailable', authorityClass: 'SIGNED_IN_CANONICAL_UNAVAILABLE', source: 'UNAVAILABLE', reason: 'CANONICAL_PROGRESSION_INVALID' }),
);
assert.equal(unavailable.canEvaluate, false, 'K unavailable');
assert.equal(unavailable.level, null, 'K no local fallback');
assert.equal(unavailable.reason, 'ELIGIBILITY_UNAVAILABLE', 'K reason');

const cached = decide(
  true,
  projection({
    status: 'ready',
    authorityClass: 'SIGNED_IN_CANONICAL_SERVER',
    source: 'CANONICAL_CACHE',
    level: 5,
    reputation: 60,
  }),
);
assert.equal(cached.source, 'CANONICAL_CACHE', 'L cache source');
assert.equal(cached.level, 5, 'L cached level');
assert.equal(isWarehouseCityUnlocked('diyarbakir', cached.level!), false, 'L cache does not use local 30');

const userA = decide(true, canonical);
const userB = decide(
  true,
  projection({ status: 'loading', authorityClass: 'SIGNED_IN_CANONICAL_LOADING', source: 'UNAVAILABLE' }),
  3,
  20,
);
assert.equal(userA.level, 5, 'M user A');
assert.equal(userB.level, null, 'M switch does not keep A');
const userBLegacy = decide(
  true,
  projection({
    status: 'ready',
    authorityClass: 'SIGNED_IN_LEGACY_LOCAL',
    source: 'LOCAL_LEGACY',
    level: 3,
    reputation: 20,
  }),
  3,
  20,
);
assert.equal(userBLegacy.level, 3, 'M user B local');

const signedOut = decide(
  true,
  projection({ status: 'ready', authorityClass: 'GUEST_LOCAL', source: 'LOCAL_GUEST', level: 2, reputation: 10 }),
  2,
  10,
);
assert.equal(signedOut.level, 2, 'N sign-out guest level');
assert.equal(signedOut.source, 'LOCAL_GUEST', 'N guest source');

const gateOff = decide(false, canonical, 30, 100);
assert.equal(gateOff.level, 30, 'gate off uses local level');
assert.equal(gateOff.reputation, 100, 'gate off uses local reputation');

const snapshotAt5 = buildPlayerProgressionSnapshot({
  homeCityId: 'izmir',
  level: migrated.level,
  reputation: migrated.reputation,
  money: 0,
  warehouses: [],
  trucks: [],
  deliveries: [],
});
assert.equal(
  evaluateRequirement({ type: 'PLAYER_LEVEL', level: 8 }, snapshotAt5, new Set()),
  false,
  'Q map level requirement uses canonical 5',
);
assert.equal(
  evaluateRequirement({ type: 'REPUTATION', value: 80 }, snapshotAt5, new Set()),
  false,
  'Q map reputation requirement uses canonical 60',
);
const snapshotAtLocal = buildPlayerProgressionSnapshot({
  homeCityId: 'izmir',
  level: 30,
  reputation: 100,
  money: 0,
  warehouses: [],
  trucks: [],
  deliveries: [],
});
assert.equal(evaluateRequirement({ type: 'PLAYER_LEVEL', level: 8 }, snapshotAtLocal, new Set()), true, 'local map would pass');

assert.match(warehouseModel, /lockProgressionEligibility \? false : canOpenMoreWarehouses/);
assert.match(warehouseModel, /lockProgressionEligibility \? false : isWarehouseCityUnlocked/);
assert.match(warehouse, /lockProgressionEligibility: !progressionEligibility\.canEvaluate/);

assert.match(shop, /resolveProgressionEligibilityAuthority/);
assert.match(shop, /playerLevel/);
assert.match(warehouse, /lockProgressionEligibility/);
assert.match(mapV2, /resolveProgressionEligibilityAuthority/);
assert.match(gameStore, /requireClientProgressionLevel/);
assert.match(gameStore, /Bu sözleşme için şirket seviyen/);
assert.match(gameStore, /const playerLevel = Math\.max\(1, state\.player\.level \?\? state\.player\.companyLevel \?\? 1\);/);
assert.doesNotMatch(contracts, /canonicalProgressionEligibility/);
assert.match(contracts, /selectPlayerLevel/);
assert.doesNotMatch(tabBar, /canonicalProgressionEligibility/);
assert.match(tabBar, /state\.player\.level/);
assert.doesNotMatch(assignment, /canonicalProgressionEligibility/);
assert.doesNotMatch(quick, /canonicalProgressionEligibility/);
assert.doesNotMatch(mapScreen, /canonicalProgressionEligibility/);
assert.doesNotMatch(ads, /canonicalProgressionEligibility/);
assert.match(ads, /state\.player\?\.level/);
assert.doesNotMatch(daily, /canonicalProgressionEligibility/);
assert.doesNotMatch(boost, /canonicalProgressionEligibility/);
assert.doesNotMatch(reader, /onSnapshot|saveGame|useGameStore/);
assert.equal((subscription.match(/onSnapshot/g) ?? []).length, 1, 'W one progression subscription');
assert.doesNotMatch(eligibility, /serverState\.cash|player\.money/);
assert.equal(AUTHORITATIVE_CASH_LISTENER_ENABLED, false, 'Y cash listener');
assert.equal(AUTHORITATIVE_CASH_OVERLAY_ENABLED, false, 'Y cash overlay');
assert.equal(CASH_AUTHORITY_VERSION_UNMIGRATED, 0, 'Z cashAuthorityVersion');
assert.equal(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready,
  false,
  'AA settlement',
);
const coverage = getSignedInCashAuthorityCoverage();
assert.equal(coverage.criticalSignedInCashPathsTotal, 24, 'cash 24');
assert.equal(coverage.criticalCanonicalizedCount, 0, 'cash canonicalized 0');
assert.equal(coverage.criticalBlockedCount, 24, 'cash blocked 24');
assert.equal(SAVE_GAME_VERSION, 6, 'AB save version');
assert.equal(MODE_OPERATIONAL_READINESS.RAIL, 'FOUNDATION_ONLY', 'AC rail');
assert.equal(MODE_OPERATIONAL_READINESS.SEA, 'FOUNDATION_ONLY', 'AC sea');
assert.equal(MODE_OPERATIONAL_READINESS.AIR, 'FOUNDATION_ONLY', 'AC air');
assert.equal(CANONICAL_PROGRESSION_ELIGIBILITY_POLICY_VERSION, 'canonical-progression-eligibility-read-v1');
assert.equal(CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_STATUS, 'CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_PASS_PARTIAL');
assert.equal(PROGRESSION_ELIGIBILITY_READINESS, 'PROGRESSION_ELIGIBILITY_INTERNAL_PARTIAL');
assert.equal(CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE, 'CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE');
assert.equal(PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY, 'PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY');

if (previousEligibility === undefined) delete process.env[CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV];
else process.env[CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV] = previousEligibility;
if (previousRead === undefined) delete process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV];
else process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV] = previousRead;

console.log('map-v2-canonical-progression-eligibility-authority-regression-test: PASS');
