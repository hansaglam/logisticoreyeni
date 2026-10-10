/**
 * Map V2 Step 29P remaining ROAD cash path canonicalization.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-remaining-road-cash-path-canonicalization-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED,
  ROAD_CASH_CANONICALIZATION_MATRIX,
} from '../src/domain/canonicalCashOperation';
import {
  ARBITRARY_CLIENT_CASH_DELTA_API,
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  CATALOG_PURCHASE_NOT_CANONICAL,
  FUEL_NOT_CANONICAL,
  PRODUCTION_CASH_WRITE_AUDIT,
  PROFILE_MONEY_AUTHORITY,
  ROAD_CASH_PATHS_NOT_FULLY_CANONICAL,
  SIGNED_IN_CASH_PATH_DIAGNOSTIC_REASONS,
  UNIFIED_CASH_BLOCK_REASON,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import {
  AD_REWARD_CASH_STATUS,
  CARGO_BUY_CASH_STATUS,
  CARGO_SELL_CASH_STATUS,
  CATALOG_TRAILER_PURCHASE_STATUS,
  CATALOG_TRUCK_PURCHASE_STATUS,
  DAILY_OPEX_CASH_STATUS,
  DRIVER_FIRE_CASH_STATUS,
  DRIVER_HIRE_CASH_STATUS,
  FUEL_CASH_AUTHORITY_STATUS,
  INCIDENT_CASH_STATUS,
  LEASE_CASH_STATUS,
  MARKETPLACE_CASH_STATUS,
  MILESTONE_REWARD_CASH_STATUS,
  MISSION_REWARD_CASH_STATUS,
  REMAINING_ROAD_CASH_PATH_CANONICALIZATION_STATUS,
  SERVER_CLAIM_CASH_STATUS,
  SIGNED_IN_CASH_AUTHORITY_READINESS,
  VEHICLE_RECOVERY_CASH_STATUS,
  VEHICLE_SALE_CASH_STATUS,
  WAREHOUSE_OPEN_CASH_STATUS,
  WAREHOUSE_UPGRADE_CASH_STATUS,
  WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS,
  createCanonicalCatalogPurchaseTransactionId,
  deriveCanonicalCatalogPurchasePrice,
  hasOnlyCanonicalCatalogPurchaseKeys,
} from '../src/domain/remainingRoadCashPathCanonicalization';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';

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

console.log('\n=== Map V2 Remaining ROAD Cash Path Canonicalization (Step 29P) ===\n');

assert(
  REMAINING_ROAD_CASH_PATH_CANONICALIZATION_STATUS ===
    'REMAINING_ROAD_CASH_PATH_CANONICALIZATION_PASS_FOUNDATION',
  'foundation status',
);

const coverage = getSignedInCashAuthorityCoverage();
const auditIds = PRODUCTION_CASH_WRITE_AUDIT.map((row) => row.id);
const matrixIds = ROAD_CASH_CANONICALIZATION_MATRIX.map((row) => row.auditId);
const coverageIds = coverage.rows.map((row) => row.auditId);

assert(auditIds.every((id) => coverageIds.includes(id)), 'A every audit in coverage');
assert(coverageIds.every((id) => auditIds.includes(id)), 'A coverage 1:1 audit');
assert(auditIds.every((id) => matrixIds.includes(id)), 'A matrix 1:1');
assert(!coverage.rows.some((row) => row.exactStatus.includes('UNKNOWN')), 'B no UNKNOWN');
assert(
  coverage.rows.every(
    (row) =>
      row.hudRole === 'BLOCKS_HUD_AUTHORITY' || row.hudRole === 'CAN_REMAIN_LEGACY_LOCAL_ONLY',
  ),
  'C blocking/non-blocking',
);

const index = read('backend/src/index.ts');
assert(!index.includes('export const applyCashDelta'), 'D no applyCashDelta');
assert(!index.includes('export const setCash('), 'D no setCash');
assert(!index.includes('export const updateMoney'), 'D no updateMoney');
assert(ARBITRARY_CLIENT_CASH_DELTA_API === false, 'D no arbitrary delta');

assert(read('src/store/gameStore.ts').includes('Guests'), 'E guest path remains');
assert(read('src/store/gameStore.ts').includes('buyTruck:'), 'E public buyTruck');
assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'E complete local');
assert(!read('src/store/gameStore.ts').includes('purchaseCanonicalCatalogAsset'), 'L no public wiring');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'G overlay off');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'H listener off');
assert(!read('src/store/gameStore.ts').includes('subscribeAuthoritativeCash'), 'H no listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'I unmigrated');
assert(ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED === 0, 'I account unmigrated');

const rules = read('firestore.rules');
assert(/match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/.test(rules), 'J serverState write false');
assert(PROFILE_MONEY_AUTHORITY === 'NONE', 'K profile money not authority');
assert(read('backend/src/canonicalCashTransaction.ts').includes('Not an HTTPS'), 'L helper internal');

assert(FUEL_CASH_AUTHORITY_STATUS === 'FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED', 'M fuel');
assert(
  coverage.rows.find((row) => row.auditId === 'road-fuel')?.exactStatus === FUEL_CASH_AUTHORITY_STATUS,
  'M fuel row',
);
assert(CATALOG_TRUCK_PURCHASE_STATUS.includes('INTERNAL_TEST'), 'N truck');
assert(CATALOG_TRAILER_PURCHASE_STATUS.includes('INTERNAL_TEST'), 'O trailer');
assert(VEHICLE_RECOVERY_CASH_STATUS === 'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE', 'P recovery');
assert(DRIVER_HIRE_CASH_STATUS === 'DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY', 'Q hire');
assert(DRIVER_FIRE_CASH_STATUS === 'DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER', 'Q fire');
assert(WAREHOUSE_OPEN_CASH_STATUS === 'WAREHOUSE_INTERNAL_CANONICAL_ONLY', 'R open');
assert(WAREHOUSE_UPGRADE_CASH_STATUS === 'WAREHOUSE_INTERNAL_CANONICAL_ONLY', 'R upgrade');
assert(CARGO_BUY_CASH_STATUS === 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'S buy');
assert(CARGO_SELL_CASH_STATUS === 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'S sell');
assert(DAILY_OPEX_CASH_STATUS.includes('BLOCKED'), 'T opex');
assert(AD_REWARD_CASH_STATUS === 'AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION', 'U ads');
assert(MISSION_REWARD_CASH_STATUS === 'MISSION_INTERNAL_CANONICAL_STATE_ONLY', 'V mission');
assert(MILESTONE_REWARD_CASH_STATUS === 'MILESTONE_INTERNAL_CANONICAL_STATE_ONLY', 'W milestone');
assert(WEEKLY_LOCAL_OBJECTIVE_CASH_STATUS.includes('BLOCKED'), 'W weekly local');
assert(LEASE_CASH_STATUS === 'LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'X lease');
assert(VEHICLE_SALE_CASH_STATUS === 'VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'Y sale');
assert(MARKETPLACE_CASH_STATUS === 'MARKETPLACE_SERVER_CANONICAL_HUD_UNMIGRATED', 'Z marketplace');
assert(INCIDENT_CASH_STATUS.includes('PRODUCTION_CLIENT'), 'X incident cash classified');
assert(SERVER_CLAIM_CASH_STATUS.includes('CANONICAL'), 'Y server claims');

const txnId = createCanonicalCatalogPurchaseTransactionId('cfa_catalog_purchase-aa', 'purchase-aa');
assert(txnId === 'fleet:cfa_catalog_purchase-aa:purchase:purchase-aa', 'AA deterministic id');
assert(!txnId.match(/^\d+$/), 'AA not timestamp-only');

assert(
  read('backend/src/canonicalCatalogPurchase.ts').includes('alreadyApplied'),
  'AB idempotent',
);
assert(
  read('backend/src/canonicalCatalogPurchase.ts').includes('applyCanonicalCashMutationsInTransaction'),
  'AC atomic cash+asset',
);
assert(
  read('backend/test/canonicalCatalogPurchase.unit.test.ts').includes('users/uid-a') &&
    read('backend/test/canonicalCatalogPurchase.unit.test.ts').includes('money: 77_000'),
  'AD shadow does not treat profile as mutated authority',
);
assert(read('src/domain/canonicalCashOperation.ts').includes('financeLedger') === false, 'AE ledger not authority module');
assert(
  coverage.rows.every((row) => row.currentAuthority !== 'financeLedger'),
  'AE financeLedger not authority',
);

const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false, 'AF settlement false');
assert(gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AF reason');
assert(gate.cashPathReason === ROAD_CASH_PATHS_NOT_FULLY_CANONICAL, 'AF cash path reason');
assert(SIGNED_IN_CASH_PATH_DIAGNOSTIC_REASONS.includes(FUEL_NOT_CANONICAL), 'AF fuel diagnostic');
assert(SIGNED_IN_CASH_PATH_DIAGNOSTIC_REASONS.includes(CATALOG_PURCHASE_NOT_CANONICAL), 'AF catalog diagnostic');

assert(SAVE_GAME_VERSION === 6, 'AG v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AH RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AH SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AH AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AI OFF');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'no multimodal settle');

assert(typeof getSignedInCashAuthorityCoverage === 'function', 'AM helper');
assert(coverage.criticalBlockedCount > 0, 'AN blockers remain');
assert(coverage.readiness === SIGNED_IN_CASH_AUTHORITY_READINESS, 'AO blocked multiple');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'AO exact');

assert(
  !hasOnlyCanonicalCatalogPurchaseKeys({
    catalogModelId: 'truck-ford-cargo',
    purchaseId: 'purchase01',
    assetType: 'TRUCK',
    canonicalSchemaVersion: 1,
    price: 1,
  }),
  'client price rejected',
);
const derived = deriveCanonicalCatalogPurchasePrice('truck-ford-cargo', 'TRUCK');
assert(derived.ok && derived.price === 52_000, 'server catalog price');

assert(coverage.criticalCanonicalizedCount === 0, 'critical HUD paths not fully canonical');
assert(coverage.criticalSignedInCashPathsTotal === coverage.criticalBlockers.length, 'critical set');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    readiness: coverage.readiness,
  }),
);
