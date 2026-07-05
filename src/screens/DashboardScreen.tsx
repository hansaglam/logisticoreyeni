/**
 * LogistiCore - Ana Dashboard Ekranı
 *
 * Sade, aksiyon odaklı komuta merkezi — özet metrikler, sonraki adım ve kritik akış.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { TabKey } from '../components/BottomTabBar';
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
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { deliveryBalance } from '../config/balance';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { getLevelProgress } from '../simulation/leveling';
import {
  calculateTradeProfit,
  getCityProductMarketPrice,
  getWarehouseUsedCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import { getRecentGameEvents, useGameStore } from '../store/gameStore';
import { colors, radius, spacing, typography } from '../theme';
import type { Contract, Delivery, GameEvent, MarketNews, Player } from '../types/game';

interface DashboardScreenProps {
  onNavigate?: (tab: TabKey) => void;
  onOpenWarehouse?: () => void;
}

const LOW_CASH_THRESHOLD = 8_000;
const DAY_HOURS = 24;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTime(hours: number): string {
  const totalHours = Math.max(0, Math.floor(hours));
  const day = Math.floor(totalHours / DAY_HOURS) + 1;
  const hourOfDay = totalHours % DAY_HOURS;
  return `Gün ${day} · ${hourOfDay.toString().padStart(2, '0')}:00`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatDuration(hours: number): string {
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / DAY_HOURS);
  const remainingHours = totalHours % DAY_HOURS;
  if (days > 0) return `${days}g ${remainingHours}s`;
  return `${remainingHours}s`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as keyof typeof PRODUCT_BY_ID]?.name ?? productId;
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

function resolveNextAction(
  cash: number,
  truckCount: number,
  idleTrucks: number,
  idleDrivers: number,
  runningDeliveries: Delivery[],
  availableContracts: Contract[],
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
  if (idleTrucks > 0 && idleDrivers > 0 && availableContracts.length > 0) {
    return {
      title: 'Yeni sözleşme hazır',
      subtitle: 'Boştaki ekibinle yeni bir teslimat başlatabilirsin.',
      buttonLabel: 'Sözleşmeleri Gör',
      target: 'contracts',
    };
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
    return {
      title: 'Yeni sözleşme hazır',
      subtitle: 'Boştaki ekibinle yeni bir teslimat başlatabilirsin.',
      buttonLabel: 'Sözleşmeleri Gör',
      target: 'contracts',
    };
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
    const city = CITIES_BY_ID[warehouse.cityId];
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
      <Text style={styles.statLineLabel}>{label}</Text>
      <Text style={[styles.statLineValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

function CompanyHeaderCard({
  companyName,
  level,
  money,
  currentTime,
  fuelPrice,
  isPaused,
  onTogglePause,
}: {
  companyName: string;
  level: number;
  money: number;
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
              Level {level} · {formatTime(currentTime)}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.cashValue}>{formatMoney(money)}</Text>
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
          <Text style={styles.fuelPillText}>Yakıt ${fuelPrice.toFixed(2)}/L</Text>
        </View>
      </View>
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
        <Text style={styles.summaryTitle}>{title}</Text>
      </View>
      {children}
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
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const isPaused = useGameStore((state) => state.isPaused);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const { tabBarHeight, bottomInset } = useTabBarLayout();
  const scrollBottomPadding = tabBarHeight + bottomInset + 110;

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing'),
    [activeDeliveries],
  );

  const topOpportunities = useMemo(() => {
    const fuelPrice = globalEconomy?.fuelPrice ?? 0;
    return [...availableContracts]
      .sort((a, b) => {
        const profitA = estimateOpportunityProfit(a, fuelPrice);
        const profitB = estimateOpportunityProfit(b, fuelPrice);
        if (profitB !== profitA) return profitB - profitA;
        return b.payment - a.payment;
      })
      .slice(0, 2);
  }, [availableContracts, globalEconomy?.fuelPrice]);

  const deliveryPreview = useMemo(() => runningDeliveries.slice(0, 2), [runningDeliveries]);
  const extraDeliveryCount = Math.max(0, runningDeliveries.length - deliveryPreview.length);

  const fleetSnapshot = useMemo(() => {
    const trucks = player?.trucks ?? [];
    const drivers = player?.drivers ?? [];
    return {
      totalTrucks: trucks.length,
      idleTrucks: trucks.filter((t) => t.status === 'idle').length,
      idleDrivers: drivers.filter((d) => d.status === 'idle').length,
    };
  }, [player]);

  const recentDevelopments = useMemo(
    () => buildRecentDevelopments(marketNews, eventLog, 3),
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
  const fuelPrice = globalEconomy?.fuelPrice ?? 0;
  const warehouseFillRatio = getWarehouseFillRatio(player, currentTime);
  const tradeProfitAvailable = hasProfitableWarehouseStock(player, currentTime);

  const nextAction = resolveNextAction(
    player.money,
    fleetSnapshot.totalTrucks,
    fleetSnapshot.idleTrucks,
    fleetSnapshot.idleDrivers,
    runningDeliveries,
    availableContracts,
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
        currentTime={currentTime}
        fuelPrice={fuelPrice}
        isPaused={isPaused}
        onTogglePause={isPaused ? resumeGame : pauseGame}
      />

      <NextActionCard action={nextAction} onPress={handleNextAction} />

      {showCashWarning ? <CashWarningCard cash={player.money} /> : null}

      <View style={styles.summaryRow}>
        <View style={styles.summaryCol}>
          <CompactSummaryCard title="Şirket Özeti" icon="company">
            <StatLine label="Nakit" value={formatMoney(player.money)} valueColor={colors.success} />
            <StatLine label="Level" value={`${levelProgress.level}`} valueColor={colors.accentAmber} />
            <StatLine label="İtibar" value={`${Math.round(player.reputation)}/100`} />
            {!levelProgress.isMaxLevel ? (
              <View style={styles.xpBlock}>
                <View style={styles.xpRow}>
                  <Text style={styles.statLineLabel}>XP</Text>
                  <Text style={styles.xpValue}>
                    {levelProgress.xp} / {levelProgress.xpToNextLevel}
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
            <StatLine label="Boşta kamyon" value={`${fleetSnapshot.idleTrucks}`} />
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
            <StatLine label="Depo doluluk" value={formatPercent(warehouseFillRatio)} />
          </CompactSummaryCard>
        </View>
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
                  <Text style={styles.progressLabel}>{formatPercent(delivery.progress)}</Text>
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

  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryCol: {
    flex: 1,
    minWidth: 0,
  },
  summaryCard: {
    flex: 1,
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
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  statLineLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statLineValue: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  xpBlock: {
    marginTop: spacing.xs,
    gap: 4,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpValue: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
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
