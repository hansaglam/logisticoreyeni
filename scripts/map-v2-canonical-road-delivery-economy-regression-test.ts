/**
 * Map V2 Step 29F canonical ROAD delivery economy (shadow-only).
 * Run: npx tsx scripts/map-v2-canonical-road-delivery-economy-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_ROAD_CONTRACT_AUTHORITY,
  CANONICAL_ROAD_CONTRACT_GENERATION_CLASS,
  CANONICAL_ROAD_COST_CLASSES,
  CANONICAL_ROAD_DELIVERIES_COLLECTION,
  CANONICAL_ROAD_DELIVERY_ECONOMY_STATUS,
  CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
  CANONICAL_ROAD_ECONOMY_ENV_KEY,
  LEGACY_LOCAL_ONLY_DELIVERY,
  createCanonicalRoadDeliveryId,
  hasOnlyCanonicalRoadAcceptKeys,
  resolveCanonicalRoadEconomyGate,
} from '../src/domain/canonicalRoadDelivery';
import {
  CANONICAL_ROAD_FUEL_ALREADY_PAID,
  CANONICAL_ROAD_ROUTE_PACKAGE_HASH,
  buildFixtureMarket,
  compareRoadSettlementShadow,
  issueCanonicalRoadContractFromTrustedState,
  localProductionSettlementFromSnapshot,
  lookupCanonicalRoadRoute,
  prepareCanonicalRoadDeliverySettlement,
} from '../src/domain/canonicalRoadEconomics';
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

console.log('\n=== Map V2 Canonical ROAD Delivery Economy (Step 29F) ===\n');

assert(
  CANONICAL_ROAD_DELIVERY_ECONOMY_STATUS ===
    'CANONICAL_ROAD_DELIVERY_ECONOMY_PASS_SHADOW_ONLY',
  'status shadow-only',
);
assert(CANONICAL_ROAD_CONTRACT_GENERATION_CLASS === 'CLIENT_WORLD_STATE_DEPENDENT', 'B generation class');
assert(CANONICAL_ROAD_CONTRACT_AUTHORITY === 'CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED', 'C issuance required');
assert(resolveCanonicalRoadEconomyGate({ envValue: null }) === 'OFF', 'C gate missing OFF');
assert(resolveCanonicalRoadEconomyGate({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'C internal');
assert(CANONICAL_ROAD_ECONOMY_ENV_KEY === 'EXPO_PUBLIC_CANONICAL_ROAD_ECONOMY', 'env key');

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'A default complete');
assert(read('src/store/gameStore.ts').includes('startDelivery:'), 'A startDelivery remains');
assert(!read('src/store/gameStore.ts').includes('acceptCanonicalRoadDelivery'), 'A production start not switched');

assert(CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION === 1, 'J schema 1');
assert(CANONICAL_ROAD_DELIVERIES_COLLECTION === 'canonicalRoadDeliveries', 'I collection');

assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    cargoAmount: 10,
    canonicalSchemaVersion: 1,
    finalPayment: 5000,
  }),
  'E client payment rejected',
);
assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    cargoAmount: 10,
    canonicalSchemaVersion: 1,
    maintenanceCost: 80,
  }),
  'F client expenses rejected',
);

assert(lookupCanonicalRoadRoute('izmir', 'ankara')?.distanceKm === 585, 'L izmir-ankara');
assert(lookupCanonicalRoadRoute('izmir', 'ankara')?.tollCost === 120, 'P toll');
assert(lookupCanonicalRoadRoute('nope', 'ankara') == null, 'H unsupported route');

const issued = issueCanonicalRoadContractFromTrustedState({
  originCityId: 'izmir',
  destinationCityId: 'ankara',
  productId: 'steel',
  amount: 10,
  originMarket: buildFixtureMarket({ currentPrice: 1900, basePrice: 2000, stock: 90, targetStock: 30 }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2500,
    basePrice: 2000,
    stock: 8,
    targetStock: 60,
    consumptionPerDay: 18,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 3,
});
assert(issued.ok, 'G trusted issuance');
if (issued.ok) {
  assert(issued.snapshot.payment > 0, 'N payment derived');
  assert(issued.snapshot.deadlineHours >= 4, 'O deadline');
  assert(issued.snapshot.distanceKm === 585, 'L distance frozen');
  const deliveryId = createCanonicalRoadDeliveryId(issued.snapshot.contractId);
  assert(deliveryId === createCanonicalRoadDeliveryId(issued.snapshot.contractId), 'I id stable');
  const onTime = prepareCanonicalRoadDeliverySettlement({
    snapshot: issued.snapshot,
    deliveryId,
    outcome: 'COMPLETED',
    actualTravelHours: issued.snapshot.deadlineHours * 0.7,
  });
  const local = localProductionSettlementFromSnapshot(
    issued.snapshot,
    'COMPLETED',
    issued.snapshot.deadlineHours * 0.7,
  );
  assert(compareRoadSettlementShadow({ local, server: onTime }) === 'MATCH', 'AD on-time MATCH');
  assert(onTime.fuelChargedOnCompletion === 0, 'R fuel not on completion');
  assert(CANONICAL_ROAD_FUEL_ALREADY_PAID === true, 'R fuelAlreadyPaid');
  assert(CANONICAL_ROAD_COST_CLASSES.driverAtCompletion === 'NOT_CHARGED', 'S driver');
  assert(onTime.ledger.some((row) => row.transactionId === `delivery:${deliveryId}:revenue`), 'ledger revenue id');
}

assert(LEGACY_LOCAL_ONLY_DELIVERY === 'LEGACY_LOCAL_ONLY_DELIVERY', 'AB legacy');
assert(typeof CANONICAL_ROAD_ROUTE_PACKAGE_HASH === 'string' && CANONICAL_ROAD_ROUTE_PACKAGE_HASH.length > 0, 'AM hash');

const index = read('backend/src/index.ts');
assert(index.includes('export const acceptCanonicalRoadDelivery'), 'K callable');
assert(index.includes('export const reportCanonicalRoadDeliveryCompleted'), 'Z report callable');
assert(!index.includes('export const issueCanonicalRoadContract'), 'no public issue callable');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'no multimodal settle');
assert(!index.includes('export const applyCashDelta'), 'no delta API');

const backend = read('backend/src/canonicalRoadDelivery.ts');
assert(backend.includes('CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED'), 'H unverifiable rejected');
assert(backend.includes('alreadyAccepted'), 'J duplicate accept');
assert(backend.includes('CANONICAL_ROAD_DELIVERY_CONFLICT'), 'K conflict');
assert(backend.includes('alreadyReported'), 'V report idempotent');
assert(!backend.includes('runCanonicalCashMutation'), 'W no cash helper');
assert(!backend.includes('canonicalDeliveryCompletionRef'), 'AA count collection unused');

const rules = read('firestore.rules');
assert(/match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/.test(rules), 'AJ deliveries write false');
assert(/match \/canonicalRoadContracts\/\{contractId\}[\s\S]*?allow write: if false/.test(rules), 'AJ contracts write false');
assert(/match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/.test(rules), 'serverState still false');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AD overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AE listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AF settlement gate');
assert(SAVE_GAME_VERSION === 6, 'AG version 6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AH RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AH SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AH AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AI OFF');
assert(read('src/simulation/delivery.ts').includes('offline') || read('src/store/gameStore.ts').includes('offlineProgression'), 'AC offline still present');

assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_DELIVERY_ECONOMY.md').includes('SHADOW_ONLY'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29F'), 'plan');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
