/**
 * Market live/cache state machine regression tests.
 * Run: npx tsx scripts/market-live-cache-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  classifyMarketFailureReason,
  computeMarketCacheAgeMs,
  formatMarketCacheAgeLabel,
  getCachedBannerMessage,
  getCachedBannerTitle,
  MARKET_REFRESH_COOLDOWN_MS,
  resolveMarketDataState,
  shouldRefreshMarket,
} from '../src/services/marketDataState';
import { buildGlobalEconomySnapshot } from '../src/simulation/globalMarketSnapshot';
import { CITIES } from '../src/data/cities';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const nowMs = 1_800_000_000_000;
const snapshot = buildGlobalEconomySnapshot({ cities: CITIES, nowMs });

console.log('\n=== Market Live/Cache Regression ===\n');

console.log('State machine');
{
  const live = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'online',
    loadedAt: nowMs,
    errorCode: null,
  });
  assert(live.status === 'live', 'live fetch success → live');
  if (live.status === 'live') {
    assert(live.syncedAt === nowMs, 'live carries syncedAt');
  }

  const cached = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'offline-cache',
    loadedAt: nowMs - 17 * 60_000,
    errorCode: 'unavailable',
    isOnline: true,
  });
  assert(cached.status === 'cached', 'network failure with cache → cached');
  if (cached.status === 'cached') {
    assert(
      cached.failureReason === 'function-unavailable',
      'backend error while online is not network-unavailable',
      cached.failureReason,
    );
  }

  const offlineCached = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'offline-cache',
    loadedAt: nowMs - 5 * 60_000,
    errorCode: 'unavailable',
    isOnline: false,
  });
  assert(
    offlineCached.status === 'cached' && offlineCached.failureReason === 'network-unavailable',
    'offline device → network-unavailable',
  );

  const unavailable = resolveMarketDataState({
    snapshot: null,
    trusted: false,
    syncStatus: 'error',
    errorCode: 'not-found',
  });
  assert(unavailable.status === 'unavailable', 'no cache + failure = unavailable');

  const loading = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'syncing',
    loadedAt: nowMs,
  });
  assert(loading.status === 'loading', 'syncing → loading');
}

console.log('\nLive → cached → live transition');
{
  const afterFailure = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'offline-cache',
    loadedAt: nowMs - 60_000,
    errorCode: 'deadline-exceeded',
    isOnline: true,
  });
  assert(afterFailure.status === 'cached', 'failed fetch keeps cached data');
  if (afterFailure.status === 'cached') {
    assert(afterFailure.failureReason === 'timeout', 'deadline-exceeded classified as timeout');
  }

  const afterRefresh = resolveMarketDataState({
    snapshot,
    trusted: true,
    syncStatus: 'online',
    loadedAt: nowMs,
    errorCode: null,
  });
  assert(afterRefresh.status === 'live', 'refresh success → live (banner off)');
}

console.log('\nError classification');
{
  assert(
    classifyMarketFailureReason('permission-denied', true) === 'permission-denied',
    'permission-denied',
  );
  assert(
    classifyMarketFailureReason('unauthenticated', true) === 'unauthenticated',
    'unauthenticated',
  );
  assert(
    classifyMarketFailureReason('invalid-snapshot', true) === 'malformed-response',
    'malformed-response',
  );
  assert(
    classifyMarketFailureReason('not-found', true) === 'document-missing',
    'document-missing',
  );
}

console.log('\nCache age formatting');
{
  assert(computeMarketCacheAgeMs(nowMs - 17 * 60_000, nowMs) === 17 * 60_000, 'cache age ms');
  assert(computeMarketCacheAgeMs(nowMs + 60_000, nowMs) === 0, 'negative cache age clamped');
  assert(formatMarketCacheAgeLabel(17 * 60_000) === '17 dk önce', '17 dk önce label');
  assert(formatMarketCacheAgeLabel(30_000) === 'az önce', 'sub-minute → az önce');
  assert(formatMarketCacheAgeLabel(null) === null, 'missing cachedAt → null label');
}

console.log('\nBanner copy');
{
  assert(
    getCachedBannerTitle('network-unavailable') === 'Çevrimdışı piyasa verisi',
    'offline title uses çevrimdışı',
  );
  assert(
    getCachedBannerTitle('function-unavailable') === 'Son kayıtlı piyasa verileri',
    'backend error title avoids çevrimdışı',
  );
  const message = getCachedBannerMessage('function-unavailable', '17 dk önce');
  assert(message.includes('Canlı piyasa verisine şu anda ulaşılamıyor'), 'backend error message');
  assert(message.includes('17 dk önce'), 'message includes sync age');
}

console.log('\nRefresh cooldown + duplicate guard');
{
  const t0 = 1_000_000;
  assert(shouldRefreshMarket(t0, null), 'first refresh allowed');
  assert(
    !shouldRefreshMarket(t0 + 30_000, t0, MARKET_REFRESH_COOLDOWN_MS),
    'duplicate refresh blocked within cooldown',
  );
  assert(shouldRefreshMarket(t0 + MARKET_REFRESH_COOLDOWN_MS, t0), 'refresh allowed after cooldown');
}

console.log('\nPlatform parity + wiring');
{
  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');
  const marketScreen = readFileSync('src/screens/MarketScreen.tsx', 'utf8');
  const appTsx = `${readFileSync('App.tsx', 'utf8')}\n${readFileSync('src/hooks/useAppStateLifecycle.ts', 'utf8')}`;

  assert(gameStore.includes('maybeRefreshMarketSnapshot'), 'maybeRefreshMarketSnapshot exists');
  assert(gameStore.includes('maybeRefreshMarketHistory'), 'deferred market history refresh exists');
  assert(gameStore.includes('includeHistory: false'), 'market snapshot refresh skips inline history on open');
  assert(gameStore.includes('preserveLiveMarketSync'), 'offline progression preserves live sync');
  assert(marketScreen.includes('resolveMarketDataState'), 'MarketScreen uses canonical state');
  assert(marketScreen.includes('refreshMarketSnapshot'), 'refresh button calls real fetch');
  assert(appTsx.includes("maybeRefreshMarketSnapshot('foreground')"), 'foreground refresh wired');
  assert(!marketScreen.includes("Platform.OS === 'ios'"), 'no iOS-specific market hack');
  assert(!marketScreen.includes("Platform.OS === 'android'"), 'no Android-specific market hack');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
