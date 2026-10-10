/**
 * Map V2 Step 12 port-access repair.
 * Run: npx tsx scripts/map-v2-maritime-port-access-repair-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TurkeyPortPackageV1 } from '../src/mapV2/geo/geoPort';
import type { SeaRuntimeManifestV1 } from '../src/mapV2/geo/maritimeRuntime';
import {
  dijkstraMaritime,
  isNavigableWater,
  segmentHitsLand,
  type MaritimeGraphEdge,
  type MaritimeGraphNode,
  type MaritimeNavigabilityQuery,
} from '../src/mapV2/geo/maritimeNavigability';
import { projectLonLatRing, type ProjectedPolygon } from '../src/mapV2/geo/geometry';

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

function query(land: ProjectedPolygon[], marine: ProjectedPolygon[] = []): MaritimeNavigabilityQuery {
  return { neLand: land, osmMarine: marine };
}

console.log('\n=== Map V2 Maritime Port Access Repair ===\n');

const coarseLand = query([landBox(27.0, 38.3, 27.3, 38.55)]);
assert(!isNavigableWater(27.15, 38.42, coarseLand), 'coarse NE land closes harbour');
const opened = query([landBox(27.0, 38.3, 27.3, 38.55)], [landBox(27.12, 38.4, 27.18, 38.46)]);
assert(isNavigableWater(27.15, 38.43, opened), 'OSM harbour polygon opens water through coarse land');

const peninsula = query([landBox(27.4, 38.3, 27.6, 38.5)]);
assert(
  segmentHitsLand({ longitude: 27.2, latitude: 38.4 }, { longitude: 27.8, latitude: 38.4 }, peninsula),
  'port behind peninsula stays blocked',
);
const bay = query([]);
assert(isNavigableWater(26.9, 38.4, bay) && !segmentHitsLand({ longitude: 26.88, latitude: 38.4 }, { longitude: 26.95, latitude: 38.42 }, bay), 'valid bay remains water');
const island = query([landBox(26.9, 38.2, 27.05, 38.32)]);
assert(
  segmentHitsLand({ longitude: 26.7, latitude: 38.26 }, { longitude: 27.2, latitude: 38.26 }, island),
  'island crossing rejected',
);

const harbour: MaritimeGraphNode = {
  nodeId: 'harbour',
  longitude: 27.15,
  latitude: 38.43,
  region: 'AEGEAN',
  channel: null,
  kind: 'LOCAL',
};
const trunk: MaritimeGraphNode = {
  nodeId: 'trunk',
  longitude: 26.7,
  latitude: 38.4,
  region: 'AEGEAN',
  channel: null,
  kind: 'COARSE',
};
const isolatedEdge: MaritimeGraphEdge[] = [];
assert(dijkstraMaritime([harbour, trunk], isolatedEdge, 'harbour', 'trunk') == null, 'harbour without trunk edge is unresolved');
const linked: MaritimeGraphEdge[] = [
  { edgeId: 'e', fromNodeId: 'harbour', toNodeId: 'trunk', lengthMeters: 40000, channel: null },
];
assert(dijkstraMaritime([harbour, trunk], linked, 'harbour', 'trunk') != null, 'valid local approach to trunk is provisional-capable');
assert(dijkstraMaritime([harbour], isolatedEdge, 'harbour', 'missing') == null, 'isolated harbour basin has no trunk');

const bos: MaritimeGraphNode[] = [
  { nodeId: 'black', longitude: 29.2, latitude: 41.5, region: 'BLACK_SEA', channel: null, kind: 'COARSE' },
  { nodeId: 'bos', longitude: 29.05, latitude: 41.12, region: 'MARMARA', channel: 'BOSPHORUS', kind: 'CHANNEL' },
  { nodeId: 'marm', longitude: 28.5, latitude: 40.7, region: 'MARMARA', channel: null, kind: 'COARSE' },
  { nodeId: 'dar', longitude: 26.4, latitude: 40.2, region: 'AEGEAN', channel: 'DARDANELLES', kind: 'CHANNEL' },
  { nodeId: 'aeg', longitude: 26.7, latitude: 38.4, region: 'AEGEAN', channel: null, kind: 'COARSE' },
];
const chain: MaritimeGraphEdge[] = [
  { edgeId: 'e1', fromNodeId: 'black', toNodeId: 'bos', lengthMeters: 40000, channel: null },
  { edgeId: 'e2', fromNodeId: 'bos', toNodeId: 'marm', lengthMeters: 30000, channel: 'BOSPHORUS' },
  { edgeId: 'e3', fromNodeId: 'marm', toNodeId: 'dar', lengthMeters: 180000, channel: null },
  { edgeId: 'e4', fromNodeId: 'dar', toNodeId: 'aeg', lengthMeters: 160000, channel: 'DARDANELLES' },
];
assert(dijkstraMaritime(bos, chain, 'black', 'marm')?.channels.includes('BOSPHORUS') === true, 'Black Sea → Marmara uses Bosphorus');
assert(dijkstraMaritime(bos, chain, 'marm', 'aeg')?.channels.includes('DARDANELLES') === true, 'Marmara → Aegean uses Dardanelles');
assert(dijkstraMaritime(bos, chain.filter((edge) => edge.channel !== 'BOSPHORUS'), 'black', 'marm') == null, 'no Marmara↔Black land shortcut');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!world.includes('turkey-sea-network'), 'player country does not load sea graph');
assert(!world.includes('turkey-ports'), 'player country does not load ports');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'Denizyolu Yakında');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('Port Approach QA'), 'inspector approach QA');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes("layer === 'APPROACH'"), 'DEV approach overlay');

const runtime = JSON.parse(read('src/mapV2/generated/transport/turkey-sea-runtime-manifest.json')) as SeaRuntimeManifestV1;
const ports = JSON.parse(read('src/mapV2/generated/infrastructure/turkey-ports.json')) as TurkeyPortPackageV1;
assert(runtime.stats.nodeCount >= 7205, 'graph did not shrink below prior trunk');
assert((runtime.stats.approachNodeCount ?? 0) > 0, 'approach nodes present');
assert(runtime.seaAccess.logisticsEvaluated === 97, '97 logistics ports evaluated');
assert(ports.ports.every((port) => port.verificationStatus !== 'VERIFIED'), 'no VERIFIED promotion');
const assoc = Object.fromEntries(ports.cityAssociations.map((row) => [row.gameplayCityId, row]));
assert(assoc.ankara?.associationType === 'NONE', 'Ankara remains no SEA port');
assert(assoc.diyarbakir?.associationType === 'NONE', 'Diyarbakır remains no SEA port');
assert(
  runtime.smokeTests.some((row) => row.id === 'istanbul-izmir' && row.ok && row.channels.includes('DARDANELLES')),
  'İstanbul↔İzmir smoke uses Dardanelles',
);
assert(
  runtime.smokeTests.some((row) => row.ok && row.requiredChannels.includes('BOSPHORUS')),
  'smoke still validates Bosphorus when endpoints exist',
);
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
