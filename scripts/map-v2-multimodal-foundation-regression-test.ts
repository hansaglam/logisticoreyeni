/**
 * Map V2 Step 17 multimodal logistics domain foundation.
 * Run: npx tsx scripts/map-v2-multimodal-foundation-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  LIVE_DELIVERY_IS_NOT_MULTIMODAL_SHIPMENT,
  LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA,
  MODE_OPERATIONAL_READINESS,
  MULTIMODAL_MAX_TRANSPORT_LEGS,
  transferNodeIdForPair,
} from '../src/mapV2/domain';
import { cityHasCapability, cityModeRow } from '../src/mapV2/gameplay/multimodalFoundation';
import { enumerateMultimodalModeSequences } from '../src/mapV2/gameplay/multimodalPlanner';
import { roadOperationalNodeForLegacyCity } from '../src/mapV2/gameplay/legacyCityRoadNode';
import { getTurkeyMultimodalFoundation } from '../src/mapV2/world/multimodalFoundationLoader';

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

console.log('\n=== Map V2 Multimodal Logistics Foundation ===\n');

assert(LIVE_DELIVERY_IS_NOT_MULTIMODAL_SHIPMENT, 'live Delivery is not a multimodal shipment');
assert(LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA, 'player warehouse type is not GeoInfra');
assert(MODE_OPERATIONAL_READINESS.ROAD === 'ACTIVE', 'ROAD gameplay ACTIVE');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'RAIL foundation only');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'SEA foundation only');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AIR foundation only');
assert(MULTIMODAL_MAX_TRANSPORT_LEGS === 4, 'max 4 transport legs');
assert(roadOperationalNodeForLegacyCity('ankara') === 'planning.tur.road.ankara.v1', 'legacy city ROAD adapter');

const view = getTurkeyMultimodalFoundation();
assert(view.multimodalReadiness === 'READY_FOR_DOMAIN', 'domain readiness');
assert(view.transferNodes.every((node) => node.verificationStatus !== 'VERIFIED' || node.evidence.length > 0), 'evidence present');
assert(!view.transferNodes.some((node) => node.transferCapabilities.includes('RAIL_TO_SEA')), 'no auto RAIL↔SEA capability');
assert(!view.transferNodes.some((node) => node.transferCapabilities.includes('RAIL_TO_AIR')), 'no default RAIL↔AIR capability');
assert(
  view.planningGraph.edges.every((edge) => !edge.routeReference.includes('corridors.json')),
  'planning graph does not treat player corridors as truth',
);

const izmir = cityModeRow(view, 'izmir')!;
const istanbul = cityModeRow(view, 'istanbul')!;
const ankara = cityModeRow(view, 'ankara')!;
const bursa = cityModeRow(view, 'bursa')!;
const antalya = cityModeRow(view, 'antalya')!;
const adana = cityModeRow(view, 'adana')!;
const diyarbakir = cityModeRow(view, 'diyarbakir')!;
const trabzon = cityModeRow(view, 'trabzon')!;

assert(izmir.RAIL === 'PROVISIONAL' && izmir.SEA === 'PROVISIONAL' && izmir.AIR === 'PROVISIONAL', 'İzmir RAIL/SEA/AIR candidates');
assert(istanbul.RAIL === 'PROVISIONAL' && istanbul.SEA === 'PROVISIONAL' && istanbul.AIR === 'PROVISIONAL', 'İstanbul RAIL/SEA/AIR');
assert(ankara.RAIL === 'PROVISIONAL' && ankara.AIR === 'PROVISIONAL' && ankara.SEA === 'UNAVAILABLE', 'Ankara RAIL+AIR, no SEA');
assert(bursa.SEA === 'PROVISIONAL' && bursa.RAIL === 'UNAVAILABLE' && bursa.AIR === 'NOT_READY', 'Bursa SEA, no RAIL, AIR NOT_READY');
assert(antalya.SEA === 'PROVISIONAL' && antalya.AIR === 'PROVISIONAL' && antalya.RAIL === 'UNAVAILABLE', 'Antalya SEA+AIR, no RAIL');
assert(adana.RAIL === 'PROVISIONAL' && adana.SEA === 'PROVISIONAL' && adana.AIR === 'PROVISIONAL', 'Adana RAIL+SEA REGIONAL+AIR');
assert(diyarbakir.RAIL === 'PROVISIONAL' && diyarbakir.AIR === 'PROVISIONAL' && diyarbakir.SEA === 'UNAVAILABLE', 'Diyarbakır RAIL+AIR, no SEA');
assert(trabzon.SEA === 'PROVISIONAL' && trabzon.AIR === 'PROVISIONAL' && trabzon.RAIL === 'UNAVAILABLE', 'Trabzon SEA+AIR, no RAIL');

assert(cityHasCapability(view, 'izmir', 'ROAD_TO_RAIL'), 'İzmir ROAD↔RAIL');
assert(cityHasCapability(view, 'izmir', 'ROAD_TO_SEA'), 'İzmir ROAD↔SEA');
assert(cityHasCapability(view, 'izmir', 'ROAD_TO_AIR'), 'İzmir ROAD↔AIR');
assert(cityHasCapability(view, 'istanbul', 'ROAD_TO_RAIL') && cityHasCapability(view, 'istanbul', 'ROAD_TO_SEA') && cityHasCapability(view, 'istanbul', 'ROAD_TO_AIR'), 'İstanbul multi-mode transfers');
assert(cityHasCapability(view, 'ankara', 'ROAD_TO_RAIL') && cityHasCapability(view, 'ankara', 'ROAD_TO_AIR'), 'Ankara ROAD↔RAIL and ROAD↔AIR');
assert(!cityHasCapability(view, 'bursa', 'ROAD_TO_AIR'), 'Bursa ROAD→AIR unavailable');
assert(!cityHasCapability(view, 'antalya', 'ROAD_TO_RAIL'), 'Antalya ROAD→RAIL unavailable');
assert(!cityHasCapability(view, 'ankara', 'ROAD_TO_SEA'), 'Ankara ROAD→SEA unavailable');
assert(!cityHasCapability(view, 'bursa', 'ROAD_TO_RAIL'), 'Bursa ROAD→RAIL unavailable');
assert(!cityHasCapability(view, 'trabzon', 'ROAD_TO_RAIL'), 'Trabzon ROAD→RAIL unavailable');

const istAir = view.transferNodes.find((node) => node.id === transferNodeIdForPair('istanbul', 'road-air', 'ist'));
assert(Boolean(istAir), 'deterministic İstanbul ROAD-AIR IST id');
assert(istAir?.lineage.geoAirportId != null, 'İstanbul AIR transfer retains GeoAirport id');
assert(view.transferNodes.find((node) => node.gameplayCityId === 'izmir' && node.id === transferNodeIdForPair('izmir', 'road-rail')), 'deterministic İzmir ROAD-RAIL id');
assert(view.transferNodes.filter((node) => node.gameplayCityId === 'bursa' && node.supportedModes.includes('AIR')).length === 0, 'no Bursa AIR transfer node');

const ankaraIst = enumerateMultimodalModeSequences({
  foundation: view,
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
});
const seq = ankaraIst.map((row) => row.sequence);
assert(seq.includes('ROAD'), 'direct ROAD baseline');
assert(seq.includes('ROAD→RAIL→ROAD'), 'Ankara→İstanbul ROAD→RAIL→ROAD');
assert(seq.includes('ROAD→AIR→ROAD'), 'Ankara→İstanbul ROAD→AIR→ROAD');
assert(!seq.includes('ROAD→SEA→ROAD'), 'Ankara has no SEA hop');
assert(ankaraIst.every((row) => row.modes.length <= MULTIMODAL_MAX_TRANSPORT_LEGS), 'max depth respected');
assert(new Set(seq).size === seq.length, 'no duplicate sequences / no ranking extras');

const bursaIst = enumerateMultimodalModeSequences({
  foundation: view,
  originCityId: 'bursa',
  destinationCityId: 'istanbul',
}).map((row) => row.sequence);
assert(bursaIst.includes('ROAD'), 'Bursa still has ROAD');
assert(bursaIst.includes('ROAD→SEA→ROAD'), 'Bursa→İstanbul SEA hop');
assert(!bursaIst.includes('ROAD→AIR→ROAD'), 'Bursa ROAD→AIR not offered');
assert(!bursaIst.includes('ROAD→RAIL→ROAD'), 'Bursa ROAD→RAIL not offered');

const antalyaAnkara = enumerateMultimodalModeSequences({
  foundation: view,
  originCityId: 'antalya',
  destinationCityId: 'ankara',
}).map((row) => row.sequence);
assert(!antalyaAnkara.includes('ROAD→RAIL→ROAD'), 'Antalya cannot RAIL to Ankara');
assert(antalyaAnkara.includes('ROAD→AIR→ROAD'), 'Antalya→Ankara AIR hop');

const roadOnly = enumerateMultimodalModeSequences({
  foundation: view,
  originCityId: 'ankara',
  destinationCityId: 'istanbul',
  allowedModes: ['ROAD'],
});
assert(roadOnly.length === 1 && roadOnly[0].sequence === 'ROAD', 'ROAD-only filter is transfer-free');

const looping = enumerateMultimodalModeSequences({
  foundation: view,
  originCityId: 'izmir',
  destinationCityId: 'istanbul',
});
assert(!looping.some((row) => /RAIL.*RAIL/.test(row.sequence)), 'no ROAD→RAIL→ROAD→RAIL loop');
assert(!looping.some((row) => row.sequence.split('→').length > MULTIMODAL_MAX_TRANSPORT_LEGS), 'sequence token cap');

assert(!read('src/mapV2/screens/MapV2WorldScreen.tsx').includes('getTurkeyMultimodalFoundation'), 'country dashboard does not load multimodal graph');
assert(!read('src/mapV2/screens/MapV2CityDetailScreen.tsx').includes('TransferNode'), 'city detail has no transfer tab');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Multimodal Inspector'), 'DEV inspector entry');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'AIR'"), 'player legend unchanged pattern');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('src/storage/saveGame.ts').includes('MultimodalShipmentPlan'), 'no save schema field');
assert(!read('src/simulation/contracts.ts').includes('enumerateMultimodalModeSequences'), 'contract generation untouched');
assert(!read('scripts/map-v2/build-turkey-road-corridors.ts').includes('multimodal'), 'ROAD extraction untouched');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('multimodal'), 'RAIL extraction untouched');
assert(!read('scripts/map-v2/build-turkey-sea-corridors.ts').includes('multimodal'), 'SEA extraction untouched');
assert(!read('scripts/map-v2/build-turkey-air-corridors.ts').includes('multimodal'), 'AIR extraction untouched');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
