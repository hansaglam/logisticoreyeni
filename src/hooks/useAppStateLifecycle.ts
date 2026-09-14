import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { maybeSubmitLeaderboardForSeasonChange } from '../services/leaderboardSeasonSync';
import { flushCanonicalDeliveryCompletionQueue } from '../domain/canonicalDeliveryCompletionQueue';
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
          safeVoid('canonical-delivery-flush', flushCanonicalDeliveryCompletionQueue());
        } catch (error) {
          logStartupError('appstate-foreground', error);
        }
      }

      // iOS force-quit often kills during `inactive` without reaching `background`.
      // Flush immediately (no InteractionManager defer) so mandatory tutorial + other
      // dirty progress survive termination.
      if (nextState === 'background' || nextState === 'inactive') {
        useGameStore.getState().recordLastSeenRealTimeMs();
        void useGameStore.getState().flushLifecycleSave('background');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return isAppActive;
}
