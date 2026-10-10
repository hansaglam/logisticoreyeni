/**
 * Map V2 Step 29V canonical daily opex overdraft policy.
 * Run: node --import tsx scripts/map-v2-canonical-daily-opex-overdraft-policy-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { financeBalance } from '../src/config/balance';
import {
  CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR,
  CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_STATUS,
  CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION,
  MANDATORY_RECURRING_EXPENSE_POLICY,
  VOLUNTARY_PURCHASE_POLICY,
  canonicalMinimumCashAfterDebit,
  deriveMandatoryExpenseApplication,
  resolveCanonicalCashDebitPolicy,
} from '../src/domain/canonicalMandatoryExpensePolicy';
import {
  DAILY_OPEX_CLOCK_MODEL,
  DAILY_OPEX_READINESS_STATUS,
  hasOnlyCanonicalDailyOpexKeys,
  isCanonicalDailyOpexAllowed,
} from '../src/domain/canonicalDailyOpexStaffState';
import { DAILY_OPEX_CASH_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { SERVER_CASH_OVERDRAFT_POLICY } from '../src/domain/canonicalRoadServerCashShadow';
import { hasOnlyCanonicalFuelPurchaseKeys } from '../src/domain/canonicalFuelTankPrice';
import {
  hasOnlyCanonicalFleetRepairKeys,
  hasOnlyCanonicalFleetUpgradeKeys,
} from '../src/domain/canonicalFleetRepairUpgrade';
import {
  hasOnlyCanonicalWarehouseOpenKeys,
  hasOnlyCanonicalWarehouseUpgradeKeys,
} from '../src/domain/canonicalWarehouseState';
import { hasOnlyCanonicalCargoBuyKeys } from '../src/domain/canonicalCargoMarketWorldState';
import { hasOnlyCanonicalCatalogPurchaseKeys } from '../src/domain/remainingRoadCashPathCanonicalization';
import {
  hasOnlyCanonicalDriverHireKeys,
  hasOnlyCanonicalLeaseStartKeys,
} from '../src/domain/canonicalCoreVehicleStaffCash';
import { applyCashTransaction } from '../src/utils/cashPolicy';
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

console.log('\n=== Map V2 Canonical Daily Opex Overdraft (Step 29V) ===\n');

assert(
  CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_STATUS ===
    'CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('processDailyOperatingCosts:'), 'A public opex');
assert(read('src/store/gameStore.ts').includes("kind: 'mandatory-expense'"), 'A helper kind');
assert(!read('src/store/gameStore.ts').includes('settleCanonicalDailyOpexInternal'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'C overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'D listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'E version');
assert(isCanonicalDailyOpexAllowed({ envValue: null }) === false, 'F gate');
assert(financeBalance.minCashBalance === -5000, 'G floor');
assert(CANONICAL_MANDATORY_EXPENSE_POLICY_VERSION === 'canonical-mandatory-expense-v1', 'H policy');
const voluntary = resolveCanonicalCashDebitPolicy('CANONICAL_FUEL_PURCHASE');
const mandatory = resolveCanonicalCashDebitPolicy('CANONICAL_DAILY_OPEX');
assert(voluntary.ok && voluntary.policy === VOLUNTARY_PURCHASE_POLICY, 'I voluntary');
assert(mandatory.ok && mandatory.policy === MANDATORY_RECURRING_EXPENSE_POLICY, 'H class');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, allowOverdraft: true }) === false, 'J');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, minCashBalance: -5000 }) === false, 'K');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, actualDebit: 1 }) === false, 'L');

function matchesProduction(cashBefore: number, expense: number): boolean {
  const production = applyCashTransaction({
    currentCash: cashBefore,
    amount: expense,
    kind: 'mandatory-expense',
    referenceId: 'parity',
  });
  const derived = deriveMandatoryExpenseApplication(cashBefore, expense);
  return (
    derived.ok &&
    derived.actualDebit === production.amount &&
    derived.cashAfter === production.cashAfter &&
    derived.unpaidExpense === production.requestedAmount - production.amount &&
    derived.cashAfter >= financeBalance.minCashBalance
  );
}

assert(matchesProduction(10000, 1000), 'M full');
assert(matchesProduction(1000, 1000), 'N zero result');
assert(matchesProduction(100, 6000), 'O cross zero');
assert(matchesProduction(0, 1000), 'O from zero');
assert(matchesProduction(-4000, 2000), 'P larger than room');
assert(matchesProduction(-5000, 100), 'Q at floor');
assert(matchesProduction(-4999, 2), 'R near floor');
const below = deriveMandatoryExpenseApplication(-5001, 100);
assert(below.ok === false && below.ok === false, 'S below');
assert(!below.ok && below.reason === CANONICAL_CASH_BELOW_MINIMUM_INTEGRITY_ERROR, 'S reason');
const partial = deriveMandatoryExpenseApplication(100, 6000);
assert(partial.ok && partial.requestedExpense === 6000 && partial.actualDebit === 5100, 'T requested');
assert(partial.ok && partial.unpaidExpense === 900 && partial.cashAfter === -5000, 'U unpaid');
assert(read('backend/src/canonicalDailyOpex.ts').includes('lastSettledPeriodIndex: dueIndex'), 'V cursor');
assert(read('backend/src/canonicalDailyOpex.ts').includes('policy.actualDebit > 0'), 'W zero txn skip');
assert(read('backend/src/canonicalDailyOpex.ts').includes('alreadyApplied: true'), 'X retry');
assert(read('backend/src/canonicalDailyOpex.ts').includes('lastSnap'), 'Y stored receipt');
assert(read('src/domain/canonicalDailyOpexStaffState.ts').includes('CANONICAL_OPEX_MAX_PERIODS_PER_CALL = 1'), 'Z one period');
assert(canonicalMinimumCashAfterDebit('CANONICAL_DAILY_OPEX') === -5000, 'floor fn');
assert(canonicalMinimumCashAfterDebit('CANONICAL_FUEL_PURCHASE') === 0, 'fuel floor');
assert(canonicalMinimumCashAfterDebit('ROAD_DELIVERY_SETTLEMENT') === 0, 'AM road');
assert(SERVER_CASH_OVERDRAFT_POLICY === 'ROAD_SERVER_SETTLEMENT_BLOCKED_OVERDRAFT_POLICY', 'AM class');
assert(
  hasOnlyCanonicalFuelPurchaseKeys({
    assetId: 'a',
    fuelPurchaseIntentId: 'fuel-aaaa',
    mode: 'fill',
    requestedLiters: 1,
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AC fuel key',
);
assert(
  hasOnlyCanonicalFleetRepairKeys({
    assetId: 'a',
    repairIntentId: 'repair-aa',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AD repair key',
);
assert(
  hasOnlyCanonicalFleetUpgradeKeys({
    assetId: 'a',
    upgradeIntentId: 'upgrade-a',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AE upgrade key',
);
assert(
  hasOnlyCanonicalWarehouseOpenKeys({
    cityId: 'izmir',
    warehouseType: 'standard',
    openIntentId: 'open-aaaa',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AF open key',
);
assert(
  hasOnlyCanonicalWarehouseUpgradeKeys({
    warehouseId: 'wh',
    upgradeIntentId: 'upgr-aaaa',
    canonicalSchemaVersion: 1,
    minCashBalance: -5000,
  }) === false,
  'AG upgrade key',
);
assert(
  hasOnlyCanonicalCargoBuyKeys({
    cityId: 'izmir',
    productId: 'steel',
    quantity: 5,
    warehouseId: 'wh',
    purchaseIntentId: 'buy-aaaa1',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AH cargo key',
);
assert(
  hasOnlyCanonicalCatalogPurchaseKeys({
    catalogModelId: 'truck-ford-cargo',
    purchaseId: 'purchase01',
    assetType: 'TRUCK',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AI catalog key',
);
assert(
  hasOnlyCanonicalDriverHireKeys({
    driverId: 'driver-01',
    hireIntentId: 'hire-aaaa',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AJ hire key',
);
assert(
  hasOnlyCanonicalLeaseStartKeys({
    catalogModelId: 'truck-ford-cargo',
    leaseIntentId: 'lease-aaa',
    leasePeriod: 'weekly',
    canonicalSchemaVersion: 1,
    allowOverdraft: true,
  }) === false,
  'AK lease key',
);
assert(read('backend/src/canonicalCashTransaction.ts').includes('rejectDebitAgainstPolicy'), 'AN helper');
assert(read('backend/src/canonicalDailyOpex.ts').includes('amountDelta: -policy.actualDebit'), 'AN delta');
assert(DAILY_OPEX_CLOCK_MODEL === 'INTERNAL_TEST_FIXED_SPEED_OPEX_CLOCK', 'clock');
assert(DAILY_OPEX_READINESS_STATUS === 'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED', 'AY');
assert(DAILY_OPEX_CASH_STATUS === DAILY_OPEX_READINESS_STATUS, 'align');
assert(!read('backend/src/canonicalDailyOpex.ts').includes('users/{uid}.money'), 'AP profile');
assert(SAVE_GAME_VERSION === 6, 'AT v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AU RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AU SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AU AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AV OFF');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AX settlement');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'AZ 24');
assert(coverage.criticalCanonicalizedCount === 0, 'BA 0');
assert(coverage.criticalBlockedCount === 24, 'BB 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BC');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CANONICAL_DAILY_OPEX_OVERDRAFT_POLICY_STATUS,
    DAILY_OPEX_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
