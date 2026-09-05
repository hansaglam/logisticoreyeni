import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

import type { AppBootPhase } from './useAppBootstrap';
import { initializeAdsPrivacyStack } from '../services/adsPrivacyBootstrap';
import { endPostStartupMarketplaceCloudHold } from '../services/marketplaceStartupCloudHold';
import {
  flushPendingTestMoneySync,
  startTestMoneySync,
} from '../services/testMoneySyncService';
import { runPostStartupMarketplaceReconcile } from '../services/vehicleMarketplaceStartupReconcile';
import { initCloudSaveSync } from '../storage/cloudSaveSync';
import { useGameStore } from '../store/gameStore';
import { preloadMapAssets } from '../utils/mapAssetPreload';
import { logCloudSyncError, logStartupError } from '../utils/startupErrors';
import { markStartup } from '../utils/startupPerformance';

type PostStartupLifecycleOptions = {
  bootPhase: AppBootPhase;
  isGameReady: boolean;
};

/** Owns non-blocking work that may start only after local game readiness. */
export function usePostStartupLifecycle({
  bootPhase,
  isGameReady,
}: PostStartupLifecycleOptions): void {
  useEffect(() => {
    if (bootPhase !== 'ready') return;
    const handle = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        markStartup('ADS_START');
        try {
          // Platform policy remains encapsulated: Android UMP, iOS NPA without consent UI.
          await initializeAdsPrivacyStack();
        } catch (error) {
          logStartupError('ads-init', error);
        } finally {
          markStartup('ADS_DONE');
        }
      })();
    });
    return () => handle.cancel();
  }, [bootPhase]);

  useEffect(() => {
    if (!isGameReady || bootPhase !== 'ready') return;

    void (async () => {
      markStartup('MAP_PRELOAD_START');
      try {
        await preloadMapAssets();
      } catch (error) {
        logStartupError('map-preload', error);
      } finally {
        markStartup('MAP_PRELOAD_DONE');
      }
    })();

    const handle = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          await runPostStartupMarketplaceReconcile();
        } catch (error) {
          logStartupError('marketplace-startup-reconcile', error);
        }
        markStartup('CLOUD_SYNC_START');
        try {
          await initCloudSaveSync(() => useGameStore.getState());
        } catch (error) {
          logCloudSyncError(error);
        } finally {
          markStartup('CLOUD_SYNC_DONE');
          endPostStartupMarketplaceCloudHold();
        }
      })();
    });

    let stopTestMoneySync: (() => void) | undefined;
    try {
      stopTestMoneySync = startTestMoneySync();
      flushPendingTestMoneySync();
    } catch (error) {
      logStartupError('test-money-sync', error);
    }
    return () => {
      handle.cancel();
      stopTestMoneySync?.();
    };
  }, [bootPhase, isGameReady]);
}
