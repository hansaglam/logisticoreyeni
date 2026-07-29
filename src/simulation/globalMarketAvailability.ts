import { ECONOMY_CONFIG_VERSION } from './economyClock';
import type {
  GlobalEconomySnapshot,
  GlobalMarketSyncStatus,
} from '../types/game';

export const SUPPORTED_GLOBAL_SNAPSHOT_VERSION = 2;

export function isSupportedGlobalEconomySnapshot(
  snapshot: GlobalEconomySnapshot | null | undefined,
): snapshot is GlobalEconomySnapshot {
  return (
    !!snapshot &&
    snapshot.version === SUPPORTED_GLOBAL_SNAPSHOT_VERSION &&
    snapshot.configVersion === ECONOMY_CONFIG_VERSION
  );
}

export function resolveGlobalMarketAvailability(input: {
  snapshot?: GlobalEconomySnapshot;
  trusted: boolean;
  syncStatus?: GlobalMarketSyncStatus;
  development: boolean;
}): {
  canDisplay: boolean;
  priceCriticalOperationsAllowed: boolean;
  stale: boolean;
  reason?: 'snapshot-missing' | 'unsupported-snapshot' | 'untrusted-cache' | 'offline';
} {
  if (!input.snapshot) {
    return {
      canDisplay: false,
      priceCriticalOperationsAllowed: false,
      stale: false,
      reason: 'snapshot-missing',
    };
  }
  if (!isSupportedGlobalEconomySnapshot(input.snapshot)) {
    return {
      canDisplay: false,
      priceCriticalOperationsAllowed: false,
      stale: false,
      reason: 'unsupported-snapshot',
    };
  }
  if (!input.trusted && !input.development) {
    return {
      canDisplay: false,
      priceCriticalOperationsAllowed: false,
      stale: false,
      reason: 'untrusted-cache',
    };
  }
  if (input.syncStatus !== 'online' && !input.development) {
    return {
      canDisplay: true,
      priceCriticalOperationsAllowed: false,
      stale: true,
      reason: 'offline',
    };
  }
  return {
    canDisplay: true,
    priceCriticalOperationsAllowed: true,
    stale: input.syncStatus !== 'online',
  };
}
