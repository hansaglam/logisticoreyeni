/**
 * Player-facing ROAD corridor extraction + artifact.
 * Run: npx tsx scripts/map-v2-player-road-corridors-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../src/mapV2/domain/ids';
import {
  EXPECTED_ROAD_SOURCE_PACKAGE_HASH,
  PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES,
  PLAYER_ROAD_CORRIDOR_POLICY_VERSION,
  corridorIdForPair,
} from '../src/mapV2/geo/playerFacingRoadCorridor';
import {
  buildDirectedAdjacency,
  buildUndirectedAdjacency,
  dijkstraShortestPath,
} from '../src/mapV2/geo/roadCorridorRouting';
import { deltaDecodeQuantized } from '../src/mapV2/geo/roadRuntimePackage';
import type { GeoTransportEdgeRecord } from '../src/mapV2/geo/transportNetwork';
import { getTurkeyPlayerRoadCorridors } from '../src/mapV2/world/countryRoadCorridorLoader';
import { corridorVisualState } from '../src/mapV2/world/countryRoadCorridorLoader';

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

function edge(
  id: string,
  from: string,
  to: string,
  meters: number,
  oneway: string | null = null,
  highway = 'primary',
): GeoTransportEdgeRecord {
  return {
    edgeId: id,
    mode: 'ROAD',
    fromNodeId: from,
    toNodeId: to,
    geometry: { wgs84: [], projectedQuantized: [0, 0, 1, 0] },
    lengthMeters: meters,
    networkLod: 'NETWORK_LOW',
    attributes: { highway, oneway },
    sourceMetadata: {},
  };
}

console.log('\n=== Map V2 Player Road Corridors ===\n');

const chain = [edge('e1', 'a', 'b', 100), edge('e2', 'b', 'c', 50, 'yes')];
const undirected = buildUndirectedAdjacency(chain);
const first = dijkstraShortestPath(undirected, 'a', 'c');
const second = dijkstraShortestPath(undirected, 'a', 'c');
assert(Boolean(first && second && first.edgeIds.join() === second.edgeIds.join()), 'dijkstra is deterministic');
assert(first?.lengthMeters === 150, 'cost uses geographic meters');
assert(dijkstraShortestPath(undirected, 'a', 'z') === null, 'disconnected graph returns null');
assert(dijkstraShortestPath(undirected, 'a', 'a')?.edgeIds.length === 0, 'same-node route has no edges');

const directed = buildDirectedAdjacency([edge('ow', 'a', 'b', 10, 'yes')]);
assert(dijkstraShortestPath(directed, 'a', 'b')?.edgeIds[0] === 'ow', 'oneway forward allowed');
assert(dijkstraShortestPath(directed, 'b', 'a') === null, 'oneway reverse blocked in directed mode');
assert(dijkstraShortestPath(buildUndirectedAdjacency([edge('ow', 'a', 'b', 10, 'yes')]), 'b', 'a')?.edgeIds[0] === 'ow', 'overview undirected may reverse a oneway edge');

const missing = dijkstraShortestPath(undirected, 'missing', 'c');
assert(missing === null, 'missing access returns null');

const artifact = getTurkeyPlayerRoadCorridors();
assert(artifact.schemaVersion === 1, 'artifact schema v1');
assert(artifact.sourceRoadPackageHash === EXPECTED_ROAD_SOURCE_PACKAGE_HASH, 'source ROAD hash frozen');
assert(artifact.corridorPolicyVersion === PLAYER_ROAD_CORRIDOR_POLICY_VERSION, 'policy version');
assert(artifact.corridors.length === 10, '10 resolved corridors');
assert(artifact.unresolved.length === 0, 'no unresolved candidates');
assert(artifact.contentHash.startsWith('sha256:'), 'content hash present');
assert(artifact.contentHash === JSON.parse(read('src/mapV2/generated/countryOverview/turkey-road-corridors.json')).contentHash, 'loaded artifact hash matches file');

const ids = artifact.corridors.map((row) => row.id).sort();
assert(ids.join() === [...ids].sort().join(), 'corridor ids sorted deterministically');
const expectedIds = PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES.map((row) =>
  corridorIdForPair(row.fromLegacyCityId, row.toLegacyCityId),
).sort();
assert(ids.join() === expectedIds.join(), 'artifact matches candidate pair identities');

const connected = new Set<string>();
for (const row of artifact.corridors) {
  connected.add(row.fromLegacyCityId);
  connected.add(row.toLegacyCityId);
  assert(row.status === 'PROVISIONAL_SOURCE_PATH', `${row.id} remains PROVISIONAL access path`);
  assert(row.sourceEdgeCount > 0, `${row.id} has source edges`);
  assert(row.sourceRouteLengthMeters > 8000, `${row.id} has geographic length`);
  assert(row.q.length >= 4, `${row.id} has polyline`);
  const decoded = deltaDecodeQuantized(row.q);
  assert(decoded.length >= 4 && decoded.every((n) => Number.isFinite(n)), `${row.id} finite quantized geometry`);
  assert(decoded.length >= 16, `${row.id} has a simplified source polyline, not two endpoints`);
}
assert(
  LEGACY_STABLE_GAMEPLAY_CITY_IDS.every((id) => connected.has(id)),
  'all 8 gameplay cities appear on the curated network',
);

const bytes = statSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-road-corridors.json')).size;
assert(bytes > 4_000 && bytes < 200_000, `player artifact size ${bytes} is compact`);

const muted = corridorVisualState(artifact.corridors[0], {
  [artifact.corridors[0].fromGeoCityId]: 'UNLOCKED',
  [artifact.corridors[0].toGeoCityId]: 'LOCKED',
});
assert(muted === 'mixed', 'progression mutes mixed corridors without deleting geometry');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(world.includes('playerCorridorLayer'), 'country experience wires player corridors');
assert(!world.includes('roadLayer='), 'player country does not mount ROAD runtime layer');
assert(!world.includes('getRoadRuntimeManifest'), 'player country does not load ROAD manifest');
assert(!world.includes('turkey-road-network.json'), 'player country does not import canonical ROAD monolith');
assert(canvas.includes('playerCorridorPaths'), 'canvas draws corridor batches');
const drawStart = canvas.indexOf('{drawIds.map');
assert(drawStart >= 0, 'country paths draw');
assert(
  canvas.indexOf('playerCorridorPaths ?', drawStart) > drawStart &&
    canvas.indexOf('playerCorridorPaths ?', drawStart) < canvas.indexOf('{cityDrawIds.map', drawStart),
  'roads draw underneath city nodes',
);
assert(canvas.includes('corridorInteractionPaint'), 'dashboard corridor paint tokens');
assert(!canvas.includes('dijkstraShortestPath'), 'no runtime pathfinding in canvas');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/data/routes.ts').includes('corridor.tur'), 'routes.ts has no corridor ids');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('corridorInspectorTitle'), 'DEV corridor inspector');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_PLAYER_ROAD_CORRIDORS.md')), 'architecture doc');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
