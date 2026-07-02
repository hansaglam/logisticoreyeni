/**
 * LogistiCore - Türkiye Lojistik Ağı ekranı
 *
 * Mobil tycoon tarzı network overview — coğrafi harita yok, zoom/pan yok.
 * TODO V2: Unlock Europe/global network after company expansion
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import NetworkMapCanvas, { type NetworkFilterKey } from '../components/map/NetworkMapCanvas';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useGameStore } from '../store/gameStore';
import { getNetworkCityPosition } from '../data/networkPositions';
import { STATUS_BAR_HEIGHT } from '../theme/ui';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import type { Contract, Delivery, DeliveryStatus, ProductId } from '../types/game';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];
const STATUS_MESSAGE_TIMEOUT_MS = 3000;

const COLORS = {
  background: '#050A12',
  card: '#0F172A',
  card2: '#111827',
  border: '#1E293B',
  accent: '#F59E0B',
  cyan: '#38BDF8',
  green: '#22C55E',
  red: '#EF4444',
  muted: '#94A3B8',
  text: '#F9FAFB',
};

const MAP_FILTERS: { key: NetworkFilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'trucks', label: 'Kamyonlar' },
  { key: 'depots', label: 'Depolar' },
  { key: 'routes', label: 'Rotalar' },
  { key: 'opportunities', label: 'Fırsatlar' },
];

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDistance(km: number): string {
  return `${Math.round(km)} km`;
}

function formatRemainingHours(currentTime: number, estimatedArrivalTime: number): string {
  const remaining = Math.max(0, estimatedArrivalTime - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  return `${hrs} sa ${mins.toString().padStart(2, '0')} dk kaldı`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getDeliveryStatusLabel(status: DeliveryStatus): string {
  if (status === 'preparing') return 'Yükleniyor';
  if (status === 'on_route') return 'Yolda';
  return 'Aktif';
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

interface BestOpportunityCardProps {
  displayDelivery?: Delivery;
  bestContract?: Contract;
  runningDeliveries: Delivery[];
  currentTime: number;
  onDeliverySelect: (deliveryId: string) => void;
  onContractPress: () => void;
  onRefresh: () => void;
}

function BestOpportunityCard({
  displayDelivery,
  bestContract,
  runningDeliveries,
  currentTime,
  onDeliverySelect,
  onContractPress,
  onRefresh,
}: BestOpportunityCardProps) {
  if (displayDelivery) {
    return (
      <View style={styles.infoCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardTitleBlock}>
            <Text style={styles.cardEyebrow}>Aktif Teslimat</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {getCityName(displayDelivery.originCityId)} → {getCityName(displayDelivery.destinationCityId)}
            </Text>
          </View>
          <Text style={styles.cardStatusBadge}>{getDeliveryStatusLabel(displayDelivery.status)}</Text>
        </View>

        <View style={styles.cardBodyRow}>
          <View style={styles.cardThumb}>
            <Text style={styles.cardThumbIcon}>🚚</Text>
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardMetaLine} numberOfLines={1}>
              {getProductName(displayDelivery.productId)} · {displayDelivery.amount.toFixed(1)} ton ·{' '}
              {formatPercent(displayDelivery.progress)} · {formatDistance(displayDelivery.distanceKm)}
            </Text>
            <Text style={styles.cardMetaLine} numberOfLines={1}>
              {formatRemainingHours(currentTime, displayDelivery.estimatedArrivalTime)} · Tahmini kâr{' '}
              {formatMoney(displayDelivery.estimatedProfit ?? 0)}
            </Text>
            <ProgressBar progress={displayDelivery.progress} color={COLORS.green} />
          </View>
        </View>

        {runningDeliveries.length > 1 ? (
          <View style={styles.deliveryPickerRow}>
            {runningDeliveries.map((delivery) => {
              const isActive = delivery.id === displayDelivery.id;
              return (
                <TouchableOpacity
                  key={delivery.id}
                  style={[styles.deliveryPickerChip, isActive && styles.deliveryPickerChipActive]}
                  onPress={() => onDeliverySelect(delivery.id)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.deliveryPickerText, isActive && styles.deliveryPickerTextActive]}
                    numberOfLines={1}
                  >
                    {getCityName(delivery.originCityId).slice(0, 3)}→
                    {getCityName(delivery.destinationCityId).slice(0, 3)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  }

  if (bestContract) {
    return (
      <View style={styles.infoCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardTitleBlock}>
            <Text style={styles.cardEyebrow}>En İyi Fırsat</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {getCityName(bestContract.originCityId)} → {getCityName(bestContract.destinationCityId)}
            </Text>
            <Text style={styles.cardMetaLine} numberOfLines={1}>
              {getProductName(bestContract.productId)} · {bestContract.amount.toFixed(1)} ton ·{' '}
              {formatDistance(bestContract.distanceKm)}
            </Text>
            <Text style={styles.cardMetaLine} numberOfLines={1}>
              {bestContract.deadlineHours.toFixed(0)}s teslim süresi
            </Text>
          </View>
          <Text style={styles.cardPayment}>{formatMoney(bestContract.payment)}</Text>
        </View>

        <TouchableOpacity style={styles.cardButton} onPress={onContractPress} activeOpacity={0.85}>
          <Text style={styles.cardButtonText}>Sözleşmeyi Gör</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.infoCard}>
      <Text style={styles.cardEmptyTitle}>Aktif teslimat veya fırsat yok</Text>
      <Text style={styles.cardMetaLine}>
        İşler ekranından sözleşme başlat; kamyonlar ağ haritasında canlı takip edilir.
      </Text>
      <TouchableOpacity style={styles.cardButton} onPress={onRefresh} activeOpacity={0.85}>
        <Text style={styles.cardButtonText}>Piyasayı Yenile</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MapScreen() {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);
  const refreshMarketSnapshot = useGameStore((state) => state.refreshMarketSnapshot);
  const { tabBarHeight, bottomInset } = useTabBarLayout();

  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [selectedMapFilter, setSelectedMapFilter] = useState<NetworkFilterKey>('all');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => ACTIVE_DELIVERY_STATUSES.includes(d.status)),
    [activeDeliveries],
  );

  useEffect(() => {
    if (runningDeliveries.length === 0) {
      setSelectedDeliveryId(null);
      return;
    }
    if (selectedDeliveryId && runningDeliveries.some((d) => d.id === selectedDeliveryId)) {
      return;
    }
    setSelectedDeliveryId(runningDeliveries[0]?.id ?? null);
  }, [runningDeliveries, selectedDeliveryId]);

  const mapCities = useMemo(
    () => cities.filter((city) => getNetworkCityPosition(city.id) != null),
    [cities],
  );

  const routeCount = useMemo(() => {
    const keys = new Set<string>();
    for (const route of routes) {
      if (!getNetworkCityPosition(route.fromCityId) || !getNetworkCityPosition(route.toCityId)) continue;
      keys.add([route.fromCityId, route.toCityId].sort().join('|'));
    }
    return keys.size;
  }, [routes]);

  const depotCityIds = useMemo(
    () => (player?.warehouses ?? []).map((warehouse) => warehouse.cityId),
    [player?.warehouses],
  );

  const idleTrucks = useMemo(
    () => (player?.trucks ?? []).filter((truck) => truck.status === 'idle'),
    [player?.trucks],
  );

  const selectedDelivery: Delivery | undefined = useMemo(
    () => runningDeliveries.find((d) => d.id === selectedDeliveryId) ?? runningDeliveries[0],
    [runningDeliveries, selectedDeliveryId],
  );

  const userSelectedContract = useMemo(() => {
    if (!selectedContractId) return null;
    return availableContracts.find((c) => c.id === selectedContractId) ?? null;
  }, [availableContracts, selectedContractId]);

  const bestContract: Contract | undefined = useMemo(() => {
    if (runningDeliveries.length > 0) return undefined;
    if (selectedContractId) {
      const picked = availableContracts.find((c) => c.id === selectedContractId);
      if (picked) return picked;
    }
    return [...availableContracts].sort((a, b) => b.payment - a.payment)[0];
  }, [availableContracts, runningDeliveries.length, selectedContractId]);

  const handleRefreshMarket = () => {
    try {
      refreshMarketSnapshot();
      setStatusMessage('Piyasa güncellendi');
    } catch {
      setStatusMessage('Piyasa güncellenemedi');
    }
  };

  const handleDeliveryPress = (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
    setSelectedMapFilter('trucks');
  };

  const handleCityPress = (cityId: string) => {
    setSelectedCityId(cityId);
  };

  const handleContractPress = (contractId: string) => {
    setSelectedContractId(contractId);
    setSelectedMapFilter('opportunities');
    setStatusMessage('Fırsat seçildi — alt kartta detayları gör');
  };

  const handleGoToContractsHint = () => {
    setStatusMessage('Sözleşmeler ekranından işi başlatabilirsin.');
  };

  if (!player) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (cities.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyStateTitle}>Harita verisi yok</Text>
          <Text style={styles.emptyStateSubtitle}>Şehir verileri henüz yüklenmedi.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: tabBarHeight + bottomInset + 48 },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => {}} activeOpacity={0.8}>
            <Text style={styles.headerIconText}>‹</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Türkiye Lojistik Ağı</Text>
            <Text style={styles.headerSubtitle}>Şehirler, rotalar ve aktif teslimatlar</Text>
          </View>

          <TouchableOpacity style={styles.headerIconButton} onPress={handleRefreshMarket} activeOpacity={0.8}>
            <Text style={styles.headerIconText}>⟳</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
        >
          {MAP_FILTERS.map((filter) => {
            const isActive = filter.key === selectedMapFilter;
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setSelectedMapFilter(filter.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.statsPill}>
          <Text style={styles.statsPillText}>Şehir: {mapCities.length}</Text>
          <Text style={styles.statsPillDivider}>·</Text>
          <Text style={styles.statsPillText}>Rota: {routeCount}</Text>
          <Text style={styles.statsPillDivider}>·</Text>
          <Text style={styles.statsPillText}>İş: {availableContracts.length}</Text>
          <Text style={styles.statsPillDivider}>·</Text>
          <Text style={styles.statsPillText}>Aktif: {runningDeliveries.length}</Text>
          <Text style={styles.statsPillDivider}>·</Text>
          <Text style={styles.statsPillText}>Boşta: {idleTrucks.length}</Text>
        </View>

        {statusMessage ? (
          <View style={styles.statusToast}>
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        ) : null}

        <NetworkMapCanvas
          cities={cities}
          routes={routes}
          contracts={contracts}
          activeDeliveries={activeDeliveries}
          depotCityIds={depotCityIds}
          selectedFilter={selectedMapFilter}
          featuredContract={runningDeliveries.length > 0 ? null : bestContract}
          selectedContract={userSelectedContract}
          selectedDeliveryId={selectedDeliveryId}
          onCityPress={handleCityPress}
          onRoutePress={() => setStatusMessage('Rota seçildi')}
          onContractPress={handleContractPress}
          onDeliveryPress={handleDeliveryPress}
        />

        <BestOpportunityCard
          displayDelivery={selectedDelivery}
          bestContract={bestContract}
          runningDeliveries={runningDeliveries}
          currentTime={currentTime}
          onDeliverySelect={handleDeliveryPress}
          onContractPress={handleGoToContractsHint}
          onRefresh={handleRefreshMarket}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: STATUS_BAR_HEIGHT,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 16,
  },
  emptyStateTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyStateSubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    textAlign: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  headerSubtitle: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },

  filterScroll: {
    marginHorizontal: -16,
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
    paddingRight: 24,
  },
  filterChip: {
    minHeight: 34,
    paddingHorizontal: 14,
    marginRight: 0,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: '#0F2A44',
    borderColor: COLORS.cyan,
  },
  filterChipText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },

  statsPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    minHeight: 28,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 10,
  },
  statsPillText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  statsPillDivider: {
    color: COLORS.border,
    fontSize: 11,
    marginHorizontal: 6,
  },

  statusToast: {
    alignSelf: 'flex-start',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  statusToastText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
  },

  infoCard: {
    marginTop: 12,
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardEyebrow: {
    color: COLORS.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  cardStatusBadge: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  cardBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardThumb: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardThumbIcon: {
    fontSize: 18,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardMetaLine: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  cardPayment: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
    flexShrink: 0,
  },
  cardEmptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardButton: {
    marginTop: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cardButtonText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  deliveryPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  deliveryPickerChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  deliveryPickerChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  deliveryPickerText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  deliveryPickerTextActive: {
    color: COLORS.accent,
  },

  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
});
