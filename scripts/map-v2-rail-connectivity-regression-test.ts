/**
 * Map V2 Step 8 RAIL connectivity audit.
 * Run: npx tsx scripts/map-v2-rail-connectivity-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildRailComponents,
  classifyNearBreak,
  findNearBreaks,
  neverAutoConnectSourceGap,
  stableComponentId,
} from '../src/mapV2/geo/railConnectivityAudit';
import { dequantizePolygons } from '../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../src/mapV2/world/countryCityLoader';
import { getCityTransportAccess } from '../src/mapV2/world/transportNetworkLoader';
import { projectLineString } from '../src/mapV2/geo/transportGeometry';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from '../src/mapV2/geo/transportNetwork';
import {
  inTurkeyRailScope,
  ingestOsmRailCollection,
  selectRailCityAccess,
  type OsmRailCollection,
} from './map-v2/rail-ingest-core';

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

function node(id: string, lon: number, lat: number, kind: GeoTransportNodeRecord['kind'] = 'RAIL_JUNCTION'): GeoTransportNodeRecord {
  return {
    nodeId: id,
    mode: 'RAIL',
    kind,
    geoCountryId: 'country.tur',
    coordinate: { longitude: lon, latitude: lat },
    projected: { x: 0.5, y: 0.4 },
    sourceMetadata: { associated: kind === 'RAIL_STATION', incidentLod: 'NETWORK_LOW' },
  };
}
function edge(id: string, from: string, to: string): GeoTransportEdgeRecord {
  return {
    edgeId: id,
    mode: 'RAIL',
    fromNodeId: from,
    toNodeId: to,
    geometry: projectLineString([
      { longitude: 32.8, latitude: 39.9 },
      { longitude: 32.81, latitude: 39.91 },
    ]),
    networkLod: 'NETWORK_LOW',
    attributes: { railway: 'rail', usage: 'main' },
    sourceMetadata: {},
  };
}

console.log('\n=== Map V2 RAIL Connectivity Regression ===\n');

assert(neverAutoConnectSourceGap() === true, 'source gaps are not auto-connected');
assert(stableComponentId('tn.a') === stableComponentId('tn.a'), 'component ids deterministic');
assert(stableComponentId('tn.a') !== stableComponentId('tn.b'), 'component ids distinct');

const turkey = getCountryRecord('country.tur')!;
const polygons = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
const bounds = turkey.lods.COUNTRY_HIGH.projectedBounds;
assert(inTurkeyRailScope({ longitude: 32.86, latitude: 39.93 }, polygons, bounds), 'Ankara in rail scope');
assert(!inTurkeyRailScope({ longitude: 2.3, latitude: 48.85 }, polygons, bounds), 'Paris out of rail scope');

const a = node('n1', 32.86, 39.93);
const b = node('n2', 32.8600001, 39.9300001);
const shared = buildRailComponents(
  [a, b],
  [edge('e1', 'n1', 'n2')],
);
assert(shared.records.length === 1, 'exact shared endpoint / connected edge is one component');

const p1 = node('p1', 32.86, 39.93);
const p2 = node('p2', 32.8600004, 39.9300004);
const precision = findNearBreaks([p1, p2], [], [25, 50, 100, 250, 500], 1);
assert(precision.length === 0 || precision[0].distanceMeters < 1, '1e-7-scale mismatch is a near-break candidate at most, not an auto-join');
assert(classifyNearBreak(0.05, false, false, true) === 'INGEST_SPLIT', 'tiny connected-source mismatch is INGEST_SPLIT');
assert(classifyNearBreak(80, false, false, false) === 'EXACT_SOURCE_DISCONNECT', 'true source gap class');
assert(classifyNearBreak(40, true, false, null) === 'FILTER_SPLIT', 'excluded bridge class');

const gapA = [node('g1', 32.0, 39.0), node('g2', 32.01, 39.01)];
const gapB = [node('g3', 35.0, 37.0), node('g4', 35.01, 37.01)];
const gapEdges = [edge('ge1', 'g1', 'g2'), edge('ge2', 'g3', 'g4')];
const gapComps = buildRailComponents([...gapA, ...gapB], gapEdges);
assert(gapComps.records.length === 2, 'true source gap stays two components');
assert(findNearBreaks([...gapA, ...gapB], gapEdges, [25, 50, 100, 250, 500], 1).length === 0, '10km+ gap is not a near-break');

const collection: OsmRailCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 1, railway: 'rail', usage: 'main' },
      geometry: { type: 'LineString', coordinates: [[32.86, 39.93], [32.87, 39.94]] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 2, railway: 'construction', usage: 'main' },
      geometry: { type: 'LineString', coordinates: [[32.87, 39.94], [32.9, 39.95]] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 3, railway: 'rail', usage: 'main' },
      geometry: { type: 'LineString', coordinates: [[32.9, 39.95], [32.91, 39.96]] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'node', '@id': 9, railway: 'station', name: 'Isolated' },
      geometry: { type: 'Point', coordinates: [33.5, 40.2] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'node', '@id': 10, railway: 'station', name: 'Near' },
      geometry: { type: 'Point', coordinates: [32.8602, 39.9302] },
    },
  ],
};
const pending = {
  policyVersion: 1 as const,
  datasetId: 'test',
  datasetType: 'rail-network' as const,
  sourceName: 't',
  sourceURL: 't',
  license: 'ODbL 1.0',
  licenseURL: 't',
  sourceVersion: 't',
  retrievedAt: 't',
  sourceHash: 'unresolved' as const,
  originalFormat: 'GeoJSON',
  processedFormat: 'GeoTransportNetworkPackageV1',
  processingVersion: 't',
  derivedFrom: [],
  attributionRequired: true,
  productionApproved: false as const,
  notes: 'fixture',
};
const cities = getTurkeyCityPackage().gameplayMappings.map((row) => getTurkeyCityPackage().cities.find((c) => c.geoCityId === row.geoCityId)!);
const ingested = ingestOsmRailCollection(collection, polygons, cities, pending, bounds);
assert(ingested.network.stats.componentCount >= 2, 'excluded construction does not bridge rail components');
assert(ingested.network.edges.every((e) => e.attributes.railway !== 'construction'), 'construction not ingested');
const nearStation = ingested.network.nodes.find((n) => n.sourceMetadata.stationName === 'Near');
const isoStation = ingested.network.nodes.find((n) => n.sourceMetadata.stationName === 'Isolated');
assert(nearStation?.sourceMetadata.associationStatus === 'ATTACHED_EXACT' || nearStation?.sourceMetadata.associationStatus === 'PROVISIONAL_NEAR_EDGE', 'near-track station classified');
assert(isoStation?.sourceMetadata.associationStatus === 'UNRESOLVED', 'isolated station stays UNRESOLVED');
assert(isoStation && ingested.network.edges.every((e) => e.fromNodeId !== isoStation.nodeId && e.toNodeId !== isoStation.nodeId), 'provisional/unresolved station does not add track');

const small = [
  node('s1', 29.07, 40.20, 'RAIL_JUNCTION'),
  node('s2', 29.08, 40.21, 'RAIL_JUNCTION'),
];
const giantNodes: GeoTransportNodeRecord[] = [];
for (let i = 0; i < 60; i += 1) {
  giantNodes.push({
    ...node(`big${i}`, 29.1 + i * 0.001, 40.27, i === 0 ? 'RAIL_STATION' : 'RAIL_JUNCTION'),
    sourceMetadata: { associated: i === 0, incidentLod: 'NETWORK_LOW', usage: 'main' },
  });
}
const bursa = cities.find((c) => getTurkeyCityPackage().gameplayMappings.some((m) => m.gameplayCityId === 'bursa' && m.geoCityId === c.geoCityId))!;
const snap = JSON.stringify(bursa);
const weak = selectRailCityAccess(bursa, small, [edge('se', 's1', 's2')]);
assert(weak.status === 'UNRESOLVED', 'tiny fragment is not forced city access');
assert(JSON.stringify(bursa) === snap, 'city access does not move GeoCity');
const giantEdges = giantNodes.slice(1).map((n, i) => edge(`be${i}`, giantNodes[i].nodeId, n.nodeId));
const better = selectRailCityAccess(bursa, [...small, ...giantNodes], [edge('se', 's1', 's2'), ...giantEdges]);
assert(better.status === 'PROVISIONAL' && better.accessNodeIds[0].startsWith('big'), 'wrong-component access prefers larger valid component');

const ankara = cities.find((c) => getTurkeyCityPackage().gameplayMappings.some((m) => m.gameplayCityId === 'ankara' && m.geoCityId === c.geoCityId))!;
const ankaraAccess = getCityTransportAccess(ankara.geoCityId, 'RAIL');
assert(ankaraAccess?.status === 'PROVISIONAL', 'Ankara remains PROVISIONAL');
assert(ankaraAccess?.status !== 'VERIFIED', 'no auto VERIFIED');
const antalya = cities.find((c) => getTurkeyCityPackage().gameplayMappings.some((m) => m.gameplayCityId === 'antalya' && m.geoCityId === c.geoCityId))!;
assert(getCityTransportAccess(antalya.geoCityId, 'RAIL')?.status === 'UNRESOLVED', 'Antalya stays UNRESOLVED');
const trabzon = cities.find((c) => getTurkeyCityPackage().gameplayMappings.some((m) => m.gameplayCityId === 'trabzon' && m.geoCityId === c.geoCityId))!;
assert(getCityTransportAccess(trabzon.geoCityId, 'RAIL')?.status === 'UNRESOLVED', 'Trabzon stays UNRESOLVED');
const bursaLive = cities.find((c) => getTurkeyCityPackage().gameplayMappings.some((m) => m.gameplayCityId === 'bursa' && m.geoCityId === c.geoCityId))!;
assert(getCityTransportAccess(bursaLive.geoCityId, 'RAIL')?.status === 'UNRESOLVED' || getCityTransportAccess(bursaLive.geoCityId, 'RAIL')?.status === 'PROVISIONAL', 'Bursa not VERIFIED');

assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'player rail still inactive');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('Connectivity QA'), 'DEV Connectivity QA panel');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
