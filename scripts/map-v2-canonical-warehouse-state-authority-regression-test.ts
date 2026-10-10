/**
 * Map V2 Step 29T canonical warehouse state authority.
 * Run: node --import tsx scripts/map-v2-canonical-warehouse-state-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_WAREHOUSE_STATE_AUTHORITY_STATUS,
  CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION,
  CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION,
  LEGACY_WAREHOUSE_AUTHORITY,
  NO_AUTOMATIC_LEGACY_WAREHOUSE_MIGRATION,
  WAREHOUSE_CLOSE_STATUS,
  WAREHOUSE_COMPANY_LEVEL_CLASS,
  WAREHOUSE_INVENTORY_CLASS,
  WAREHOUSE_READINESS_STATUS,
  createCanonicalWarehouseId,
  createCanonicalWarehouseOpenTransactionId,
  deriveCanonicalWarehouseOpenQuote,
  hasOnlyCanonicalWarehouseOpenKeys,
  hasOnlyCanonicalWarehouseUpgradeKeys,
  isCanonicalWarehouseAllowed,
} from '../src/domain/canonicalWarehouseState';
import {
  DAILY_OPEX_READINESS_STATUS,
  OVERDRAFT_OPEX_AUTHORITY,
  WAREHOUSE_OPEX_AUTHORITY,
} from '../src/domain/canonicalDailyOpexStaffState';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { DAILY_OPEX_CASH_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  UNIFIED_CASH_BLOCK_REASON,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { CITIES_BY_ID } from '../src/data/cities';
import { estimateWarehouseOpenCost } from '../src/utils/warehouseCalculations';

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

console.log('\n=== Map V2 Canonical Warehouse State (Step 29T) ===\n');

assert(
  CANONICAL_WAREHOUSE_STATE_AUTHORITY_STATUS ===
    'CANONICAL_WAREHOUSE_STATE_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('openWarehouse:'), 'A public open');
assert(read('src/store/gameStore.ts').includes('upgradeWarehouse:'), 'A public upgrade');
assert(!read('src/store/gameStore.ts').includes('openCanonicalWarehouse'), 'A unwired open');
assert(!read('src/screens/WarehouseScreen.tsx').includes('openCanonicalWarehouse'), 'A UI unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalWarehouseAllowed({ envValue: null }) === false, 'C gate off');
assert(isCanonicalWarehouseAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C internal');
assert(LEGACY_WAREHOUSE_AUTHORITY === 'LEGACY_CLIENT_UNVERIFIED', 'D legacy');
assert(NO_AUTOMATIC_LEGACY_WAREHOUSE_MIGRATION.includes('NO_AUTOMATIC'), 'D no import');
assert(read('backend/src/canonicalWarehouse.ts').includes('transaction.create(wRef'), 'E server create');
assert(deriveCanonicalWarehouseOpenQuote({ cityId: 'nope', warehouseType: 'standard' }).ok === false, 'F city');
assert(deriveCanonicalWarehouseOpenQuote({ cityId: 'izmir', warehouseType: 'airport' }).ok === false, 'G type');
const izmir = deriveCanonicalWarehouseOpenQuote({ cityId: 'izmir', warehouseType: 'standard' });
assert(izmir.ok && izmir.price === estimateWarehouseOpenCost(CITIES_BY_ID.izmir!, 'standard'), 'H price');
assert(izmir.ok && izmir.level === 1, 'I level');
assert(izmir.ok && izmir.capacityTons === 80, 'J capacity');
assert(
  hasOnlyCanonicalWarehouseOpenKeys({
    cityId: 'izmir',
    warehouseType: 'standard',
    openIntentId: 'open-aaaa',
    canonicalSchemaVersion: 1,
    price: 8,
  }) === false,
  'K client price',
);
assert(
  hasOnlyCanonicalWarehouseOpenKeys({
    cityId: 'izmir',
    warehouseType: 'standard',
    openIntentId: 'open-aaaa',
    canonicalSchemaVersion: 1,
    currentLevel: 2,
  }) === false,
  'L client level',
);
assert(
  hasOnlyCanonicalWarehouseUpgradeKeys({
    warehouseId: 'wh_izmir_standard',
    upgradeIntentId: 'upgr-aaaa',
    canonicalSchemaVersion: 1,
    capacityTons: 1,
  }) === false,
  'M client capacity',
);
assert(
  hasOnlyCanonicalWarehouseOpenKeys({
    cityId: 'izmir',
    warehouseType: 'standard',
    openIntentId: 'open-aaaa',
    canonicalSchemaVersion: 1,
    operatingCost: 1,
  }) === false,
  'N client opex',
);
assert(read('backend/src/canonicalWarehouse.ts').includes('CANONICAL_WAREHOUSE_OPEN'), 'O open debit');
assert(read('backend/src/canonicalWarehouse.ts').includes('CANONICAL_WAREHOUSE_RECEIPTS_COLLECTION'), 'P receipt');
assert(read('backend/src/canonicalWarehouse.ts').includes('alreadyApplied'), 'Q retry');
assert(read('backend/src/canonicalWarehouse.ts').includes('DUPLICATE_WAREHOUSE'), 'R duplicate');
assert(CANONICAL_WAREHOUSE_UPGRADE_POLICY_VERSION === 'canonical-warehouse-upgrade-v1', 'S upgrade policy');
assert(CANONICAL_WAREHOUSE_OPEN_POLICY_VERSION === 'canonical-warehouse-open-v1', 'open policy');
assert(
  hasOnlyCanonicalWarehouseUpgradeKeys({
    warehouseId: 'wh_izmir_standard',
    upgradeIntentId: 'upgr-aaaa',
    canonicalSchemaVersion: 1,
    nextLevel: 2,
  }) === false,
  'T client nextLevel',
);
assert(read('src/domain/canonicalWarehouseState.ts').includes('getWarehouseUpgradeCapacityGain'), 'U capacity');
assert(read('src/domain/canonicalWarehouseState.ts').includes('resolveWarehouseDailyOperatingCost'), 'V opex derive');
assert(read('backend/src/canonicalWarehouse.ts').includes('CANONICAL_WAREHOUSE_UPGRADE'), 'W upgrade debit');
assert(read('backend/src/canonicalWarehouse.ts').includes('economicRevision'), 'X revision');
assert(read('backend/src/canonicalWarehouse.ts').includes('alreadyApplied'), 'Y retry upgrade');
assert(read('src/domain/canonicalWarehouseState.ts').includes('MAX_LEVEL'), 'Z max');
assert(read('backend/src/canonicalWarehouse.ts').includes("reason: cash.reason"), 'AA nsf');
assert(createCanonicalWarehouseId('izmir', 'standard') === 'wh_izmir_standard', 'identity');
assert(
  createCanonicalWarehouseOpenTransactionId('izmir', 'standard') === 'warehouse:izmir:standard:open',
  'open txn',
);
assert(read('backend/src/canonicalDailyOpex.ts').includes('CANONICAL_WAREHOUSES_COLLECTION'), 'AD opex enum');
assert(read('src/domain/canonicalDailyOpexStaffState.ts').includes('warehouseSites'), 'AE sites');
assert(WAREHOUSE_OPEX_AUTHORITY === 'WAREHOUSE_INTERNAL_CANONICAL', 'AF warehouse opex');
assert(!read('backend/src/canonicalWarehouse.ts').includes('users/{uid}.money'), 'AJ no profile write');
assert(!read('src/store/gameStore.ts').includes('openCanonicalWarehouse'), 'AK no local money from canonical');
assert(!read('src/screens/WarehouseScreen.tsx').includes('upgradeCanonicalWarehouse'), 'AL UI');
assert(read('src/domain/canonicalCashOperation.ts').includes('financeLedger') === false, 'AM ledger');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AN overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AO listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AP version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AQ settlement');
assert(OVERDRAFT_OPEX_AUTHORITY === 'CANONICAL_MANDATORY_EXPENSE_PARITY', 'AR overdraft');
assert(DAILY_OPEX_READINESS_STATUS === 'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED', 'AL opex after');
assert(DAILY_OPEX_CASH_STATUS === DAILY_OPEX_READINESS_STATUS, 'opex align');
assert(SAVE_GAME_VERSION === 6, 'AS v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AT RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AT SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AT AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AU OFF');
assert(WAREHOUSE_INVENTORY_CLASS.includes('NOT_REQUIRED'), 'inventory separate');
assert(WAREHOUSE_CLOSE_STATUS === 'NOT_PRESENT', 'no close');
assert(WAREHOUSE_COMPANY_LEVEL_CLASS === 'WAREHOUSE_COMPANY_LEVEL_UNVERIFIED', 'company level');
assert(WAREHOUSE_READINESS_STATUS === 'WAREHOUSE_INTERNAL_CANONICAL_ONLY', 'readiness');
assert(read('firestore.rules').includes('canonicalWarehouses'), 'rules warehouses');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'AX 24');
assert(coverage.criticalCanonicalizedCount === 0, 'AY 0');
assert(coverage.criticalBlockedCount === 24, 'AZ 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BA');
assert(coverage.rows.find((row) => row.auditId === 'warehouse-open')?.hudRole === 'BLOCKS_HUD_AUTHORITY', 'HUD open');
assert(
  coverage.rows.find((row) => row.auditId === 'daily-operating')?.hudRole === 'BLOCKS_HUD_AUTHORITY',
  'HUD opex',
);

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CANONICAL_WAREHOUSE_STATE_AUTHORITY_STATUS,
    WAREHOUSE_READINESS_STATUS,
    DAILY_OPEX_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
