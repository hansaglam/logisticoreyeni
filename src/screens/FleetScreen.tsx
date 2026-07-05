/**
 * LogistiCore - Filo Ekranı
 *
 * Premium kompakt filo yönetimi — kamyonlar, şoförler ve mağaza.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SmallStatPill,
  StatusBadge,
} from '../components/ui';
import type { StatusBadgeVariant } from '../components/ui';
import {
  countOwnedTrucksOfCatalog,
  resolveTruckMarketRequiredLevel,
  TRUCK_MARKET,
  type TruckMarketItem,
} from '../data/trucks';
import {
  getDriverPoolForLevel,
  getDriverTierLabel,
  isDriverPoolItemHired,
  resolveDriverRequiredLevel,
  type DriverMarketItem,
} from '../data/drivers';
import { CITIES_BY_ID } from '../data/cities';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { calculateTruckRepairCost } from '../simulation/delivery';
import { useGameStore } from '../store/gameStore';
import { colors, spacing, typography } from '../theme';
import type { Delivery, DeliveryStatus, Driver, Truck } from '../types/game';

const CONDITION_GOOD_THRESHOLD = 70;
const CONDITION_FAIR_THRESHOLD = 40;
const MAINTENANCE_REQUIRED_THRESHOLD = 30;
const MAINTENANCE_RECOMMENDED_THRESHOLD = 70;
const REPAIR_HIDE_THRESHOLD = 95;
const RISKY_ATTENTION_THRESHOLD = 40;
const FUEL_EFFICIENT_THRESHOLD = 65;
const EXPERIENCED_THRESHOLD = 65;
const FAST_SPEED_THRESHOLD = 40;
const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const LIST_SCROLL_BOTTOM_EXTRA = 110;
const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];

type FleetTab = 'trucks' | 'drivers' | 'shop';
type StatusMessage = { type: 'success' | 'error'; text: string } | null;

const FLEET_TABS = [
  { key: 'trucks' as const, label: 'Kamyonlar', icon: 'truck' as const },
  { key: 'drivers' as const, label: 'Şoförler', icon: 'driver' as const },
  { key: 'shop' as const, label: 'Mağaza', icon: 'market' as const },
];

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatRemainingHours(currentTime: number, estimatedArrivalTime: number): string {
  const remaining = Math.max(0, estimatedArrivalTime - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  if (hrs > 0) return `${hrs}s ${mins}dk`;
  return `${mins}dk`;
}

function formatPercent(progress: number): string {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function findActiveDeliveryForTruck(truckId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function findActiveDeliveryForDriver(driverId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find(
    (delivery) =>
      delivery.driverId === driverId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function getConditionColor(condition: number): string {
  if (condition >= CONDITION_GOOD_THRESHOLD) return colors.success;
  if (condition >= CONDITION_FAIR_THRESHOLD) return colors.accentAmber;
  return colors.danger;
}

function calculateAverageCondition(trucks: Truck[]): number {
  if (trucks.length === 0) return 0;
  const total = trucks.reduce((sum, truck) => sum + (truck.condition ?? 100), 0);
  return total / trucks.length;
}

function getTruckStatusBadge(status: Truck['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
    case 'on_route':
      return { label: 'YOLDA', variant: 'blue' };
    case 'maintenance':
      return { label: 'BAKIM', variant: 'danger' };
    default:
      return { label: 'BOŞTA', variant: 'success' };
  }
}

function getDriverStatusBadge(status: Driver['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
    case 'driving':
      return { label: 'YOLDA', variant: 'blue' };
    case 'resting':
      return { label: 'DİNLENİYOR', variant: 'amber' };
    default:
      return { label: 'BOŞTA', variant: 'success' };
  }
}

function getMaintenanceBadge(condition: number): { label: string; variant: StatusBadgeVariant } | null {
  if (condition < MAINTENANCE_REQUIRED_THRESHOLD) {
    return { label: 'Bakım gerekli', variant: 'danger' };
  }
  if (condition < MAINTENANCE_RECOMMENDED_THRESHOLD) {
    return { label: 'Bakım önerilir', variant: 'warning' };
  }
  return null;
}

function getDriverTrait(driver: Driver): { label: string; variant: StatusBadgeVariant } {
  const fuelSaving = driver.fuelSaving ?? 0;
  const experience = driver.experience ?? 0;
  const attention = driver.attention ?? 50;
  const speed = driver.speed ?? 0;

  if (fuelSaving >= FUEL_EFFICIENT_THRESHOLD) {
    return { label: 'Yakıt tasarruflu', variant: 'success' };
  }
  if (experience >= EXPERIENCED_THRESHOLD) {
    return { label: 'Tecrübeli', variant: 'info' };
  }
  if (attention < RISKY_ATTENTION_THRESHOLD || speed > FAST_SPEED_THRESHOLD) {
    return { label: 'Riskli', variant: 'danger' };
  }
  return { label: 'Dengeli şoför', variant: 'muted' };
}

function getTruckShopTags(template: TruckMarketItem): { label: string; variant: StatusBadgeVariant }[] {
  const tags: { label: string; variant: StatusBadgeVariant }[] = [];
  if (template.capacity >= 28) tags.push({ label: 'Yüksek kapasite', variant: 'success' });
  if (template.fuelConsumptionPerKm <= 0.3) tags.push({ label: 'Yakıt tasarruflu', variant: 'success' });
  if (template.speed >= 78) tags.push({ label: 'Hızlı teslimat', variant: 'warning' });
  if (template.reliability >= 85) tags.push({ label: 'Dayanıklı', variant: 'info' });
  if (template.reliability < 75) tags.push({ label: 'Arıza riski yüksek', variant: 'danger' });
  return tags.slice(0, 3);
}

function getDriverShopTags(template: DriverMarketItem): { label: string; variant: StatusBadgeVariant }[] {
  const tags: { label: string; variant: StatusBadgeVariant }[] = [];
  if (template.comingSoon) tags.push({ label: 'Yakında', variant: 'warning' });
  if (template.fuelSaving >= 50) tags.push({ label: 'Yakıt tasarruflu', variant: 'success' });
  if (template.attention >= 80) tags.push({ label: 'Güvenli sürücü', variant: 'success' });
  if (template.speed >= 15) tags.push({ label: 'Hızlı sürücü', variant: 'warning' });
  if (tags.length === 0) {
    tags.push({ label: getDriverTierLabel(template.tier), variant: 'muted' });
  }
  return tags.slice(0, 2);
}

function translateErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes('Level')) return error.message;
  if (error.message.includes('Yetersiz')) return 'Nakit yetersiz';
  if (error.message.includes('zaten')) return 'Zaten mevcut';
  if (error.message.includes('bulunamadı')) return 'Bulunamadı';
  if (error.message.includes('Yoldaki')) return 'Kamyon yolda';
  return error.message;
}

interface FleetMetricStripProps {
  truckCount: number;
  driverCount: number;
  idleTrucks: number;
  onRouteTrucks: number;
  averageCondition: number;
}

function FleetMetricStrip({
  truckCount,
  driverCount,
  idleTrucks,
  onRouteTrucks,
  averageCondition,
}: FleetMetricStripProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.metricStrip}
    >
      <SmallStatPill label="Kamyon" value={String(truckCount)} icon="truck" accentColor={colors.accentBlue} compact />
      <SmallStatPill label="Şoför" value={String(driverCount)} icon="driver" accentColor={colors.info} compact />
      <SmallStatPill label="Boşta" value={String(idleTrucks)} icon="success" accentColor={colors.success} compact />
      <SmallStatPill label="Yolda" value={String(onRouteTrucks)} icon="route" accentColor={colors.accentBlue} compact />
      <SmallStatPill
        label="Ort. kondisyon"
        value={`${Math.round(averageCondition)}%`}
        icon="maintenance"
        accentColor={getConditionColor(averageCondition)}
        compact
      />
    </ScrollView>
  );
}

interface OwnedTruckCardProps {
  truck: Truck;
  playerMoney: number;
  delivery?: Delivery;
  currentTime: number;
  onRepair: (truck: Truck) => void;
}

function OwnedTruckCard({
  truck,
  playerMoney,
  delivery,
  currentTime,
  onRepair,
}: OwnedTruckCardProps) {
  const truckCondition = truck.condition ?? 100;
  const conditionColor = getConditionColor(truckCondition);
  const repairCost = calculateTruckRepairCost(truck);
  const isOnRoute = truck.status === 'on_route';
  const isIdle = truck.status === 'idle';
  const canAfford = playerMoney >= repairCost;
  const statusBadge = getTruckStatusBadge(truck.status);
  const maintenanceBadge = getMaintenanceBadge(truckCondition);
  const showRepairButton = isIdle && truckCondition < 100 && truckCondition < REPAIR_HIDE_THRESHOLD;
  const showGoodMaintenance = isIdle && truckCondition >= REPAIR_HIDE_THRESHOLD;

  return (
    <AppCard style={styles.fleetCard} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.entityIconBox}>
          <GameIcon name="truck" size={18} color={colors.accentBlue} />
        </View>

        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {truck.name}
          </Text>
        </View>

        <View style={styles.cardRight}>
          <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
        </View>
      </View>

      <Text style={styles.statsRow}>
        {truck.capacity ?? 0} ton · {truck.speed ?? 0} km/h
      </Text>

      {isOnRoute && delivery ? (
        <View style={styles.inlineRouteBlock}>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="route" size={12} color={colors.accentBlue} />
            <Text style={styles.routeText} numberOfLines={1}>
              {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
            </Text>
          </View>
          <View style={styles.inlineRouteMetaRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.routeMeta}>
              {formatPercent(delivery.progress)} ·{' '}
              {formatRemainingHours(currentTime, delivery.estimatedArrivalTime)} kaldı
            </Text>
          </View>
          <ProgressBar progress={delivery.progress} color={colors.accentBlue} height={3} />
        </View>
      ) : null}

      <View style={styles.conditionRow}>
        <View style={styles.conditionLabelRow}>
          <Text style={[styles.conditionLabel, { color: conditionColor }]}>
            Kondisyon {Math.round(truckCondition)}%
          </Text>
          {maintenanceBadge ? (
            <StatusBadge label={maintenanceBadge.label} variant={maintenanceBadge.variant} size="sm" />
          ) : null}
        </View>
        <ProgressBar progress={truckCondition / 100} color={conditionColor} height={3} />
      </View>

      <View style={styles.cardFooter}>
        {showRepairButton ? (
          <ActionButton
            label={canAfford ? `Tamir et (${formatMoney(repairCost)})` : 'Nakit yetersiz'}
            onPress={() => onRepair(truck)}
            disabled={!canAfford}
            variant="secondary"
            icon="repair"
            iconSize={13}
            compact
            style={styles.compactAction}
          />
        ) : showGoodMaintenance ? (
          <Text style={styles.footerSuccess}>Bakımı iyi</Text>
        ) : isIdle ? (
          <Text style={styles.footerMuted}>Yeni sözleşme için hazır</Text>
        ) : truck.status === 'maintenance' ? (
          <Text style={styles.footerMuted}>Tamir tamamlanmadan işe çıkamaz</Text>
        ) : isOnRoute ? (
          <Text style={styles.footerMuted}>Teslimat sürüyor</Text>
        ) : null}
      </View>
    </AppCard>
  );
}

interface OwnedDriverCardProps {
  driver: Driver;
  trucks: Truck[];
  activeDeliveries: Delivery[];
  currentTime: number;
}

function OwnedDriverCard({ driver, trucks, activeDeliveries, currentTime }: OwnedDriverCardProps) {
  const statusBadge = getDriverStatusBadge(driver.status);
  const trait = getDriverTrait(driver);
  const activeDelivery = findActiveDeliveryForDriver(driver.id, activeDeliveries);
  const assignedTruck =
    trucks.find((t) => t.id === driver.assignedTruckId) ??
    (activeDelivery ? trucks.find((t) => t.id === activeDelivery.truckId) : undefined);
  const attention = Math.round(driver.attention ?? 0);
  const experience = Math.round(driver.experience ?? 0);
  const isDriving = driver.status === 'driving';
  const isIdle = driver.status === 'idle';

  return (
    <AppCard style={styles.fleetCard} padded>
      <View style={styles.cardTopRow}>
        <View style={[styles.entityIconBox, styles.driverIconCircle]}>
          <GameIcon name="driver" size={18} color={colors.accentBlue} />
        </View>

        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {driver.name}
          </Text>
        </View>

        <View style={styles.cardRight}>
          <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
        </View>
      </View>

      <Text style={styles.statsRow}>
        Deneyim {experience} · Dikkat {attention} · Maaş {formatMoney(driver.salaryPerDay ?? 0)}/gün
      </Text>

      {isDriving && activeDelivery ? (
        <View style={styles.inlineRouteBlock}>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="truck" size={12} color={colors.accentBlue} />
            <Text style={styles.routeMeta} numberOfLines={1}>
              {assignedTruck?.name ?? 'Atanmış kamyon'}
            </Text>
          </View>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="route" size={12} color={colors.accentBlue} />
            <Text style={styles.routeText} numberOfLines={1}>
              {getCityName(activeDelivery.originCityId)} → {getCityName(activeDelivery.destinationCityId)}
            </Text>
          </View>
          <View style={styles.inlineRouteMetaRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.routeMeta}>
              {formatPercent(activeDelivery.progress)} ·{' '}
              {formatRemainingHours(currentTime, activeDelivery.estimatedArrivalTime)} kaldı
            </Text>
          </View>
          <ProgressBar progress={activeDelivery.progress} color={colors.accentBlue} height={3} />
        </View>
      ) : null}

      <View style={styles.traitRow}>
        <StatusBadge label={trait.label} variant={trait.variant} size="sm" />
      </View>

      {isIdle ? (
        <Text style={styles.footerMuted}>Yeni teslimat için hazır</Text>
      ) : driver.status === 'resting' ? (
        <Text style={styles.footerMuted}>Dinleniyor</Text>
      ) : null}
    </AppCard>
  );
}

interface ShopTruckCardProps {
  template: TruckMarketItem;
  playerMoney: number;
  playerLevel: number;
  ownedCount: number;
  canBuy: boolean;
  onBuy: (catalogId: string) => void;
}

function ShopTruckCard({
  template,
  playerMoney,
  playerLevel,
  ownedCount,
  canBuy,
  onBuy,
}: ShopTruckCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const requiredLevel = resolveTruckMarketRequiredLevel(template);
  const isLevelLocked = safePlayerLevel < requiredLevel;
  const canAfford = playerMoney >= template.purchasePrice;
  const disabled = !canBuy || !canAfford || isLevelLocked;
  const tags = getTruckShopTags(template);

  let buttonLabel = 'Satın Al';
  if (isLevelLocked) {
    buttonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canBuy) {
    buttonLabel = 'Yakında';
  } else if (!canAfford) {
    buttonLabel = 'Nakit yetersiz';
  } else if (ownedCount > 0) {
    buttonLabel = 'Tekrar Satın Al';
  }

  return (
    <AppCard style={[styles.fleetCard, isLevelLocked && styles.lockedCard]} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.entityIconBox}>
          <GameIcon name="truck" size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {template.name}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <View style={styles.priceRow}>
            <GameIcon name="cash" size={12} color={colors.success} />
            <Text style={styles.priceText}>{formatMoney(template.purchasePrice)}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.statsRow}>
        {template.capacity} ton · {template.speed} km/h · {template.fuelConsumptionPerKm.toFixed(2)} L/km ·
        Dayanıklılık {template.reliability}
        {requiredLevel > 1 ? ` · Lv.${requiredLevel}` : ''}
      </Text>

      {ownedCount > 0 ? (
        <Text style={styles.ownedHint}>Filonda {ownedCount} adet mevcut</Text>
      ) : null}

      {tags.length > 0 ? (
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <StatusBadge key={tag.label} label={tag.label} variant={tag.variant} size="sm" />
          ))}
        </View>
      ) : null}

      <ActionButton
        label={buttonLabel}
        onPress={() => onBuy(template.id)}
        disabled={disabled}
        variant="primary"
        icon={isLevelLocked ? 'level' : 'plus'}
        iconSize={13}
        compact
        fullWidth
        style={styles.shopAction}
      />
    </AppCard>
  );
}

interface ShopDriverCardProps {
  template: DriverMarketItem;
  playerMoney: number;
  playerLevel: number;
  alreadyHired: boolean;
  canHire: boolean;
  onHire: (poolId: string) => void;
}

function ShopDriverCard({
  template,
  playerMoney,
  playerLevel,
  alreadyHired,
  canHire,
  onHire,
}: ShopDriverCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const requiredLevel = resolveDriverRequiredLevel(template);
  const isLevelLocked = safePlayerLevel < requiredLevel;
  const isComingSoon = template.comingSoon === true;
  const canAfford = playerMoney >= template.hiringFee;
  const disabled = !canHire || alreadyHired || !canAfford || isLevelLocked || isComingSoon;
  const tags = getDriverShopTags(template);

  let buttonLabel = 'İşe Al';
  if (isComingSoon) {
    buttonLabel = 'Yakında';
  } else if (isLevelLocked) {
    buttonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canHire) {
    buttonLabel = 'Yakında';
  } else if (alreadyHired) {
    buttonLabel = 'İşe alındı';
  } else if (!canAfford) {
    buttonLabel = 'Nakit yetersiz';
  }

  return (
    <AppCard
      style={[styles.fleetCard, (isLevelLocked || isComingSoon) && styles.lockedCard]}
      padded
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.entityIconBox, styles.driverIconCircle]}>
          <GameIcon name="driver" size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {template.name}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <View style={styles.priceRow}>
            <GameIcon name="cash" size={12} color={colors.accentAmber} />
            <Text style={styles.priceTextHire}>{formatMoney(template.hiringFee)}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.statsRow}>
        Deneyim {template.experience} · Dikkat {template.attention} · Maaş{' '}
        {formatMoney(template.salaryPerDay)}/gün
      </Text>

      {tags.length > 0 ? (
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <StatusBadge key={tag.label} label={tag.label} variant={tag.variant} size="sm" />
          ))}
        </View>
      ) : null}

      <ActionButton
        label={buttonLabel}
        onPress={() => onHire(template.id)}
        disabled={disabled}
        variant="primary"
        icon={isLevelLocked ? 'level' : 'plus'}
        iconSize={13}
        compact
        fullWidth
        style={styles.shopAction}
      />
    </AppCard>
  );
}

export default function FleetScreen() {
  const player = useGameStore((state) => state.player);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);
  const buyTruck = useGameStore((state) => state.buyTruck);
  const hireDriver = useGameStore((state) => state.hireDriver);
  const repairTruck = useGameStore((state) => state.repairTruck);
  const pendingFleetSubTab = useGameStore((state) => state.pendingFleetSubTab);
  const clearPendingFleetSubTab = useGameStore((state) => state.clearPendingFleetSubTab);
  const { tabBarHeight, bottomInset } = useTabBarLayout();

  const [activeTab, setActiveTab] = useState<FleetTab>('trucks');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  const listScrollBottomPadding = tabBarHeight + bottomInset + LIST_SCROLL_BOTTOM_EXTRA;

  useEffect(() => {
    if (!pendingFleetSubTab) return;

    if (pendingFleetSubTab === 'shop' || pendingFleetSubTab === 'hire_drivers') {
      setActiveTab('shop');
    } else if (pendingFleetSubTab === 'trucks') {
      setActiveTab('trucks');
    } else if (pendingFleetSubTab === 'drivers') {
      setActiveTab('drivers');
    }

    clearPendingFleetSubTab();
  }, [pendingFleetSubTab, clearPendingFleetSubTab]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const trucks = useMemo(() => player?.trucks ?? [], [player]);
  const drivers = useMemo(() => player?.drivers ?? [], [player]);
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerMoney = player?.money ?? 0;

  const fleetSummary = useMemo(
    () => ({
      idleTrucks: trucks.filter((t) => t.status === 'idle').length,
      onRouteTrucks: trucks.filter((t) => t.status === 'on_route').length,
      idleDrivers: drivers.filter((d) => d.status === 'idle').length,
      averageCondition: calculateAverageCondition(trucks),
    }),
    [trucks, drivers],
  );

  const sortedTruckMarket = useMemo(
    () =>
      [...TRUCK_MARKET].sort(
        (a, b) => resolveTruckMarketRequiredLevel(a) - resolveTruckMarketRequiredLevel(b),
      ),
    [],
  );

  const driverPool = useMemo(() => getDriverPoolForLevel(playerLevel), [playerLevel]);

  const showFleetTip =
    activeTab === 'trucks' && fleetSummary.idleTrucks === 0 && fleetSummary.onRouteTrucks > 0;

  const handleRepair = (truck: Truck) => {
    if (typeof repairTruck !== 'function') {
      setStatusMessage({ type: 'error', text: 'Tamir henüz kullanılamıyor' });
      return;
    }
    try {
      repairTruck(truck.id);
      setStatusMessage({ type: 'success', text: 'Kamyon tamir edildi' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: translateErrorMessage(error, 'Nakit yetersiz') });
    }
  };

  const handleBuyTruck = (catalogId: string) => {
    if (typeof buyTruck !== 'function') {
      setStatusMessage({ type: 'error', text: 'Yakında' });
      return;
    }
    const result = buyTruck(catalogId);
    if (!result.success) {
      setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
      return;
    }
    setStatusMessage({ type: 'success', text: result.message ?? 'Kamyon satın alındı' });
  };

  const handleHireDriver = (poolId: string) => {
    if (typeof hireDriver !== 'function') {
      setStatusMessage({ type: 'error', text: 'Yakında' });
      return;
    }
    const result = hireDriver(poolId);
    if (!result.success) {
      setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
      return;
    }
    setStatusMessage({ type: 'success', text: result.message ?? 'Şoför işe alındı' });
  };

  if (!player) {
    return (
      <AppScreen>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll scrollBottomPadding={listScrollBottomPadding}>
      <ScreenHeader
        title="Filo"
        subtitle="Kamyonlarını, şoförlerini ve satın alımları yönet"
      />

      {statusMessage ? (
        <AppCard
          variant={statusMessage.type === 'success' ? 'success' : 'danger'}
          style={styles.statusBanner}
          padded
        >
          <View style={styles.statusBannerRow}>
            <GameIcon
              name={statusMessage.type === 'success' ? 'success' : 'warning'}
              size={16}
              color={statusMessage.type === 'success' ? colors.success : colors.danger}
            />
            <Text
              style={[
                styles.statusBannerText,
                { color: statusMessage.type === 'success' ? colors.success : colors.danger },
              ]}
            >
              {statusMessage.text}
            </Text>
          </View>
        </AppCard>
      ) : null}

      <FleetMetricStrip
        truckCount={trucks.length}
        driverCount={drivers.length}
        idleTrucks={fleetSummary.idleTrucks}
        onRouteTrucks={fleetSummary.onRouteTrucks}
        averageCondition={fleetSummary.averageCondition}
      />

      <SegmentedControl
        options={FLEET_TABS}
        activeKey={activeTab}
        onChange={setActiveTab}
        accentColor={colors.accentBlue}
      />

      {activeTab === 'trucks' ? (
        <View style={styles.tabContent}>
          <SectionTitle title="Kamyonlar" subtitle="Filondaki tüm kamyonlar" compact />

          {trucks.length === 0 ? (
            <EmptyState
              title="Henüz kamyon yok"
              message="Mağazadan ilk kamyonunu satın al."
              icon="truck"
              actionLabel="Mağazaya Git"
              onAction={() => setActiveTab('shop')}
            />
          ) : (
            <>
              {trucks.map((truck) => (
                <OwnedTruckCard
                  key={truck.id}
                  truck={truck}
                  playerMoney={playerMoney}
                  delivery={findActiveDeliveryForTruck(truck.id, activeDeliveries)}
                  currentTime={currentTime}
                  onRepair={handleRepair}
                />
              ))}
              {showFleetTip ? (
                <AppCard variant="highlighted" style={styles.tipCard} padded>
                  <View style={styles.tipTitleRow}>
                    <GameIcon name="warning" size={16} color={colors.accentAmber} />
                    <Text style={styles.tipTitle}>Filo önerisi</Text>
                  </View>
                  <Text style={styles.tipText}>
                    Boşta kamyonun yok. Yeni sözleşme almak için teslimatın bitmesini bekle veya
                    Mağaza sekmesinden yeni kamyon satın al.
                  </Text>
                </AppCard>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {activeTab === 'drivers' ? (
        <View style={styles.tabContent}>
          <SectionTitle title="Şoförler" subtitle="Filondaki tüm şoförler" compact />

          {drivers.length === 0 ? (
            <EmptyState
              title="Henüz şoför yok"
              message="Şoför havuzundan ilk şoförünü işe al."
              icon="driver"
              actionLabel="Mağazaya Git"
              onAction={() => setActiveTab('shop')}
            />
          ) : (
            drivers.map((driver) => (
              <OwnedDriverCard
                key={driver.id}
                driver={driver}
                trucks={trucks}
                activeDeliveries={activeDeliveries}
                currentTime={currentTime}
              />
            ))
          )}
        </View>
      ) : null}

      {activeTab === 'shop' ? (
        <View style={styles.tabContent}>
          <SectionTitle title="Kamyon Pazarı" subtitle="Yeni kamyon satın al" compact />
          {sortedTruckMarket.length === 0 ? (
            <EmptyState title="Mağaza şu anda boş" icon="inventory" />
          ) : (
            sortedTruckMarket.map((template) => (
              <ShopTruckCard
                key={template.id}
                template={template}
                playerMoney={playerMoney}
                playerLevel={playerLevel}
                ownedCount={countOwnedTrucksOfCatalog(trucks, template.id)}
                canBuy={typeof buyTruck === 'function'}
                onBuy={handleBuyTruck}
              />
            ))
          )}

          <SectionTitle
            title="Şoför Havuzu"
            subtitle="Yeni şoför işe al"
            compact
            style={styles.shopSectionSpaced}
          />
          {driverPool.length === 0 ? (
            <EmptyState title="Mağaza şu anda boş" icon="driver" />
          ) : (
            driverPool.map((template) => (
              <ShopDriverCard
                key={template.id}
                template={template}
                playerMoney={playerMoney}
                playerLevel={playerLevel}
                alreadyHired={isDriverPoolItemHired(drivers, template.id)}
                canHire={typeof hireDriver === 'function'}
                onHire={handleHireDriver}
              />
            ))
          )}
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statusBanner: {
    marginBottom: spacing.sm,
  },
  statusBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBannerText: {
    ...typography.bodySmall,
    fontWeight: '700',
    flex: 1,
  },
  metricStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  tabContent: {
    marginTop: spacing.sm,
  },
  fleetCard: {
    marginBottom: 11,
  },
  lockedCard: {
    opacity: 0.72,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  entityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverIconCircle: {
    borderRadius: 20,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    ...typography.cardTitle,
    fontSize: 14,
    fontWeight: '800',
  },
  statsRow: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: 96,
  },
  inlineRouteBlock: {
    marginTop: 6,
    gap: 3,
  },
  inlineRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inlineRouteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  routeText: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  routeMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  conditionRow: {
    marginTop: 6,
    gap: 4,
  },
  conditionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  conditionLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  cardFooter: {
    marginTop: 6,
    alignItems: 'flex-start',
  },
  compactAction: {
    minHeight: 34,
  },
  footerMuted: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  footerSuccess: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
    marginTop: 2,
  },
  traitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 6,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
    fontSize: 13,
  },
  priceTextHire: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
    fontSize: 13,
  },
  ownedHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  shopAction: {
    marginTop: 4,
  },
  shopSectionSpaced: {
    marginTop: spacing.md,
  },
  tipCard: {
    marginTop: spacing.xs,
  },
  tipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  tipTitle: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
  },
  tipText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
