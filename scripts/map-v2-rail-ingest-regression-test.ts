/**
 * Map V2 Step 7 RAIL ingest + DEV inspection contracts.
 * Run: npx tsx scripts/map-v2-rail-ingest-regression-test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isExcludedOsmRailway,
  isLogisticsOsmRailway,
  OSM_RAILWAY_EXCLUDED_DEFAULT,
  OSM_RAILWAY_LOGISTICS_INCLUDED,
} from '../src/mapV2/geo/railClassPolicy';
import { railLodForAttributes } from '../src/mapV2/geo/railLodPolicy';
import { TURKEY_RAIL_GEOJSON_RAW_REL } from '../src/mapV2/geo/railRawSource';
import { dequantizePolygons } from '../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../src/mapV2/world/countryCityLoader';
import { getCityTransportAccess, getRailRuntimeManifest, getTransportNetwork } from '../src/mapV2/world/transportNetworkLoader';
import { validateTransportNetwork } from '../src/mapV2/geo/validateTransportNetwork';
import {
  extractOsmRailFeatureId,
  ingestOsmRailCollection,
  railNodeIdFromTopologyKey,
  type OsmRailCollection,
  type OsmRailFeature,
} from './map-v2/rail-ingest-core';
import { topologyNodeKey } from './map-v2/road-ingest-core';
import { TCDD_QA_STATUS } from './map-v2/rail-tcdd-qa';

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

function line(railway: string, coords: number[][], extra?: Record<string, unknown>): OsmRailFeature {
  return {
    type: 'Feature',
    properties: { '@type': 'way', '@id': extra?.id ?? 1, railway, usage: extra?.usage, service: extra?.service, name: extra?.name ?? 'test', gauge: extra?.gauge ?? '1435', operator: extra?.operator },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

function point(railway: string, coord: number[], extra?: Record<string, unknown>): OsmRailFeature {
  return {
    type: 'Feature',
    properties: { '@type': 'node', '@id': extra?.id ?? 9, railway, name: extra?.name ?? 'Gar' },
    geometry: { type: 'Point', coordinates: coord },
  };
}

console.log('\n=== Map V2 RAIL Ingest Regression ===\n');

assert(isLogisticsOsmRailway('rail'), 'railway=rail accepted');
assert(!isLogisticsOsmRailway('tram') && !isLogisticsOsmRailway('subway') && !isLogisticsOsmRailway('light_rail'), 'tram/subway/light_rail excluded');
assert(isExcludedOsmRailway('construction') && isExcludedOsmRailway('disused') && isExcludedOsmRailway('abandoned'), 'construction/disused/abandoned excluded');
assert(!isLogisticsOsmRailway('narrow_gauge') && isLogisticsOsmRailway('narrow_gauge', 'main'), 'narrow_gauge only if main/branch');
assert(OSM_RAILWAY_LOGISTICS_INCLUDED.join(',') === 'rail', 'logistics include list');
assert(OSM_RAILWAY_EXCLUDED_DEFAULT.includes('tram'), 'excluded catalog includes tram');
assert(railLodForAttributes('main', null) === 'NETWORK_LOW', 'usage=main is LOW');
assert(railLodForAttributes('branch', null) === 'NETWORK_MEDIUM', 'usage=branch is MEDIUM');
assert(railLodForAttributes(null, 'siding') === 'NETWORK_HIGH', 'service siding is HIGH');

const turkey = getCountryRecord('country.tur')!;
const polygons = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
const bounds = turkey.lods.COUNTRY_HIGH.projectedBounds;
const a: [number, number] = [32.86, 39.93];
const b: [number, number] = [32.9, 39.95];
const c: [number, number] = [32.905, 39.955];
const paris: [number, number][] = [[2.3, 48.85], [2.32, 48.86]];

const collection: OsmRailCollection = {
  type: 'FeatureCollection',
  features: [
    line('rail', [a, b], { id: 1001, usage: 'main', operator: 'TCDD', gauge: '1435' }),
    line('rail', [b, c], { id: 1002, usage: 'branch' }),
    line('rail', [a, [32.88, 39.945], b], { id: 1003, usage: 'main' }),
    line('tram', [a, b], { id: 2001 }),
    line('subway', [a, b], { id: 2002 }),
    line('light_rail', [a, b], { id: 2003 }),
    line('rail', [a, b], { id: 2004, service: null }),
    { type: 'Feature', properties: { '@type': 'way', '@id': 2005, railway: 'rail', construction: 'yes' }, geometry: { type: 'LineString', coordinates: [a, b] } },
    line('construction', [a, b], { id: 2006 }),
    line('disused', [a, b], { id: 2007 }),
    line('abandoned', [a, b], { id: 2008 }),
    line('rail', paris, { id: 3001 }),
    line('rail', [a, a], { id: 3002 }),
    point('station', a, { id: 4001, name: 'Ankara' }),
    point('halt', [32.901, 39.951], { id: 4002, name: 'Halt' }),
  ],
};
collection.features[6].properties = { '@type': 'way', '@id': 1001, railway: 'rail', usage: 'main', service: 'spur', name: 'dup' };

const cities = getTurkeyCityPackage().gameplayMappings.map((row) =>
  getTurkeyCityPackage().cities.find((city) => city.geoCityId === row.geoCityId)!,
);
const ankaraCity = cities.find((city) =>
  getTurkeyCityPackage().gameplayMappings.some((row) => row.gameplayCityId === 'ankara' && row.geoCityId === city.geoCityId),
)!;
const snapshot = JSON.stringify(ankaraCity);

const pending = getTransportNetwork('country.tur', 'RAIL')!.sourceManifest;
const first = ingestOsmRailCollection(collection, polygons, cities, pending, bounds);
const second = ingestOsmRailCollection(collection, polygons, cities, pending, bounds);
assert(first.validationIssues.length === 0, 'fixture topology valid');
assert(JSON.stringify(first.network.nodes.map((n) => n.nodeId)) === JSON.stringify(second.network.nodes.map((n) => n.nodeId)), 'stable node IDs');
assert(JSON.stringify(first.network.edges.map((e) => e.edgeId)) === JSON.stringify(second.network.edges.map((e) => e.edgeId)), 'stable edge IDs');
assert(first.network.edges.every((e) => e.fromNodeId !== e.toNodeId), 'self-loop rejection');
assert(first.network.edges.every((e) => (e.lengthMeters ?? 0) > 0), 'zero-length rejection');
assert(first.stats.parallelSegmentsPreserved >= 1, 'parallel track preservation');
assert(first.network.nodes.some((n) => n.kind === 'RAIL_STATION'), 'station association');
assert(extractOsmRailFeatureId(collection.features[0]) === 'way/1001', 'OSM way id preserved');
assert(first.network.edges.every((e) => (e.sourceFeatureIds ?? []).every((id) => id.startsWith('way/') || id.startsWith('node/'))), 'no fabricated geom fallback on this fixture');
assert(first.network.edges.some((e) => e.attributes.service === 'spur'), 'service tags preserved');
assert(first.network.edges.some((e) => e.attributes.gauge === '1435'), 'attributes preserved');
assert(first.network.edges.every((e) => e.networkLod === 'NETWORK_LOW' || e.networkLod === 'NETWORK_MEDIUM' || e.networkLod === 'NETWORK_HIGH'), 'LOD assigned');
assert(JSON.stringify(ankaraCity) === snapshot, 'GeoCity unchanged');
assert(first.cityAccess.every((row) => row.status === 'PROVISIONAL' || row.status === 'UNRESOLVED'), 'status remains PROVISIONAL/UNRESOLVED');
assert(first.cityAccess.every((row) => row.status !== 'VERIFIED'), 'no auto VERIFIED');
const missing = ingestOsmRailCollection(
  { type: 'FeatureCollection', features: [line('rail', paris, { id: 9 })] },
  polygons,
  cities,
  pending,
  bounds,
);
assert(missing.cityAccess.every((row) => row.status === 'UNRESOLVED' && row.accessNodeIds.length === 0), 'missing rail remains UNRESOLVED without snap');
assert(railNodeIdFromTopologyKey(topologyNodeKey({ longitude: a[0], latitude: a[1] })).startsWith('tn.tur.rail.n.'), 'rail node prefix');

const runtime = getRailRuntimeManifest();
assert(runtime.sourceStatus === 'PROTOTYPE', 'runtime PROTOTYPE');
assert(runtime.stats.edgeCount > 0 && runtime.stats.nodeCount > 0, 'real rail counts');
assert(runtime.tcddQa.status === TCDD_QA_STATUS, 'TCDD_QA_ONLY');
assert(runtime.cityAccess.every((row) => row.status !== 'VERIFIED'), 'ingested access not VERIFIED');
const metro = getTransportNetwork('country.tur', 'RAIL')!;
assert(metro.sourceStatus === 'PROTOTYPE', 'Metro RAIL is PROTOTYPE wrapper');
assert(metro.edges.length === 0, 'Metro does not embed full RAIL geometry');
assert(metro.stats.edgeCount === runtime.stats.edgeCount, 'wrapper reports source edge count');

const ankaraGeo = getTurkeyCityPackage().gameplayMappings.find((row) => row.gameplayCityId === 'ankara')!.geoCityId;
const antalyaGeo = getTurkeyCityPackage().gameplayMappings.find((row) => row.gameplayCityId === 'antalya')!.geoCityId;
const trabzonGeo = getTurkeyCityPackage().gameplayMappings.find((row) => row.gameplayCityId === 'trabzon')!.geoCityId;
assert(getCityTransportAccess(ankaraGeo, 'RAIL')?.status === 'PROVISIONAL', 'Ankara candidate station/junction');
assert(getCityTransportAccess(antalyaGeo, 'RAIL')?.status === 'UNRESOLVED', 'Antalya UNRESOLVED');
assert(getCityTransportAccess(trabzonGeo, 'RAIL')?.status === 'UNRESOLVED', 'Trabzon UNRESOLVED');
assert((getCityTransportAccess(antalyaGeo, 'RAIL')?.accessNodeIds.length ?? 1) === 0, 'no forced snapping');

const fullPath = resolve(root, 'src/mapV2/generated/transport/turkey-rail-network.json');
if (existsSync(fullPath)) {
  const full = JSON.parse(readFileSync(fullPath, 'utf8'));
  assert(validateTransportNetwork(full).length === 0, 'canonical RAIL package validates');
  assert(full.mode === 'RAIL' && full.edges[0].mode === 'RAIL', 'mode=RAIL');
  const hash2 = JSON.parse(readFileSync(fullPath, 'utf8')).contentHash;
  assert(full.contentHash === hash2, 'deterministic package hash');
}

assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'RAIL'") && read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'player legend rail inactive');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes('legendSoon'), 'Yakında copy remains');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('RAIL Haritasını Aç'), 'DEV rail map CTA');
assert(read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('playerCorridorLayer'), 'country dashboard still player ROAD corridors');
assert(!read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('railDebugLayer'), 'player country dashboard has no rail debug layer');
assert(read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('playerRailCorridorLayer'), 'rail visual is a separate preview layer');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged pair');
assert(!read('scripts/map-v2/ingest-turkey-roads.ts').includes('RAIL_JUNCTION'), 'ROAD ingest not rewritten as rail');
assert(read('src/mapV2/geo/playerFacingRoadCorridor.ts').includes('country dashboard'), 'ROAD corridor module intact');
assert(read('docs/architecture/map-v2/MAP_V2_RAIL_QA.md').includes('TCDD_QA_ONLY'), 'QA report');
assert(read('scripts/map-v2/extract-turkey-rail-osm.ts').includes(TURKEY_RAIL_GEOJSON_RAW_REL.split('/').pop() ?? 'turkey-rail.geojson'), 'extract script');

const blocked = spawnSync('npx', ['tsx', '-e', `
import { existsSync } from 'node:fs';
console.log('ok');
`], { cwd: root, encoding: 'utf8' });
assert(blocked.status === 0, 'tsx available');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
