/**
 * LogistiCore - Ana Dashboard Ekranı
 *
 * Premium dark command center — şirket özeti, filo, fırsatlar ve olay akışı.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import InfoBadge from '../components/common/InfoBadge';
import type { TabKey } from '../components/BottomTabBar';
import {
  ActionButton,
  AppCard,
  AppScreen,
  EmptyState,
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
import { getLevelProgress, getNextUnlockForLevel } from '../simulation/leveling';
import { getRecentGameEvents, useGameStore } from '../store/gameStore';
import { colors, radius, spacing, typography } from '../theme';
import type { Contract, Delivery, FinanceLedgerEntry, GameEvent, MarketNews } from '../types/game';

interface DashboardScreenProps {
  onNavigate?: (tab: TabKey) => void;
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

function getNextUnlockLabel(level: number): string {
  const nextUnlock = getNextUnlockForLevel(level);
  if (!nextUnlock) return 'Tüm temel açılımlar tamamlandı';
  if (nextUnlock.status === 'coming_soon') return `${nextUnlock.title} · Yakında`;
  return nextUnlock.title;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NextActionType = TabKey;

interface NextAction {
  title: string;
  subtitle: string;
  buttonLabel: string;
  type: NextActionType;
}

function resolveNextAction(
  cash: number,
  truckCount: number,
  runningDeliveries: Delivery[],
  availableContracts: Contract[],
): NextAction {
  if (truckCount === 0) {
    return {
      title: 'Filonu büyüt',
      subtitle: 'İlk kamyonunu alarak taşımacılığa başlayabilirsin.',
      buttonLabel: 'Filo Mağazası',
      type: 'fleet',
    };
  }
  if (cash < LOW_CASH_THRESHOLD) {
    return {
      title: 'Nakit dikkat',
      subtitle: 'Düşük riskli kısa mesafe işler seçerek nakit akışını koru.',
      buttonLabel: 'Sözleşmelere Git',
      type: 'contracts',
    };
  }
  if (runningDeliveries.length > 0) {
    return {
      title: 'Teslimat yolda',
      subtitle: 'Aktif rotalarını harita üzerinden takip edebilirsin.',
      buttonLabel: 'Haritayı Aç',
      type: 'map',
    };
  }
  if (availableContracts.length > 0) {
    return {
      title: 'Yeni fırsatlar hazır',
      subtitle: 'Boştaki ekibinle yeni bir sözleşme başlatabilirsin.',
      buttonLabel: 'Sözleşmeleri Gör',
      type: 'contracts',
    };
  }
  return {
    title: 'Yeni iş bekleniyor',
    subtitle: 'Piyasa yeni fırsatlar oluşturdukça işler burada görünecek.',
    buttonLabel: 'İşleri Kontrol Et',
    type: 'contracts',
  };
}

function summarizeDailyFinance(
  ledger: FinanceLedgerEntry[],
  currentTime: number,
): { revenue: number; expense: number; netProfit: number } {
  const dayStart = Math.floor(currentTime / DAY_HOURS) * DAY_HOURS;
  let revenue = 0;
  let expense = 0;

  for (const entry of ledger ?? []) {
    if (entry.time < dayStart) continue;
    if (entry.type === 'income') revenue += entry.amount;
    else expense += entry.amount;
  }

  return { revenue, expense, netProfit: revenue - expense };
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

function getEventBadgeVariant(event: GameEvent): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (event.type === 'delivery' && event.title === 'Teslimat tamamlandı') return 'success';
  if (event.importance === 'high') return 'danger';
  if (event.importance === 'medium') return 'warning';
  return 'muted';
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

function MetricPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof GameIcon>['name'];
  children: React.ReactNode;
}) {
  return (
    <AppCard style={styles.metricPanel} padded>
      <View style={styles.metricPanelHeader}>
        <View style={styles.metricIconWrap}>
          <GameIcon name={icon} size={15} color={colors.accentBlue} />
        </View>
        <Text style={styles.metricPanelTitle}>{title}</Text>
      </View>
      {children}
    </AppCard>
  );
}

function CompanyHeaderCard({
  companyName,
  level,
  money,
  currentTime,
  isPaused,
  onTogglePause,
}: {
  companyName: string;
  level: number;
  money: number;
  currentTime: number;
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
    </AppCard>
  );
}

function FuelTrendPlaceholder() {
  return (
    <View style={styles.fuelTrend}>
      {[0.4, 0.55, 0.5, 0.65, 0.6, 0.72, 0.68].map((h, i) => (
        <View key={i} style={[styles.fuelTrendBar, { height: 18 * h }]} />
      ))}
    </View>
  );
}

function NewsItem({ news }: { news: MarketNews }) {
  const accent = getNewsAccent(news.importance);
  return (
    <AppCard style={styles.newsItem} padded={false} variant="default">
      <View style={[styles.newsAccent, { backgroundColor: accent }]} />
      <View style={styles.newsContent}>
        <Text style={styles.newsTitle} numberOfLines={1}>
          {news.title}
        </Text>
        <Text style={styles.newsMessage} numberOfLines={2}>
          {news.message}
        </Text>
      </View>
    </AppCard>
  );
}

function EventItem({ event }: { event: GameEvent }) {
  const accent = getEventAccent(event);
  return (
    <AppCard style={styles.newsItem} padded={false}>
      <View style={[styles.newsAccent, { backgroundColor: accent }]} />
      <View style={styles.newsContent}>
        <View style={styles.eventHeader}>
          <Text style={styles.newsTitle} numberOfLines={1}>
            {event.title}
          </Text>
          <StatusBadge label={event.type} variant={getEventBadgeVariant(event)} size="sm" />
        </View>
        <Text style={styles.newsMessage} numberOfLines={2}>
          {event.message}
        </Text>
      </View>
    </AppCard>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const isPaused = useGameStore((state) => state.isPaused);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const { tabBarHeight, bottomInset } = useTabBarLayout();
  const scrollBottomPadding = tabBarHeight + bottomInset + 96;

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const activeContracts = useMemo(
    () => contracts.filter((c) => c.status === 'active'),
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
      .slice(0, 3);
  }, [availableContracts, globalEconomy?.fuelPrice]);

  const deliveryPreview = useMemo(() => runningDeliveries.slice(0, 3), [runningDeliveries]);
  const extraDeliveryCount = Math.max(0, runningDeliveries.length - deliveryPreview.length);
  const recentNews = useMemo(() => marketNews.slice(0, 2), [marketNews]);
  const recentEvents = useMemo(
    () => dedupeDashboardEvents(getRecentGameEvents(eventLog, 12), 3),
    [eventLog],
  );

  const fleetSnapshot = useMemo(() => {
    const trucks = player?.trucks ?? [];
    const drivers = player?.drivers ?? [];
    return {
      totalTrucks: trucks.length,
      idleTrucks: trucks.filter((t) => t.status === 'idle').length,
      onRouteTrucks: trucks.filter((t) => t.status === 'on_route').length,
      totalDrivers: drivers.length,
      idleDrivers: drivers.filter((d) => d.status === 'idle').length,
    };
  }, [player]);

  const dailyFinance = useMemo(
    () => summarizeDailyFinance(financeLedger, currentTime),
    [financeLedger, currentTime],
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
  const nextUnlockLabel = getNextUnlockLabel(levelProgress.level);
  const nextAction = resolveNextAction(
    player.money,
    fleetSnapshot.totalTrucks,
    runningDeliveries,
    availableContracts,
  );

  const handleNavigate = (tab: TabKey) => {
    try {
      onNavigate?.(tab);
    } catch {
      // Dashboard navigasyon hatası uygulamayı düşürmemeli.
    }
  };

  const fuelPrice = globalEconomy?.fuelPrice ?? 0;

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
        isPaused={isPaused}
        onTogglePause={isPaused ? resumeGame : pauseGame}
      />

      <View style={styles.metricGrid}>
        <View style={styles.metricGridItem}>
          <MetricPanel title="Günlük Özet" icon="revenue">
            <StatLine label="Gelir" value={formatMoney(dailyFinance.revenue)} valueColor={colors.success} />
            <StatLine label="Gider" value={formatMoney(dailyFinance.expense)} valueColor={colors.danger} />
            <StatLine
              label="Net kâr"
              value={formatMoney(dailyFinance.netProfit)}
              valueColor={dailyFinance.netProfit >= 0 ? colors.success : colors.danger}
            />
          </MetricPanel>
        </View>

        <View style={styles.metricGridItem}>
          <MetricPanel title="Filo Durumu" icon="truck">
            <StatLine label="Kamyon" value={`${fleetSnapshot.totalTrucks}`} />
            <StatLine label="Şoför" value={`${fleetSnapshot.totalDrivers}`} />
            <StatLine label="Yolda" value={`${fleetSnapshot.onRouteTrucks}`} valueColor={colors.accentBlue} />
          </MetricPanel>
        </View>

        <View style={styles.metricGridItem}>
          <MetricPanel title="Şirket Durumu" icon="level">
            <View style={styles.reputationRow}>
              <Text style={styles.statLineLabel}>İtibar</Text>
              <View style={styles.reputationValueRow}>
                <Text style={styles.statLineValue}>{Math.round(player.reputation)}/100</Text>
                <InfoBadge
                  title="İtibar Nedir?"
                  description="İtibar, teslimat performansına göre değişir: başarılı teslimat +2, başarısız teslimat −5 puan. Şu an itibar hiçbir sözleşmeyi veya fiyatı etkilemiyor — yalnızca Finans ekranındaki şirket değeri hesabına katkı sağlıyor (her itibar puanı şirket değerine $100 ekler)."
                />
              </View>
            </View>
            <StatLine label="Seviye" value={`Level ${levelProgress.level}`} valueColor={colors.accentAmber} />
            <StatLine
              label="XP"
              value={
                levelProgress.isMaxLevel
                  ? 'Maksimum'
                  : `${levelProgress.xp} / ${levelProgress.xpToNextLevel}`
              }
              valueColor={colors.accentBlue}
            />
          </MetricPanel>
        </View>

        <View style={styles.metricGridItem}>
          <MetricPanel title="Sözleşme Durumu" icon="contract">
            <StatLine label="Müsait" value={`${availableContracts.length}`} valueColor={colors.accentAmber} />
            <StatLine label="Aktif" value={`${activeContracts.length || runningDeliveries.length}`} />
            <StatLine label="Tamamlanan" value={`${player.completedContracts ?? 0}`} valueColor={colors.success} />
          </MetricPanel>
        </View>
      </View>

      <AppCard style={styles.levelCard} padded>
        <View style={styles.levelHeader}>
          <View style={styles.levelTitleRow}>
            <Text style={styles.levelTitle}>Şirket Seviyesi</Text>
            <InfoBadge
              title="Seviye ve XP Nedir?"
              description="XP; teslimat tamamlayarak, kârlı ticaret yaparak, kamyon/şoför satın alarak ve depo açarak kazanılır. Seviye yükseldikçe daha yüksek tonajlı sözleşmeler, yeni kamyon modelleri, daha deneyimli şoför kademeleri ve daha fazla depo hakkı açılır. 'Sıradaki açılım' satırı, bir sonraki seviyede açılacak en yakın özelliği gösterir; tüm gelecek açılımları listelemez."
            />
          </View>
          <StatusBadge label={`Level ${levelProgress.level}`} variant="amber" size="md" />
        </View>
        <Text style={styles.xpLabel}>
          {levelProgress.isMaxLevel
            ? 'Maksimum seviye'
            : `XP: ${levelProgress.xp} / ${levelProgress.xpToNextLevel}`}
        </Text>
        <ProgressBar
          progress={levelProgress.isMaxLevel ? 1 : levelProgress.progressRatio}
          color={colors.accentAmber}
        />
        <Text style={styles.xpHint}>Sıradaki açılım: {nextUnlockLabel}</Text>
      </AppCard>

      <AppCard style={styles.fuelCard} padded>
        <View style={styles.fuelRow}>
          <View style={styles.fuelMain}>
            <View style={styles.metricPanelHeader}>
              <View style={styles.metricIconWrap}>
                <GameIcon name="fuel" size={15} color={colors.warning} />
              </View>
              <Text style={styles.metricPanelTitle}>Yakıt Fiyatı</Text>
            </View>
            <Text style={styles.fuelPrice}>${fuelPrice.toFixed(2)} / L</Text>
            <Text style={styles.fuelHint}>Güncel piyasa fiyatı</Text>
          </View>
          <FuelTrendPlaceholder />
        </View>
      </AppCard>

      <AppCard variant="highlighted" style={styles.ctaCard} padded>
        <Text style={styles.ctaTitle}>{nextAction.title}</Text>
        <Text style={styles.ctaSubtitle}>{nextAction.subtitle}</Text>
        <ActionButton
          label={nextAction.buttonLabel}
          onPress={() => handleNavigate(nextAction.type)}
          variant="primary"
        />
      </AppCard>

      <SectionTitle title="Aktif Teslimatlar" />
      {deliveryPreview.length === 0 ? (
        <EmptyState
          title="Şu anda yolda teslimat yok."
          icon="truck"
          message="Yeni bir sözleşme başlattığında rotalar burada görünecek."
        />
      ) : (
        deliveryPreview.map((delivery) => {
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
                <Text style={styles.listCardFooterText}>
                  Kalan: {formatDuration(hoursLeft)}
                </Text>
                <Text style={[styles.listCardFooterText, { color: colors.success }]}>
                  {formatMoney(delivery.estimatedProfit)} tahmini
                </Text>
              </View>
            </AppCard>
          );
        })
      )}
      {extraDeliveryCount > 0 ? (
        <Text style={styles.moreItemsHint}>+{extraDeliveryCount} teslimat daha yolda</Text>
      ) : null}

      <SectionTitle title="En İyi Fırsatlar" style={styles.sectionSpaced} />
      {topOpportunities.length === 0 ? (
        <EmptyState
          title="Henüz fırsat yok"
          message="Piyasa yenilendiğinde en iyi sözleşmeler burada listelenecek."
          icon="contract"
        />
      ) : (
        topOpportunities.map((contract) => (
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
        ))
      )}
      <ActionButton
        label="Tüm Sözleşmeleri Gör"
        onPress={() => handleNavigate('contracts')}
        variant="secondary"
        style={styles.sectionAction}
      />

      <SectionTitle title="Piyasa Haberleri" style={styles.sectionSpaced} />
      {recentNews.length === 0 ? (
        <EmptyState title="Henüz haber yok" icon="market" />
      ) : (
        recentNews.map((news) => <NewsItem key={news.id} news={news} />)
      )}

      <SectionTitle title="Son Olaylar" style={styles.sectionSpaced} />
      {recentEvents.length === 0 ? (
        <EmptyState title="Henüz olay kaydı yok" icon="notification" />
      ) : (
        recentEvents.map((event) => <EventItem key={event.id} event={event} />)
      )}
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

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricGridItem: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 150,
  },
  metricPanel: {
    flex: 1,
  },
  metricPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricPanelTitle: {
    ...typography.cardTitle,
    fontSize: 13,
  },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  statLineLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  statLineValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  reputationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  reputationValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  levelCard: {
    marginTop: spacing.xs,
  },
  levelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  levelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelTitle: {
    ...typography.label,
    textTransform: 'uppercase',
  },
  xpLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  xpHint: {
    ...typography.caption,
    marginTop: spacing.sm,
  },

  fuelCard: {
    marginTop: spacing.xs,
  },
  fuelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fuelMain: {
    flex: 1,
  },
  fuelPrice: {
    ...typography.statValue,
    fontSize: 22,
    marginTop: spacing.xs,
  },
  fuelHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  fuelTrend: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 28,
    marginLeft: spacing.md,
  },
  fuelTrendBar: {
    width: 5,
    borderRadius: 2,
    backgroundColor: colors.accentBlue,
    opacity: 0.55,
  },

  ctaCard: {
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  ctaTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.xs,
  },
  ctaSubtitle: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
  },

  sectionSpaced: {
    marginTop: spacing.sm,
  },
  sectionAction: {
    marginBottom: spacing.sm,
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
  },
  listCardMeta: {
    ...typography.bodySmall,
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
    marginBottom: spacing.sm,
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

  newsItem: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
    padding: 0,
    overflow: 'hidden',
  },
  newsAccent: {
    width: 4,
  },
  newsContent: {
    flex: 1,
    padding: spacing.md,
  },
  newsTitle: {
    ...typography.cardTitle,
    fontSize: 12,
    marginBottom: 2,
  },
  newsMessage: {
    ...typography.caption,
    lineHeight: 16,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 2,
  },
});
