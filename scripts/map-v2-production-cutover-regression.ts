/**
 * MAP-02B real Harita Map V2 renderer cutover.
 * Run: node --import tsx scripts/map-v2-production-cutover-regression.ts
 *
 * SUPERSEDED:
 * "production MapScreen must never import mapV2" is no longer the rule.
 * Store, production, and unknown profiles still resolve LEGACY_MAP.
 * Internal and development profiles may resolve MAP_V2.
 * The old assertion was replaced in the Map V2 regression scripts and in
 * scripts/map-command-center-shell-regression.ts. It was not bypassed by a
 * re-export or a second copy of the canvas.
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { getMapCommandModeDefinition } from '../src/components/map/commandCenter/mapCommandMode';
import { resolveMapExperience } from '../src/domain/mapExperienceAuthority';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../src/mapV2/geo/roadRuntimePackage';
import { EXPECTED_RAIL_SOURCE_PACKAGE_HASH } from '../src/mapV2/geo/playerFacingRailCorridor';
import { preserveGeographicCenter } from '../src/mapV2/geo/worldCamera';

const ROOT = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== MAP-02B production cutover ===\n');

assert(resolveMapExperience({ profile: 'internal' }) === 'MAP_V2', '1. internal profile resolves MAP_V2');
assert(resolveMapExperience({ profile: 'development' }) === 'MAP_V2', '1b. development profile resolves MAP_V2');
assert(resolveMapExperience({ internal: true }) === 'MAP_V2', '1c. internal/dev flag resolves MAP_V2');
assert(resolveMapExperience({ profile: 'production', internal: true }) === 'LEGACY_MAP', '2. production profile resolves LEGACY_MAP');
assert(resolveMapExperience({ profile: 'store', internal: true }) === 'LEGACY_MAP', '2b. store profile resolves LEGACY_MAP');
assert(resolveMapExperience({ profile: 'beta', internal: true }) === 'LEGACY_MAP', '3. unknown release profile resolves LEGACY_MAP');
assert(resolveMapExperience({ profile: ' ', internal: false }) === 'LEGACY_MAP', '3b. blank profile follows the fail-safe');

const mapScreen = read('src/screens/MapScreen.tsx');
const viewport = read('src/mapV2/experience/MapV2CommandCenterViewport.tsx');
const canvasHost = read('src/mapV2/experience/MapV2ExperienceCanvas.tsx');
const controller = read('src/mapV2/experience/useMapV2GeographicExperience.ts');
const worldScreen = read('src/mapV2/screens/MapV2WorldScreen.tsx');
const geographic = read('src/mapV2/world/MapV2GeographicCanvas.tsx');
const shell = read('src/components/map/commandCenter/MapCommandCenterShell.tsx');
const app = read('App.tsx');
const saveGame = read('src/storage/saveGame.ts');

assert(mapScreen.includes("mapExperience === 'MAP_V2'"), '4. Harita branches on one map experience');
assert((mapScreen.match(/<WorldMapCanvas\s/g) ?? []).length === 1, '4b. legacy renderer is mounted in one branch');
assert((mapScreen.match(/<MapV2CommandCenterViewport\s/g) ?? []).length === 1, '4c. Map V2 viewport is mounted in one branch');
assert(!mapScreen.includes('<MapV2WorldScreen'), '4d. production shell does not mount the diagnostic screen');

assert(mapScreen.includes('<MapCommandCenterShell'), '5. command-center shell remains');
assert(shell.includes('MapTopStatusBar'), '5b. top bar remains');
assert(shell.includes('MapCommandRail'), '5c. command rail remains');
assert(shell.includes('MapContextualInspector'), '5d. inspector remains');
assert(shell.includes('MapBottomKpiBar'), '5e. KPI bar remains');

assert(app.includes("activeTab !== 'map'"), '6. GameTabBar stays hidden on Harita');

assert(viewport.includes('flex: 1'), '7. Map V2 viewport fills the map slot');
assert(viewport.includes("width: '100%'"), '7b. viewport uses the available width');
assert(canvasHost.includes('flex: 1'), '7c. shared canvas fills its parent');
assert(!viewport.includes('ScrollView'), '7d. viewport has no nested ScrollView');
assert(!mapScreen.includes('MAP_VIEWPORT_HEIGHT'), '7e. Harita does not pin a portrait map height');

assert(!viewport.includes('ScreenHeader'), '8. command viewport has no second header');
assert(!viewport.includes('MapV2CountryHeader'), '8b. command viewport has no country header');
assert(!viewport.includes('MapV2CountrySelectionPanel'), '8c. command viewport has no diagnostic country panel');
assert(!viewport.includes('devChips'), '8d. command viewport has no diagnostic chips');
assert(!mapScreen.includes('MapV2CountryOverviewShell'), '8e. Harita shell does not embed diagnostic country chrome');

assert(worldScreen.includes('useMapV2GeographicExperience'), '9. diagnostic screen uses the shared controller');
assert(worldScreen.includes('MapV2ExperienceCanvas'), '9b. diagnostic screen uses the shared canvas');
assert(viewport.includes('useMapV2GeographicExperience'), '9c. command center uses the same controller');
assert(viewport.includes('MapV2ExperienceCanvas'), '9d. command center uses the same canvas');
assert(read('src/screens/DebugSimulationScreen.tsx').includes('MapV2WorldScreen'), '9e. diagnostic entry still opens the shared screen');

assert(
  ROAD_SOURCE_PACKAGE_HASH_2E === 'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882',
  '10. ROAD hash unchanged',
);
assert(
  EXPECTED_RAIL_SOURCE_PACKAGE_HASH === 'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b',
  '11. RAIL hash unchanged',
);
const routes = read('src/data/routes.ts');
assert(routes.includes("route('izmir', 'istanbul', 480, 0.82, 180)"), '12. routes.ts canonical row unchanged');
assert(!controller.includes('routes.ts') && !canvasHost.includes('routes.ts'), '12b. Map V2 experience does not rewrite routes');

const sea = getMapCommandModeDefinition('sea');
const air = getMapCommandModeDefinition('air');
const rail = getMapCommandModeDefinition('rail');
assert(sea.productionEnabled === false && sea.availability === 'locked', '13. SEA production gameplay stays disabled');
assert(air.productionEnabled === false && air.availability === 'locked', '13b. AIR production gameplay stays disabled');
assert(rail.productionEnabled === false, '13c. RAIL production gameplay stays disabled');
assert(viewport.includes('seaVisualPreview: false'), '13d. command center does not enable SEA preview');
assert(viewport.includes('airVisualPreview: false'), '13e. command center does not enable AIR preview');

assert(mapScreen.includes("useState<MapCommandMode>('overview')"), '14. map UI mode stays local');
assert(!saveGame.includes('MapCommandMode'), '14b. map UI mode is not in the save');

assert(viewport.includes('onCountrySelect'), '15. country selection bridge');
assert(viewport.includes('onCitySelect'), '15b. city selection bridge');
assert(viewport.includes('onRouteSelect'), '15c. route selection bridge');
assert(viewport.includes('onMarkerSelect'), '15d. marker selection bridge');

assert(geographic.includes('onLayout'), '16. gestures measure the local canvas');
assert(geographic.includes('event.focalX'), '16b. pinch focal point is local');
assert(geographic.includes('selectAtScreen)(event.x, event.y)'), '16c. tap uses local canvas coordinates');
assert(!geographic.includes('absoluteX'), '16d. hit testing does not use screen-origin absoluteX');
const shifted = preserveGeographicCenter({
  previousWidth: 800,
  previousHeight: 400,
  nextWidth: 560,
  nextHeight: 400,
  scale: 2,
  translateX: 100,
  translateY: 40,
});
assert(shifted.translateX === -20 && shifted.translateY === 40, '16e. resize keeps the geographic center and scale');

assert(fs.existsSync(path.join(ROOT, 'src/components/map/WorldMapCanvas.tsx')), '17. legacy WorldMapCanvas remains');
assert(fs.existsSync(path.join(ROOT, 'src/components/map/InteractiveTurkeyMap.tsx')), '17b. legacy InteractiveTurkeyMap remains');
assert(read('src/components/map/WorldMapCanvas.tsx').includes('InteractiveTurkeyMap'), '17c. legacy canvas still owns the legacy map');

const shellRegression = read('scripts/map-command-center-shell-regression.ts');
const planRegression = read('scripts/map-v2-implementation-plan-regression-test.ts');
assert(shellRegression.includes('SUPERSEDED MAP-02B'), '18. shell regression records the superseded import ban');
assert(!shellRegression.includes('production Harita does not import mapV2'), '18b. old shell assertion text is gone');
assert(planRegression.includes('SUPERSEDED MAP-02B'), '18c. implementation-plan regression records the superseded ban');
assert(controller.includes("MAP_V2_EXPERIENCE_INITIAL_MODE = 'WORLD'"), 'startup remains WORLD');
assert(canvasHost.includes('homePolicy="INHABITED"'), 'startup camera remains the inhabited world');
assert(viewport.includes('MAP_V2_FLEET_OVERLAY_PENDING'), 'fleet overlay stays pending');
assert(viewport.includes('MAP_V2_WAREHOUSE_OVERLAY_PENDING'), 'warehouse overlay stays pending');
assert(viewport.includes('MAP_V2_DELIVERY_OVERLAY_PENDING'), 'delivery overlay stays pending');
assert(viewport.includes("showRailFoundation: emphasis === 'rail'"), 'RAIL command mode can show the visual foundation');
assert(viewport.includes("emphasizeRoad: emphasis === 'road'"), 'ROAD command mode emphasizes the existing road layer');
assert(viewport.includes('cityDetailEnabled: false'), 'command center does not open the diagnostic city page');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
