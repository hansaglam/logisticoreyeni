/**
 * LogistiCore - Türkiye Lojistik Ağı ekranı
 *
 * Mobil tycoon tarzı network overview — coğrafi harita yok, zoom/pan yok.
 * TODO V2: Unlock Europe/global network after company expansion
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { debugConfig } from '../config/debug';
import WorldMapCanvas, {
  type NetworkFilterKey,
  type WorldMapCanvasHandle,
} from '../components/map/WorldMapCanvas';
import MapFilterTabs from '../components/map/MapFilterTabs';
import MapHeader from '../components/map/MapHeader';
import MapStatsStrip from '../components/map/MapStatsStrip';
import MapTruckTrackingSection from '../components/map/MapTruckTrackingSection';
import SelectedCityPanel from '../components/map/SelectedCityPanel';
import TurkeyNetworkCard from '../components/map/TurkeyNetworkCard';
import { MAP_BG, MAP_HORIZONTAL_PADDING } from '../components/map/mapTheme';
import { resolveTruckPersistentCityId } from '../components/map/mapTruckLocation';
import { GameIcon } from '../components/ui';
import { normalizeCityId } from '../data/networkPositions';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import OnboardingHintCard from '../components/onboarding/OnboardingHintCard';
import { useActiveOnboardingHint, useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import { getContractAvailability } from '../simulation/delivery';
import { findMarketOpportunities } from '../simulation/contracts';
import {
  getRecommendedContractById,
  getRecommendedMapAction,
} from '../simulation/mapRecommendations';
import { useGameStore } from '../store/gameStore';
import { getWorldMapCityPosition } from '../data/worldMapPositions';
import { getCityName } from '../utils/entityLookup';
import type {
  Contract,
  Delivery,
  DeliveryStatus,
  Driver,
  Player,
  ProductId,
  Truck,
} from '../types/game';

function isTruckIdle(status: string): boolean {
  return status === 'idle' || status === 'available' || status === 'BOŞTA';
}

function resolveMapTruckCityId(
  truck: Pick<Truck, 'currentCityId' | 'homeCityId'>,
  playerHomeCityId?: string,
): string {
  return resolveTruckPersistentCityId(truck, playerHomeCityId);
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

const COLORS = {
  background: MAP_BG,
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
  const openMarketFromAlert = useGameStore((state) => state.openMarketFromAlert);
  const requestNavigationToFleet = useGameStore((state) => state.requestNavigationToFleet);
  const { scrollBottomPadding, screenTopPadding } = useTabBarLayout();

  useOnboardingScreenVisit('Map');
  const onboardingHint = useActiveOnboardingHint(['track_delivery']);

  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [selectedMapFilter, setSelectedMapFilter] = useState<NetworkFilterKey>('all');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const mapRef = useRef<WorldMapCanvasHandle>(null);

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

  const selectedCityPanelData = useMemo(() => {
    if (!selectedCityId) return null;
    const cityNorm = normalizeCityId(selectedCityId);
    const cityName = getCityName(selectedCityId);
    const truckCount = trucks.filter(
      (truck) => normalizeCityId(resolveMapTruckCityId(truck, player?.homeCityId)) === cityNorm,
    ).length;
    const depotCount = depotCityIds.filter((id) => normalizeCityId(id) === cityNorm).length;
    const jobCount = availableContracts.filter(
      (contract) => normalizeCityId(contract.originCityId) === cityNorm,
    ).length;
    const city = cities.find((item) => normalizeCityId(item.id) === cityNorm);
    const firstProductId = city ? Object.keys(city.products)[0] : undefined;
    return { cityName, truckCount, depotCount, jobCount, firstProductId };
  }, [
    availableContracts,
    cities,
    depotCityIds,
    player?.homeCityId,
    selectedCityId,
    trucks,
  ]);
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

  const handleMapBackgroundPress = () => {
    setSelectedCityId(null);
  };

  const handleFocusSelectedCity = () => {
    mapRef.current?.resetToOperational();
  };

  const handleViewCityJobs = () => {
    onOpenContracts?.();
  };

  const handleOpenCityDepot = () => {
    if (!selectedCityId || !selectedCityPanelData?.firstProductId) return;
    openMarketFromAlert({
      cityId: selectedCityId,
      productId: selectedCityPanelData.firstProductId as ProductId,
    });
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

    if (__DEV__ && process.env.EXPO_PUBLIC_DEBUG_MAP === '1') {
      console.log('Map recommended contract opened', recommendedContract.id);
    }
    openContractsForMapContract(recommendedContract);
    onOpenContracts?.();
  };

  if (!player) {
    return (
      <View style={[styles.safeArea, { paddingTop: screenTopPadding }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </View>
    );
  }

  if (cities.length === 0) {
    return (
      <View style={[styles.safeArea, { paddingTop: screenTopPadding }]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyStateTitle}>Harita verisi yok</Text>
          <Text style={styles.emptyStateSubtitle}>Şehir verileri henüz yüklenmedi.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safeArea, { paddingTop: screenTopPadding }]}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!mapGestureActive}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: scrollBottomPadding },
        ]}
      >
        <MapHeader onRefresh={handleRefreshMarket} />

        {onboardingHint ? (
          <OnboardingHintCard
            title={onboardingHint.title}
            description={onboardingHint.description}
            icon={onboardingHint.icon}
            badgeLabel={onboardingHint.badgeLabel}
            accentVariant={onboardingHint.accentVariant}
            onDismiss={onboardingHint.onDismiss}
          />
        ) : null}

        <MapFilterTabs
          selectedFilter={selectedMapFilter}
          onChange={setSelectedMapFilter}
        />

        <MapStatsStrip
          cityCount={mapCities.length}
          routeCount={routeCount}
          jobCount={availableContracts.length}
          activeCount={runningDeliveries.length}
          idleCount={idleTrucks.length}
        />

        {statusMessage ? (
          <View style={styles.statusToast}>
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        ) : null}

        <TurkeyNetworkCard>
          <WorldMapCanvas
            ref={mapRef}
            calibrationMode={debugConfig.mapCalibrationEnabled}
            cities={cities}
            contracts={contracts}
            activeDeliveries={activeDeliveries}
            activeTransfers={activeTransfers}
            trucks={trucks}
            homeCityId={player?.homeCityId}
            depotCityIds={depotCityIds}
            idleTruckCountByCity={idleTruckCountByCity}
            selectedFilter={selectedMapFilter}
            selectedCityId={selectedCityId}
            featuredContract={featuredContract}
            selectedContract={userSelectedContract}
            selectedDeliveryId={selectedDeliveryId}
            onCityPress={handleCityPress}
            onBackgroundPress={handleMapBackgroundPress}
            onContractPress={handleContractPress}
            onDeliveryPress={handleDeliveryPress}
            onMapGestureActiveChange={setMapGestureActive}
          />
        </TurkeyNetworkCard>

        {selectedCityPanelData ? (
          <SelectedCityPanel
            cityName={selectedCityPanelData.cityName}
            truckCount={selectedCityPanelData.truckCount}
            depotCount={selectedCityPanelData.depotCount}
            jobCount={selectedCityPanelData.jobCount}
            onViewJobs={
              selectedCityPanelData.jobCount > 0 ? handleViewCityJobs : undefined
            }
            onOpenDepot={
              selectedCityPanelData.depotCount > 0 && selectedCityPanelData.firstProductId
                ? handleOpenCityDepot
                : undefined
            }
            onFocus={handleFocusSelectedCity}
            onClose={handleMapBackgroundPress}
          />
        ) : null}

        {showRecommendedAction ? (
          <CompactRecommendedActionRow
            subtitle={recommendationSubtitle}
            onPress={handleRecommendedActionPress}
          />
        ) : null}

        <MapTruckTrackingSection
          trucks={trucks}
          deliveries={activeDeliveries}
          transfers={activeTransfers}
          idleTruckCountByCity={idleTruckCountByCity}
          homeCityId={player.homeCityId}
          currentTime={currentTime}
          onOpenFleet={handleOpenFleet}
          onTruckPress={() => handleOpenFleet()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: MAP_HORIZONTAL_PADDING,
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
});
