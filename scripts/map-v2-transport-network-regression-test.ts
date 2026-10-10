/**
 * Map V2 Step 2D transport network foundation.
 * Run: npx tsx scripts/map-v2-transport-network-regression-test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA, MAP_V2_TRANSPORT_MODES } from '../src/mapV2/domain';
import type { GeoTransportNodeKind } from '../src/mapV2/domain';
import { proposeCityTransportAccess } from '../src/mapV2/geo/cityTransportAccess';
import { OSM_HIGHWAY_ALLOWED, OSM_HIGHWAY_EXCLUDED, isAllowedOsmHighway } from '../src/mapV2/geo/roadClassPolicy';
import { projectLineString } from '../src/mapV2/geo/transportGeometry';
import {
  TRANSPORT_NETWORK_SCHEMA_VERSION,
  edgeVisibleAtLod,
  type GeoTransportNetworkPackageV1,
  type GeoTransportNodeRecord,
} from '../src/mapV2/geo/transportNetwork';
import { measureConnectivity, validateTransportNetwork } from '../src/mapV2/geo/validateTransportNetwork';
import { paintForTransportStyle, styleClassFromAttributes, toRenderableEdge } from '../src/mapV2/presentation/transportPaint';
import { getTurkeyCityPackage } from '../src/mapV2/world/countryCityLoader';
import {
  getCityTransportAccess,
  getTransportNetwork,
  getTransportNode,
  getTurkeyTransportManifest,
  getVisibleTransportEdges,
} from '../src/mapV2/world/transportNetworkLoader';
import { hashCanonical, sealNetwork } from './map-v2/transport-package-factory';

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

function hashFile(rel: string): string {
  return createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
}

function schemaTestNetwork(overrides?: Partial<GeoTransportNetworkPackageV1>): GeoTransportNetworkPackageV1 {
  const a: GeoTransportNodeRecord = {
    nodeId: 'tn.tur.road.test.a',
    mode: 'ROAD',
    kind: 'ROAD_JUNCTION',
    geoCountryId: 'country.tur',
    coordinate: { longitude: 32.85, latitude: 39.92 },
    projected: { x: 0.59125, y: 0.3789 },
    sourceMetadata: { fixture: 'SCHEMA_TEST_NOT_GEOGRAPHY' },
  };
  const b: GeoTransportNodeRecord = {
    nodeId: 'tn.tur.road.test.b',
    mode: 'ROAD',
    kind: 'ROAD_JUNCTION',
    geoCountryId: 'country.tur',
    coordinate: { longitude: 32.86, latitude: 39.93 },
    projected: { x: 0.59128, y: 0.37886 },
    sourceMetadata: { fixture: 'SCHEMA_TEST_NOT_GEOGRAPHY' },
  };
  const geometry = projectLineString([a.coordinate!, b.coordinate!]);
  const nodes = [a, b];
  const edges = [
    {
      edgeId: 'te.tur.road.test.ab',
      mode: 'ROAD' as const,
      fromNodeId: a.nodeId,
      toNodeId: b.nodeId,
      geometry,
      networkLod: 'NETWORK_LOW' as const,
      attributes: { highway: 'motorway' },
      sourceMetadata: { fixture: 'SCHEMA_TEST_NOT_GEOGRAPHY' },
    },
  ];
  const metrics = measureConnectivity(nodes, edges);
  const base = {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: 'schema-test-not-geography',
    geoCountryId: 'country.tur',
    mode: 'ROAD' as const,
    sourceStatus: 'PROTOTYPE' as const,
    projection: getTransportNetwork('country.tur', 'ROAD')!.projection,
    sourceManifest: getTransportNetwork('country.tur', 'ROAD')!.sourceManifest,
    transformation: {
      ...getTransportNetwork('country.tur', 'ROAD')!.transformation,
      quantize: 100000,
    },
    nodes,
    edges,
    stats: { nodeCount: metrics.nodeCount, edgeCount: metrics.edgeCount, componentCount: metrics.componentCount },
    productionApproved: false as const,
  };
  return { ...sealNetwork({ ...base, ...overrides, nodes: overrides?.nodes ?? nodes, edges: overrides?.edges ?? edges }), ...overrides } as GeoTransportNetworkPackageV1;
}

console.log('\n=== Map V2 Transport Network Foundation ===\n');

assert(MAP_V2_TRANSPORT_MODES.join(',') === 'ROAD,RAIL,SEA,AIR', 'mode types');
const kinds: GeoTransportNodeKind[] = [
  'ROAD_JUNCTION',
  'CITY_ACCESS',
  'BORDER_CROSSING',
  'RAIL_JUNCTION',
  'RAIL_STATION',
  'RAIL_TERMINAL',
  'PORT',
  'SEA_WAYPOINT',
  'ANCHORAGE',
  'AIRPORT',
  'AIR_WAYPOINT',
  'INTERMODAL_HUB',
];
assert(kinds.length === 12, 'node kinds catalog');
assert(LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA, 'player warehouse is not geo infra');

const manifest = getTurkeyTransportManifest();
assert(manifest.layout === 'per-mode', 'per-mode package layout');
assert(manifest.gameplaySeparation.routesTs === 'gameplay-metadata-not-topology', 'routes.ts not topology');
assert(manifest.gameplaySeparation.mapRoadNetwork === 'legacy-png-aligned-not-geo', 'png roads not geo');

for (const mode of MAP_V2_TRANSPORT_MODES) {
  const network = getTransportNetwork('country.tur', mode);
  assert(!!network, `${mode} package loads`);
  if (mode === 'ROAD' && network?.sourceStatus === 'PROTOTYPE') {
    assert((network.stats.edgeCount ?? 0) > 0, 'ROAD prototype reports source edge count');
    assert(network.edges.length === 0, 'Metro ROAD runtime does not embed the monolithic edge array');
    assert(network.productionApproved === false, 'ROAD not production approved');
    continue;
  }
  if (mode === 'RAIL' && network?.sourceStatus === 'PROTOTYPE') {
    assert((network.stats.edgeCount ?? 0) > 0, 'RAIL prototype reports source edge count');
    assert(network.edges.length === 0, 'Metro RAIL runtime does not embed the monolithic edge array');
    assert(network.productionApproved === false, 'RAIL not production approved');
    continue;
  }
  if (mode === 'SEA' && network?.sourceStatus === 'PROTOTYPE') {
    assert((network.stats.edgeCount ?? 0) > 0, 'SEA prototype reports source edge count');
    assert(network.edges.length === 0, 'Metro SEA runtime does not embed the canonical graph');
    assert(network.productionApproved === false, 'SEA not production approved');
    continue;
  }
  assert(network?.sourceStatus === 'SOURCE_PENDING', `${mode} SOURCE_PENDING`);
  assert(network?.nodes.length === 0 && network?.edges.length === 0, `${mode} has no geometry`);
  assert(validateTransportNetwork(network!).length === 0, `${mode} empty package valid`);
  assert(network?.contentHash === hashCanonical((({ contentHash, ...rest }) => rest)(network!)), `${mode} hash deterministic`);
  assert(network?.productionApproved === false, `${mode} not production approved`);
}

assert(manifest.modes.find((m) => m.mode === 'ROAD')?.license.includes('ODbL'), 'ROAD ODbL recorded');
assert(manifest.modes.find((m) => m.mode === 'RAIL')?.qaAuthority.includes('TCDD'), 'RAIL TCDD QA');
assert(manifest.modes.find((m) => m.mode === 'SEA')?.status === 'PROTOTYPE', 'SEA prototype in manifest');
assert(manifest.modes.find((m) => m.mode === 'AIR')?.status === 'SOURCE_PENDING', 'AIR pending');

const valid = schemaTestNetwork();
assert(validateTransportNetwork(valid).length === 0, 'schema fixture validates (test-only, not shipped)');
assert(valid.nodes[0].nodeId !== valid.nodes[1].nodeId, 'node identity distinct');

const missing = schemaTestNetwork();
missing.edges = [{ ...missing.edges[0], fromNodeId: 'missing' }];
assert(validateTransportNetwork(missing).some((i) => i.code === 'missing-from'), 'missing endpoint rejected');

const dupNode = schemaTestNetwork();
dupNode.nodes = [...dupNode.nodes, dupNode.nodes[0]];
assert(validateTransportNetwork(dupNode).some((i) => i.code === 'duplicate-node'), 'duplicate node rejected');

const dupEdge = schemaTestNetwork();
dupEdge.edges = [...dupEdge.edges, dupEdge.edges[0]];
assert(validateTransportNetwork(dupEdge).some((i) => i.code === 'duplicate-edge'), 'duplicate edge rejected');

const nanEdge = schemaTestNetwork();
nanEdge.edges = [
  {
    ...nanEdge.edges[0],
    geometry: { wgs84: [{ longitude: Number.NaN, latitude: 0 }, { longitude: 1, latitude: 1 }], projectedQuantized: [1, 1, 2, 2] },
  },
];
assert(validateTransportNetwork(nanEdge).some((i) => i.code === 'edge-nan'), 'invalid coordinate rejected');

const loop = schemaTestNetwork();
loop.edges = [{ ...loop.edges[0], toNodeId: loop.edges[0].fromNodeId }];
assert(validateTransportNetwork(loop).some((i) => i.code === 'self-loop'), 'self-loop rejected');

const zero = schemaTestNetwork();
const same = projectLineString([
  { longitude: 32.85, latitude: 39.92 },
  { longitude: 32.85, latitude: 39.92 },
]);
zero.edges = [{ ...zero.edges[0], geometry: same }];
assert(validateTransportNetwork(zero).some((i) => i.code === 'zero-length'), 'zero-length rejected');

const jump = schemaTestNetwork();
jump.edges = [
  {
    ...jump.edges[0],
    geometry: { wgs84: jump.edges[0].geometry.wgs84, projectedQuantized: [10000, 40000, 80000, 40000] },
  },
];
assert(validateTransportNetwork(jump).some((i) => i.code === 'dateline-jump'), 'dateline jump rejected');

const foreign = schemaTestNetwork();
foreign.nodes = foreign.nodes.map((n, i) => (i === 0 ? { ...n, geoCountryId: 'country.deu' } : n));
assert(validateTransportNetwork(foreign).some((i) => i.code === 'cross-country-node'), 'cross-country node rejected');

assert(measureConnectivity(valid.nodes, valid.edges).componentCount === 1, 'valid adjacency / one component');
assert(measureConnectivity(valid.nodes, []).componentCount === 2, 'disconnected systems allowed');

assert(edgeVisibleAtLod('NETWORK_LOW', 'NETWORK_HIGH'), 'LOD low visible at high');
assert(!edgeVisibleAtLod('NETWORK_HIGH', 'NETWORK_LOW'), 'LOD high hidden at low');

const cityPkg = getTurkeyCityPackage();
const izmir = cityPkg.cities.find((c) => c.geoCityId === cityPkg.gameplayMappings.find((m) => m.gameplayCityId === 'izmir')?.geoCityId)!;
const snapshot = JSON.stringify(izmir);
const proposed = proposeCityTransportAccess(izmir, 'ROAD', valid.nodes);
assert(JSON.stringify(izmir) === snapshot, 'candidate mapping does not mutate GeoCity');
assert(proposed.candidates.length === 2, 'nearest helper proposes only');
const roadAccess = getCityTransportAccess(izmir.geoCityId, 'ROAD');
assert(roadAccess?.status !== 'VERIFIED', 'ROAD access never auto VERIFIED');
if (roadAccess?.status === 'PROVISIONAL') {
  assert((roadAccess.accessNodeIds.length ?? 0) >= 1, 'provisional ROAD access keeps candidate node ids only');
} else {
  assert((roadAccess?.accessNodeIds.length ?? 1) === 0, 'unresolved has no automatic fake snapping');
}

assert(getTransportNode('nope') === null, 'unknown node');
assert(getVisibleTransportEdges('country.tur', 'SEA', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 'NETWORK_HIGH').length === 0, 'pending mode draws nothing');

assert(isAllowedOsmHighway('motorway') && !isAllowedOsmHighway('footway'), 'road class policy');
assert(OSM_HIGHWAY_ALLOWED.includes('tertiary') && OSM_HIGHWAY_EXCLUDED.includes('residential'), 'corridor filter documented');

assert(styleClassFromAttributes('ROAD', { highway: 'primary' }) === 'ROAD_PRIMARY', 'style adapter hides OSM from renderer shape');
assert(paintForTransportStyle('RAIL_MAIN').dash.length > 0, 'rail visual language distinct');
assert(paintForTransportStyle('ROAD_MOTORWAY').dash.length === 0, 'road solid');
assert(toRenderableEdge('e', 'SEA', [], {}, 100000).styleClass === 'SEA_PENDING', 'sea pending style');

assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes('mapRoadNetwork'), 'no legacy PNG/mapRoadNetwork import');
assert(!read('src/mapV2/geo/transportNetwork.ts').includes("from '../../data/routes"), 'no routes.ts reinterpretation');
assert(!read('src/mapV2/geo/validateTransportNetwork.ts').includes('openai'), 'no AI transport geometry path');
assert(read('scripts/map-v2/ingest-turkey-roads.ts').includes('SOURCE_PENDING'), 'ingest fail-closed');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen no mapV2');
assert(hashFile('src/mapV2/generated/cities/turkeyCityPackage.json').length === 64, 'city package still present');
assert(read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('enterCountry'), 'world experience still present');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Transport Inspector'), 'DEV inspector entry');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('SOURCE_PENDING') || read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('row?.status'), 'inspector shows status');

assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts first pair unchanged');
assert(read('src/data/mapRoadNetwork.ts').includes('turkey-logistics-network-map.png'), 'legacy road network file intact');

assert(read('docs/architecture/map-v2/MAP_V2_TRANSPORT_NETWORK_ARCHITECTURE.md').includes('GeoTransportNetwork'), 'architecture doc');
assert(read('docs/architecture/map-v2/MAP_V2_TRANSPORT_SOURCE_STATUS.md').includes('SOURCE_PENDING'), 'source status doc');
assert(read('docs/architecture/MAP_DATA_SOURCE_POLICY_V1.md').includes('ODbL'), 'source policy still binding');

assert(read('src/mapV2/domain/transport.ts').includes('networkEdgeIds'), 'multimodal shipment hook');
assert(read('src/mapV2/generated/transport/turkey-infrastructure.json').includes('"facilities":[]'), 'no fake infra');
assert(!read('src/mapV2/world/transportNetworkLoader.ts').includes("require('../generated/transport/turkey-sea-network.json')"), 'canonical sea graph not Metro-required');
assert(getTransportNetwork('country.tur', 'SEA')?.nodes.length === 0, 'runtime SEA geometry stays empty for dashboard');
const air = JSON.parse(read('src/mapV2/generated/transport/turkey-air-network.json')) as GeoTransportNetworkPackageV1;
assert(air.edges.length === 0, 'confirmation no fake air geometry');
const monolithPath = resolve(__dirname, '../src/mapV2/generated/transport/turkey-road-network.json');
if (existsSync(monolithPath)) {
  const road = JSON.parse(readFileSync(monolithPath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (road.sourceStatus === 'PROTOTYPE') {
    assert(road.edges.length > 0 && road.nodes.length > 0, 'ROAD ingest artifact has real geometry');
    assert(validateTransportNetwork(road).length === 0, 'ingest ROAD package validates');
  }
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
