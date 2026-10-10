/**
 * Map V2 Step 19 ROAD→SEA→ROAD vertical slice.
 * Run: npx tsx scripts/map-v2-road-sea-road-vertical-slice-regression-test.ts
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
import { buildRoadRailRoadFixture } from '../src/mapV2/gameplay/roadRailRoadFixture';
import {
  buildRoadSeaRoadFixture,
  listRoadSeaRoadEligiblePairs,
} from '../src/mapV2/gameplay/roadSeaRoadFixture';
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

console.log('\n=== Map V2 ROAD→SEA→ROAD Vertical Slice ===\n');

const foundation = getTurkeyMultimodalFoundation();
const seaDiagnostics = getTurkeySeaRouteDiagnostics();
const railDiagnostics = getTurkeyRailRouteDiagnostics();
const airDiagnostics = getTurkeyAirRouteDiagnostics();
const ports = getTurkeyPortPackage();
const eligible = listRoadSeaRoadEligiblePairs(foundation, seaDiagnostics);

assert(eligible.some((row) => row.origin === 'istanbul' && row.destination === 'izmir'), 'İstanbul→İzmir eligible');
assert(eligible.some((row) => row.origin === 'antalya' && row.destination === 'adana'), 'Antalya→Adana eligible');
assert(eligible.some((row) => row.origin === 'istanbul' && row.destination === 'trabzon'), 'İstanbul→Trabzon eligible');
assert(eligible.some((row) => row.origin === 'izmir' && row.destination === 'antalya'), 'İzmir→Antalya eligible');
assert(eligible.some((row) => row.origin === 'bursa' && row.destination === 'trabzon'), 'Bursa→Trabzon eligible');
assert(eligible.some((row) => row.origin === 'bursa' && row.destination === 'izmir'), 'Bursa→İzmir eligible');
assert(!eligible.some((row) => row.origin === 'ankara'), 'Ankara not an eligible SEA origin');
assert(!eligible.some((row) => row.origin === 'diyarbakir'), 'Diyarbakır not an eligible SEA origin');

const ankara = buildRoadSeaRoadFixture('ankara', 'istanbul', foundation, seaDiagnostics, ports);
assert(ankara.ok === false && ankara.reason === 'NO_ROAD_SEA_TRANSFER_AT_ORIGIN', 'Ankara→İstanbul SEA invalid, no origin fallback');
const diyarbakir = buildRoadSeaRoadFixture('diyarbakir', 'izmir', foundation, seaDiagnostics, ports);
assert(diyarbakir.ok === false && diyarbakir.reason === 'NO_ROAD_SEA_TRANSFER_AT_ORIGIN', 'Diyarbakır→İzmir SEA invalid');

const viaDispatcher = buildMultimodalVerticalSlice({
  pattern: 'ROAD_SEA_ROAD',
  origin: 'istanbul',
  destination: 'izmir',
  foundation,
  railDiagnostics,
  seaDiagnostics,
  airDiagnostics,
  ports,
});
const fixture = buildRoadSeaRoadFixture('istanbul', 'izmir', foundation, seaDiagnostics, ports);
assert(fixture.ok === true, 'İstanbul→İzmir fixture builds');
assert(viaDispatcher.ok === true, 'dispatcher ROAD_SEA_ROAD matches fixture builder');
if (!fixture.ok) {
  console.log(`\nPASS: ${pass}\nFAIL: ${fail}`);
  process.exit(1);
}

assert(fixture.plan.legs.length === 3 && fixture.plan.transfers.length === 2, '3 legs 2 transfers');
assert(fixture.plan.legs[0].mode === 'ROAD' && fixture.plan.legs[1].mode === 'SEA' && fixture.plan.legs[2].mode === 'ROAD', 'ROAD-SEA-ROAD pattern');
assert(fixture.plan.legs[1].routeReference === 'domain.canonical.sea.istanbul.izmir', 'canonical sea routeReference');
assert(!JSON.stringify(fixture.plan).includes('turkey-sea-corridors.json'), 'plan does not cite visual corridor json');
assert(fixture.preview.originGeoPortName.includes('Salıpazarı') || fixture.preview.originGeoPortName.toLowerCase().includes('salipazari'), 'İstanbul port is Salıpazarı family');
assert(fixture.preview.destinationPortAssociation === 'DIRECT', 'İzmir association DIRECT');
assert(fixture.preview.channels.includes('DARDANELLES'), 'İstanbul→İzmir lineage has DARDANELLES');
assert(!fixture.preview.channels.includes('BOSPHORUS'), 'İstanbul→İzmir does not falsely claim BOSPHORUS');
assert(fixture.preview.regions.includes('MARMARA') && fixture.preview.regions.includes('AEGEAN'), 'İstanbul→İzmir regions MARMARA+AEGEAN');
assert(fixture.legDistances[1].distanceKind === 'SOURCE_BACKED_SEA_LENGTH', 'sea length is source-backed');
assert(fixture.legDistances[0].distanceKind === 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS', 'first mile is source-backed ROAD transfer access');
assert(fixture.preview.sourceBacked === true, 'source-backed preview');
assert(fixture.plan.provenance.note === 'DEV_FIXTURE_ONLY_NOT_PERSISTED', 'not persisted');

assert(MULTIMODAL_LINE_HAUL_SPEED_KMH.SEA < MULTIMODAL_LINE_HAUL_SPEED_KMH.RAIL, 'SEA gameplay line-haul slower than RAIL');
assert(MULTIMODAL_LINE_HAUL_SPEED_KMH.SEA < MULTIMODAL_LINE_HAUL_SPEED_KMH.AIR, 'SEA gameplay line-haul slower than AIR');

let runtime = createRuntimeFromFixture(fixture);
assert(runtime.status === 'PLANNED', 'starts PLANNED');
assert(runtime.roadCarrier === DEV_SIMULATED_ROAD_CARRIER, 'DEV road carrier, no player truck');
assert(runtime.legStates[1].mode === 'SEA', 'middle leg is SEA');
assert(runtime.durationEstimate.status === 'READY', 'production duration READY');
assert(runtime.durationEstimate.policyVersion === MULTIMODAL_DURATION_POLICY_VERSION, 'duration policy version');
assert(
  runtime.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_SEA,
  'ROAD↔SEA transfer uses production dwell',
);
assert(
  runtime.transferStates[0].durationSimMs ===
    getDevPlaybackWallMs(MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_SEA),
  'SEA transfer playback derived from planned duration',
);
runtime = advanceMultimodalRuntime(runtime, { type: 'START' });
assert(runtime.status === 'ACTIVE', 'START → ACTIVE');
assert(runtime.legStates[0].status === 'IN_PROGRESS', 'ROAD1 in progress');
assert(runtime.legStates[1].status === 'PLANNED', 'SEA not started before transfer');

runtime = runUntilIdle(runtime);
assert(runtime.status === 'COMPLETED', 'happy path completes');
assert(runtime.legStates.every((leg) => leg.status === 'COMPLETED'), 'all legs completed');
assert(runtime.transferStates.every((row) => row.status === 'COMPLETED'), 'all transfers completed');
assert(calculateOverallProgress(runtime) === 1, 'overall progress 1');
const log = runtime.transitionLog.join('>');
assert(log.includes('SHIPMENT:PLANNED') && log.includes('SHIPMENT:ACTIVE') && log.includes('SHIPMENT:COMPLETED'), 'shipment statuses ordered');
assert(log.indexOf('LEG:plan.tur.r3s.istanbul.izmir.v1.leg.road1:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.istanbul.road-sea.v1:READY'), 'ROAD1 before transfer1');
assert(log.indexOf('TRANSFER:transfer.tur.istanbul.road-sea.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3s.istanbul.izmir.v1.leg.sea:READY'), 'transfer1 before SEA');
assert(log.indexOf('LEG:plan.tur.r3s.istanbul.izmir.v1.leg.sea:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.izmir.road-sea.v1:READY'), 'SEA before transfer2');
assert(log.indexOf('TRANSFER:transfer.tur.izmir.road-sea.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3s.istanbul.izmir.v1.leg.road2:READY'), 'transfer2 before ROAD2');

const trabzon = buildRoadSeaRoadFixture('istanbul', 'trabzon', foundation, seaDiagnostics, ports);
assert(trabzon.ok === true, 'İstanbul→Trabzon fixture builds');
if (trabzon.ok) {
  assert(trabzon.preview.channels.includes('BOSPHORUS'), 'İstanbul→Trabzon lineage has BOSPHORUS');
  assert(!trabzon.preview.channels.includes('DARDANELLES'), 'İstanbul→Trabzon does not claim DARDANELLES');
}

const bursaTrabzon = buildRoadSeaRoadFixture('bursa', 'trabzon', foundation, seaDiagnostics, ports);
assert(bursaTrabzon.ok === true && bursaTrabzon.preview.channels.includes('BOSPHORUS'), 'Bursa→Trabzon BOSPHORUS from routed path');

const adana = buildRoadSeaRoadFixture('antalya', 'adana', foundation, seaDiagnostics, ports);
assert(adana.ok === true, 'Antalya→Adana fixture builds');
if (adana.ok) {
  assert(adana.preview.destinationPortAssociation === 'REGIONAL', 'Adana city–port association REGIONAL');
  assert(
    adana.preview.destinationGeoPortName.toLowerCase().includes('yumurtal'),
    'Adana port is Yumurtalık, not city center',
  );
  const adanaRun = runUntilIdle(advanceMultimodalRuntime(createRuntimeFromFixture(adana), { type: 'START' }));
  assert(adanaRun.status === 'COMPLETED', 'Antalya→Adana completes');
}

let failSea = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (failSea.status === 'ACTIVE' && failSea.legStates[1].status !== 'IN_PROGRESS') {
  failSea = advanceMultimodalRuntime(failSea, { type: 'TICK', wallDtMs: 60_000 });
}
assert(failSea.legStates[1].status === 'IN_PROGRESS', 'SEA reached IN_PROGRESS');
failSea = advanceMultimodalRuntime(failSea, { type: 'FAIL_LEG' });
assert(failSea.status === 'FAILED', 'SEA fail → shipment FAILED');
assert(failSea.legStates[2].status === 'PLANNED', 'final ROAD never begins after SEA fail');
assert(failSea.transferStates[1].status === 'PENDING', 'transfer2 never starts after SEA fail');

let blocked = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (blocked.status === 'ACTIVE' && blocked.transferStates[0].status !== 'IN_PROGRESS') {
  blocked = advanceMultimodalRuntime(blocked, { type: 'TICK', wallDtMs: 60_000 });
}
blocked = advanceMultimodalRuntime(blocked, { type: 'BLOCK_TRANSFER' });
assert(blocked.status === 'BLOCKED', 'transfer1 block → shipment BLOCKED');
assert(blocked.legStates[1].status === 'PLANNED', 'SEA remains PLANNED after blocked transfer1');

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
cancelWhen((state) => state.legStates[1].status === 'IN_PROGRESS', 'cancel SEA');

const seed = createRuntimeFromFixture(fixture);
let paused = advanceMultimodalRuntime(seed, { type: 'START' });
while (paused.status === 'ACTIVE' && paused.legStates[1].status !== 'IN_PROGRESS') {
  paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 60_000 });
}
const beforePause = paused.legStates[1].progress;
paused = advanceMultimodalRuntime(paused, { type: 'PAUSE' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[1].progress === beforePause, 'pause freezes SEA progress');
paused = advanceMultimodalRuntime(paused, { type: 'RESUME' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[1].progress > beforePause, 'resume continues SEA');
const reset = advanceMultimodalRuntime(paused, { type: 'RESET', seed });
assert(reset.status === 'PLANNED' && reset.legStates.every((leg) => leg.progress === 0), 'reset clears progress');

const railFixture = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, railDiagnostics);
assert(railFixture.ok === true, 'RAIL slice Ankara→İstanbul still builds');
if (railFixture.ok) {
  const railDone = runUntilIdle(advanceMultimodalRuntime(createRuntimeFromFixture(railFixture), { type: 'START' }));
  assert(railDone.status === 'COMPLETED' && railDone.legStates[1].mode === 'RAIL', 'same runtime completes RAIL middle leg');
  assert(
    railDone.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_RAIL,
    'RAIL transfer uses production ROAD↔RAIL dwell',
  );
}

assert(read('src/mapV2/gameplay/multimodalRuntime.ts').includes('export function advanceMultimodalRuntime'), 'single generic reducer');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('advanceSeaRuntime'), 'no SEA-only reducer');
assert(!read('src/mapV2/gameplay/roadSeaRoadFixture.ts').includes('class Ship'), 'no Ship model');
assert(!read('src/mapV2/gameplay/roadSeaRoadFixture.ts').includes('Vessel'), 'no Vessel model');
assert(!read('src/types/game.ts').includes('transferStates'), 'live Delivery has no transferStates');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('useGameStore'), 'runtime has no game store');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('saveGame'), 'runtime has no saveGame');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('useGameStore'), 'simulator UI has no store');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('firebase'), 'simulator has no firebase');
assert(!read('src/mapV2/gameplay/roadSeaRoadFixture.ts').includes("require('../generated/countryOverview/turkey-sea-corridors.json')"), 'fixture does not require visual corridor json');
assert(read('src/mapV2/world/seaRouteDiagnosticsLoader.ts').includes('turkey-sea-corridors.report.json'), 'diagnostics load sea build report');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('ROAD → SEA → ROAD'), 'pattern selector includes SEA');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('ROAD → RAIL → ROAD'), 'pattern selector keeps RAIL');
assert(!read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('MultimodalShipmentSimulator'), 'player country map has no simulator');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Multimodal Shipment Simulator'), 'DEV entry');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/storage/saveGame.ts').includes('MultimodalShipmentRuntime'), 'no save field');
assert(!read('src/simulation/contracts.ts').includes('buildRoadSeaRoadFixture'), 'contracts untouched');
assert(!read('scripts/map-v2/build-turkey-sea-corridors.ts').includes('multimodalRuntime'), 'SEA extract untouched');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('multimodalRuntime'), 'RAIL extract untouched');
assert(!read('scripts/map-v2/build-turkey-air-corridors.ts').includes('ROAD_SEA_ROAD'), 'AIR extract untouched');
assert(read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('ROAD → AIR → ROAD'), 'AIR pattern shares the same simulator');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('advanceAirShipmentRuntime'), 'no AIR-only runtime in simulator');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
