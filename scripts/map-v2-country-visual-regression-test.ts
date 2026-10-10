/**
 * Map V2 Türkiye country operations dashboard visual contracts.
 * Run: npx tsx scripts/map-v2-country-visual-regression-test.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../src/mapV2/domain/ids';
import { EXPECTED_ROAD_SOURCE_PACKAGE_HASH, playerFacingCorridorsAreReady } from '../src/mapV2/geo/playerFacingRoadCorridor';
import { getTurkeyPlayerRoadCorridors } from '../src/mapV2/world/countryRoadCorridorLoader';
import { resolveCountryDisplayName } from '../src/mapV2/presentation/countryDisplayName';
import { mapV2ExperienceCopy } from '../src/mapV2/presentation/mapV2ExperienceCopy';
import {
  CITY_DASHBOARD_LABEL_OFFSETS,
  CITY_MARKER_CAPITAL_RADIUS_PX,
  CITY_MARKER_DASHBOARD_RADIUS_PX,
  CITY_NODE_CAPITAL,
  CITY_NODE_DEFAULT,
  CITY_NODE_SELECTED,
  cityDashboardLabelNeedsConnector,
  cityDashboardLabelOffset,
} from '../src/mapV2/presentation/cityPaint';
import { getTurkeyCityPackage, mappedGeoCityIds, turkeyOverviewGameplayCities } from '../src/mapV2/world/countryCityLoader';
import { cityLabelPriority } from '../src/mapV2/world/cityViewerFrame';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';

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

console.log('\n=== Map V2 Country Visual Regression ===\n');

const overview = turkeyOverviewGameplayCities();
const mapped = mappedGeoCityIds();
assert(overview.length === 8, 'overview has 8 gameplay cities');
assert(mapped.length === 8, 'mapped geo ids are 8');
assert(
  overview.every((city) => mapped.includes(city.geoCityId)),
  'overview cities use verified GeoCity IDs',
);
for (const gameplayId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
  const row = getTurkeyCityPackage().gameplayMappings.find((item) => item.gameplayCityId === gameplayId);
  assert(Boolean(row) && overview.some((city) => city.geoCityId === row!.geoCityId), `${gameplayId} present via verified mapping`);
}

const world = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(world.includes('turkeyOverviewGameplayCities'), 'world experience overview city helper');
assert(world.includes('cities: overviewCities'), 'country layer is the 8-city overview set');
assert(!world.includes('worldMapPositions'), 'no legacy PNG coordinates');
assert(!world.includes('getRoadRuntimeManifest'), 'country screen does not load ROAD runtime on mount');
assert(!world.includes('requestRoadChunkLoads'), 'country screen does not queue ROAD chunks');
assert(!world.includes('roadLayer='), 'no ROAD layer prop on player country');
assert(world.includes('mapGesturesEnabled={mode !== \'COUNTRY\'}'), 'overview camera is framed');
assert(world.includes('COUNTRY_OVERVIEW_MAX_SCALE_FACTOR'), 'overview zoom cap');
assert(world.includes('MapV2CountryModeTabs'), 'country tabs');
assert(world.includes('MapV2CountryHeader'), 'country header');
assert(world.includes('canvasWrapCountry'), 'country map uses a distinct hero frame');
assert(world.includes('flex: 1.45'), 'map wrap flex dominates country content');
assert(world.includes('compactPhone'), 'narrow-phone padding path');
assert(world.includes('useTabBarLayout'), 'tab bar safe padding');
assert(world.includes('compactOps'), 'selected city card is compact ops, not GIS');
assert(world.includes("showDevFields={false}"), 'player country hides city debug fields');
assert(!world.includes('roadLayer='), 'no ROAD layer prop on player country');

const header = read('src/mapV2/screens/MapV2CountryHeader.tsx');
assert(header.includes('countryIdentityLine') || header.includes('identityLine'), 'compact identity row');
assert(!header.includes('StatusBadge'), 'header is not badge-heavy');
assert(!header.includes('sha256') && !header.includes('LOD'), 'no debug chrome in header');

const tabs = read('src/mapV2/screens/MapV2CountryModeTabs.tsx');
assert(tabs.includes('underlineOn'), 'selected tab underline');
assert(tabs.includes("tabMap") && tabs.includes("tabTrade"), 'four country tabs preserved');

const shell = read('src/mapV2/screens/MapV2CountryOverviewShell.tsx');
assert(shell.includes('ctaViewCities'), 'primary city CTA');
assert(shell.includes('ctaCountryDetails'), 'secondary details CTA');
assert(shell.includes('ctaExpandNetwork') && shell.includes('disabled'), 'expansion stays disabled');
assert(!shell.includes('ctaViewContracts'), 'contracts CTA omitted until a safe destination exists');
assert(shell.includes('tabContracts'), 'sözleşmeler metric uses safe placeholder');
assert(shell.includes('statJobsPlaceholder'), 'contracts value is Yakında');
assert(shell.includes('openCityCount'), 'city count uses derived open/total, not a fake economy score');
assert(shell.includes('cityNetwork'), 'şehir ağı progression bar');
assert(!shell.toLowerCase().includes('sha256'), 'summary has no package hashes');

const legend = read('src/mapV2/screens/MapV2TransportLegend.tsx');
assert(legend.includes('legendSoon'), 'future modes inactive copy');
assert(legend.includes("key: 'RAIL'"), 'rail legend present');
assert(legend.includes('active: false'), 'inactive future modes');
assert(!legend.toLowerCase().includes('airport'), 'no inferred airport');
assert(!legend.includes('liman'), 'no inferred port');

const canvas = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
assert(canvas.includes('countryHero'), 'country dashboard uses hero clip, not world oval');
assert(canvas.includes('COUNTRY_DASHBOARD_INNER'), 'coast inner edge');
assert(canvas.includes('cityDashboardLabelOffset'), 'screen-space label offsets only');
assert(!canvas.includes('<Blur'), 'no blur shader on geographic canvas');
assert(canvas.includes('getCountryPath'), 'country path still comes from the path cache');
assert(canvas.includes('CITY_NODE_DEFAULT'), 'dashboard uses centralized default node token');
assert(canvas.includes('CITY_NODE_CAPITAL'), 'dashboard uses centralized capital token');
assert(canvas.includes('CITY_NODE_SELECTED'), 'dashboard uses centralized selected token');
assert(canvas.includes('countryDashboardRidgeBands'), 'eastern decorative ridges are paint-only');
assert(!canvas.includes('admin'), 'no administrative overlay language in canvas');
assert((read('src/mapV2/presentation/countryDashboardPaint.ts').match(/color: COUNTRY_DASHBOARD_TINT/g) ?? []).length === 4, 'decorative tint count is 4');
assert(CITY_MARKER_DASHBOARD_RADIUS_PX === CITY_NODE_DEFAULT.hubRadius, 'default dashboard node radius token');
assert(CITY_MARKER_CAPITAL_RADIUS_PX === CITY_NODE_CAPITAL.hubRadius, 'capital radius token');
assert(CITY_NODE_CAPITAL.hubRadius > CITY_NODE_DEFAULT.hubRadius, 'capital hub is slightly larger');
assert(CITY_NODE_CAPITAL.hubRadius / CITY_NODE_DEFAULT.hubRadius <= 1.2, 'capital is at most 20% larger');
assert(CITY_NODE_CAPITAL.goldRing !== CITY_NODE_SELECTED.ring, 'capital gold is distinct from selection ring');

const istanbul = overview.find((city) => city.sourceNameAscii === 'Istanbul')!;
const ankara = overview.find((city) => city.settlementClass === 'CAPITAL')!;
const izmir = overview.find((city) => city.sourceNameAscii === 'Izmir')!;
const trabzon = overview.find((city) => city.sourceNameAscii === 'Trabzon')!;
const mappedSet = new Set(mapped);
assert(cityLabelPriority(ankara, mappedSet, istanbul.geoCityId) < cityLabelPriority(istanbul, mappedSet, istanbul.geoCityId), 'selected label outranks capital');
assert(cityLabelPriority(ankara, mappedSet) > cityLabelPriority(overview.find((c) => c.sourceNameAscii === 'Trabzon')!, mappedSet), 'Ankara outranks smaller cities');
assert(cityLabelPriority(istanbul, mappedSet) > cityLabelPriority(overview.find((c) => c.sourceNameAscii === 'Trabzon')!, mappedSet), 'İstanbul outranks smaller cities');
assert(overview.every((city) => Boolean(CITY_DASHBOARD_LABEL_OFFSETS[city.sourceNameAscii])), 'all 8 cities have deterministic label offsets');
assert(cityDashboardLabelOffset(istanbul).x > 0, 'İstanbul label sits inland, not off the west frame');
assert(cityDashboardLabelOffset(izmir).x > 0, 'İzmir label sits inland');
assert(cityDashboardLabelNeedsConnector(cityDashboardLabelOffset(trabzon)), 'Trabzon uses a connector because the offset is long');
assert(!cityDashboardLabelNeedsConnector(cityDashboardLabelOffset(ankara)), 'Ankara has no connector');
const beforeX = istanbul.projected.x;
const beforeY = istanbul.projected.y;
cityDashboardLabelOffset(istanbul);
assert(istanbul.projected.x === beforeX && istanbul.projected.y === beforeY, 'label offset does not mutate GeoCity coordinates');
assert(overview.every((city) => {
  const pkgCity = getTurkeyCityPackage().cities.find((row) => row.geoCityId === city.geoCityId)!;
  return city.projected.x === pkgCity.projected.x && city.projected.y === pkgCity.projected.y;
}), 'all 8 node positions derive from verified GeoCity projected coordinates');

const tur = getCountryRecord('country.tur')!;
assert(resolveCountryDisplayName(tur, 'tr') === 'Türkiye', 'country title localization Türkiye');
assert(mapV2ExperienceCopy.countryOpsBody.includes('başlangıç'), 'ops copy localization-ready');
assert(mapV2ExperienceCopy.tabMap.length > 0 && mapV2ExperienceCopy.tabTrade.length > 0, 'tab copy exists');

const corridors = getTurkeyPlayerRoadCorridors();
assert(corridors.corridors.length === 10, '10 source-backed player corridors');
assert(corridors.sourceRoadPackageHash === EXPECTED_ROAD_SOURCE_PACKAGE_HASH, 'corridor source hash matches canonical ROAD');
assert(
  playerFacingCorridorsAreReady({
    schemaVersion: 1,
    geoCountryId: 'country.tur',
    mode: 'ROAD',
    sourceRoadPackageHash: corridors.sourceRoadPackageHash,
    corridors: corridors.corridors.map((row) => ({
      id: row.id,
      fromLegacyCityId: row.fromLegacyCityId,
      toLegacyCityId: row.toLegacyCityId,
      fromGeoCityId: row.fromGeoCityId,
      toGeoCityId: row.toGeoCityId,
      fromAccessNodeId: row.fromAccessNodeId,
      toAccessNodeId: row.toAccessNodeId,
      sourceEdgeIds: [],
      projectedPolyline: row.q,
      sourceRouteLengthMeters: row.sourceRouteLengthMeters,
      displayPriority: row.displayPriority,
      status: row.status,
    })),
    unresolved: corridors.unresolved,
    unavailableReason: null,
    contentHash: corridors.contentHash,
  }),
  'corridor set is ready',
);
assert(!JSON.stringify(corridors).includes('mapRoadNetwork'), 'no legacy network in corridor contract');
assert(world.includes('playerCorridorLayer'), 'country dashboard wires curated corridors');
assert(!world.includes('getRoadRuntimeManifest'), 'country screen does not load ROAD runtime on mount');

assert(existsSync(resolve(root, 'docs/design/map-v2/MAP_V2_TURKEY_COUNTRY_VISUAL_SPEC.md')), 'visual spec exists');
assert(read('docs/design/map-v2/MAP_V2_TURKEY_COUNTRY_VISUAL_SPEC.md').includes('Map visual pass'), 'spec documents map visual pass');
const svgRel = 'src/mapV2/generated/visual/turkey-country-base.svg';
assert(existsSync(resolve(root, svgRel)), 'country base SVG exported');
const svgBytes = statSync(resolve(root, svgRel)).size;
assert(svgBytes > 2_000 && svgBytes < 400_000, `SVG encoded size ${svgBytes}`);
assert(read(svgRel).includes('COUNTRY_HIGH') || read(svgRel).includes('geoBoundaries') || read(svgRel).includes('verified'), 'SVG notes verified outline');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Transport Inspector'), 'transport inspector remains');
assert(read('src/mapV2/screens/MapV2RoadPrototypeScreen.tsx').includes('ROAD_RENDER_PROFILE_DEBUG'), 'debug ROAD viewer remains');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
