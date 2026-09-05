import { useEffect } from 'react';

import type { ProductId } from '../types/game';
import {
  addNotificationResponseListener,
  getGameplayNotificationOpenFromResponse,
  getMarketAlertFocusFromResponse,
  isFleetRentalNotificationResponse,
  setupNotificationHandler,
} from '../services/notifications';
import { useGameStore } from '../store/gameStore';
import { logStartupError, safeVoid } from '../utils/startupErrors';
import { markStartup } from '../utils/startupPerformance';
import {
  enableImmersiveGameMode,
  subscribeImmersiveModeRefresh,
} from '../utils/systemBars';

/** Owns app-global native UI and notification response subscriptions. */
export function useNativeAppLifecycle(): void {
  useEffect(() => {
    safeVoid('immersive-mode', enableImmersiveGameMode());
    return subscribeImmersiveModeRefresh();
  }, []);

  useEffect(() => {
    markStartup('NOTIFICATIONS_INIT_START');
    try {
      setupNotificationHandler();
    } catch (error) {
      logStartupError('notifications-init', error);
    }
    markStartup('NOTIFICATIONS_INIT_DONE');

    const notificationSub = addNotificationResponseListener((response) => {
      if (isFleetRentalNotificationResponse(response)) {
        useGameStore.setState({ navigationRequest: { tab: 'fleet' } });
        return;
      }
      const gameplayOpen = getGameplayNotificationOpenFromResponse(response);
      if (gameplayOpen?.tab) {
        if (gameplayOpen.tab === 'more' && gameplayOpen.moreSubRoute) {
          useGameStore.setState({
            navigationRequest: { tab: 'more' },
            pendingMoreSubRoute: gameplayOpen.moreSubRoute,
          });
          return;
        }
        if (
          gameplayOpen.tab === 'map' ||
          gameplayOpen.tab === 'contracts' ||
          gameplayOpen.tab === 'fleet' ||
          gameplayOpen.tab === 'dashboard' ||
          gameplayOpen.tab === 'more'
        ) {
          useGameStore.setState({ navigationRequest: { tab: gameplayOpen.tab } });
          return;
        }
      }
      const focus = getMarketAlertFocusFromResponse(response);
      if (focus) {
        useGameStore.getState().openMarketFromAlert({
          cityId: focus.cityId,
          productId: focus.productId as ProductId,
        });
      }
      useGameStore.getState().checkMarketPriceAlerts({ sendLocal: false });
    });

    return () => notificationSub.remove();
  }, []);
}
