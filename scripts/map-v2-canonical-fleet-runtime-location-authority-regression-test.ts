/**
 * Map V2 Step 29AC canonical fleet runtime location.
 * Run: node --import tsx scripts/map-v2-canonical-fleet-runtime-location-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_FLEET_RUNTIME_LOCATION_STATUS,
  CANONICAL_FLEET_RUNTIME_POLICY_VERSION,
  CONTRACT_HOME_CITY_WEIGHT_AUTHORITY,
  FLEET_RUNTIME_RECOVERY,
  FLEET_RUNTIME_TRANSFER,
  INTERNAL_FIXTURE_RUNTIME_CITY_ID,
  createInternalFixtureRuntime,
  deriveCanonicalFleetAvailabilitySummary,
  isCanonicalFleetRuntimeAllowed,
  planCanonicalFleetRuntimeTransition,
  productionOriginCityWeight,
} from '../src/domain/canonicalFleetRuntimeLocation';
import { CONTRACT_REFRESH_GAME_TIME_PARITY } from '../src/domain/canonicalContractWorldEvents';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../src/domain/canonicalProductionRoadContractIssuance';
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

console.log('\n=== Map V2 Canonical Fleet Runtime Location (Step 29AC) ===\n');

const store = read('src/store/gameStore.ts');
const index = read('backend/src/index.ts');
const delivery = read('src/simulation/delivery.ts');
const rules = read('firestore.rules');
const runtime = read('src/domain/canonicalFleetRuntimeLocation.ts');
const accept = read('backend/src/canonicalRoadDelivery.ts');

assert(store.includes('buyTruck'), 'A public fleet remains');
assert(!store.includes('canonicalFleetRuntime'), 'A store unwired');
assert(store.includes('Guests'), 'B guest');
assert(isCanonicalFleetRuntimeAllowed({ envValue: null }) === false, 'C gate off');
assert(!index.includes('setTruckLocation'), 'D no location setter');
assert(runtime.includes('LEGACY_CLIENT_UNVERIFIED'), 'E legacy');
assert(runtime.includes('FLEET_RUNTIME_LOCATION_UNAVAILABLE'), 'F missing runtime');
assert(rules.includes('canonicalFleetRuntime') && rules.includes('allow write: if false'), 'G rules');
assert(runtime.includes('isCanonicalRoadCityId'), 'H city');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ currentCityId: 'izmir' }) === false, 'I city field');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ truckStatus: 'idle' }) === false, 'J status');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ activeDeliveryId: 'd' }) === false, 'K delivery');
const fixture = createInternalFixtureRuntime({ assetId: 't', ownerUid: 'u', serverNowMs: 1 });
assert(fixture.currentCityId === INTERNAL_FIXTURE_RUNTIME_CITY_ID && fixture.authorityClass === 'INTERNAL_TEST_RUNTIME_FIXTURE', 'L fixture');
assert(fixture.currentCityId === 'izmir', 'L M N starter purchase lease fallback city');
const started = planCanonicalFleetRuntimeTransition(fixture, {
  kind: 'START',
  deliveryId: 'd1',
  originCityId: 'izmir',
  destinationCityId: 'ankara',
}, 2);
assert(started.ok === true, 'O start');
if (started.ok) {
  assert(started.state.runtimeStatus === 'on_route' && started.state.currentCityId === 'izmir', 'O P Q in transit keeps origin');
  assert(started.state.runtimeRevision === 2, 'Y revision');
  const done = planCanonicalFleetRuntimeTransition(started.state, { kind: 'COMPLETE' }, 3);
  assert(done.ok && done.state.currentCityId === 'ankara' && done.state.runtimeStatus === 'idle', 'R complete');
  const cancelled = planCanonicalFleetRuntimeTransition(started.state, { kind: 'CANCEL' }, 3);
  assert(cancelled.ok && cancelled.state.currentCityId === 'izmir' && cancelled.state.runtimeStatus === 'idle', 'S cancel');
  const failed = planCanonicalFleetRuntimeTransition(started.state, { kind: 'FAIL_SERVER' }, 3);
  assert(failed.ok && failed.state.currentCityId === 'izmir', 'T server fail returns origin');
  const client = planCanonicalFleetRuntimeTransition(started.state, { kind: 'FAIL_CLIENT_UNVERIFIED' }, 3);
  assert(client.ok && client.state.currentCityId === 'izmir' && client.state.failureLocationClass === 'CLIENT_REPORTED_UNVERIFIED', 'U client fail');
  const dry = planCanonicalFleetRuntimeTransition(started.state, { kind: 'FUEL_OUT' }, 3);
  assert(dry.ok && dry.state.runtimeStatus === 'out_of_fuel', 'V fuel out');
  if (dry.ok) {
    const refuel = planCanonicalFleetRuntimeTransition(dry.state, { kind: 'ROADSIDE_REFUEL_RESUME' }, 4);
    assert(refuel.ok && refuel.state.runtimeStatus === 'on_route' && refuel.state.currentCityId === 'izmir', 'U roadside');
  }
}
assert(planCanonicalFleetRuntimeTransition(fixture, {
  kind: 'START',
  deliveryId: 'd2',
  originCityId: 'ankara',
  destinationCityId: 'izmir',
}, 2).ok === false, 'P origin');
assert(delivery.includes("status: 'idle'") && delivery.includes('destinationCityId'), 'R production arrival');
assert(delivery.includes('delivery.originCityId'), 'S production fail origin');
assert(FLEET_RUNTIME_RECOVERY === 'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE', 'V recovery');
assert(FLEET_RUNTIME_TRANSFER === 'FLEET_RUNTIME_TRANSFER_CLIENT_OWNED', 'W transfer');
assert(accept.includes('planCanonicalFleetRuntimeTransition'), 'AK accept');
assert(accept.includes('TRUCK_NOT_AT_ORIGIN') || accept.includes('plannedRuntime.reason'), 'N origin check');
const summary = deriveCanonicalFleetAvailabilitySummary([
  { assetId: 'sold', capacity: 90, lifecycleStatus: 'SOLD', runtime: fixture },
  { assetId: 'idle', capacity: 25, lifecycleStatus: 'ACTIVE', runtime: fixture },
  {
    assetId: 'busy',
    capacity: 30,
    lifecycleStatus: 'ACTIVE',
    runtime: started.ok ? started.state : fixture,
  },
]);
assert(summary.ok === true, 'AD summary');
if (summary.ok) {
  assert(summary.summary.idleOriginCities.join() === 'izmir', 'AE idle cities');
  assert(summary.summary.idleMaxCapacityTons === 25, 'AF idle capacity');
  assert(summary.summary.ownedMaxCapacityTons === 30, 'AF owned includes busy');
  assert(summary.summary.idleTruckCount === 1, 'AG W X sold and busy excluded from idle');
}
assert(productionOriginCityWeight('izmir', {
  idleTruckOriginCityIds: ['izmir'],
  busyTruckOriginCityIds: [],
  activeDeliveryDestinationCityIds: [],
  marketOpportunityOriginCityIds: [],
}) === 45, 'AI idle score');
assert(productionOriginCityWeight('ankara', {
  idleTruckOriginCityIds: [],
  busyTruckOriginCityIds: [],
  activeDeliveryDestinationCityIds: [],
  marketOpportunityOriginCityIds: [],
}) === 5, 'AJ other city');
assert(CONTRACT_HOME_CITY_WEIGHT_AUTHORITY === 'CONTRACT_HOME_CITY_WEIGHT_NOT_A_SEPARATE_SCORE', 'home');
assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'AY');
assert(CONTRACT_REFRESH_GAME_TIME_PARITY === 'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY', 'refresh');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3.includes('v3'), 'AP');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION.includes('v1'), 'AO');
assert(CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2.includes('v2'), 'AO v2');
assert(!runtime.includes('applyCanonicalCashMutations'), 'AQ cash');
assert(!runtime.includes('financeLedger'), 'AT ledger');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AU');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AV');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AW');
assert(canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 0,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
}).ready === false, 'AX');
assert(SAVE_GAME_VERSION === 6, 'AY save');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AZ');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AZ sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AZ air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BA');
assert(CANONICAL_FLEET_RUNTIME_LOCATION_STATUS === 'CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY_PASS_INTERNAL_ONLY', 'status');
assert(CANONICAL_FLEET_RUNTIME_POLICY_VERSION === 'canonical-fleet-runtime-location-internal-v1', 'policy');
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'coverage');
assert(coverage.criticalCanonicalizedCount === 0, 'canonical');
assert(coverage.criticalBlockedCount === 24, 'blocked');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(JSON.stringify({
  CANONICAL_FLEET_RUNTIME_LOCATION_STATUS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
  CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
  CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
}));
