/**
 * Map V2 Step 24 — production multimodal duration policy.
 * Run: npx tsx scripts/map-v2-multimodal-duration-policy-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  estimateDurationForPersistedShipment,
  estimateMultimodalShipmentDuration,
  estimateTransferDuration,
  estimateTransportLegDuration,
  gameHoursToGameSeconds,
  MULTIMODAL_DURATION_POLICY_VERSION,
  MULTIMODAL_LINE_HAUL_SPEED_KMH,
  MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS,
} from '../src/domain/multimodalDurationPolicy';
import {
  createTestPersistedMultimodalShipment,
  MULTIMODAL_FEATURE_ROLLOUT,
  normalizeMultimodalShipments,
} from '../src/domain/multimodalShipmentPersistence';
import { getMultimodalSettlementId } from '../src/domain/multimodalSettlementIdentity';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import { calculateContractDurationHours } from '../src/simulation/contractEconomics';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { createRuntimeFromFixture, DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR, getDevPlaybackWallMs } from '../src/mapV2/gameplay/multimodalRuntime';
import { buildRoadAirRoadFixture } from '../src/mapV2/gameplay/roadAirRoadFixture';
import { buildRoadRailRoadFixture } from '../src/mapV2/gameplay/roadRailRoadFixture';
import { buildRoadSeaRoadFixture } from '../src/mapV2/gameplay/roadSeaRoadFixture';
import { getTurkeyAirRouteDiagnostics } from '../src/mapV2/world/airRouteDiagnosticsLoader';
import { getTurkeyPortPackage } from '../src/mapV2/world/countryPortLoader';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../src/mapV2/world/railRouteDiagnosticsLoader';
import { getTurkeySeaRouteDiagnostics } from '../src/mapV2/world/seaRouteDiagnosticsLoader';

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const economyProbe = { cash: 44_000, fuel: 80, tolls: 12, maintenance: 5, reputation: 50, xp: 10 };
const before = { ...economyProbe };

console.log('\n=== Map V2 Multimodal Duration Policy ===\n');

assert(SAVE_GAME_VERSION === 6, 'SAVE_GAME_VERSION remains 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'rollout remains OFF');
assert(MULTIMODAL_DURATION_POLICY_VERSION === 'multimodal-duration-policy-v1', 'policy version string');
assert(
  read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_DURATION_POLICY.md').includes('game seconds'),
  'duration policy doc exists',
);
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('DEV_PLAYBACK'), 'production module has no DEV playback');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('mapV2/prototypes'), 'production module does not import prototypes');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('DEV_SIMULATION_SPEEDS'), 'production module has no DEV_SIMULATION_SPEEDS');
assert(read('src/mapV2/domain/multimodal.ts').includes("RAIL: 'FOUNDATION_ONLY'"), 'RAIL FOUNDATION_ONLY');
assert(read('src/mapV2/domain/multimodal.ts').includes("SEA: 'FOUNDATION_ONLY'"), 'SEA FOUNDATION_ONLY');
assert(read('src/mapV2/domain/multimodal.ts').includes("AIR: 'FOUNDATION_ONLY'"), 'AIR FOUNDATION_ONLY');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(!read('src/simulation/contracts.ts').includes('estimateMultimodalShipmentDuration'), 'generator does not call duration policy');
assert(!read('src/store/gameStore.ts').includes('estimateMultimodalShipmentDuration'), 'gameStore does not call duration policy');
assert(!read('backend/src/index.ts').includes('completeMultimodalShipment'), 'no Cloud Function added');

const roadInput = {
  distanceKm: 480,
  cargoTons: 12,
  routeDifficulty: 0.82,
  truckSpeedKmh: STARTER_TRUCK.speed,
  truckCapacityTons: STARTER_TRUCK.capacity,
  truckCondition: STARTER_TRUCK.condition,
  truckVehicleClass: STARTER_TRUCK.vehicleClass,
  truckCatalogId: STARTER_TRUCK.catalogId,
  driverSpeed: STARTER_DRIVER.speed,
  driverTier: STARTER_DRIVER.tier,
};
const roadHours = calculateContractDurationHours(roadInput).travelHours;
const roadLeg = estimateTransportLegDuration({
  legId: 'road.compat',
  mode: 'ROAD',
  distanceMeters: 480_000,
  distanceAuthority: 'PRODUCTION_ROAD_ROUTE',
  roadPlanning: {
    cargoTons: 12,
    routeDifficulty: 0.82,
    truckSpeedKmh: STARTER_TRUCK.speed,
    truckCapacityTons: STARTER_TRUCK.capacity,
    truckCondition: STARTER_TRUCK.condition,
    truckVehicleClass: STARTER_TRUCK.vehicleClass,
    truckCatalogId: STARTER_TRUCK.catalogId,
    driverSpeed: STARTER_DRIVER.speed,
    driverTier: STARTER_DRIVER.tier,
  },
});
assert(roadLeg.status === 'READY', 'ROAD estimate READY');
assert(
  roadLeg.durationGameSeconds === gameHoursToGameSeconds(roadHours, true),
  'ROAD planned seconds match calculateContractDurationHours.travelHours',
);

const railA = estimateTransportLegDuration({
  legId: 'rail.a',
  mode: 'RAIL',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
  routeReference: 'domain.canonical.rail.test.a',
});
const railB = estimateTransportLegDuration({
  legId: 'rail.a',
  mode: 'RAIL',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
  routeReference: 'domain.canonical.rail.test.a',
});
assert(railA.status === 'READY' && railA.durationGameSeconds != null && railA.durationGameSeconds > 0, 'RAIL synthetic READY');
assert(JSON.stringify(railA) === JSON.stringify(railB), 'determinism: identical RAIL JSON');

const sea = estimateTransportLegDuration({
  legId: 'sea.a',
  mode: 'SEA',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_SEA_LENGTH',
  routeReference: 'domain.canonical.sea.test.a',
});
const air = estimateTransportLegDuration({
  legId: 'air.a',
  mode: 'AIR',
  distanceMeters: 500_000,
  distanceAuthority: 'SOURCE_BACKED_AIR_GEODESIC',
  routeReference: 'domain.canonical.air.test.a',
});
assert(sea.status === 'READY' && (sea.durationGameSeconds ?? 0) > 0, 'SEA synthetic READY');
assert(air.status === 'READY' && (air.durationGameSeconds ?? 0) > 0, 'AIR synthetic READY');
assert(
  (air.durationGameSeconds ?? 0) < (railA.durationGameSeconds ?? 0) &&
    (railA.durationGameSeconds ?? 0) < (sea.durationGameSeconds ?? 0),
  'same distance: AIR < RAIL < SEA planned time',
);
assert(
  MULTIMODAL_LINE_HAUL_SPEED_KMH.AIR > MULTIMODAL_LINE_HAUL_SPEED_KMH.RAIL &&
    MULTIMODAL_LINE_HAUL_SPEED_KMH.RAIL > MULTIMODAL_LINE_HAUL_SPEED_KMH.SEA,
  'documented gameplay speed order',
);

const xferRail = estimateTransferDuration({ transferId: 't1', fromMode: 'ROAD', toMode: 'RAIL' });
const xferSea = estimateTransferDuration({ transferId: 't2', fromMode: 'SEA', toMode: 'ROAD' });
const xferAir = estimateTransferDuration({ transferId: 't3', fromMode: 'ROAD', toMode: 'AIR' });
assert(xferRail.status === 'READY' && xferRail.durationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_RAIL, 'ROAD↔RAIL transfer');
assert(xferSea.status === 'READY' && xferSea.durationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_SEA, 'ROAD↔SEA transfer');
assert(xferAir.status === 'READY' && xferAir.durationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_AIR, 'ROAD↔AIR transfer');
assert(estimateTransferDuration({ transferId: 'bad', fromMode: 'RAIL', toMode: 'SEA' }).status === 'UNSUPPORTED_TRANSFER', 'RAIL↔SEA fail closed');
assert(estimateTransferDuration({ transferId: 'bad', fromMode: 'RAIL', toMode: 'AIR' }).status === 'UNSUPPORTED_TRANSFER', 'RAIL↔AIR fail closed');

assert(
  estimateTransportLegDuration({
    legId: 'missing',
    mode: 'RAIL',
    distanceMeters: undefined,
    distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
    routeReference: 'domain.canonical.rail.x',
  }).status === 'MISSING_ROUTE_DISTANCE',
  'missing distance fail closed',
);
assert(
  estimateTransportLegDuration({
    legId: 'nan',
    mode: 'SEA',
    distanceMeters: Number.NaN,
    distanceAuthority: 'SOURCE_BACKED_SEA_LENGTH',
    routeReference: 'domain.canonical.sea.x',
  }).status === 'INVALID_DISTANCE',
  'NaN distance rejected',
);
assert(
  estimateTransportLegDuration({
    legId: 'inf',
    mode: 'AIR',
    distanceMeters: Number.POSITIVE_INFINITY,
    distanceAuthority: 'SOURCE_BACKED_AIR_GEODESIC',
    routeReference: 'domain.canonical.air.x',
  }).status === 'INVALID_DISTANCE',
  'Infinity distance rejected',
);
assert(
  estimateTransportLegDuration({
    legId: 'neg',
    mode: 'ROAD',
    distanceMeters: -10,
    distanceAuthority: 'PRODUCTION_ROAD_ROUTE',
  }).status === 'INVALID_DISTANCE',
  'negative distance rejected',
);
assert(
  estimateTransportLegDuration({
    legId: 'straight',
    mode: 'RAIL',
    distanceMeters: 100_000,
    distanceAuthority: 'PROVIDED_PLANNING_METERS',
    routeReference: 'domain.canonical.rail.x',
  }).status === 'INVALID_DISTANCE',
  'RAIL rejects non-source-backed authority (no straight-line fallback)',
);
assert(
  estimateTransportLegDuration({
    legId: 'noref',
    mode: 'SEA',
    distanceMeters: 100_000,
    distanceAuthority: 'SOURCE_BACKED_SEA_LENGTH',
  }).status === 'MISSING_ROUTE_REFERENCE',
  'SEA missing routeReference fail closed',
);

const unknownSchema = estimateMultimodalShipmentDuration({
  shipmentSchemaVersion: 99,
  legs: [
    {
      legId: 'x',
      mode: 'ROAD',
      distanceMeters: 1000,
      distanceAuthority: 'PROVIDED_PLANNING_METERS',
    },
  ],
  transfers: [],
});
assert(unknownSchema.status === 'UNSUPPORTED_SCHEMA', 'unknown schema not executable');

const unreadable = estimateDurationForPersistedShipment(
  normalizeMultimodalShipments([{ shipmentSchemaVersion: 99, shipmentId: 'mms_future' }])[0],
);
assert(unreadable.status === 'NOT_EXECUTABLE', 'unreadable persisted shipment not executable');

const malformed = estimateDurationForPersistedShipment({ not: 'a shipment' });
assert(malformed.status === 'INVALID_PLAN' || malformed.status === 'UNSUPPORTED_SCHEMA' || malformed.status === 'MISSING_ROUTE_DISTANCE', 'malformed shipment fail closed');

const sample = createTestPersistedMultimodalShipment();
assert(getMultimodalSettlementId(sample.shipmentId).ok, 'Step 23 identity still derivable');

const planned = estimateTransportLegDuration({
  legId: 'play',
  mode: 'AIR',
  distanceMeters: 350_000,
  distanceAuthority: 'SOURCE_BACKED_AIR_GEODESIC',
  routeReference: 'domain.canonical.air.play',
});
const playbackA = getDevPlaybackWallMs(planned.durationGameSeconds ?? 0);
assert(planned.durationGameSeconds != null && planned.durationGameSeconds > playbackA, 'planned game-s is not DEV playback ms');
assert(DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR === 1_000, 'DEV playback scale is inspector-only');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR'), 'playback constant lives outside production domain');

const foundation = getTurkeyMultimodalFoundation();
const railFix = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, getTurkeyRailRouteDiagnostics());
const seaFix = buildRoadSeaRoadFixture(
  'istanbul',
  'izmir',
  foundation,
  getTurkeySeaRouteDiagnostics(),
  getTurkeyPortPackage(),
);
const airFix = buildRoadAirRoadFixture('istanbul', 'ankara', foundation, getTurkeyAirRouteDiagnostics());
assert(railFix.ok && seaFix.ok && airFix.ok, 'accepted vertical-slice fixtures build');
if (railFix.ok && seaFix.ok && airFix.ok) {
  const railRt = createRuntimeFromFixture(railFix);
  const seaRt = createRuntimeFromFixture(seaFix);
  const airRt = createRuntimeFromFixture(airFix);
  assert(railRt.durationEstimate.status === 'READY' && (railRt.legStates[1].plannedDurationGameSeconds ?? 0) > 0, 'accepted RAIL route has planned duration');
  assert(seaRt.durationEstimate.status === 'READY' && (seaRt.legStates[1].plannedDurationGameSeconds ?? 0) > 0, 'accepted SEA route has planned duration');
  assert(airRt.durationEstimate.status === 'READY' && (airRt.legStates[1].plannedDurationGameSeconds ?? 0) > 0, 'accepted AIR route has planned duration');
  assert(railRt.legStates[1].durationSimMs === getDevPlaybackWallMs(railRt.legStates[1].plannedDurationGameSeconds), 'RAIL playback derived from planned');
  const plannedCopy = railRt.legStates[1].plannedDurationGameSeconds;
  assert(plannedCopy === estimateTransportLegDuration({
    legId: railRt.legStates[1].legId,
    mode: 'RAIL',
    distanceMeters: railRt.legStates[1].distanceMeters,
    distanceAuthority: 'SOURCE_BACKED_RAIL_LENGTH',
    routeReference: railFix.plan.legs[1].routeReference,
  }).durationGameSeconds, 'runtime planned duration matches policy');
}

assert(before.cash === economyProbe.cash && before.xp === economyProbe.xp, 'economy probe unchanged');
assert(!read('src/domain/multimodalDurationPolicy.ts').includes('getMultimodalSettlementId'), 'duration module does not call settlement ids');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
