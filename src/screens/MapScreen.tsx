/**
 * LogistiCore - Türkiye Lojistik Ağı ekranı
 *
 * Mobil tycoon tarzı network overview — coğrafi harita yok, zoom/pan yok.
 * TODO V2: Unlock Europe/global network after company expansion
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { debugConfig } from '../config/debug';
import WorldMapCanvas, { type NetworkFilterKey } from '../components/map/WorldMapCanvas';
import { AppCard, GameIcon, ProgressBar, StatusBadge, type StatusBadgeVariant } from '../components/ui';
import { normalizeCityId } from '../data/networkPositions';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { getContractAvailability } from '../simulation/delivery';
import { findMarketOpportunities } from '../simulation/contracts';
import {
  getRecommendedContractById,
  getRecommendedMapAction,
} from '../simulation/mapRecommendations';
import { useGameStore } from '../store/gameStore';
import { getWorldMapCityPosition } from '../data/worldMapPositions';
import { STATUS_BAR_HEIGHT } from '../theme/ui';
import { getCityName } from '../utils/entityLookup';
import type {
  Contract,
  Delivery,
  DeliveryStatus,
  Driver,
  Player,
  Truck,
  TruckTransfer,
} from '../types/game';

const DEFAULT_TRUCK_CITY_ID = 'izmir';

function isTruckIdle(status: string): boolean {
  return status === 'idle' || status === 'available' || status === 'BOŞTA';
}

function resolveMapTruckCityId(
  truck: Pick<Truck, 'currentCityId' | 'homeCityId'>,
  playerHomeCityId?: string,
): string {
  return normalizeCityId(
    truck.currentCityId ?? truck.homeCityId ?? playerHomeCityId ?? DEFAULT_TRUCK_CITY_ID,
  );
}

function buildIdleTruckCountByCity(
  trucks: Player['trucks'] | undefined,
  playerHomeCityId?: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const truck of trucks ?? []) {
    if (!isTruckIdle(truck.status)) continue;
    const cityId = resolveMapTruckCityId(truck, playerHomeCityId);
    counts[cityId] = (counts[cityId] ?? 0) + 1;
  }
  return counts;
}

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];
const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const MAX_TRUCK_TRACK_PREVIEW = 3;

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

function safeProgress(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value ?? 0));
}

function formatRemainingShort(currentTime: number, estimatedArrivalTime: number | undefined): string {
  if (!Number.isFinite(estimatedArrivalTime)) return '—';
  const remaining = Math.max(0, (estimatedArrivalTime ?? 0) - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  if (hrs > 0 && mins <= 0) return `${hrs}s kaldı`;
  if (hrs > 0) return `${hrs}s ${mins}dk kaldı`;
  if (mins > 0) return `${mins}dk kaldı`;
  return '—';
}

function getTruckTrackBadge(status: Truck['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
    case 'on_route':
      return { label: 'TESLİMATTA', variant: 'blue' };
    case 'transferring':
      return { label: 'YÖNLENDİRİLİYOR', variant: 'info' };
    case 'maintenance':
      return { label: 'BAKIMDA', variant: 'danger' };
    default:
      return { label: 'BOŞTA', variant: 'success' };
  }
}

function truckTrackSortPriority(status: Truck['status']): number {
  switch (status) {
    case 'on_route':
      return 0;
    case 'transferring':
      return 1;
    case 'idle':
      return 2;
    case 'maintenance':
      return 3;
    default:
      return 4;
  }
}

function buildMapRecommendationSubtitle(params: {
  availableContracts: Contract[];
  trucks: Truck[];
  drivers: Driver[];
  playerLevel: number;
  runningDeliveries: Delivery[];
  idleTruckCountByCity: Record<string, number>;
}): string {
  const {
    availableContracts,
    trucks,
    drivers,
    playerLevel,
    runningDeliveries,
    idleTruckCountByCity,
  } = params;

  const startable = availableContracts.filter((contract) =>
    getContractAvailability(contract, trucks, drivers, playerLevel).canStart,
  );

  if (startable.length === 0) {
    return '';
  }

  for (const delivery of runningDeliveries) {
    const destinationId = delivery.destinationCityId;
    if (!destinationId) continue;

    const linkedCount = startable.filter((contract) => contract.originCityId === destinationId).length;
    if (linkedCount > 0) {
      return `${getCityName(destinationId)} varışlı kamyonun için sıradaki işler hazır.`;
    }
  }

  const idleCityIds = Object.entries(idleTruckCountByCity)
    .filter(([, count]) => count > 0)
    .map(([cityId]) => cityId);

  const contractsFromIdleCities = startable.filter((contract) =>
    idleCityIds.includes(contract.originCityId),
  );

  const cityCounts = new Map<string, number>();
  for (const contract of contractsFromIdleCities) {
    cityCounts.set(contract.originCityId, (cityCounts.get(contract.originCityId) ?? 0) + 1);
  }

  const citiesWithJobs = [...cityCounts.entries()].filter(([, count]) => count > 0);

  if (citiesWithJobs.length === 1) {
    const [cityId, count] = citiesWithJobs[0];
    return `${getCityName(cityId)} çıkışlı ${count} uygun iş var.`;
  }

  const total = contractsFromIdleCities.length > 0 ? contractsFromIdleCities.length : startable.length;
  return `Boştaki kamyon şehirlerinde ${total} uygun iş var.`;
}

function findDeliveryForTruck(truckId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function findTransferForTruck(truckId: string, transfers: TruckTransfer[]): TruckTransfer | undefined {
  return transfers.find((transfer) => transfer.truckId === truckId && transfer.status === 'active');
}

interface TruckTrackCardProps {
  truck: Truck;
  delivery?: Delivery;
  transfer?: TruckTransfer;
  homeCityId?: string;
  currentTime: number;
}

function TruckTrackCard({ truck, delivery, transfer, homeCityId, currentTime }: TruckTrackCardProps) {
  const badge = getTruckTrackBadge(truck.status);
  const cityId = resolveMapTruckCityId(truck, homeCityId);
  const cityName = getCityName(cityId);

  let routeLine = `Konum: ${cityName}`;
  let metaLine: string | undefined = 'Yeni iş için hazır';
  let progress: number | undefined;

  if (truck.status === 'on_route' && delivery) {
    routeLine = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;
    progress = safeProgress(delivery.progress);
    metaLine = `Teslimat · ${formatRemainingShort(currentTime, delivery.estimatedArrivalTime)}`;
  } else if (truck.status === 'transferring' && transfer) {
    routeLine = `${getCityName(transfer.fromCityId)} → ${getCityName(transfer.toCityId)}`;
    progress = safeProgress(transfer.progress);
    metaLine = `Boş transfer · ${formatRemainingShort(currentTime, transfer.estimatedArrivalAt)}`;
  } else if (truck.status === 'maintenance') {
    routeLine = `Konum: ${cityName}`;
    metaLine = 'Tamir tamamlanana kadar işe çıkamaz';
  }

  return (
    <AppCard style={styles.trackCard} padded>
      <View style={styles.trackCardRow}>
        <View style={styles.trackIconBox}>
          <GameIcon name="truck" size={16} color={COLORS.cyan} />
        </View>
        <View style={styles.trackCardMain}>
          <View style={styles.trackCardHeader}>
            <Text style={styles.trackCardTitle} numberOfLines={1}>
              {truck.name}
            </Text>
            <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
          </View>
          <Text style={styles.trackRouteLine} numberOfLines={1}>
            {routeLine}
          </Text>
          {metaLine ? (
            <Text style={styles.trackMetaLine} numberOfLines={2}>
              {metaLine}
            </Text>
          ) : null}
          {progress != null ? (
            <View style={styles.trackProgress}>
              <ProgressBar progress={progress} color={COLORS.cyan} height={3} />
            </View>
          ) : null}
        </View>
      </View>
    </AppCard>
  );
}

interface TruckTrackingSectionProps {
  trucks: Truck[];
  deliveries: Delivery[];
  transfers: TruckTransfer[];
  idleTruckCountByCity: Record<string, number>;
  homeCityId?: string;
  currentTime: number;
  onOpenFleet: () => void;
}

function TruckTrackingSection({
  trucks,
  deliveries,
  transfers,
  idleTruckCountByCity,
  homeCityId,
  currentTime,
  onOpenFleet,
}: TruckTrackingSectionProps) {
  const sortedTrucks = useMemo(
    () =>
      [...trucks].sort(
        (a, b) => truckTrackSortPriority(a.status) - truckTrackSortPriority(b.status),
      ),
    [trucks],
  );

  const previewTrucks = sortedTrucks.slice(0, MAX_TRUCK_TRACK_PREVIEW);
  const extraTruckCount = Math.max(0, sortedTrucks.length - previewTrucks.length);

  const idleCityChips = useMemo(
    () =>
      Object.entries(idleTruckCountByCity)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([cityId, count]) => ({
          cityId,
          label: `${getCityName(cityId)} ${count}`,
        })),
    [idleTruckCountByCity],
  );

  if (trucks.length === 0) {
    return null;
  }

  return (
    <View style={styles.trackingSection}>
      <View style={styles.trackingHeader}>
        <Text style={styles.trackingTitle}>Kamyon Takip</Text>
        <Text style={styles.trackingSubtitle}>Boşta, transferde ve teslimattaki araçlarını izle</Text>
      </View>

      {idleCityChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cityChipScroll}
          contentContainerStyle={styles.cityChipRow}
        >
          {idleCityChips.map((chip) => (
            <View key={chip.cityId} style={styles.cityChip}>
              <Text style={styles.cityChipText}>{chip.label}</Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.noIdleChipText}>Boşta kamyon yok</Text>
      )}

      {previewTrucks.map((truck) => (
        <TruckTrackCard
          key={truck.id}
          truck={truck}
          delivery={findDeliveryForTruck(truck.id, deliveries)}
          transfer={findTransferForTruck(truck.id, transfers)}
          homeCityId={homeCityId}
          currentTime={currentTime}
        />
      ))}

      {extraTruckCount > 0 ? (
        <Text style={styles.moreTrucksHint}>+{extraTruckCount} araç daha</Text>
      ) : null}

      <TouchableOpacity style={styles.fleetLinkButton} onPress={onOpenFleet} activeOpacity={0.85}>
        <Text style={styles.fleetLinkText}>Tüm Filoyu Gör</Text>
        <Text style={styles.fleetLinkChevron}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

interface CompactRecommendedActionRowProps {
  subtitle: string;
  onPress: () => void;
}

function CompactRecommendedActionRow({ subtitle, onPress }: CompactRecommendedActionRowProps) {
  return (
    <TouchableOpacity style={styles.compactActionCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.compactActionAccent} />
      <View style={styles.compactActionBody}>
        <View style={styles.compactActionTextBlock}>
          <View style={styles.compactActionTitleRow}>
            <View style={styles.compactActionBadge}>
              <Text style={styles.compactActionBadgeText}>Öneri</Text>
            </View>
            <Text style={styles.compactActionTitle} numberOfLines={1}>
              Yeni rota hazır
            </Text>
          </View>
          <Text style={styles.compactActionSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.compactActionButton}>
          <Text style={styles.compactActionButtonText} numberOfLines={1}>
            İşleri Gör
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MapScreen({ onOpenContracts }: { onOpenContracts?: () => void }) {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const activeTransfers = useGameStore((state) => state.activeTransfers) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const openContractsForMapContract = useGameStore((state) => state.openContractsForMapContract);
  const requestNavigationToFleet = useGameStore((state) => state.requestNavigationToFleet);
  const { scrollBottomPadding } = useTabBarLayout();

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
    () => cities.filter((city) => getWorldMapCityPosition(city.id) != null),
    [cities],
  );

  const routeCount = useMemo(() => {
    const keys = new Set<string>();
    for (const route of routes) {
      if (!getWorldMapCityPosition(route.fromCityId) || !getWorldMapCityPosition(route.toCityId)) {
        continue;
      }
      keys.add([route.fromCityId, route.toCityId].sort().join('|'));
    }
    return keys.size;
  }, [routes]);

  const depotCityIds = useMemo(
    () => (player?.warehouses ?? []).map((warehouse) => warehouse.cityId),
    [player?.warehouses],
  );

  const idleTrucks = useMemo(
    () => (player?.trucks ?? []).filter((truck) => isTruckIdle(truck.status)),
    [player?.trucks],
  );

  const idleTruckCountByCity = useMemo(
    () => buildIdleTruckCountByCity(player?.trucks, player?.homeCityId),
    [player?.trucks, player?.homeCityId],
  );

  const userSelectedContract = useMemo(() => {
    if (!selectedContractId) return null;
    return availableContracts.find((c) => c.id === selectedContractId) ?? null;
  }, [availableContracts, selectedContractId]);

  const featuredContract: Contract | undefined = useMemo(() => {
    if (runningDeliveries.length > 0) return undefined;
    if (selectedContractId) {
      const picked = availableContracts.find((c) => c.id === selectedContractId);
      if (picked) return picked;
    }
    return [...availableContracts].sort((a, b) => b.payment - a.payment)[0];
  }, [availableContracts, runningDeliveries.length, selectedContractId]);

  const marketOpportunities = useMemo(
    () => findMarketOpportunities(cities, routes, products, 5),
    [cities, routes, products],
  );

  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerMoney = player?.money ?? 0;
  const truckStatusKey = useMemo(
    () =>
      (player?.trucks ?? [])
        .map((truck) => `${truck.id}:${truck.status}:${truck.capacity ?? 0}`)
        .join('|'),
    [player?.trucks],
  );
  const driverStatusKey = useMemo(
    () => (player?.drivers ?? []).map((driver) => `${driver.id}:${driver.status}`).join('|'),
    [player?.drivers],
  );
  const warehouseInventoryKey = useMemo(
    () =>
      (player?.warehouses ?? [])
        .flatMap((warehouse) =>
          (warehouse.inventory ?? []).map(
            (item) => `${warehouse.id}:${item.productId}:${item.quantity}:${item.averageBuyPrice ?? 0}`,
          ),
        )
        .join('|'),
    [player?.warehouses],
  );
  const availableContractsKey = useMemo(
    () => availableContracts.map((contract) => `${contract.id}:${contract.status}`).join('|'),
    [availableContracts],
  );
  const runningDeliveriesKey = useMemo(
    () =>
      runningDeliveries
        .map(
          (delivery) =>
            `${delivery.id}:${delivery.status}:${Math.floor(delivery.progress * 10)}:${Math.floor(delivery.estimatedArrivalTime)}`,
        )
        .join('|'),
    [runningDeliveries],
  );
  const recommendationClock = Math.floor(currentTime);

  const fuelPrice = globalEconomy?.fuelPrice ?? 0;

  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];

  const hasStartableContracts = useMemo(
    () =>
      availableContracts.some((contract) =>
        getContractAvailability(contract, trucks, drivers, playerLevel).canStart,
      ),
    [availableContracts, trucks, drivers, playerLevel],
  );

  const recommendationSubtitle = useMemo(
    () =>
      buildMapRecommendationSubtitle({
        availableContracts,
        trucks,
        drivers,
        playerLevel,
        runningDeliveries,
        idleTruckCountByCity,
      }),
    [
      availableContracts,
      trucks,
      drivers,
      playerLevel,
      runningDeliveries,
      idleTruckCountByCity,
    ],
  );

  const recommendedAction = useMemo(
    () =>
      getRecommendedMapAction({
        contracts,
        player,
        activeDeliveries,
        marketOpportunities,
        cities,
        globalEconomy,
        currentTime,
      }),
    [
      availableContractsKey,
      playerLevel,
      playerMoney,
      truckStatusKey,
      driverStatusKey,
      warehouseInventoryKey,
      runningDeliveriesKey,
      recommendationClock,
      marketOpportunities,
      cities,
      fuelPrice,
    ],
  );

  const recommendedContract = useMemo(() => {
    if (recommendedAction.type !== 'contract') return undefined;
    return getRecommendedContractById(contracts, recommendedAction.contractId);
  }, [recommendedAction, contracts]);

  const showRecommendedAction =
    hasStartableContracts &&
    recommendedAction.type === 'contract' &&
    Boolean(recommendedContract) &&
    recommendationSubtitle.length > 0;

  const handleRefreshMarket = () => {
    try {
      useGameStore.getState().refreshMarketSnapshot();
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

  const handleOpenFleet = () => {
    requestNavigationToFleet('trucks');
  };

  const handleRecommendedActionPress = () => {
    if (recommendedAction.type !== 'contract' || !recommendedContract) {
      onOpenContracts?.();
      return;
    }

    if (__DEV__) {
      console.log('Map recommended contract opened', recommendedContract.id);
    }
    openContractsForMapContract(recommendedContract);
    onOpenContracts?.();
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
          { paddingBottom: scrollBottomPadding },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerSideSlot} />

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Türkiye Lojistik Ağı</Text>
            <Text style={styles.headerSubtitle}>Şehirler, rotalar ve aktif teslimatlar</Text>
          </View>

          <View style={styles.headerSideSlot}>
            <TouchableOpacity style={styles.headerIconButton} onPress={handleRefreshMarket} activeOpacity={0.8}>
              <Text style={styles.headerIconText}>⟳</Text>
            </TouchableOpacity>
          </View>
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

        <WorldMapCanvas
          calibrationMode={debugConfig.mapCalibrationEnabled}
          cities={cities}
          routes={routes}
          contracts={contracts}
          activeDeliveries={activeDeliveries}
          activeTransfers={activeTransfers}
          depotCityIds={depotCityIds}
          idleTruckCountByCity={idleTruckCountByCity}
          selectedFilter={selectedMapFilter}
          featuredContract={featuredContract}
          selectedContract={userSelectedContract}
          selectedDeliveryId={selectedDeliveryId}
          onCityPress={handleCityPress}
          onRoutePress={() => setStatusMessage('Rota seçildi')}
          onContractPress={handleContractPress}
          onDeliveryPress={handleDeliveryPress}
        />

        {showRecommendedAction ? (
          <CompactRecommendedActionRow
            subtitle={recommendationSubtitle}
            onPress={handleRecommendedActionPress}
          />
        ) : null}

        <TruckTrackingSection
          trucks={trucks}
          deliveries={activeDeliveries}
          transfers={activeTransfers}
          idleTruckCountByCity={idleTruckCountByCity}
          homeCityId={player.homeCityId}
          currentTime={currentTime}
          onOpenFleet={handleOpenFleet}
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
  headerSideSlot: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    minWidth: 0,
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

  compactActionCard: {
    marginTop: 10,
    minHeight: 76,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 14,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  compactActionAccent: {
    width: 3,
    backgroundColor: 'rgba(56, 189, 248, 0.55)',
  },
  compactActionBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  compactActionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  compactActionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  compactActionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    flexShrink: 0,
  },
  compactActionBadgeText: {
    color: COLORS.cyan,
    fontSize: 10,
    fontWeight: '700',
  },
  compactActionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
  },
  compactActionSubtitle: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  compactActionButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  compactActionButtonText: {
    color: COLORS.cyan,
    fontSize: 11,
    fontWeight: '800',
  },

  trackingSection: {
    marginTop: 14,
  },
  trackingHeader: {
    marginBottom: 8,
  },
  trackingTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  trackingSubtitle: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  cityChipScroll: {
    marginHorizontal: -16,
    marginBottom: 10,
  },
  cityChipRow: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  cityChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cityChipText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  noIdleChipText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 10,
  },
  trackCard: {
    marginBottom: 8,
  },
  trackCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  trackIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCardMain: {
    flex: 1,
    minWidth: 0,
  },
  trackCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  trackCardTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  trackRouteLine: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  trackMetaLine: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
  trackProgress: {
    marginTop: 6,
  },
  moreTrucksHint: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  fleetLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    marginTop: 2,
  },
  fleetLinkText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  fleetLinkChevron: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -1,
  },
});
