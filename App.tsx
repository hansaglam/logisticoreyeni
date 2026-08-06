/**
 * LogistiCore - Uygulama Girişi ve Sekme (Tab) Navigasyonu
 *
 * Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun, Dashboard açılır.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { AppSafeAreaProvider } from './src/components/AppSafeAreaProvider';
import { AppDialogProvider } from './src/components/AppDialogProvider';
import GameTabBar from './src/components/navigation/GameTabBar';
import GameToast from './src/components/GameToast';
import type { TabDefinition, TabKey } from './src/navigation/tabTypes';
import type { QuickAccessAction } from './src/navigation/quickAccessTypes';
import TutorialOverlay from './src/components/tutorial/TutorialOverlay';
import { ENABLE_SPOTLIGHT_TUTORIAL } from './src/tutorial/featureFlags';
import { useGameLoop } from './src/hooks/useGameLoop';
import { useSpotlightTutorialTriggers } from './src/hooks/useSpotlightTutorialTriggers';
import { useSpotlightTutorialStore } from './src/store/spotlightTutorialStore';
import { useGameStore } from './src/store/gameStore';
import {
  addNotificationResponseListener,
  getMarketAlertFocusFromResponse,
  isFleetRentalNotificationResponse,
  setupNotificationHandler,
} from './src/services/notifications';
import { initAnonymousAuth } from './src/services/authService';
import { configureGoogleSignIn } from './src/services/googleAuthService';
import { gatherAdsConsentIfNeeded } from './src/services/adsConsentService';
import { initializeAdProvider } from './src/services/adProvider';
import {
  probeSaveRecoveryOnColdStart,
  type SaveRecoveryProbeResult,
} from './src/services/saveRecoveryService';
import SaveRecoveryScreen from './src/screens/SaveRecoveryScreen';
import { logProductionBuildConfigOnce } from './src/services/productionBuildAudit';
import { initCloudSaveSync } from './src/storage/cloudSaveSync';
import type { ProductId } from './src/types/game';
import {
  enableImmersiveGameMode,
  subscribeImmersiveModeRefresh,
} from './src/utils/systemBars';

import DashboardScreen from './src/screens/DashboardScreen';
import MapScreen from './src/screens/MapScreen';
import ContractsScreen from './src/screens/ContractsScreen';
import FleetScreen from './src/screens/FleetScreen';
import ShopScreen from './src/screens/ShopScreen';
import MarketScreen from './src/screens/MarketScreen';
import MoreScreen from './src/screens/MoreScreen';
import VehicleMarketplaceScreen from './src/screens/VehicleMarketplaceScreen';
import OfflineProgressSummaryModal from './src/components/offline/OfflineProgressSummaryModal';
import ScreenErrorBoundary from './src/components/ScreenErrorBoundary';
import DeliveryIncidentModal from './src/components/delivery/DeliveryIncidentModal';
import { UI } from './src/theme/ui';

const MAIN_TABS: TabDefinition[] = [
  { key: 'dashboard', label: 'Ana', icon: 'dashboard' },
  { key: 'map', label: 'Harita', icon: 'map' },
  { key: 'contracts', label: 'İşler', icon: 'contract' },
  { key: 'market', label: 'Piyasa', icon: 'market' },
];

function renderActiveScreen(
  tab: TabKey,
  onNavigate: (tab: TabKey) => void,
  onOpenWarehouse: () => void,
): React.ReactElement {
  switch (tab) {
    case 'dashboard':
      return <DashboardScreen onNavigate={onNavigate} onOpenWarehouse={onOpenWarehouse} />;
    case 'map':
      return <MapScreen onOpenContracts={() => onNavigate('contracts')} />;
    case 'contracts':
      return <ContractsScreen />;
    case 'fleet':
      return <FleetScreen />;
    case 'shop':
      return <ShopScreen />;
    case 'market':
      return <MarketScreen onOpenContracts={() => onNavigate('contracts')} />;
    case 'vehicleMarketplace':
      return (
        <VehicleMarketplaceScreen
          onBack={() => onNavigate('dashboard')}
        />
      );
    case 'more':
      return <MoreScreen />;
    default:
      return <DashboardScreen onNavigate={onNavigate} onOpenWarehouse={onOpenWarehouse} />;
  }
}

const TAB_PERFORMANCE_LOG_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true';

function readPerformanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function ActiveScreenFrame({
  tab,
  transition,
  children,
}: {
  tab: TabKey;
  transition: React.MutableRefObject<{ from: TabKey; to: TabKey; startedAt: number } | null>;
  children: React.ReactNode;
}) {
  const renderCount = useRef(0);
  renderCount.current += 1;

  useLayoutEffect(() => {
    const pending = transition.current;
    if (!pending || pending.to !== tab) return;
    const transitionMs = Math.max(0, readPerformanceNow() - pending.startedAt);
    if (TAB_PERFORMANCE_LOG_ENABLED) {
      console.log('[tab-transition-performance]', {
        from: pending.from,
        to: pending.to,
        transitionMs: Math.round(transitionMs * 10) / 10,
        targetRenderCount: renderCount.current,
        heavySelectorCount: 0,
        mountedScreens: [tab],
        jsThreadBlockedMs: Math.max(0, Math.round((transitionMs - 16.7) * 10) / 10),
      });
    }
    transition.current = null;
  }, [tab, transition]);

  return <View style={styles.screenContainer}>{children}</View>;
}

function AppShell({ isAppActive }: { isAppActive: boolean }) {
  useGameLoop(isAppActive);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const transitionRef = useRef<{ from: TabKey; to: TabKey; startedAt: number } | null>(null);
  const isGameReady = useGameStore((state) => state.isGameReady);
  const navigationRequest = useGameStore((state) => state.navigationRequest);
  const clearNavigationRequest = useGameStore((state) => state.clearNavigationRequest);
  const pendingOfflineProgressSummary = useGameStore((state) => state.pendingOfflineProgressSummary);
  const dismissOfflineProgressSummary = useGameStore((state) => state.dismissOfflineProgressSummary);
  const pendingIncidentDeliveryId = useGameStore((state) =>
    state.activeDeliveries.find(
      (delivery) =>
        delivery.incident?.status === 'pending' && delivery.incidentResolved !== true,
    )?.id,
  );

  useSpotlightTutorialTriggers({ activeTab, isGameReady });

  useEffect(() => {
    if (!ENABLE_SPOTLIGHT_TUTORIAL) {
      return;
    }
    useSpotlightTutorialStore.getState().setTabNavigator(setActiveTab);
    return () => {
      useSpotlightTutorialStore.getState().setTabNavigator(null);
    };
  }, []);

  const handleTabPress = useCallback((nextTab: TabKey) => {
    if (nextTab === activeTab) return;
    transitionRef.current = { from: activeTab, to: nextTab, startedAt: readPerformanceNow() };
    setActiveTab(nextTab);
  }, [activeTab]);

  const handleOpenWarehouse = useCallback(() => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
  }, []);

  const handleQuickAccess = (action: QuickAccessAction) => {
    switch (action) {
      case 'fleet':
        handleTabPress('fleet');
        break;
      case 'shop':
        handleTabPress('shop');
        break;
      case 'warehouse':
        handleOpenWarehouse();
        break;
      case 'finance':
        useGameStore.setState({
          navigationRequest: { tab: 'more' },
          pendingMoreSubRoute: 'finance',
        });
        break;
      case 'missions':
        useGameStore.setState({
          navigationRequest: { tab: 'more' },
          pendingMoreSubRoute: 'missions',
        });
        break;
      case 'vehicleMarketplace':
        handleTabPress('vehicleMarketplace');
        break;
      case 'leaderboard':
        useGameStore.setState({
          navigationRequest: { tab: 'more' },
          pendingMoreSubRoute: 'leaderboard',
        });
        break;
      case 'settings':
        handleTabPress('more');
        break;
      case 'account':
        useGameStore.setState({
          navigationRequest: { tab: 'more' },
          pendingMoreSubRoute: 'account',
        });
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!navigationRequest) return;
    handleTabPress(navigationRequest.tab);
    clearNavigationRequest();
  }, [navigationRequest, clearNavigationRequest, handleTabPress]);

  return (
    <View
      style={styles.root}
      onTouchStart={() => {
        if (Platform.OS === 'android') {
          void enableImmersiveGameMode();
        }
      }}
    >
      <StatusBar hidden />
      <ActiveScreenFrame tab={activeTab} transition={transitionRef}>
        <ScreenErrorBoundary key={activeTab} screenName={activeTab}>
          {renderActiveScreen(activeTab, handleTabPress, handleOpenWarehouse)}
        </ScreenErrorBoundary>
      </ActiveScreenFrame>
      <GameToast />
      <OfflineProgressSummaryModal
        visible={pendingOfflineProgressSummary != null}
        summary={pendingOfflineProgressSummary}
        onDismiss={dismissOfflineProgressSummary}
      />
      <DeliveryIncidentModal
        pendingDeliveryId={pendingIncidentDeliveryId}
        enabled={activeTab === 'dashboard' && pendingOfflineProgressSummary == null}
      />
      {ENABLE_SPOTLIGHT_TUTORIAL ? <TutorialOverlay layer="root" /> : null}
      <GameTabBar
        tabs={MAIN_TABS}
        activeTab={activeTab}
        onTabPress={handleTabPress}
        onQuickAccess={handleQuickAccess}
      />
    </View>
  );
}

function GameLoadingScreen() {
  return (
    <View style={styles.loadingRoot}>
      <ActivityIndicator size="large" color={UI.colors.primary} />
      <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
    </View>
  );
}

export default function App() {
  const isGameReady = useGameStore((state) => state.isGameReady);
  const [bootPhase, setBootPhase] = useState<'loading' | 'recovery' | 'ready'>('loading');
  const [recoveryProbe, setRecoveryProbe] = useState<SaveRecoveryProbeResult | null>(null);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const appStateRef = useRef(AppState.currentState);

  const startGame = useCallback(async () => {
    await useGameStore.getState().initializeGame();
    setBootPhase('ready');
  }, []);

  const handleRecoveryComplete = useCallback(() => {
    void (async () => {
      const probe = await probeSaveRecoveryOnColdStart();
      if (probe.required && !probe.quarantine?.userChoseNewGame) {
        setRecoveryProbe(probe);
        setBootPhase('recovery');
        return;
      }
      await startGame();
    })();
  }, [startGame]);

  useEffect(() => {
    void enableImmersiveGameMode();
    const unsubscribeImmersive = subscribeImmersiveModeRefresh();
    void (async () => {
      await gatherAdsConsentIfNeeded();
      await initializeAdProvider();
    })();
    return () => {
      unsubscribeImmersive();
    };
  }, []);

  useEffect(() => {
    // Auth sırası (paralel değil):
    // Firebase/Auth initialize → onAuthStateChanged initial →
    // signInAnonymously (gerekirse) → auth ready → initializeGame →
    // globalEconomy/current read.
    let cancelled = false;
    void (async () => {
      configureGoogleSignIn();
      await initAnonymousAuth();
      if (cancelled) return;
      logProductionBuildConfigOnce();
      const probe = await probeSaveRecoveryOnColdStart();
      if (cancelled) return;
      if (probe.required && !probe.quarantine?.userChoseNewGame) {
        setRecoveryProbe(probe);
        setBootPhase('recovery');
        return;
      }
      await startGame();
    })();

    setupNotificationHandler();
    const notificationSub = addNotificationResponseListener((response) => {
      if (isFleetRentalNotificationResponse(response)) {
        useGameStore.setState({ navigationRequest: { tab: 'fleet' } });
        return;
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

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const wasActive = previousState === 'active';
      const isActive = nextState === 'active';
      setIsAppActive(isActive);

      if (!wasActive && isActive) {
        useGameStore.getState().checkMarketPriceAlerts({ sendLocal: false });
        useGameStore.getState().applyOfflineProgressionIfNeeded('foreground');
        useGameStore.getState().maybeRefreshMarketSnapshot('foreground');
      }
      if (wasActive && !isActive) {
        useGameStore.getState().recordLastSeenRealTimeMs();
        void useGameStore.getState().saveGame();
      }
    });

    return () => {
      cancelled = true;
      notificationSub.remove();
      subscription.remove();
    };
  }, [startGame]);

  useEffect(() => {
    if (!isGameReady || bootPhase !== 'ready') {
      return;
    }

    void initCloudSaveSync(() => useGameStore.getState());
  }, [bootPhase, isGameReady]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <AppSafeAreaProvider>
        <AppDialogProvider>
          {bootPhase === 'recovery' && recoveryProbe ? (
            <SaveRecoveryScreen probe={recoveryProbe} onRecoveryComplete={handleRecoveryComplete} />
          ) : bootPhase === 'ready' && isGameReady ? (
            <AppShell isAppActive={isAppActive} />
          ) : (
            <GameLoadingScreen />
          )}
        </AppDialogProvider>
      </AppSafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.colors.background,
  },
  screenContainer: {
    flex: 1,
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: UI.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: UI.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
