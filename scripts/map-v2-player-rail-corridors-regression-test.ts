/**
 * Player-facing RAIL corridor extraction + artifact + preview flag.
 * Run: npx tsx scripts/map-v2-player-rail-corridors-regression-test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EXPECTED_RAIL_SOURCE_PACKAGE_HASH,
  PLAYER_RAIL_CORRIDOR_POLICY_VERSION,
  PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS,
  railCorridorIdForPair,
} from '../src/mapV2/geo/playerFacingRailCorridor';
import {
  RAIL_CORRIDOR_COST_POLICY_VERSION,
  buildRailUndirectedAdjacency,
  dijkstraShortestPath,
  railEdgeClassWeight,
} from '../src/mapV2/geo/railCorridorRouting';
import { deltaDecodeQuantized } from '../src/mapV2/geo/roadRuntimePackage';
import type { GeoTransportEdgeRecord } from '../src/mapV2/geo/transportNetwork';
import {
  groupRailCorridorsByInteractionState,
  railCorridorTouchesGeoCity,
  resolveRailCorridorInteractionState,
} from '../src/mapV2/gameplay/countryRailCorridorInteraction';
import { isRailPlayerVisualPreviewEnabled, railPlayerVisualMode } from '../src/mapV2/gameplay/railPlayerVisual';
import { geoCityIdForGameplayCity } from '../src/mapV2/world/countryCityLoader';
import { getTurkeyPlayerRailCorridors } from '../src/mapV2/world/countryRailCorridorLoader';

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
  usage: string | null = 'main',
  service: string | null = null,
): GeoTransportEdgeRecord {
  return {
    edgeId: id,
    mode: 'RAIL',
    fromNodeId: from,
    toNodeId: to,
    geometry: { wgs84: [], projectedQuantized: [0, 0, 1, 0] },
    lengthMeters: meters,
    networkLod: 'NETWORK_LOW',
    attributes: { usage, service },
    sourceMetadata: {},
  };
}

console.log('\n=== Map V2 Player Rail Corridors ===\n');

assert(railEdgeClassWeight('main', null) === 0.92, 'main usage weight');
assert(railEdgeClassWeight('branch', null) === 1, 'branch usage weight');
assert(railEdgeClassWeight(null, null) === 1.04, 'unknown usage weight');
assert(railEdgeClassWeight('main', 'yard') === 12, 'yard service heavily discouraged');
assert(railEdgeClassWeight('industrial', null) === 8, 'industrial discouraged');

const graph = [
  edge('main', 'a', 'b', 100, 'main'),
  edge('yard', 'a', 'b', 80, 'main', 'yard'),
  edge('b-c', 'b', 'c', 50, 'branch'),
];
const adj = buildRailUndirectedAdjacency(graph);
const first = dijkstraShortestPath(adj, 'a', 'c');
const second = dijkstraShortestPath(adj, 'a', 'c');
assert(Boolean(first && second && first.edgeIds.join() === second.edgeIds.join()), 'dijkstra is deterministic');
assert(first?.edgeIds[0] === 'main', 'prefers mainline over shorter yard');
assert(first?.lengthMeters === 150, 'length is geographic meters');
assert(dijkstraShortestPath(adj, 'a', 'z') === null, 'disconnected graph returns null');

const artifact = getTurkeyPlayerRailCorridors();
assert(artifact.schemaVersion === 1, 'artifact schema v1');
assert(artifact.mode === 'RAIL', 'mode RAIL');
assert(artifact.sourceRailPackageHash === EXPECTED_RAIL_SOURCE_PACKAGE_HASH, 'source RAIL hash frozen');
assert(artifact.corridorPolicyVersion === PLAYER_RAIL_CORRIDOR_POLICY_VERSION, 'policy version');
assert(artifact.routeCostPolicyVersion === RAIL_CORRIDOR_COST_POLICY_VERSION, 'cost policy version');
assert(artifact.contentHash.startsWith('sha256:'), 'content hash present');
const fileJson = JSON.parse(read('src/mapV2/generated/countryOverview/turkey-rail-corridors.json'));
assert(artifact.contentHash === fileJson.contentHash, 'loaded artifact hash matches file');
const { contentHash: _contentHash, ...body } = fileJson;
const recomputed = `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
assert(recomputed === artifact.contentHash, 'content hash is deterministic over body');

const required = [
  railCorridorIdForPair('istanbul', 'ankara'),
  railCorridorIdForPair('izmir', 'ankara'),
  railCorridorIdForPair('ankara', 'adana'),
  railCorridorIdForPair('adana', 'diyarbakir'),
];
const ids = artifact.corridors.map((row) => row.id).sort();
assert(ids.join() === [...ids].sort().join(), 'corridor ids sorted');
for (const id of required) {
  assert(ids.includes(id), `required ${id}`);
}
assert(artifact.corridors.length >= 4 && artifact.corridors.length <= 5, `V1 corridor count ${artifact.corridors.length} is 4–5`);

const connected = new Set<string>();
for (const row of artifact.corridors) {
  connected.add(row.fromLegacyCityId);
  connected.add(row.toLegacyCityId);
  assert(row.status === 'PROVISIONAL_SOURCE_PATH', `${row.id} remains PROVISIONAL_SOURCE_PATH`);
  assert(row.accessStatusFrom === 'PROVISIONAL' && row.accessStatusTo === 'PROVISIONAL', `${row.id} access candidate-level`);
  assert(row.sourceEdgeCount > 0, `${row.id} has source edges`);
  assert(row.sourceRouteLengthMeters > 40_000, `${row.id} has intercity length`);
  assert(row.q.length >= 4, `${row.id} has polyline`);
  const decoded = deltaDecodeQuantized(row.q);
  assert(decoded.length >= 4 && decoded.every((n: number) => Number.isFinite(n)), `${row.id} finite geometry`);
  assert(decoded.length >= 16, `${row.id} is a source polyline, not two endpoints`);
  assert(!row.id.includes('bursa') && !row.id.includes('antalya') && !row.id.includes('trabzon'), `${row.id} is not an unresolved city pair`);
}

for (const city of PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS) {
  assert(!connected.has(city), `${city} is not force-connected`);
}

const adanaAnkara = artifact.corridors.find((row) => row.id === railCorridorIdForPair('ankara', 'adana'));
assert(Boolean(adanaAnkara?.fromAccessName === 'Yenice' || adanaAnkara?.toAccessName === 'Yenice'), 'Adana access named Yenice');
assert(
  Boolean(adanaAnkara?.fromRailAccessId.includes('35.0553773') || adanaAnkara?.toRailAccessId.includes('35.0553773')),
  'Adana uses Yenice node, no fake city connector',
);

const bytes = statSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-rail-corridors.json')).size;
assert(bytes > 2_000 && bytes < 400_000, `player artifact size ${bytes} is compact`);
const artifactText = read('src/mapV2/generated/countryOverview/turkey-rail-corridors.json');
assert(!artifactText.includes('turkey-rail-network.json'), 'canonical package path not bundled');
assert(!artifactText.includes('"stations"'), 'station dataset not bundled');
assert(!artifactText.includes('VERIFIED_SOURCE_PATH'), 'no VERIFIED status');

const lineagePath = resolve(root, 'src/mapV2/generated/countryOverview/turkey-rail-corridors.lineage.json');
if (existsSync(lineagePath)) {
  const lineage = JSON.parse(readFileSync(lineagePath, 'utf8'));
  assert(lineage.sourceRailPackageHash === EXPECTED_RAIL_SOURCE_PACKAGE_HASH, 'lineage source hash');
  for (const row of artifact.corridors) {
    const rec = lineage.corridors[row.id];
    assert(Array.isArray(rec?.sourceEdgeIds) && rec.sourceEdgeIds.length === row.sourceEdgeCount, `${row.id} lineage edges`);
    assert(rec.sourceNodeIds[0] === row.fromRailAccessId, `${row.id} lineage starts at from access`);
    assert(rec.sourceNodeIds[rec.sourceNodeIds.length - 1] === row.toRailAccessId, `${row.id} lineage ends at to access`);
    assert(rec.sourceNodeIds.length === rec.sourceEdgeIds.length + 1, `${row.id} continuous node/edge sequence`);
    const hashed = `sha256:${createHash('sha256').update(JSON.stringify(rec.sourceEdgeIds)).digest('hex')}`;
    assert(hashed === row.sourceEdgeIdsHash, `${row.id} sourceEdgeIdsHash matches lineage`);
  }
} else {
  assert(false, 'lineage sidecar exists for tests');
}

assert(railPlayerVisualMode() === 'RAIL_PLAYER_VISUAL_OFF', 'preview flag default OFF');
assert(!isRailPlayerVisualPreviewEnabled(), 'preview helper default false');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('playerRailCorridorLayer'), 'country can attach rail preview layer');
assert(world.includes('railVisualPreview'), 'preview gated by DEV state');
assert(!world.includes('railDebugLayer'), 'country dashboard does not attach rail debug');
assert(!world.includes('getRailDebugView'), 'country dashboard does not load debug rail package');
assert(!world.includes('dijkstraShortestPath'), 'no pathfinding on country screen');
assert(world.includes("from '../gameplay/railPlayerVisual'"), 'uses rail visual flag');
assert(world.includes('returnFromCityDetail'), 'city detail back path preserved');

const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvas.includes('playerRailCorridorPaths'), 'canvas can draw curated rail');
assert(canvas.includes('getTurkeyPlayerRailCorridors'), 'canvas loads curated artifact only when enabled');
assert(!canvas.includes('turkey-rail-network.json'), 'canvas does not import canonical rail');
assert(canvas.indexOf('playerCorridorPaths') < canvas.indexOf('playerRailCorridorPaths'), 'ROAD corridors before RAIL in source');
assert(canvas.includes('RAIL_CORRIDOR_INTERACTION_DRAW_ORDER'), 'rail interaction batching');
assert(!canvas.toLowerCase().includes('train'), 'no train animation');

const legend = read('src/mapV2/screens/MapV2TransportLegend.tsx');
assert(legend.includes("key: 'RAIL'"), 'rail legend row exists');
assert(legend.includes('active: false'), 'rail is not gameplay-active');
assert(legend.includes('legendPreview'), 'preview copy available');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendPreview: 'Önizleme'"), 'Önizleme copy');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes('legendSoon'), 'Yakında copy remains');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(read('src/mapV2/geo/playerFacingRoadCorridor.ts').includes('PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES'), 'ROAD corridor contract intact');
assert(!read('scripts/map-v2/build-turkey-road-corridors.ts').includes('buildTurkeyRailCorridors'), 'ROAD extraction script not mixed');
assert(!read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('rail'), 'city detail has no rail section');

const ankara = geoCityIdForGameplayCity('ankara')!;
const bursa = geoCityIdForGameplayCity('bursa')!;
const none = groupRailCorridorsByInteractionState(artifact.corridors, null);
assert(none.RAIL_DEFAULT.length === artifact.corridors.length, 'no selection → all RAIL_DEFAULT');
assert(none.RAIL_CONNECTED_TO_SELECTED.length === 0, 'no selection → no rail emphasis');
const ankaraGroups = groupRailCorridorsByInteractionState(artifact.corridors, ankara);
assert(ankaraGroups.RAIL_CONNECTED_TO_SELECTED.length >= 2, 'Ankara emphasizes connected rail');
assert(
  ankaraGroups.RAIL_CONNECTED_TO_SELECTED.every((row) => railCorridorTouchesGeoCity(row, ankara)),
  'emphasized rail touches Ankara',
);
assert(
  ankaraGroups.RAIL_DIMMED.every((row) => !railCorridorTouchesGeoCity(row, ankara)),
  'dimmed rail does not touch Ankara',
);
const bursaGroups = groupRailCorridorsByInteractionState(artifact.corridors, bursa);
assert(bursaGroups.RAIL_CONNECTED_TO_SELECTED.length === 0, 'Bursa selection invents no rail');
assert(
  resolveRailCorridorInteractionState({
    corridor: artifact.corridors[0],
    selectedGeoCityId: bursa,
  }) !== 'RAIL_CONNECTED_TO_SELECTED',
  'Bursa does not highlight a fabricated corridor',
);

const loader = read('src/mapV2/world/countryRailCorridorLoader.ts');
assert(loader.includes('turkey-rail-corridors.json'), 'loader uses curated artifact');
assert(!loader.includes('turkey-rail-debug.json'), 'loader does not pull debug rail');
assert(!loader.includes('turkey-rail-network.json'), 'loader does not pull canonical rail');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
