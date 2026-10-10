/**
 * Map V2 Step 2F ROAD runtime chunk contracts.
 * Run: npx tsx scripts/map-v2-road-runtime-regression-test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GeoTransportNetworkPackageV1 } from '../src/mapV2/geo/transportNetwork';
import { TRANSPORT_NETWORK_SCHEMA_VERSION, WEB_MERCATOR_TRANSPORT_PROJECTION } from '../src/mapV2/geo/transportNetwork';
import { networkLodForRelativeZoom } from '../src/mapV2/geo/networkLodAuto';
import {
  ROAD_CHUNKS_PER_TICK,
  ROAD_LOD_HYSTERESIS,
  ROAD_SOURCE_PACKAGE_HASH_2E,
  cellForPoint,
  deltaDecodeQuantized,
  deltaEncodeQuantized,
  expandEdgeId,
  makeChunkId,
} from '../src/mapV2/geo/roadRuntimePackage';
import { packRoadRuntime } from './map-v2/road-runtime-core';
import {
  evictRoadChunks,
  getLoadedRoadChunkStats,
  getRequiredRoadChunks,
  getRoadRuntimeManifest,
  loadRoadChunks,
  resetRoadChunkCacheForTests,
} from '../src/mapV2/world/roadChunkLoader';
import {
  cancelStaleRoadLoads,
  processRoadLoadTick,
  requestRoadChunkLoads,
  resetRoadSchedulerForTests,
  setRoadGestureActive,
} from '../src/mapV2/world/roadLoadScheduler';

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

function fixturePackage(edges: GeoTransportNetworkPackageV1['edges']): GeoTransportNetworkPackageV1 {
  return {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: 'fixture.road',
    contentHash: 'sha256:fixture',
    geoCountryId: 'country.tur',
    mode: 'ROAD',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest: {
          policyVersion: 1,
          datasetId: 'fixture',
          datasetType: 'road-network',
          sourceName: 'fixture',
          sourceURL: 'fixture',
          license: 'ODbL 1.0',
          licenseURL: 'fixture',
          sourceVersion: 'fixture',
          retrievedAt: 'fixture',
          sourceHash: 'sha256:fixture',
          originalFormat: 'fixture',
          processedFormat: 'fixture',
          processingVersion: 'fixture',
          derivedFrom: [],
          attributionRequired: false,
          productionApproved: false,
          notes: 'test-only',
        },
    transformation: {
      processingVersion: 'fixture',
      projectionVersion: 1,
      simplificationVersion: 'fixture',
      filtersApplied: [],
      lodPolicyId: 'fixture',
      quantize: 100000000,
    },
    nodes: [
      { nodeId: 'tn.tur.road.n.a', mode: 'ROAD', kind: 'ROAD_JUNCTION', geoCountryId: 'country.tur', sourceMetadata: {} },
      { nodeId: 'tn.tur.road.n.b', mode: 'ROAD', kind: 'ROAD_JUNCTION', geoCountryId: 'country.tur', sourceMetadata: {} },
    ],
    edges,
    stats: { nodeCount: 2, edgeCount: edges.length, componentCount: 1 },
    productionApproved: false,
  };
}

console.log('\n=== Map V2 ROAD Runtime Chunks ===\n');

const encoded = deltaEncodeQuantized([57000000, 38000000, 57000040, 38000010]);
assert(JSON.stringify(deltaDecodeQuantized(encoded)) === JSON.stringify([57000000, 38000000, 57000040, 38000010]), 'quantization delta roundtrip');

assert(networkLodForRelativeZoom(1.0, 'NETWORK_LOW') === 'NETWORK_LOW', 'LOD stays LOW at overview');
assert(networkLodForRelativeZoom(ROAD_LOD_HYSTERESIS.enterMedium, 'NETWORK_LOW') === 'NETWORK_MEDIUM', 'LOD hysteresis enter MEDIUM');
assert(networkLodForRelativeZoom(ROAD_LOD_HYSTERESIS.exitMedium - 0.01, 'NETWORK_MEDIUM') === 'NETWORK_LOW', 'LOD hysteresis exit MEDIUM');
assert(networkLodForRelativeZoom(ROAD_LOD_HYSTERESIS.enterHigh, 'NETWORK_MEDIUM') === 'NETWORK_HIGH', 'LOD hysteresis enter HIGH');
assert(networkLodForRelativeZoom(ROAD_LOD_HYSTERESIS.exitHigh - 0.01, 'NETWORK_HIGH') === 'NETWORK_MEDIUM', 'LOD hysteresis exit HIGH');
assert(networkLodForRelativeZoom(1.25, 'NETWORK_MEDIUM') === 'NETWORK_MEDIUM', 'LOD hysteresis hold MEDIUM');

const q = 100000000;
const west: GeoTransportNetworkPackageV1['edges'][number] = {
  edgeId: 'te.tur.road.e.aaaaaaaaaaaaaaaa',
  mode: 'ROAD',
  fromNodeId: 'tn.tur.road.n.a',
  toNodeId: 'tn.tur.road.n.b',
  geometry: {
    wgs84: [{ longitude: 27, latitude: 38 }, { longitude: 27.01, latitude: 38.01 }],
    projectedQuantized: [Math.round(0.575 * q), Math.round(0.385 * q), Math.round(0.576 * q), Math.round(0.386 * q)],
  },
  networkLod: 'NETWORK_LOW',
  attributes: { highway: 'motorway' },
  sourceMetadata: { fixture: true },
};
const east: GeoTransportNetworkPackageV1['edges'][number] = {
  ...west,
  edgeId: 'te.tur.road.e.bbbbbbbbbbbbbbbb',
  geometry: {
    wgs84: west.geometry.wgs84,
    projectedQuantized: [Math.round(0.620 * q), Math.round(0.385 * q), Math.round(0.621 * q), Math.round(0.386 * q)],
  },
};
const extraMedium: GeoTransportNetworkPackageV1['edges'][number] = {
  ...west,
  edgeId: 'te.tur.road.e.cccccccccccccccc',
  networkLod: 'NETWORK_MEDIUM',
  attributes: { highway: 'primary' },
};

const first = packRoadRuntime(fixturePackage([west, east, extraMedium]));
const second = packRoadRuntime(fixturePackage([west, east, extraMedium]));
assert(first.overviewLow.contentHash === second.overviewLow.contentHash, 'overview path package deterministic');
assert(first.overviewLow.styles.length > 0, 'overview has style batches');
assert(first.chunks.map((c) => c.id).join(',') === second.chunks.map((c) => c.id).join(','), 'deterministic chunk IDs');
assert(first.manifest.totalCounts.runtimeEdges === 3, 'manifest counts equal source counts');
assert(first.chunks.every((c) => Number.isFinite(c.b[0]) && c.b[0] <= c.b[2] && c.b[1] <= c.b[3]), 'chunk bounds valid');
const ownership = first.chunks.flatMap((c) => c.e.map((row) => row[0]));
assert(new Set(ownership).size === ownership.length, 'no duplicate runtime edge ownership');
assert(first.chunks.every((c) => c.e.every((row) => row.slice(4).every((n) => Number.isFinite(n)))), 'geometry finite');

const westCell = cellForPoint(0.5755, 0.3855, first.coverage, 'NETWORK_LOW');
assert(first.chunks.some((c) => c.id === makeChunkId('NETWORK_LOW', westCell.col, westCell.row)), 'edge belongs to expected LOD/chunk');

const runtime = getRoadRuntimeManifest();
assert(runtime.sourcePackageHash === ROAD_SOURCE_PACKAGE_HASH_2E, 'source package hash matches expected');
assert(runtime.totalCounts.runtimeEdges === runtime.totalCounts.sourceEdges, 'runtime edge count matches source');
assert(runtime.totalCounts.runtimeEdges === runtime.chunks.reduce((s, c) => s + c.edgeCount, 0), 'manifest chunk sums');

const allIds = new Set<string>();
let chunkFilesOk = true;
for (const chunk of runtime.chunks) {
  const json = JSON.parse(read(`src/mapV2/generated/transport/road/${chunk.file}`)) as { e: Array<[string, ...unknown[]]>; id: string; b: number[] };
  if (json.id !== chunk.id || json.b[0] > json.b[2] || json.b[1] > json.b[3]) chunkFilesOk = false;
  for (const row of json.e) allIds.add(expandEdgeId(row[0]));
}
assert(chunkFilesOk, 'on-disk chunk ids and bounds valid');
assert(allIds.size === runtime.totalCounts.sourceEdges, 'no edge loss vs source package counts');

const overview = getRequiredRoadChunks({ viewport: runtime.coverage, lod: 'NETWORK_LOW' });
assert(overview.every((id) => id.includes('.low.')), 'overview requires LOW only');
assert(!overview.some((id) => id.includes('.high.')), 'overview does not load HIGH');

const midView = getRequiredRoadChunks({
  viewport: runtime.chunks.find((c) => c.lod === 'NETWORK_MEDIUM')?.bounds ?? runtime.coverage,
  lod: 'NETWORK_MEDIUM',
});
assert(midView.some((id) => id.includes('.low.')) || midView.some((id) => id.includes('.medium.')), 'MEDIUM view unions layers');

resetRoadChunkCacheForTests();
loadRoadChunks(overview.slice(0, 2));
const afterLoad = getLoadedRoadChunkStats();
assert(afterLoad.loadedChunkCount === Math.min(2, overview.length), 'cache loads requested chunks');
evictRoadChunks('all');
assert(getLoadedRoadChunkStats().loadedChunkCount === 0, 'cache eviction deterministic');

resetRoadSchedulerForTests();
resetRoadChunkCacheForTests();
const before = getLoadedRoadChunkStats().loadedChunkCount;
requestRoadChunkLoads(overview.slice(0, 8));
assert(getLoadedRoadChunkStats().loadedChunkCount === before, 'country scene does not await road loader');
const tick = processRoadLoadTick();
assert(tick.chunksLoaded <= ROAD_CHUNKS_PER_TICK, 'max chunks per batch respected');
assert(getLoadedRoadChunkStats().loadedChunkCount <= ROAD_CHUNKS_PER_TICK, 'first tick loads at most batch size');

resetRoadSchedulerForTests();
resetRoadChunkCacheForTests();
requestRoadChunkLoads(overview.slice(0, 10));
requestRoadChunkLoads(overview.slice(0, 1));
processRoadLoadTick();
assert(getLoadedRoadChunkStats().loadedChunkCount <= 1, 'stale viewport work cancelled/coalesced');

resetRoadSchedulerForTests();
resetRoadChunkCacheForTests();
setRoadGestureActive(true);
requestRoadChunkLoads(overview.slice(0, 6));
const paused = processRoadLoadTick();
assert(paused.paused && paused.chunksLoaded === 0, 'active gesture pauses heavy work');
setRoadGestureActive(false);
cancelStaleRoadLoads();

assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('requestRoadChunkLoads'), 'canvas uses async road queue');
assert(!read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('loadRoadChunks('), 'canvas does not sync-load chunks');

assert(!read('src/mapV2/generated/transport/road/roadChunkRegistry.ts').includes('require(`'), 'static Metro registry has no dynamic require');
assert(read('src/mapV2/generated/transport/road/roadChunkRegistry.ts').includes('() => require('), 'lazy require getters');
assert(!read('src/mapV2/world/roadChunkLoader.ts').includes('require(`'), 'loader has no dynamic require');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/mapV2/world/roadChunkLoader.ts').includes('mapRoadNetwork'), 'legacy mapRoadNetwork unused');
assert(!read('src/mapV2/geo/roadRuntimePackage.ts').includes('Math.random'), 'no random runtime ids');

const monolith = resolve(root, 'src/mapV2/generated/transport/turkey-road-network.json');
if (existsSync(monolith)) {
  const source = JSON.parse(readFileSync(monolith, 'utf8')) as GeoTransportNetworkPackageV1;
  assert(source.contentHash === ROAD_SOURCE_PACKAGE_HASH_2E, 'on-disk source hash frozen');
  assert(source.stats.edgeCount === runtime.totalCounts.sourceEdges, 'source edge count matches runtime');
  const packed = packRoadRuntime(source);
  assert(packed.manifest.contentHash === runtime.contentHash, 'repack matches committed runtime hash');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
