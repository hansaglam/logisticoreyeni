/**
 * Map V2 Step 11 maritime navigability + PortSeaAccess.
 * Run: npx tsx scripts/map-v2-maritime-navigability-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TurkeyPortPackageV1 } from '../src/mapV2/geo/geoPort';
import type { SeaRuntimeManifestV1 } from '../src/mapV2/geo/maritimeRuntime';
import {
  PORT_SEA_ACCESS_SEARCH_RADII_METERS,
  classifyMaritimeRegion,
  dijkstraMaritime,
  isNavigableWater,
  nearestNode,
  resolvePortDisplayName,
  segmentHitsLand,
  type MaritimeGraphEdge,
  type MaritimeGraphNode,
  type MaritimeNavigabilityQuery,
} from '../src/mapV2/geo/maritimeNavigability';
import { projectLonLatRing, type ProjectedPolygon } from '../src/mapV2/geo/geometry';
import { getTransportNetwork } from '../src/mapV2/world/transportNetworkLoader';

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

function node(
  nodeId: string,
  longitude: number,
  latitude: number,
  extras: Partial<MaritimeGraphNode> = {},
): MaritimeGraphNode {
  return {
    nodeId,
    longitude,
    latitude,
    region: extras.region ?? null,
    channel: extras.channel ?? null,
    kind: extras.kind ?? 'COARSE',
  };
}

function edge(from: string, to: string, meters: number, channel: MaritimeGraphEdge['channel'] = null): MaritimeGraphEdge {
  return {
    edgeId: `e.${from}.${to}`,
    fromNodeId: from,
    toNodeId: to,
    lengthMeters: meters,
    channel,
  };
}

console.log('\n=== Map V2 Maritime Navigability ===\n');

const openWater = query([]);
assert(isNavigableWater(28.0, 40.7, openWater), 'empty land mask is water');
assert(!segmentHitsLand({ longitude: 28.0, latitude: 40.7 }, { longitude: 28.2, latitude: 40.7 }, openWater), 'open-water segment valid');

const peninsula = query([landBox(27.4, 38.3, 27.6, 38.5)]);
assert(isNavigableWater(27.2, 38.4, peninsula), 'west of peninsula is water');
assert(!isNavigableWater(27.5, 38.4, peninsula), 'peninsula interior is land');
assert(
  segmentHitsLand({ longitude: 27.2, latitude: 38.4 }, { longitude: 27.8, latitude: 38.4 }, peninsula),
  'segment across peninsula rejected',
);

const island = query([landBox(26.9, 38.2, 27.05, 38.32)]);
assert(
  segmentHitsLand({ longitude: 26.7, latitude: 38.26 }, { longitude: 27.2, latitude: 38.26 }, island),
  'segment through island rejected',
);
assert(
  !segmentHitsLand({ longitude: 26.7, latitude: 38.5 }, { longitude: 27.2, latitude: 38.5 }, island),
  'segment north of island stays water',
);

const banks = query([landBox(29.0, 41.0, 29.04, 41.2), landBox(29.12, 41.0, 29.18, 41.2)]);
assert(isNavigableWater(29.08, 41.1, banks), 'narrow channel water remains open');
assert(
  !segmentHitsLand({ longitude: 29.08, latitude: 41.02 }, { longitude: 29.08, latitude: 41.18 }, banks),
  'along-channel segment valid',
);
const closed = query([landBox(29.0, 41.0, 29.18, 41.2)]);
assert(segmentHitsLand({ longitude: 29.08, latitude: 41.02 }, { longitude: 29.08, latitude: 41.18 }, closed), 'blocked channel rejected');

const marineOverride = query([landBox(29.0, 41.0, 29.18, 41.2)], [landBox(29.06, 41.08, 29.1, 41.16)]);
assert(isNavigableWater(29.08, 41.12, marineOverride), 'OSM marine overlay opens strait through NE land');

const topologyNodes = [
  node('black', 29.2, 41.5, { region: 'BLACK_SEA' }),
  node('bos-n', 29.05, 41.22, { region: 'BLACK_SEA', channel: 'BOSPHORUS', kind: 'CHANNEL' }),
  node('bos-s', 29.05, 41.02, { region: 'MARMARA', channel: 'BOSPHORUS', kind: 'CHANNEL' }),
  node('marm', 28.5, 40.7, { region: 'MARMARA' }),
  node('dar-n', 26.5, 40.35, { region: 'MARMARA', channel: 'DARDANELLES', kind: 'CHANNEL' }),
  node('dar-s', 26.3, 40.05, { region: 'AEGEAN', channel: 'DARDANELLES', kind: 'CHANNEL' }),
  node('aeg', 26.7, 38.4, { region: 'AEGEAN' }),
];
const topologyEdges = [
  edge('black', 'bos-n', 40000),
  edge('bos-n', 'bos-s', 22000, 'BOSPHORUS'),
  edge('bos-s', 'marm', 50000),
  edge('marm', 'dar-n', 180000),
  edge('dar-n', 'dar-s', 35000, 'DARDANELLES'),
  edge('dar-s', 'aeg', 160000),
];
const blackMarmara = dijkstraMaritime(topologyNodes, topologyEdges, 'black', 'marm');
assert(Boolean(blackMarmara?.channels.includes('BOSPHORUS')), 'Black Sea → Marmara requires Bosphorus');
const marmaraAegean = dijkstraMaritime(topologyNodes, topologyEdges, 'marm', 'aeg');
assert(Boolean(marmaraAegean?.channels.includes('DARDANELLES')), 'Marmara → Aegean requires Dardanelles');
assert(dijkstraMaritime(topologyNodes, topologyEdges.filter((item) => item.channel !== 'BOSPHORUS'), 'black', 'marm') == null, 'no Black↔Marmara shortcut');
assert(dijkstraMaritime(topologyNodes, topologyEdges.filter((item) => item.channel !== 'DARDANELLES'), 'marm', 'aeg') == null, 'no Marmara↔Aegean shortcut');

assert(classifyMaritimeRegion(39.73, 41.005) === 'BLACK_SEA', 'Trabzon coast is BLACK_SEA');
assert(classifyMaritimeRegion(29.15, 40.43) === 'MARMARA', 'Gemlik/Mudanya coast is MARMARA');
assert(classifyMaritimeRegion(27.15, 38.45) === 'AEGEAN', 'Alsancak coast is AEGEAN');
assert(classifyMaritimeRegion(30.7, 36.88) === 'MEDITERRANEAN', 'Antalya coast is MEDITERRANEAN');
assert(classifyMaritimeRegion(34.64, 36.8) === 'MEDITERRANEAN', 'Mersin coast is MEDITERRANEAN');
assert(classifyMaritimeRegion(32.85, 39.93) == null, 'Ankara inland is not a maritime region');

const waterNodes = [
  node('near', 27.151, 38.452),
  node('far', 27.18, 38.48),
];
const coastal = { longitude: 27.15, latitude: 38.45 };
const first = nearestNode(coastal, waterNodes, 250);
const second = nearestNode(coastal, waterNodes, 250);
assert(first?.nodeId === 'near' && second?.nodeId === 'near', 'deterministic nearest access');
assert(nearestNode({ longitude: 32.85, latitude: 39.93 }, waterNodes, 5000) == null, 'inland candidate has no nearby water node');
assert(
  segmentHitsLand({ longitude: 27.5, latitude: 38.4 }, { longitude: 27.151, latitude: 38.452 }, peninsula),
  'port near water but land-crossing access rejected',
);
assert(PORT_SEA_ACCESS_SEARCH_RADII_METERS.join(',') === '250,500,1000,2000,5000', 'documented search radii');

const named = resolvePortDisplayName(['2. Liman', 'Alsancak Limanı']);
assert(named.displayName === 'Alsancak Limanı', 'weak numeric primary loses to named liman');
assert(resolvePortDisplayName(['2. Liman']).displayName === '2. Liman', 'numeric name kept if it is the only source');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!world.includes('turkey-sea-network'), 'player country dashboard does not load turkey-sea-network.json');
assert(!world.includes('turkey-ports'), 'player country dashboard does not load turkey-ports.json');
assert(!world.includes('getSeaRuntimeManifest'), 'player country dashboard does not load sea runtime');
assert(!world.includes('countryPortLoader'), 'player country dashboard does not import port loader');
assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes("require('../generated/transport/turkey-sea-network.json')"), 'canonical sea graph not Metro-bundled');
assert(getTransportNetwork('country.tur', 'SEA')?.nodes.length === 0, 'runtime SEA package has empty geometry for dashboard');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'SEA'") && read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'Denizyolu legend inactive');

const runtime = JSON.parse(read('src/mapV2/generated/transport/turkey-sea-runtime-manifest.json')) as SeaRuntimeManifestV1;
assert(runtime.mode === 'SEA' && runtime.channels.includes('BOSPHORUS') && runtime.channels.includes('DARDANELLES'), 'runtime channels present');
assert(runtime.stats.nodeCount > 1000 && runtime.stats.edgeCount > 1000, 'runtime graph counts populated');
assert(runtime.stats.bosphorusNodeCount >= 8 && runtime.stats.dardanellesNodeCount >= 8, 'strait nodes present');
assert(runtime.smokeTests.length >= 4, 'smoke tests recorded');
assert(
  runtime.smokeTests.some((row) => row.ok && row.channels.includes('BOSPHORUS')),
  'diagnostic Marmara↔Black Sea path uses Bosphorus',
);
assert(
  runtime.smokeTests
    .filter((row) => row.id === 'istanbul-trabzon' && row.ok)
    .every((row) => (row.meters ?? 0) > 200_000),
  'istanbul-trabzon does not use a Bosphorus-mouth stand-in',
);
assert(runtime.seaAccess.logisticsEvaluated > 0, 'logistics ports evaluated');
assert(runtime.sourceStatus === 'PROTOTYPE' && runtime.productionApproved === false, 'DEV prototype not production');

const ports = JSON.parse(read('src/mapV2/generated/infrastructure/turkey-ports.json')) as TurkeyPortPackageV1;
const logistics = ports.ports.filter((port) => port.logisticsEligibility === 'LOGISTICS_ELIGIBLE');
assert(logistics.length === runtime.seaAccess.logisticsEvaluated, 'evaluated count matches logistics-eligible');
assert(
  logistics.filter((port) => port.seaAccess.status === 'PROVISIONAL').length === runtime.seaAccess.resolved,
  'resolved count matches package',
);
assert(ports.ports.every((port) => port.verificationStatus !== 'VERIFIED'), 'no mass VERIFIED promotion');
assert(ports.officialQaStatus === 'OFFICIAL_PORT_QA_ONLY', 'official QA checkpoint unchanged');

const networkPath = resolve(root, 'src/mapV2/generated/transport/turkey-sea-network.json');
if (existsSync(networkPath)) {
  assert(statSync(networkPath).size > 10_000, 'canonical sea package is non-empty when present');
}

assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_MARITIME_NAVIGATION_FOUNDATION.md')), 'foundation doc');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('Graph policy:'), 'inspector graph status');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('Port Approach QA'), 'inspector approach QA');
assert(read('src/mapV2/world/MapV2GeographicCanvas.tsx').includes('maritimeEdges'), 'DEV maritime overlay');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
