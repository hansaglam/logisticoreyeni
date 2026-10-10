/**
 * Map V2 Step 29D unified signed-in cash authority (blocked: ROAD not server-canonical).
 * Run: npx tsx scripts/map-v2-unified-cash-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  ARBITRARY_CLIENT_CASH_DELTA_API,
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_SERVER_STATE_V1,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
  GUEST_CASH_AUTHORITY,
  GUEST_TO_SIGNED_IN_CASH_MIGRATION,
  getCashAuthority,
  PRODUCTION_CASH_WRITE_AUDIT,
  PROFILE_MONEY_AUTHORITY,
  SIGNED_IN_CASH_AUTHORITY_TARGET,
  SIGNED_IN_CASH_PATH,
  SIGNED_IN_OFFLINE_CASH_POLICY,
  simulateAuthoritativeCashWins,
  UNIFIED_CASH_BLOCK_REASON,
  UNIFIED_SIGNED_IN_CASH_AUTHORITY_STATUS,
} from '../src/domain/cashAuthority';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { applyCashTransaction } from '../src/utils/cashPolicy';

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

console.log('\n=== Map V2 Unified Signed-In Cash Authority (Step 29D) ===\n');

const store = read('src/store/gameStore.ts');
const rules = read('firestore.rules');
const index = read('backend/src/index.ts');
const cloud = read('src/services/cloudSaveService.ts');
const moneySync = read('src/services/testMoneySyncService.ts');
const policy = read('src/domain/cashAuthority.ts');

assert(UNIFIED_SIGNED_IN_CASH_AUTHORITY_STATUS === 'UNIFIED_SIGNED_IN_CASH_AUTHORITY_BLOCKED_ROAD_ECONOMY', 'status');
assert(GUEST_CASH_AUTHORITY === 'LOCAL_SAVE_PLAYER_MONEY', 'A guest authority constant');
assert(SIGNED_IN_CASH_AUTHORITY_TARGET === 'SERVER_STATE_CASH', 'B target serverState');
assert(PROFILE_MONEY_AUTHORITY === 'NONE', 'C profile not authoritative');
assert(SIGNED_IN_CASH_PATH === 'users/{uid}/serverState/current.cash', 'G path');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'H unmigrated version');
assert(CASH_AUTHORITY_VERSION_SERVER_STATE_V1 === 1, 'H v1 defined not rolled out');

const guest = getCashAuthority({ signedInLinked: false });
assert(guest.mode === 'LOCAL_GUEST_AUTHORITY', 'A resolver guest');
assert(guest.savePlayerMoneyRole === 'LOCAL_AUTHORITY', 'P guest save authority');
assert(guest.overlayEnabled === false, 'guest no overlay');

const signedIn = getCashAuthority({ signedInLinked: true });
assert(signedIn.mode === 'SIGNED_IN_ROAD_LOCAL_SAVE_AUTHORITY', 'B current signed-in is ROAD local');
assert(signedIn.blockReason === UNIFIED_CASH_BLOCK_REASON, 'B ROAD not canonical');
assert(signedIn.cashAuthorityVersion === 0, 'N migration marker absent');
assert(signedIn.profileMoneyRole === 'NONE', 'C resolver profile');
assert(signedIn.overlayEnabled === false, 'E save not treated as cache yet');

assert(rules.includes('match /serverState/{documentId}'), 'D serverState match');
assert(/match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/.test(rules), 'Y client cannot write serverState');
assert(rules.includes('match /canonicalMultimodalShipments/{shipmentId}'), 'Z 29C collection remains');
assert(/match \/canonicalMultimodalShipments\/\{shipmentId\}[\s\S]*?allow write: if false/.test(rules), 'Y multimodal write false');

assert(cloud.includes('saves/current') || cloud.includes("saves/' +") || cloud.includes('saves/current'), 'O cloud save path');
assert(cloud.includes('omitMoney = isTestMoneySyncEnabled()'), 'L TEST_MONEY_SYNC isolated omit');
assert(moneySync.includes('TEST-ONLY'), 'L test money not production');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'M no production cash listener');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'H overlay off');
assert(!store.includes('subscribeAuthoritativeCash'), 'M no HUD serverState listener');
assert(ARBITRARY_CLIENT_CASH_DELTA_API === false, 'X no arbitrary delta flag');
assert(!index.includes('export const applyCanonicalCashTransaction'), 'X no generic cash callable');
assert(!index.includes('export const updateCash'), 'X no updateCash');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'AB no multimodal settlement');

const low = simulateAuthoritativeCashWins({ saveMoney: 20_000, serverCash: 20_743 });
assert(low.serverUnchanged === 20_743, 'F server cash unchanged by low save');
assert(low.displayed === 20_000 && low.overlayApplied === false, 'F overlay not pretending HUD is 20743');
const high = simulateAuthoritativeCashWins({ saveMoney: 999_999, serverCash: 20_743 });
assert(high.serverUnchanged === 20_743, 'G high save cannot write server in simulation');
assert(high.displayed === 999_999 && high.overlayApplied === false, 'G overlay off so HUD still save (honest BLOCK)');
const futureLow = simulateAuthoritativeCashWins({
  saveMoney: 20_000,
  serverCash: 20_743,
  overlayEnabled: true,
});
assert(futureLow.displayed === 20_743 && futureLow.serverUnchanged === 20_743, 'future low overlay');
const futureHigh = simulateAuthoritativeCashWins({
  saveMoney: 999_999,
  serverCash: 20_743,
  overlayEnabled: true,
});
assert(futureHigh.displayed === 20_743, 'future high overlay');

assert(SAVE_GAME_VERSION === 6, 'AC SAVE_GAME_VERSION 6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AD RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AD SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AD AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AE default OFF');

assert(store.includes('completeDeliveryById'), 'Q ROAD revenue path');
assert(store.includes("referenceId: `delivery:${deliveryId}:revenue`"), 'Q ROAD ledger id');
assert(store.includes('failDeliveryById'), 'Q fail path');
assert(store.includes('refuelTruck'), 'U fuel');
assert(store.includes('buyTruck'), 'T purchase');
assert(store.includes('buyProductForWarehouse'), 'V market buy');
assert(store.includes('sellProductFromWarehouse'), 'V market sell');
assert(store.includes('processDailyOperatingCosts'), 'V daily opex');
assert(store.includes('applyCashTransaction'), 'AB local cash API');
assert(read('src/utils/cashPolicy.ts').includes('export function applyCashTransaction'), 'AB cashPolicy');

assert(index.includes('export const acceptCanonicalMultimodalShipment'), 'Z accept unchanged');
assert(index.includes('export const reportCanonicalMultimodalShipmentCompleted'), 'AA complete unchanged');
assert(index.includes('export const cancelCanonicalMultimodalShipment'), 'AA cancel unchanged');
assert(GUEST_TO_SIGNED_IN_CASH_MIGRATION === 'GUEST_TO_SIGNED_IN_CASH_MIGRATION_DEFERRED', 'AH guest merge deferred');
assert(
  SIGNED_IN_OFFLINE_CASH_POLICY.includes('ROAD_LOCAL_CASH_MUTATIONS_REMAIN_ALLOWED'),
  'S offline ROAD remains allowed',
);

const gateGuest = canUseServerAuthoritativeSettlement({ signedInLinked: false });
assert(!gateGuest.ready && gateGuest.reason === 'GUEST_LOCAL_AUTHORITY', 'AK guest gate');
const gateSigned = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: CASH_AUTHORITY_VERSION_SERVER_STATE_V1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gateSigned.ready && gateSigned.reason === UNIFIED_CASH_BLOCK_REASON, 'AK signed-in gate blocked even if flags spoofed');

assert(PRODUCTION_CASH_WRITE_AUDIT.length >= 20, 'audit catalog size');
assert(
  PRODUCTION_CASH_WRITE_AUDIT.every((row) =>
    ['REVENUE', 'EXPENSE', 'TRANSFER', 'ADMIN_TEST', 'LEGACY_PROFILE_MIRROR'].includes(row.classification),
  ),
  'all classified',
);

const requiredStoreTokens = [
  'completeDeliveryById',
  'failDeliveryById',
  'refuelTruck',
  'buyTruck',
  'buyTrailer',
  'leaseTruck',
  'hireDriver',
  'sellTruck',
  'fireDriver',
  'repairTruck',
  'upgradeTruck',
  'openWarehouse',
  'upgradeWarehouse',
  'buyProductForWarehouse',
  'sellProductFromWarehouse',
  'claimMissionReward',
  'claimMilestoneReward',
  'claimWeeklyObjectiveReward',
  'processDailyOperatingCosts',
  'debugAddCash',
  'debugSetCash',
  'settleRailMultimodalShipmentInternal',
  'applyVehicleMarketplaceReconciliation',
];
for (const token of requiredStoreTokens) {
  assert(store.includes(token), `audit live path ${token}`);
}

assert(index.includes('purchaseVehicleListing'), 'marketplace purchase callable');
assert(read('backend/src/weeklyMissions.ts').includes('canonicalCash'), 'weekly cash');
assert(read('backend/src/seasonRewards.ts').includes('canonicalCash'), 'season cash');
assert(read('backend/src/challenges.ts').includes('canonicalCash'), 'challenge cash');
assert(read('backend/src/serverState.ts').includes('buildBoundedLegacyMigrationFromCloudSave'), 'K bootstrap exists');
assert(read('backend/src/serverState.ts').includes('SERVER_DEFAULT_CASH = 20_000'), 'O default 20k not HUD reset');
assert(!policy.includes('export const settleCanonicalMultimodalShipment'), 'no settle in policy');

const localIncome = applyCashTransaction({
  currentCash: 20_000,
  amount: 500,
  kind: 'income',
  referenceId: 'delivery:test:revenue',
  transactionId: 'delivery:test:revenue',
});
assert(localIncome.ok && localIncome.cashAfter === 20_500, 'Q local ROAD-shaped income still works');
const fuel = applyCashTransaction({
  currentCash: 20_500,
  amount: 80,
  kind: 'voluntary-expense',
  referenceId: 'fuel:test',
  transactionId: 'fuel:test',
});
assert(fuel.ok && fuel.cashAfter === 20_420, 'U local fuel debit still works');

assert(read('docs/architecture/map-v2/MAP_V2_UNIFIED_SIGNED_IN_CASH_AUTHORITY.md').includes('BLOCKED_ROAD_ECONOMY'), 'docs');
assert(
  read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('BLOCKED_ROAD_ECONOMY'),
  'migration plan',
);

assert(!read('src/domain/cashAuthority.ts').includes('from \'firebase'), 'pure domain no firebase');
assert(!read('src/domain/cashAuthority.ts').includes('react'), 'pure domain no react import');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
