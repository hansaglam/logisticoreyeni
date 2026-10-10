/**
 * Map V2 Step 16 player-facing AIR corridors.
 * Run: npx tsx scripts/map-v2-player-air-corridors-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'path';

import {
  AIR_ALLOW_PREVIEW_ONLY_ENDPOINTS,
  airCorridorIdForPair,
  EXPECTED_AIR_SOURCE_AIRPORT_HASH,
  PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS,
  PLAYER_AIR_READY_LEGACY_CITY_IDS,
  type PlayerFacingAirCorridorArtifactV1,
} from '../src/mapV2/geo/playerFacingAirCorridor';
import { interpolateGeodesic, sampleGeodesicPolyline } from '../src/mapV2/geo/geodesic';
import { projectWgs84ToNormalizedMercator } from '../src/mapV2/geo/webMercator';
import { airPlayerVisualMode } from '../src/mapV2/gameplay/airPlayerVisual';
import { resolveAirCorridorInteractionState } from '../src/mapV2/gameplay/countryAirCorridorInteraction';
import { getTurkeyPlayerAirCorridors } from '../src/mapV2/world/countryAirCorridorLoader';
import { geoCityIdForGameplayCity } from '../src/mapV2/world/countryCityLoader';
import type { TurkeyAirportPackageV1 } from '../src/mapV2/geo/geoAirport';

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

console.log('\n=== Map V2 Player AIR Corridors ===\n');

const same = { longitude: 32.5, latitude: 39.9 };
assert(sampleGeodesicPolyline(same, same).length === 1, 'same-point geodesic is a single vertex');
const shortFrom = { longitude: 32.5, latitude: 39.9 };
const shortTo = { longitude: 32.7, latitude: 40.0 };
const short = sampleGeodesicPolyline(shortFrom, shortTo);
assert(short.length >= 8 && short.length <= 32, 'short route uses bounded vertex count');
assert(short.every((p) => Number.isFinite(p.longitude) && Number.isFinite(p.latitude)), 'short route finite WGS84');
const ew = sampleGeodesicPolyline({ longitude: 27.0, latitude: 38.3 }, { longitude: 39.8, latitude: 38.7 });
assert(ew[1].longitude > ew[0].longitude && ew[ew.length - 1].longitude > ew[0].longitude, 'east-west intermediate longitude advances');
const ns = sampleGeodesicPolyline({ longitude: 32.8, latitude: 36.9 }, { longitude: 32.9, latitude: 41.3 });
assert(ns[Math.floor(ns.length / 2)].latitude > ns[0].latitude, 'north-south intermediate latitude between endpoints');
const mid = interpolateGeodesic({ longitude: 27, latitude: 38 }, { longitude: 32, latitude: 40 }, 0.5);
assert(mid.longitude > 27 && mid.longitude < 32 && mid.latitude > 38 && mid.latitude < 40, 'valid intermediate geodesic coordinate');
assert(
  JSON.stringify(sampleGeodesicPolyline(shortFrom, shortTo)) === JSON.stringify(sampleGeodesicPolyline(shortFrom, shortTo)),
  'geodesic sampling is deterministic',
);
assert(
  ew.every((p) => {
    const q = projectWgs84ToNormalizedMercator(p.longitude, p.latitude);
    return Number.isFinite(q.x) && Number.isFinite(q.y);
  }),
  'projected geodesic vertices are finite',
);

const artifact = getTurkeyPlayerAirCorridors();
const fileJson = JSON.parse(read('src/mapV2/generated/countryOverview/turkey-air-corridors.json')) as PlayerFacingAirCorridorArtifactV1;
assert(artifact.contentHash === fileJson.contentHash, 'loaded artifact hash matches file');
assert(artifact.mode === 'AIR', 'mode AIR');
assert(artifact.schemaVersion === 1, 'schema v1');
assert(artifact.allowPreviewOnlyEndpoints === false && AIR_ALLOW_PREVIEW_ONLY_ENDPOINTS === false, 'PREVIEW_ONLY endpoints disallowed');
assert(artifact.sourceAirportArtifactHash === EXPECTED_AIR_SOURCE_AIRPORT_HASH, 'source airport hash pinned');
assert(artifact.corridors.length >= 6 && artifact.corridors.length <= 8, '6–8 curated corridors');
assert(artifact.corridors.length === 7, 'accepted skeleton is 7');
assert(artifact.corridors.every((row) => row.status === 'VERIFIED_ENDPOINTS_PREVIEW'), 'verified endpoints preview only');
assert(!JSON.stringify(artifact).includes('REAL_FLIGHT_ROUTE'), 'does not claim real flight routes');
assert(!artifact.corridors.some((row) => PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS.includes(row.fromLegacyCityId as 'bursa')), 'no Bursa corridor from');
assert(!artifact.corridors.some((row) => row.toLegacyCityId === 'bursa'), 'no Bursa corridor to');
assert(
  PLAYER_AIR_READY_LEGACY_CITY_IDS.every((city) =>
    artifact.corridors.some((row) => row.fromLegacyCityId === city || row.toLegacyCityId === city),
  ),
  'all READY cities participate',
);

const byId = Object.fromEntries(artifact.corridors.map((row) => [row.id, row]));
assert(Boolean(byId[airCorridorIdForPair('istanbul', 'izmir')]), 'İstanbul↔İzmir');
assert(Boolean(byId[airCorridorIdForPair('istanbul', 'ankara')]), 'İstanbul↔Ankara');
assert(Boolean(byId[airCorridorIdForPair('istanbul', 'antalya')]), 'İstanbul↔Antalya');
assert(Boolean(byId[airCorridorIdForPair('istanbul', 'trabzon')]), 'İstanbul↔Trabzon');
assert(Boolean(byId[airCorridorIdForPair('ankara', 'diyarbakir')]), 'Ankara↔Diyarbakır');
assert(Boolean(byId[airCorridorIdForPair('ankara', 'adana')]), 'Ankara↔Adana');
assert(Boolean(byId[airCorridorIdForPair('izmir', 'antalya')]), 'İzmir↔Antalya');
assert(!byId[airCorridorIdForPair('adana', 'diyarbakir')], 'optional Adana↔Diyarbakır not auto-accepted');
assert(airCorridorIdForPair('istanbul', 'ankara') === 'corridor.tur.air.ankara.istanbul.v1', 'canonical city order in id');

assert(
  artifact.corridors
    .filter((row) => row.fromLegacyCityId === 'istanbul' || row.toLegacyCityId === 'istanbul')
    .every((row) => row.fromIata === 'IST' || row.toIata === 'IST'),
  'İstanbul endpoint is IST',
);
assert(
  !artifact.corridors.some((row) => row.fromIata === 'SAW' || row.toIata === 'SAW'),
  'SAW is not a logistics corridor endpoint',
);
assert(
  artifact.corridors
    .filter((row) => row.fromLegacyCityId === 'adana' || row.toLegacyCityId === 'adana')
    .every((row) => row.fromIata === 'COV' || row.toIata === 'COV'),
  'Adana endpoint is COV',
);
assert(!artifact.corridors.some((row) => row.fromIata === 'ADA' || row.toIata === 'ADA'), 'ADA is not used');

assert(
  artifact.corridors.every(
    (row) =>
      row.endpointReadinessFrom === 'READY' &&
      row.endpointReadinessTo === 'READY' &&
      row.endpointCargoCapabilityFrom === 'VERIFIED_SUPPORTED' &&
      row.endpointCargoCapabilityTo === 'VERIFIED_SUPPORTED',
  ),
  'cargo/readiness gate: READY + VERIFIED_SUPPORTED only',
);
assert(
  artifact.corridors.every((row) => row.sampleCount >= 8 && row.sampleCount <= 32 && row.q.length >= 4),
  'sampled projected geometry is compact',
);
assert(
  artifact.corridors.every((row) => row.geodesicDistanceMeters > 50_000 && row.geodesicDistanceMeters < 2_000_000),
  'diagnostic geodesic lengths are intercity Türkiye scale',
);

const bytes = statSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-air-corridors.json')).size;
assert(bytes < 50_000, `artifact ${bytes} bytes is under 50 KB`);
assert(existsSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-air-corridors.lineage.json')), 'lineage sidecar');
assert(existsSync(resolve(root, 'src/mapV2/generated/countryOverview/turkey-air-corridors.report.json')), 'corridor report');
const report = JSON.parse(read('src/mapV2/generated/countryOverview/turkey-air-corridors.report.json')) as {
  rows: Array<{ pair?: string; status: string; reason?: string }>;
};
assert(report.rows.some((row) => row.status === 'REJECTED' && row.pair === 'adana-diyarbakir'), 'optional pair reported rejected');

const airports = JSON.parse(read('src/mapV2/generated/infrastructure/turkey-airports.json')) as TurkeyAirportPackageV1;
assert(airports.contentHash === artifact.sourceAirportArtifactHash, 'artifact records airport source hash');
const assoc = Object.fromEntries(airports.cityAssociations.map((row) => [row.gameplayCityId, row]));
const airportById = new Map(airports.airports.map((row) => [row.id, row]));
assert(airportById.get(assoc.istanbul.primaryLogisticsAirportCandidateId ?? '')?.iataCode === 'IST', 'catalog logistics IST');
assert(airportById.get(assoc.adana.primaryLogisticsAirportCandidateId ?? '')?.iataCode === 'COV', 'catalog logistics COV');
assert(assoc.bursa.primaryLogisticsAirportCandidateId == null, 'catalog Bursa logistics null');

assert(airPlayerVisualMode() === 'AIR_PLAYER_VISUAL_OFF', 'preview flag default OFF');
const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('playerAirCorridorLayer'), 'country can attach air preview layer');
assert(world.includes('airVisualPreview'), 'preview gated by DEV state');
assert(!world.includes('turkey-airports'), 'dashboard does not load airport catalog');
assert(!world.includes('turkey-airport-cargo-qa'), 'dashboard does not load cargo QA');
assert(!world.includes('countryAirportLoader'), 'dashboard does not import airport loader');
assert(!world.includes('devAirportLayer'), 'no dashboard airport markers');
assert(!world.includes('interpolateGeodesic'), 'no runtime geodesic on WorldScreen');
const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvas.includes('getTurkeyPlayerAirCorridors'), 'canvas loads curated air artifact when enabled');
assert(!canvas.includes('turkey-airports.json'), 'canvas does not load airport catalog');
assert(canvas.includes('playerAirCorridorPaths'), 'AIR drawn after SEA, before cities');
assert(canvas.indexOf('playerAirCorridorPaths') > canvas.indexOf('playerSeaCorridorPaths'), 'AIR after SEA in source');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('airPreview'), 'AIR preview legend wiring');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes("key: 'AIR'"), 'AIR legend row exists');
assert(read('src/mapV2/screens/MapV2TransportLegend.tsx').includes('active: false'), 'AIR is not gameplay-active');
assert(read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes("legendPreview: 'Önizleme'"), 'Önizleme copy');
assert(!read('src/mapV2/world/countryAirCorridorLoader.ts').includes('sampleGeodesicPolyline'), 'loader does not generate geodesics');

const istanbulId = geoCityIdForGameplayCity('istanbul');
const bursaId = geoCityIdForGameplayCity('bursa');
const istSample = artifact.corridors.find((row) => row.fromLegacyCityId === 'istanbul' || row.toLegacyCityId === 'istanbul')!;
assert(resolveAirCorridorInteractionState({ corridor: istSample, selectedGeoCityId: null }) === 'AIR_DEFAULT', 'no selection → AIR_DEFAULT');
assert(
  resolveAirCorridorInteractionState({ corridor: istSample, selectedGeoCityId: istanbulId }) === 'AIR_CONNECTED_TO_SELECTED',
  'İstanbul selection strengthens IST-linked corridors',
);
assert(
  resolveAirCorridorInteractionState({ corridor: istSample, selectedGeoCityId: bursaId }) === 'AIR_DIMMED',
  'Bursa selection does not invent AIR relation',
);

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen untouched');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts untouched');
assert(!read('scripts/map-v2/build-turkey-road-corridors.ts').includes('buildTurkeyAirCorridors'), 'ROAD extraction not mixed');
assert(!read('scripts/map-v2/build-turkey-rail-corridors.ts').includes('buildTurkeyAirCorridors'), 'RAIL extraction not mixed');
assert(!read('scripts/map-v2/build-turkey-sea-corridors.ts').includes('buildTurkeyAirCorridors'), 'SEA extraction not mixed');
assert(JSON.parse(read('src/mapV2/generated/transport/turkey-air-network.json')).sourceStatus === 'SOURCE_PENDING', 'no fake AIR graph');
assert(existsSync(resolve(root, 'docs/architecture/map-v2/MAP_V2_PLAYER_AIR_CORRIDORS.md')), 'player AIR corridor doc');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
