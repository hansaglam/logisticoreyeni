/**
 * LogistiCore - Ana Dashboard (Oyun Hub)
 *
 * Premium mobil tycoon ana sayfa — kaynaklar, hero kart, olaylar/ödüller,
 * başlangıç rehberi, modül grid ve günlük destek.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { TabKey } from '../navigation/tabTypes';
import {
  DashboardAlertBanner,
  DashboardBackground,
  DashboardHeroCard,
  DashboardModuleGrid,
  DashboardNextActionCard,
  DashboardRetentionCard,
  DashboardResourceBar,
  DashboardWorldEventsCard,
  DASHBOARD_HORIZONTAL_PADDING,
  DASHBOARD_SCROLL_BOTTOM_EXTRA,
  DASHBOARD_SECTION_GAP,
  DASHBOARD_SPLIT_MIN_WIDTH,
  dashboardStyles,
} from '../components/dashboard';
import DashboardDailyOpsBonusCard from '../components/monetization/DashboardDailyOpsBonusCard';
import { createDefaultMissionsState } from '../config/missions';
import { createDefaultRetentionState } from '../simulation/retentionProgress';
import { calculateCompanyScore } from '../simulation/companyScore';
import {
  getWorldEventSummary,
} from '../simulation/worldEvents';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
import { getLevelProgress } from '../simulation/leveling';
import { getWarehouseUsedCapacityTon, normalizeWarehouse } from '../simulation/trading';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useGameStore } from '../store/gameStore';
import {
  detectMarketTradeOpportunities,
} from '../utils/marketTradeOpportunities';
import { useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import {
  buildOnboardingEvaluationState,
  dispatchOnboardingNavigation,
  isOnboardingActive,
  resolveOnboardingDashboardAction,
} from '../onboarding/onboardingProgress';
import { colors, formatMoney, spacing, typography } from '../theme';
import type { Player } from '../types/game';
import { shouldShowPostDeliveryLocationHint } from '../utils/truckLocationUx';

interface DashboardScreenProps {
  onNavigate?: (tab: TabKey) => void;
  onOpenWarehouse?: () => void;
}

const LOW_CASH_THRESHOLD = 8_000;

function getWarehouseFillRatio(player: Player, currentTime: number): number {
  const warehouses = player.warehouses ?? [];
  let totalCapacity = 0;
  let usedCapacity = 0;

  for (const warehouse of warehouses) {
    totalCapacity += warehouse.capacityTons ?? 0;
    usedCapacity += getWarehouseUsedCapacityTon(normalizeWarehouse(warehouse, currentTime));
  }

  return totalCapacity > 0 ? usedCapacity / totalCapacity : 0;
}

export default function DashboardScreen({ onNavigate, onOpenWarehouse }: DashboardScreenProps) {
  const player = useGameStore((state) => state.player);
  const products = useGameStore((state) => state.products) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const globalSnapshot = useGameStore((state) => state.cachedGlobalEconomySnapshot);
  const currentTime = useGameStore((state) => state.currentTime);
  const cities = useGameStore((state) => state.cities) ?? [];
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const financeTotals = useGameStore((state) => state.financeTotals);
  const missions = useGameStore((state) => state.missions) ?? createDefaultMissionsState();
  const onboarding = useGameStore((state) => state.onboarding);
  const advanceOnboardingProgress = useGameStore((state) => state.advanceOnboardingProgress);
  const isPaused = useGameStore((state) => state.isPaused);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const notifyActiveDeliverySeen = useGameStore((state) => state.notifyActiveDeliverySeen);
  const syncMissionProgress = useGameStore((state) => state.syncMissionProgress);
  const syncRetentionProgress = useGameStore((state) => state.syncRetentionProgress);
  const getRetentionSummaryValue = useGameStore((state) => state.getRetentionSummaryValue);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const retention = useGameStore((state) => state.retention) ?? createDefaultRetentionState();
  const worldEvents = useGameStore((state) => state.worldEvents) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const getActiveWorldEventsValue = useGameStore((state) => state.getActiveWorldEventsValue);
  const addNotification = useGameStore((state) => state.addNotification);
  const { tabBarHeight, screenTopPadding } = useTabBarLayout();
  const dashboardBottomPadding = tabBarHeight + DASHBOARD_SCROLL_BOTTOM_EXTRA;
  const { width: screenWidth } = useWindowDimensions();
  const useSplitLayout = screenWidth >= DASHBOARD_SPLIT_MIN_WIDTH;

  useOnboardingScreenVisit('Dashboard');

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing'),
    [activeDeliveries],
  );

  const truckCount = player?.trucks?.length ?? 0;
  const warehouseInventoryCount = useMemo(
    () =>
      (player?.warehouses ?? []).reduce(
        (sum, warehouse) => sum + (warehouse.inventory?.length ?? 0),
        0,
      ),
    [player?.warehouses],
  );

  React.useEffect(() => {
    syncMissionProgress();
    syncRetentionProgress();
  }, [
    syncMissionProgress,
    syncRetentionProgress,
    player?.completedContracts,
    financeLedger.length,
    activeDeliveries.length,
    truckCount,
    warehouseInventoryCount,
    financeTotals?.incomeByCategory?.trade_sale,
    financeTotals?.incomeByCategory?.market_sale,
    financeTotals?.expenseByCategory?.trade_purchase,
    financeTotals?.expenseByCategory?.market_purchase,
    financeTotals?.incomeByCategory?.contract_income,
    financeTotals?.incomeByCategory?.contract_revenue,
    missions?.flags?.marketOpened,
    missions?.flags?.tradePurchased,
    cities.length,
  ]);

  React.useEffect(() => {
    if (runningDeliveries.length > 0) {
      notifyActiveDeliverySeen();
    }
  }, [runningDeliveries.length, notifyActiveDeliverySeen]);

  const fleetSnapshot = useMemo(() => {
    const snapshotTrucks = player?.trucks ?? [];
    return {
      idleTrucks: snapshotTrucks.filter((t) => t.status === 'idle' && !t.leaseExpired).length,
    };
  }, [player]);

  const marketOpportunityCount = useMemo(() => {
    if (!player) return 0;
    return detectMarketTradeOpportunities({
      player,
      cities,
      products,
      currentTime,
      limit: 8,
    }).length;
  }, [player, cities, products, currentTime]);

  const warehouseFillRatio = useMemo(
    () => (player ? getWarehouseFillRatio(player, currentTime) : 0),
    [player, currentTime],
  );

  const companyScore = useMemo(
    () =>
      player
        ? calculateCompanyScore({ player, cities, products, financeLedger, currentTime })
        : 0,
    [player, cities, products, financeLedger, currentTime],
  );

  const retentionSummary = useMemo(
    () => getRetentionSummaryValue(),
    [getRetentionSummaryValue, retention],
  );

  const activeWorldEvents = useMemo(
    () => getActiveWorldEventsValue(),
    [getActiveWorldEventsValue, worldEvents, currentTime],
  );

  const worldEventSummary = useMemo(
    () => getWorldEventSummary(activeWorldEvents),
    [activeWorldEvents],
  );

  React.useEffect(() => {
    advanceOnboardingProgress();
  }, [
    advanceOnboardingProgress,
    onboarding?.currentStepId,
    onboarding?.completed,
    onboarding?.missionRewardClaimed,
    activeDeliveries.length,
    runningDeliveries.length,
    warehouseInventoryCount,
    player?.completedContracts,
    missions?.flags?.tradePurchased,
    missions?.flags?.deliveryStarted,
    missions?.claimedMissionRewardIds?.length,
    onboarding?.assignmentOpened,
    onboarding?.visitedScreens?.length,
  ]);

  const onboardingAction = useMemo(() => {
    if (!player || !onboarding || !isOnboardingActive(onboarding)) {
      return null;
    }
    return resolveOnboardingDashboardAction(
      buildOnboardingEvaluationState({
        onboarding,
        activeDeliveries,
        missions,
        player,
        currentTime,
        getMissionProgress: getMissionProgressValue,
      }),
    );
  }, [player, onboarding, activeDeliveries, missions, currentTime, getMissionProgressValue]);

  const showOnboardingCard = onboardingAction != null;

  if (!player) {
    return (
      <View style={styles.screenRoot}>
        <DashboardBackground />
        <View style={styles.loadingRoot}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </View>
    );
  }

  const levelProgress = getLevelProgress(player);
  const fuelPrice = getSnapshotFuelPrice(globalSnapshot, globalEconomy);
  const playerDiamonds = Math.max(0, player.diamonds ?? 0);
  const showCashWarning = player.money < LOW_CASH_THRESHOLD;
  const showTruckLocationHint = shouldShowPostDeliveryLocationHint(player.completedContracts ?? 0);
  const onboardingCompleted = onboarding?.completed === true;

  const handleDailyOpsBonusSuccess = (amount: number) => {
    addNotification({
      time: currentTime,
      type: 'success',
      title: 'Operasyon desteği',
      message: `${formatMoney(amount)} nakit eklendi.`,
      autoDismissMs: 2800,
    });
  };

  const handleNavigate = (tab: TabKey) => {
    try {
      onNavigate?.(tab);
    } catch {
      // Dashboard navigasyon hatası uygulamayı düşürmemeli.
    }
  };

  const handleOpenMissions = () => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'missions',
    });
  };

  const handleOpenWarehouse = () => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
  };

  const handleOpenMarket = () => {
    handleNavigate('market');
  };

  const handleOnboardingPress = () => {
    if (!onboardingAction) return;
    dispatchOnboardingNavigation(onboardingAction.action, {
      navigate: handleNavigate,
      openMissions: handleOpenMissions,
      openWarehouse: handleOpenWarehouse,
    });
  };

  return (
    <View style={styles.screenRoot}>
      <DashboardBackground />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.screenContent,
          {
            paddingTop: screenTopPadding + 12,
            paddingBottom: dashboardBottomPadding,
            paddingHorizontal: DASHBOARD_HORIZONTAL_PADDING,
            flexGrow: 0,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
      <DashboardResourceBar
        money={player.money}
        diamonds={playerDiamonds}
        level={levelProgress.level}
        xpProgress={levelProgress.progressRatio}
        isPaused={isPaused}
        onTogglePause={isPaused ? resumeGame : pauseGame}
      />

      <DashboardHeroCard
        companyName={player.companyName}
        level={levelProgress.level}
        currentTime={currentTime}
        fuelPrice={fuelPrice}
        xp={levelProgress.xp ?? 0}
        xpToNext={levelProgress.xpToNextLevel}
        xpProgress={levelProgress.progressRatio}
        isMaxLevel={levelProgress.isMaxLevel}
        money={player.money}
        companyScore={companyScore}
        reputation={player.reputation ?? 0}
        idleTrucks={fleetSnapshot.idleTrucks}
        activeDeliveries={runningDeliveries.length}
      />

      {showCashWarning ? (
        <DashboardAlertBanner
          message={`Nakit düşük (${formatMoney(player.money)}) — giderlere dikkat et.`}
        />
      ) : null}

      <View style={[dashboardStyles.splitCardsRow, !useSplitLayout && dashboardStyles.splitColumn]}>
        <View style={dashboardStyles.splitItem}>
          <DashboardWorldEventsCard
            activeCount={worldEventSummary.activeCount}
            isCalm={worldEventSummary.isCalm}
            topEvents={worldEventSummary.topEvents}
            currentTime={currentTime}
            onPress={handleOpenMarket}
          />
        </View>
        <View style={dashboardStyles.splitItem}>
          <DashboardRetentionCard
            readyRewards={retentionSummary.readyRewards}
            readyMilestones={retentionSummary.readyMilestones}
            readyWeekly={retentionSummary.readyWeekly}
            weeklyInProgress={retentionSummary.weeklyInProgress}
            weeklyTotal={retentionSummary.weeklyTotal}
            onPress={handleOpenMissions}
          />
        </View>
      </View>

      {showOnboardingCard && onboardingAction ? (
        <DashboardNextActionCard
          stepId={onboardingAction.stepId}
          title={onboardingAction.title}
          description={onboardingAction.description}
          ctaLabel={onboardingAction.ctaLabel}
          variant={onboardingAction.variant}
          icon={onboardingAction.icon}
          progressLabel={onboardingAction.progressLabel}
          stepIndex={onboardingAction.stepIndex}
          totalSteps={onboardingAction.totalSteps}
          onPress={handleOnboardingPress}
        />
      ) : null}

      <View style={dashboardStyles.lowerSection}>
      <DashboardModuleGrid
        showLocationHint={showTruckLocationHint}
        onNavigate={handleNavigate}
        onOpenWarehouse={onOpenWarehouse ?? handleOpenWarehouse}
        marketOpportunities={marketOpportunityCount}
        idleTrucks={fleetSnapshot.idleTrucks}
        activeDeliveries={runningDeliveries.length}
        warehouseFillRatio={warehouseFillRatio}
      />

      <DashboardDailyOpsBonusCard
        playerLevel={levelProgress.level}
        onboardingCompleted={onboardingCompleted}
        onSuccess={handleDailyOpsBonusSuccess}
      />
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  screenContent: {
    gap: DASHBOARD_SECTION_GAP,
    justifyContent: 'flex-start',
  },
});
