/**
 * LogistiCore - Uygulama Girişi ve Sekme (Tab) Navigasyonu
 *
 * Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun, Dashboard açılır.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StatusBar, StyleSheet, Text, View } from 'react-native';

import { AppSafeAreaProvider } from './src/components/AppSafeAreaProvider';
import BottomTabBar, { type TabKey } from './src/components/BottomTabBar';
import GameToast from './src/components/GameToast';
import { useGameLoop } from './src/hooks/useGameLoop';
import { useGameStore } from './src/store/gameStore';

import DashboardScreen from './src/screens/DashboardScreen';
import MapScreen from './src/screens/MapScreen';
import ContractsScreen from './src/screens/ContractsScreen';
import FleetScreen from './src/screens/FleetScreen';
import MarketScreen from './src/screens/MarketScreen';
import MoreScreen from './src/screens/MoreScreen';
import { UI } from './src/theme/ui';

interface TabDefinition {
  key: TabKey;
  label: string;
  icon: string;
}

const TABS: TabDefinition[] = [
  { key: 'dashboard', label: 'Ana Sayfa', icon: '🏠' },
  { key: 'map', label: 'Harita', icon: '🗺️' },
  { key: 'contracts', label: 'İşler', icon: '📄' },
  { key: 'fleet', label: 'Filo', icon: '🚚' },
  { key: 'market', label: 'Piyasa', icon: '📈' },
  { key: 'more', label: 'Daha Fazla', icon: '☰' },
];

function renderActiveScreen(tab: TabKey, onNavigate: (tab: TabKey) => void): React.ReactElement {
  switch (tab) {
    case 'dashboard':
      return <DashboardScreen onNavigate={onNavigate} />;
    case 'map':
      return <MapScreen />;
    case 'contracts':
      return <ContractsScreen />;
    case 'fleet':
      return <FleetScreen />;
    case 'market':
      return <MarketScreen onOpenContracts={() => onNavigate('contracts')} />;
    case 'more':
      return <MoreScreen />;
    default:
      return <DashboardScreen onNavigate={onNavigate} />;
  }
}

function AppShell() {
  useGameLoop();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const navigationRequest = useGameStore((state) => state.navigationRequest);
  const clearNavigationRequest = useGameStore((state) => state.clearNavigationRequest);

  useEffect(() => {
    if (!navigationRequest) return;
    setActiveTab(navigationRequest.tab);
    clearNavigationRequest();
  }, [navigationRequest, clearNavigationRequest]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={UI.colors.background} />
      <View style={styles.screenContainer}>{renderActiveScreen(activeTab, setActiveTab)}</View>
      <GameToast />
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
    void useGameStore.getState().initializeGame();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void useGameStore.getState().saveGame();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <AppSafeAreaProvider>
      {isGameReady ? <AppShell /> : <GameLoadingScreen />}
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
