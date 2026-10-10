/**
 * Map V2 Step 21 — production multimodal readiness audit isolation.
 * Run: npx tsx scripts/map-v2-production-multimodal-readiness-audit-regression-test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'path';

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Map V2 Production Multimodal Readiness Audit ===\n');

const docs = [
  'docs/architecture/map-v2/MAP_V2_PRODUCTION_MULTIMODAL_READINESS_AUDIT.md',
  'docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md',
  'docs/architecture/map-v2/decisions/0007-legacy-delivery-coexistence.md',
  'docs/architecture/map-v2/decisions/0008-contract-vs-shipment.md',
  'docs/architecture/map-v2/decisions/0009-non-road-vehicle-ownership.md',
  'docs/architecture/map-v2/decisions/0010-first-last-mile.md',
  'docs/architecture/map-v2/decisions/0011-client-server-authority.md',
  'docs/architecture/map-v2/decisions/0012-schema-versioning.md',
  'docs/architecture/map-v2/decisions/0013-feature-rollout-rollback.md',
];
for (const rel of docs) {
  assert(existsSync(resolve(root, rel)), `exists ${rel}`);
}

assert(read('src/types/game.ts').includes('export interface Contract {'), 'Contract type still present');
assert(read('src/types/game.ts').includes('export interface Delivery {'), 'Delivery type still present');
assert(!read('src/types/game.ts').includes('PersistedProductionMultimodalShipment'), 'live game.ts has no prototype shipment type');
assert(read('src/types/game.ts').includes('multimodalShipments'), 'live game.ts has additive multimodalShipments field');
assert(read('src/storage/saveGame.ts').includes('SAVE_GAME_VERSION = 6'), 'save version unchanged');
assert(!read('src/storage/saveGame.ts').includes('prototypes/productionMultimodal'), 'saveGame does not import prototypes');
assert(read('src/storage/saveGame.ts').includes("from '../domain/multimodalShipmentPersistence'"), 'saveGame uses domain persist types');
assert(!read('src/store/gameStore.ts').includes('prototypes/productionMultimodal'), 'gameStore does not import prototypes');
assert(!read('src/simulation/contracts.ts').includes('prototypes/productionMultimodal'), 'contracts.ts does not import prototypes');
assert(!read('src/simulation/delivery.ts').includes('prototypes/productionMultimodal'), 'delivery.ts does not import prototypes');
assert(!read('src/screens/ContractsScreen.tsx').includes('prototypes/productionMultimodal'), 'ContractsScreen does not import prototypes');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('firestore.rules').includes('multimodalShipments'), 'firestore.rules have no multimodal collection');
assert(!read('src/simulation/contracts.ts').includes('ROAD_RAIL_ROAD'), 'generator not emitting multimodal patterns');
assert(read('src/mapV2/domain/multimodal.ts').includes('LIVE_DELIVERY_IS_NOT_MULTIMODAL_SHIPMENT'), 'live delivery isolation flag remains');
assert(read('src/mapV2/prototypes/productionMultimodal/persistedShipment.ts').includes('NOT RUNTIME'), 'prototype marked not runtime');
assert(read('src/mapV2/prototypes/productionMultimodal/featureFlags.ts').includes("rollout: 'MULTIMODAL_OFF'"), 'default flag OFF');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('First production mode: **RAIL**'), 'migration plan recommends RAIL');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_SETTLEMENT_IDEMPOTENCY.md')), 'settlement identity doc exists');
assert(read('src/domain/multimodalSettlementIdentity.ts').includes("MULTIMODAL_SETTLEMENT_KIND_REVENUE = 'revenue'"), 'settlement kind is revenue');
assert(!read('src/store/gameStore.ts').includes('getMultimodalSettlementId'), 'gameStore does not call multimodal settlement ids');
assert(!read('src/simulation/delivery.ts').includes('getMultimodalSettlementId'), 'delivery.ts does not call multimodal settlement ids');
assert(!read('backend/src/index.ts').includes('completeMultimodalShipment'), 'no completeMultimodalShipment callable');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_DURATION_POLICY.md')), 'duration policy doc exists');
assert(read('src/domain/multimodalDurationPolicy.ts').includes("MULTIMODAL_DURATION_POLICY_VERSION = 'multimodal-duration-policy-v1'"), 'duration policy version');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('mapV2/prototypes'), 'duration domain does not import prototypes');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('DEV_PLAYBACK'), 'duration domain has no DEV playback');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_ROAD_ASSIGNMENT.md')), 'road assignment doc exists');
assert(read('src/domain/multimodalRoadAssignment.ts').includes('PLANNING_ONLY_REVALIDATE_AT_ACCEPTANCE'), 'assignment is planning only');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_RAIL_TARIFF.md')), 'rail tariff doc exists');
assert(read('src/domain/multimodalRailTariff.ts').includes("MULTIMODAL_RAIL_TARIFF_POLICY_VERSION = 'multimodal-rail-tariff-v1'"), 'rail tariff policy version');
assert(!read('src/domain/multimodalRailTariff.ts').includes('mapV2/prototypes'), 'rail tariff domain does not import prototypes');
assert(!read('src/store/gameStore.ts').includes('estimateMultimodalRailTariff'), 'gameStore does not charge rail tariff');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_RAIL_OFFER_GENERATION.md')), 'rail offer doc exists');
assert(read('src/domain/multimodalRailOffer.ts').includes("RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION = 1"), 'rail offer schema version');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MULTIMODAL_UI_FOUNDATION.md')), 'rail UI foundation doc exists');
assert(read('src/domain/multimodalUiPreviewGate.ts').includes('EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW'), 'UI preview env gate exists');
assert(read('src/screens/ContractsScreen.tsx').includes('isMultimodalUiPreviewEnabled'), 'ContractsScreen gates rail UI');
assert(!read('src/simulation/contracts.ts').includes('generateRailMultimodalOffers'), 'live ROAD generator does not call rail offers');
assert(!read('src/store/gameStore.ts').includes('generateRailMultimodalOffers'), 'gameStore does not generate rail offers');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
