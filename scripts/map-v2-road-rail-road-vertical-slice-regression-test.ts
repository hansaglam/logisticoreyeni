/**
 * Map V2 Step 18 ROAD→RAIL→ROAD vertical slice.
 * Run: npx tsx scripts/map-v2-road-rail-road-vertical-slice-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  MULTIMODAL_DURATION_POLICY_VERSION,
  MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS,
} from '../src/domain/multimodalDurationPolicy';
import {
  advanceMultimodalRuntime,
  calculateOverallProgress,
  createRuntimeFromFixture,
  DEV_SIMULATED_ROAD_CARRIER,
  runUntilIdle,
} from '../src/mapV2/gameplay/multimodalRuntime';
import { buildRoadRailRoadFixture, listRoadRailRoadEligiblePairs } from '../src/mapV2/gameplay/roadRailRoadFixture';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../src/mapV2/world/railRouteDiagnosticsLoader';

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

console.log('\n=== Map V2 ROAD→RAIL→ROAD Vertical Slice ===\n');

const foundation = getTurkeyMultimodalFoundation();
const diagnostics = getTurkeyRailRouteDiagnostics();
const eligible = listRoadRailRoadEligiblePairs(foundation, diagnostics);
assert(eligible.some((row) => row.origin === 'ankara' && row.destination === 'istanbul'), 'Ankara→İstanbul eligible from foundation+diagnostics');
assert(!eligible.some((row) => row.origin === 'antalya'), 'Antalya not an eligible origin');
assert(!eligible.some((row) => row.origin === 'bursa'), 'Bursa not an eligible origin');

const antalya = buildRoadRailRoadFixture('antalya', 'ankara', foundation, diagnostics);
assert(antalya.ok === false, 'Antalya→Ankara fixture invalid');
const bursa = buildRoadRailRoadFixture('bursa', 'istanbul', foundation, diagnostics);
assert(bursa.ok === false, 'Bursa→İstanbul fixture invalid');

const fixture = buildRoadRailRoadFixture('ankara', 'istanbul', foundation, diagnostics);
assert(fixture.ok === true, 'Ankara→İstanbul fixture builds');
if (!fixture.ok) {
  console.log(`\nPASS: ${pass}\nFAIL: ${fail}`);
  process.exit(1);
}

assert(fixture.plan.legs.length === 3 && fixture.plan.transfers.length === 2, '3 legs 2 transfers');
assert(fixture.plan.legs[0].mode === 'ROAD' && fixture.plan.legs[1].mode === 'RAIL' && fixture.plan.legs[2].mode === 'ROAD', 'ROAD-RAIL-ROAD pattern');
assert(fixture.plan.legs[1].routeReference?.startsWith('domain.canonical.rail.') === true, 'rail routeReference is canonical domain, not visual corridor file');
assert(!JSON.stringify(fixture.plan).includes('turkey-rail-corridors.json'), 'plan does not cite visual corridor json');
assert(fixture.preview.originRailAccessName === 'Yenişehir', 'Ankara rail access name from source diagnostics');
assert(fixture.preview.destinationRailAccessName === 'Sirkeci', 'İstanbul rail access name from source diagnostics');
assert(fixture.legDistances[1].distanceKind === 'SOURCE_BACKED_RAIL_LENGTH', 'rail length is source-backed');
assert(fixture.legDistances[0].distanceKind === 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS', 'first mile is source-backed ROAD transfer access');
assert(fixture.legDistances[0].distanceMeters !== 5000, 'first mile is not the 5 km stub');
assert(fixture.legDistances[2].distanceKind === 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS', 'last mile is source-backed ROAD transfer access');
assert(fixture.plan.provenance.note === 'DEV_FIXTURE_ONLY_NOT_PERSISTED', 'not persisted');
assert(fixture.railTariff.status === 'READY', 'Step 26 RAIL tariff READY on fixture');
assert(fixture.railTariff.policyVersion === 'multimodal-rail-tariff-v1', 'tariff policy version on fixture');
assert((fixture.railTariff.totalCarrierCost ?? 0) > 0, 'tariff is a carrier cost not zero');
assert(!JSON.stringify(fixture.railTariff).includes('playerReward'), 'tariff is not player reward');

let runtime = createRuntimeFromFixture(fixture);
assert(runtime.status === 'PLANNED', 'starts PLANNED');
assert(runtime.roadCarrier === DEV_SIMULATED_ROAD_CARRIER, 'DEV road carrier, no player truck');
assert(runtime.durationEstimate.status === 'READY', 'production duration READY');
assert(runtime.durationEstimate.policyVersion === MULTIMODAL_DURATION_POLICY_VERSION, 'duration policy version');
assert(
  runtime.transferStates[0].plannedDurationGameSeconds === MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS.ROAD_RAIL,
  'ROAD↔RAIL transfer uses production dwell',
);
assert(runtime.legStates[1].plannedDurationGameSeconds > 0, 'RAIL planned duration positive');
runtime = advanceMultimodalRuntime(runtime, { type: 'START' });
assert(runtime.status === 'ACTIVE', 'START → ACTIVE');
assert(runtime.legStates[0].status === 'IN_PROGRESS', 'ROAD1 in progress');
assert(runtime.legStates[1].status === 'PLANNED', 'RAIL not started before transfer');
assert(runtime.transferStates[0].status === 'PENDING', 'transfer1 pending until ROAD1 completes');

runtime = runUntilIdle(runtime);
assert(runtime.status === 'COMPLETED', 'happy path completes');
assert(runtime.legStates.every((leg) => leg.status === 'COMPLETED'), 'all legs completed');
assert(runtime.transferStates.every((row) => row.status === 'COMPLETED'), 'all transfers completed');
assert(calculateOverallProgress(runtime) === 1, 'overall progress 1');
const log = runtime.transitionLog.join('>');
assert(log.includes('SHIPMENT:PLANNED') && log.includes('SHIPMENT:ACTIVE') && log.includes('SHIPMENT:COMPLETED'), 'shipment statuses ordered');
assert(log.indexOf('LEG:plan.tur.r3r.ankara.istanbul.v1.leg.road1:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.ankara.road-rail.v1:READY'), 'ROAD1 before transfer1');
assert(log.indexOf('TRANSFER:transfer.tur.ankara.road-rail.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3r.ankara.istanbul.v1.leg.rail:READY'), 'transfer1 before RAIL');
assert(log.indexOf('LEG:plan.tur.r3r.ankara.istanbul.v1.leg.rail:COMPLETED') < log.indexOf('TRANSFER:transfer.tur.istanbul.road-rail.v1:READY'), 'RAIL before transfer2');
assert(log.indexOf('TRANSFER:transfer.tur.istanbul.road-rail.v1:COMPLETED') < log.indexOf('LEG:plan.tur.r3r.ankara.istanbul.v1.leg.road2:READY'), 'transfer2 before ROAD2');

function failOnLeg(slot: number, label: string): void {
  let state = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
  while (state.status === 'ACTIVE' && state.legStates[slot].status !== 'IN_PROGRESS') {
    state = advanceMultimodalRuntime(state, { type: 'TICK', wallDtMs: 60_000 });
  }
  assert(state.legStates[slot].status === 'IN_PROGRESS', `${label} reached IN_PROGRESS`);
  state = advanceMultimodalRuntime(state, { type: 'FAIL_LEG' });
  assert(state.status === 'FAILED', `${label} fails shipment`);
  assert(state.legStates.slice(slot + 1).every((leg) => leg.status === 'PLANNED'), `${label} no downstream legs`);
  if (slot === 0) {
    assert(state.transferStates.every((row) => row.status === 'PENDING'), 'ROAD1 fail leaves transfers pending');
  }
  const resumed = advanceMultimodalRuntime(state, { type: 'RESUME' });
  assert(resumed.status === 'FAILED' && resumed.playing === false, `${label} cannot resume FAILED`);
}

failOnLeg(0, 'ROAD1');
failOnLeg(1, 'RAIL');
failOnLeg(2, 'ROAD2');

let blocked = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (blocked.status === 'ACTIVE' && blocked.transferStates[0].status !== 'IN_PROGRESS') {
  blocked = advanceMultimodalRuntime(blocked, { type: 'TICK', wallDtMs: 60_000 });
}
blocked = advanceMultimodalRuntime(blocked, { type: 'BLOCK_TRANSFER' });
assert(blocked.status === 'BLOCKED', 'transfer1 block → shipment BLOCKED');
assert(blocked.legStates[1].status === 'PLANNED', 'RAIL does not start after blocked transfer1');
blocked = advanceMultimodalRuntime(blocked, { type: 'TICK', wallDtMs: 60_000 });
assert(blocked.legStates[1].status === 'PLANNED', 'ticks do not skip blocked transfer');

let blocked2 = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
while (blocked2.status === 'ACTIVE' && blocked2.transferStates[1].status !== 'IN_PROGRESS') {
  blocked2 = advanceMultimodalRuntime(blocked2, { type: 'TICK', wallDtMs: 60_000 });
}
blocked2 = advanceMultimodalRuntime(blocked2, { type: 'BLOCK_TRANSFER' });
assert(blocked2.status === 'BLOCKED' && blocked2.legStates[2].status === 'PLANNED', 'blocked transfer2 holds final ROAD');

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
cancelWhen((state) => state.legStates[1].status === 'IN_PROGRESS', 'cancel RAIL');

const seed = createRuntimeFromFixture(fixture);
let paused = advanceMultimodalRuntime(seed, { type: 'START' });
const beforePause = paused.legStates[0].progress;
paused = advanceMultimodalRuntime(paused, { type: 'PAUSE' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[0].progress === beforePause, 'pause stops progress');
paused = advanceMultimodalRuntime(paused, { type: 'RESUME' });
paused = advanceMultimodalRuntime(paused, { type: 'TICK', wallDtMs: 10_000 });
assert(paused.legStates[0].progress > beforePause, 'resume continues');
const reset = advanceMultimodalRuntime(paused, { type: 'RESET', seed });
assert(reset.status === 'PLANNED' && reset.legStates.every((leg) => leg.progress === 0), 'reset clears progress');

const earlyComplete = advanceMultimodalRuntime(createRuntimeFromFixture(fixture), { type: 'START' });
assert(earlyComplete.status !== 'COMPLETED', 'cannot complete shipment at start');

assert(!read('src/types/game.ts').includes('transferStates'), 'live Delivery has no transferStates');
assert(!read('src/types/game.ts').includes('currentLegIndex'), 'live Delivery has no currentLegIndex');
assert(read('src/types/game.ts').includes('export interface Delivery'), 'Delivery type still present');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('useGameStore'), 'runtime has no game store');
assert(!read('src/mapV2/gameplay/multimodalRuntime.ts').includes('saveGame'), 'runtime has no saveGame');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('useGameStore'), 'simulator UI has no store');
assert(!read('src/mapV2/screens/MapV2MultimodalShipmentSimulatorScreen.tsx').includes('firebase'), 'simulator has no firebase');
assert(!read('src/mapV2/gameplay/roadRailRoadFixture.ts').includes("require('../generated/countryOverview/turkey-rail-corridors.json')"), 'fixture does not require visual corridor json');
assert(read('src/mapV2/world/railRouteDiagnosticsLoader.ts').includes('turkey-rail-corridors.report.json'), 'diagnostics load rail build report');
assert(!read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('MultimodalShipmentSimulator'), 'player country map has no simulator');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Multimodal Shipment Simulator'), 'DEV entry');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/storage/saveGame.ts').includes('MultimodalShipmentRuntime'), 'no save field');
assert(!read('src/simulation/contracts.ts').includes('buildRoadRailRoadFixture'), 'contracts untouched');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('multimodalRuntime'), 'RAIL extract untouched');
assert(!read('scripts/map-v2/build-turkey-road-corridors.ts').includes('multimodalRuntime'), 'ROAD extract untouched');
assert(!read('scripts/map-v2/build-turkey-sea-corridors.ts').includes('multimodalRuntime'), 'SEA extract untouched');
assert(!read('scripts/map-v2/build-turkey-air-corridors.ts').includes('multimodalRuntime'), 'AIR extract untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
