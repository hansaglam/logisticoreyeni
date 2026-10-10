/**
 * Map V2 Step 2E ROAD ingest + DEV render contracts.
 * Run: npx tsx scripts/map-v2-road-ingest-regression-test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isExcludedOsmHighway, isPrototypeOsmHighway, OSM_HIGHWAY_PROTOTYPE_INCLUDED } from '../src/mapV2/geo/roadClassPolicy';
import { edgeVisibleAtLod } from '../src/mapV2/geo/transportNetwork';
import { TURKEY_ROADS_RAW_REL } from '../src/mapV2/geo/roadRawSource';
import { dequantizePolygons } from '../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../src/mapV2/world/countryCityLoader';
import { getTransportNetwork } from '../src/mapV2/world/transportNetworkLoader';
import { sealNetwork } from './map-v2/transport-package-factory';
import { extractOsmFeatureId, ingestOsmRoadCollection, normalizeConsecutiveCoordinates, type OsmRoadCollection, type OsmRoadFeature } from './map-v2/road-ingest-core';

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

function feature(highway: string, coords: number[][], osmId: string): OsmRoadFeature {
  return {
    type: 'Feature',
    properties: { osm_id: osmId, highway, name: 'test', ref: 'D0', hgv: 'yes' },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

function pendingManifest() {
  return getTransportNetwork('country.tur', 'ROAD')!.sourceManifest;
}

console.log('\n=== Map V2 ROAD Ingest Regression ===\n');

assert(isPrototypeOsmHighway('motorway') && isPrototypeOsmHighway('secondary'), 'allowed classes accepted by prototype policy');
assert(!isPrototypeOsmHighway('tertiary'), 'tertiary not default prototype');
assert(isExcludedOsmHighway('footway') && isExcludedOsmHighway('residential'), 'forbidden classes rejected');
assert(OSM_HIGHWAY_PROTOTYPE_INCLUDED.join(',') === 'motorway,trunk,primary,secondary', 'prototype include list');

const turkey = getCountryRecord('country.tur')!;
const polygons = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
const ankara = { lon: 32.86, lat: 39.93 };
const ankara2 = { lon: 32.9, lat: 39.95 };
const paris = [
  [2.3, 48.85],
  [2.32, 48.86],
];

const collection: OsmRoadCollection = {
  type: 'FeatureCollection',
  features: [
    feature('motorway', [[ankara.lon, ankara.lat], [ankara2.lon, ankara2.lat]], '1001'),
    feature('primary', [[ankara.lon + 0.02, ankara.lat], [ankara2.lon + 0.02, ankara2.lat]], '1002'),
    feature('footway', [[ankara.lon, ankara.lat], [ankara2.lon, ankara2.lat]], '1003'),
    feature('motorway', paris, '1004'),
  ],
};

const cities = getTurkeyCityPackage().gameplayMappings.map((row) =>
  getTurkeyCityPackage().cities.find((city) => city.geoCityId === row.geoCityId)!,
);
const first = ingestOsmRoadCollection(collection, polygons, cities, pendingManifest());
const second = ingestOsmRoadCollection(collection, polygons, cities, pendingManifest());
assert(first.network.edges.every((e) => e.fromNodeId && first.network.nodes.some((n) => n.nodeId === e.fromNodeId)), 'edge endpoints exist');
assert(first.validationIssues.length === 0, 'topology valid');
assert(first.network.nodes.every((n) => Number.isFinite(n.projected?.x ?? NaN)), 'projection finite');
assert(JSON.stringify(first.network.nodes.map((n) => n.nodeId)) === JSON.stringify(second.network.nodes.map((n) => n.nodeId)), 'deterministic IDs');
assert(sealNetwork(first.network).contentHash === sealNetwork(second.network).contentHash, 'deterministic hash');
assert(first.network.edges.every((e) => e.sourceMetadata.lineage), 'source lineage retained');
assert(first.stats.rejectedByReason['forbidden-class'] >= 1, 'forbidden class counted');
assert(first.stats.rejectedByReason['outside-turkey'] >= 1, 'foreign geometry rejected');
assert(first.network.edges.every((e) => isPrototypeOsmHighway(String(e.attributes.highway))), 'only allowed highway classes');
const low = first.network.edges.filter((e) => edgeVisibleAtLod(e.networkLod, 'NETWORK_LOW')).length;
const mid = first.network.edges.filter((e) => edgeVisibleAtLod(e.networkLod, 'NETWORK_MEDIUM')).length;
const high = first.network.edges.filter((e) => edgeVisibleAtLod(e.networkLod, 'NETWORK_HIGH')).length;
assert(low <= mid && mid <= high, 'LOD subset contract');

const izmir = cities.find((c) => c.sourceNameAscii === 'Izmir')!;
const snap = JSON.stringify(izmir);
ingestOsmRoadCollection(collection, polygons, [izmir], pendingManifest());
assert(JSON.stringify(izmir) === snap, 'no fake city snapping / GeoCity unchanged');
assert(first.cityAccess.every((row) => row.status !== 'VERIFIED'), 'access never auto VERIFIED');

assert(
  extractOsmFeatureId({ type: 'Feature', id: 'way/123456', properties: { highway: 'motorway' }, geometry: null }) === 'way/123456',
  'feature.id source extraction',
);
assert(
  extractOsmFeatureId({ type: 'Feature', properties: { osm_id: 99, highway: 'trunk' }, geometry: null }) === '99',
  'properties.osm_id extraction',
);
assert(
  extractOsmFeatureId({ type: 'Feature', properties: { highway: 'primary' }, geometry: null }) === null,
  'missing source ID fallback to geometry hash at ingest',
);

const dupCoords = normalizeConsecutiveCoordinates([
  { longitude: 32.85, latitude: 39.92 },
  { longitude: 32.85, latitude: 39.92 },
  { longitude: 32.86, latitude: 39.93 },
]);
assert(dupCoords.removed === 1 && dupCoords.coords.length === 2, 'repeated consecutive coordinate removed');

const collapse = ingestOsmRoadCollection(
  {
    type: 'FeatureCollection',
    features: [
      feature('motorway', [[32.8500000, 39.9200000], [32.85000004, 39.92000004]], 'collapse-a'),
    ],
  },
  polygons,
  [],
  pendingManifest(),
);
assert(collapse.stats.collapsedSegmentsSkipped + collapse.stats.zeroLengthSegmentsSkipped + collapse.stats.rejectedByReason['too-short'] >= 1, 'two points collapsing under topology precision skipped');

const trueDup = ingestOsmRoadCollection(
  {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'way/1', properties: { highway: 'motorway' }, geometry: { type: 'LineString', coordinates: [[32.85, 39.92], [32.86, 39.93]] } },
      { type: 'Feature', id: 'way/2', properties: { highway: 'motorway' }, geometry: { type: 'LineString', coordinates: [[32.85, 39.92], [32.86, 39.93]] } },
    ],
  },
  polygons,
  [],
  pendingManifest(),
);
assert(trueDup.stats.trueDuplicateSegmentsMerged >= 1 && trueDup.network.edges.length === 1, 'true duplicate segment merged');
assert(trueDup.network.edges[0].sourceFeatureIds?.includes('way/1') && trueDup.network.edges[0].sourceFeatureIds?.includes('way/2'), 'merged lineage keeps both source IDs');

const reverseDup = ingestOsmRoadCollection(
  {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'way/3', properties: { highway: 'trunk' }, geometry: { type: 'LineString', coordinates: [[32.85, 39.92], [32.86, 39.93]] } },
      { type: 'Feature', id: 'way/4', properties: { highway: 'trunk' }, geometry: { type: 'LineString', coordinates: [[32.86, 39.93], [32.85, 39.92]] } },
    ],
  },
  polygons,
  [],
  pendingManifest(),
);
assert(reverseDup.stats.trueDuplicateSegmentsMerged >= 1 && reverseDup.network.edges.length === 1, 'reverse duplicate segment merged');

const parallel = ingestOsmRoadCollection(
  {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'way/5', properties: { highway: 'primary' }, geometry: { type: 'LineString', coordinates: [[32.85, 39.92], [32.855, 39.925], [32.86, 39.93]] } },
      { type: 'Feature', id: 'way/6', properties: { highway: 'primary' }, geometry: { type: 'LineString', coordinates: [[32.85, 39.92], [32.854, 39.926], [32.86, 39.93]] } },
    ],
  },
  polygons,
  [],
  pendingManifest(),
);
assert(parallel.network.edges.length === 2 && parallel.stats.parallelSegmentsPreserved >= 1, 'legitimate parallel roads preserved');
assert(parallel.network.edges.every((e) => !String(e.sourceMetadata.sourceFeatureIds).includes('unknown')), 'no unknown source when feature.id present');

const missingId = ingestOsmRoadCollection(
  {
    type: 'FeatureCollection',
    features: [feature('motorway', [[32.85, 39.92], [32.86, 39.93]], '')],
  },
  polygons,
  [],
  pendingManifest(),
);
assert(missingId.network.edges.length === 1, 'missing source ID still builds an edge');
assert(String(missingId.network.edges[0].sourceFeatureIds?.[0] ?? '').startsWith('geom.'), 'missing source ID uses geometry hash fallback');

const runtimeRoad = getTransportNetwork('country.tur', 'ROAD');
assert(!!runtimeRoad, 'runtime loader returns ROAD package');
assert(getTransportNetwork('country.tur', 'RAIL')?.sourceStatus === 'PROTOTYPE', 'RAIL prototype');
assert(getTransportNetwork('country.tur', 'SEA')?.sourceStatus === 'PROTOTYPE', 'SEA prototype runtime (empty geometry)');
assert((getTransportNetwork('country.tur', 'SEA')?.nodes.length ?? -1) === 0, 'dashboard SEA nodes empty');
assert(getTransportNetwork('country.tur', 'AIR')?.sourceStatus === 'SOURCE_PENDING', 'AIR pending');

const rawExists = existsSync(resolve(root, TURKEY_ROADS_RAW_REL));
if (rawExists) {
  assert(runtimeRoad?.sourceStatus === 'PROTOTYPE' || runtimeRoad?.sourceStatus === 'SOURCE_PENDING', 'ROAD status is prototype or pending until ingest rewrite');
} else {
  assert(runtimeRoad?.sourceStatus === 'SOURCE_PENDING', 'empty packaged ROAD remains SOURCE_PENDING without raw extract');
  const ingestRun = spawnSync('npx', ['tsx', 'scripts/map-v2/ingest-turkey-roads.ts'], { cwd: root, encoding: 'utf8' });
  assert(ingestRun.status === 2, 'ingest fail-closed exit 2');
  assert((ingestRun.stderr + ingestRun.stdout).includes('STEP_2E_BLOCKED_RAW_SOURCE_REQUIRED'), 'blocked decision printed');
  assert((ingestRun.stderr + ingestRun.stdout).includes(TURKEY_ROADS_RAW_REL), 'expected path printed');
}

assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes('require(`'), 'dynamic require not reintroduced');
assert(read('src/mapV2/world/transportNetworkLoader.ts').includes('TRANSPORT_JSON_MODULES'), 'Metro-safe static registry');
assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes('mapRoadNetwork'), 'no mapRoadNetwork import');
assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes('worldMapPositions'), 'no worldMapPositions use');
assert(!read('scripts/map-v2/road-ingest-core.ts').includes("from '../../src/data/routes"), 'ingest does not touch routes.ts');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Transport Inspector'), 'inspector entry remains');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('ROAD Haritasını Aç'), 'DEV road map CTA');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('peekRoadChunkStylePath'), 'batched road paths');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('requiredPlusPrefetchIds'), 'viewport chunk query wired');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
