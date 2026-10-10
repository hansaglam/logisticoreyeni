/**
 * Map V2 Step 29H canonical ROAD execution economics.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-road-execution-economics-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  ROAD_CANONICAL_SETTLEMENT_READINESS,
  resolveCanonicalRoadContractsGate,
} from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_ROAD_COST_CLASSES,
  LEGACY_LOCAL_ONLY_DELIVERY,
  hasOnlyCanonicalRoadAcceptKeys,
  hasOnlyCanonicalRoadCompleteKeys,
  resolveCanonicalRoadEconomyGate,
} from '../src/domain/canonicalRoadDelivery';
import {
  buildFixtureMarket,
  issueCanonicalRoadContractFromTrustedState,
  prepareCanonicalRoadDeliverySettlement,
} from '../src/domain/canonicalRoadEconomics';
import {
  CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
  CANONICAL_ROAD_EXECUTION_ECONOMICS_STATUS,
  CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
  CANONICAL_ROAD_TRUCK_FIXTURES,
  DRIVER_SETTLEMENT_RELEVANCE,
  ROAD_EXECUTION_ECONOMICS_POLICY_VERSION,
  TRAILER_ECONOMICS_SERVER_AUTHORITY,
  TRUCK_ECONOMICS_SERVER_AUTHORITY,
  buildCanonicalRoadTrailerFixture,
  computeLiveParityRoadCompletion,
  diagnoseRoadSettlementMismatch,
  freezeCanonicalRoadExecutionEconomics,
} from '../src/domain/canonicalRoadExecutionEconomics';
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

console.log('\n=== Map V2 Canonical ROAD Execution Economics (Step 29H) ===\n');

assert(
  CANONICAL_ROAD_EXECUTION_ECONOMICS_STATUS ===
    'CANONICAL_ROAD_EXECUTION_ECONOMICS_PASS_INTERNAL_TRUCK_POLICY_ONLY',
  'status internal truck policy',
);
assert(resolveCanonicalRoadEconomyGate({ envValue: null }) === 'OFF', 'B gate OFF');
assert(resolveCanonicalRoadContractsGate({ envValue: null }) === 'OFF', 'B contracts OFF');
assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'A production complete');
assert(read('src/store/gameStore.ts').includes('startDelivery:'), 'A startDelivery');
assert(!read('src/store/gameStore.ts').includes('acceptCanonicalRoadDelivery'), 'A store unwired');
assert(read('src/simulation/contracts.ts').includes('export function generateContracts'), 'A generator');
assert(TRUCK_ECONOMICS_SERVER_AUTHORITY === 'TRUCK_ECONOMICS_SERVER_AUTHORITY_MISSING', 'F truck auth');
assert(TRAILER_ECONOMICS_SERVER_AUTHORITY === 'TRAILER_ECONOMICS_SERVER_AUTHORITY_MISSING', 'G trailer auth');
assert(DRIVER_SETTLEMENT_RELEVANCE === 'DRIVER_NOT_SETTLEMENT_RELEVANT', 'S driver');
assert(ROAD_EXECUTION_ECONOMICS_POLICY_VERSION === 'road-execution-economics-v1', 'I policy');
assert(LEGACY_LOCAL_ONLY_DELIVERY === 'LEGACY_LOCAL_ONLY_DELIVERY', 'E legacy');

assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    canonicalSchemaVersion: 1,
    maintenanceCost: 80,
  }),
  'F client maintenance rejected',
);
assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    canonicalSchemaVersion: 1,
    tollCost: 10,
  }),
  'G client toll rejected',
);
assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    canonicalSchemaVersion: 1,
    fuelCost: 4,
  }),
  'H client fuel rejected',
);
assert(
  !hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'COMPLETED',
    actualTravelHours: 1,
    canonicalSchemaVersion: 1,
    fragileSurcharge: 5,
  }),
  'I client fragile rejected',
);
assert(
  !hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'COMPLETED',
    actualTravelHours: 1,
    canonicalSchemaVersion: 1,
    latePenalty: 5,
  }),
  'J client late rejected',
);
assert(
  !hasOnlyCanonicalRoadCompleteKeys({
    deliveryId: 'd',
    outcome: 'FAILED',
    actualTravelHours: 1,
    canonicalSchemaVersion: 1,
    failurePenalty: 5,
  }),
  'K client failure rejected',
);
assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    canonicalSchemaVersion: 1,
    condition: 1,
  }),
  'N client condition rejected',
);
assert(
  !hasOnlyCanonicalRoadAcceptKeys({
    contractId: 'c',
    canonicalSchemaVersion: 1,
    upgrades: { engine: 3 },
  }),
  'O client upgrades rejected',
);

const issuedShort = issueCanonicalRoadContractFromTrustedState({
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
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
  sequence: 1,
});
const issuedLong = issueCanonicalRoadContractFromTrustedState({
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
  sequence: 2,
});
assert(issuedShort.ok && issuedLong.ok, 'D issued contracts');

function parity(
  label: string,
  snapshot: import('../src/domain/canonicalRoadEconomics').CanonicalRoadContractSnapshot,
  truckId: string,
  trailerId: string | null,
  outcome: 'COMPLETED' | 'FAILED',
  ratio: number,
  contractType: 'standard' | 'fragile' = 'standard',
): void {
  const frozen = freezeCanonicalRoadExecutionEconomics({
    contract: snapshot,
    selectedTruckId: truckId,
    selectedTrailerId: trailerId,
    contractType,
  });
  assert(frozen.ok, `${label} freeze`);
  if (!frozen.ok) return;
  assert(frozen.snapshot.truckEconomicProfile.truckId === truckId, `${label} L truck id`);
  if (trailerId) {
    assert(frozen.snapshot.trailerEconomicProfile.trailerId === trailerId, `${label} M trailer id`);
  }
  assert(frozen.snapshot.truckEconomicProfile.source === 'INTERNAL_TEST_FIXTURE', `${label} N condition source`);
  assert(frozen.snapshot.maintenanceSnapshot.bundle === frozen.snapshot.maintenanceSnapshot.bundle, `${label} P immutable`);
  assert(frozen.snapshot.tollSnapshot.amount === Math.round(snapshot.tollCost), `${label} Q toll`);
  assert(frozen.snapshot.fuelPolicySnapshot.completionFuelCharge === 0, `${label} R fuel 0`);
  assert(frozen.snapshot.driverSettlement === 'DRIVER_NOT_SETTLEMENT_RELEVANT', `${label} S driver 0`);
  const truck = CANONICAL_ROAD_TRUCK_FIXTURES[truckId]!;
  const trailer = trailerId ? buildCanonicalRoadTrailerFixture(truck.id) : null;
  const hours = snapshot.deadlineHours * ratio;
  const local = computeLiveParityRoadCompletion({
    contract: snapshot,
    truck,
    trailer,
    fuelPricePerLiter: 1.72,
    outcome,
    actualTravelHours: hours,
    contractType,
  });
  const server = prepareCanonicalRoadDeliverySettlement({
    snapshot,
    deliveryId: `crd_${snapshot.contractId}`,
    outcome,
    actualTravelHours: hours,
    executionEconomics: frozen.snapshot,
  });
  const mismatches = diagnoseRoadSettlementMismatch({ local, server });
  assert(mismatches.length === 0, `${label} ${mismatches.join(',')}`);
  assert(local.netCashDelta === server.netCashDelta, `${label} AB net`);
  assert(Number.isInteger(server.netCashDelta), `${label} integer`);
}

if (issuedShort.ok && issuedLong.ok) {
  const short = issuedShort.snapshot;
  const long = issuedLong.snapshot;
  parity('T early', short, 'fixture-healthy', null, 'COMPLETED', 0.5);
  parity('U on-time', short, 'fixture-healthy', null, 'COMPLETED', 0.9);
  parity('V late-minor', short, 'fixture-healthy', null, 'COMPLETED', 1.2);
  parity('W late-major', short, 'fixture-healthy', null, 'COMPLETED', 1.6);
  parity('X failure', short, 'fixture-healthy', null, 'FAILED', 3);
  parity('Y degraded', short, 'fixture-degraded', null, 'COMPLETED', 0.9);
  parity('Z upgraded', short, 'fixture-upgraded', null, 'COMPLETED', 0.9);
  parity('AA trailer', short, 'fixture-healthy', CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID, 'COMPLETED', 0.9);
  parity('AJ long', long, 'fixture-healthy', null, 'COMPLETED', 0.9);
  parity('AK short', short, 'fixture-healthy', null, 'COMPLETED', 0.9);
  parity('AL fragile', short, 'fixture-degraded', null, 'COMPLETED', 0.9, 'fragile');
  parity('AM no-fragile', short, 'fixture-healthy', null, 'COMPLETED', 0.9, 'standard');

  const healthy = freezeCanonicalRoadExecutionEconomics({
    contract: short,
    selectedTruckId: 'fixture-healthy',
  });
  const degraded = freezeCanonicalRoadExecutionEconomics({
    contract: short,
    selectedTruckId: 'fixture-degraded',
  });
  if (healthy.ok && degraded.ok) {
    assert(
      healthy.snapshot.maintenanceSnapshot.bundle !== degraded.snapshot.maintenanceSnapshot.bundle,
      'Y maintenance differs',
    );
    assert(healthy.snapshot.truckEconomicProfile.truckId === CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID, 'L default id');
  }

  const unknown = freezeCanonicalRoadExecutionEconomics({
    contract: short,
    selectedTruckId: 'save-truck-1',
  });
  assert(!unknown.ok, 'D live truck rejected');
}

assert(CANONICAL_ROAD_COST_CLASSES.fuelAtCompletion === 'NOT_CHARGED', 'R class fuel');
assert(CANONICAL_ROAD_COST_CLASSES.driverAtCompletion === 'NOT_CHARGED', 'S class driver');

const backend = read('backend/src/canonicalRoadDelivery.ts');
assert(backend.includes('executionEconomicsSnapshot'), 'H snapshot path');
assert(backend.includes('COMPLETION_CONFLICT'), 'AC conflict');
assert(backend.includes('alreadyReported'), 'AB idempotent');
assert(!backend.includes('runCanonicalCashMutation'), 'AC no cash helper');
assert(read('backend/src/index.ts').includes('selectedTruckId'), 'client ids allowed');
assert(!read('backend/src/index.ts').includes('export const applyCashDelta'), 'no delta');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'AW no multimodal settle');

const rules = read('firestore.rules');
assert(/match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/.test(rules), 'writes false');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AG overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AH listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AI settlement gate');
assert(SAVE_GAME_VERSION === 6, 'AJ v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AK RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AK SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AK AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AL OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BH production fleet blocker',
);
assert(read('src/store/gameStore.ts').includes('guest') || read('src/store/gameStore.ts').includes('Guest'), 'C guest store');
assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_EXECUTION_ECONOMICS.md').includes('INTERNAL_TRUCK_POLICY'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29H'), 'plan');
assert(read('docs/architecture/map-v2/ROAD_CASH_CANONICALIZATION_MATRIX.md').includes('29I'), 'matrix');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
