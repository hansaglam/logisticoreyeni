/**
 * MAP-02B.1 map-scope back navigation.
 * Run: node --import tsx scripts/map-scope-navigation-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { resolveMapExperience } from '../src/domain/mapExperienceAuthority';
import { EXPECTED_RAIL_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRailCorridor';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../src/mapV2/geo/roadRuntimePackage';
import { resolveMapScopeBack, countryWorkingBounds } from '../src/mapV2/gameplay/mapV2ExperienceNavigation';
import { clampWorldCamera, WORLD_INHABITED_BOUNDS } from '../src/mapV2/geo/worldCamera';
import { resolveCameraScalePlan } from '../src/mapV2/presentation/mapCameraPolicy';
import {
  captureWorldCameraForCountryEntry,
  writeScopeCamera,
} from '../src/mapV2/experience/mapSessionCamera';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { commandModeAfterMapScopeChange } from '../src/components/map/commandCenter/mapCommandMode';
import { mapV2ExperienceCopy } from '../src/mapV2/presentation/mapV2ExperienceCopy';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ ${label}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== MAP-02B.1 map scope back ===\n');

const worldBack = resolveMapScopeBack({ mode: 'WORLD' });
const countryBack = resolveMapScopeBack({ mode: 'COUNTRY', countryDisplayName: 'Türkiye' });
const cityBack = resolveMapScopeBack({ mode: 'CITY_DETAIL', countryDisplayName: 'Fransa' });
const hook = read('src/mapV2/experience/useMapV2GeographicExperience.ts');
const control = read('src/mapV2/experience/MapScopeBackControl.tsx');
const viewport = read('src/mapV2/experience/MapV2CommandCenterViewport.tsx');
const worldScreen = read('src/mapV2/screens/MapV2WorldScreen.tsx');
const shell = read('src/components/map/commandCenter/MapCommandCenterShell.tsx');
const rail = read('src/components/map/commandCenter/MapCommandRail.tsx');
const inspector = read('src/components/map/commandCenter/MapContextualInspector.tsx');
const mapScreen = read('src/screens/MapScreen.tsx');
const navigation = read('src/mapV2/gameplay/mapV2ExperienceNavigation.ts');
const geographic = read('src/mapV2/world/MapV2GeographicCanvas.tsx');

assert(worldBack.available === false, '1. WORLD has no map-scope back control');
assert(control.includes('if (!back.available) return null'), '1b. WORLD does not render a disabled back button');
assert(countryBack.available === true, '2. COUNTRY has map-scope back control');
assert(countryBack.available && countryBack.label === 'Dünya', '2b. COUNTRY label is Dünya');
assert(countryBack.available && countryBack.label === mapV2ExperienceCopy.modeWorld, '2c. label comes from the Turkish copy authority');
assert(countryBack.available && countryBack.target === 'WORLD', '3. COUNTRY back target is WORLD');
assert(hook.includes('goBackInMapScope'), '3b. shared experience exposes one back action');
assert(hook.includes('returnToWorld()'), '3c. COUNTRY back uses the shared world return');
assert(!hook.includes('onExitHome') && !control.includes('onExitHome'), '4. COUNTRY back does not navigate to the dashboard');
assert(!control.includes('activeTab') && !rail.includes('goBackInMapScope'), '4b. map back is not the Ana rail action');
assert(hook.includes('setSelectedId(null)'), '5. selected country clears on return to WORLD');
assert(hook.includes('setFocusCountryId(null)'), '5b. focused country clears on return to WORLD');
assert(hook.includes('setSelectedCityId(null)'), '6. selected city clears on return to WORLD');
assert(hook.includes('onCountrySelectRef.current?.({'), '7. country selection is published upward');
assert(mapScreen.includes('setLocationLabel(selection.displayName)'), '7b. inspector label follows the published selection');
assert(inspector.includes('locationLabel ?'), '7c. empty selection does not keep a location line');
assert(!hook.includes('setCommandMode') && !control.includes('MapCommandMode'), '8. command rail mode is not changed by map back');
assert(!mapScreen.slice(mapScreen.indexOf('const handleCountrySelect'), mapScreen.indexOf('const handleCitySelect')).includes('setCommandMode'), '8b. Harita does not reset command mode on WORLD return');
assert(hook.includes('restoreCamera(worldCamera, false)'), '9. WORLD camera snapshot is restored without a country-timed animation');
assert(hook.includes('applyHome(false)'), '9b. inhabited world camera is the fallback');
assert(hook.includes('useLayoutEffect'), '9c. WORLD camera is applied after the scope render');
assert(viewport.includes('<MapScopeBackControl'), '10. control is mounted in the map viewport');
assert(!shell.includes('MapScopeBackControl'), '10b. control is not in the command-center chrome');
assert(!rail.includes('MapScopeBackControl'), '10c. control is not in the command rail');
assert(control.includes("position: 'absolute'") && control.includes('left: mapUiTheme.space8'), '10d. placement is relative to the viewport');
assert(viewport.includes('pointerEvents="box-none"'), '11. viewport does not capture every touch');
assert(control.includes('pointerEvents="box-none"'), '11b. back anchor does not cover the map');
assert(!control.includes('absoluteFillObject'), '11c. back control is not a full-screen overlay');
assert(rail.includes('Ana sayfaya dön') && rail.includes('onPress={onExit}'), '12. Ana remains the app-level exit');
assert(mapScreen.includes('onExit={onExitHome}'), '12b. Ana still leaves Harita');
assert(resolveMapExperience({ profile: 'internal' }) === 'MAP_V2', '13. internal/dev remains MAP_V2');
assert(resolveMapExperience({ profile: 'development' }) === 'MAP_V2', '13b. development remains MAP_V2');
assert(resolveMapExperience({ profile: 'production' }) === 'LEGACY_MAP', '14. production remains LEGACY_MAP');
assert(resolveMapExperience({ profile: 'store' }) === 'LEGACY_MAP', '14b. store remains LEGACY_MAP');
assert(resolveMapExperience({ profile: 'beta' }) === 'LEGACY_MAP', '14c. unknown profile remains LEGACY_MAP');
assert(fs.existsSync(path.join(ROOT, 'src/components/map/WorldMapCanvas.tsx')), '15. legacy fallback file remains');
assert(fs.existsSync(path.join(ROOT, 'src/components/map/InteractiveTurkeyMap.tsx')), '15b. legacy renderer remains');
assert(
  ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882',
  '16. ROAD hash unchanged',
);
assert(
  EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b',
  '16b. RAIL hash unchanged',
);
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), '16c. routes.ts unchanged');
assert(!hook.includes('routes.ts') && !control.includes('settleDelivery'), '16d. map back does not touch gameplay authority');
assert(cityBack.available && cityBack.target === 'COUNTRY' && cityBack.label === 'Fransa', 'future CITY_DETAIL returns to the open country name');
assert(!navigation.includes('country.tur'), 'back policy is not Türkiye-only');
assert(worldScreen.includes('onBack={goBackInMapScope}'), 'diagnostic chrome uses the shared back action');
assert(viewport.includes('cityDetailEnabled: false'), 'product city-detail UI stays off');
assert(control.includes('accessibilityRole="button"'), 'back control is a button');
assert(control.includes('MIN_TOUCH_TARGET'), 'back control keeps the minimum touch target');

for (const mode of ['market', 'fleet', 'contracts', 'warehouses', 'road', 'rail'] as const) {
  assert(commandModeAfterMapScopeChange(mode) === mode, `command mode ${mode} survives COUNTRY -> WORLD`);
}
assert(hook.includes('setSelectedCityId(null)') && hook.includes('setSelectedId(null)') && hook.includes('setFocusCountryId(null)'), 'return clears city, selected country, and focus');
assert(read('src/mapV2/experience/MapV2ExperienceCanvas.tsx').includes("selectedId={mode === 'COUNTRY' ? focusCountryId : selectedId}"), 'WORLD does not keep the country focus as the selected id');
const restoreStart = geographic.indexOf('const restoreWorldCamera');
const restoreBlock = geographic.slice(restoreStart, geographic.indexOf('const applyHome', restoreStart));
assert(restoreBlock.includes("scope: 'WORLD'") && restoreBlock.includes('WORLD_INHABITED_BOUNDS'), '11. prior WORLD camera is restored with WORLD bounds');
assert(!restoreBlock.includes("scope: 'COUNTRY'"), '13. WORLD restore is not clamped with COUNTRY policy');
assert(geographic.includes('scalePlanRef.current'), '14. live COUNTRY camera still clamps through the active country plan');

const worldSample = { scale: 420, translateX: 12, translateY: 18 };
const countrySample = { scale: 6400, translateX: -800, translateY: -400 };
const entered = captureWorldCameraForCountryEntry({ world: null, country: null }, worldSample);
const afterCountry = writeScopeCamera(entered, 'COUNTRY', countrySample);
assert(afterCountry.world?.scale === worldSample.scale && afterCountry.country?.scale === countrySample.scale, '12. COUNTRY camera cannot overwrite the WORLD snapshot');
assert(writeScopeCamera(afterCountry, 'WORLD', countrySample).world?.scale === worldSample.scale, '12b. a WORLD sample does not replace the saved return camera');

const turkey = getCountryRecord('country.tur');
const turkeyFrame = turkey ? countryWorkingBounds(turkey, 'COUNTRY_HIGH') : null;
const cameraViewport = { width: 566, height: 332 };
if (turkeyFrame) {
  const worldPlan = resolveCameraScalePlan({
    scope: 'WORLD',
    viewportWidth: cameraViewport.width,
    viewportHeight: cameraViewport.height,
    frameBounds: WORLD_INHABITED_BOUNDS,
  });
  const countryPlan = resolveCameraScalePlan({
    scope: 'COUNTRY',
    viewportWidth: cameraViewport.width,
    viewportHeight: cameraViewport.height,
    frameBounds: turkeyFrame,
  });
  const restored = clampWorldCamera({
    scale: worldSample.scale,
    translateX: worldSample.translateX,
    translateY: worldSample.translateY,
    viewportWidth: cameraViewport.width,
    viewportHeight: cameraViewport.height,
    elastic: false,
    minScaleFactor: worldPlan.minScaleFactor,
    maxScaleFactor: worldPlan.maxScaleFactor,
    contentBounds: worldPlan.panBounds,
  });
  const countryClamped = clampWorldCamera({
    scale: worldSample.scale,
    translateX: worldSample.translateX,
    translateY: worldSample.translateY,
    viewportWidth: cameraViewport.width,
    viewportHeight: cameraViewport.height,
    elastic: false,
    minScaleFactor: countryPlan.minScaleFactor,
    maxScaleFactor: countryPlan.maxScaleFactor,
    contentBounds: countryPlan.panBounds,
  });
  assert(restored.scale < countryClamped.scale, '13b. WORLD policy keeps a wide camera wider than COUNTRY policy');
  assert(countryPlan.minScale > worldPlan.maxScale, '14b. COUNTRY minimum is above the WORLD maximum');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
