import fs from 'node:fs';
import path from 'node:path';

import {
  ACTIVE_DELIVERY_OFFLINE_MIN_MS,
  DEFAULT_OFFLINE_MIN_MS,
} from '../src/simulation/deliveryOfflineProgress';
import { operatingCostBalance } from '../src/config/balance';

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const app = read('App.tsx');
const bootstrap = read('src/hooks/useAppBootstrap.ts');
const appState = read('src/hooks/useAppStateLifecycle.ts');
const nativeLifecycle = read('src/hooks/useNativeAppLifecycle.ts');
const postStartup = read('src/hooks/usePostStartupLifecycle.ts');
const cloudSaveSync = read('src/storage/cloudSaveSync.ts');
const lifecycleSources = [app, bootstrap, appState, nativeLifecycle, postStartup].join('\n');

assert(app.includes('useAppBootstrap()'), 'App composes the bootstrap lifecycle');
assert(app.includes('useAppStateLifecycle()'), 'App composes the AppState lifecycle');
assert(app.includes('useNativeAppLifecycle()'), 'App composes the native lifecycle');
assert(app.includes('usePostStartupLifecycle({ bootPhase, isGameReady })'), 'App composes post-startup work');
assert(!app.includes('AppState.addEventListener'), 'App has no inline AppState subscription');
assert(!app.includes('addNotificationResponseListener'), 'App has no inline notification subscription');
assert(!app.includes('initCloudSaveSync'), 'App has no inline cloud-sync bootstrap');

assert(
  (appState.match(/AppState\.addEventListener/g) ?? []).length === 1,
  'AppState lifecycle registers one root listener',
);
assert(appState.includes('subscription.remove()'), 'AppState listener has deterministic cleanup');
assert(appState.includes('pendingBackgroundSave?.cancel()'), 'deferred background save is deduplicated and cleaned');
assert(appState.includes("applyOfflineProgressionIfNeeded('foreground')"), 'foreground progression remains connected');
assert(appState.includes("flushLifecycleSave('background')"), 'background persistence remains connected');
assert(appState.includes('retryCloudSaveSyncOnForeground()'), 'cloud retry shares the root foreground transition');
assert(!cloudSaveSync.includes('AppState.addEventListener'), 'cloud sync does not register a second AppState listener');

assert(nativeLifecycle.includes('notificationSub.remove()'), 'notification response listener is cleaned');
assert(nativeLifecycle.includes('subscribeImmersiveModeRefresh()'), 'immersive refresh subscription remains active');
const coldStartProbeIndex = bootstrap.indexOf('probeSaveRecoveryOnColdStart()');
assert(
  coldStartProbeIndex >= 0 &&
    coldStartProbeIndex < bootstrap.indexOf('await startGame()', coldStartProbeIndex),
  'recovery probe precedes hydration',
);
assert(postStartup.includes("bootPhase !== 'ready'"), 'post-startup tasks wait for ready boot phase');
assert(postStartup.includes('initializeAdsPrivacyStack()'), 'existing privacy-first ads bootstrap remains canonical');
assert(
  postStartup.indexOf('await runPostStartupMarketplaceReconcile()') <
    postStartup.indexOf('await initCloudSaveSync'),
  'marketplace reconciliation still precedes cloud sync',
);

assert(ACTIVE_DELIVERY_OFFLINE_MIN_MS === 15_000, 'active delivery threshold stays 15 seconds');
assert(DEFAULT_OFFLINE_MIN_MS === 5 * 60_000, 'idle threshold stays 5 minutes');
assert(operatingCostBalance.maxOfflineChargeDays === 0, 'offline fixed operating costs stay disabled');

assert(!lifecycleSources.includes('expo-tracking-transparency'), 'lifecycle extraction does not add ATT');
assert(!lifecycleSources.includes('requestTrackingPermissions'), 'lifecycle extraction does not request tracking');
assert(!lifecycleSources.includes('revokeAppleSignInTokens'), 'account deletion token revocation is untouched');
assert(!lifecycleSources.includes('prepareVehicleMarketplaceAccountDeletion'), 'account deletion preparation is untouched');

console.log('[app-lifecycle-extraction-regression] PASS');
