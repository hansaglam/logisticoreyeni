/**
 * LogistiCore - Ana Dashboard Ekranı
 *
 * Sade, aksiyon odaklı komuta merkezi — özet metrikler, sonraki adım ve kritik akış.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { TabKey } from '../components/BottomTabBar';
import StarterMissionsCard from '../components/StarterMissionsCard';
import {
  ActionButton,
  AppCard,
  AppScreen,
  GameIcon,
  IconButton,
  ProgressBar,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { deliveryBalance } from '../config/balance';
import { getTutorialStep } from '../config/tutorial';
import {
  calculateCompanyScore,
  formatCompanyScore,
} from '../simulation/companyScore';
import { getSafeFuelPrice } from '../simulation/economy';
import { getCityByIdSafe, getCityName, getProductName } from '../utils/entityLookup';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import {
  calculateDailyOperatingCostBreakdown,
  getWeeklyLeaseBurden,
} from '../simulation/dailyOperatingCosts';
import {
  getContractAvailability,
} from '../simulation/delivery';
import { getLevelProgress } from '../simulation/leveling';
import {
  calculateTradeProfit,
  getCityProductMarketPrice,
  getWarehouseUsedCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import { getRecentGameEvents, useGameStore } from '../store/gameStore';
import { colors, formatGameTimeCompact, formatMoney, formatRatioPercent, formatUnitPrice, radius, spacing, typography } from '../theme';
import type { Contract, Delivery, Driver, GameEvent, MarketNews, Player, Truck, TruckTransfer } from '../types/game';

interface DashboardScreenProps {
  onNavigate?: (tab: TabKey) => void;
  onOpenWarehouse?: () => void;
}

const LOW_CASH_THRESHOLD = 8_000;

function formatDuration(hours: number): string {
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (days > 0) return `${days}g ${remainingHours}s`;
  return `${remainingHours}s`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NextActionTarget = TabKey | 'warehouse';

interface NextAction {
  title: string;
  subtitle: string;
  buttonLabel: string;
  target: NextActionTarget;
}

function countStartableContracts(
  contracts: Contract[],
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
): number {
  return contracts.filter(
    (contract) => getContractAvailability(contract, trucks, drivers, playerLevel).canStart,
  ).length;
}

function hasIdleTrucksWaitingForOriginContracts(
  availableContracts: Contract[],
  idleTrucks: number,
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
): boolean {
  if (idleTrucks <= 0 || availableContracts.length === 0) return false;
  const startableCount = countStartableContracts(
    availableContracts,
    trucks,
    drivers,
    playerLevel,
  );
  return startableCount === 0;
}

function resolveNextAction(
  cash: number,
  truckCount: number,
  idleTrucks: number,
  idleDrivers: number,
  runningDeliveries: Delivery[],
  availableContracts: Contract[],
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  hasTradeProfit: boolean,
): NextAction {
  if (truckCount === 0) {
    return {
      title: 'Filonu büyüt',
      subtitle: 'İlk kamyonunu alarak taşımacılığa başlayabilirsin.',
      buttonLabel: 'Filo Mağazası',
      target: 'fleet',
    };
  }
  if (runningDeliveries.length > 0) {
    return {
      title: 'Teslimat yolda',
      subtitle: 'Yoldaki teslimatlarını takip et.',
      buttonLabel: 'Haritayı Aç',
      target: 'map',
    };
  }
  if (idleTrucks > 0 && idleDrivers > 0) {
    const startableCount = countStartableContracts(
      availableContracts,
      trucks,
      drivers,
      playerLevel,
    );
    if (startableCount > 0) {
      return {
        title: 'Yeni sözleşme hazır',
        subtitle: 'Boştaki ekibinle yeni bir teslimat başlatabilirsin.',
        buttonLabel: 'Sözleşmeleri Gör',
        target: 'contracts',
      };
    }
    if (hasIdleTrucksWaitingForOriginContracts(
      availableContracts,
      idleTrucks,
      trucks,
      drivers,
      playerLevel,
    )) {
      return {
        title: 'Kamyon konumu bekliyor',
        subtitle:
          'Boştaki kamyonlarının bulunduğu şehirlerde yeni fırsat oluşmasını bekleyebilirsin.',
        buttonLabel: 'İşleri Kontrol Et',
        target: 'contracts',
      };
    }
  }
  if (cash < LOW_CASH_THRESHOLD) {
    return {
      title: 'Nakit dikkat',
      subtitle: 'Sabit giderler nakit rezervini zorluyor. Kârlı sözleşmelere odaklan.',
      buttonLabel: 'En iyi fırsatlara bak',
      target: 'contracts',
    };
  }
  if (hasTradeProfit) {
    return {
      title: 'Ticaret fırsatı',
      subtitle: 'Depodaki bazı ürünler kârla satılabilir.',
      buttonLabel: 'Depoları Aç',
      target: 'warehouse',
    };
  }
  if (availableContracts.length > 0) {
    const startableCount = countStartableContracts(
      availableContracts,
      trucks,
      drivers,
      playerLevel,
    );
    if (startableCount > 0) {
      return {
        title: 'Yeni sözleşme hazır',
        subtitle: 'Boştaki ekibinle yeni bir teslimat başlatabilirsin.',
        buttonLabel: 'Sözleşmeleri Gör',
        target: 'contracts',
      };
    }
  }
  return {
    title: 'Yeni iş bekleniyor',
    subtitle: 'Piyasa yeni fırsatlar oluşturdukça işler burada görünecek.',
    buttonLabel: 'İşleri Kontrol Et',
    target: 'contracts',
  };
}

function getDeliveryStatusVariant(status: Delivery['status']): 'blue' | 'amber' | 'success' | 'danger' {
  switch (status) {
    case 'on_route':
      return 'blue';
    case 'preparing':
      return 'amber';
    case 'completed':
      return 'success';
    default:
      return 'danger';
  }
}

function getDeliveryStatusLabel(status: Delivery['status']): string {
  switch (status) {
    case 'on_route':
      return 'Yolda';
    case 'preparing':
      return 'Hazırlanıyor';
    case 'completed':
      return 'Tamamlandı';
    default:
      return 'Başarısız';
  }
}

function getContractRiskVariant(contract: Contract): 'success' | 'warning' | 'danger' | 'muted' {
  if (contract.urgency >= 0.75) return 'danger';
  if (contract.urgency >= 0.45 || contract.deadlineHours <= 12) return 'warning';
  return 'success';
}

function getContractRiskLabel(contract: Contract): string {
  if (contract.urgency >= 0.75) return 'Acil';
  if (contract.urgency >= 0.45) return 'Orta risk';
  return 'Düşük risk';
}

/** Dashboard sıralaması için hafif UI tahmini — store/simulation değiştirmez */
function estimateOpportunityProfit(contract: Contract, fuelPrice: number): number {
  const travelHours = contract.distanceKm / deliveryBalance.defaultAverageSpeed;
  const fuelCost = contract.distanceKm * fuelPrice * deliveryBalance.fuelCostEstimateMultiplier;
  const driverCost =
    (travelHours / 24) *
    deliveryBalance.fallbackDriverSalaryPerDay *
    deliveryBalance.driverCostMultiplier;
  const maintenanceCost = contract.distanceKm * deliveryBalance.maintenanceCostPerKm * 0.5;
  return contract.payment - fuelCost - driverCost - maintenanceCost;
}

function hasProfitableWarehouseStock(player: Player, currentTime: number): boolean {
  for (const warehouse of player.warehouses ?? []) {
    const city = getCityByIdSafe(warehouse.cityId);
    const normalized = normalizeWarehouse(warehouse, currentTime);
    for (const item of normalized.inventory ?? []) {
      const quantity = item.quantity ?? 0;
      if (quantity <= 0) continue;
      const currentPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
      const profit = calculateTradeProfit(
        currentPrice,
        item.averageBuyPrice ?? 0,
        quantity,
        item.quality ?? 100,
      );
      if (profit > 0) return true;
    }
  }
  return false;
}

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

/** Aynı title+type tekrarlarını Dashboard'da gizler — eventLog'a dokunmaz */
function dedupeDashboardEvents(events: GameEvent[], limit = 3): GameEvent[] {
  const seen = new Set<string>();
  const result: GameEvent[] = [];

  for (const event of events) {
    const key = `${event.type}|${event.title.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
    if (result.length >= limit) break;
  }

  return result;
}

function getNewsAccent(importance: MarketNews['importance']): string {
  switch (importance) {
    case 'high':
      return colors.danger;
    case 'medium':
      return colors.warning;
    default:
      return colors.info;
  }
}

function getEventAccent(event: GameEvent): string {
  if (event.type === 'delivery' && event.title === 'Teslimat tamamlandı') return colors.success;
  if (event.importance === 'high') return colors.danger;
  if (event.importance === 'medium') return colors.info;
  return colors.textMuted;
}

function normalizeDevelopmentCategory(event: GameEvent): string {
  const title = event.title.toLowerCase();
  if (event.type === 'delivery') return 'delivery';
  if (title.includes('stok') || title.includes('depo') || event.type === 'warehouse') return 'stock';
  if (title.includes('bakım') || title.includes('bakim')) return 'maintenance';
  if (title.includes('satın') || title.includes('satin')) return 'purchase';
  if (event.type === 'market' || event.type === 'finance') return 'market';
  return event.type;
}

function eventPriorityScore(event: GameEvent): number {
  if (event.type === 'delivery' && event.title === 'Teslimat tamamlandı') return 0;
  if (event.importance === 'high') return 1;
  if (event.importance === 'medium') return 2;
  return 3;
}

interface DevelopmentItem {
  id: string;
  title: string;
  message: string;
  accent: string;
}

function buildRecentDevelopments(
  news: MarketNews[],
  events: GameEvent[],
  limit = 3,
): DevelopmentItem[] {
  const items: DevelopmentItem[] = [];
  const usedCategories = new Set<string>();

  const sortedNews = [...news].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return (rank[a.importance] ?? 2) - (rank[b.importance] ?? 2);
  });

  const topNews = sortedNews.find((item) => item.importance === 'high' || item.importance === 'medium');
  if (topNews) {
    usedCategories.add('news');
    items.push({
      id: `news-${topNews.id}`,
      title: topNews.title,
      message: topNews.message,
      accent: getNewsAccent(topNews.importance),
    });
  }

  const recentEvents = dedupeDashboardEvents(getRecentGameEvents(events, 20), 12).sort(
    (a, b) => eventPriorityScore(a) - eventPriorityScore(b),
  );

  for (const event of recentEvents) {
    if (items.length >= limit) break;
    const category = normalizeDevelopmentCategory(event);
    if (usedCategories.has(category)) continue;
    usedCategories.add(category);
    items.push({
      id: event.id,
      title: event.title,
      message: event.message,
      accent: getEventAccent(event),
    });
  }

  if (items.length < limit && topNews && !usedCategories.has('news')) {
    items.push({
      id: `news-${topNews.id}`,
      title: topNews.title,
      message: topNews.message,
      accent: getNewsAccent(topNews.importance),
    });
  }

  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatLine({
  label,
  value,
  valueColor = colors.textPrimary,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.statLineLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.statLineValue, { color: valueColor }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function CompanyHeaderCard({
  companyName,
  level,
  money,
  diamonds,
  currentTime,
  fuelPrice,
  isPaused,
  onTogglePause,
}: {
  companyName: string;
  level: number;
  money: number;
  diamonds: number;
  currentTime: number;
  fuelPrice: number;
  isPaused: boolean;
  onTogglePause: () => void;
}) {
  return (
    <AppCard variant="soft" style={styles.headerCard}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarWrap}>
            <GameIcon name="company" size={22} color={colors.accentAmber} />
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.brandTitle}>LogistiCore</Text>
            <Text style={styles.companyName} numberOfLines={1}>
              {companyName}
            </Text>
            <Text style={styles.headerMeta}>
              Level {level} · {formatGameTimeCompact(currentTime)}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.cashValue}>{formatMoney(money)}</Text>
          <Text style={styles.diamondValue}>💎 {diamonds.toLocaleString('en-US')}</Text>
          <IconButton
            icon={isPaused ? 'play' : 'pause'}
            onPress={onTogglePause}
            size={16}
            color={isPaused ? colors.success : colors.textPrimary}
            backgroundColor={isPaused ? colors.successSoft : colors.cardSoft}
          />
        </View>
      </View>

      <View style={styles.headerFooter}>
        <View style={styles.fuelPill}>
          <GameIcon name="fuel" size={12} color={colors.warning} />
          <Text style={styles.fuelPillText}>Yakıt {formatUnitPrice(fuelPrice, '/L')}</Text>
        </View>
      </View>
    </AppCard>
  );
}

function TutorialStepCard({
  title,
  description,
  ctaLabel,
  onPress,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  return (
    <AppCard variant="highlighted" style={styles.nextActionCard} padded>
      <View style={styles.tutorialBadgeWrap}>
        <StatusBadge label="Sıradaki Adım" variant="amber" size="sm" />
      </View>
      <Text style={styles.nextActionTitle}>{title}</Text>
      <Text style={styles.nextActionSubtitle}>{description}</Text>
      <ActionButton label={ctaLabel} onPress={onPress} variant="primary" />
    </AppCard>
  );
}

function NextActionCard({
  action,
  onPress,
}: {
  action: NextAction;
  onPress: () => void;
}) {
  return (
    <AppCard variant="highlighted" style={styles.nextActionCard} padded>
      <Text style={styles.nextActionTitle}>{action.title}</Text>
      <Text style={styles.nextActionSubtitle}>{action.subtitle}</Text>
      <ActionButton label={action.buttonLabel} onPress={onPress} variant="primary" />
    </AppCard>
  );
}

function CompactSummaryCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof GameIcon>['name'];
  children: React.ReactNode;
}) {
  return (
    <AppCard style={styles.summaryCard} padded>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryIconWrap}>
          <GameIcon name={icon} size={14} color={colors.accentBlue} />
        </View>
        <Text style={styles.summaryTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {children}
    </AppCard>
  );
}

function ExpenseSummaryCard({
  dailyFixed,
  weeklyLease,
}: {
  dailyFixed: number;
  weeklyLease: number;
}) {
  const safeDaily = Number.isFinite(dailyFixed) ? dailyFixed : 0;
  const safeWeekly = Number.isFinite(weeklyLease) ? weeklyLease : 0;

  return (
    <AppCard style={styles.expenseCard} padded>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryIconWrap}>
          <GameIcon name="expense" size={14} color={colors.danger} />
        </View>
        <Text style={styles.summaryTitle} numberOfLines={1}>
          Gider Özeti
        </Text>
      </View>
      <StatLine
        label="Günlük sabit gider"
        value={formatMoney(safeDaily)}
        valueColor={colors.danger}
      />
      <Text style={styles.expenseHint}>
        Günlük sabit gider; şoför maaşı, depo ve operasyon maliyetlerini içerir.
      </Text>
      <StatLine
        label="Aktif kiralık kamyon"
        value={`${formatMoney(safeWeekly)} / hafta`}
        valueColor={colors.accentAmber}
      />
      <Text style={styles.expenseHint}>
        Kiralık kamyon kirası haftalık peşin ödenir; günlük sabit gidere dahil değildir.
      </Text>
    </AppCard>
  );
}

function CashWarningCard({ cash }: { cash: number }) {
  return (
    <AppCard style={styles.warningCard} padded>
      <View style={styles.warningRow}>
        <GameIcon name="warning" size={14} color={colors.warning} />
        <Text style={styles.warningText}>
          Nakit rezervi düşük ({formatMoney(cash)}). Sabit giderlere dikkat et.
        </Text>
      </View>
    </AppCard>
  );
}

function DevelopmentItemRow({ item }: { item: DevelopmentItem }) {
  return (
    <AppCard style={styles.developmentItem} padded={false}>
      <View style={[styles.developmentAccent, { backgroundColor: item.accent }]} />
      <View style={styles.developmentContent}>
        <Text style={styles.developmentTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.developmentMessage} numberOfLines={2}>
          {item.message}
        </Text>
      </View>
    </AppCard>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function DashboardScreen({ onNavigate, onOpenWarehouse }: DashboardScreenProps) {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const activeTransfers = useGameStore((state) => state.activeTransfers) ?? [];
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const isPaused = useGameStore((state) => state.isPaused);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const tutorial = useGameStore((state) => state.tutorial);
  const notifyActiveDeliverySeen = useGameStore((state) => state.notifyActiveDeliverySeen);
  const syncMissionProgress = useGameStore((state) => state.syncMissionProgress);
  const { scrollBottomPadding } = useTabBarLayout();

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing'),
    [activeDeliveries],
  );

  React.useEffect(() => {
    syncMissionProgress();
  }, [syncMissionProgress, player?.completedContracts, financeLedger.length, activeDeliveries.length]);

  React.useEffect(() => {
    if (runningDeliveries.length > 0) {
      notifyActiveDeliverySeen();
    }
  }, [runningDeliveries.length, notifyActiveDeliverySeen]);

  const topOpportunities = useMemo(() => {
    const fuelPrice = getSafeFuelPrice(globalEconomy);
    const level = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
    const fleetTrucks = player?.trucks ?? [];
    const fleetDrivers = player?.drivers ?? [];
    return [...availableContracts]
      .filter(
        (contract) =>
          getContractAvailability(contract, fleetTrucks, fleetDrivers, level).canStart,
      )
      .sort((a, b) => {
        const profitA = estimateOpportunityProfit(a, fuelPrice);
        const profitB = estimateOpportunityProfit(b, fuelPrice);
        if (profitB !== profitA) return profitB - profitA;
        return b.payment - a.payment;
      })
      .slice(0, 2);
  }, [availableContracts, globalEconomy?.fuelPrice, player]);

  const deliveryPreview = useMemo(() => runningDeliveries.slice(0, 2), [runningDeliveries]);
  const extraDeliveryCount = Math.max(0, runningDeliveries.length - deliveryPreview.length);
  const transferPreview = useMemo(
    () => (activeTransfers ?? []).filter((transfer) => transfer.status === 'active').slice(0, 1),
    [activeTransfers],
  );

  const fleetSnapshot = useMemo(() => {
    const snapshotTrucks = player?.trucks ?? [];
    const snapshotDrivers = player?.drivers ?? [];
    return {
      totalTrucks: snapshotTrucks.length,
      idleTrucks: snapshotTrucks.filter((t) => t.status === 'idle' && !t.leaseExpired).length,
      idleDrivers: snapshotDrivers.filter((d) => d.status === 'idle').length,
    };
  }, [player]);

  const operationCosts = useMemo(() => {
    if (!player) {
      return { dailyFixed: 0, weeklyLeaseBurden: 0 };
    }
    const breakdown = calculateDailyOperatingCostBreakdown(player);
    return {
      dailyFixed: breakdown.total,
      weeklyLeaseBurden: getWeeklyLeaseBurden(player.trucks ?? []),
    };
  }, [player]);

  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];

  const recentDevelopments = useMemo(
    () => buildRecentDevelopments(marketNews, eventLog, 2),
    [marketNews, eventLog],
  );

  if (!player) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={colors.accentBlue} />
        <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
      </View>
    );
  }

  const levelProgress = getLevelProgress(player);
  const fuelPrice = getSafeFuelPrice(globalEconomy);
  const warehouseFillRatio = getWarehouseFillRatio(player, currentTime);
  const tradeProfitAvailable = hasProfitableWarehouseStock(player, currentTime);
  const playerDiamonds = Math.max(0, player.diamonds ?? 0);

  const companyScore = useMemo(
    () =>
      calculateCompanyScore({
        player,
        cities,
        products,
        financeLedger,
        currentTime,
      }),
    [player, cities, products, financeLedger, currentTime],
  );

  const nextAction = resolveNextAction(
    player.money,
    fleetSnapshot.totalTrucks,
    fleetSnapshot.idleTrucks,
    fleetSnapshot.idleDrivers,
    runningDeliveries,
    availableContracts,
    trucks,
    drivers,
    playerLevel,
    tradeProfitAvailable,
  );

  const showCashWarning =
    player.money < LOW_CASH_THRESHOLD && nextAction.target !== 'contracts';

  const handleNavigate = (tab: TabKey) => {
    try {
      onNavigate?.(tab);
    } catch {
      // Dashboard navigasyon hatası uygulamayı düşürmemeli.
    }
  };

  const handleNextAction = () => {
    if (nextAction.target === 'warehouse') {
      try {
        onOpenWarehouse?.();
      } catch {
        // Depo yönlendirme hatası uygulamayı düşürmemeli.
      }
      return;
    }
    handleNavigate(nextAction.target);
  };

  const showTutorialCard = tutorial?.isEnabled && !tutorial?.isCompleted;
  const tutorialStep = showTutorialCard
    ? getTutorialStep(tutorial.currentStepId)
    : undefined;

  const handleTutorialPress = () => {
    if (!tutorialStep) return;
    handleNavigate(tutorialStep.targetScreen);
  };

  return (
    <AppScreen
      scroll
      padding
      scrollBottomPadding={scrollBottomPadding}
      contentContainerStyle={styles.screenContent}
    >
      <CompanyHeaderCard
        companyName={player.companyName}
        level={levelProgress.level}
        money={player.money}
        diamonds={playerDiamonds}
        currentTime={currentTime}
        fuelPrice={fuelPrice}
        isPaused={isPaused}
        onTogglePause={isPaused ? resumeGame : pauseGame}
      />

      {showTutorialCard && tutorialStep ? (
        <TutorialStepCard
          title={tutorialStep.title}
          description={tutorialStep.description}
          ctaLabel={tutorialStep.ctaLabel}
          onPress={handleTutorialPress}
        />
      ) : (
        <NextActionCard action={nextAction} onPress={handleNextAction} />
      )}

      <StarterMissionsCard />

      {showCashWarning ? <CashWarningCard cash={player.money} /> : null}

      <View style={styles.summarySection}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <CompactSummaryCard title="Şirket Özeti" icon="company">
              <StatLine
                label="Nakit"
                value={formatMoney(player.money ?? 0)}
                valueColor={colors.success}
              />
              <StatLine
                label="Şirket Puanı"
                value={formatCompanyScore(companyScore ?? 0)}
                valueColor={colors.accentAmber}
              />
              <StatLine
                label="Level"
                value={`${levelProgress.level}`}
                valueColor={colors.accentAmber}
              />
              <StatLine
                label="İtibar"
                value={`${Math.round(player.reputation ?? 0)}/100`}
              />
              {!levelProgress.isMaxLevel ? (
                <View style={styles.xpBlock}>
                  <View style={styles.xpRow}>
                    <Text style={styles.statLineLabel} numberOfLines={1}>
                      XP
                    </Text>
                    <Text style={styles.xpValue} numberOfLines={1}>
                      {levelProgress.xp ?? 0} / {levelProgress.xpToNextLevel}
                    </Text>
                  </View>
                  <ProgressBar
                    progress={levelProgress.progressRatio}
                    color={colors.accentAmber}
                    height={4}
                  />
                </View>
              ) : (
                <StatLine label="XP" value="Maksimum" valueColor={colors.accentAmber} />
              )}
            </CompactSummaryCard>
          </View>

          <View style={styles.summaryCol}>
            <CompactSummaryCard title="Operasyon Özeti" icon="truck">
              <StatLine
                label="Boşta kamyon"
                value={`${fleetSnapshot.idleTrucks}`}
                valueColor={colors.success}
              />
              <StatLine
                label="Aktif teslimat"
                value={`${runningDeliveries.length}`}
                valueColor={colors.accentBlue}
              />
              <StatLine
                label="Müsait sözleşme"
                value={`${availableContracts.length}`}
                valueColor={colors.accentAmber}
              />
              <StatLine
                label="Depo doluluk"
                value={formatRatioPercent(warehouseFillRatio)}
              />
            </CompactSummaryCard>
          </View>
        </View>

        <ExpenseSummaryCard
          dailyFixed={operationCosts.dailyFixed ?? 0}
          weeklyLease={operationCosts.weeklyLeaseBurden ?? 0}
        />
      </View>

      {deliveryPreview.length > 0 ? (
        <>
          <SectionTitle title="Aktif Teslimatlar" />
          {deliveryPreview.map((delivery) => {
            const truck = player.trucks?.find((t) => t.id === delivery.truckId);
            const hoursLeft = Math.max(0, delivery.deadlineTime - currentTime);
            const statusVariant = getDeliveryStatusVariant(delivery.status);

            return (
              <AppCard key={delivery.id} style={styles.listCard} padded>
                <View style={styles.listCardHeader}>
                  <View style={styles.listCardTitleRow}>
                    <GameIcon name="route" size={16} color={colors.accentBlue} />
                    <Text style={styles.listCardTitle} numberOfLines={1}>
                      {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                    </Text>
                  </View>
                  <StatusBadge label={getDeliveryStatusLabel(delivery.status)} variant={statusVariant} size="sm" />
                </View>
                <Text style={styles.listCardMeta}>
                  {getProductName(delivery.productId)} · {delivery.amount.toFixed(1)} ton
                  {truck ? ` · ${truck.name}` : ''}
                </Text>
                <View style={styles.deliveryProgressRow}>
                  <ProgressBar progress={delivery.progress} color={colors.accentBlue} />
                  <Text style={styles.progressLabel}>{formatRatioPercent(delivery.progress)}</Text>
                </View>
                <View style={styles.listCardFooter}>
                  <Text style={styles.listCardFooterText}>Kalan: {formatDuration(hoursLeft)}</Text>
                  <Text style={[styles.listCardFooterText, { color: colors.success }]}>
                    {formatMoney(delivery.estimatedProfit)} kâr
                  </Text>
                </View>
              </AppCard>
            );
          })}
          {extraDeliveryCount > 0 ? (
            <Text style={styles.moreItemsHint}>+{extraDeliveryCount} teslimat daha yolda</Text>
          ) : null}
        </>
      ) : null}

      {transferPreview.length > 0 ? (
        <>
          <SectionTitle title="Boş Transfer" style={styles.sectionSpaced} />
          {transferPreview.map((transfer: TruckTransfer) => {
            const truck = player?.trucks?.find((candidate) => candidate.id === transfer.truckId);
            const hoursLeft = Math.max(0, transfer.estimatedArrivalAt - currentTime);
            return (
              <AppCard key={transfer.id} style={styles.listCard} padded>
                <View style={styles.listCardHeader}>
                  <View style={styles.listCardTitleRow}>
                    <GameIcon name="truck" size={16} color={colors.info} />
                    <Text style={styles.listCardTitle} numberOfLines={1}>
                      {getCityName(transfer.fromCityId)} → {getCityName(transfer.toCityId)}
                    </Text>
                  </View>
                  <StatusBadge label="Boş transfer" variant="blue" size="sm" />
                </View>
                <Text style={styles.listCardMeta}>
                  {truck?.name ?? 'Kamyon'} · {formatMoney(transfer.totalCost)} maliyet
                </Text>
                <View style={styles.deliveryProgressRow}>
                  <ProgressBar progress={transfer.progress} color={colors.info} />
                  <Text style={styles.progressLabel}>{formatRatioPercent(transfer.progress)}</Text>
                </View>
                <Text style={styles.listCardFooterText}>Kalan: {formatDuration(hoursLeft)}</Text>
              </AppCard>
            );
          })}
        </>
      ) : null}

      {topOpportunities.length > 0 ? (
        <>
          <SectionTitle title="En İyi Fırsatlar" style={styles.sectionSpaced} />
          {topOpportunities.map((contract) => (
            <AppCard key={contract.id} style={styles.opportunityCard} padded={false}>
              <View style={styles.opportunityCardInner}>
                <View style={styles.opportunityTopRow}>
                  <View style={styles.listCardTitleRow}>
                    <GameIcon name="contract" size={14} color={colors.accentAmber} />
                    <Text style={styles.opportunityRoute} numberOfLines={1}>
                      {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
                    </Text>
                  </View>
                  <StatusBadge
                    label={getContractRiskLabel(contract)}
                    variant={getContractRiskVariant(contract)}
                    size="sm"
                  />
                </View>
                <View style={styles.opportunityBottomRow}>
                  <Text style={styles.opportunityMeta} numberOfLines={1}>
                    {getProductName(contract.productId)} · {formatDuration(contract.deadlineHours)}
                  </Text>
                  <Text style={styles.opportunityPayment}>{formatMoney(contract.payment)}</Text>
                </View>
              </View>
            </AppCard>
          ))}
          <ActionButton
            label="Tüm Sözleşmeleri Gör"
            onPress={() => handleNavigate('contracts')}
            variant="secondary"
            style={styles.sectionAction}
          />
        </>
      ) : null}

      {recentDevelopments.length > 0 ? (
        <>
          <SectionTitle title="Son Gelişmeler" style={styles.sectionSpaced} />
          {recentDevelopments.map((item) => (
            <DevelopmentItemRow key={item.id} item={item} />
          ))}
        </>
      ) : null}
    </AppScreen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
    gap: spacing.md,
  },

  headerCard: {
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    color: colors.accentAmber,
  },
  companyName: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerMeta: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  cashValue: {
    ...typography.statValue,
    fontSize: 17,
    color: colors.success,
  },
  diamondValue: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '700',
  },
  headerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fuelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fuelPillText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  nextActionCard: {
    marginBottom: spacing.xs,
  },
  tutorialBadgeWrap: {
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  nextActionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.xs,
  },
  nextActionSubtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
  },

  warningCard: {
    backgroundColor: colors.warningSoft,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.warning,
  },

  summarySection: {
    gap: 10,
    marginBottom: spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCol: {
    flex: 1,
    minWidth: 0,
  },
  summaryCard: {
    flex: 1,
  },
  expenseCard: {
    paddingVertical: spacing.sm,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryIconWrap: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTitle: {
    ...typography.cardTitle,
    fontSize: 12,
  },
  expenseHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: spacing.xs,
    marginTop: -2,
  },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  statLineLabel: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    flexShrink: 1,
    marginRight: spacing.xs,
  },
  statLineValue: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 0,
    textAlign: 'right',
    maxWidth: '52%',
  },
  xpBlock: {
    marginTop: spacing.xs,
    gap: 4,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
  },
  xpValue: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
    flexShrink: 0,
    textAlign: 'right',
  },

  sectionSpaced: {
    marginTop: spacing.xs,
  },
  sectionAction: {
    marginBottom: spacing.xs,
  },

  listCard: {
    marginBottom: spacing.sm,
  },
  listCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  listCardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  listCardTitle: {
    ...typography.cardTitle,
    flex: 1,
    fontSize: 13,
  },
  listCardMeta: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  deliveryProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressLabel: {
    ...typography.caption,
    fontWeight: '700',
    minWidth: 34,
    textAlign: 'right',
  },
  listCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listCardFooterText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  moreItemsHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },

  opportunityCard: {
    marginBottom: spacing.sm,
  },
  opportunityCardInner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  opportunityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  opportunityRoute: {
    ...typography.cardTitle,
    fontSize: 13,
    flex: 1,
  },
  opportunityBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  opportunityMeta: {
    ...typography.caption,
    flex: 1,
  },
  opportunityPayment: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.accentAmber,
  },

  developmentItem: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
    padding: 0,
    overflow: 'hidden',
  },
  developmentAccent: {
    width: 4,
  },
  developmentContent: {
    flex: 1,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  developmentTitle: {
    ...typography.cardTitle,
    fontSize: 12,
    marginBottom: 2,
  },
  developmentMessage: {
    ...typography.caption,
    lineHeight: 16,
  },
});
