/**
 * Map V2 Step 20 ROAD→AIR→ROAD vertical slice.
 * Run: npx tsx scripts/map-v2-road-air-road-vertical-slice-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  MULTIMODAL_DURATION_POLICY_VERSION,
  MULTIMODAL_LINE_HAUL_SPEED_KMH,
  MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS,
} from '../src/domain/multimodalDurationPolicy';
import {
  advanceMultimodalRuntime,
  calculateOverallProgress,
  createRuntimeFromFixture,
  DEV_SIMULATED_ROAD_CARRIER,
  getDevPlaybackWallMs,
  runUntilIdle,
} from '../src/mapV2/gameplay/multimodalRuntime';
import { buildMultimodalVerticalSlice } from '../src/mapV2/gameplay/multimodalVerticalSlice';
import { buildRoadAirRoadFixture, listRoadAirRoadEligiblePairs } from '../src/mapV2/gameplay/roadAirRoadFixture';
import { buildRoadRailRoadFixture } from '../src/mapV2/gameplay/roadRailRoadFixture';
import { buildRoadSeaRoadFixture } from '../src/mapV2/gameplay/roadSeaRoadFixture';
import { getTurkeyAirRouteDiagnostics } from '../src/mapV2/world/airRouteDiagnosticsLoader';
import { getTurkeyPortPackage } from '../src/mapV2/world/countryPortLoader';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../src/mapV2/world/railRouteDiagnosticsLoader';
import { getTurkeySeaRouteDiagnostics } from '../src/mapV2/world/seaRouteDiagnosticsLoader';

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

console.log('\n=== Map V2 ROAD→AIR→ROAD Vertical Slice ===\n');

const foundation = getTurkeyMultimodalFoundation();
const airDiagnostics = getTurkeyAirRouteDiagnostics();
const railDiagnostics = getTurkeyRailRouteDiagnostics();
const seaDiagnostics = getTurkeySeaRouteDiagnostics();
const ports = getTurkeyPortPackage();
const eligible = listRoadAirRoadEligiblePairs(foundation, airDiagnostics);

assert(eligible.some((row) => row.origin === 'istanbul' && row.destination === 'ankara'), 'İstanbul→Ankara eligible');
assert(eligible.some((row) => row.origin === 'istanbul' && row.destination === 'trabzon'), 'İstanbul→Trabzon eligible');
assert(eligible.some((row) => row.origin === 'ankara' && row.destination === 'adana'), 'Ankara→Adana eligible');
assert(!eligible.some((row) => row.origin === 'bursa'), 'Bursa not an eligible AIR origin');
assert(
  !eligible.some((row) => row.origin === 'adana' && row.destination === 'diyarbakir'),
  'Adana→Diyarbakır not in accepted AIR diagnostics',
);

const bursa = buildRoadAirRoadFixture('bursa', 'istanbul', foundation, airDiagnostics);
assert(bursa.ok === false && bursa.reason === 'NO_READY_AIR_LOGISTICS_TRANSFER_AT_ORIGIN', 'Bursa→İstanbul AIR invalid');
const rejected = buildRoadAirRoadFixture('adana', 'diyarbakir', foundation, airDiagnostics);
assert(rejected.ok === false, 'Adana→Diyarbakır AIR invalid');
assert(
  rejected.ok === false && rejected.reason.includes('no source-backed air route'),
  'rejected pair does not invent a geodesic',
);

const viaDispatcher = buildMultimodalVerticalSlice({
  pattern: 'ROAD_AIR_ROAD',
  origin: 'istanbul',
  destination: 'ankara',
  foundation,
  railDiagnostics,
  seaDiagnostics,
  airDiagnostics,
  ports,
});
const fixture = buildRoadAirRoadFixture('istanbul', 'ankara', foundation, airDiagnostics);
assert(fixture.ok === true, 'İstanbul→Ankara fixture builds');
assert(viaDispatcher.ok === true, 'dispatcher ROAD_AIR_ROAD matches fixture builder');
if (!fixture.ok) {
  console.log(`\nPASS: ${pass}\nFAIL: ${fail}`);
  process.exit(1);
}

assert(fixture.plan.legs.length === 3 && fixture.plan.transfers.length === 2, '3 legs 2 transfers');
assert(fixture.plan.legs[0].mode === 'ROAD' && fixture.plan.legs[1].mode === 'AIR' && fixture.plan.legs[2].mode === 'ROAD', 'ROAD-AIR-ROAD pattern');
assert(fixture.plan.legs[1].routeReference === 'domain.canonical.air.ankara.istanbul', 'canonical air routeReference');
assert(!JSON.stringify(fixture.plan).includes('turkey-air-corridors.json'), 'plan does not cite visual corridor json');
assert(fixture.preview.originIata === 'IST' && fixture.preview.originIata !== 'SAW', 'İstanbul logistics IST not SAW');
assert(fixture.preview.destinationIata === 'ESB', 'Ankara logistics ESB');
assert(fixture.preview.originCargoCapability === 'VERIFIED_SUPPORTED', 'origin cargo VERIFIED_SUPPORTED');
assert(fixture.preview.destinationCargoCapability === 'VERIFIED_SUPPORTED', 'dest cargo VERIFIED_SUPPORTED');
assert(fixture.preview.originReadiness === 'READY' && fixture.preview.destinationReadiness === 'READY', 'both READY');
assert(fixture.legDistances[1].distanceKind === 'SOURCE_BACKED_AIR_GEODESIC', 'air length is source-backed geodesic');
assert(fixture.preview.airSemantics === 'LOGISTICS_SIMULATION_NOT_FLIGHT_PLAN', 'not a flight plan');
assert(fixture.plan.provenance.note === 'DEV_FIXTURE_ONLY_NOT_PERSISTED', 'not persisted');

assert(MULTIMODAL_LINE_HAUL_SPEED_KMH.AIR > MULTIMODAL_LINE_HAUL_SPEED_KMH.RAIL, 'AIR gameplay line-haul faster than RAIL');
assert(MULTIMODAL_LINE_HAUL_SPEED_KMH.AIR > MULTIMODAL_LINE_HAUL_SPEED_KMH.SEA, 'AIR gameplay line-haul faster than SEA');

let runtime = createRuntimeFromFixture(fixture);
assert(runtime.status === 'PLANNED', 'starts PLANNED');
assert(runtime.roadCarrier === DEV_SIMULATED_ROAD_CARRIER, 'DEV road carrier, no player truck');
assert(runtime.legStates[1].mode === 'AIR', 'middle leg is AIR');
assert(runtime.durationEstimate.status === 'READY', 'production duration READY');
assert(runtime.durationEstimate.policyVersion === MULTIMODAL_DURATION_POLICY_VERSION, 'duration policy version');
assert(runtime.legStates[1].plannedDurationGameSeconds > 0, 'AIR planned duration positive');
assert(
  runtime.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_AIR,
  'ROAD↔AIR transfer uses production dwell',
);
assert(
  runtime.transferStates[0].durationSimMs ===
    getDevPlaybackWallMs(MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_AIR),
  'AIR transfer playback derived from planned duration',
);
runtime = advanceMultimodalRuntime(runtime, { type: 'START' });
assert(runtime.legStates[0].status === 'IN_PROGRESS', 'ROAD1 in progress');
assert(runtime.legStates[1].status === 'PLANNED', 'AIR not started before transfer');
runtime = runUntilIdle(runtime);
assert(runtime.status === 'COMPLETED', 'İstanbul→Ankara completes');
assert(calculateOverallProgress(runtime) === 1, 'overall progress 1');
const log = runtime.transitionLog.join('>');
assert(log.indexOf('LEG:plan.tur.r3a.istanbul.ankara.v1.leg.road1:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.istanbul.road-air.ist.v1:READY'), 'ROAD1 before transfer1');
assert(log.indexOf('TRANSFER:transfer.tur.istanbul.road-air.ist.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3a.istanbul.ankara.v1.leg.air:READY'), 'transfer1 before AIR');
assert(log.indexOf('LEG:plan.tur.r3a.istanbul.ankara.v1.leg.air:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.ankara.road-air.esb.v1:READY'), 'AIR before transfer2');
assert(log.indexOf('TRANSFER:transfer.tur.ankara.road-air.esb.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3a.istanbul.ankara.v1.leg.road2:READY'), 'transfer2 before ROAD2');

const trabzon = buildRoadAirRoadFixture('istanbul', 'trabzon', foundation, airDiagnostics);
assert(trabzon.ok === false && trabzon.reason === 'ROAD_ACCESS_UNRESOLVED', 'İstanbul→Trabzon AIR fails closed without source-backed Trabzon AIR ROAD access');

const adana = buildRoadAirRoadFixture('ankara', 'adana', foundation, airDiagnostics);
assert(adana.ok === true, 'Ankara→Adana fixture builds');
if (adana.ok) {
  assert(adana.preview.destinationIata === 'COV', 'Adana endpoint COV');
  assert(adana.preview.destinationIata !== 'ADA', 'Adana is never ADA');
}

const allAccepted = airDiagnostics.resolved;
assert(
  allAccepted.every(
    (row) =>
      row.readinessFrom === 'READY' &&
      row.readinessTo === 'READY' &&
      row.cargoCapabilityFrom === 'VERIFIED_SUPPORTED' &&
      row.cargoCapabilityTo === 'VERIFIED_SUPPORTED',
  ),
  'accepted AIR pairs pass cargo/readiness gate',
);

let failAir = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (failAir.status === 'ACTIVE' && failAir.legStates[1].status !== 'IN_PROGRESS') {
  failAir = advanceMultimodalRuntime(failAir, { type: 'TICK', wallDtMs: 60_000 });
}
assert(failAir.legStates[1].status === 'IN_PROGRESS', 'AIR reached IN_PROGRESS');
failAir = advanceMultimodalRuntime(failAir, { type: 'FAIL_LEG' });
assert(failAir.status === 'FAILED', 'AIR fail → shipment FAILED');
assert(failAir.legStates[2].status === 'PLANNED', 'ROAD2 never begins');
assert(failAir.transferStates[1].status === 'PENDING', 'transfer2 never starts');

let blocked = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (blocked.status === 'ACTIVE' && blocked.transferStates[0].status !== 'IN_PROGRESS') {
  blocked = advanceMultimodalRuntime(blocked, { type: 'TICK', wallDtMs: 60_000 });
}
blocked = advanceMultimodalRuntime(blocked, { type: 'BLOCK_TRANSFER' });
assert(blocked.legStates[1].status === 'PLANNED', 'AIR remains PLANNED after blocked transfer1');

let blocked2 = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (blocked2.status === 'ACTIVE' && blocked2.transferStates[1].status !== 'IN_PROGRESS') {
  blocked2 = advanceMultimodalRuntime(blocked2, { type: 'TICK', wallDtMs: 60_000 });
}
blocked2 = advanceMultimodalRuntime(blocked2, { type: 'BLOCK_TRANSFER' });
assert(blocked2.status === 'BLOCKED' && blocked2.legStates[2].status === 'PLANNED', 'blocked transfer2 holds ROAD2');

function cancelWhen(pred: (state: ReturnType<typeof createRuntimeFromFixture>) => boolean, label: string): void {
  let state = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
  while (state.status === 'ACTIVE' && !pred(state)) {
    state = advanceMultimodalRuntime(state, { type: 'TICK', wallDtMs: 1_000 });
  }
  state = advanceMultimodalRuntime(state, { type: 'CANCEL' });
  assert(state.status === 'CANCELLED', `${label} cancel`);
  const after = advanceMultimodalRuntime(state, { type: 'TICK', wallDtMs: 60_000 });
  assert(after.transitionLog.length === state.transitionLog.length, `${label} no further transitions`);
}

cancelWhen((state) => state.legStates[0].status === 'IN_PROGRESS', 'cancel ROAD');
cancelWhen((state) => state.transferStates[0].status === 'IN_PROGRESS', 'cancel TRANSFER');
cancelWhen((state) => state.legStates[1].status === 'IN_PROGRESS', 'cancel AIR');

const seed = createRuntimeFromFixture(fixture);
let paused = advanceMultimodalRuntime(seed, { type: 'START' });
while (paused.status === 'ACTIVE' && paused.legStates[1].status !== 'IN_PROGRESS') {
  paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 60_000 });
}
const beforePause = paused.legStates[1].progress;
paused = advanceMultimodalRuntime(paused, { type: 'PAUSE' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[1].progress === beforePause, 'pause freezes AIR progress');
paused = advanceMultimodalRuntime(paused, { type: 'RESUME' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[1].progress > beforePause, 'resume continues AIR');
const reset = advanceMultimodalRuntime(paused, { type: 'RESET', seed });
assert(reset.status === 'PLANNED' && reset.legStates.every((leg) => leg.progress === 0), 'reset clears progress');

const railFixture = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, railDiagnostics);
const seaFixture = buildRoadSeaRoadFixture('istanbul', 'izmir', foundation, seaDiagnostics, ports);
assert(railFixture.ok === true && seaFixture.ok === true && fixture.ok === true, 'three mode fixtures exist');
if (railFixture.ok && seaFixture.ok) {
  const railDone = runUntilIdle(advanceMultimodalRuntime(createRuntimeFromFixture(railFixture), { type: 'START' }));
  const seaDone = runUntilIdle(advanceMultimodalRuntime(createRuntimeFromFixture(seaFixture), { type: 'START' }));
  const airDone = runUntilIdle(advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' }));
  assert(railDone.status === 'COMPLETED' && railDone.legStates[1].mode === 'RAIL', 'same reducer completes RAIL');
  assert(seaDone.status === 'COMPLETED' && seaDone.legStates[1].mode === 'SEA', 'same reducer completes SEA');
  assert(airDone.status === 'COMPLETED' && airDone.legStates[1].mode === 'AIR', 'same reducer completes AIR');
  assert(
    railDone.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_RAIL,
    'RAIL transfer uses production ROAD↔RAIL dwell',
  );
  assert(
    seaDone.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_SEA,
    'SEA transfer uses production ROAD↔SEA dwell',
  );
}

assert(read('src/mapV2/gameplay/multimodalRuntime.ts').includes('export function advanceMultimodalRuntime'), 'single generic reducer');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('advanceAirShipmentRuntime'), 'no AIR-only reducer');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes('sampleGeodesicPolyline'), 'no runtime geodesic generation');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes('class Aircraft'), 'no Aircraft model');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes('Pilot'), 'no Pilot model');
assert(!read('src/types/game.ts').includes('transferStates'), 'live Delivery has no transferStates');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('useGameStore'), 'runtime has no game store');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('useGameStore'), 'simulator UI has no store');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('firebase'), 'simulator has no firebase');
assert(!read('src/mapV2/gameplay/roadAirRoadFixture.ts').includes("require('../generated/countryOverview/turkey-air-corridors.json')"), 'fixture does not require visual corridor json');
assert(read('src/mapV2/world/airRouteDiagnosticsLoader.ts').includes('turkey-air-corridors.report.json'), 'diagnostics load air build report');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('ROAD → AIR → ROAD'), 'pattern selector includes AIR');
assert(!read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('MultimodalShipmentSimulator'), 'player country map has no simulator');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Multimodal Shipment Simulator'), 'DEV entry');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/storage/saveGame.ts').includes('MultimodalShipmentRuntime'), 'no save field');
assert(!read('src/simulation/contracts.ts').includes('buildRoadAirRoadFixture'), 'contracts untouched');
assert(!read('scripts/map-v2/build-turkey-air-corridors.ts').includes('multimodalRuntime'), 'AIR extract untouched');
assert(!read('scripts/map-v2/build-turkey-sea-corridors.ts').includes('multimodalRuntime'), 'SEA extract untouched');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('multimodalRuntime'), 'RAIL extract untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
