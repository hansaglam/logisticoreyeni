/**
 * Map V2 Step 29I canonical ROAD timing authority.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-road-timing-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  hasOnlyCanonicalRoadCompleteKeys,
  resolveCanonicalRoadEconomyGate,
} from '../src/domain/canonicalRoadDelivery';
import {
  CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR,
  CANONICAL_ROAD_TIMING_AUTHORITY_STATUS,
  CANONICAL_ROAD_TIMING_ENV_KEY,
  CANONICAL_ROAD_TIMING_POLICY_VERSION,
  ROAD_GAME_TIME_POLICY_VERSION,
  classifyCanonicalRoadTimingBand,
  deriveCanonicalRoadElapsedGameHours,
  realMsForCanonicalGameHours,
  resolveCanonicalRoadTimingGate,
} from '../src/domain/canonicalRoadTiming';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  canUseServerAuthoritativeSettlement,
  UNIFIED_CASH_BLOCK_REASON,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
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

console.log('\n=== Map V2 Canonical ROAD Timing Authority (Step 29I) ===\n');

assert(
  CANONICAL_ROAD_TIMING_AUTHORITY_STATUS ===
    'CANONICAL_ROAD_TIMING_AUTHORITY_PASS_INTERNAL_FIXED_SPEED_ONLY',
  'status fixed speed',
);
assert(resolveCanonicalRoadTimingGate({ envValue: null }) === 'OFF', 'A gate OFF');
assert(resolveCanonicalRoadTimingGate({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'internal');
assert(CANONICAL_ROAD_TIMING_ENV_KEY === 'EXPO_PUBLIC_CANONICAL_ROAD_TIMING', 'env');
assert(CANONICAL_ROAD_TIMING_POLICY_VERSION === 'canonical-road-timing-internal-fixed-v1', 'I policy');
assert(ROAD_GAME_TIME_POLICY_VERSION === 'road-game-time-policy-v1', 'game time policy');
assert(CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR === 15_000, 'AL 1x mapping');
assert(resolveCanonicalRoadEconomyGate({ envValue: null }) === 'OFF', 'economy still OFF');

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'B production complete');
assert(read('src/store/gameStore.ts').includes('startDelivery:'), 'B startDelivery');
assert(!read('src/store/gameStore.ts').includes('reportCanonicalRoadDeliveryCompleted'), 'B store unwired');
assert(read('src/simulation/contracts.ts').includes('export function generateContracts'), 'B generator');
assert(read('src/store/gameStore.ts').includes('Guests'), 'C guest');

assert(
  hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'COMPLETED',
    canonicalSchemaVersion: 1,
  }),
  'P no money required',
);
assert(
  !hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'COMPLETED',
    canonicalSchemaVersion: 1,
    latePenalty: 1,
  }),
  'P money rejected',
);
assert(
  !hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'COMPLETED',
    canonicalSchemaVersion: 1,
    timingClassification: 'EARLY',
  }),
  'I client category rejected',
);

const zero = deriveCanonicalRoadElapsedGameHours({
  startedAtServerMs: 1000,
  completedAtServerMs: 1000,
});
assert(zero.actualTravelHours === 0, 'J zero elapsed');
const oneHour = deriveCanonicalRoadElapsedGameHours({
  startedAtServerMs: 0,
  completedAtServerMs: realMsForCanonicalGameHours(1),
});
assert(oneHour.actualTravelHours === 1, 'J 1 game hour');
assert(oneHour.elapsedRealMs === 15_000, 'AL real ms');

assert(
  classifyCanonicalRoadTimingBand({
    outcome: 'COMPLETED',
    actualTravelHours: 1,
    deadlineHours: 10,
    plannedTravelGameHours: 8,
  }) === 'EARLY',
  'K EARLY',
);
assert(
  classifyCanonicalRoadTimingBand({
    outcome: 'COMPLETED',
    actualTravelHours: 8,
    deadlineHours: 10,
    plannedTravelGameHours: 8,
  }) === 'ON_TIME',
  'L ON_TIME',
);
assert(
  classifyCanonicalRoadTimingBand({
    outcome: 'COMPLETED',
    actualTravelHours: 10.5,
    deadlineHours: 10,
    plannedTravelGameHours: 8,
  }) === 'LATE_MINOR',
  'M LATE_MINOR',
);
assert(
  classifyCanonicalRoadTimingBand({
    outcome: 'COMPLETED',
    actualTravelHours: 12,
    deadlineHours: 10,
    plannedTravelGameHours: 8,
  }) === 'LATE_MAJOR',
  'N LATE_MAJOR',
);

const backend = read('backend/src/canonicalRoadDelivery.ts');
assert(backend.includes('timingSnapshot'), 'E timing stored');
assert(backend.includes('startedAtServerMs'), 'E start');
assert(backend.includes('alreadyAccepted'), 'F retry');
assert(backend.includes('deriveCanonicalRoadTiming'), 'J derive');
assert(backend.includes('clientActualTravelHoursIgnored'), 'H ignore client hours');
assert(!backend.includes('runCanonicalCashMutation'), 'Q no cash helper');
assert(read('backend/src/index.ts').includes('Date.now()'), 'G server now');
assert(!read('backend/src/index.ts').includes('export const applyCashDelta'), 'no delta');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'BA no multimodal');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'T overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'U listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'V settlement gate');
assert(SAVE_GAME_VERSION === 6, 'W v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'X RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'X SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'X AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'Y OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BJ production fleet blocker',
);
assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_TIMING_AUTHORITY.md').includes('FIXED_SPEED'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29I'), 'plan');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
