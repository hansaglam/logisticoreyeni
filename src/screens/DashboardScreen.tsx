/**
 * LogistiCore - Ana Dashboard Ekranı
 *
 * Oyuncuya şirket durumunu özetleyen, sonraki adımı öneren sade ana ekran.
 */

import React, { useMemo } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useGameStore, getRecentGameEvents } from '../store/gameStore';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import type {
  Contract,
  Delivery,
  GameEvent,
  GameEventImportance,
  MarketNews,
  MarketNewsImportance,
} from '../types/game';

type DashboardNavigateTab = 'contracts' | 'map';

interface DashboardScreenProps {
  onNavigate?: (tab: DashboardNavigateTab) => void;
}

const COLORS = {
  background: '#070A12',
  card: '#111827',
  cardAlt: '#121826',
  border: '#1F2A3C',
  primary: '#F59E0B',
  secondary: '#38BDF8',
  success: '#22C55E',
  danger: '#EF4444',
  textPrimary: '#F8FAFC',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
};

const LOW_CASH_THRESHOLD = 8_000;

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTime(hours: number): string {
  const totalHours = Math.max(0, Math.floor(hours));
  const day = Math.floor(totalHours / 24) + 1;
  const hourOfDay = totalHours % 24;
  return `Gün ${day} • ${hourOfDay.toString().padStart(2, '0')}:00`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatDuration(hours: number): string {
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (days > 0) return `${days}g ${remainingHours}s`;
  return `${remainingHours}s`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as keyof typeof PRODUCT_BY_ID]?.name ?? productId;
}

function getImportanceColor(importance: MarketNewsImportance | GameEventImportance): string {
  switch (importance) {
    case 'high':
      return COLORS.danger;
    case 'medium':
      return COLORS.secondary;
    default:
      return COLORS.textMuted;
  }
}

function getEventAccentColor(event: GameEvent): string {
  if (event.type === 'delivery' && event.title === 'Teslimat tamamlandı') {
    return COLORS.success;
  }
  return getImportanceColor(event.importance);
}

function formatDeliveryEventSubtitle(message: string): string {
  const profitMatch = message.match(/Net kâr:\s*(\$[\d,]+)/);
  const routeMatch = message.match(/^(.+?)\s+teslimatı/);
  if (routeMatch && profitMatch) {
    return `${routeMatch[1]} · +${profitMatch[1]} net kâr`;
  }
  return message;
}

function getDeliveryStatusColor(status: Delivery['status']): string {
  switch (status) {
    case 'on_route':
      return COLORS.secondary;
    case 'preparing':
      return COLORS.primary;
    case 'completed':
      return COLORS.success;
    default:
      return COLORS.danger;
  }
}

type NextActionType = 'contracts' | 'map';

interface NextAction {
  title: string;
  subtitle: string;
  buttonLabel: string;
  type: NextActionType;
}

function resolveNextAction(
  cash: number,
  runningDeliveries: Delivery[],
  availableContracts: Contract[],
): NextAction {
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
      subtitle: 'Boştaki kamyonunla yeni bir sözleşme başlatabilirsin.',
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function CompanyStatRow({
  label,
  value,
  valueColor = COLORS.textPrimary,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.companyStatRow}>
      <Text style={styles.companyStatLabel}>{label}</Text>
      <Text style={[styles.companyStatValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

export default function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);
  const isPaused = useGameStore((state) => state.isPaused);

  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const { scrollBottomPadding } = useTabBarLayout();

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing'),
    [activeDeliveries],
  );

  const topOpportunities = useMemo(
    () => [...availableContracts].sort((a, b) => b.payment - a.payment).slice(0, 2),
    [availableContracts],
  );

  const recentNews = useMemo(() => marketNews.slice(0, 2), [marketNews]);
  const recentEvents = useMemo(() => getRecentGameEvents(eventLog, 3), [eventLog]);
  const latestDeliveryCompletion = useMemo(
    () => eventLog.find((event) => event.type === 'delivery' && event.title === 'Teslimat tamamlandı'),
    [eventLog],
  );

  const deliveryPreview = useMemo(() => runningDeliveries.slice(0, 2), [runningDeliveries]);

  const fleetSnapshot = useMemo(() => {
    const trucks = player?.trucks ?? [];
    const drivers = player?.drivers ?? [];
    const idleTrucks = trucks.filter((t) => t.status === 'idle').length;
    const onRouteTrucks = trucks.filter((t) => t.status === 'on_route').length;
    const idleDrivers = drivers.filter((d) => d.status === 'idle').length;
    const avgCondition =
      trucks.length > 0
        ? trucks.reduce((sum, t) => sum + t.condition, 0) / trucks.length
        : 0;
    return {
      totalTrucks: trucks.length,
      idleTrucks,
      onRouteTrucks,
      totalDrivers: drivers.length,
      idleDrivers,
      avgCondition,
    };
  }, [player]);

  if (!player) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const nextAction = resolveNextAction(player.money, runningDeliveries, availableContracts);

  const handleNextAction = () => {
    try {
      if (nextAction.type === 'map') {
        onNavigate?.('map');
        return;
      }
      onNavigate?.('contracts');
    } catch {
      // Internal test: dashboard aksiyon hatası uygulamayı düşürmemeli.
    }
  };

  const availableContractColor =
    availableContracts.length === 0 ? COLORS.primary : COLORS.textPrimary;
  const activeDeliveryColor =
    runningDeliveries.length === 0 ? COLORS.secondary : COLORS.textPrimary;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.gameTitle}>LogistiCore</Text>
            <Text style={styles.companyName}>{player.companyName}</Text>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.headerMoney}>{formatMoney(player.money)}</Text>
            <View style={styles.headerMetaRow}>
              <Text style={styles.headerTime}>{formatTime(currentTime)}</Text>
              <TouchableOpacity
                style={[styles.pauseButton, isPaused && styles.pauseButtonActive]}
                onPress={isPaused ? resumeGame : pauseGame}
                activeOpacity={0.85}
                accessibilityLabel={isPaused ? 'Devam et' : 'Duraklat'}
              >
                <Text style={styles.pauseButtonText}>{isPaused ? '▶' : '⏸'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.companyCard}>
          <Text style={styles.companyCardTitle}>Şirket Özeti</Text>
          <CompanyStatRow label="Nakit" value={formatMoney(player.money)} valueColor={COLORS.primary} />
          <CompanyStatRow
            label="İtibar"
            value={`${Math.round(player.reputation)}/100`}
            valueColor={COLORS.success}
          />
          <CompanyStatRow
            label="Filo"
            value={`${fleetSnapshot.idleTrucks} boşta · ${fleetSnapshot.onRouteTrucks} yolda`}
            valueColor={COLORS.secondary}
          />
          <CompanyStatRow
            label="Aktif teslimat"
            value={`${runningDeliveries.length}`}
            valueColor={activeDeliveryColor}
          />
          <CompanyStatRow
            label="Müsait sözleşme"
            value={`${availableContracts.length}`}
            valueColor={availableContractColor}
          />
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.actionTitle}>{nextAction.title}</Text>
          <Text style={styles.actionSubtitle}>{nextAction.subtitle}</Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleNextAction} activeOpacity={0.85}>
            <Text style={styles.actionButtonText}>{nextAction.buttonLabel}</Text>
          </TouchableOpacity>
        </View>

        <Section title="Aktif Teslimatlar">
          {deliveryPreview.length === 0 ? (
            <View style={styles.emptyCardCompact}>
              <Text style={styles.emptyText}>Şu anda yolda teslimat yok.</Text>
            </View>
          ) : (
            deliveryPreview.map((delivery) => (
              <View key={delivery.id} style={styles.previewCard}>
                <View style={styles.previewHeaderRow}>
                  <Text style={styles.previewRoute} numberOfLines={1}>
                    {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                  </Text>
                  <Text style={[styles.previewBadge, { color: getDeliveryStatusColor(delivery.status) }]}>
                    {formatPercent(delivery.progress)}
                  </Text>
                </View>
                <Text style={styles.previewSubtext}>
                  {getProductName(delivery.productId)} · {delivery.amount.toFixed(1)} ton
                </Text>
                <ProgressBar progress={delivery.progress} color={getDeliveryStatusColor(delivery.status)} />
              </View>
            ))
          )}
        </Section>

        <Section title="Piyasa Haberleri">
          {recentNews.length === 0 ? (
            <View style={styles.emptyCardCompact}>
              <Text style={styles.emptyText}>Henüz haber yok.</Text>
            </View>
          ) : (
            recentNews.map((news: MarketNews) => (
              <View
                key={news.id}
                style={[styles.newsCard, { borderLeftColor: getImportanceColor(news.importance) }]}
              >
                <Text style={styles.newsTitle} numberOfLines={1}>
                  {news.title}
                </Text>
                <Text style={styles.newsMessage} numberOfLines={2}>
                  {news.message}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Son Olaylar">
          {latestDeliveryCompletion ? (
            <View style={styles.deliverySuccessCard}>
              <Text style={styles.deliverySuccessTitle}>Teslimat tamamlandı</Text>
              <Text style={styles.deliverySuccessSubtitle}>
                {formatDeliveryEventSubtitle(latestDeliveryCompletion.message)}
              </Text>
            </View>
          ) : null}

          {recentEvents.length === 0 ? (
            <View style={styles.emptyCardCompact}>
              <Text style={styles.emptyText}>Henüz olay kaydı yok.</Text>
            </View>
          ) : (
            recentEvents.map((event: GameEvent) => (
              <View
                key={event.id}
                style={[styles.newsCard, { borderLeftColor: getEventAccentColor(event) }]}
              >
                <View style={styles.eventHeaderRow}>
                  <Text style={styles.newsTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <View
                    style={[
                      styles.eventBadge,
                      { backgroundColor: `${getEventAccentColor(event)}22` },
                    ]}
                  >
                    <Text
                      style={[styles.eventBadgeText, { color: getEventAccentColor(event) }]}
                    >
                      {event.type}
                    </Text>
                  </View>
                </View>
                <Text style={styles.newsMessage} numberOfLines={2}>
                  {event.message}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="En İyi Fırsatlar">
          {topOpportunities.length === 0 ? (
            <View style={styles.emptyCardCompact}>
              <Text style={styles.emptyText}>
                Henüz fırsat yok. Piyasa yenilendiğinde burada listelenecek.
              </Text>
            </View>
          ) : (
            topOpportunities.map((contract) => (
              <View key={contract.id} style={styles.previewCard}>
                <View style={styles.previewHeaderRow}>
                  <Text style={styles.previewRoute} numberOfLines={1}>
                    {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
                  </Text>
                  <Text style={styles.previewPayment}>{formatMoney(contract.payment)}</Text>
                </View>
                <Text style={styles.previewSubtext}>
                  {getProductName(contract.productId)} · {formatDuration(contract.deadlineHours)} süre
                </Text>
              </View>
            ))
          )}
        </Section>

        <View style={styles.fleetSnapshot}>
          <Text style={styles.fleetSnapshotText}>
            Kamyon: {fleetSnapshot.idleTrucks}/{fleetSnapshot.totalTrucks} boşta
          </Text>
          <Text style={styles.fleetSnapshotDivider}>·</Text>
          <Text style={styles.fleetSnapshotText}>
            Şoför: {fleetSnapshot.idleDrivers}/{fleetSnapshot.totalDrivers} boşta
          </Text>
          <Text style={styles.fleetSnapshotDivider}>·</Text>
          <Text style={styles.fleetSnapshotText}>
            Ort. kondisyon {Math.round(fleetSnapshot.avgCondition)}%
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: STATUS_BAR_HEIGHT + 6,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: UI.spacing.screen,
    paddingTop: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerRight: {
    alignItems: 'flex-end',
    minWidth: 120,
  },
  gameTitle: {
    color: COLORS.primary,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  companyName: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  headerMoney: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  headerTime: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  pauseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseButtonActive: {
    borderColor: COLORS.success,
    backgroundColor: '#0F1A14',
  },
  pauseButtonText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  companyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 16,
  },
  companyCardTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  companyStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(31, 42, 60, 0.7)',
  },
  companyStatLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  companyStatValue: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: 12,
  },

  actionCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
    padding: 18,
    marginBottom: 18,
  },
  actionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  actionSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonText: {
    color: '#0B1220',
    fontSize: 13,
    fontWeight: '800',
  },

  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyCardCompact: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },

  previewCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewRoute: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  previewBadge: {
    fontSize: 12,
    fontWeight: '800',
  },
  previewPayment: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  previewSubtext: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
  },

  deliverySuccessCard: {
    backgroundColor: '#0F1F17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#166534',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  deliverySuccessTitle: {
    color: COLORS.success,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  deliverySuccessSubtitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    lineHeight: 17,
  },

  newsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  newsTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  newsMessage: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  eventBadge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  eventBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  fleetSnapshot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 11,
    paddingHorizontal: 10,
    marginTop: 2,
  },
  fleetSnapshotText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  fleetSnapshotDivider: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginHorizontal: 6,
  },
});
