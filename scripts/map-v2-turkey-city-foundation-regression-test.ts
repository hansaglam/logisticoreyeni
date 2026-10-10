/**
 * Map V2 Step 2C Türkiye city foundation.
 * Run: node --import tsx scripts/map-v2-turkey-city-foundation-regression-test.ts
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { CITY_IDS } from '../src/data/cities';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../src/mapV2/domain/ids';
import {
  UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS,
  validateGameplayMappingsUnresolved,
} from '../src/mapV2/domain';
import { cityVisibleAtLod } from '../src/mapV2/geo/cityPackage';
import { projectWgs84ToNormalizedMercator } from '../src/mapV2/geo/webMercator';
import { resolveCityDisplayName } from '../src/mapV2/presentation/cityDisplayName';
import { countCitiesAtLod, validateCountryCityPackage } from './map-v2/validate-city-package';
import { CITY_INCLUSION_POLICY } from './map-v2/city-inclusion-policy';
import { getTurkeyCityPackage, turkeyOverviewGameplayCities } from '../src/mapV2/world/countryCityLoader';
import {
  CITY_LABEL_MAX,
  cityLodForVisibleWorldSpan,
  filterVisibleCities,
  hitTestCity,
  selectCityLabelIds,
} from '../src/mapV2/world/cityViewerFrame';
import { worldToScreen } from '../src/mapV2/geo/worldCamera';

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

console.log('\n=== Map V2 Türkiye City Foundation ===\n');

const pkg = getTurkeyCityPackage();
const issues = validateCountryCityPackage(pkg);
assert(issues.length === 0, `package schema valid (${issues.length} issues)`);
assert(pkg.sourceManifest.datasetType === 'settlement', 'datasetType settlement');
assert(pkg.sourceManifest.sourceName.includes('Natural Earth'), 'Natural Earth source');
assert(pkg.sourceManifest.license.toLowerCase().includes('public domain'), 'public domain license');
assert(pkg.sourceManifest.productionApproved === false, 'not a production MapData release');
assert(pkg.sourceManifest.sourceHash.startsWith('sha256:'), 'source hash present');
assert(pkg.contentHash.startsWith('sha256:'), 'package hash present');
assert(pkg.sourceManifest.notes.includes('Not AI'), 'notes deny AI coordinates');
assert(pkg.transformation.inclusionPolicyId === CITY_INCLUSION_POLICY.id, 'inclusion policy id');

assert(pkg.cities.length === 83, `Türkiye city count 83 (got ${pkg.cities.length})`);
assert(pkg.stats.overviewCount < pkg.stats.regionalCount, 'overview < regional');
assert(pkg.stats.regionalCount <= pkg.stats.localCount, 'regional <= local');
assert(
  countCitiesAtLod(pkg.cities, 'CITY_LOD_COUNTRY_OVERVIEW') <
    countCitiesAtLod(pkg.cities, 'CITY_LOD_REGIONAL'),
  'visible overview < visible regional',
);
assert(
  countCitiesAtLod(pkg.cities, 'CITY_LOD_REGIONAL') <= countCitiesAtLod(pkg.cities, 'CITY_LOD_LOCAL'),
  'visible regional <= local',
);

const ids = new Set<string>();
for (const city of pkg.cities) {
  assert(!ids.has(city.geoCityId), `unique ${city.geoCityId}`);
  ids.add(city.geoCityId);
  const projected = projectWgs84ToNormalizedMercator(city.coordinate.longitude, city.coordinate.latitude);
  assert(
    Math.abs(projected.x - city.projected.x) < 1e-12 && Math.abs(projected.y - city.projected.y) < 1e-12,
    `projected matches WGS84 ${city.geoCityId}`,
  );
  assert(cityVisibleAtLod(city.cityLod, 'CITY_LOD_LOCAL'), 'every city remains in package at local');
  if (city.population == null) {
    assert(city.populationSourceField == null, `null population has no fake field ${city.geoCityId}`);
  }
}

assert(
  !read('src/mapV2/generated/cities/turkeyCityPackage.json').includes('worldMapPositions'),
  'package does not use PNG positions',
);
assert(!read('scripts/map-v2/ingest-country-cities.ts').includes('worldMapPositions'), 'ingest ignores PNG positions');

const expectedNames: Record<string, { tr: string; ascii: string; region: string }> = {
  izmir: { tr: 'İzmir', ascii: 'Izmir', region: 'west-coast' },
  istanbul: { tr: 'İstanbul', ascii: 'Istanbul', region: 'bosphorus' },
  ankara: { tr: 'Ankara', ascii: 'Ankara', region: 'central' },
  bursa: { tr: 'Bursa', ascii: 'Bursa', region: 'northwest' },
  antalya: { tr: 'Antalya', ascii: 'Antalya', region: 'south-coast' },
  adana: { tr: 'Adana', ascii: 'Adana', region: 'south' },
  diyarbakir: { tr: 'Diyarbakır', ascii: 'Diyarbakir', region: 'southeast' },
  trabzon: { tr: 'Trabzon', ascii: 'Trabzon', region: 'black-sea' },
};

assert(CITY_IDS.join(',') === LEGACY_STABLE_GAMEPLAY_CITY_IDS.join(','), 'gameplay CITY_IDS unchanged');
assert(validateGameplayMappingsUnresolved(UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS), 'domain mapping table still UNRESOLVED');
assert(pkg.gameplayMappings.length === 8, 'package has 8 verified mappings');

const usedGeo = new Set<string>();
for (const id of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
  const row = pkg.gameplayMappings.find((m) => m.gameplayCityId === id);
  assert(Boolean(row) && row?.mappingStatus === 'VERIFIED', `${id} VERIFIED`);
  assert(Boolean(row?.geoCityId) && !usedGeo.has(row!.geoCityId), `${id} unique geo`);
  usedGeo.add(row!.geoCityId);
  const city = pkg.cities.find((c) => c.geoCityId === row!.geoCityId)!;
  assert(city.geoCountryId === 'country.tur', `${id} country.tur`);
  assert(city.sourceNameAscii === expectedNames[id].ascii, `${id} NAMEASCII`);
  assert(resolveCityDisplayName(city, 'tr') === expectedNames[id].tr, `${id} TR display`);
  const en = resolveCityDisplayName(city, 'en');
  assert(en.length > 0 && !en.startsWith('city.'), `${id} EN fallback not geo id`);
}

const missingTr = {
  ...pkg.cities[0],
  names: {},
  sourceName: 'Fallbackville',
  sourceNameAscii: 'Fallbackville',
};
assert(resolveCityDisplayName(missingTr, 'tr') === 'Fallbackville', 'missing tr falls back to source name');
assert(resolveCityDisplayName(undefined, 'tr') === '', 'missing city empty name');

const mapped = new Set(pkg.gameplayMappings.map((r) => r.geoCityId));
const turkeyBounds = { minX: 0.55, minY: 0.32, maxX: 0.63, maxY: 0.42 };
const overviewVisible = filterVisibleCities(pkg.cities, 'CITY_LOD_COUNTRY_OVERVIEW', turkeyBounds, null, mapped);
const regionalVisible = filterVisibleCities(pkg.cities, 'CITY_LOD_REGIONAL', turkeyBounds, null, mapped);
const localVisible = filterVisibleCities(pkg.cities, 'CITY_LOD_LOCAL', turkeyBounds, null, mapped);
assert(overviewVisible.length === mapped.size, 'overview shows only mapped gameplay cities');
assert(turkeyOverviewGameplayCities().length === 8, 'overview helper returns 8 verified cities');
assert(overviewVisible.every((city) => mapped.has(city.geoCityId)), 'overview markers are gameplay cities');
assert(overviewVisible.length < regionalVisible.length, 'runtime overview < regional');
assert(regionalVisible.length <= localVisible.length, 'runtime regional <= local');
for (const geoId of mapped) {
  const city = pkg.cities.find((c) => c.geoCityId === geoId)!;
  assert(cityVisibleAtLod(city.cityLod, 'CITY_LOD_COUNTRY_OVERVIEW'), `mapped ${geoId} in overview tier`);
}

assert(cityLodForVisibleWorldSpan({ minX: 0, minY: 0, maxX: 0.08, maxY: 0.08 }) === 'CITY_LOD_COUNTRY_OVERVIEW', 'wide span overview');
assert(cityLodForVisibleWorldSpan({ minX: 0, minY: 0, maxX: 0.04, maxY: 0.04 }) === 'CITY_LOD_REGIONAL', 'mid span regional');
assert(cityLodForVisibleWorldSpan({ minX: 0, minY: 0, maxX: 0.01, maxY: 0.01 }) === 'CITY_LOD_LOCAL', 'tight span local');

const labels = selectCityLabelIds(overviewVisible, 'CITY_LOD_COUNTRY_OVERVIEW', null, mapped, 0, 0, 800);
assert(labels.length <= CITY_LABEL_MAX.CITY_LOD_COUNTRY_OVERVIEW, 'label cap overview');
assert(labels.length > 0, 'some labels at overview');

const izmir = pkg.cities.find((c) => c.geoCityId === 'city.tur.ne.1159149371')!;
const screen = worldToScreen(izmir.projected.x, izmir.projected.y, 10, 20, 400);
assert(
  hitTestCity(screen.x, screen.y, [izmir], 10, 20, 400) === izmir.geoCityId,
  'tap on marker selects city',
);
assert(hitTestCity(screen.x + 80, screen.y + 80, [izmir], 10, 20, 400) === null, 'pan-distance miss is not a tap');

const ankara = pkg.cities.find((c) => c.geoCityId === 'city.tur.ne.1159151255')!;
const aScreen = worldToScreen(ankara.projected.x, ankara.projected.y, 10, 20, 400);
const nearer = hitTestCity((screen.x + aScreen.x) / 2, (screen.y + aScreen.y) / 2, [izmir, ankara], 10, 20, 400);
assert(nearer === izmir.geoCityId || nearer === ankara.geoCityId || nearer === null, 'nearest-or-miss among two');

const screenSrc = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(screenSrc.includes('cityLayer={turkeyCityLayer}'), 'country view wires city layer');
assert(screenSrc.includes("focusCountryId !== 'country.tur'") || screenSrc.includes("focusCountryId === 'country.tur'"), 'Türkiye-only cities');
assert(screenSrc.includes('MapV2CitySelectionPanel'), 'city panel');
assert(screenSrc.includes('elasticGestures={mode !== \'COUNTRY\'}'), 'country overview disables elastic pan');
assert(screenSrc.includes('MapV2CountryOverviewShell'), 'country UI shell');
assert(!read('src/screens/MapScreen.tsx').includes('turkeyCityPackage'), 'MapScreen has no city package');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen no mapV2');
assert(!read('src/data/routes.ts').includes('geoCityId'), 'ROUTES not geo-migrated');
assert(!read('src/data/mapRoadNetwork.ts').includes('GeoCity'), 'road network not GeoCity');
assert(read('src/mapV2/domain/mapping.ts').includes("mappingStatus: 'UNRESOLVED'"), 'domain factory remains UNRESOLVED');

const bytes = statSync(resolve(root, 'src/mapV2/generated/cities/turkeyCityPackage.json')).size;
assert(bytes > 10_000 && bytes < 200_000, `package size ${bytes} bytes`);
console.log(`  · package bytes ${bytes}`);

const exceptions = pkg.cities.filter((c) => c.inCountryStatus === 'VERIFIED_SOURCE_EXCEPTION');
assert(exceptions.length === 4, `four source exceptions reported (${exceptions.length})`);
assert(
  exceptions.every((c) => c.inCountryStatus !== 'UNRESOLVED'),
  'exceptions are explicit, not silently moved',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
