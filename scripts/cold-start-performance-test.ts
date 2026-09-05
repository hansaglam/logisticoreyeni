/**
 * Cold-start local-first boot wiring.
 * Run: npx tsx scripts/cold-start-performance-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

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

const app = [
  'App.tsx',
  'src/hooks/useAppBootstrap.ts',
  'src/hooks/useAppStateLifecycle.ts',
  'src/hooks/useNativeAppLifecycle.ts',
  'src/hooks/usePostStartupLifecycle.ts',
].map((file) => readFileSync(file, 'utf8')).join('\n');
const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');
const startup = readFileSync('src/utils/startupPerformance.ts', 'utf8');
const notifications = readFileSync('src/services/notifications.ts', 'utf8');
const mapPreload = readFileSync('src/utils/mapAssetPreload.ts', 'utf8');
const leaderboard = readFileSync('src/screens/LeaderboardScreen.tsx', 'utf8');
const marketplace = readFileSync('src/screens/VehicleMarketplaceScreen.tsx', 'utf8');
const cloudSync = readFileSync('src/storage/cloudSaveSync.ts', 'utf8');
const firestoreEconomy = readFileSync('src/services/firestoreGlobalEconomyRepository.ts', 'utf8');

console.log('\nInstrumentation');
{
  assert(startup.includes('APP_START'), 'APP_START mark exists');
  assert(startup.includes('GAME_READY'), 'GAME_READY mark exists');
  assert(startup.includes('FIRST_MAIN_SCREEN_RENDER'), 'first render mark exists');
  assert(startup.includes('ASYNC_STORAGE_READ_START'), 'async storage span exists');
  assert(startup.includes('JSON_PARSE_START'), 'json parse span exists');
  assert(startup.includes('STARTUP_SUMMARY'), 'startup summary log exists');
  assert(app.includes("markStartup('APP_START')"), 'App records APP_START');
  assert(app.includes("markStartup('FIRST_MAIN_SCREEN_RENDER')"), 'AppShell records first paint');
  assert(gameStore.includes("markStartup('GAME_READY')"), 'store records GAME_READY');
  assert(!gameStore.includes('getMyVehicleListings'), 'hydrate does not fetch marketplace');
  assert(app.includes('runPostStartupMarketplaceReconcile'), 'marketplace reconcile is post-ready');
  assert(gameStore.includes('flushDeferredMigratedSavePersist'), 'migrated persist is deferred');
  assert(gameStore.includes('void get().refreshSaveStatus()'), 'save status refresh is post-ready');
}

console.log('\nLocal-first boot (does not block first render)');
{
  assert(app.includes('Local-first'), 'App documents local-first boot');
  assert(app.includes('probeSaveRecoveryOnColdStart'), 'App uses local recovery probe');
  assert(gameStore.includes('probeSaveRecoveryOnColdStart'), 'initializeGame uses local probe');
  assert(
    !gameStore.includes('probeSaveRecoveryWithCloudAttempt'),
    'initializeGame does not wait on cloud recovery',
  );
  assert(
    !/await initAnonymousAuth\(\);\s*if \(cancelled\) return;\s*logProductionBuildConfigOnce/.test(app),
    'auth restore is not on the first-render critical path',
  );
  assert(
    !gameStore.includes('await get().refreshMarketSnapshot();'),
    'live market snapshot is not awaited before GAME_READY',
  );
  assert(
    gameStore.includes("refreshMarketSnapshot({ includeHistory: false })"),
    'background snapshot skips history query',
  );
  assert(
    gameStore.includes('MARKET_SNAPSHOT_FETCH_TIMEOUT_MS = 4_000'),
    'market snapshot has a 4s timeout',
  );
  assert(
    gameStore.includes('InteractionManager.runAfterInteractions'),
    'offline catch-up and market refresh run after first interactions',
  );
}

console.log('\nDeferred / lazy online systems');
{
  assert(app.includes('initCloudSaveSync'), 'cloud sync starts after game ready');
  assert(app.includes("markStartup('CLOUD_SYNC_START')"), 'cloud sync is timed after UI');
  assert(leaderboard.includes("markStartup('LEADERBOARD_INIT_START')"), 'leaderboard fetch is screen-scoped');
  assert(marketplace.includes("markStartup('MARKETPLACE_INIT_START')"), 'marketplace fetch is screen-scoped');
  assert(!gameStore.includes('fetchWeeklyLeaderboard'), 'gameStore boot does not fetch leaderboard');
  assert(
    app.includes('preloadMapAssets()') &&
      app.includes('isGameReady') &&
      app.includes("markStartup('MAP_PRELOAD_START')"),
    'map asset preload is after first render',
  );
  assert(
    app.includes('InteractionManager.runAfterInteractions') &&
      app.includes('runPostStartupMarketplaceReconcile'),
    'marketplace reconcile waits until after first interactions',
  );
  assert(app.includes('[STARTUP_ERROR]') || app.includes('logStartupError'), 'startup errors are caught');
  assert(mapPreload.includes('preloadMapAssets'), 'map preload helper still exists');
  assert(
    !app.includes('await gatherAdsConsentIfNeeded()') ||
      app.includes('initializeAdsPrivacyStack') ||
      /bootPhase !== 'ready'[\s\S]*gatherAdsConsentIfNeeded/.test(app),
    'ads consent waits until UI is ready',
  );
}

console.log('\nGuest play / network failure');
{
  assert(notifications.includes('setupNotificationHandler'), 'notification handler is local');
  assert(
    !app.includes('await requestNotificationPermissions'),
    'boot does not prompt notification permission',
  );
  assert(cloudSync.includes('await initAnonymousAuth()'), 'cloud sync still authenticates in background');
  assert(
    firestoreEconomy.includes("doc(this.firestore, 'globalEconomy', 'current')"),
    'live economy read remains a single current-doc fetch',
  );
}

console.log('\nLoading UX');
{
  assert(app.includes('Şirket hazırlanıyor'), 'loading hint has a short phase');
  assert(app.includes('Kayıt yükleniyor'), 'save-load phase copy exists');
  assert(startup.includes('Son kontroller'), 'late-phase copy exists');
  assert(!app.includes("setBootHint('Son kontroller...')"), 'boot screen is not a fake elapsed-time phase');
  assert(startup.includes('startupPhaseHint'), 'phase hint helper remains for diagnostics');
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('cold-start-performance-test: PASSED\n');
