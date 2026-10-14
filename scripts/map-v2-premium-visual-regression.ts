/**
 * MAP-03 camera, LOD, and premium visual policy.
 * Run: npx tsx scripts/map-v2-premium-visual-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { mapUiTheme, resolveMapChrome, resolveMapLayoutBand } from '../src/components/map/commandCenter/mapUiTheme';
import { preserveGeographicCenter, WORLD_INHABITED_BOUNDS, clampWorldCamera, contentFitScale, screenToWorld, zoomToFocal } from '../src/mapV2/geo/worldCamera';
import { EXPECTED_RAIL_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRailCorridor';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../src/mapV2/geo/roadRuntimePackage';
import { clusterPolicyActive } from '../src/mapV2/experience/mapClusterPolicy';
import { readMapSessionCamera, writeMapSessionCamera, clearMapSessionCamera } from '../src/mapV2/experience/mapSessionCamera';
import { cityMarkerPriority, resolveCityMarkerState, resolveCityMarkerVisual } from '../src/mapV2/presentation/cityMarkerVisual';
import { resolveLabelVisibility } from '../src/mapV2/presentation/labelCollision';
import { resolveCameraLimits, resolveCameraScalePlan } from '../src/mapV2/presentation/mapCameraPolicy';
import { lodShowsGameplayCities, lodShowsRoadNetwork, resolveMapLod } from '../src/mapV2/presentation/mapLodPolicy';
import { MAP_DRAW_ORDER, mapVisualTokens } from '../src/mapV2/presentation/mapVisualTokens';
import { markerIntersectsViewport } from '../src/mapV2/presentation/markerCullPolicy';
import { countryWorkingBounds } from '../src/mapV2/gameplay/mapV2ExperienceNavigation';
import { getCountryRecord } from '../src/mapV2/world/worldBoundaryLoader';
import { AIR_ROUTE_VISUAL, SEA_ROUTE_VISUAL, resolveRailVisualStyle, resolveRoadVisualStyle } from '../src/mapV2/presentation/transportVisualStyle';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\n=== MAP-03 premium visual ===\n');

  const worldOverview = resolveMapLod({ scope: 'WORLD', zoom: 1 });
  const worldFocused = resolveMapLod({ scope: 'WORLD', zoom: 2 });
  const countryOverview = resolveMapLod({ scope: 'COUNTRY', zoom: 1 });
  const countryOperations = resolveMapLod({ scope: 'COUNTRY', zoom: 1, hasCitySelection: true });
  assert(worldOverview === 'WORLD_OVERVIEW', 'semantic LOD resolver exists');
  assert(worldFocused === 'WORLD_FOCUSED', 'world zoom resolves a focused level');
  assert(countryOverview === 'COUNTRY_OVERVIEW', 'country scope resolves overview');
  assert(!lodShowsGameplayCities(worldOverview) && !lodShowsRoadNetwork(worldOverview), 'WORLD overview hides country-level city clutter');
  assert(lodShowsGameplayCities(countryOverview) && lodShowsGameplayCities(countryOperations), 'COUNTRY shows gameplay cities');

  const states = ['DEFAULT', 'AVAILABLE', 'SELECTED', 'LOCKED', 'ACTIVE_OPERATION', 'WARNING', 'HUB'] as const;
  for (const state of states) {
    assert(resolveCityMarkerVisual(state).state === state, `city marker state ${state}`);
  }
  assert(resolveCityMarkerState({ selected: true, locked: true }) === 'SELECTED', 'selected city always receives highest city priority');
  assert(cityMarkerPriority('SELECTED') > cityMarkerPriority('HUB'), 'selected marker outranks hub');

  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const labels = resolveLabelVisibility([
    { id: 'minor', priority: 1, selected: false, bounds: box },
    { id: 'selected', priority: 0, selected: true, bounds: box },
  ]);
  assert(labels.some((label) => label.id === 'selected'), 'label collision cannot suppress selected label');
  assert(!labels.some((label) => label.id === 'minor'), 'lower priority overlapping label is suppressed');
  const again = resolveLabelVisibility([
    { id: 'b', priority: 2, selected: false, bounds: { minX: 20, minY: 0, maxX: 30, maxY: 10 } },
    { id: 'a', priority: 2, selected: false, bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
  ]);
  const repeat = resolveLabelVisibility([
    { id: 'b', priority: 2, selected: false, bounds: { minX: 20, minY: 0, maxX: 30, maxY: 10 } },
    { id: 'a', priority: 2, selected: false, bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
  ]);
  assert(again.map((label) => label.id).join() === repeat.map((label) => label.id).join(), 'label culling/collision policy deterministic');

  const worldRoad = resolveRoadVisualStyle('WORLD_OVERVIEW', 'CANONICAL_GAMEPLAY_ROAD');
  const countryRoad = resolveRoadVisualStyle('COUNTRY_OVERVIEW', 'CANONICAL_GAMEPLAY_ROAD');
  const operationsRoad = resolveRoadVisualStyle('COUNTRY_OPERATIONS', 'CANONICAL_GAMEPLAY_ROAD');
  assert(!worldRoad.visible && countryRoad.visible && operationsRoad.widthScale !== countryRoad.widthScale, 'ROAD style differs by LOD');
  const rail = resolveRailVisualStyle('COUNTRY_OVERVIEW', false);
  assert(rail.segmented && rail.core !== countryRoad.core, 'RAIL visual style is distinguishable from ROAD');
  assert(SEA_ROUTE_VISUAL.productionEnabled === false && AIR_ROUTE_VISUAL.productionEnabled === false, 'SEA/AIR are not activated');

  const worldLimits = resolveCameraLimits('WORLD');
  const countryLimits = resolveCameraLimits('COUNTRY');
  assert(worldLimits.maxScaleFactor > worldLimits.minScaleFactor && countryLimits.maxScaleFactor > countryLimits.minScaleFactor, 'camera policy has WORLD and COUNTRY bounds');
  assert(worldLimits.framePadding > 0 && countryLimits.framePadding > 0, 'country fit includes viewport-aware padding');

  const viewport = { width: 566, height: 332 };
  const worldPlan = resolveCameraScalePlan({
    scope: 'WORLD',
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    frameBounds: WORLD_INHABITED_BOUNDS,
  });
  const turkey = getCountryRecord('country.tur');
  const turkeyFrame = countryWorkingBounds(turkey!, 'COUNTRY_HIGH');
  const countryPlan = resolveCameraScalePlan({
    scope: 'COUNTRY',
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    frameBounds: turkeyFrame,
  });
  assert(worldPlan.fitScale !== worldPlan.minScale, 'WORLD initial scale differs from WORLD minimum scale');
  assert(countryPlan.fitScale !== countryPlan.minScale, 'COUNTRY fit scale differs from COUNTRY minimum scale');
  assert(worldPlan.minScale < worldPlan.fitScale && worldPlan.fitScale < worldPlan.maxScale, 'WORLD pinch-out can reduce scale from initial fit');
  assert(countryPlan.minScale < countryPlan.fitScale && countryPlan.fitScale < countryPlan.maxScale, 'COUNTRY pinch-out can reduce scale from initial fit');
  assert(worldPlan.minScale > contentFitScale(viewport.width, viewport.height, WORLD_INHABITED_BOUNDS) * 0.5, 'WORLD clamps at a meaningful lower bound');
  assert(countryPlan.minScale > countryPlan.fitScale * 0.65, 'COUNTRY clamps above a postage-stamp zoom');
  const worldClamped = clampWorldCamera({
    scale: worldPlan.fitScale * 40,
    translateX: 0,
    translateY: 0,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    elastic: false,
    minScaleFactor: worldPlan.minScaleFactor,
    maxScaleFactor: worldPlan.maxScaleFactor,
    contentBounds: worldPlan.panBounds,
  });
  assert(Math.abs(worldClamped.scale - worldPlan.maxScale) < 1, 'max zoom still enforced');
  const focal = { x: 180, y: 90 };
  const startScale = 400;
  const startTx = 20;
  const startTy = 30;
  const before = screenToWorld(focal.x, focal.y, startTx, startTy, startScale);
  const shifted = zoomToFocal(focal.x, focal.y, startScale, startTx, startTy, startScale * 0.8);
  const after = screenToWorld(focal.x, focal.y, shifted.translateX, shifted.translateY, startScale * 0.8);
  assert(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6, 'pinch focal point remains local to map viewport');
  const panOut = clampWorldCamera({
    scale: worldPlan.minScale,
    translateX: 1e6,
    translateY: 0,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    elastic: false,
    minScaleFactor: worldPlan.minScaleFactor,
    maxScaleFactor: worldPlan.maxScaleFactor,
    contentBounds: worldPlan.panBounds,
  });
  const panIn = clampWorldCamera({
    scale: worldPlan.maxScale,
    translateX: 1e6,
    translateY: 0,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    elastic: false,
    minScaleFactor: worldPlan.minScaleFactor,
    maxScaleFactor: worldPlan.maxScaleFactor,
    contentBounds: worldPlan.panBounds,
  });
  assert(panIn.translateX !== panOut.translateX, 'pan bounds depend on current scale');
  assert(countryPlan.framePadding > 0 && countryPlan.fitScale < contentFitScale(viewport.width, viewport.height, turkeyFrame), 'country fit includes viewport-aware padding');
  assert(worldPlan.panBounds.minX <= WORLD_INHABITED_BOUNDS.minX && worldPlan.panBounds.maxY >= WORLD_INHABITED_BOUNDS.maxY, 'world fit uses inhabited-world bounds');

  const experience = read('src/mapV2/experience/useMapV2GeographicExperience.ts');
  const canvas = read('src/mapV2/experience/MapV2ExperienceCanvas.tsx');
  const geographic = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
  assert(experience.includes('restoreCamera(worldCamera, false)'), 'COUNTRY -> WORLD restores world camera');
  const resized = preserveGeographicCenter({
    previousWidth: 800,
    previousHeight: 400,
    nextWidth: 1000,
    nextHeight: 500,
    scale: 2,
    translateX: 100,
    translateY: 40,
  });
  const beforeX = (800 / 2 - 100) / 2;
  const afterX = (1000 / 2 - resized.translateX) / 2;
  assert(Math.abs(beforeX - afterX) < 1e-9, 'resize preserves camera center');
  assert(geographic.includes('preserveRelativeZoom'), 'renderer uses center-preserving resize');
  assert(geographic.includes('zoomToFocal'), 'pinch keeps the geographic point under the fingers');
  assert(geographic.includes('.maxPointers(1)'), 'two-finger pinch is not stolen by pan');
  assert(canvas.includes('mapGesturesEnabled') && !canvas.includes("mapGesturesEnabled={mode !== 'COUNTRY'}"), 'country pinch stays enabled');

  const saveGame = read('src/storage/saveGame.ts');
  assert(!saveGame.includes('writeMapSessionCamera') && !saveGame.includes('MapSessionSnapshot'), 'map session camera state is not saved in player save');
  assert(experience.includes('writeMapSessionCamera'), 'session camera is memory-only');
  assert(read('src/store/gameStore.ts').includes('clearMapSessionCamera()'), 'account reset clears the map session');
  clearMapSessionCamera();
  writeMapSessionCamera({
    playerId: 'player-a',
    mode: 'WORLD',
    selectedCountryId: null,
    focusCountryId: null,
    selectedCityId: null,
    camera: { scale: 2, translateX: 1, translateY: 1 },
    worldCamera: null,
  });
  assert(readMapSessionCamera('player-b') == null, 'another player does not inherit the map session');
  clearMapSessionCamera();

  assert(markerIntersectsViewport({ x: 0, y: 0 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 }), 'marker culling policy exists');
  assert(!markerIntersectsViewport({ x: 40, y: 40 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0), 'far markers are outside the viewport');
  assert(read('src/mapV2/world/cityViewerFrame.ts').includes('expandCullBounds'), 'city markers use the cull margin');

  assert(mapVisualTokens.roadPrimary !== mapVisualTokens.railPrimary, 'map tokens centralized');
  assert(mapVisualTokens.ocean !== mapVisualTokens.countrySelected, 'ocean and selected country are distinct tokens');
  assert(MAP_DRAW_ORDER.indexOf('ocean') < MAP_DRAW_ORDER.indexOf('road') && MAP_DRAW_ORDER.indexOf('label') > MAP_DRAW_ORDER.indexOf('road'), 'labels draw after transport');
  assert(geographic.includes('MAP_DRAW_ORDER'), 'renderer documents the draw order');

  assert(ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882', 'ROAD hash unchanged');
  assert(EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b', 'RAIL hash unchanged');
  assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');

  assert(mapUiTheme.inspectorWidthRegular === 232 && mapUiTheme.inspectorWidthWide === 260, 'command-center shell geometry unchanged');
  assert(resolveMapLayoutBand(900) === 'regular' && resolveMapChrome('regular').inspectorWidth === 232, 'regular landscape inspector stays docked at 232');
  assert(!read('src/components/map/commandCenter/MapCommandCenterShell.tsx').includes('mapLodPolicy'), 'shell does not absorb map LOD');
  assert(!read('src/mapV2/experience/MapV2CommandCenterViewport.tsx').includes('describeMapLod'), 'LOD diagnostics stay out of gameplay UI');
  assert(clusterPolicyActive('VEHICLE_CLUSTER') === true, 'vehicle clusters are active for trucks that share a city');
  assert(clusterPolicyActive('CITY_CLUSTER') === false && clusterPolicyActive('OPERATION_CLUSTER') === false, 'city and operation clusters stay inactive');
  assert(canvas.includes('lodShowsRoadNetwork'), 'country transport follows the LOD policy');
  assert(SEA_ROUTE_VISUAL.core !== mapVisualTokens.roadPrimary && AIR_ROUTE_VISUAL.core !== mapVisualTokens.roadPrimary, 'future sea and air tokens are not road paint');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
