/**
 * LogistiCore - Uygulama Girişi ve Sekme (Tab) Navigasyonu
 *
 * Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun, Dashboard açılır.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StatusBar, StyleSheet, Text, View } from 'react-native';

import { AppSafeAreaProvider } from './src/components/AppSafeAreaProvider';
import { AppDialogProvider } from './src/components/AppDialogProvider';
import BottomTabBar, { type TabDefinition, type TabKey } from './src/components/BottomTabBar';
import GameToast from './src/components/GameToast';
import TutorialOverlay from './src/components/tutorial/TutorialOverlay';
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
import { initCloudSaveSync } from './src/storage/cloudSaveSync';
import type { ProductId } from './src/types/game';

import DashboardScreen from './src/screens/DashboardScreen';
import MapScreen from './src/screens/MapScreen';
import ContractsScreen from './src/screens/ContractsScreen';
import FleetScreen from './src/screens/FleetScreen';
import MarketScreen from './src/screens/MarketScreen';
import MoreScreen from './src/screens/MoreScreen';
import { UI } from './src/theme/ui';

const TABS: TabDefinition[] = [
  { key: 'dashboard', label: 'Ana Sayfa', icon: 'dashboard' },
  { key: 'map', label: 'Harita', icon: 'map' },
  { key: 'contracts', label: 'İşler', icon: 'contract' },
  { key: 'fleet', label: 'Filo', icon: 'truck' },
  { key: 'market', label: 'Piyasa', icon: 'market' },
  { key: 'more', label: 'Daha Fazla', icon: 'more' },
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

  useSpotlightTutorialTriggers({ activeTab, isGameReady });

  useEffect(() => {
    useSpotlightTutorialStore.getState().setTabNavigator(setActiveTab);
    return () => {
      useSpotlightTutorialStore.getState().setTabNavigator(null);
    };
  }, []);

  const handleOpenWarehouse = () => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
  };

  useEffect(() => {
    if (!navigationRequest) return;
    setActiveTab(navigationRequest.tab);
    clearNavigationRequest();
  }, [navigationRequest, clearNavigationRequest]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={UI.colors.background} />
      <View style={styles.screenContainer}>
        {renderActiveScreen(activeTab, setActiveTab, handleOpenWarehouse)}
      </View>
      <GameToast />
      <TutorialOverlay layer="root" />
      <BottomTabBar tabs={TABS} activeTab={activeTab} onTabPress={setActiveTab} />
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
    // Native Google Sign-In Expo Go'da çalışmayabilir; development build gerekir.
    configureGoogleSignIn();
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
      }
      if (nextState === 'background' || nextState === 'inactive') {
        void useGameStore.getState().saveGame();
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
    <AppSafeAreaProvider>
      <AppDialogProvider>
        {isGameReady ? <AppShell /> : <GameLoadingScreen />}
      </AppDialogProvider>
    </AppSafeAreaProvider>
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
