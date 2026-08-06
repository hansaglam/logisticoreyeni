import type { GlobalEconomyLoadErrorCode } from './globalEconomyClient';
import { resolveGlobalEconomyClientState } from './globalEconomyClient';
import type { GlobalEconomySnapshot, GlobalMarketSyncStatus } from '../types/game';

export type MarketDataFailureReason =
  | 'network-unavailable'
  | 'timeout'
  | 'permission-denied'
  | 'unauthenticated'
  | 'function-unavailable'
  | 'document-missing'
  | 'malformed-response'
  | 'stale-cache-only'
  | 'unknown';

export type MarketDataState =
  | { status: 'loading' }
  | { status: 'live'; data: GlobalEconomySnapshot; syncedAt: number }
  | {
      status: 'cached';
      data: GlobalEconomySnapshot;
      cachedAt: number;
      failureReason: MarketDataFailureReason;
    }
  | { status: 'unavailable'; failureReason: MarketDataFailureReason };

export const MARKET_REFRESH_COOLDOWN_MS = 60_000;

export function classifyMarketFailureReason(
  errorCode: GlobalEconomyLoadErrorCode | null | undefined,
  isOnline: boolean | null = null,
): MarketDataFailureReason {
  if (!errorCode) {
    return 'stale-cache-only';
  }
  switch (errorCode) {
    case 'unauthenticated':
      return 'unauthenticated';
    case 'permission-denied':
      return 'permission-denied';
    case 'deadline-exceeded':
      return 'timeout';
    case 'not-found':
      return 'document-missing';
    case 'invalid-snapshot':
    case 'parse-failed':
    case 'stale-snapshot':
    case 'failed-precondition':
      return 'malformed-response';
    case 'unavailable':
      return isOnline === false ? 'network-unavailable' : 'function-unavailable';
    default:
      return 'unknown';
  }
}

export function computeMarketCacheAgeMs(
  cachedAt: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (cachedAt == null || !Number.isFinite(cachedAt)) {
    return null;
  }
  return Math.max(0, nowMs - cachedAt);
}

export function formatMarketCacheAgeLabel(
  cacheAgeMs: number | null,
): string | null {
  if (cacheAgeMs == null || !Number.isFinite(cacheAgeMs)) {
    return null;
  }
  if (cacheAgeMs < 60_000) {
    return 'az önce';
  }
  const minutes = Math.max(1, Math.round(cacheAgeMs / 60_000));
  return `${minutes} dk önce`;
}

export function shouldRefreshMarket(
  nowMs: number,
  lastAttemptMs: number | null | undefined,
  cooldownMs: number = MARKET_REFRESH_COOLDOWN_MS,
): boolean {
  if (lastAttemptMs == null || !Number.isFinite(lastAttemptMs)) {
    return true;
  }
  return nowMs - lastAttemptMs >= cooldownMs;
}

export function resolveMarketDataState(input: {
  snapshot?: GlobalEconomySnapshot | null;
  trusted: boolean;
  syncStatus?: GlobalMarketSyncStatus | null;
  loadedAt?: number | null;
  errorCode?: GlobalEconomyLoadErrorCode | null;
  isOnline?: boolean | null;
}): MarketDataState {
  if (input.syncStatus === 'syncing' || input.syncStatus === 'idle') {
    if (input.syncStatus === 'syncing') {
      return { status: 'loading' };
    }
  }

  const clientState = resolveGlobalEconomyClientState({
    snapshot: input.snapshot,
    trusted: input.trusted,
    syncStatus: input.syncStatus,
    loadedAt: input.loadedAt,
    errorCode: input.errorCode,
  });

  const failureReason = classifyMarketFailureReason(
    clientState.errorCode,
    input.isOnline ?? null,
  );

  if (clientState.source === 'live' && clientState.snapshot) {
    const syncedAt =
      clientState.loadedAt != null && Number.isFinite(clientState.loadedAt)
        ? clientState.loadedAt
        : clientState.snapshot.generatedAt;
    return {
      status: 'live',
      data: clientState.snapshot,
      syncedAt,
    };
  }

  if (clientState.source === 'cached' && clientState.snapshot) {
    const cachedAt =
      clientState.loadedAt != null && Number.isFinite(clientState.loadedAt)
        ? clientState.loadedAt
        : clientState.snapshot.generatedAt;
    return {
      status: 'cached',
      data: clientState.snapshot,
      cachedAt,
      failureReason,
    };
  }

  return {
    status: 'unavailable',
    failureReason,
  };
}

export function getCachedBannerTitle(
  failureReason: MarketDataFailureReason,
): string {
  if (failureReason === 'network-unavailable') {
    return 'Çevrimdışı piyasa verisi';
  }
  return 'Son kayıtlı piyasa verileri';
}

export function getCachedBannerMessage(
  failureReason: MarketDataFailureReason,
  cacheAgeLabel: string | null,
): string {
  if (failureReason === 'network-unavailable') {
    const suffix = cacheAgeLabel ? ` Son senkronizasyon: ${cacheAgeLabel}.` : '';
    return `İnternet bağlantısı yok. Son kayıtlı veriler gösteriliyor.${suffix}`;
  }
  const suffix = cacheAgeLabel ? ` Son senkronizasyon: ${cacheAgeLabel}.` : '';
  return `Canlı piyasa verisine şu anda ulaşılamıyor.${suffix}`;
}

export interface MarketSyncLogPayload {
  stage: string;
  source?: string | null;
  platform?: string;
  status: 'success' | 'failure' | 'skipped';
  failureReason?: MarketDataFailureReason | GlobalEconomyLoadErrorCode | null;
  cacheAgeMs?: number | null;
  hasCachedData?: boolean;
  authReady?: boolean;
  isOnline?: boolean | null;
}

export function logMarketSync(payload: MarketSyncLogPayload): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    if (process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED !== 'true') {
      return;
    }
  }
  console.log('[market-sync]', {
    stage: payload.stage,
    source: payload.source ?? null,
    platform: payload.platform ?? 'shared',
    status: payload.status,
    failureReason: payload.failureReason ?? null,
    cacheAgeMs: payload.cacheAgeMs ?? null,
    hasCachedData: payload.hasCachedData ?? null,
    authReady: payload.authReady ?? null,
    isOnline: payload.isOnline ?? null,
  });
}
