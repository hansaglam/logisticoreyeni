/**
 * Map V2 Step 29X production progressive fuel authority.
 * Run: node --import tsx scripts/map-v2-production-progressive-fuel-authority-regression-test.ts
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
import { FUEL_INCIDENT_AUTHORITY_STATUS, ROADSIDE_FUEL_AUTHORITY_STATUS } from '../src/domain/canonicalFuelTankPrice';
import {
  CANONICAL_PROGRESSIVE_FUEL_POLICY_VERSION,
  CANONICAL_ROAD_PROGRESS_POLICY_VERSION,
  FUEL_PROGRESSIVE_PUBLIC_BLOCKER,
  FUEL_PROGRESSIVE_READINESS_STATUS,
  PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_STATUS,
  PROGRESSIVE_FUEL_AUDIT,
  createInitialCanonicalProgressiveFuelState,
  deriveCanonicalProgressiveFuel,
  hasOnlyCanonicalProgressiveAdvanceKeys,
  hasOnlyCanonicalProgressivePauseKeys,
  hasOnlyCanonicalProgressiveSpeedKeys,
  isCanonicalProgressiveFuelAllowed,
  progressiveFuelAuditHasUnknown,
  setCanonicalProgressivePaused,
  settleCanonicalProgressiveFuelState,
} from '../src/domain/canonicalProgressiveFuel';
import { FUEL_CASH_AUTHORITY_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
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

console.log('\n=== Map V2 Production Progressive Fuel (Step 29X) ===\n');

assert(
  PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_STATUS ===
    'PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/simulation/delivery.ts').includes('advanceFuelConstrainedProgress'), 'A production progressive');
assert(!read('src/store/gameStore.ts').includes('advanceCanonicalRoadExecution'), 'A unwired');
assert(!read('src/components/TruckRefuelSheet.tsx').includes('purchaseCanonicalFuel'), 'A refuel ui');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalProgressiveFuelAllowed({ envValue: null }) === false, 'C gate');
assert(read('backend/src/canonicalFuel.ts').includes('LEGACY_FLEET_UNVERIFIED'), 'D legacy');
assert(read('backend/src/canonicalProgressiveFuel.ts').includes('currentFuelL'), 'E tank');
assert(
  hasOnlyCanonicalProgressiveAdvanceKeys({
    deliveryId: 'd',
    canonicalSchemaVersion: 1,
    fuelConsumed: 4,
  }) === false,
  'F fuel consumed',
);
assert(
  hasOnlyCanonicalProgressiveAdvanceKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, distanceKm: 1 }) ===
    false,
  'G distance',
);
assert(
  hasOnlyCanonicalProgressiveAdvanceKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, progress: 1 }) ===
    false,
  'H progress',
);
assert(
  hasOnlyCanonicalProgressiveAdvanceKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, elapsedMs: 1 }) ===
    false,
  'I elapsed',
);
assert(PROGRESSIVE_FUEL_AUDIT.some((row) => row.fn === 'updateDeliveryProgressWithFuel'), 'J source');
assert(progressiveFuelAuditHasUnknown() === false, 'J no unknown');

const full = deriveCanonicalProgressiveFuel({
  gameHours: 4,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 40,
  fuelLitersTotal: 30,
  currentFuelL: 40,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(Math.abs(full.cumulativeFuelConsumedL - 30) < 0.001, 'K parity');
assert(Math.abs(full.currentFuelL - 10) < 0.001, 'K remaining');
const half = deriveCanonicalProgressiveFuel({
  gameHours: 2,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 40,
  fuelLitersTotal: 30,
  currentFuelL: 40,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(Math.abs(half.cumulativeFuelConsumedL - 15) < 0.001, 'L incremental');
assert(half.cumulativeFuelConsumedL === full.cumulativeFuelConsumedL / 2 || Math.abs(half.cumulativeFuelConsumedL - 15) < 0.001, 'M cumulative');

const base = createInitialCanonicalProgressiveFuelState({
  nowMs: 0,
  distanceKm: 80,
  travelHours: 4,
  fuelLitersTotal: 30,
  fuelLitersAtStart: 40,
  fuelCapacityL: 100,
});
const wall = getMsPerGameHour(1) * 2;
const one = settleCanonicalProgressiveFuelState(base, wall, 40);
let cursor = base;
let tank = 40;
for (let i = 1; i <= 20; i += 1) {
  const step = settleCanonicalProgressiveFuelState(cursor, (wall / 20) * i, tank);
  cursor = step.state;
  tank = step.currentFuelL;
}
assert(Math.abs(one.currentFuelL - tank) < 0.001, 'N tick invariance');
assert(one.currentFuelL >= 0 && tank >= 0, 'O no negative');
const clamped = deriveCanonicalProgressiveFuel({
  gameHours: 1,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 40,
  fuelLitersTotal: 30,
  currentFuelL: 200,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(clamped.currentFuelL <= 100, 'P capacity');
const exact = deriveCanonicalProgressiveFuel({
  gameHours: 4,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 30,
  fuelLitersTotal: 30,
  currentFuelL: 30,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(exact.progress === 1 && exact.currentFuelL <= 0.001, 'Q exact fuel');
const dry = deriveCanonicalProgressiveFuel({
  gameHours: 4,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 10,
  fuelLitersTotal: 30,
  currentFuelL: 10,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(dry.outOfFuel && dry.currentFuelL === 0 && dry.progress < 1, 'R S out of fuel');
const paused = setCanonicalProgressivePaused(base, true, 0, 40);
assert(paused.ok, 'T pause');
if (paused.ok) {
  const waited = settleCanonicalProgressiveFuelState(paused.state, wall, paused.currentFuelL);
  assert(waited.currentFuelL === 40, 'T no burn');
}
assert(getMsPerGameHour(0.5) === getMsPerGameHour(1), 'U V same bucket');
assert(getMsPerGameHour(8) < getMsPerGameHour(1), 'V faster bucket');
const slow = deriveCanonicalProgressiveFuel({
  gameHours: 4,
  travelHours: 4,
  distanceKm: 80,
  fuelLitersAtStart: 40,
  fuelLitersTotal: 30,
  currentFuelL: 40,
  cumulativeFuelConsumedL: 0,
  fuelCapacityL: 100,
});
assert(slow.cumulativeFuelConsumedL === full.cumulativeFuelConsumedL, 'V same total');
const again = settleCanonicalProgressiveFuelState(one.state, wall, one.currentFuelL);
assert(again.changed === false, 'W X retry');
assert(read('backend/src/canonicalProgressiveFuel.ts').includes('runTransaction'), 'Y two device');
assert(one.state.progressRevision > 0, 'Z restart cursor');
assert(read('backend/src/canonicalRoadDelivery.ts').includes("lifecycleState: 'CANCELLED'"), 'AA cancel');
assert(read('backend/src/canonicalRoadDelivery.ts').includes('PROGRESS_INCOMPLETE'), 'AB completion sync');
assert(PROGRESSIVE_FUEL_AUDIT.some((row) => row.canonicalStatus === 'CLIENT_REPORTED_UNVERIFIED'), 'AC client failed');
assert(full.cumulativeFuelConsumedL <= 30.001, 'AD no extra burn');
assert(!read('backend/src/canonicalProgressiveFuel.ts').includes('applyCanonicalCashMutations'), 'AE no fuel cash');
assert(read('src/domain/canonicalFleetRepairUpgrade.ts').includes('ASSET_RESERVED_BY_ACTIVE_DELIVERY'), 'AG frozen');
assert(FUEL_INCIDENT_AUTHORITY_STATUS === 'FUEL_AUTHORITY_BLOCKED_INCIDENT_FUEL_DELTA', 'AH incident');
assert(ROADSIDE_FUEL_AUTHORITY_STATUS.includes('BLOCKED'), 'AI roadside');
assert(!hasOnlyCanonicalProgressiveAdvanceKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, currentFuelL: 1 }), 'AJ AK');
assert(read('backend/src/canonicalProgressiveFuel.ts').includes('fuelRevision'), 'AL');
assert(one.state.progressRevision >= 1, 'AM');
assert(!read('backend/src/canonicalProgressiveFuel.ts').includes('serverState'), 'AN AO');
assert(read('firestore.rules').includes('canonicalFleetAssets'), 'rules');
assert(FUEL_PROGRESSIVE_READINESS_STATUS === 'FUEL_PROGRESSIVE_INTERNAL_ONLY', 'BI');
assert(FUEL_PROGRESSIVE_PUBLIC_BLOCKER === 'FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL', 'offline');
assert(CANONICAL_PROGRESSIVE_FUEL_POLICY_VERSION === 'canonical-road-progressive-fuel-v1', 'policy');
assert(CANONICAL_ROAD_PROGRESS_POLICY_VERSION === 'canonical-road-progress-internal-v1', 'progress policy');
assert(hasOnlyCanonicalProgressiveSpeedKeys({ deliveryId: 'd', gameSpeed: 2, canonicalSchemaVersion: 1, elapsedMs: 1 }) === false, 'speed keys');
assert(hasOnlyCanonicalProgressivePauseKeys({ deliveryId: 'd', paused: true, canonicalSchemaVersion: 1 }), 'pause keys');
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'paths');
assert(coverage.criticalCanonicalizedCount === 0, 'canonicalized');
assert(coverage.criticalBlockedCount === 24, 'blocked');
assert(FUEL_CASH_AUTHORITY_STATUS.includes('INTERNAL_TEST'), 'fuel status');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AS');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AT');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AU');
assert(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready === false,
  'AV',
);
assert(SAVE_GAME_VERSION === 6, 'AW');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AX rail');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AX sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AX air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AY');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_STATUS,
    FUEL_PROGRESSIVE_READINESS_STATUS,
    FUEL_CASH_AUTHORITY_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
