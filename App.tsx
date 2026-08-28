/**
 * LogistiCore - Uygulama Girişi ve Sekme (Tab) Navigasyonu
 *
 * Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun, Dashboard açılır.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, startTransition } from 'react';
import { ActivityIndicator, AppState, InteractionManager, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { AppSafeAreaProvider } from './src/components/AppSafeAreaProvider';
import { AppDialogProvider } from './src/components/AppDialogProvider';
import GameTabBar from './src/components/navigation/GameTabBar';
import GameToast from './src/components/GameToast';
import type { TabDefinition, TabKey } from './src/navigation/tabTypes';
import type { QuickAccessAction } from './src/navigation/quickAccessTypes';
import {
  getManagementNavigationTarget,
  resolveManagementModule,
  type ManagementModule,
} from './src/navigation/managementNavigation';
import TutorialOverlay from './src/components/tutorial/TutorialOverlay';
import { ENABLE_SPOTLIGHT_TUTORIAL } from './src/tutorial/featureFlags';
import { useGameLoop } from './src/hooks/useGameLoop';
import { maybeSubmitLeaderboardForSeasonChange } from './src/services/leaderboardSeasonSync';
import { useSpotlightTutorialTriggers } from './src/hooks/useSpotlightTutorialTriggers';
import { useSpotlightTutorialStore } from './src/store/spotlightTutorialStore';
import { useGameStore } from './src/store/gameStore';
import {
  addNotificationResponseListener,
  getGameplayNotificationOpenFromResponse,
  getMarketAlertFocusFromResponse,
  isFleetRentalNotificationResponse,
  setupNotificationHandler,
} from './src/services/notifications';
import { initAnonymousAuth } from './src/services/authService';
import { configureGoogleSignIn } from './src/services/googleAuthService';
import { initializeAdsPrivacyStack } from './src/services/adsPrivacyBootstrap';
import type { SaveRecoveryProbeResult } from './src/services/saveRecoveryService';
import SaveRecoveryScreen from './src/screens/SaveRecoveryScreen';
import { logProductionBuildConfigOnce } from './src/services/productionBuildAudit';
import { logFirebaseRuntimeConfigOnce } from './src/utils/firebaseRuntimeConfig';
import { initCloudSaveSync } from './src/storage/cloudSaveSync';
import {
  reconcileVehicleMarketplaceOnForeground,
  retryPostStartupMarketplaceReconcileIfNeeded,
  runPostStartupMarketplaceReconcile,
} from './src/services/vehicleMarketplaceStartupReconcile';
import { endPostStartupMarketplaceCloudHold } from './src/services/marketplaceStartupCloudHold';
import {
  flushPendingTestMoneySync,
  startTestMoneySync,
} from './src/services/testMoneySyncService';
import { getBuildFingerprint, logBuildFingerprintOnce } from './src/config/buildFingerprint';
import { isInternalBuildProfile } from './src/config/buildProfile';
import {
  logCloudSyncError,
  logStartupError,
  safeVoid,
} from './src/utils/startupErrors';
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
import DeliveryResultSheet from './src/components/delivery/DeliveryResultSheet';
import ScreenErrorBoundary from './src/components/ScreenErrorBoundary';
import { selectHasPendingDeliveryIncident } from './src/tutorial/app/selectors';
import DeliveryIncidentModal from './src/components/delivery/DeliveryIncidentModal';
import VehicleRecoverySheet from './src/components/delivery/VehicleRecoverySheet';
import { UI } from './src/theme/ui';
import {
  beginNavigationInteraction,
  beginPerfNavigation,
  markPerfNavigationDispatch,
  markPerfNavigationLayout,
  markPerfNavigationMount,
  readPerfNow,
  setPerfActiveScreen,
} from './src/utils/performanceDiagnostics';
import { preloadMapAssets } from './src/utils/mapAssetPreload';
import {
  markStartup,
} from './src/utils/startupPerformance';

markStartup('APP_START');
logBuildFingerprintOnce();

const TAB_PERFORMANCE_LOG_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true';

const MAIN_TABS: TabDefinition[] = [
  { key: 'dashboard', label: 'Ana', icon: 'dashboard' },
  { key: 'map', label: 'Harita', icon: 'map' },
  { key: 'contracts', label: 'İşler', icon: 'contract' },
  { key: 'market', label: 'Piyasa', icon: 'market' },
];

const TAB_KEEP_ALIVE: ReadonlySet<TabKey> = new Set(['more', 'vehicleMarketplace']);

function renderActiveScreen(
  tab: TabKey,
  onNavigate: (tab: TabKey) => void,
  onOpenWarehouse: () => void,
  options?: { isActive?: boolean },
): React.ReactElement {
  const isActive = options?.isActive ?? true;
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
          isActive={isActive}
          onBack={() => onNavigate('dashboard')}
        />
      );
    case 'more':
      return <MoreScreen isActive={isActive} />;
    default:
      return <DashboardScreen onNavigate={onNavigate} onOpenWarehouse={onOpenWarehouse} />;
  }
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

  useEffect(() => {
    setPerfActiveScreen(tab);
    markPerfNavigationMount(tab);
    return () => {
      setPerfActiveScreen(null);
    };
  }, [tab]);

  useLayoutEffect(() => {
    markPerfNavigationLayout(tab);
    const pending = transition.current;
    if (!pending || pending.to !== tab) return;
    const transitionMs = Math.max(0, readPerfNow() - pending.startedAt);
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
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set(['dashboard']));
  const [screenRetryKeys, setScreenRetryKeys] = useState<Partial<Record<TabKey, number>>>({});
  const transitionRef = useRef<{ from: TabKey; to: TabKey; startedAt: number } | null>(null);
  const isGameReady = useGameStore((state) => state.isGameReady);
  const navigationRequest = useGameStore((state) => state.navigationRequest);
  const clearNavigationRequest = useGameStore((state) => state.clearNavigationRequest);
  const pendingOfflineProgressSummary = useGameStore((state) => state.pendingOfflineProgressSummary);
  const dismissOfflineProgressSummary = useGameStore((state) => state.dismissOfflineProgressSummary);
  const pendingDeliveryResultSummary = useGameStore((state) => state.pendingDeliveryResultSummary);
  const dismissDeliveryResultSummary = useGameStore((state) => state.dismissDeliveryResultSummary);
  const pendingIncidentDeliveryId = useGameStore(
    (state) => selectHasPendingDeliveryIncident(state)
      ? state.activeDeliveries?.find(
          (delivery) =>
            delivery.incident?.status === 'pending' && delivery.incidentResolved !== true,
        )?.id
      : undefined,
  );

  useSpotlightTutorialTriggers({ activeTab, isGameReady });

  useLayoutEffect(() => {
    markStartup('FIRST_MAIN_SCREEN_RENDER');
  }, []);

  useEffect(() => {
    if (!ENABLE_SPOTLIGHT_TUTORIAL) {
      return;
    }
    useSpotlightTutorialStore.getState().setTabNavigator(setActiveTab);
    return () => {
      useSpotlightTutorialStore.getState().setTabNavigator(null);
    };
  }, []);

  useEffect(() => {
    setVisitedTabs((current) => {
      if (current.has(activeTab)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const handleTabPress = useCallback((nextTab: TabKey) => {
    if (nextTab === activeTab) return;
    const pressAt = readPerfNow();
    beginNavigationInteraction();
    beginPerfNavigation(activeTab, nextTab, pressAt);
    transitionRef.current = { from: activeTab, to: nextTab, startedAt: pressAt };
    markPerfNavigationDispatch();
    startTransition(() => {
      setActiveTab(nextTab);
    });
  }, [activeTab]);

  const handleOpenWarehouse = useCallback(() => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
  }, []);

  const navigateToManagementModule = (module: ManagementModule) => {
    const target = getManagementNavigationTarget(module);
    if (target.moreSubRoute) {
      useGameStore.setState({
        navigationRequest: { tab: target.tab },
        pendingMoreSubRoute: target.moreSubRoute,
      });
      return;
    }
    handleTabPress(target.tab);
  };

  const handleQuickAccess = (action: QuickAccessAction) => {
    const module = resolveManagementModule(action);
    if (module) {
      navigateToManagementModule(module);
      return;
    }
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

  const handleScreenRetry = useCallback((tab: TabKey) => {
    setScreenRetryKeys((current) => ({
      ...current,
      [tab]: (current[tab] ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (!navigationRequest) return;
    startTransition(() => {
      handleTabPress(navigationRequest.tab);
    });
    clearNavigationRequest();
  }, [navigationRequest, clearNavigationRequest, handleTabPress]);

  const keepAliveTabs = [...TAB_KEEP_ALIVE].filter((tab) => visitedTabs.has(tab));
  const renderScreen = (tab: TabKey, isVisible: boolean) => (
    <ScreenErrorBoundary
      key={`${tab}-${screenRetryKeys[tab] ?? 0}`}
      screenName={tab}
      onRetry={() => handleScreenRetry(tab)}
    >
      {renderActiveScreen(tab, handleTabPress, handleOpenWarehouse, { isActive: isVisible })}
    </ScreenErrorBoundary>
  );

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
        {keepAliveTabs.map((tab) => (
          <View
            key={`keep-alive-${tab}`}
            style={[styles.screenContainer, tab !== activeTab && styles.hiddenScreen]}
            pointerEvents={tab === activeTab ? 'auto' : 'none'}
            collapsable={false}
          >
            {renderScreen(tab, tab === activeTab)}
          </View>
        ))}
        {!TAB_KEEP_ALIVE.has(activeTab) ? (
          <View style={styles.screenContainer}>{renderScreen(activeTab, true)}</View>
        ) : null}
      </ActiveScreenFrame>
      <GameToast />
      <OfflineProgressSummaryModal
        visible={pendingOfflineProgressSummary != null}
        summary={pendingOfflineProgressSummary}
        onDismiss={dismissOfflineProgressSummary}
      />
      <DeliveryResultSheet
        visible={
          pendingDeliveryResultSummary != null && pendingOfflineProgressSummary == null
        }
        record={pendingOfflineProgressSummary == null ? pendingDeliveryResultSummary : null}
        onDismiss={dismissDeliveryResultSummary}
      />
      <DeliveryIncidentModal
        pendingDeliveryId={pendingIncidentDeliveryId}
        enabled={
          pendingOfflineProgressSummary == null &&
          pendingDeliveryResultSummary == null
        }
      />
      <VehicleRecoverySheet />
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

function GameLoadingScreen({ hint }: { hint: string }) {
  const fingerprint = getBuildFingerprint();
  const showFingerprint =
    isInternalBuildProfile() || fingerprint.buildProfile === 'internal';
  return (
    <View style={styles.loadingRoot}>
      <ActivityIndicator size="large" color={UI.colors.primary} />
      <Text style={styles.loadingText}>{hint}</Text>
      {showFingerprint ? (
        <Text style={styles.fingerprintText}>
          {fingerprint.appVersion} ({fingerprint.versionCode ?? '—'}) {fingerprint.gitCommitShort} {fingerprint.mapMarkerRevision}
        </Text>
      ) : null}
    </View>
  );
}

export default function App() {
  const isGameReady = useGameStore((state) => state.isGameReady);
  const [bootPhase, setBootPhase] = useState<'loading' | 'recovery' | 'ready'>('loading');
  const [bootHint, setBootHint] = useState('Şirket hazırlanıyor...');
  const [recoveryProbe, setRecoveryProbe] = useState<SaveRecoveryProbeResult | null>(null);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const appStateRef = useRef(AppState.currentState);

  const startGame = useCallback(async () => {
    try {
      await useGameStore.getState().initializeGame();
      setBootPhase('ready');
    } catch (error) {
      logStartupError('initialize-game', error);
      setBootPhase('ready');
    }
  }, []);

  const handleRecoveryComplete = useCallback(() => {
    void (async () => {
      try {
        const { invalidateSaveRecoveryColdStartProbe, probeSaveRecoveryWithCloudAttempt } =
          await import('./src/services/saveRecoveryService');
        invalidateSaveRecoveryColdStartProbe();
        const probe = await probeSaveRecoveryWithCloudAttempt({ force: true });
        if (probe.required && !probe.quarantine?.userChoseNewGame) {
          setRecoveryProbe(probe);
          setBootPhase('recovery');
          return;
        }
        await startGame();
      } catch (error) {
        logStartupError('recovery-complete', error);
        await startGame();
      }
    })();
  }, [startGame]);

  useEffect(() => {
    safeVoid('immersive-mode', enableImmersiveGameMode());
    const unsubscribeImmersive = subscribeImmersiveModeRefresh();
    return () => {
      unsubscribeImmersive();
    };
  }, []);

  useEffect(() => {
    if (bootPhase !== 'ready') return;
    const handle = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        markStartup('ADS_START');
        try {
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
    markStartup('JS_READY');
    // Local-first: load save and paint UI without waiting for Firebase Auth,
    // cloud restore, marketplace, or leaderboard.
    // Auth initializes in parallel (required for recovery cloud probe / later sync).
    // Native Google Sign-In Expo Go'da çalışmayabilir; development build gerekir.
    let cancelled = false;
    void (async () => {
      try {
        configureGoogleSignIn();
        logFirebaseRuntimeConfigOnce();
        setBootHint('Kayıt yükleniyor...');
        const { probeSaveRecoveryOnColdStart } = await import(
          './src/services/saveRecoveryService'
        );
        const probe = await probeSaveRecoveryOnColdStart();
        if (cancelled) return;
        logProductionBuildConfigOnce();
        if (probe.required && !probe.quarantine?.userChoseNewGame) {
          setRecoveryProbe(probe);
          setBootPhase('recovery');
          void (async () => {
            markStartup('AUTH_INIT_START');
            try {
              await initAnonymousAuth();
            } catch (error) {
              logStartupError('auth-init-recovery', error);
            } finally {
              markStartup('AUTH_INIT_DONE');
            }
            if (cancelled) return;
            try {
              const {
                invalidateSaveRecoveryColdStartProbe,
                probeSaveRecoveryWithCloudAttempt,
              } = await import('./src/services/saveRecoveryService');
              invalidateSaveRecoveryColdStartProbe();
              const cloudProbe = await probeSaveRecoveryWithCloudAttempt({ force: true });
              if (cancelled) return;
              if (!cloudProbe.required || cloudProbe.quarantine?.userChoseNewGame) {
                await startGame();
              }
            } catch (error) {
              logStartupError('save-recovery-cloud-probe', error);
              await startGame();
            }
          })();
          return;
        }
        await startGame();
      } catch (error) {
        logStartupError('cold-start', error);
        try {
          await startGame();
        } catch (startError) {
          logStartupError('cold-start-fallback', startError);
        }
      }
    })();

    const authPromise = (async () => {
      markStartup('AUTH_INIT_START');
      try {
        await initAnonymousAuth();
      } catch (error) {
        logStartupError('auth-init', error);
      } finally {
        markStartup('AUTH_INIT_DONE');
      }
    })();
    void authPromise;

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

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const wasActive = previousState === 'active';
      const isActive = nextState === 'active';
      setIsAppActive(isActive);

      if (!wasActive && isActive) {
        try {
          const store = useGameStore.getState();
          if (!store.isGameReady) {
            return;
          }
          store.checkMarketPriceAlerts({ sendLocal: false });
          store.applyOfflineProgressionIfNeeded('foreground');
          store.maybeRefreshMarketSnapshot('foreground');
          safeVoid('leaderboard-season', maybeSubmitLeaderboardForSeasonChange());
          retryPostStartupMarketplaceReconcileIfNeeded();
          safeVoid('marketplace-foreground-reconcile', reconcileVehicleMarketplaceOnForeground());
        } catch (error) {
          logStartupError('appstate-foreground', error);
        }
      }
      // iOS inactive + background: son timestamp kaydet (force-close güvenliği)
      if (nextState === 'background' || nextState === 'inactive') {
        useGameStore.getState().recordLastSeenRealTimeMs();
        // Persist only on true background; defer via InteractionManager for nav/perf.
        // flushLifecycleSave clears deferred autosave + coalesces in-flight saves.
        if (nextState === 'background') {
          InteractionManager.runAfterInteractions(() => {
            void useGameStore.getState().flushLifecycleSave('background');
          });
        }
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

  return (
    <GestureHandlerRootView style={styles.root}>
      <AppSafeAreaProvider>
        <AppDialogProvider>
          {bootPhase === 'recovery' && recoveryProbe ? (
            <SaveRecoveryScreen probe={recoveryProbe} onRecoveryComplete={handleRecoveryComplete} />
          ) : bootPhase === 'ready' && isGameReady ? (
            <AppShell isAppActive={isAppActive} />
          ) : (
            <GameLoadingScreen hint={bootHint} />
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
  hiddenScreen: {
    display: 'none',
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
  fingerprintText: {
    marginTop: 8,
    color: UI.colors.textSecondary,
    fontSize: 10,
    opacity: 0.55,
  },
});
