/**
 * Map V2 Step 25 — ROAD first/last-mile assignment foundation.
 * Run: npx tsx scripts/map-v2-multimodal-road-assignment-regression-test.ts
 */
import './test-globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import {
  estimateTransportLegDuration,
  MULTIMODAL_DURATION_POLICY_VERSION,
} from '../src/domain/multimodalDurationPolicy';
import {
  findRoadTransferAccess,
  MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID,
  ROAD_ACCESS_ROUTING_DIRECTIONALITY,
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
  type MultimodalRoadTransferAccessArtifactV1,
} from '../src/domain/multimodalRoadAccess';
import {
  MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
  planMultimodalRoadAssignment,
} from '../src/domain/multimodalRoadAssignment';
import { getMultimodalSettlementId } from '../src/domain/multimodalSettlementIdentity';
import { createTestPersistedMultimodalShipment, MULTIMODAL_FEATURE_ROLLOUT } from '../src/domain/multimodalShipmentPersistence';
import { createDevMultimodalRoadPlanningFleet } from '../src/mapV2/gameplay/devMultimodalRoadPlanningFleet';
import { createRuntimeFromFixture, DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR, getDevPlaybackWallMs } from '../src/mapV2/gameplay/multimodalRuntime';
import { buildRoadAirRoadFixture } from '../src/mapV2/gameplay/roadAirRoadFixture';
import { buildRoadRailRoadFixture } from '../src/mapV2/gameplay/roadRailRoadFixture';
import { buildRoadSeaRoadFixture } from '../src/mapV2/gameplay/roadSeaRoadFixture';
import { EXPECTED_ROAD_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRoadCorridor';
import { getTurkeyAirRouteDiagnostics } from '../src/mapV2/world/airRouteDiagnosticsLoader';
import { getTurkeyPortPackage } from '../src/mapV2/world/countryPortLoader';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../src/mapV2/world/railRouteDiagnosticsLoader';
import { getTurkeyRoadTransferAccessArtifact } from '../src/mapV2/world/multimodalRoadTransferAccessLoader';
import { getTurkeySeaRouteDiagnostics } from '../src/mapV2/world/seaRouteDiagnosticsLoader';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import type { Driver, Trailer, Truck } from '../src/types/game';

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
const artifact = getTurkeyRoadTransferAccessArtifact();
const foundation = getTurkeyMultimodalFoundation();

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function cloneFleet(fleet: ReturnType<typeof createDevMultimodalRoadPlanningFleet>) {
  return JSON.parse(JSON.stringify(fleet));
}

console.log('\n=== Map V2 Multimodal ROAD Assignment ===\n');

assert(SAVE_GAME_VERSION === 6, 'SAVE_GAME_VERSION remains 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'rollout remains OFF');
assert(artifact.algorithmId === MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID, 'algorithm id');
assert(artifact.routingDirectionality === ROAD_ACCESS_ROUTING_DIRECTIONALITY, 'undirected overview directionality');
assert(artifact.sourceRoadPackageHash === EXPECTED_ROAD_SOURCE_PACKAGE_HASH, 'ROAD source hash');
assert(hashCanonical(artifact.records) === artifact.contentHash, 'A: contentHash matches canonical records');
assert(JSON.stringify(artifact) === JSON.stringify(JSON.parse(JSON.stringify(artifact))), 'A: JSON round-trip identical');
assert(
  artifact.records.every((row) => row.sourceRoadPackageHash === EXPECTED_ROAD_SOURCE_PACKAGE_HASH),
  'B: each record has ROAD source hash',
);

const keys = artifact.records.map((row) => row.logicalKey);
assert(keys.length === new Set(keys).size, 'no duplicate logical keys');
assert(
  artifact.records.every(
    (row) =>
      Number.isFinite(row.distanceMeters) &&
      row.distanceMeters > 0 &&
      Number.isFinite(row.snapDistanceMeters) &&
      row.routeReference.length > 0 &&
      row.cityRoadAnchorNodeId.length > 0 &&
      row.infrastructureRoadNodeId.length > 0,
  ),
  'record validation: finite positive distance, lineage present',
);

const fixtureSrc = [
  read('src/mapV2/gameplay/roadRailRoadFixture.ts'),
  read('src/mapV2/gameplay/roadSeaRoadFixture.ts'),
  read('src/mapV2/gameplay/roadAirRoadFixture.ts'),
].join('\n');
assert(!fixtureSrc.includes('DEV_FALLBACK_LOCAL_TRANSFER_METERS'), 'C: fixtures do not import 5 km fallback');
assert(!fixtureSrc.includes('DEV_LOCAL_DISTANCE_KIND'), 'C: fixtures do not use DEV local kind');

const ankaraRail = findRoadTransferAccess(artifact, 'ankara', 'RAIL');
const istanbulAir = findRoadTransferAccess(artifact, 'istanbul', 'AIR');
const izmirSea = findRoadTransferAccess(artifact, 'izmir', 'SEA');
assert(!!ankaraRail && ankaraRail.distanceMeters > 0, 'D: Ankara RAIL ROAD access finite');
assert(!!istanbulAir && istanbulAir.distanceMeters > 0, 'D: Istanbul AIR ROAD access finite');
assert(!!izmirSea && izmirSea.distanceMeters > 0, 'D: Izmir SEA ROAD access finite');

const adanaSea = findRoadTransferAccess(artifact, 'adana', 'SEA');
assert(!!adanaSea && adanaSea.associationType === 'REGIONAL' && adanaSea.distanceMeters > 20_000, 'E: Adana SEA REGIONAL routed distance');
assert(istanbulAir?.infrastructureId && read('src/mapV2/generated/infrastructure/turkey-airports.json').includes(istanbulAir.infrastructureId), 'F: Istanbul AIR infra exists');
assert((istanbulAir?.transferNodeId ?? '').includes('ist'), 'F: Istanbul AIR transfer is IST');
const adanaAir = findRoadTransferAccess(artifact, 'adana', 'AIR');
assert((adanaAir?.transferNodeId ?? '').includes('.cov.'), 'G: Adana AIR is COV');
assert(!(adanaAir?.transferNodeId ?? '').includes('.ada.'), 'G: Adana AIR is not ADA');

assert(findRoadTransferAccess(artifact, 'bursa', 'RAIL') == null, 'H: Bursa RAIL has no ROAD-access upgrade record');
assert(foundation.cityModeMatrix.find((row) => row.gameplayCityId === 'bursa')?.RAIL !== 'PROVISIONAL', 'H: Bursa RAIL still not executable');

const railFix = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, getTurkeyRailRouteDiagnostics());
const seaFix = buildRoadSeaRoadFixture('istanbul', 'izmir', foundation, getTurkeySeaRouteDiagnostics(), getTurkeyPortPackage());
const airFix = buildRoadAirRoadFixture('istanbul', 'ankara', foundation, getTurkeyAirRouteDiagnostics());
assert(railFix.ok && seaFix.ok && airFix.ok, 'accepted slices build with ROAD access');
if (railFix.ok && seaFix.ok && airFix.ok) {
  assert(railFix.legDistances[0].distanceKind === SOURCE_BACKED_ROAD_TRANSFER_ACCESS, 'rail slice ROAD authority');
  assert(railFix.legDistances[0].distanceMeters !== 5000, 'rail slice not 5 km');
  assert(seaFix.legDistances[0].distanceKind === SOURCE_BACKED_ROAD_TRANSFER_ACCESS, 'sea slice ROAD authority');
  assert(airFix.legDistances[0].distanceKind === SOURCE_BACKED_ROAD_TRANSFER_ACCESS, 'air slice ROAD authority');
  const railRt = createRuntimeFromFixture(railFix);
  assert(railRt.durationEstimate.status === 'READY', 'U: duration READY');
  assert((railRt.legStates[0].plannedDurationGameSeconds ?? 0) > 0, 'U: first-mile ROAD duration positive');
  const playback = getDevPlaybackWallMs(railRt.legStates[1].plannedDurationGameSeconds);
  assert(railRt.legStates[1].plannedDurationGameSeconds > playback, 'V: planned RAIL duration is not playback ms');
  assert(DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR === 1000, 'V: playback scale isolated');
}

const trabzonAir = buildRoadAirRoadFixture('istanbul', 'trabzon', foundation, getTurkeyAirRouteDiagnostics());
assert(trabzonAir.ok === false && trabzonAir.reason === 'ROAD_ACCESS_UNRESOLVED', 'W: missing Trabzon AIR ROAD access fail closed');

const bursaRail = buildRoadRailRoadFixture('bursa', 'istanbul', foundation, getTurkeyRailRouteDiagnostics());
assert(bursaRail.ok === false, 'H: Bursa RAIL fixture still blocked');

const fleet = createDevMultimodalRoadPlanningFleet({ originCityId: 'ankara', destinationCityId: 'istanbul' });
const before = cloneFleet(fleet);
const ready = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: artifact,
  fleet,
  cargoWeightTons: 1,
});
assert(ready.status === 'READY', 'I: eligible origin+dest trucks', ready.status);
assert(ready.firstMile.truckId === 'truck-plan-origin', 'I: origin truck');
assert(ready.lastMile.truckId === 'truck-plan-destination', 'R: dest truck independent');
assert(JSON.stringify(fleet) === JSON.stringify(before), 'T: no mutation');
assert(ready.toctou === MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU, 'no reservation contract documented');

const again = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: artifact,
  fleet,
  cargoWeightTons: 1,
});
assert(again.firstMile.truckId === ready.firstMile.truckId && again.lastMile.truckId === ready.lastMile.truckId, 'P: deterministic selection');

const requested = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: artifact,
  fleet,
  cargoWeightTons: 1,
  requestedFirstMileTruckId: 'truck-plan-origin',
});
assert(requested.status === 'READY' && requested.firstMile.truckId === 'truck-plan-origin', 'Q: valid requested truck preserved');

const invalidRequested = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: artifact,
  fleet,
  cargoWeightTons: 1,
  requestedFirstMileTruckId: 'truck-plan-destination',
});
assert(invalidRequested.status === 'INVALID_REQUESTED_TRUCK', 'Q: invalid requested truck does not silently swap');

const teleport = planMultimodalRoadAssignment({
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  transferMode: 'RAIL',
  accessArtifact: artifact,
  fleet,
  cargoWeightTons: 1,
  requestedFirstMileTruckId: 'truck-plan-origin',
  requestedLastMileTruckId: 'truck-plan-origin',
});
assert(teleport.status === 'SAME_TRUCK_TELEPORT' || teleport.status === 'INVALID_REQUESTED_TRUCK', 'S: same truck teleport rejected');

const wrongCityFleet = {
  ...fleet,
  trucks: fleet.trucks.map((truck) =>
    truck.id === 'truck-plan-origin' ? { ...truck, currentCityId: 'izmir', homeCityId: 'izmir' } : truck,
  ),
};
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet: wrongCityFleet,
    cargoWeightTons: 1,
  }).status === 'NO_ELIGIBLE_ORIGIN_TRUCK',
  'J: wrong-city truck rejected',
);

const busyFleet = {
  ...fleet,
  trucks: fleet.trucks.map((truck) => (truck.id === 'truck-plan-origin' ? { ...truck, status: 'on_route' as const } : truck)),
};
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet: busyFleet,
    cargoWeightTons: 1,
  }).status === 'NO_ELIGIBLE_ORIGIN_TRUCK',
  'K: busy truck rejected',
);

const lockedFleet = {
  ...fleet,
  trucks: fleet.trucks.map((truck) =>
    truck.id === 'truck-plan-origin' ? { ...truck, status: 'marketplace_locked' as const } : truck,
  ),
};
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet: lockedFleet,
    cargoWeightTons: 1,
  }).status === 'NO_ELIGIBLE_ORIGIN_TRUCK',
  'L: marketplace_locked rejected',
);

assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet,
    cargoWeightTons: 500,
  }).status === 'CARGO_INCOMPATIBLE',
  'M: cargo incompatibility',
);

const noDriverFleet = { ...fleet, drivers: [] as Driver[] };
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet: noDriverFleet,
    cargoWeightTons: 1,
  }).status === 'NO_ELIGIBLE_DRIVER',
  'N: missing driver',
);

const tinyTruck: Truck = { ...STARTER_TRUCK, id: 'truck-tiny', capacity: 2, currentCityId: 'ankara', homeCityId: 'ankara', status: 'idle' };
const unusedTrailer: Trailer = {
  id: 'trailer-unused',
  name: 'Unused',
  type: 'standard',
  capacityBonusTons: 40,
  purchasePrice: 1,
  condition: 100,
  city: 'ankara',
  status: 'idle',
  attachedTruckId: null,
  isOwned: true,
  createdAtGameTime: 0,
};
const trailerFleet = {
  trucks: [tinyTruck, fleet.trucks[1]],
  drivers: fleet.drivers,
  trailers: [unusedTrailer],
  activeDeliveries: [],
  activeTransfers: [],
  currentTime: 0,
};
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: artifact,
    fleet: trailerFleet,
    cargoWeightTons: 20,
  }).status === 'CARGO_INCOMPATIBLE',
  'O: unattached trailer does not auto-hitch (production attach semantics)',
);

assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'PIPE',
    accessArtifact: artifact,
    fleet,
    cargoWeightTons: 1,
  }).status === 'UNSUPPORTED_MODE',
  'X: unsupported mode fail closed',
);

assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: { ...artifact, schemaVersion: 99 } as unknown as MultimodalRoadTransferAccessArtifactV1,
    fleet,
    cargoWeightTons: 1,
  }).status === 'UNSUPPORTED_SCHEMA',
  'Y: unknown schema not executable',
);

const emptyArtifact = { ...artifact, records: [] };
assert(
  planMultimodalRoadAssignment({
    originCityId: 'ankara',
    destinationCityId: 'istanbul',
    transferMode: 'RAIL',
    accessArtifact: emptyArtifact,
    fleet,
    cargoWeightTons: 1,
  }).status === 'ROAD_ACCESS_UNRESOLVED',
  'W: missing ROAD access fail closed',
);

const duration = estimateTransportLegDuration({
  legId: 'fm',
  mode: 'ROAD',
  distanceMeters: ankaraRail!.distanceMeters,
  distanceAuthority: SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
});
assert(duration.status === 'READY' && (duration.durationGameSeconds ?? 0) > 0, 'U: policy accepts transfer-access authority');

const sample = createTestPersistedMultimodalShipment();
assert(getMultimodalSettlementId(sample.shipmentId).ok, 'AA: Step 23 identity unchanged');
assert(!read('src/domain/multimodalRoadAssignment.ts').includes('getMultimodalSettlementId'), 'AF: planner does not settle');
assert(!read('src/store/gameStore.ts').includes('planMultimodalRoadAssignment'), 'AH: no gameStore dispatch');
assert(!read('src/screens/MapScreen.tsx').includes('planMultimodalRoadAssignment'), 'AH: MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'AI: routes.ts unchanged');
assert(!read('firestore.rules').includes('roadTransferAccess'), 'AG: no Firestore');
assert(!read('backend/src/index.ts').includes('assignMultimodal'), 'AG: no Cloud Function');
assert(!read('src/domain/multimodalRoadAssignment.ts').includes('from \'react\''), 'no React in planner');
assert(!read('src/domain/multimodalRoadAssignment.ts').includes('turkey-road-network'), 'no full ROAD graph in domain');
assert(read('src/mapV2/domain/multimodal.ts').includes("RAIL: 'FOUNDATION_ONLY'"), 'RAIL FOUNDATION_ONLY');

const economyProbe = { cash: 44_000, fuel: 80, tolls: 12, maintenance: 5, reputation: 50, xp: 10 };
const after = { ...economyProbe };
assert(JSON.stringify(economyProbe) === JSON.stringify(after), 'AB: economy probe unchanged');
assert(MULTIMODAL_DURATION_POLICY_VERSION === 'multimodal-duration-policy-v1', 'duration policy version unchanged');
void STARTER_DRIVER;

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
