/**
 * Map V2 Step 29S canonical daily opex / staff state authority.
 * Run: node --import tsx scripts/map-v2-canonical-daily-opex-staff-state-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_STATUS,
  CANONICAL_DAILY_OPEX_POLICY_VERSION,
  CANONICAL_OPEX_MAX_PERIODS_PER_CALL,
  CANONICAL_OPEX_OFFLINE_CATCHUP_PERIODS,
  CANONICAL_OPEX_PERIOD_DURATION_MS,
  DAILY_OPEX_CLOCK_MODEL,
  DAILY_OPEX_READINESS_STATUS,
  OVERDRAFT_OPEX_AUTHORITY,
  WAREHOUSE_OPEX_AUTHORITY,
  computeCanonicalOpexDuePeriodIndex,
  createCanonicalDailyOpexTransactionId,
  hasOnlyCanonicalDailyOpexKeys,
  isCanonicalDailyOpexAllowed,
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
import { OFFLINE_CATCHUP_MAX_COST_PERIODS, ONLINE_TICK_MAX_COST_PERIODS } from '../src/simulation/periodicCosts';

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

console.log('\n=== Map V2 Canonical Daily Opex / Staff State (Step 29S) ===\n');

assert(
  CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_STATUS ===
    'CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_PASS_INTERNAL_CLOCK_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('processDailyOperatingCosts:'), 'A public opex');
assert(!read('src/store/gameStore.ts').includes('settleCanonicalDailyOpexInternal'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalDailyOpexAllowed({ envValue: null }) === false, 'C gate off');
assert(isCanonicalDailyOpexAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C internal');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, daysElapsed: 2 }) === false, 'D days');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, periodIndex: 3 }) === false, 'E index');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, salaryTotal: 1 }) === false, 'F salary');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, leaseTotal: 1 }) === false, 'G lease');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, warehouseTotal: 1 }) === false, 'H warehouse');
assert(hasOnlyCanonicalDailyOpexKeys({ canonicalSchemaVersion: 1, expenseTotal: 1 }) === false, 'I total');
assert(DAILY_OPEX_CLOCK_MODEL === 'INTERNAL_TEST_FIXED_SPEED_OPEX_CLOCK', 'J clock model');
assert(
  computeCanonicalOpexDuePeriodIndex({
    epochMs: 1000,
    lastSettledPeriodIndex: -1,
    nowMs: 1000,
  }) === null,
  'K no due at epoch',
);
assert(read('backend/src/canonicalDailyOpex.ts').includes('CANONICAL_DRIVERS_COLLECTION'), 'L roster');
assert(read('src/domain/canonicalDailyOpexStaffState.ts').includes("status === 'hired'"), 'M hired only');
assert(WAREHOUSE_OPEX_AUTHORITY === 'WAREHOUSE_INTERNAL_CANONICAL', 'R warehouse');
assert(CANONICAL_OPEX_PERIOD_DURATION_MS === 24 * 60 * 60 * 1000, 'I duration');
assert(CANONICAL_OPEX_MAX_PERIODS_PER_CALL === ONLINE_TICK_MAX_COST_PERIODS, 'J cap 1');
assert(CANONICAL_OPEX_OFFLINE_CATCHUP_PERIODS === OFFLINE_CATCHUP_MAX_COST_PERIODS, 'J offline 0');
assert(createCanonicalDailyOpexTransactionId(0) === 'opex:p24_0:daily', 'S txn id');
assert(read('src/simulation/dailyOperatingCosts.ts').includes('chargedTruckLeaseTotal = 0'), 'Q prepaid');
assert(read('backend/src/canonicalDailyOpex.ts').includes('alreadyApplied'), 'T retry');
assert(OVERDRAFT_OPEX_AUTHORITY === 'CANONICAL_MANDATORY_EXPENSE_PARITY', 'W overdraft');
assert(DAILY_OPEX_READINESS_STATUS === 'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED', 'W readiness');
assert(CANONICAL_DAILY_OPEX_POLICY_VERSION === 'canonical-daily-opex-internal-fixed-v1', 'policy');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AD overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AE listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AF version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AG settlement');
assert(SAVE_GAME_VERSION === 6, 'AI v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AJ RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AJ SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AJ AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AK OFF');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');
assert(read('firestore.rules').includes('canonicalOpexState'), 'rules opex');
assert(read('firestore.rules').includes('canonicalDailyOpexReceipts'), 'rules receipts');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BB 24');
assert(coverage.criticalCanonicalizedCount === 0, 'BC 0');
assert(coverage.criticalBlockedCount === 24, 'BD 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BE');
assert(coverage.rows.find((row) => row.auditId === 'daily-operating')?.hudRole === 'BLOCKS_HUD_AUTHORITY', 'AH HUD');
assert(DAILY_OPEX_CASH_STATUS === DAILY_OPEX_READINESS_STATUS, 'BA align');
assert(DAILY_OPEX_CASH_STATUS.includes('BLOCKED'), 'BA still blocked for HUD');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CANONICAL_DAILY_OPEX_STAFF_STATE_AUTHORITY_STATUS,
    DAILY_OPEX_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
