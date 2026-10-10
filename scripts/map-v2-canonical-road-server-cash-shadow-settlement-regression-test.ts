/**
 * Map V2 Step 29K canonical ROAD server-cash shadow settlement.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-road-server-cash-shadow-settlement-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_ROAD_SERVER_CASH_SHADOW_BACKEND_ENV,
  CANONICAL_ROAD_SERVER_CASH_SHADOW_ENV_KEY,
  CANONICAL_ROAD_SERVER_CASH_SHADOW_STATUS,
  CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION,
  SERVER_CASH_OVERDRAFT_POLICY,
  canUseInternalCanonicalRoadServerCashShadow,
  classifyCanonicalRoadSettlementSupport,
  hasOnlyCanonicalRoadSettleKeys,
  isCanonicalRoadServerCashShadowAllowed,
  resolveCanonicalRoadServerCashShadowGate,
} from '../src/domain/canonicalRoadServerCashShadow';
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

console.log('\n=== Map V2 Canonical ROAD Server-Cash Shadow Settlement (Step 29K) ===\n');

assert(
  CANONICAL_ROAD_SERVER_CASH_SHADOW_STATUS ===
    'CANONICAL_ROAD_SERVER_CASH_SHADOW_SETTLEMENT_PASS',
  'status',
);
assert(resolveCanonicalRoadServerCashShadowGate({ envValue: null }) === 'OFF', 'A production gate OFF');
assert(resolveCanonicalRoadServerCashShadowGate({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'internal');
assert(CANONICAL_ROAD_SERVER_CASH_SHADOW_ENV_KEY === 'EXPO_PUBLIC_CANONICAL_ROAD_SERVER_CASH_SHADOW', 'client env');
assert(CANONICAL_ROAD_SERVER_CASH_SHADOW_BACKEND_ENV === 'CANONICAL_ROAD_SERVER_CASH_SHADOW', 'backend env');
assert(isCanonicalRoadServerCashShadowAllowed({ envValue: null }) === false, 'backend gate missing');
assert(CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION === 1, 'schema 1');
assert(SERVER_CASH_OVERDRAFT_POLICY === 'ROAD_SERVER_SETTLEMENT_BLOCKED_OVERDRAFT_POLICY', 'N overdraft class');

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'B production ROAD');
assert(!read('src/store/gameStore.ts').includes('settleCanonicalRoadDeliveryInternal'), 'B store unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'C guest');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'D overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'E listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'F production settlement false');

assert(
  classifyCanonicalRoadSettlementSupport(null) === 'UNSUPPORTED_LEGACY_DELIVERY',
  'L live client/legacy',
);
assert(
  classifyCanonicalRoadSettlementSupport({
    deliveryId: 'd1',
    sourceCanonicalContractId: 'c1',
    canonicalSchemaVersion: 1,
    lifecycleState: 'FAILED',
    completionOutcome: 'FAILED',
    executionEconomicsSnapshot: {
      truckEconomicProfile: { source: 'CANONICAL_FLEET_ASSET' },
      fragilityPolicySnapshot: { contractType: 'standard' },
    } as never,
    timingSnapshot: { timingPolicyVersion: 'canonical-road-timing-internal-fixed-v1', derivedActualTravelHours: 1, completedAtServerMs: 1 },
  }) === 'UNSUPPORTED_FAILURE_AUTHORITY',
  'J failed blocked',
);
assert(
  classifyCanonicalRoadSettlementSupport({
    deliveryId: 'd1',
    sourceCanonicalContractId: 'c1',
    canonicalSchemaVersion: 1,
    lifecycleState: 'COMPLETION_REPORTED',
    completionOutcome: 'COMPLETED',
    executionEconomicsSnapshot: {
      truckEconomicProfile: { source: 'CANONICAL_FLEET_ASSET' },
      fragilityPolicySnapshot: { contractType: 'fragile' },
    } as never,
    timingSnapshot: { timingPolicyVersion: 'canonical-road-timing-internal-fixed-v1', derivedActualTravelHours: 1, completedAtServerMs: 1 },
  }) === 'UNSUPPORTED_FRAGILE_AUTHORITY',
  'I fragile blocked',
);
assert(
  classifyCanonicalRoadSettlementSupport({
    deliveryId: 'd1',
    sourceCanonicalContractId: 'c1',
    canonicalSchemaVersion: 1,
    lifecycleState: 'COMPLETION_REPORTED',
    completionOutcome: 'COMPLETED',
    executionEconomicsSnapshot: {
      truckEconomicProfile: { source: 'INTERNAL_TEST_FIXTURE' },
      fragilityPolicySnapshot: { contractType: 'standard' },
    } as never,
    timingSnapshot: { timingPolicyVersion: 'canonical-road-timing-internal-fixed-v1', derivedActualTravelHours: 1, completedAtServerMs: 1 },
  }) === 'UNSUPPORTED_PRODUCTION_FLEET',
  'K legacy fleet blocked',
);

assert(!hasOnlyCanonicalRoadSettleKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, payment: 9 }), 'M no money keys');
assert(hasOnlyCanonicalRoadSettleKeys({ deliveryId: 'x', canonicalSchemaVersion: 1 }), 'N deliveryId/schema only');

assert(
  canUseInternalCanonicalRoadServerCashShadow({
    clientGate: 'OFF',
    backendAllowed: true,
    support: 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD',
    serverStateCashPresent: true,
  }).ready === false,
  'G internal classifier off',
);
assert(
  canUseInternalCanonicalRoadServerCashShadow({
    clientGate: 'INTERNAL_TEST',
    backendAllowed: true,
    support: 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD',
    serverStateCashPresent: true,
  }).ready === true,
  'G internal ready',
);

const index = read('backend/src/index.ts');
assert(index.includes('export const settleCanonicalRoadDeliveryInternal'), 'callable');
assert(index.includes('process.env.CANONICAL_ROAD_SERVER_CASH_SHADOW'), 'backend env');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'Y no multimodal');
assert(!index.includes('export const applyCashDelta'), 'no delta');

const backend = read('backend/src/canonicalRoadSettlement.ts');
assert(backend.includes('applyCanonicalCashMutationsInTransaction'), 'cash helper reused');
assert(!backend.includes('runCanonicalCashMutation'), 'no standalone mutation runner in settle');
assert(backend.includes('CANONICAL_ROAD_SETTLEMENTS_COLLECTION'), 'T path');

assert(read('src/store/gameStore.ts').includes('applyCashTransaction'), 'R local HUD authority');
assert(SAVE_GAME_VERSION === 6, 'W v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'X RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'X SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'X AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'Y OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'AV production fleet',
);
assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_SERVER_CASH_SHADOW_SETTLEMENT.md').includes('SHADOW'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29K'), 'plan');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
