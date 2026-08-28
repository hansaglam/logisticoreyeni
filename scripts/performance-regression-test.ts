/**
 * Performance instrumentation regression guard.
 * Run: npx tsx scripts/performance-regression-test.ts
 */
import { readFileSync } from 'node:fs';

import {
  EMPTY_ACTIVE_DELIVERIES,
  EMPTY_MARKET_ALERTS,
  EMPTY_WORLD_EVENTS,
  selectActiveDeliveries,
  selectMarketAlerts,
  selectMissions,
  selectWorldEvents,
} from '../src/store/selectors/stableCollections';
import {
  selectCurrentTimeGameDayAnchor,
  selectCurrentTimeHour,
  selectCurrentTimeQuarterHour,
  selectCurrentTimeSixHour,
} from '../src/store/selectors/timeBuckets';

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
assert(app.includes('flushLifecycleSave'), 'background lifecycle save flush');

assert(save.includes('logPerfSave'), 'saveGameState instruments serialize/checksum/write');
assert(save.includes('inFlightSaveWrite'), 'storage write single-flight');
assert(save.includes('sealSavePayloadIntegrity'), 'integrity seal on save');
assert(saveRevision.includes('getCachedIntegrityChecksum'), 'revision-based checksum cache');
assert(saveIntegrity.includes('preparePayloadForChecksumShallow'), 'shallow checksum path');

assert(!account.includes('useGameStore()'), 'AccountCenter avoids whole-store subscription');
assert(contracts.includes('selectCurrentTimeQuarterHour'), 'Contracts quantizes preview time');
assert(tutorial.includes('if (!APP_TUTORIALS_ENABLED)'), 'tutorial hook no-op when globally disabled');
assert(mapPreload.includes('preloadMapAssets'), 'shared map preload helper');

assert(gameStore.includes('canSkipContractScheduleTick'), 'contract schedule no-op fast path');
assert(gameStore.includes('probeSaveRecoveryOnColdStart'), 'cold start uses local recovery probe');
assert(
  gameStore.includes("refreshMarketSnapshot({ includeHistory: false })"),
  'post-render market refresh skips 3000-doc history',
);
assert(
  !gameStore.includes('await get().refreshMarketSnapshot();'),
  'initializeGame does not await live market snapshot',
);
assert(app.includes('Local-first'), 'App boot is local-first');
assert(app.includes('markStartup'), 'startup timing marks wired');
assert(gameStore.includes('scheduleDeferredTimeTickSave'), 'time_tick save defer helper');
assert(gameStore.includes('flushLifecycleSave'), 'lifecycle-critical save flush');
assert(gameStore.includes('AUTO_SAVE_MAX_DEFER_MS'), 'deferred save max wait');
assert(save.includes('persistLocalSavePayload'), 'single stringify save write');
assert(save.includes('computeChecksumFromPreparedPayload'), 'checksum avoids deep clone');

assert(gameStore.includes("measureSyncTask('advanceTime'"), 'game loop tick instrumented');
assert(gameStore.includes('logPerfAdvanceTimeStage'), 'advanceTime stage timing');
assert(gameStore.includes('bumpSaveContentRevision'), 'save revision bumps on first dirty');
assert(gameStore.includes('if (saveDirty)'), 'markSaveDirty no-op when already dirty');
assert(gameStore.includes('isNavigationInteractionActive()'), 'time_tick save defers during navigation');
assert(more.includes('lazy(() => import'), 'More screen lazy-loads embedded routes');
assert(more.includes('isActive'), 'More screen respects tab visibility');

assert(read('src/screens/DashboardScreen.tsx').includes('useScreenRenderProfiler'), 'Dashboard render profiler');
assert(read('src/screens/MapScreen.tsx').includes('useScreenRenderProfiler'), 'Map render profiler');
assert(read('src/screens/MarketScreen.tsx').includes('marketGameDayAnchor'), 'Market uses game-day trend anchor');

assert(
  selectActiveDeliveries({ activeDeliveries: undefined }) === EMPTY_ACTIVE_DELIVERIES,
  'selectActiveDeliveries returns stable empty fallback',
);
assert(
  selectWorldEvents({ worldEvents: undefined }) === EMPTY_WORLD_EVENTS,
  'selectWorldEvents returns stable empty fallback',
);
assert(
  selectMarketAlerts({ marketAlerts: undefined }) === EMPTY_MARKET_ALERTS,
  'selectMarketAlerts returns stable empty fallback',
);
assert(
  selectMissions({ missions: undefined }).activeMissionIds.length > 0,
  'selectMissions returns stable default missions state',
);
assert(selectCurrentTimeQuarterHour({ currentTime: 10.3 }) === 10.25, 'quarter-hour time bucket');
assert(selectCurrentTimeHour({ currentTime: 10.9 }) === 10, 'hour time bucket');
assert(selectCurrentTimeSixHour({ currentTime: 13 }) === 12, 'six-hour time bucket');
assert(selectCurrentTimeGameDayAnchor({ currentTime: 30 }) === 24, 'game-day time anchor');

const dashboard = read('src/screens/DashboardScreen.tsx');
const contractsScreen = read('src/screens/ContractsScreen.tsx');
const marketScreen = read('src/screens/MarketScreen.tsx');
assert(dashboard.includes('selectCurrentTimeHour'), 'Dashboard buckets currentTime to hour');
assert(!dashboard.includes('state.currentTime)'), 'Dashboard avoids raw currentTime subscription');
assert(contractsScreen.includes('selectCurrentTimeQuarterHour'), 'Contracts uses shared quarter-hour bucket');
assert(contractsScreen.includes('selectPlayerTrucks'), 'Contracts uses field-level truck selector');
assert(marketScreen.includes('selectCities'), 'Market uses stable city selector');
assert(marketScreen.includes('selectMarketAlerts'), 'Market uses stable market alert selector');
assert(read('src/screens/VehicleMarketplaceScreen.tsx').includes('isActive'), 'Vehicle marketplace respects tab visibility');

const contractIndex = read('src/simulation/contractGenerationIndex.ts');
const contractsSim = read('src/simulation/contracts.ts');
assert(contractIndex.includes('lookupRouteBetweenCities'), 'contract route index module exists');
assert(contractIndex.includes('buildAvailableDuplicateIndex'), 'available duplicate index exists');
assert(contractsSim.includes('buildCityProductEconomyIndex'), 'generation uses economy index');
assert(contractsSim.includes('getAvailableDuplicateCount'), 'generation uses duplicate index lookup');
assert(!contractsSim.includes('pendingContracts = [\n          ...existingContracts.filter'), 'generation avoids per-candidate pending list rebuild');

console.log('\nperformance-regression-test: PASSED\n');
