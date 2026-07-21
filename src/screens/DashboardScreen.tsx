/**
 * LogistiCore - Ana Dashboard (Oyun Hub)
 *
 * Mobil tycoon tarzı kompakt ana sayfa — kaynaklar, hero kart, sıradaki hamle,
 * operasyon HUD, modül grid ve fırsatlar. Büyük görev listesi yok; ödül durumu
 * Sıradaki Hamle kartında özetlenir.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { TabKey } from '../navigation/tabTypes';
import {
  buildDashboardStatTiles,
  DashboardHeroCard,
  DashboardModuleGrid,
  DashboardMarketOpportunitiesSection,
  DashboardNextActionCard,
  DashboardOpportunitiesSection,
  DashboardRetentionCard,
  DashboardResourceBar,
  DashboardStatGrid,
  DashboardWorldEventsCard,
  resolveNextAction,
} from '../components/dashboard';
import { AppScreen, GameIcon } from '../components/ui';
import TruckLocationHintRow from '../components/shared/TruckLocationHintRow';
import { createDefaultMissionsState } from '../config/missions';
import { createDefaultRetentionState } from '../simulation/retentionProgress';
import { calculateCompanyScore } from '../simulation/companyScore';
import { countPlayableContracts } from '../simulation/contracts';
import { getSafeFuelPrice } from '../simulation/economy';
import {
  applyWorldEventImpactToFuelPrice,
  getWorldEventSummary,
} from '../simulation/worldEvents';
import { getLevelProgress } from '../simulation/leveling';
import { getWarehouseUsedCapacityTon, normalizeWarehouse } from '../simulation/trading';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useGameStore } from '../store/gameStore';
import { buildDashboardOpportunities, pickDiverseDashboardOpportunities } from '../utils/dashboardOpportunities';
import {
  detectMarketTradeOpportunities,
  pickDiverseMarketTradeOpportunities,
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

function CashWarningBanner({ cash }: { cash: number }) {
  return (
    <View style={styles.cashWarning}>
      <GameIcon name="warning" size={13} color={colors.warning} />
      <Text style={styles.cashWarningText}>
        Nakit düşük ({formatMoney(cash)}) — giderlere dikkat et.
      </Text>
    </View>
  );
}

export default function DashboardScreen({ onNavigate, onOpenWarehouse }: DashboardScreenProps) {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const cities = useGameStore((state) => state.cities) ?? [];
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const financeTotals = useGameStore((state) => state.financeTotals);
  const missions = useGameStore((state) => state.missions) ?? createDefaultMissionsState();
  const onboarding = useGameStore((state) => state.onboarding);
  const dismissOnboardingGuide = useGameStore((state) => state.dismissOnboardingGuide);
  const completeOnboardingStepPress = useGameStore((state) => state.completeOnboardingStepPress);
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
  const getActiveWorldEventsValue = useGameStore((state) => state.getActiveWorldEventsValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);
  const openContractsForMapContract = useGameStore((state) => state.openContractsForMapContract);
  const openMarketFromAlert = useGameStore((state) => state.openMarketFromAlert);
  const { scrollBottomPadding } = useTabBarLayout();

  useOnboardingScreenVisit('Dashboard');

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const playableContractCount = useMemo(
    () =>
      player
        ? countPlayableContracts(
            availableContracts,
            player.trucks ?? [],
            player.drivers ?? [],
            Math.max(1, player.level ?? player.companyLevel ?? 1),
            currentTime,
            { playerMoney: player.money, globalEconomy },
          )
        : 0,
    [availableContracts, player, currentTime, globalEconomy],
  );

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
    financeTotals?.expenseByCategory?.trade_purchase,
    financeTotals?.incomeByCategory?.contract_income,
    missions?.flags?.marketOpened,
    missions?.flags?.tradePurchased,
    cities.length,
    currentTime,
  ]);

  React.useEffect(() => {
    if (runningDeliveries.length > 0) {
      notifyActiveDeliverySeen();
    }
  }, [runningDeliveries.length, notifyActiveDeliverySeen]);

  const fleetSnapshot = useMemo(() => {
    const snapshotTrucks = player?.trucks ?? [];
    const snapshotDrivers = player?.drivers ?? [];
    return {
      idleTrucks: snapshotTrucks.filter((t) => t.status === 'idle' && !t.leaseExpired).length,
      idleDrivers: snapshotDrivers.filter((d) => d.status === 'idle').length,
    };
  }, [player]);

  const marketTradeOpportunitiesAll = useMemo(() => {
    if (!player) return [];
    return detectMarketTradeOpportunities({
      player,
      cities,
      products,
      currentTime,
      limit: 8,
    });
  }, [player, cities, products, currentTime]);

  const marketTradeOpportunities = useMemo(
    () => pickDiverseMarketTradeOpportunities(marketTradeOpportunitiesAll, 2),
    [marketTradeOpportunitiesAll],
  );

  const opportunities = useMemo(() => {
    if (!player) return [];
    const built = buildDashboardOpportunities({
      contracts,
      trucks: player.trucks ?? [],
      drivers: player.drivers ?? [],
      playerLevel: Math.max(1, player.level ?? player.companyLevel ?? 1),
      currentTime,
      globalEconomy,
      activeDeliveries,
      cities,
      routes,
      products,
      limit: 6,
    });
    return pickDiverseDashboardOpportunities(built, 2);
  }, [contracts, player, currentTime, globalEconomy, activeDeliveries, cities, routes, products]);

  const topOpportunities = opportunities;

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
        getMissionProgress: getMissionProgressValue,
      }),
    );
  }, [
    player,
    onboarding,
    activeDeliveries,
    missions,
    getMissionProgressValue,
  ]);

  const nextAction = useMemo(
    () =>
      resolveNextAction({
        runningDeliveries: runningDeliveries.length,
        playableContracts: playableContractCount,
        idleTruckCount: fleetSnapshot.idleTrucks,
        missions,
        getMissionProgress: getMissionProgressValue,
        marketOpened: missions.flags.marketOpened,
      }),
    [runningDeliveries.length, playableContractCount, fleetSnapshot.idleTrucks, missions, getMissionProgressValue],
  );

  const statTiles = useMemo(() => {
    if (!player) return [];
    return buildDashboardStatTiles({
      idleTrucks: fleetSnapshot.idleTrucks,
      activeDeliveries: runningDeliveries.length,
      idleDrivers: fleetSnapshot.idleDrivers,
      warehouseFillRatio,
    });
  }, [player, fleetSnapshot, runningDeliveries.length, warehouseFillRatio]);

  if (!player) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={colors.accentBlue} />
        <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
      </View>
    );
  }

  const levelProgress = getLevelProgress(player);
  const fuelPrice = applyWorldEventImpactToFuelPrice(
    getSafeFuelPrice(globalEconomy),
    activeWorldEvents,
  );
  const playerDiamonds = Math.max(0, player.diamonds ?? 0);
  const showCashWarning = player.money < LOW_CASH_THRESHOLD;
  const showTruckLocationHint = shouldShowPostDeliveryLocationHint(player.completedContracts ?? 0);

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

  const handleNextActionPress = () => {
    if (onboardingAction) {
      dispatchOnboardingNavigation(onboardingAction.action, {
        navigate: handleNavigate,
        openMissions: handleOpenMissions,
        openWarehouse: handleOpenWarehouse,
        completeStep: completeOnboardingStepPress,
      });
      return;
    }

    switch (nextAction.action.type) {
      case 'claim':
        claimMissionReward(nextAction.action.missionId);
        return;
      case 'open-missions':
        handleOpenMissions();
        return;
      case 'navigate':
        handleNavigate(nextAction.action.tab);
        return;
    }
  };

  return (
    <AppScreen
      scroll
      padding
      scrollBottomPadding={scrollBottomPadding}
      contentContainerStyle={styles.screenContent}
    >
      <DashboardResourceBar
        money={player.money}
        diamonds={playerDiamonds}
        level={levelProgress.level}
        xpProgress={levelProgress.progressRatio}
        activeDeliveries={runningDeliveries.length}
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
      />

      {showCashWarning ? <CashWarningBanner cash={player.money} /> : null}

      <DashboardWorldEventsCard
        headline={worldEventSummary.headline}
        isCalm={worldEventSummary.isCalm}
        topEvents={worldEventSummary.topEvents}
        onPress={handleOpenMarket}
      />

      <DashboardRetentionCard
        readyRewards={retentionSummary.readyRewards}
        weeklyInProgress={retentionSummary.weeklyInProgress}
        weeklyTotal={retentionSummary.weeklyTotal}
        onPress={handleOpenMissions}
      />

      <DashboardNextActionCard
        title={onboardingAction?.title ?? nextAction.title}
        description={onboardingAction?.description ?? nextAction.description}
        ctaLabel={onboardingAction?.ctaLabel ?? nextAction.ctaLabel}
        variant={onboardingAction?.variant ?? nextAction.variant}
        icon={onboardingAction?.icon ?? nextAction.icon}
        badgeLabel={onboardingAction ? undefined : nextAction.badgeLabel}
        rewardChips={onboardingAction ? undefined : nextAction.rewardChips}
        eyebrowText={onboardingAction?.progressLabel}
        onDismissGuide={onboardingAction ? dismissOnboardingGuide : undefined}
        isOnboardingGuide={!!onboardingAction}
        goalHintLabel={onboardingAction ? 'Sıradaki hedef' : undefined}
        onPress={handleNextActionPress}
      />

      {showTruckLocationHint ? <TruckLocationHintRow style={styles.truckLocationHint} /> : null}

      <DashboardStatGrid tiles={statTiles} />

      <View style={styles.hubLower}>
        <DashboardModuleGrid
          onNavigate={handleNavigate}
          onOpenWarehouse={onOpenWarehouse}
          contractsAvailable={playableContractCount}
          contractsOpen={availableContracts.length}
          marketOpportunities={marketTradeOpportunitiesAll.length}
          idleTrucks={fleetSnapshot.idleTrucks}
          activeDeliveries={runningDeliveries.length}
          warehouseFillRatio={warehouseFillRatio}
        />

        <DashboardOpportunitiesSection
          items={topOpportunities}
          onPressItem={(item) => openContractsForMapContract(item.contract)}
          onViewAll={() => handleNavigate('contracts')}
        />

        <DashboardMarketOpportunitiesSection
          items={marketTradeOpportunities}
          onPressItem={(item) =>
            openMarketFromAlert({ cityId: item.cityId, productId: item.productId })
          }
          onViewAll={() => handleNavigate('market')}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  screenContent: {
    gap: 11,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  hubLower: {
    gap: 13,
  },
  cashWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  cashWarningText: {
    ...typography.caption,
    flex: 1,
    color: colors.warning,
    fontWeight: '600',
  },
  truckLocationHint: {
    marginTop: -2,
  },
});
