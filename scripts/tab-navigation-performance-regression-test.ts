/** Static/runtime-safe navigation performance regression guard. */
import './test-globals';

import { readFileSync } from 'node:fs';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1;
}

console.log('\n=== tab-navigation-performance-regression-test ===\n');

const app = `${readFileSync('App.tsx', 'utf8')}\n${readFileSync('src/hooks/useAppStateLifecycle.ts', 'utf8')}`;
const gameLoop = readFileSync('src/hooks/useGameLoop.ts', 'utf8');
const tabBar = readFileSync('src/components/navigation/GameTabBar.tsx', 'utf8');
const market = readFileSync('src/screens/MarketScreen.tsx', 'utf8');
const fleet = readFileSync('src/screens/FleetScreen.tsx', 'utf8');
const contracts = readFileSync('src/screens/ContractsScreen.tsx', 'utf8');

for (const route of ['dashboard', 'map', 'contracts', 'fleet', 'shop', 'market', 'more']) {
  assert(app.includes(`case '${route}'`), `${route} navigation route’u bağlı`);
}
assert(app.includes('[tab-transition-performance]'), 'tab transition instrumentation mevcut');
assert(app.includes('[perf-navigation]') || app.includes('beginPerfNavigation'), 'perf-navigation instrumentation mevcut');
assert(app.includes('startTransition'), 'tab switch concurrent transition kullanır');
assert(app.includes('ScreenErrorBoundary'), 'ağır ekranlar screen-level error boundary ile korunur');
assert(app.includes("applyOfflineProgressionIfNeeded('foreground')"), 'foreground catch-up route’u bağlı');
assert(app.includes("nextState === 'background' || nextState === 'inactive'"), 'active → inactive lifecycle checkpoint işlenir');

assert(occurrences(app, "AppState.addEventListener('change'") === 1, 'App lifecycle listener tek instance');
assert(occurrences(gameLoop, 'setInterval(') === 1, 'game loop timer tek instance');
assert(gameLoop.includes('clearInterval(intervalId)'), 'game loop timer cleanup mevcut');
assert(gameLoop.includes('!isAppActive'), 'inactive app game loop’u çalıştırmaz');

assert(!market.includes('useGameStore((state) => state.player);'), 'Market tüm player object’ine subscribe olmaz');
assert(!fleet.includes('useGameStore((state) => state.player);'), 'Filo tüm player object’ine subscribe olmaz');
assert(tabBar.includes('eligibilitySignature'), 'tab badge ağır hesabı stabil eligibility imzasına bağlı');
assert(tabBar.includes('useGameStore.getState()'), 'badge hesabı yalnız imza değişince store snapshot okur');
assert(contracts.includes('previewTruckKey'), 'İşler preview hesabı aktif araç ticklerinden izole');
assert(contracts.includes('previewDriverKey'), 'İşler preview hesabı stabil driver imzasına bağlı');
assert(market.includes("activeTab !== 'opportunities'"), 'Piyasa fırsat hesabı yalnız ilgili sekmede çalışır');

const broadSelectorPattern = /useGameStore\(\s*\([^)]*\)\s*=>\s*(?:state|s)\s*\)/;
for (const [name, source] of [
  ['App', app],
  ['GameTabBar', tabBar],
  ['Market', market],
  ['Fleet', fleet],
  ['Contracts', contracts],
] as const) {
  assert(!broadSelectorPattern.test(source), `${name} bütün store’a subscribe olmuyor`);
}

console.log('\nManual device matrix: 50 hızlı geçiş; Ana↔Harita 10x; İşler↔Piyasa 10x; Filo 10x; background/foreground 10x; 30 dk oturum.');
console.log('tab-navigation-performance-regression-test: PASSED');
