/**
 * MAP-02A landscape shell geometry.
 * Run: npx tsx scripts/map-command-center-layout-regression.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { resolveMapChrome, resolveMapLayoutBand } from '../src/components/map/commandCenter/mapUiTheme';

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
  console.log('\nmap-command-center-layout-regression\n');

  const app = read('App.tsx');
  const mapScreen = read('src/screens/MapScreen.tsx');
  const shell = read('src/components/map/commandCenter/MapCommandCenterShell.tsx');
  const rail = read('src/components/map/commandCenter/MapCommandRail.tsx');
  const kpi = read('src/components/map/commandCenter/MapBottomKpiBar.tsx');
  const canvas = read('src/components/map/WorldMapCanvas.tsx');
  const turkey = read('src/components/map/InteractiveTurkeyMap.tsx');
  const shellDir = fs
    .readdirSync(path.join(ROOT, 'src/components/map/commandCenter'))
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => fs.readFileSync(path.join(ROOT, 'src/components/map/commandCenter', name), 'utf8'))
    .join('\n');

  assert(shell.includes('<MapTopStatusBar'), '1. shell renders the top status bar');
  assert(shell.includes('styles.body'), '1b. shell renders the main content row');
  assert(shell.includes('<MapBottomKpiBar'), '1c. shell renders the bottom KPI after the content row');
  assert(/body:\s*\{[^}]*flex:\s*1/s.test(shell), '2. central content row has flex:1');
  assert(/mapSlot:\s*\{[^}]*flex:\s*1/s.test(shell), '3. map viewport slot flexes');
  assert(/viewport:\s*\{[^}]*flex:\s*1/s.test(shell), '3b. map viewport flexes');
  assert(mapScreen.includes('fill'), '4. Harita asks the canvas to fill the slot');
  assert(!mapScreen.includes('MAP_VIEWPORT_HEIGHT'), '4b. Harita does not apply the portrait canvas height');
  assert(canvas.includes('fill ? filledHeight : portraitHeight'), '4c. filled canvas ignores the portrait height');
  assert(turkey.includes('viewportFill'), '4d. renderer can stretch instead of using a fixed height');
  assert(kpi.includes('flexShrink: 0'), '5. KPI strip does not grow into the map');
  assert(kpi.includes('borderTopWidth'), '5b. KPI is a bordered bottom strip');
  assert(kpi.includes('Aktif teslimat') && kpi.includes('Depo'), '5c. KPI keeps real telemetry labels');

  const phone = resolveMapLayoutBand(874);
  const phoneChrome = resolveMapChrome(phone);
  assert(phone === 'regular', '6. iPhone Pro logical landscape is regular');
  assert(phoneChrome.inspectorWidth >= 220 && phoneChrome.inspectorWidth <= 260, '6b. phone inspector width is compact');
  assert(shell.includes("useState(band !== 'compact')"), '6c. inspector opens by default outside compact');
  assert(resolveMapLayoutBand(667) === 'compact', '6d. narrow landscape can still collapse');
  assert(/rail:\s*\{[^}]*alignSelf:\s*'stretch'/s.test(rail), '7. command rail stretches to the content height');
  assert(rail.includes('flex: 1'), '7b. rail list scrolls inside the stretched rail');

  assert(mapScreen.includes('pointerEvents="none"'), '8. decorative toast cannot take touches');
  assert(shell.includes("if (panel === 'NONE'") || read('src/components/map/commandCenter/MapContextualInspector.tsx').includes("panel === 'NONE'"), '8b. empty inspector is not mounted');
  assert(!app.includes('onTouchStart'), '8c. no root per-touch immersive call');
  assert(app.includes("activeTab !== 'map'") && app.includes('<GameTabBar'), '9. GameTabBar stays hidden only on Harita');

  for (const token of ['data/routes', 'settleDelivery', 'acceptContract', 'gameStore.setState']) {
    assert(!shellDir.includes(token), `10. shell does not reference ${token}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
