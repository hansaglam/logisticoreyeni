/**
 * LogistiCore - Filo Ekranı
 *
 * Kamyon, şoför ve mağaza içerikleri iç sekmelerle ayrılmış sade filo yönetimi.
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

import { useGameStore } from '../store/gameStore';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { AVAILABLE_TRUCKS, type TruckTemplate } from '../data/trucks';
import { getTruckUnlockLevel } from '../simulation/leveling';
import { AVAILABLE_DRIVERS, type DriverTemplate } from '../data/drivers';
import { calculateTruckRepairCost } from '../simulation/delivery';
import type { Delivery, DeliveryStatus, Driver, ProductId, Truck } from '../types/game';

const COLORS = {
  background: '#070A12',
  card: '#111827',
  cardAlt: '#121826',
  border: '#1F2A3C',
  primary: '#F59E0B',
  secondary: '#38BDF8',
  success: '#22C55E',
  danger: '#EF4444',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
};

const CONDITION_GOOD_THRESHOLD = 80;
const CONDITION_FAIR_THRESHOLD = 50;
const RISKY_ATTENTION_THRESHOLD = 50;
const LOW_MORALE_THRESHOLD = 50;
const FUEL_EFFICIENT_THRESHOLD = 50;
const FAST_SPEED_THRESHOLD = 15;
const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];

type FleetTab = 'trucks' | 'drivers' | 'shop';
type StatusMessage = { type: 'success' | 'error'; text: string } | null;

const TABS: { key: FleetTab; label: string }[] = [
  { key: 'trucks', label: 'Kamyonlar' },
  { key: 'drivers', label: 'Şoförler' },
  { key: 'shop', label: 'Mağaza' },
];

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getDriverName(driverId: string, drivers: Driver[]): string {
  const driver = drivers.find((d) => d.id === driverId);
  return driver?.name ?? 'Bilinmeyen şoför';
}

function formatPercent(progress: number): string {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function formatRemainingHours(currentTime: number, estimatedArrivalTime: number): string {
  const remaining = Math.max(0, estimatedArrivalTime - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  return `${hrs} sa ${mins.toString().padStart(2, '0')} dk`;
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

function getTruckStatusPresentation(status: Truck['status']): {
  label: string;
  color: string;
  pill: string;
} {
  switch (status) {
    case 'on_route':
      return { label: 'YOLDA', color: COLORS.secondary, pill: 'Teslimat sürüyor' };
    case 'maintenance':
      return { label: 'BAKIMDA', color: COLORS.primary, pill: 'Bakımda' };
    default:
      return { label: 'BOŞTA', color: COLORS.success, pill: 'İşe hazır' };
  }
}

function getDriverStatusPresentation(status: Driver['status']): { label: string; color: string } {
  switch (status) {
    case 'driving':
      return { label: 'YOLDA', color: COLORS.secondary };
    case 'resting':
      return { label: 'DİNLENİYOR', color: COLORS.primary };
    default:
      return { label: 'BOŞTA', color: COLORS.success };
  }
}

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function getConditionColor(condition: number): string {
  if (condition >= CONDITION_GOOD_THRESHOLD) return COLORS.success;
  if (condition >= CONDITION_FAIR_THRESHOLD) return COLORS.primary;
  return COLORS.danger;
}

function calculateAverageCondition(trucks: Truck[]): number {
  if (trucks.length === 0) return 0;
  return trucks.reduce((sum, truck) => sum + truck.condition, 0) / trucks.length;
}

function getDriverPerformanceLabel(driver: Driver): { label: string; color: string } {
  if (driver.attention < RISKY_ATTENTION_THRESHOLD) {
    return { label: 'Riskli şoför', color: COLORS.danger };
  }
  if (driver.morale < LOW_MORALE_THRESHOLD) {
    return { label: 'Düşük moral', color: COLORS.danger };
  }
  if (driver.fuelSaving >= FUEL_EFFICIENT_THRESHOLD) {
    return { label: 'Yakıt tasarruflu', color: COLORS.success };
  }
  if (driver.speed >= FAST_SPEED_THRESHOLD) {
    return { label: 'Hızlı teslimat', color: COLORS.secondary };
  }
  return { label: 'Dengeli şoför', color: COLORS.textSecondary };
}

function ShopStatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.shopStatRow}>
      <Text style={styles.shopStatLabel}>{label}</Text>
      <Text style={styles.shopStatValue}>{value}</Text>
    </View>
  );
}

function ShopTag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const color =
    tone === 'success'
      ? COLORS.success
      : tone === 'warning'
        ? COLORS.primary
        : tone === 'danger'
          ? COLORS.danger
          : COLORS.textSecondary;
  return (
    <View style={[styles.shopTag, { borderColor: color }]}>
      <Text style={[styles.shopTagText, { color }]}>{label}</Text>
    </View>
  );
}

function getTruckShopTags(template: TruckTemplate): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }[] {
  const tags: { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }[] = [];
  if (template.capacity >= 28) tags.push({ label: 'Yüksek kapasite', tone: 'success' });
  if (template.fuelConsumptionPerKm <= 0.3) tags.push({ label: 'Yakıt tasarruflu', tone: 'success' });
  if (template.speed >= 78) tags.push({ label: 'Hızlı teslimat', tone: 'warning' });
  if (template.reliability < 75) tags.push({ label: 'Arıza riski yüksek', tone: 'danger' });
  return tags;
}

function getDriverShopTags(template: DriverTemplate): { label: string; tone: 'success' | 'warning' | 'neutral' }[] {
  const tags: { label: string; tone: 'success' | 'warning' | 'neutral' }[] = [];
  if (template.fuelSaving >= 50) tags.push({ label: 'Yakıt tasarruflu', tone: 'success' });
  if (template.attention >= 80) tags.push({ label: 'Güvenli sürücü', tone: 'success' });
  if (template.speed >= 15) tags.push({ label: 'Hızlı sürücü', tone: 'warning' });
  if (tags.length === 0) tags.push({ label: 'Dengeli şoför', tone: 'neutral' });
  return tags;
}

function ProgressBar({
  progress,
  color,
  variant = 'default',
}: {
  progress: number;
  color: string;
  variant?: 'default' | 'delivery' | 'driver';
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const trackStyle =
    variant === 'delivery'
      ? styles.deliveryProgressTrack
      : variant === 'driver'
        ? styles.driverProgressTrack
        : styles.progressTrack;
  return (
    <View style={trackStyle}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function StatusPill({ text, color }: { text: string; color: string }) {
  const isDeliveryPill = color === COLORS.secondary;
  return (
    <View
      style={[
        styles.statusPill,
        { borderColor: color },
        isDeliveryPill && styles.statusPillDelivery,
      ]}
    >
      <Text style={[styles.statusPillText, isDeliveryPill && styles.statusPillTextDelivery, { color }]}>
        {text}
      </Text>
    </View>
  );
}

function FleetTabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tabButton, active && styles.tabButtonActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TruckCard({
  truck,
  playerMoney,
  drivers,
  delivery,
  currentTime,
  onRepair,
}: {
  truck: Truck;
  playerMoney: number;
  drivers: Driver[];
  delivery?: Delivery;
  currentTime: number;
  onRepair: (truck: Truck) => void;
}) {
  const truckCondition = truck.condition ?? 100;
  const conditionColor = getConditionColor(truckCondition);
  const repairCost = calculateTruckRepairCost(truck);
  const isFullCondition = truckCondition >= 100;
  const isOnRoute = truck.status === 'on_route';
  const isMaintenance = truck.status === 'maintenance';
  const canAfford = playerMoney >= repairCost;
  const status = getTruckStatusPresentation(truck.status);
  const showRepairButton = truck.status === 'idle' && !isFullCondition;

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeaderRow}>
        <Text style={styles.itemName}>{truck.name}</Text>
        <Text style={[styles.itemStatusBadge, { color: status.color }]}>{status.label}</Text>
      </View>
      <Text style={styles.itemMeta}>
        {truck.capacity} ton · {truck.speed} km/h
      </Text>
      <Text style={[styles.conditionLabel, { color: conditionColor }]}>
        Kondisyon {truckCondition.toFixed(0)}%
      </Text>
      <ProgressBar progress={truckCondition / 100} color={conditionColor} />

      {isOnRoute && delivery ? (
        <View style={styles.deliveryBlock}>
          <Text style={styles.deliverySectionTitle}>Aktif Operasyon</Text>
          <Text style={styles.deliveryRoute}>
            {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
          </Text>
          <Text style={styles.deliveryMeta}>
            {getProductName(delivery.productId)} · {delivery.amount.toFixed(1)} ton
          </Text>
          <Text style={styles.deliveryMeta}>
            Şoför: {getDriverName(delivery.driverId, drivers)}
          </Text>
          <Text style={styles.deliveryMetaMuted}>
            Varış: {formatRemainingHours(currentTime, delivery.estimatedArrivalTime)} kaldı
          </Text>
          <Text style={styles.deliveryMeta}>Yakıt: {formatMoney(delivery.fuelCost)}</Text>
          <Text style={styles.deliveryMetaProfit}>
            Tahmini kâr: {formatMoney(delivery.estimatedProfit)}
          </Text>
          <Text style={styles.progressLabel}>İlerleme: {formatPercent(delivery.progress)}</Text>
          <ProgressBar progress={delivery.progress} color={COLORS.secondary} variant="delivery" />
        </View>
      ) : isOnRoute ? (
        <Text style={styles.idleHint}>Aktif teslimat bilgisi yükleniyor...</Text>
      ) : isMaintenance ? (
        <Text style={styles.idleHint}>Tamir tamamlanmadan işe çıkamaz</Text>
      ) : (
        <Text style={styles.idleHint}>Yeni bir sözleşme için hazır</Text>
      )}

      {showRepairButton ? (
        <TouchableOpacity
          style={[styles.actionButton, !canAfford && styles.actionButtonDisabled]}
          disabled={!canAfford}
          onPress={() => onRepair(truck)}
          activeOpacity={0.85}
        >
          <Text style={[styles.actionButtonText, !canAfford && styles.actionButtonTextDisabled]}>
            {canAfford ? `Tamir et (${formatMoney(repairCost)})` : 'Nakit yetersiz'}
          </Text>
        </TouchableOpacity>
      ) : isFullCondition && truck.status === 'idle' ? (
        <Text style={styles.noRepairText}>Bakım gerekmiyor</Text>
      ) : (
        <StatusPill text={status.pill} color={status.color} />
      )}
    </View>
  );
}

function DriverCard({
  driver,
  trucks,
  activeDeliveries,
  currentTime,
}: {
  driver: Driver;
  trucks: Truck[];
  activeDeliveries: Delivery[];
  currentTime: number;
}) {
  const performance = getDriverPerformanceLabel(driver);
  const status = getDriverStatusPresentation(driver.status);
  const activeDelivery = findActiveDeliveryForDriver(driver.id, activeDeliveries);
  const assignedTruck =
    trucks.find((t) => t.id === driver.assignedTruckId) ??
    (activeDelivery ? trucks.find((t) => t.id === activeDelivery.truckId) : undefined);

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeaderRow}>
        <Text style={styles.itemName}>{driver.name}</Text>
        {driver.status === 'driving' ? (
          <View style={styles.driverStatusPill}>
            <Text style={styles.driverStatusPillText}>YOLDA</Text>
          </View>
        ) : (
          <Text style={[styles.itemStatusBadge, { color: status.color }]}>{status.label}</Text>
        )}
      </View>

      {driver.status === 'driving' && activeDelivery ? (
        <View style={styles.driverActiveBlock}>
          <Text style={styles.driverActiveRoute}>
            {getCityName(activeDelivery.originCityId)} → {getCityName(activeDelivery.destinationCityId)}
          </Text>
          <Text style={styles.driverRouteSubtitle}>Aktif teslimat rotası</Text>
          <Text style={styles.deliveryMeta}>
            Kamyon: {assignedTruck?.name ?? 'Atanmış kamyon'}
          </Text>
          <Text style={styles.progressLabel}>İlerleme: {formatPercent(activeDelivery.progress)}</Text>
          <ProgressBar progress={activeDelivery.progress} color={COLORS.secondary} variant="driver" />
          <Text style={styles.deliveryMetaMuted}>
            Varış: {formatRemainingHours(currentTime, activeDelivery.estimatedArrivalTime)} kaldı
          </Text>
        </View>
      ) : driver.status === 'idle' ? (
        <Text style={styles.idleHint}>Yeni teslimat için hazır</Text>
      ) : null}

      <View style={styles.driverStatsRow}>
        <View style={styles.driverStatChip}>
          <Text style={styles.driverStatChipText}>Moral {driver.morale}</Text>
        </View>
        <View style={styles.driverStatChip}>
          <Text style={styles.driverStatChipText}>Dikkat {driver.attention}</Text>
        </View>
        <View style={styles.driverStatChip}>
          <Text style={styles.driverStatChipText}>Yakıt {driver.fuelSaving}</Text>
        </View>
      </View>
      <View style={[styles.performanceBadge, { borderColor: performance.color }]}>
        <Text style={[styles.performanceBadgeText, { color: performance.color }]}>
          {performance.label}
        </Text>
      </View>
    </View>
  );
}

function AvailableTruckCard({
  template,
  playerMoney,
  playerLevel,
  alreadyOwned,
  canBuy,
  onBuy,
}: {
  template: TruckTemplate;
  playerMoney: number;
  playerLevel: number;
  alreadyOwned: boolean;
  canBuy: boolean;
  onBuy: (truckId: string) => void;
}) {
  const requiredLevel = getTruckUnlockLevel(template.id);
  const isLevelLocked = playerLevel < requiredLevel;
  const canAfford = playerMoney >= template.purchasePrice;
  const disabled = !canBuy || alreadyOwned || !canAfford || isLevelLocked;
  const tags = getTruckShopTags(template);

  let buttonLabel = 'Satın Al';
  if (isLevelLocked) buttonLabel = `Level ${requiredLevel} gerekli`;
  else if (!canBuy) buttonLabel = 'Yakında';
  else if (alreadyOwned) buttonLabel = 'Sahipsin';
  else if (!canAfford) buttonLabel = 'Nakit yetersiz';

  return (
    <View style={[styles.shopCard, isLevelLocked && styles.shopCardLocked]}>
      <View style={styles.shopCardHeaderRow}>
        <Text style={styles.shopItemName} numberOfLines={1}>
          {template.name}
        </Text>
        <Text style={styles.shopPriceSuccess}>{formatMoney(template.purchasePrice)}</Text>
      </View>

      <Text style={styles.shopShortMeta}>
        {template.capacity} ton · {template.speed} km/h
      </Text>

      {isLevelLocked ? (
        <Text style={styles.shopLockHint}>Daha yüksek seviyede açılır.</Text>
      ) : null}

      <View style={styles.shopStatGrid}>
        <ShopStatRow label="Kapasite" value={`${template.capacity} ton`} />
        <ShopStatRow label="Yakıt" value={`${template.fuelConsumptionPerKm.toFixed(2)} L/km`} />
        <ShopStatRow label="Hız" value={`${template.speed} km/h`} />
        <ShopStatRow label="Dayanıklılık" value={`${template.reliability}/100`} />
      </View>

      {tags.length > 0 ? (
        <View style={styles.shopTagRow}>
          {tags.map((tag) => (
            <ShopTag key={tag.label} label={tag.label} tone={tag.tone} />
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.shopActionButton, disabled && styles.shopActionButtonDisabled]}
        disabled={disabled}
        onPress={() => onBuy(template.id)}
        activeOpacity={0.85}
      >
        <Text style={[styles.shopActionButtonText, disabled && styles.shopActionButtonTextDisabled]}>
          {buttonLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AvailableDriverCard({
  template,
  playerMoney,
  alreadyHired,
  canHire,
  onHire,
}: {
  template: DriverTemplate;
  playerMoney: number;
  alreadyHired: boolean;
  canHire: boolean;
  onHire: (driverId: string) => void;
}) {
  const canAfford = playerMoney >= template.hiringFee;
  const disabled = !canHire || alreadyHired || !canAfford;
  const tags = getDriverShopTags(template);

  let buttonLabel = `İşe Al ${formatMoney(template.hiringFee)}`;
  if (!canHire) buttonLabel = 'Yakında';
  else if (alreadyHired) buttonLabel = 'İşe alındı';
  else if (!canAfford) buttonLabel = 'Nakit yetersiz';

  return (
    <View style={styles.shopCard}>
      <View style={styles.shopCardHeaderRow}>
        <Text style={styles.shopItemName} numberOfLines={1}>
          {template.name}
        </Text>
        <Text style={styles.shopPricePrimary}>{formatMoney(template.hiringFee)} işe alım</Text>
      </View>

      <View style={styles.shopStatGrid}>
        <ShopStatRow label="Deneyim" value={`${template.experience}/100`} />
        <ShopStatRow label="Dikkat" value={`${template.attention}/100`} />
        <ShopStatRow label="Yakıt" value={`${template.fuelSaving}/100`} />
        <ShopStatRow label="Hız" value={`${template.speed}`} />
        <ShopStatRow label="Moral" value={`${template.morale}/100`} />
        <ShopStatRow label="Maaş" value={`${formatMoney(template.salaryPerDay)}/gün`} />
      </View>

      <View style={styles.shopTagRow}>
        {tags.map((tag) => (
          <ShopTag key={tag.label} label={tag.label} tone={tag.tone} />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.shopActionButton, disabled && styles.shopActionButtonDisabled]}
        disabled={disabled}
        onPress={() => onHire(template.id)}
        activeOpacity={0.85}
      >
        <Text style={[styles.shopActionButtonText, disabled && styles.shopActionButtonTextDisabled]}>
          {buttonLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FleetScreen() {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);

  const buyTruck = useGameStore((state) => state.buyTruck);
  const hireDriver = useGameStore((state) => state.hireDriver);
  const repairTruck = useGameStore((state) => state.repairTruck);
  const pendingFleetSubTab = useGameStore((state) => state.pendingFleetSubTab);
  const clearPendingFleetSubTab = useGameStore((state) => state.clearPendingFleetSubTab);
  const { scrollBottomPadding } = useTabBarLayout();

  const [activeTab, setActiveTab] = useState<FleetTab>('trucks');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  useEffect(() => {
    if (!pendingFleetSubTab) return;
    setActiveTab(pendingFleetSubTab);
    clearPendingFleetSubTab();
  }, [pendingFleetSubTab, clearPendingFleetSubTab]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const trucks = useMemo(() => player?.trucks ?? [], [player]);
  const drivers = useMemo(() => player?.drivers ?? [], [player]);

  const fleetSummary = useMemo(
    () => ({
      idleTrucks: trucks.filter((t) => t.status === 'idle').length,
      onRouteTrucks: trucks.filter((t) => t.status === 'on_route').length,
      idleDrivers: drivers.filter((d) => d.status === 'idle').length,
      averageCondition: calculateAverageCondition(trucks),
    }),
    [trucks, drivers],
  );

  if (!player) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const translateErrorMessage = (error: unknown, fallback: string): string => {
    if (!(error instanceof Error)) return fallback;
    if (error.message.includes('Yetersiz')) return 'Nakit yetersiz';
    if (error.message.includes('zaten')) return 'Zaten mevcut';
    if (error.message.includes('bulunamadı')) return 'Bulunamadı';
    if (error.message.includes('Yoldaki')) return 'Kamyon yolda';
    return error.message;
  };

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

  const handleBuyTruck = (truckId: string) => {
    if (typeof buyTruck !== 'function') {
      setStatusMessage({ type: 'error', text: 'Yakında' });
      return;
    }
    try {
      buyTruck(truckId);
      setStatusMessage({ type: 'success', text: 'Kamyon satın alındı' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: translateErrorMessage(error, 'İşlem başarısız') });
    }
  };

  const handleHireDriver = (driverId: string) => {
    if (typeof hireDriver !== 'function') {
      setStatusMessage({ type: 'error', text: 'Yakında' });
      return;
    }
    try {
      hireDriver(driverId);
      setStatusMessage({ type: 'success', text: 'Şoför işe alındı' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: translateErrorMessage(error, 'İşlem başarısız') });
    }
  };

  const showFleetTip =
    activeTab === 'trucks' && fleetSummary.idleTrucks === 0 && fleetSummary.onRouteTrucks > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Filo</Text>
          <View style={styles.headerBadges}>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeValue}>{trucks.length}</Text>
              <Text style={styles.headerBadgeLabel}>Kamyon</Text>
            </View>
            <View style={styles.headerBadge}>
              <Text style={[styles.headerBadgeValue, { color: COLORS.secondary }]}>
                {drivers.length}
              </Text>
              <Text style={styles.headerBadgeLabel}>Şoför</Text>
            </View>
          </View>
        </View>

        {statusMessage && (
          <View
            style={[
              styles.statusBanner,
              { borderColor: statusMessage.type === 'success' ? COLORS.success : COLORS.danger },
            ]}
          >
            <Text
              style={[
                styles.statusBannerText,
                { color: statusMessage.type === 'success' ? COLORS.success : COLORS.danger },
              ]}
            >
              {statusMessage.text}
            </Text>
          </View>
        )}

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.success }]}>
              {fleetSummary.idleTrucks}
            </Text>
            <Text style={styles.summaryLabel}>Boşta</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.secondary }]}>
              {fleetSummary.onRouteTrucks}
            </Text>
            <Text style={styles.summaryLabel}>Yolda</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text
              style={[
                styles.summaryValue,
                { color: getConditionColor(fleetSummary.averageCondition) },
              ]}
            >
              {Math.round(fleetSummary.averageCondition)}%
            </Text>
            <Text style={styles.summaryLabel}>Ort. kondisyon</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.success }]}>
              {fleetSummary.idleDrivers}
            </Text>
            <Text style={styles.summaryLabel}>Boşta şoför</Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          {TABS.map((tab) => (
            <FleetTabButton
              key={tab.key}
              label={tab.label}
              active={activeTab === tab.key}
              onPress={() => setActiveTab(tab.key)}
            />
          ))}
        </View>

        {activeTab === 'trucks' &&
          (trucks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Henüz filonda kamyon yok.</Text>
            </View>
          ) : (
            <>
              {trucks.map((truck) => (
                <TruckCard
                  key={truck.id}
                  truck={truck}
                  playerMoney={player.money}
                  drivers={drivers}
                  delivery={findActiveDeliveryForTruck(truck.id, activeDeliveries)}
                  currentTime={currentTime}
                  onRepair={handleRepair}
                />
              ))}
              {showFleetTip ? (
                <View style={styles.tipCard}>
                  <Text style={styles.tipTitle}>Filo önerisi</Text>
                  <Text style={styles.tipText}>
                    Boşta kamyonun yok. Yeni sözleşme almak için teslimatın bitmesini bekle veya yeni
                    kamyon satın al.
                  </Text>
                </View>
              ) : null}
            </>
          ))}

        {activeTab === 'drivers' &&
          (drivers.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Henüz şoför işe alınmadı.</Text>
            </View>
          ) : (
            drivers.map((driver) => (
              <DriverCard
                key={driver.id}
                driver={driver}
                trucks={trucks}
                activeDeliveries={activeDeliveries}
                currentTime={currentTime}
              />
            ))
          ))}

        {activeTab === 'shop' && (
          <>
            <Text style={styles.shopSectionHeader}>Kamyon Pazarı</Text>
            {AVAILABLE_TRUCKS.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Satın alınabilir kamyon yok.</Text>
              </View>
            ) : (
              AVAILABLE_TRUCKS.map((template) => (
                <AvailableTruckCard
                  key={template.id}
                  template={template}
                  playerMoney={player.money}
                  playerLevel={player.level ?? player.companyLevel ?? 1}
                  alreadyOwned={trucks.some((t) => t.id === template.id)}
                  canBuy={typeof buyTruck === 'function'}
                  onBuy={handleBuyTruck}
                />
              ))
            )}

            <Text style={[styles.shopSectionHeader, styles.shopSectionHeaderSpaced]}>Şoför Havuzu</Text>
            {AVAILABLE_DRIVERS.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>İşe alınabilir şoför yok.</Text>
              </View>
            ) : (
              AVAILABLE_DRIVERS.map((template) => (
                <AvailableDriverCard
                  key={template.id}
                  template={template}
                  playerMoney={player.money}
                  alreadyHired={drivers.some((d) => d.id === template.id)}
                  canHire={typeof hireDriver === 'function'}
                  onHire={handleHireDriver}
                />
              ))
            )}
          </>
        )}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: UI.spacing.screen,
    paddingTop: 8,
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
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 26,
    fontWeight: '800',
  },
  headerBadges: {
    flexDirection: 'row',
  },
  headerBadge: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 58,
    marginLeft: 8,
  },
  headerBadgeValue: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  headerBadgeLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 1,
  },

  statusBanner: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  statusBannerText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 14,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 3,
    textAlign: 'center',
  },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: COLORS.primary,
  },
  tabButtonText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: '#0B1220',
  },

  itemCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    marginRight: 8,
  },
  itemStatusBadge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  itemMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  conditionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 10,
    marginBottom: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  deliveryProgressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1F2937',
    overflow: 'hidden',
    marginBottom: 4,
  },
  driverProgressTrack: {
    height: 6,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    overflow: 'hidden',
    marginBottom: 6,
  },

  deliveryBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  deliverySectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  deliveryRoute: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  deliveryMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 3,
  },
  deliveryMetaMuted: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 3,
  },
  deliveryMetaProfit: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  progressLabel: {
    color: COLORS.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 6,
  },
  idleHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 10,
    fontStyle: 'italic',
  },
  noRepairText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: COLORS.cardAlt,
  },
  statusPillDelivery: {
    backgroundColor: 'rgba(56, 189, 248, 0.10)',
    borderColor: COLORS.secondary,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusPillTextDelivery: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tipCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
  },
  tipTitle: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  tipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },

  driverStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  driverStatChip: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  driverStatChipText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  driverStatusPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.10)',
    borderColor: COLORS.secondary,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  driverStatusPillText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  driverActiveBlock: {
    marginTop: 8,
  },
  driverActiveRoute: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  driverRouteSubtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  performanceBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginTop: 10,
  },
  performanceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  shopSectionHeader: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  shopSectionHeaderSpaced: {
    marginTop: 18,
  },
  shopCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  shopCardLocked: {
    opacity: 0.72,
    borderColor: COLORS.border,
  },
  shopCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  shopItemName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    marginRight: 10,
  },
  shopPriceSuccess: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: '800',
  },
  shopPricePrimary: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    maxWidth: '46%',
  },
  shopShortMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 10,
  },
  shopLockHint: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
  },
  shopStatGrid: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    marginBottom: 10,
    gap: 6,
  },
  shopStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shopStatLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  shopStatValue: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  shopTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  shopTag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: COLORS.cardAlt,
  },
  shopTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  shopActionButton: {
    backgroundColor: COLORS.primary,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopActionButtonDisabled: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: COLORS.border,
    opacity: 0.55,
  },
  shopActionButtonText: {
    color: '#0B1220',
    fontSize: 14,
    fontWeight: '800',
  },
  shopActionButtonTextDisabled: {
    color: COLORS.textMuted,
  },

  shopSectionLabel: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  actionButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  actionButtonDisabled: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonText: {
    color: '#0B1220',
    fontSize: 13,
    fontWeight: '800',
  },
  actionButtonTextDisabled: {
    color: COLORS.textMuted,
  },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 10,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
