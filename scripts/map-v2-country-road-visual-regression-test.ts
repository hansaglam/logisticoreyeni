/**
 * Map V2 curated country ROAD corridors (player dashboard) vs debug inspector ROAD runtime.
 * Player country uses turkey-road-corridors.json, not ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW.
 * Run: npx tsx scripts/map-v2-country-road-visual-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXPECTED_ROAD_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRoadCorridor';
import { paintForCountryFocus } from '../src/mapV2/presentation/countryPaint';
import {
  countryOverviewRoadStrokeIsSubordinate,
  paintForRoadProfile,
  resolveRoadDrawPlan,
  ROAD_RENDER_PROFILE_COUNTRY_DETAIL,
  ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW,
  ROAD_RENDER_PROFILE_DEBUG,
  visibleRoadStylesForProfile,
} from '../src/mapV2/presentation/roadRenderProfile';
import { paintForTransportStyle } from '../src/mapV2/presentation/transportPaint';
import { getTurkeyPlayerRoadCorridors } from '../src/mapV2/world/countryRoadCorridorLoader';

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

console.log('\n=== Map V2 Curated Country ROAD Corridors ===\n');

const overviewFit = visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW, 1);
assert(overviewFit.includes('ROAD_MOTORWAY') && overviewFit.includes('ROAD_TRUNK'), 'inspector overview fit shows motorway+trunk');
assert(!overviewFit.includes('ROAD_PRIMARY') && !overviewFit.includes('ROAD_SECONDARY'), 'inspector overview fit hides primary/secondary');
assert(
  visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW, 1.8).join(',') === overviewFit.join(','),
  'inspector overview profile does not add classes with zoom',
);

const detailLow = visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_COUNTRY_DETAIL, 1);
const detailMid = visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_COUNTRY_DETAIL, 1.3);
const detailHigh = visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_COUNTRY_DETAIL, 1.6);
assert(detailLow.join(',') === 'ROAD_MOTORWAY,ROAD_TRUNK', 'detail fit = corridors only');
assert(detailMid.includes('ROAD_PRIMARY') && !detailMid.includes('ROAD_SECONDARY'), 'detail mid adds primary');
assert(detailHigh.includes('ROAD_SECONDARY'), 'detail high adds secondary');

const debugAll = visibleRoadStylesForProfile(ROAD_RENDER_PROFILE_DEBUG, 1);
assert(debugAll.includes('ROAD_PRIMARY') && debugAll.includes('ROAD_SECONDARY'), 'debug profile exposes full class set');

const overviewPlan = resolveRoadDrawPlan(ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW, 1.8, 'AUTO', true);
assert(overviewPlan.useOverview && !overviewPlan.useChunks, 'inspector overview never swaps to chunk layer');
assert(overviewPlan.keepOverviewCorridors, 'inspector overview keeps corridor layer');

const detailPlan = resolveRoadDrawPlan(ROAD_RENDER_PROFILE_COUNTRY_DETAIL, 1.5, 'AUTO', false);
assert(detailPlan.useOverview && detailPlan.useChunks, 'detail adds chunks without dropping overview');
assert(!detailPlan.chunkStyles.includes('ROAD_MOTORWAY'), 'detail chunks do not replace motorway corridors');

const debugSwap = resolveRoadDrawPlan(ROAD_RENDER_PROFILE_DEBUG, 1.3, 'AUTO', true);
assert(debugSwap.useChunks && !debugSwap.useOverview, 'debug AUTO may use chunks after overview exit');
assert(resolveRoadDrawPlan(ROAD_RENDER_PROFILE_DEBUG, 1, 'NETWORK_HIGH', true).useChunks, 'debug HIGH uses full chunk network');

const border = paintForCountryFocus().strokeWidth;
const motorwayOverview = paintForRoadProfile('ROAD_MOTORWAY', ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW);
const trunkOverview = paintForRoadProfile('ROAD_TRUNK', ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW);
assert(countryOverviewRoadStrokeIsSubordinate(), 'motorway stroke much thinner than country border');
assert(motorwayOverview.strokeWidth < border, 'motorway < country border');
assert(trunkOverview.strokeWidth < motorwayOverview.strokeWidth, 'trunk thinner than motorway');
assert(motorwayOverview.strokeWidth < 0.0002, 'overview motorway is not river-thick');
assert(!motorwayOverview.color.includes('7DD3FC') && motorwayOverview.color !== '#38BDF8', 'overview is not bright cyan');
assert(paintForTransportStyle('ROAD_MOTORWAY', ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW).dash.length === 0, 'roads remain solid');
assert(paintForTransportStyle('RAIL_MAIN').dash.length > 0, 'debug RAIL_MAIN paint stays distinct from solid ROAD');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
const prototype = read('src/mapV2/screens/MapV2RoadPrototypeScreen.tsx');
const artifactPath = resolve(root, 'src/mapV2/generated/countryOverview/turkey-road-corridors.json');
assert(existsSync(artifactPath), 'curated ROAD corridor artifact exists');
const artifact = getTurkeyPlayerRoadCorridors();
assert(artifact.mode === 'ROAD' && artifact.schemaVersion === 1, 'curated artifact is ROAD schema v1');
assert(artifact.sourceRoadPackageHash === EXPECTED_ROAD_SOURCE_PACKAGE_HASH, 'curated artifact source hash is approved');
assert(artifact.corridors.length === 10, 'curated artifact has 10 player ROAD corridors');
assert(statSync(artifactPath).size < 200_000, 'curated ROAD artifact stays compact');

assert(world.includes('playerCorridorLayer'), 'player country dashboard wires curated ROAD corridors');
assert(!world.includes('ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW'), 'player country does not use ROAD_RENDER_PROFILE_COUNTRY_OVERVIEW');
assert(!world.includes('roadLayer='), 'player country does not mount the ROAD runtime layer');
assert(!world.includes('getRoadRuntimeManifest'), 'player country does not import the canonical ROAD runtime');
assert(!world.includes('requestRoadChunkLoads'), 'player country does not load spatial ROAD chunks');
assert(!world.includes('turkey-road-network.json'), 'player country does not import the canonical ROAD graph');
assert(canvas.includes('getTurkeyPlayerRoadCorridors'), 'canvas loads the curated ROAD corridor artifact');
assert(canvas.includes('groupCorridorsByInteractionState'), 'selection uses ROAD corridor visual-state grouping');
assert(canvas.includes('corridorInteractionPaint'), 'selection uses ROAD corridor interaction paint');
assert(
  canvas.indexOf('{playerCorridorPaths ?') < canvas.indexOf('cityDrawIds.map'),
  'curated ROAD corridors render below city nodes',
);
assert(prototype.includes('ROAD_RENDER_PROFILE_DEBUG'), 'road inspector map uses debug profile');
assert(canvas.includes('contentFitScale'), 'debug ROAD LOD uses content-fit zoom, not world-fit');
assert(canvas.includes('corridorReady'), 'debug/inspector overview still waits for intended runtime corridors');
assert(!canvas.includes('ROAD_STYLE_DRAW_ORDER.map'), 'country draw is not the full style stack by default');
assert(canvas.includes('requestRoadChunkLoads'), 'async chunk queue still present for debug/detail');
assert(!canvas.includes('loadRoadChunks('), 'no sync 46-chunk load');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(!read('src/mapV2/presentation/roadRenderProfile.ts').includes('mapRoadNetwork'), 'no legacy geography');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
