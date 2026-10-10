/**
 * Map V2 Step 29Q canonical fuel tank / price authority.
 * Run: node --import tsx scripts/map-v2-canonical-fuel-tank-price-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_FUEL_TANK_PRICE_AUTHORITY_STATUS,
  CANONICAL_FUEL_PRICE_POLICY_VERSION,
  FUEL_CASH_AUTHORITY_STATUS as FUEL_READY_STATUS,
  ROADSIDE_FUEL_AUTHORITY_STATUS,
  FUEL_INCIDENT_AUTHORITY_STATUS,
  classifyCanonicalFuelAuthority,
  createCanonicalFuelConsumptionOperationId,
  createCanonicalFuelPurchaseOperationId,
  hasOnlyCanonicalFuelPurchaseKeys,
  isCanonicalFuelAuthorityAllowed,
  quoteCanonicalFuelPurchase,
  deriveCanonicalFuelPricePerLiter,
  deriveCanonicalRoadFuelRequirement,
} from '../src/domain/canonicalFuelTankPrice';
import { FUEL_CASH_AUTHORITY_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
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
import { buildInternalCanonicalFleetFixtureAssets } from '../src/domain/canonicalRoadFleet';

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

console.log('\n=== Map V2 Canonical Fuel Tank / Price Authority (Step 29Q) ===\n');

assert(
  CANONICAL_FUEL_TANK_PRICE_AUTHORITY_STATUS ===
    'CANONICAL_FUEL_TANK_PRICE_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('refuelTruck:'), 'A public refuel');
assert(!read('src/store/gameStore.ts').includes('purchaseCanonicalFuel'), 'A unwired');
assert(!read('src/components/TruckRefuelSheet.tsx').includes('purchaseCanonicalFuel'), 'A sheet');
assert(!read('src/components/RoadsideFuelSheet.tsx').includes('purchaseCanonicalFuel'), 'A roadside');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalFuelAuthorityAllowed({ envValue: null }) === false, 'C gate off');
assert(isCanonicalFuelAuthorityAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C internal');

const fixtures = buildInternalCanonicalFleetFixtureAssets('uid-a', 1);
const healthy = fixtures.find((row) => row.assetId === 'fixture-healthy');
assert(healthy != null, 'E fixture');
assert(classifyCanonicalFuelAuthority(healthy, { envValue: 'INTERNAL_TEST' }) === 'CANONICAL_FUEL_READY', 'E ready');
assert((healthy?.fuelCapacityL ?? 0) > 0, 'G capacity');
assert(typeof healthy?.currentFuelL === 'number', 'F initial');
assert(
  classifyCanonicalFuelAuthority(
    { ...healthy!, assetId: 'truck-starter-1', authorityClass: 'LEGACY_CLIENT_UNVERIFIED' as never },
    { envValue: 'INTERNAL_TEST' },
  ) === 'LEGACY_FLEET_UNVERIFIED' ||
    classifyCanonicalFuelAuthority(null, { envValue: 'INTERNAL_TEST' }) === 'LEGACY_FLEET_UNVERIFIED',
  'D legacy',
);

assert(deriveCanonicalFuelPricePerLiter(1.72).pricePerLiter === 1.72, 'H price');
assert(CANONICAL_FUEL_PRICE_POLICY_VERSION === 'canonical-fuel-price-v1', 'H policy');
assert(
  !hasOnlyCanonicalFuelPurchaseKeys({
    assetId: 'a',
    fuelPurchaseIntentId: 'intent-aa',
    mode: 'FILL_TO_CAPACITY',
    canonicalSchemaVersion: 1,
    currentFuelL: 1,
  }),
  'I current rejected',
);
assert(
  !hasOnlyCanonicalFuelPurchaseKeys({
    assetId: 'a',
    fuelPurchaseIntentId: 'intent-aa',
    mode: 'FILL_TO_CAPACITY',
    canonicalSchemaVersion: 1,
    fuelTankCapacityL: 1,
  }),
  'J capacity rejected',
);
assert(
  !hasOnlyCanonicalFuelPurchaseKeys({
    assetId: 'a',
    fuelPurchaseIntentId: 'intent-aa',
    mode: 'FILL_TO_CAPACITY',
    canonicalSchemaVersion: 1,
    pricePerLiter: 1,
  }),
  'K price rejected',
);
assert(
  !hasOnlyCanonicalFuelPurchaseKeys({
    assetId: 'a',
    fuelPurchaseIntentId: 'intent-aa',
    mode: 'FILL_TO_CAPACITY',
    canonicalSchemaVersion: 1,
    fuelCost: 1,
  }),
  'L cost rejected',
);

const q = quoteCanonicalFuelPurchase({
  asset: healthy!,
  mode: 'BUY_LITERS',
  requestedLiters: 25,
  pricePerLiter: 1.72,
});
assert(q.ok, 'M quote');
if (q.ok) {
  assert(q.litersToAdd <= 25, 'M bounded');
  assert(q.cost === Math.round(Number((q.litersToAdd * 1.72).toFixed(2))), 'N cost exact');
}

assert(
  createCanonicalFuelPurchaseOperationId('fixture-healthy', 'fuelbuy01') ===
    'fuel:fixture-healthy:fuelbuy01',
  'Q id',
);
assert(
  createCanonicalFuelConsumptionOperationId('fixture-healthy', 'crd_x') ===
    'fuel:fixture-healthy:delivery:crd_x',
  'AD consume id',
);
assert(read('backend/src/canonicalFuel.ts').includes('alreadyApplied'), 'S retry');
assert(read('backend/src/canonicalFuel.ts').includes('notNeeded'), 'V full');
assert(read('backend/src/canonicalFuel.ts').includes('INSUFFICIENT_CASH') === false, 'W nsf via helper');
assert(read('backend/src/canonicalFuel.ts').includes('quoteCanonicalFuelPurchase'), 'Y quote not client');
assert(read('backend/src/canonicalRoadDelivery.ts').includes('applyCanonicalFuelAcceptBurnInTransaction'), 'AA accept wired');
assert(read('backend/src/canonicalFuel.ts').includes('CANONICAL_FUEL_INSUFFICIENT'), 'AA insufficient');
assert(read('backend/src/canonicalFuel.ts').includes('ACCEPT_BURN'), 'AB consume');
assert(read('backend/src/canonicalFuel.ts').includes('operationType: \'CONSUMPTION\''), 'AE receipt');
assert(ROADSIDE_FUEL_AUTHORITY_STATUS.includes('BLOCKED'), 'AI roadside');
assert(FUEL_INCIDENT_AUTHORITY_STATUS.includes('INCIDENT'), 'AJ incident');
const req = deriveCanonicalRoadFuelRequirement({
  truckAsset: healthy!,
  trailerAsset: null,
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  amount: 10,
  payment: 1000,
});
assert(req.ok && req.ok && req.requiredFuelL > 0, 'Z requirement');

assert(!read('src/services/cloudSaveService.ts').includes('currentFuelL: 9999'), 'AE isolation');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AI overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AJ listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AK version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AL settlement');
assert(SAVE_GAME_VERSION === 6, 'AM v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AN RAIL');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AO OFF');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');

const coverage = getSignedInCashAuthorityCoverage();
assert(FUEL_CASH_AUTHORITY_STATUS === FUEL_READY_STATUS, 'fuel status align');
assert(coverage.criticalSignedInCashPathsTotal === 24, 'AZ 24');
assert(coverage.criticalCanonicalizedCount === 0, 'BA still 0');
assert(coverage.criticalBlockedCount === 24, 'BB 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BC');
assert(coverage.rows.find((row) => row.auditId === 'road-fuel')?.hudRole === 'BLOCKS_HUD_AUTHORITY', 'BD fuel still blocks HUD');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    fuel: FUEL_CASH_AUTHORITY_STATUS,
    readiness: coverage.readiness,
  }),
);
