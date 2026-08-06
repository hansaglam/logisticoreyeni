/**
 * LogistiCore - Uygulama Girişi ve Sekme (Tab) Navigasyonu
 *
 * Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun, Dashboard açılır.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
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
import { useSpotlightTutorialTriggers } from './src/hooks/useSpotlightTutorialTriggers';
import { useSpotlightTutorialStore } from './src/store/spotlightTutorialStore';
import { useGameStore } from './src/store/gameStore';
import {
  addNotificationResponseListener,
  getMarketAlertFocusFromResponse,
  setupNotificationHandler,
} from './src/services/notifications';
import { initAnonymousAuth } from './src/services/authService';
import { configureGoogleSignIn } from './src/services/googleAuthService';
import { logFirebaseRuntimeConfigOnce } from './src/utils/firebaseRuntimeConfig';
import { initCloudSaveSync } from './src/storage/cloudSaveSync';
import { initializeAdProvider } from './src/services/adProvider';
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
import OfflineProgressSummaryModal from './src/components/offline/OfflineProgressSummaryModal';
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
    case 'more':
      return <MoreScreen />;
    default:
      return <DashboardScreen onNavigate={onNavigate} onOpenWarehouse={onOpenWarehouse} />;
  }
}

function AppShell() {
  useGameLoop();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const isGameReady = useGameStore((state) => state.isGameReady);
  const navigationRequest = useGameStore((state) => state.navigationRequest);
  const clearNavigationRequest = useGameStore((state) => state.clearNavigationRequest);
  const pendingOfflineProgressSummary = useGameStore((state) => state.pendingOfflineProgressSummary);
  const dismissOfflineProgressSummary = useGameStore((state) => state.dismissOfflineProgressSummary);

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

  const handleOpenWarehouse = () => {
    navigateToManagementModule('Warehouses');
  };

  const navigateToManagementModule = (module: ManagementModule) => {
    const target = getManagementNavigationTarget(module);
    if (target.moreSubRoute) {
      useGameStore.setState({
        navigationRequest: { tab: target.tab },
        pendingMoreSubRoute: target.moreSubRoute,
      });
      return;
    }
    setActiveTab(target.tab);
  };

  const handleQuickAccess = (action: QuickAccessAction) => {
    const module = resolveManagementModule(action);
    if (module) {
      navigateToManagementModule(module);
      return;
    }
    if (action === 'settings') {
      useGameStore.setState({
        navigationRequest: { tab: 'more' },
        pendingMoreSubRoute: 'menu',
      });
    }
  };

  useEffect(() => {
    if (!navigationRequest) return;
    setActiveTab(navigationRequest.tab);
    clearNavigationRequest();
  }, [navigationRequest, clearNavigationRequest]);

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
      <View style={styles.screenContainer}>
        {renderActiveScreen(activeTab, setActiveTab, handleOpenWarehouse)}
      </View>
      <GameToast />
      <OfflineProgressSummaryModal
        visible={pendingOfflineProgressSummary != null}
        summary={pendingOfflineProgressSummary}
        onDismiss={dismissOfflineProgressSummary}
      />
      {ENABLE_SPOTLIGHT_TUTORIAL ? <TutorialOverlay layer="root" /> : null}
      <GameTabBar
        tabs={MAIN_TABS}
        activeTab={activeTab}
        onTabPress={setActiveTab}
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

  useEffect(() => {
    void enableImmersiveGameMode();
    const unsubscribeImmersive = subscribeImmersiveModeRefresh();
    void initializeAdProvider();
    return () => {
      unsubscribeImmersive();
    };
  }, []);

  useEffect(() => {
    // Native Google Sign-In Expo Go'da çalışmayabilir; development build gerekir.
    configureGoogleSignIn();
    logFirebaseRuntimeConfigOnce();
    // Auth restore tamamlanana kadar anonymous sign-in yapılmaz.
    void initAnonymousAuth();
    void useGameStore.getState().initializeGame();

    setupNotificationHandler();
    const notificationSub = addNotificationResponseListener((response) => {
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
      if (nextState === 'active') {
        useGameStore.getState().checkMarketPriceAlerts({ sendLocal: false });
        useGameStore.getState().applyOfflineProgressionIfNeeded();
      }
      // iOS inactive + background: son timestamp kaydet (force-close güvenliği)
      if (nextState === 'background' || nextState === 'inactive') {
        useGameStore.getState().recordLastSeenRealTimeMs();
        if (nextState === 'background') {
          void useGameStore.getState().saveGame();
        }
      }
    });

    return () => {
      notificationSub.remove();
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!isGameReady) {
      return;
    }

    void initCloudSaveSync(() => useGameStore.getState());
  }, [isGameReady]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <AppSafeAreaProvider>
        <AppDialogProvider>
          {isGameReady ? <AppShell /> : <GameLoadingScreen />}
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
