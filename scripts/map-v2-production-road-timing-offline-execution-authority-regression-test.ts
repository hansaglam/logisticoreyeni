/**
 * Map V2 Step 29Y production ROAD timing and offline execution.
 * Run: node --import tsx scripts/map-v2-production-road-timing-offline-execution-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { getMsPerGameHour } from '../src/config/balance';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { FUEL_PROGRESSIVE_PUBLIC_BLOCKER, FUEL_PROGRESSIVE_READINESS_STATUS } from '../src/domain/canonicalProgressiveFuel';
import {
  CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION,
  PRODUCTION_OFFLINE_TIMING_STATUS,
  PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_STATUS,
  PRODUCTION_TIMING_DRIVER_STATUS,
  PRODUCTION_TIMING_MULTI_DELIVERY_STATUS,
  ROAD_TIMING_AUDIT,
  ROAD_TIMING_READINESS_STATUS,
  deriveCanonicalExecutionInterval,
  isCanonicalRoadExecutionTimingAllowed,
  roadTimingAuditHasUnknown,
} from '../src/domain/canonicalRoadExecutionTiming';
import { CANONICAL_ROAD_TIMING_POLICY_VERSION } from '../src/domain/canonicalRoadTiming';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { MAX_OFFLINE_PROGRESS_HOURS } from '../src/simulation/offlineProgression';
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

console.log('\n=== Map V2 Production ROAD Timing / Offline (Step 29Y) ===\n');

assert(
  PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_STATUS ===
    'PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/hooks/useGameLoop.ts').includes('advanceTime'), 'A production clock');
assert(!read('src/store/gameStore.ts').includes('advanceCanonicalRoadExecution'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalRoadExecutionTimingAllowed({ envValue: null }) === false, 'C gate');
assert(read('src/domain/canonicalProgressiveFuel.ts').includes('offlineMs'), 'D elapsed rejected');
assert(read('src/domain/canonicalProgressiveFuel.ts').includes("'progress'"), 'E progress rejected');
assert(read('src/domain/canonicalProgressiveFuel.ts').includes('deviceNow'), 'F device time');
assert(read('src/domain/canonicalProgressiveFuel.ts').includes('completedAt'), 'G completion time');
assert(read('backend/src/canonicalProgressiveFuel.ts').includes('Date.now') === false, 'H no client now in fuel module');
assert(read('backend/src/index.ts').includes('Date.now()'), 'H server now');
assert(getMsPerGameHour(1) === 15_000, 'I 1x');
assert(getMsPerGameHour(1.49) === 15_000 && getMsPerGameHour(1.5) === 7_500, 'J boundary 1.5');
assert(getMsPerGameHour(5.99) === 7_500 && getMsPerGameHour(6) === 1_000, 'J boundary 6');
const paused = deriveCanonicalExecutionInterval({
  elapsedRealMs: 86_400_000,
  gameSpeed: 2,
  manualPaused: true,
  systemPaused: false,
});
assert(paused.gameHours === 0, 'K pause');
const slow = deriveCanonicalExecutionInterval({
  elapsedRealMs: getMsPerGameHour(1) * 2,
  gameSpeed: 1,
  manualPaused: false,
  systemPaused: false,
});
const fast = deriveCanonicalExecutionInterval({
  elapsedRealMs: getMsPerGameHour(8) * 2,
  gameSpeed: 8,
  manualPaused: false,
  systemPaused: false,
});
assert(Math.abs(slow.gameHours - 2) < 1e-9 && Math.abs(fast.gameHours - 2) < 1e-9, 'L M hours');
assert(slow.capped === false, 'N small gap');
const over = deriveCanonicalExecutionInterval({
  elapsedRealMs: 8 * 24 * 60 * 60 * 1000,
  gameSpeed: 1,
  manualPaused: false,
  systemPaused: false,
});
assert(over.gameHours === MAX_OFFLINE_PROGRESS_HOURS && over.capped, 'O S cap');
assert(over.gameHours === 24, 'R at cap constant');
assert(read('src/domain/canonicalProgressiveFuel.ts').includes('lastProgressedAtServerMs'), 'T cursor');
assert(ROAD_TIMING_AUDIT.some((row) => row.behavior === 'offline-catch-up'), 'device weakness documented');
assert(roadTimingAuditHasUnknown() === false, 'audit');
assert(CANONICAL_ROAD_TIMING_POLICY_VERSION === 'canonical-road-timing-internal-fixed-v1', 'AI old 29I');
assert(CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION === 'canonical-road-execution-timing-internal-v1', 'policy');
assert(read('backend/src/canonicalRoadDelivery.ts').includes('isCanonicalExecutionTimingPolicy'), 'AJ fuel timing');
assert(!read('backend/src/canonicalProgressiveFuel.ts').includes('applyCanonicalCashMutations'), 'AK no cash');
assert(ROAD_TIMING_READINESS_STATUS === 'ROAD_TIMING_INTERNAL_ONLY', 'BC');
assert(PRODUCTION_OFFLINE_TIMING_STATUS === 'PRODUCTION_OFFLINE_TIMING_BLOCKED_APP_STATE_AUTHORITY', 'BD');
assert(FUEL_PROGRESSIVE_READINESS_STATUS === 'FUEL_PROGRESSIVE_INTERNAL_ONLY', 'BE');
assert(FUEL_PROGRESSIVE_PUBLIC_BLOCKER === 'FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL', 'fuel');
assert(PRODUCTION_TIMING_MULTI_DELIVERY_STATUS.includes('MULTI_DELIVERY'), 'multi');
assert(PRODUCTION_TIMING_DRIVER_STATUS.includes('DRIVER'), 'driver');
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BH');
assert(coverage.criticalCanonicalizedCount === 0, 'BI');
assert(coverage.criticalBlockedCount === 24, 'BJ');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AO');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AP');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AQ');
assert(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready === false,
  'AR',
);
assert(SAVE_GAME_VERSION === 6, 'AS');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AT rail');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AT sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AT air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AU');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_STATUS,
    ROAD_TIMING_READINESS_STATUS,
    PRODUCTION_OFFLINE_TIMING_STATUS,
    FUEL_PROGRESSIVE_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
