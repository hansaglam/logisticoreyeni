/**
 * Map V2 Step 13 player-facing SEA corridors.
 * Run: npx tsx scripts/map-v2-player-sea-corridors-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'path';

import {
  PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS,
  seaCorridorIdForPair,
  type PlayerFacingSeaCorridorArtifactV1,
} from '../src/mapV2/geo/playerFacingSeaCorridor';
import { channelsUsedFromTraversedPath, seaEdgeTravelCost } from '../src/mapV2/geo/seaCorridorRouting';
import { simplifyOpenPolylineProtected } from '../src/mapV2/geo/simplifyPolyline';
import { isNavigableWater, segmentHitsLand } from '../src/mapV2/geo/maritimeNavigability';
import { projectLonLatRing, type ProjectedPolygon } from '../src/mapV2/geo/geometry';
import { seaPlayerVisualMode } from '../src/mapV2/gameplay/seaPlayerVisual';
import { resolveSeaCorridorInteractionState } from '../src/mapV2/gameplay/countrySeaCorridorInteraction';
import { getTurkeyPlayerSeaCorridors } from '../src/mapV2/world/countrySeaCorridorLoader';
import { geoCityIdForGameplayCity } from '../src/mapV2/world/countryCityLoader';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from '../src/mapV2/geo/transportNetwork';

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

function landBox(west: number, south: number, east: number, north: number): ProjectedPolygon {
  return {
    exterior: projectLonLatRing([
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]),
    holes: [],
  };
}

console.log('\n=== Map V2 Player SEA Corridors ===\n');

const artifact = getTurkeyPlayerSeaCorridors();
const fileJson = JSON.parse(read('src/mapV2/generated/countryOverview/turkey-sea-corridors.json')) as PlayerFacingSeaCorridorArtifactV1;
assert(artifact.contentHash === fileJson.contentHash, 'loaded artifact hash matches file');
assert(artifact.mode === 'SEA', 'mode SEA');
assert(artifact.schemaVersion === 1, 'schema v1');
assert(artifact.corridors.length >= 5 && artifact.corridors.length <= 6, '5–6 corridors');
assert(artifact.corridors.every((row) => row.status === 'PROVISIONAL_SOURCE_PATH'), 'no VERIFIED');
assert(!artifact.corridors.some((row) => PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS.includes(row.fromLegacyCityId as 'ankara')), 'Ankara not a SEA endpoint');
assert(!artifact.corridors.some((row) => row.fromLegacyCityId === 'diyarbakir' || row.toLegacyCityId === 'diyarbakir'), 'Diyarbakır not a SEA endpoint');

const byId = Object.fromEntries(artifact.corridors.map((row) => [row.id, row]));
const izmirIst = byId[seaCorridorIdForPair('istanbul', 'izmir')];
const istTrb = byId[seaCorridorIdForPair('istanbul', 'trabzon')];
const izmAnt = byId[seaCorridorIdForPair('izmir', 'antalya')];
const antAdn = byId[seaCorridorIdForPair('antalya', 'adana')];
const brsTrb = byId[seaCorridorIdForPair('bursa', 'trabzon')];
assert(Boolean(izmirIst), 'İstanbul↔İzmir present');
assert(izmirIst?.channelsUsed.includes('DARDANELLES') === true, 'İstanbul↔İzmir uses Dardanelles');
assert(izmirIst?.channelsUsed.includes('BOSPHORUS') !== true, 'İstanbul↔İzmir does not claim Bosphorus');
assert(istTrb?.channelsUsed.includes('BOSPHORUS') === true, 'İstanbul↔Trabzon uses Bosphorus');
assert(brsTrb?.channelsUsed.includes('BOSPHORUS') === true, 'Bursa↔Trabzon uses Bosphorus');
assert(Boolean(izmAnt) && Boolean(antAdn), 'Aegean and Mediterranean corridors present');
assert((izmirIst?.sourceRouteLengthMeters ?? 0) > 80_000, 'İstanbul↔İzmir is an intercity sea path');
assert((istTrb?.sourceRouteLengthMeters ?? 0) > 200_000, 'İstanbul↔Trabzon is not a Bosphorus-mouth stub');
assert(antAdn?.toPortName?.toLowerCase().includes('yumurtal') || antAdn?.fromPortName?.toLowerCase().includes('yumurtal'), 'Adana corridor uses Yumurtalık');
assert(antAdn?.portAssociationFrom === 'REGIONAL' || antAdn?.portAssociationTo === 'REGIONAL', 'Adana remains REGIONAL association');

const bytes = statSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-sea-corridors.json')).size;
assert(bytes < 100_000, `artifact ${bytes} bytes is compact`);
assert(existsSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-sea-corridors.lineage.json')), 'lineage sidecar');
const lineage = JSON.parse(read('src/mapV2/generated/countryOverview/turkey-sea-corridors.lineage.json')) as Record<string, { sourceEdgeIds: string[] }>;
assert(Boolean(lineage[izmirIst.id]?.sourceEdgeIds?.length), 'İstanbul↔İzmir has source edges');

const bos: GeoTransportNodeRecord[] = [
  { nodeId: 'black', mode: 'SEA', kind: 'SEA_WAYPOINT', geoCountryId: 'country.tur', coordinate: { longitude: 29.2, latitude: 41.5 }, projected: { x: 0, y: 0 }, sourceMetadata: { region: 'BLACK_SEA', channel: null, grid: 'COARSE' } },
  { nodeId: 'bosN', mode: 'SEA', kind: 'SEA_WAYPOINT', geoCountryId: 'country.tur', coordinate: { longitude: 29.05, latitude: 41.2 }, projected: { x: 0, y: 0 }, sourceMetadata: { region: 'BLACK_SEA', channel: 'BOSPHORUS', grid: 'CHANNEL' } },
  { nodeId: 'bosS', mode: 'SEA', kind: 'SEA_WAYPOINT', geoCountryId: 'country.tur', coordinate: { longitude: 29.04, latitude: 41.01 }, projected: { x: 0, y: 0 }, sourceMetadata: { region: 'MARMARA', channel: 'BOSPHORUS', grid: 'CHANNEL' } },
  { nodeId: 'marm', mode: 'SEA', kind: 'SEA_WAYPOINT', geoCountryId: 'country.tur', coordinate: { longitude: 28.5, latitude: 40.7 }, projected: { x: 0, y: 0 }, sourceMetadata: { region: 'MARMARA', channel: null, grid: 'COARSE' } },
];
const bosEdges: GeoTransportEdgeRecord[] = [
  { edgeId: 'e1', mode: 'SEA', fromNodeId: 'black', toNodeId: 'bosN', geometry: { wgs84: [], projectedQuantized: [0, 0, 1, 1] }, lengthMeters: 40000, networkLod: 'NETWORK_HIGH', attributes: { channel: null }, sourceMetadata: {} },
  { edgeId: 'e2', mode: 'SEA', fromNodeId: 'bosN', toNodeId: 'bosS', geometry: { wgs84: [], projectedQuantized: [0, 0, 1, 1] }, lengthMeters: 25000, networkLod: 'NETWORK_HIGH', attributes: { channel: 'BOSPHORUS' }, sourceMetadata: {} },
  { edgeId: 'e3', mode: 'SEA', fromNodeId: 'bosS', toNodeId: 'marm', geometry: { wgs84: [], projectedQuantized: [0, 0, 1, 1] }, lengthMeters: 30000, networkLod: 'NETWORK_HIGH', attributes: { channel: null }, sourceMetadata: {} },
];
const nodeMap = new Map(bos.map((node) => [node.nodeId, node]));
const edgeMap = new Map(bosEdges.map((edge) => [edge.edgeId, edge]));
assert(
  channelsUsedFromTraversedPath(['black', 'bosN', 'bosS', 'marm'], ['e1', 'e2', 'e3'], nodeMap, edgeMap).includes('BOSPHORUS'),
  'full Bosphorus span counts',
);
assert(
  !channelsUsedFromTraversedPath(['bosS', 'marm'], ['e3'], nodeMap, edgeMap).includes('BOSPHORUS'),
  'endpoint-adjacent Marmara hop does not count Bosphorus',
);

const peninsula = { neLand: [landBox(27.4, 38.3, 27.6, 38.5)], osmMarine: [] };
assert(segmentHitsLand({ longitude: 27.2, latitude: 38.4 }, { longitude: 27.8, latitude: 38.4 }, peninsula), 'peninsula still blocked');
assert(isNavigableWater(26.9, 38.4, { neLand: [], osmMarine: [] }), 'open sea water');
const island = { neLand: [landBox(26.9, 38.2, 27.05, 38.32)], osmMarine: [] };
assert(segmentHitsLand({ longitude: 26.7, latitude: 38.26 }, { longitude: 27.2, latitude: 38.26 }, island), 'island crossing rejected');
const protectedSimpl = simplifyOpenPolylineProtected(
  [
    { x: 0, y: 0 },
    { x: 0.01, y: 0.0001 },
    { x: 0.02, y: 0 },
  ],
  0.01,
  new Set([1]),
);
assert(protectedSimpl.length === 3, 'protected strait vertex kept');

const dummyEdge = { lengthMeters: 1000 } as const;
const localFar = {
  nodeId: 'l',
  mode: 'SEA' as const,
  kind: 'SEA_WAYPOINT' as const,
  geoCountryId: 'country.tur' as const,
  coordinate: { longitude: 30, latitude: 40 },
  projected: { x: 0, y: 0 },
  sourceMetadata: { grid: 'LOCAL' },
};
const portA = { longitude: 26.8, latitude: 38.4 };
const portB = { longitude: 28.9, latitude: 41 };
assert(seaEdgeTravelCost(dummyEdge, localFar, localFar, portA, portB) > 5000, 'far local approach is expensive');

assert(seaPlayerVisualMode() === 'SEA_PLAYER_VISUAL_OFF', 'preview flag default OFF');
const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('playerSeaCorridorLayer'), 'country can attach sea preview layer');
assert(world.includes('seaVisualPreview'), 'preview gated by DEV state');
assert(!world.includes("require('../generated/transport/turkey-sea-network.json')"), 'country dashboard does not load canonical sea');
assert(!read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('turkey-ports.json'), 'canvas does not load port catalog');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('getTurkeyPlayerSeaCorridors'), 'canvas loads curated sea artifact only when enabled');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'SEA'"), 'sea legend row exists');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'sea is not gameplay-active');

const sample = artifact.corridors[0];
assert(
  resolveSeaCorridorInteractionState({ corridor: sample, selectedGeoCityId: null }) === 'SEA_DEFAULT',
  'no selection → SEA_DEFAULT',
);
assert(
  resolveSeaCorridorInteractionState({ corridor: sample, selectedGeoCityId: sample.fromGeoCityId }) ===
    'SEA_CONNECTED_TO_SELECTED',
  'selected endpoint strengthens corridor',
);
const ankaraId = geoCityIdForGameplayCity('ankara');
assert(
  resolveSeaCorridorInteractionState({ corridor: sample, selectedGeoCityId: ankaraId }) === 'SEA_DIMMED',
  'Ankara selection does not invent SEA relation',
);

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('scripts/map-v2/build-turkey-road-corridors.ts').includes('buildTurkeySeaCorridors'), 'ROAD extraction not mixed');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('buildTurkeySeaCorridors'), 'RAIL extraction not mixed');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
