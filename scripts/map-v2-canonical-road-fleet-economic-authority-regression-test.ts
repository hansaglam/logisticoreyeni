/**
 * Map V2 Step 29J canonical ROAD fleet economic authority.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-road-fleet-economic-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  CANONICAL_FLEET_ASSETS_COLLECTION,
  CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_STATUS,
  CANONICAL_ROAD_FLEET_ENV_KEY,
  INTERNAL_FLEET_AUTHORITY,
  LEGACY_CLIENT_FLEET_UNVERIFIED,
  PRODUCTION_FLEET_AUTHORITY,
  hasOnlyCanonicalFleetBootstrapKeys,
  isCanonicalRoadInternalFleetBootstrapAllowed,
  resolveCanonicalRoadFleetGate,
} from '../src/domain/canonicalRoadFleet';
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

console.log('\n=== Map V2 Canonical ROAD Fleet Economic Authority (Step 29J) ===\n');

assert(
  CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_STATUS ===
    'CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY_PASS_INTERNAL_FIXTURES',
  'status internal fixtures',
);
assert(resolveCanonicalRoadFleetGate({ envValue: null }) === 'OFF', 'C gate OFF');
assert(resolveCanonicalRoadFleetGate({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'internal');
assert(CANONICAL_ROAD_FLEET_ENV_KEY === 'EXPO_PUBLIC_CANONICAL_ROAD_FLEET', 'env');
assert(CANONICAL_FLEET_ASSET_SCHEMA_VERSION === 1, 'D schema 1');
assert(CANONICAL_FLEET_ASSETS_COLLECTION === 'canonicalFleetAssets', 'I collection');
assert(INTERNAL_FLEET_AUTHORITY === 'INTERNAL_FIXTURE_AUTHORITY_READY', 'internal ready');
assert(PRODUCTION_FLEET_AUTHORITY === 'PRODUCTION_FLEET_AUTHORITY_BLOCKED_LEGACY_SAVE_STATE', 'Q production');
assert(LEGACY_CLIENT_FLEET_UNVERIFIED === 'LEGACY_CLIENT_FLEET_UNVERIFIED', 'W legacy const');
assert(isCanonicalRoadInternalFleetBootstrapAllowed({ envValue: null }) === false, 'I gate missing');
assert(isCanonicalRoadInternalFleetBootstrapAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'I env');

assert(read('src/store/gameStore.ts').includes('buyTruck'), 'A production buyTruck');
assert(read('src/store/gameStore.ts').includes('upgradeTruck'), 'A upgrades');
assert(!read('src/store/gameStore.ts').includes('bootstrapInternalCanonicalFleetFixtures'), 'A store unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');

assert(!hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1, condition: 1 }), 'P condition');
assert(!hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1, upgrades: [] }), 'Q upgrades');
assert(!hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1, maintenanceCost: 0 }), 'R maintenance');
assert(!hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1, trailerCost: 0 }), 'S trailer cost');
assert(hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1 }), 'bootstrap keys');

const backend = read('backend/src/canonicalRoadDelivery.ts');
const fleetDomain = read('src/domain/canonicalRoadFleet.ts');
assert(fleetDomain.includes('CANONICAL_TRUCK_NOT_FOUND'), 'V unknown');
assert(backend.includes('LEGACY_CLIENT_FLEET_UNVERIFIED'), 'W legacy');
assert(backend.includes('CANONICAL_TRUCK_NOT_OWNED'), 'T ownership');
assert(backend.includes('CANONICAL_FLEET_ASSETS_COLLECTION'), 'I path');
assert(read('src/domain/canonicalRoadExecutionEconomics.ts').includes('economicRevision'), 'X revision freeze');
assert(!backend.includes('runCanonicalCashMutation'), 'AE no cash helper');

const index = read('backend/src/index.ts');
assert(index.includes('export const bootstrapInternalCanonicalFleetFixtures'), 'callable');
assert(index.includes("process.env.CANONICAL_ROAD_INTERNAL_TEST"), 'I backend env');
assert(!index.includes('export const applyCashDelta'), 'no delta');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'BB no multimodal');

const rules = read('firestore.rules');
assert(/match \/canonicalFleetAssets\/\{assetId\}[\s\S]*?allow write: if false/.test(rules), 'E F G H writes false');
assert(/match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/.test(rules), 'delivery writes');

assert(
  UNIFIED_CASH_BLOCK_REASON === 'ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET',
  'block reason production fleet',
);
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AH overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AI listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AJ settlement gate');
assert(SAVE_GAME_VERSION === 6, 'AK v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AL RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AL SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AL AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AM OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BM production fleet',
);
assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_FLEET_ECONOMIC_AUTHORITY.md').includes('INTERNAL_FIXTURES'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29J'), 'plan');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
