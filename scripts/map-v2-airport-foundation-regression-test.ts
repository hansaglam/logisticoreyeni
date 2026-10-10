/**
 * Map V2 Step 14 AIRPORT / AIR geographic foundation.
 * Run: npx tsx scripts/map-v2-airport-foundation-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA } from '../src/mapV2/domain';
import { classifyAirportTags } from '../src/mapV2/geo/airportClassPolicy';
import { associateCityToAirports } from '../src/mapV2/geo/airportCityAssociation';
import { validateTurkeyAirportPackage, assertNoPlayerWarehouseDependency } from '../src/mapV2/geo/validateGeoAirports';
import type { TurkeyAirportPackageV1 } from '../src/mapV2/geo/geoAirport';
import {
  clusterAirportCandidates,
  collectAirportCandidates,
  geoAirportIdForSourceIds,
  type OsmAirportFeature,
} from './map-v2/airport-ingest-core';

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

console.log('\n=== Map V2 Airport Foundation ===\n');

function feat(sourceId: string, tags: Record<string, unknown>, geometry: OsmAirportFeature['geometry']): OsmAirportFeature {
  const [kind, id] = sourceId.split('/');
  return {
    type: 'Feature',
    properties: { ...tags, '@type': kind, '@id': Number(id) },
    geometry,
  };
}

const point = (lon: number, lat: number): OsmAirportFeature['geometry'] => ({ type: 'Point', coordinates: [lon, lat] });
const poly = (lon: number, lat: number): OsmAirportFeature['geometry'] => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon - 0.01, lat - 0.01],
      [lon + 0.01, lat - 0.01],
      [lon + 0.01, lat + 0.01],
      [lon - 0.01, lat + 0.01],
      [lon - 0.01, lat - 0.01],
    ],
  ],
});
const line = (lon: number, lat: number): OsmAirportFeature['geometry'] => ({
  type: 'LineString',
  coordinates: [
    [lon - 0.008, lat],
    [lon + 0.008, lat],
  ],
});

const commercial = classifyAirportTags({ aeroway: 'aerodrome', iata: 'ADB', name: 'Adnan Menderes' });
assert(commercial.classification === 'COMMERCIAL_AIRPORT' && commercial.eligibility === 'PASSENGER_ONLY', 'commercial passenger-only');
assert(commercial.cargoCapability === 'UNKNOWN', 'no cargo evidence stays UNKNOWN');

const international = classifyAirportTags({ aeroway: 'aerodrome', 'aerodrome:type': 'international', iata: 'IST' });
assert(international.classification === 'INTERNATIONAL_AIRPORT', 'international from aerodrome:type');

const military = classifyAirportTags({ aeroway: 'aerodrome', military: 'airfield', name: 'Bandırma' });
assert(military.classification === 'MILITARY_AIRFIELD' && military.eligibility === 'MILITARY_RESTRICTED', 'military restricted');
assert(military.eligibility !== 'LOGISTICS_ELIGIBLE', 'military not logistics eligible');

const ga = classifyAirportTags({ aeroway: 'aerodrome', name: 'Small Field' });
assert(ga.classification === 'GENERAL_AVIATION' && ga.eligibility === 'NON_LOGISTICS', 'GA non-logistics');

const helipad = classifyAirportTags({ aeroway: 'helipad' });
assert(helipad.classification === 'HELIPORT' && !helipad.includeAsGeoAirport, 'helipad excluded from GeoAirport');

const closed = classifyAirportTags({ aeroway: 'aerodrome', disused: 'yes', iata: 'ISL' });
assert(closed.classification === 'CLOSED_OR_INACTIVE' && closed.eligibility === 'NON_LOGISTICS', 'closed not logistics');

const cargo = classifyAirportTags({ aeroway: 'aerodrome', cargo: 'yes', iata: 'XXX' });
assert(cargo.classification === 'CARGO_AIRPORT' && cargo.eligibility === 'LOGISTICS_ELIGIBLE', 'explicit cargo logistics');

const noIata = classifyAirportTags({ aeroway: 'aerodrome', icao: 'LTFJ', name: 'Sabiha' });
assert(noIata.classification === 'COMMERCIAL_AIRPORT', 'ICAO without IATA still commercial');

const clusterFeat: OsmAirportFeature[] = [
  feat('way/1', { aeroway: 'aerodrome', name: 'Test Airport', iata: 'TST', icao: 'LTTT' }, poly(28.8, 41.26)),
  feat('way/2', { aeroway: 'runway', ref: '18/36' }, line(28.8, 41.26)),
  feat('way/3', { aeroway: 'terminal', name: 'Terminal' }, poly(28.801, 41.261)),
];
const clustered = clusterAirportCandidates(collectAirportCandidates(clusterFeat));
assert(clustered.length === 1, 'aerodrome+runway+terminal → one airport');
assert(clustered[0].map((row) => row.sourceId).sort().join(',') === 'way/1,way/2,way/3', 'source IDs preserved');
assert(geoAirportIdForSourceIds(['way/2', 'way/1']) === geoAirportIdForSourceIds(['way/1', 'way/2']), 'deterministic id');

const independent: OsmAirportFeature[] = [
  feat('way/10', { aeroway: 'aerodrome', name: 'Istanbul Airport', iata: 'IST', icao: 'LTFM' }, poly(28.73, 41.26)),
  feat('way/11', { aeroway: 'aerodrome', name: 'Sabiha Gokcen', iata: 'SAW', icao: 'LTFJ' }, poly(29.31, 40.9)),
];
assert(clusterAirportCandidates(collectAirportCandidates(independent)).length === 2, 'IST and SAW remain separate');

const sameIcao: OsmAirportFeature[] = [
  feat('node/20', { aeroway: 'aerodrome', icao: 'LTAC', name: 'Esenboga' }, point(33.0, 40.12)),
  feat('way/21', { aeroway: 'aerodrome', icao: 'LTAC', name: 'Ankara Esenboğa' }, poly(33.01, 40.13)),
];
assert(clusterAirportCandidates(collectAirportCandidates(sameIcao)).length === 1, 'same ICAO clusters');

const twiceA = clusterAirportCandidates(collectAirportCandidates(clusterFeat)).map((g) => g.map((r) => r.sourceId).join('|'));
const twiceB = clusterAirportCandidates(collectAirportCandidates(clusterFeat)).map((g) => g.map((r) => r.sourceId).join('|'));
assert(JSON.stringify(twiceA) === JSON.stringify(twiceB), 'clustering deterministic');

const istanbul = { gameplayCityId: 'istanbul', geoCityId: 'city.tur.test.ist', longitude: 28.98, latitude: 41.01 };
const bursa = { gameplayCityId: 'bursa', geoCityId: 'city.tur.test.bursa', longitude: 29.06, latitude: 40.19 };
const ist = {
  airportId: 'infra.tur.airport.ist',
  eligibility: 'PASSENGER_ONLY' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 28.75, latitude: 41.26 },
  iataCode: 'IST',
};
const saw = {
  airportId: 'infra.tur.airport.saw',
  eligibility: 'PASSENGER_ONLY' as const,
  classification: 'INTERNATIONAL_AIRPORT' as const,
  position: { longitude: 29.31, latitude: 40.9 },
  iataCode: 'SAW',
};
const closeGa = {
  airportId: 'infra.tur.airport.ga',
  eligibility: 'NON_LOGISTICS' as const,
  classification: 'GENERAL_AVIATION' as const,
  position: { longitude: 28.98, latitude: 41.01 },
  iataCode: null,
};
const farCargo = {
  airportId: 'infra.tur.airport.cargo',
  eligibility: 'LOGISTICS_ELIGIBLE' as const,
  classification: 'CARGO_AIRPORT' as const,
  position: { longitude: 29.4, latitude: 40.95 },
  iataCode: 'XXX',
};

const multi = associateCityToAirports(istanbul, [ist, saw, closeGa]);
assert(multi.associationType === 'DIRECT', 'istanbul DIRECT');
assert(multi.airportIds.includes('infra.tur.airport.ist') && multi.airportIds.includes('infra.tur.airport.saw'), 'multiple airports');
assert(!multi.airportIds.includes('infra.tur.airport.ga'), 'GA not associated');

const primaryLogistics = associateCityToAirports(istanbul, [ist, farCargo]);
assert(primaryLogistics.primaryAirportCandidateId === 'infra.tur.airport.cargo', 'logistics eligibility beats nearer passenger-only');

const regional = associateCityToAirports(bursa, [
  {
    airportId: 'infra.tur.airport.yei',
    eligibility: 'PASSENGER_ONLY' as const,
    classification: 'DOMESTIC_AIRPORT' as const,
    position: { longitude: 29.56, latitude: 40.255 },
    iataCode: 'YEI',
  },
]);
assert(['DIRECT', 'REGIONAL'].includes(regional.associationType), 'bursa civilian association honest');

const pkgPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-airports.json');
assert(existsSync(pkgPath), 'turkey-airports.json exists');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as TurkeyAirportPackageV1;
const validation = validateTurkeyAirportPackage(pkg);
assert(validation.length === 0, `package validates ${validation.map((row) => row.code).join(',')}`);
assert(assertNoPlayerWarehouseDependency(pkg), 'no warehouseType on GeoAirports');
assert(pkg.mode === 'AIR' && pkg.countryId === 'country.tur', 'package identity');
assert(pkg.officialQaStatus === 'DHMİ_QA_ONLY', 'DHMİ QA only');
assert(pkg.turkeyAirportAuthoritySource === 'PENDING_VERIFICATION', 'authority pending');
assert(pkg.airports.every((row) => row.verificationStatus === 'PROVISIONAL'), 'all PROVISIONAL');
assert(pkg.airports.every((row) => row.sourceIds.length > 0), 'source IDs present');
assert(pkg.stats.logicalAirportCount === pkg.airports.length, 'logical count matches');
assert(pkg.stats.militaryRestrictedCount === pkg.airports.filter((row) => row.logisticsEligibility === 'MILITARY_RESTRICTED').length, 'military count');
assert(
  pkg.airports.every((row) => row.logisticsEligibility !== 'MILITARY_RESTRICTED' || row.cityAssociations.length === 0),
  'military not city-associated',
);
assert(statSync(pkgPath).size < 2_000_000, 'artifact compact');

const assoc = Object.fromEntries(pkg.cityAssociations.map((row) => [row.gameplayCityId, row]));
assert(Boolean(assoc.istanbul && assoc.izmir && assoc.ankara && assoc.bursa && assoc.antalya && assoc.adana && assoc.diyarbakir && assoc.trabzon), '8 cities present');
assert((assoc.istanbul?.airportIds.length ?? 0) > 1, 'istanbul multi-airport');
assert(['DIRECT', 'REGIONAL', 'NONE'].includes(assoc.bursa?.associationType ?? ''), 'bursa association recorded');
assert(assoc.ankara?.associationType !== 'UNRESOLVED', 'ankara resolved');
assert(assoc.diyarbakir?.associationType !== 'UNRESOLVED', 'diyarbakir resolved');

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!world.includes('countryAirportLoader'), 'player country dashboard does not import airport loader');
assert(!world.includes('turkey-airports'), 'player country dashboard does not load turkey-airports.json');
assert(!world.includes('devAirportLayer'), 'player country dashboard does not render airport markers');

const loader = read('src/mapV2/world/transportNetworkLoader.ts');
assert(!loader.includes('turkey-airports.json'), 'transport loader does not bundle airports');
const infra = JSON.parse(read('src/mapV2/generated/transport/turkey-infrastructure.json')) as { facilities: unknown[] };
assert(infra.facilities.length === 0, 'placeholder infrastructure remains empty');
const airNet = JSON.parse(read('src/mapV2/generated/transport/turkey-air-network.json')) as { edges: unknown[]; sourceStatus: string };
assert(airNet.edges.length === 0 && airNet.sourceStatus === 'SOURCE_PENDING', 'AIR graph still SOURCE_PENDING');

const legend = read('src/mapV2/screens/MapV2TransportLegend.tsx');
assert(legend.includes("key: 'AIR'") && legend.includes('active: false'), 'Havayolu legend inactive');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendAir: 'Havayolu'"), 'Havayolu copy');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendSoon: 'Yakında'"), 'Yakında copy remains');

assert(LIVE_WAREHOUSE_TYPE_IS_NOT_GEO_INFRA, 'warehouse type is not GeoInfra');
assert(read('src/types/game.ts').includes("| 'airport'"), 'player warehouse type airport still exists as gameplay storage');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('AIRPORT Haritasını Aç'), 'DEV airport map CTA');
assert(read('src/mapV2/screens/MapV2TransportInspectorScreen.tsx').includes('AIR / AIRPORT'), 'inspector AIR section');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_AIRPORT_AIR_FOUNDATION.md')), 'architecture doc');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(read('src/mapV2/geo/playerFacingRoadCorridor.ts').includes('country dashboard'), 'ROAD corridor module intact');
assert(read('src/mapV2/geo/playerFacingRailCorridor.ts').includes('PLAYER_RAIL_CORRIDOR_POLICY_VERSION'), 'RAIL corridor module intact');
assert(read('src/mapV2/geo/playerFacingSeaCorridor.ts').includes('PLAYER_SEA_CORRIDOR_POLICY_VERSION'), 'SEA corridor module intact');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
