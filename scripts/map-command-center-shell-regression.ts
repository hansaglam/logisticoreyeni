/**
 * MAP-02 command center shell.
 * Run: npx tsx scripts/map-command-center-shell-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  MAP_COMMAND_MODE_DEFINITIONS,
  getMapCommandModeDefinition,
  inspectorPanelForMode,
  resolveMapCommandMode,
} from '../src/components/map/commandCenter/mapCommandMode';
import { buildMapCommandTelemetry } from '../src/components/map/commandCenter/mapCommandTelemetry';
import { resolveMapChrome, resolveMapLayoutBand } from '../src/components/map/commandCenter/mapUiTheme';
import { resolveMapExperience } from '../src/domain/mapExperienceAuthority';

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

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\nmap-command-center-shell-regression\n');

  const app = read('App.tsx');
  const mapScreen = read('src/screens/MapScreen.tsx');
  const shell = read('src/components/map/commandCenter/MapCommandCenterShell.tsx');
  const rail = read('src/components/map/commandCenter/MapCommandRail.tsx');
  const inspector = read('src/components/map/commandCenter/MapContextualInspector.tsx');
  const kpi = read('src/components/map/commandCenter/MapBottomKpiBar.tsx');
  const canvas = read('src/components/map/WorldMapCanvas.tsx');
  const management = read('src/components/management/ManagementPanel.tsx');
  const lifecycle = read('src/hooks/useNativeAppLifecycle.ts');
  const saveGame = read('src/storage/saveGame.ts');
  const shellDir = path.join(ROOT, 'src/components/map/commandCenter');
  const shellSources = fs
    .readdirSync(shellDir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => fs.readFileSync(path.join(shellDir, name), 'utf8'))
    .join('\n');

  assert(mapScreen.includes('MapCommandCenterShell'), '1. Harita renders the command center shell');
  assert(app.includes("activeTab !== 'map'"), '2. GameTabBar is skipped while Harita is active');
  assert(app.includes('<GameTabBar'), '3. GameTabBar remains for non-map tabs');
  assert(!app.includes('onTouchStart'), '12. App root has no per-touch handler');

  const labels = MAP_COMMAND_MODE_DEFINITIONS.map((item) => item.label);
  assert(
    ['Genel', 'Filo', 'İşler', 'Depolar', 'Pazar'].every((label) => labels.includes(label)),
    '4. command rail defines Overview/Filo/İşler/Depolar/Pazar',
  );
  assert(rail.includes('MAP_COMMAND_MODE_DEFINITIONS'), '4b. rail renders the mode definitions');

  const road = getMapCommandModeDefinition('road');
  const railMode = getMapCommandModeDefinition('rail');
  const sea = getMapCommandModeDefinition('sea');
  const air = getMapCommandModeDefinition('air');
  assert(road.mode === 'road' && road.availability === 'active', '5. ROAD state exists');
  assert(railMode.mode === 'rail' && railMode.availability === 'foundation', '6. RAIL foundation state exists');
  assert(railMode.productionEnabled === false, '6b. RAIL is not production-enabled');
  assert(sea.productionEnabled === false && sea.availability === 'locked', '7. SEA is not production-enabled');
  assert(air.productionEnabled === false && air.availability === 'locked', '7b. AIR is not production-enabled');

  assert(inspector.includes('MapContextualInspector') || inspector.includes('function MapContextualInspector'), '8. inspector shell exists');
  assert(inspector.includes('OVERVIEW') && inspector.includes('NONE'), '8b. inspector supports NONE and OVERVIEW');
  assert(kpi.includes('MapBottomKpiBar') || kpi.includes('function MapBottomKpiBar'), '9. KPI shell exists');
  assert(mapScreen.includes('<WorldMapCanvas'), '10. legacy fallback still hosts WorldMapCanvas');
  assert(canvas.includes('InteractiveTurkeyMap'), '10b. legacy renderer still owns gestures');
  // SUPERSEDED MAP-02B: the old MapScreen import ban is replaced by the profile resolver.
  assert(resolveMapExperience({ profile: 'production' }) === 'LEGACY_MAP', '10c. superseded import ban: production profile stays LEGACY_MAP');
  assert(resolveMapExperience({ profile: 'store' }) === 'LEGACY_MAP', '10c2. store profile stays LEGACY_MAP');
  assert(resolveMapExperience({ profile: 'internal' }) === 'MAP_V2', '10c3. internal Harita may use MAP_V2');
  assert(mapScreen.includes('<MapV2CommandCenterViewport'), '10d. internal path hosts the shared Map V2 viewport');
  assert(mapScreen.includes("mapExperience === 'MAP_V2'"), '10e. only one renderer branch is mounted');

  assert(mapScreen.includes('pointerEvents="none"'), '11. status toast cannot steal touches');
  assert(rail.includes('pointerEvents="none"'), '11b. rail decoration cannot steal touches');
  assert(shell.includes('pointerEvents="auto"'), '11c. map slot keeps pointer events');
  assert(inspector.includes("if (panel === 'NONE')"), '11d. empty inspector is not mounted');

  assert(!lifecycle.includes('onTouchStart'), '12b. immersive refresh is not bound to touch');
  assert(lifecycle.includes('enableImmersiveGameMode()'), '12c. immersive mode stays lifecycle-based');

  assert(management.includes("'portrait'"), '13. ManagementPanel keeps portrait modal support');
  assert(management.includes("'portrait-upside-down'"), '13b. ManagementPanel keeps upside-down support');
  assert(management.includes("'landscape-left'"), '13c. ManagementPanel keeps landscape-left');
  assert(management.includes("'landscape-right'"), '13d. ManagementPanel keeps landscape-right');

  assert(resolveMapCommandMode('not-a-mode') === 'overview', '14. unknown mode falls back to overview');
  assert(resolveMapCommandMode('sea') === 'overview', '14b. locked SEA cannot become the active mode');
  assert(resolveMapCommandMode('air') === 'overview', '14c. locked AIR cannot become the active mode');
  assert(inspectorPanelForMode('overview') === 'OVERVIEW', '14d. overview inspector panel');
  assert(inspectorPanelForMode('sea') === 'OVERVIEW', '14e. locked mode does not open a fake panel');

  assert(mapScreen.includes("useState<MapCommandMode>('overview')"), '15. map mode is local component state');
  assert(!saveGame.includes('MapCommandMode'), '15b. map UI mode is not in the player save');
  assert(!shellSources.includes('saveGame'), '15c. shell does not write the save');

  const authorityImports = [
    'data/routes',
    'settleDelivery',
    'acceptContract',
    'canonicalRoadCash',
    'gameStore.setState',
  ];
  for (const token of authorityImports) {
    assert(!shellSources.includes(token), `16. shell does not reference ${token}`);
  }
  assert(!mapScreen.includes('data/routes'), '16b. Harita screen does not import route authority');

  const compact = resolveMapChrome(resolveMapLayoutBand(640));
  const regular = resolveMapChrome(resolveMapLayoutBand(874));
  const wide = resolveMapChrome(resolveMapLayoutBand(1200));
  assert(compact.inspectorMode === 'docked' && compact.showRailLabels === false, 'compact chrome docks a collapsible inspector');
  assert(regular.inspectorMode === 'docked' && regular.showRailLabels, 'regular chrome docks the inspector');
  assert(wide.inspectorMode === 'docked' && wide.inspectorWidth > regular.inspectorWidth, 'wide chrome keeps a fixed inspector');

  const telemetry = buildMapCommandTelemetry({
    activeDeliveries: 2,
    vehiclesOnRoad: -1,
    availableVehicles: Number.NaN,
    warehouseCount: 3.8,
  });
  assert(telemetry.vehiclesOnRoad === 0 && telemetry.availableVehicles === 0, 'telemetry rejects invalid counts');
  assert(telemetry.activeDeliveries === 2 && telemetry.warehouseCount === 3, 'telemetry keeps finite counts');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
