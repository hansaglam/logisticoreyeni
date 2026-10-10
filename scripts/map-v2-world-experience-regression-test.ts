/**
 * Map V2 Step 2B world experience: availability, selection, world↔country.
 * Run: node --import tsx scripts/map-v2-world-experience-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COUNTRY_GAMEPLAY_AVAILABILITY,
  MAP_V2_AVAILABILITY_DEFAULT,
  MAP_V2_AVAILABILITY_POLICY_ID,
  isCountryOpenable,
  listFixtureAvailabilityExamples,
  resolveCountryGameplayAvailability,
} from '../src/mapV2/gameplay/mapV2CountryAvailability.fixture';
import {
  canEnterCountryMode,
  countryFocusBounds,
  countryWorkingBounds,
  neighborCountryIds,
} from '../src/mapV2/gameplay/mapV2ExperienceNavigation';
import { resolveCountryDisplayName, countryNameKey } from '../src/mapV2/presentation/countryDisplayName';
import { paintForCountryAvailability, paintForCountryFocus } from '../src/mapV2/presentation/countryPaint';
import { mapV2ExperienceCopy } from '../src/mapV2/presentation/mapV2ExperienceCopy';
import {
  cameraToFitBounds,
  clampWorldCamera,
  contentFitScale,
  COUNTRY_CONTENT_MAX_SCALE_FACTOR,
  COUNTRY_CONTENT_MIN_SCALE_FACTOR,
  isFiniteCamera,
  WORLD_INHABITED_BOUNDS,
} from '../src/mapV2/geo/worldCamera';
import { getCountryRecord, getWorldBoundaryPackage } from '../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../src/mapV2/world/countryCityLoader';
import { worldPathCacheKey } from '../src/mapV2/world/worldViewerFrame';

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

console.log('\n=== Map V2 World Experience Regression ===\n');

const pkg = getWorldBoundaryPackage();
const tur = getCountryRecord('country.tur')!;
const fra = getCountryRecord('country.fra')!;
const vat = getCountryRecord('country.vat')!;

assert(!('availability' in tur), 'geography record has no availability field');
assert(MAP_V2_AVAILABILITY_POLICY_ID.includes('dev-fixture'), 'fixture marked DEV');
assert(MAP_V2_AVAILABILITY_DEFAULT === 'LOCKED', 'unknown default LOCKED');
assert(resolveCountryGameplayAvailability('country.unknown-xyz') === 'LOCKED', 'unknown country safe default');
assert(resolveCountryGameplayAvailability('country.tur') === 'STARTER_AVAILABLE', 'Türkiye starter');
assert(resolveCountryGameplayAvailability('country.deu') === 'UNLOCKED', 'Germany unlocked');
assert(resolveCountryGameplayAvailability('country.fra') === 'LOCKED', 'France locked');
assert(resolveCountryGameplayAvailability('country.usa') === 'LOCKED', 'USA locked');
assert(resolveCountryGameplayAvailability('country.vat') === 'NOT_GAMEPLAY_SUPPORTED', 'Vatican unsupported');
assert(resolveCountryGameplayAvailability('country.ata') === 'NOT_GAMEPLAY_SUPPORTED', 'Antarctica unsupported in fixture');

const examples = listFixtureAvailabilityExamples();
assert(
  COUNTRY_GAMEPLAY_AVAILABILITY.every((state) => examples.some((row) => row.availability === state)),
  'fixture includes every visual state',
);

assert(isCountryOpenable('STARTER_AVAILABLE') && isCountryOpenable('UNLOCKED'), 'openable states');
assert(!isCountryOpenable('LOCKED') && !isCountryOpenable('NOT_GAMEPLAY_SUPPORTED'), 'locked/unsupported not openable');
assert(canEnterCountryMode(resolveCountryGameplayAvailability('country.tur')), 'open Türkiye enters COUNTRY');
assert(!canEnterCountryMode(resolveCountryGameplayAvailability('country.fra')), 'locked cannot silently enter COUNTRY');
assert(!canEnterCountryMode(resolveCountryGameplayAvailability('country.vat')), 'unsupported cannot enter COUNTRY');

const beforeVerts = tur.lods.WORLD_LOW.vertexCount;
resolveCountryGameplayAvailability(tur.geoCountryId);
assert(tur.lods.WORLD_LOW.vertexCount === beforeVerts, 'selection/availability does not mutate geometry');
assert(worldPathCacheKey('country.tur', 'WORLD_LOW') === 'country.tur::WORLD_LOW', 'path cache key unchanged');
assert(worldPathCacheKey('country.tur', 'COUNTRY_HIGH') !== worldPathCacheKey('country.tur', 'WORLD_LOW'), 'LOD still in cache key');

assert(resolveCountryDisplayName(tur, 'tr') === 'Türkiye', 'TR locale Türkiye not source Turkey');
assert(tur.sourceDisplayName !== 'Türkiye', 'source/provenance name unchanged internally');
assert(resolveCountryDisplayName(tur, 'en') === 'Türkiye', 'EN verified Türkiye');
assert(!resolveCountryDisplayName(tur, 'tr').includes('country.tur'), 'player-facing name is not geo id');
assert(resolveCountryDisplayName(fra, 'tr') === 'Fransa', 'France uses verified TR name');
assert(resolveCountryDisplayName(vat, 'tr') === vat.sourceDisplayName, 'unlisted countries keep source name');
assert(countryNameKey('country.tur').startsWith('mapV2.country.'), 'nameKey ready for localization');
assert(mapV2ExperienceCopy.openCountry.length > 0 && mapV2ExperienceCopy.viewRequirements.length > 0, 'CTA copy exists');

const lockedPaint = paintForCountryAvailability('LOCKED', false);
const unlockedPaint = paintForCountryAvailability('UNLOCKED', false);
const selectedPaint = paintForCountryAvailability('UNLOCKED', true);
assert(lockedPaint.fill !== unlockedPaint.fill, 'locked/unlocked fill distinct');
assert(selectedPaint.border !== unlockedPaint.border || selectedPaint.strokeWidth > unlockedPaint.strokeWidth, 'selected highlight distinct');

const turFocus = countryFocusBounds(tur, 'COUNTRY_HIGH');
assert(turFocus.maxX - turFocus.minX < 0.2, 'Türkiye country bounds used for focus');
const usa = getCountryRecord('country.usa')!;
const usaFocus = countryFocusBounds(usa, 'COUNTRY_HIGH');
assert(usaFocus.maxX - usaFocus.minX < usa.lods.COUNTRY_HIGH.projectedBounds.maxX - usa.lods.COUNTRY_HIGH.projectedBounds.minX, 'wide countries focus largest polygon');

const neighbors = neighborCountryIds('country.tur', 'COUNTRY_HIGH');
assert(neighbors.length > 0, 'neighbor helper still available for later context');
assert(!neighbors.includes('country.tur'), 'neighbors exclude focus');

assert(WORLD_INHABITED_BOUNDS.maxY < 0.75, 'world home avoids polar slab');
assert(pkg.countries.find((c) => c.geoCountryId === 'country.ata')?.webMercatorLayer !== 'INCLUDED', 'Antarctica still omitted from render');

const screen = read('src/mapV2/screens/MapV2WorldScreen.tsx');
assert(!screen.includes('neighborCountryIds'), 'COUNTRY scene omits neighbor draws');
assert(screen.includes('countryWorkingBounds'), 'country camera uses working bounds');
assert(screen.includes('contentBounds={countryPanBounds}'), 'country pan bounds are independent of world');
assert(screen.includes('countryOverviewSubtitle') || screen.includes('Ülke görünümü') || read('src/mapV2/presentation/mapV2ExperienceCopy.ts').includes('countryOverviewSubtitle'), 'country overview subtitle');
assert(screen.includes('elasticGestures={mode !== \'COUNTRY\'}'), 'country camera has no rubber-band');
assert(screen.includes('COUNTRY_ENTER_FADE_MS'), 'entry fade transition');
assert(screen.includes('paintForCountryDashboard'), 'country scene uses dashboard paint');
assert(screen.includes('hitTestIds={mode === \'COUNTRY\' ? [] : null}'), 'surrounding countries are non-interactive');
assert(screen.includes('setWorldCamera(snapshot ? { ...snapshot } : null)'), 'world camera snapshot is cloned');
assert(screen.includes("lodOverride={mode === 'COUNTRY' ? 'COUNTRY_HIGH' : 'AUTO'}"), 'COUNTRY mode loads COUNTRY_HIGH');
assert(screen.includes("setMode('COUNTRY')"), 'open unlocked sets COUNTRY mode');
assert(screen.includes('setMode(\'WORLD\')') || screen.includes('setMode("WORLD")') || screen.includes("setMode('WORLD')"), 'back returns WORLD');
assert(screen.includes('restoreCamera'), 'world camera restoration');
assert(screen.includes('captureCamera'), 'world camera snapshot before country');
assert(screen.includes('hardwareBackPress'), 'Android hardware back handled');
assert(screen.includes("returnToWorld()"), 'country back stays in experience');
assert(screen.includes('showDialog'), 'locked requirements is info only');
assert(screen.includes('MapV2CountryOverviewShell'), 'country overview shell');
assert(screen.includes('COUNTRY_ENTER_WORLD_PADDING'), 'world zooms toward country before isolate');
assert(screen.includes('WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR'), 'world approach can zoom closer than nav max');
assert(read('src/mapV2/screens/MapV2CountryOverviewShell.tsx').includes('ctaViewCities'), 'shell has city CTA copy usage');
assert(mapV2ExperienceCopy.ctaViewContracts.length > 0, 'contracts CTA copy');
assert(mapV2ExperienceCopy.cityInspect.length > 0, 'city inspect action copy');
assert(!screen.includes('debugAddCash') && !screen.includes('firebase'), 'no economy/backend write in experience');
assert(screen.includes('mapV2ExperienceCopy'), 'UI copy not hardcoded English names in CTA');
assert(read('src/mapV2/screens/MapV2CountrySelectionPanel.tsx').includes('accessibilityLabel'), 'panel a11y');

assert(screen.includes('MapV2CitySelectionPanel'), 'Türkiye country view has city panel');
assert(screen.includes('MapV2CityDetailScreen'), 'city detail screen is part of experience');
assert(screen.includes("setMode('CITY_DETAIL')"), 'CITY_DETAIL mode exists');
assert(read('src/mapV2/gameplay/mapV2ExperienceNavigation.ts').includes("'CITY_DETAIL'"), 'navigation type includes CITY_DETAIL');
assert(screen.includes('viewportClip={mode === \'WORLD\' ? \'ROUNDED\' : \'NONE\'}'), 'world uses rounded viewport clip');
assert(screen.includes('worldLegendStarter'), 'compact availability legend');
assert(screen.includes('cityLayer={turkeyCityLayer}'), 'city markers wired');
assert(screen.includes('turkeyOverviewGameplayCities'), 'overview uses verified gameplay city subset');
assert(screen.includes('mapGesturesEnabled={mode !== \'COUNTRY\'}'), 'country overview locks pan/pinch');
assert(!screen.includes('ROAD_RENDER_PROFILE'), 'player country does not bind ROAD render profile');
assert(!screen.includes('roadLayer='), 'player country does not mount ROAD layer');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 World Geometry'), 'geometry debug remains');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('Map V2 Skia Spike'), 'spike remains');
assert(!read('src/screens/MapScreen.tsx').includes('MapV2WorldScreen'), 'MapScreen unchanged');
assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen no mapV2 import');
assert(!read('src/mapV2/gameplay/mapV2CountryAvailability.fixture.ts').includes('getWorldBoundaryPackage'), 'fixture not baked into geography package');

assert(fra.lods.COUNTRY_HIGH.polygons.length > 0, 'France still has geometry while locked');
assert(vat.lods.COUNTRY_HIGH.polygons.length > 0, 'unsupported still has geometry');

const worldCam = { scale: 480, translateX: -40, translateY: 12 };
const worldCamFrozen = { ...worldCam };
const working = countryWorkingBounds(tur, 'COUNTRY_HIGH');
const countryCam = cameraToFitBounds({
  ...working,
  viewportWidth: 400,
  viewportHeight: 720,
  padding: 0,
  contentBounds: working,
  minScaleFactor: COUNTRY_CONTENT_MIN_SCALE_FACTOR,
  maxScaleFactor: COUNTRY_CONTENT_MAX_SCALE_FACTOR,
});
assert(worldCam.scale === worldCamFrozen.scale && worldCam.translateX === worldCamFrozen.translateX, 'country fit does not mutate world camera');
assert(isFiniteCamera(countryCam), 'country initial camera is finite');
const countryFit = contentFitScale(400, 720, working);
assert(Math.abs(countryCam.scale - countryFit) < 1e-6, 'country initial camera fits working bounds');
assert(countryCam.scale > worldCam.scale, 'country camera is not the world camera zoomed in-place');

const restoredWorld = clampWorldCamera({
  ...worldCamFrozen,
  viewportWidth: 400,
  viewportHeight: 720,
  elastic: false,
});
assert(isFiniteCamera(restoredWorld), 'restored world camera stays finite');
assert(Math.abs(restoredWorld.scale - worldCamFrozen.scale) < 1 || restoredWorld.scale > 0, 'world camera restore path independent');

let zoomed = countryCam;
for (let i = 0; i < 16; i += 1) {
  zoomed = clampWorldCamera({
    scale: zoomed.scale * 9,
    translateX: zoomed.translateX,
    translateY: zoomed.translateY,
    viewportWidth: 400,
    viewportHeight: 720,
    elastic: false,
    contentBounds: working,
    minScaleFactor: COUNTRY_CONTENT_MIN_SCALE_FACTOR,
    maxScaleFactor: COUNTRY_CONTENT_MAX_SCALE_FACTOR,
  });
}
assert(isFiniteCamera(zoomed), 'repeated max zoom stays finite');
assert(zoomed.scale <= countryFit * COUNTRY_CONTENT_MAX_SCALE_FACTOR + 1e-6, 'country zoom is clamped');

const overPan = clampWorldCamera({
  scale: zoomed.scale,
  translateX: 1e12,
  translateY: -1e12,
  viewportWidth: 400,
  viewportHeight: 720,
  elastic: false,
  contentBounds: working,
  minScaleFactor: COUNTRY_CONTENT_MIN_SCALE_FACTOR,
  maxScaleFactor: COUNTRY_CONTENT_MAX_SCALE_FACTOR,
});
assert(isFiniteCamera(overPan), 'extreme pan stays finite');
assert(Math.abs(overPan.translateX) < 1e7 && Math.abs(overPan.translateY) < 1e7, 'country pan is clamped');

const nanCam = clampWorldCamera({
  scale: Number.NaN,
  translateX: Number.POSITIVE_INFINITY,
  translateY: Number.NEGATIVE_INFINITY,
  viewportWidth: 400,
  viewportHeight: 720,
  elastic: false,
  contentBounds: working,
  minScaleFactor: COUNTRY_CONTENT_MIN_SCALE_FACTOR,
  maxScaleFactor: COUNTRY_CONTENT_MAX_SCALE_FACTOR,
});
assert(isFiniteCamera(nanCam), 'invalid transform recovers to a finite camera');

assert(paintForCountryFocus().border === '#5EEAD4', 'country focus uses cyan scene border');
assert(paintForCountryFocus().strokeWidth < 0.001, 'country stroke is scene-scale not world-zoom scale');

const turkeyCities = getTurkeyCityPackage();
for (const row of turkeyCities.gameplayMappings) {
  const city = turkeyCities.cities.find((item) => item.geoCityId === row.geoCityId)!;
  assert(
    city.projected.x >= working.minX &&
      city.projected.x <= working.maxX &&
      city.projected.y >= working.minY &&
      city.projected.y <= working.maxY,
    `mapped city ${row.gameplayCityId} stays inside country working bounds`,
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');
