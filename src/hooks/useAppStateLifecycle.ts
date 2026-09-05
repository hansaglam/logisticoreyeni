import { useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';

import { maybeSubmitLeaderboardForSeasonChange } from '../services/leaderboardSeasonSync';
import {
  reconcileVehicleMarketplaceOnForeground,
  retryPostStartupMarketplaceReconcileIfNeeded,
} from '../services/vehicleMarketplaceStartupReconcile';
import { retryCloudSaveSyncOnForeground } from '../storage/cloudSaveSync';
import { useGameStore } from '../store/gameStore';
import { logStartupError, safeVoid } from '../utils/startupErrors';

/** Owns the single root AppState transition and background-save lifecycle. */
export function useAppStateLifecycle(): boolean {
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let pendingBackgroundSave: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const wasActive = previousState === 'active';
      const isActive = nextState === 'active';
      setIsAppActive(isActive);

      if (!wasActive && isActive) {
        try {
          const store = useGameStore.getState();
          if (!store.isGameReady) return;
          store.checkMarketPriceAlerts({ sendLocal: false });
          store.applyOfflineProgressionIfNeeded('foreground');
          store.maybeRefreshMarketSnapshot('foreground');
          safeVoid('leaderboard-season', maybeSubmitLeaderboardForSeasonChange());
          retryPostStartupMarketplaceReconcileIfNeeded();
          safeVoid('marketplace-foreground-reconcile', reconcileVehicleMarketplaceOnForeground());
          retryCloudSaveSyncOnForeground();
        } catch (error) {
          logStartupError('appstate-foreground', error);
        }
      }

      // Preserve the iOS inactive checkpoint and flush only on true background.
      if (nextState === 'background' || nextState === 'inactive') {
        useGameStore.getState().recordLastSeenRealTimeMs();
        if (nextState === 'background') {
          pendingBackgroundSave?.cancel();
          pendingBackgroundSave = InteractionManager.runAfterInteractions(() => {
            pendingBackgroundSave = null;
            void useGameStore.getState().flushLifecycleSave('background');
          });
        }
      }
    });

    return () => {
      subscription.remove();
      pendingBackgroundSave?.cancel();
    };
  }, []);

  return isAppActive;
}
