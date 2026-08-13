/**
 * Performance instrumentation regression guard.
 * Run: npx tsx scripts/performance-regression-test.ts
 */
import { readFileSync } from 'node:fs';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

const read = (path: string) => readFileSync(path, 'utf8');

console.log('\n=== performance-regression-test ===\n');

const app = read('App.tsx');
const perf = read('src/utils/performanceDiagnostics.ts');
const save = read('src/storage/saveGame.ts');
const saveRevision = read('src/storage/saveRevision.ts');
const account = read('src/screens/AccountCenterScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const tutorial = read('src/hooks/useScreenAppTutorial.ts');
const mapPreload = read('src/utils/mapAssetPreload.ts');
const gameStore = read('src/store/gameStore.ts');
const more = read('src/screens/MoreScreen.tsx');
const saveIntegrity = read('src/utils/saveIntegrity.ts');

assert(perf.includes('[perf-navigation]'), 'navigation perf log format');
assert(perf.includes('[perf-long-task]'), 'long task detector');
assert(perf.includes('[perf-save]'), 'save perf log format');
assert(perf.includes('[perf-advance-time]'), 'advanceTime stage profiler');
assert(perf.includes('[perf-collision]'), 'perf collision logger');
assert(perf.includes('[perf-render-storm]') || read('src/hooks/useScreenRenderProfiler.ts').includes('[perf-render-storm]'), 'render storm profiler');

assert(app.includes('startTransition'), 'tab switch uses concurrent transition');
assert(app.includes('beginPerfNavigation'), 'navigation press timing');
assert(app.includes('beginNavigationInteraction'), 'navigation interaction window');
assert(app.includes('TAB_KEEP_ALIVE'), 'lightweight tab keep-alive cache');
assert(app.includes('preloadMapAssets'), 'map asset boot preload');
assert(app.includes('InteractionManager.runAfterInteractions'), 'background save deferred');

assert(save.includes('logPerfSave'), 'saveGameState instruments serialize/checksum/write');
assert(save.includes('inFlightSaveWrite'), 'storage write single-flight');
assert(save.includes('sealSavePayloadIntegrity'), 'integrity seal on save');
assert(saveRevision.includes('getCachedIntegrityChecksum'), 'revision-based checksum cache');
assert(saveIntegrity.includes('preparePayloadForChecksumShallow'), 'shallow checksum path');

assert(!account.includes('useGameStore()'), 'AccountCenter avoids whole-store subscription');
assert(contracts.includes('Math.floor(state.currentTime * 4) / 4'), 'Contracts quantizes preview time');
assert(tutorial.includes('if (!APP_TUTORIALS_ENABLED)'), 'tutorial hook no-op when globally disabled');
assert(mapPreload.includes('preloadMapAssets'), 'shared map preload helper');

assert(gameStore.includes("measureSyncTask('advanceTime'"), 'game loop tick instrumented');
assert(gameStore.includes('logPerfAdvanceTimeStage'), 'advanceTime stage timing');
assert(gameStore.includes('bumpSaveContentRevision'), 'save revision bumps on first dirty');
assert(gameStore.includes('if (saveDirty)'), 'markSaveDirty no-op when already dirty');
assert(gameStore.includes('isNavigationInteractionActive()'), 'time_tick save defers during navigation');

assert(more.includes('lazy(() => import'), 'More screen lazy-loads embedded routes');
assert(more.includes('isActive'), 'More screen respects tab visibility');

assert(read('src/screens/DashboardScreen.tsx').includes('useScreenRenderProfiler'), 'Dashboard render profiler');
assert(read('src/screens/MapScreen.tsx').includes('useScreenRenderProfiler'), 'Map render profiler');

console.log('\nperformance-regression-test: PASSED\n');
