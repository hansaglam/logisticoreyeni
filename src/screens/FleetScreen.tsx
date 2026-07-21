/**
 * LogistiCore - Filo Ekranı
 *
 * Premium kompakt filo yönetimi — kamyonlar, şoförler ve mağaza.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';

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
import { timeBalance } from '../config/balance';
import { getCityName } from '../utils/entityLookup';
import {
  getTruckWeeklyLeaseCost,
  isActiveLeasedTruck,
} from '../simulation/dailyOperatingCosts';
import { calculateTruckRepairCost, resolveTruckCityId } from '../simulation/delivery';
import {
  getDriverOnTimeRate,
  getDriverXpProgress,
} from '../simulation/driverProgress';
import {
  getTruckUpgradeCost,
  getTruckUpgradeSummary,
  canUpgradeTruck,
  TRUCK_UPGRADE_LABELS,
  type TruckUpgradeType,
} from '../simulation/truckUpgrades';
import { findActiveTransferForTruck, selectDriverForTransfer } from '../simulation/truckTransfer';
import {
  calculateDriverSeveranceCost,
  calculateTruckResaleValue,
  canFireDriver,
  canSellTruck,
  type DriverFireCheck,
  type TruckSellCheck,
} from '../simulation/fleetManagement';
import TruckTransferModal from '../components/TruckTransferModal';
import AdRewardButton from '../components/monetization/AdRewardButton';
import {
  calculateDiscountedRepairCost,
  getActiveMaintenanceDiscountToken,
} from '../simulation/adRewardGrants';
import { useGameStore } from '../store/gameStore';
import { colors, formatDisplayPercent, formatCityLocative, formatIdleTruckReadyHint, formatMoney, formatRatioPercent, spacing, typography } from '../theme';
import type { Delivery, DeliveryStatus, Driver, Truck, TruckTransfer } from '../types/game';
import type { MonetizationState } from '../types/monetization';

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
const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];

type FleetTab = 'trucks' | 'drivers' | 'shop';
type StatusMessage = { type: 'success' | 'error'; text: string } | null;

const FLEET_TABS = [
  { key: 'trucks' as const, label: 'Kamyonlar', icon: 'truck' as const },
  { key: 'drivers' as const, label: 'Şoförler', icon: 'driver' as const },
  { key: 'shop' as const, label: 'Mağaza', icon: 'market' as const },
];

function formatRemainingHours(currentTime: number, estimatedArrivalTime: number): string {
  const remaining = Math.max(0, estimatedArrivalTime - currentTime);
  const hrs = Math.floor(remaining);
  const mins = Math.round((remaining - hrs) * 60);
  if (hrs > 0) return `${hrs}s ${mins}dk`;
  return `${mins}dk`;
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

function findActiveTransferForTruckLocal(
  truckId: string,
  transfers: TruckTransfer[],
): TruckTransfer | undefined {
  return findActiveTransferForTruck(truckId, transfers);
}

function getTruckStatusBadge(status: Truck['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
    case 'on_route':
      return { label: 'YOLDA', variant: 'blue' };
    case 'transferring':
      return { label: 'YÖNLENDİRİLİYOR', variant: 'blue' };
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

const FleetMetricStrip = React.memo(function FleetMetricStrip({
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
      <SmallStatPill label="Kamyon" value={String(truckCount)} icon="truck" accentColor={colors.accentBlue} layout="chip" dense />
      <SmallStatPill label="Şoför" value={String(driverCount)} icon="driver" accentColor={colors.info} layout="chip" dense />
      <SmallStatPill label="Boşta" value={String(idleTrucks)} icon="success" accentColor={colors.success} layout="chip" dense />
      <SmallStatPill label="Yolda" value={String(onRouteTrucks)} icon="route" accentColor={colors.accentBlue} layout="chip" dense />
      <SmallStatPill
        label="Kondisyon"
        value={formatDisplayPercent(averageCondition)}
        icon="maintenance"
        accentColor={getConditionColor(averageCondition)}
        layout="chip"
        dense
      />
    </ScrollView>
  );
});

interface OwnedTruckCardProps {
  truck: Truck;
  playerMoney: number;
  delivery?: Delivery;
  transfer?: TruckTransfer;
  drivers: Driver[];
  homeCityId?: string;
  monetization: MonetizationState;
  sellCheck: TruckSellCheck;
  onRepair: (truck: Truck) => void;
  onUpgrade: (truck: Truck, upgradeType: TruckUpgradeType) => void;
  onTransfer: (truck: Truck, targetCityId?: string) => void;
  onSell: (truck: Truck) => void;
  onShowSellBlocked: (reason: string) => void;
}

function formatLeaseRemainingDays(
  currentTime: number,
  leaseExpiresAt?: number | null,
): string {
  if (leaseExpiresAt == null) {
    return '—';
  }
  const hoursLeft = Math.max(0, leaseExpiresAt - currentTime);
  const days = Math.ceil(hoursLeft / timeBalance.hoursPerDay);
  return `${days} gün`;
}

const OwnedTruckCard = React.memo(function OwnedTruckCard({
  truck,
  playerMoney,
  delivery,
  transfer,
  drivers,
  homeCityId,
  monetization,
  sellCheck,
  onRepair,
  onUpgrade,
  onTransfer,
  onSell,
  onShowSellBlocked,
}: OwnedTruckCardProps) {
  const isOnRoute = truck.status === 'on_route';
  const isTransferring = truck.status === 'transferring';
  const isIdle = truck.status === 'idle';
  const isLeased = isActiveLeasedTruck(truck);
  const needsLiveTime = isOnRoute || isTransferring || isLeased;
  const currentTime = useGameStore((state) => (needsLiveTime ? state.currentTime : 0));
  const truckCondition = truck.condition ?? 100;
  const conditionColor = getConditionColor(truckCondition);
  const repairCost = calculateTruckRepairCost(truck);
  const statusBadge = getTruckStatusBadge(truck.status);
  const maintenanceBadge = getMaintenanceBadge(truckCondition);
  const showRepairButton = isIdle && truckCondition < 100 && truckCondition < REPAIR_HIDE_THRESHOLD;
  const truckCityId = resolveTruckCityId(truck, homeCityId);
  const truckCityName = getCityName(truckCityId);
  const destinationCityName = delivery
    ? getCityName(delivery.destinationCityId)
    : transfer
      ? getCityName(transfer.toCityId)
      : truckCityName;
  const hasIdleDriver = !!selectDriverForTransfer(truck.id, drivers);
  const canTransfer = isIdle && hasIdleDriver;
  const showRecallIzmir = isIdle && (truck.currentCityId ?? '').toLowerCase() !== 'izmir';
  const isLeaseExpired =
    (truck.ownershipType ?? 'owned') === 'leased' && !isLeased;
  const weeklyLeaseCost = getTruckWeeklyLeaseCost(truck);
  const leaseDailyAccrual = truck.leaseDailyCost ?? 0;
  const resaleValue = isLeased ? 0 : calculateTruckResaleValue(truck);
  const showSellInfo = !isLeased && resaleValue > 0;
  const showSellButton = !isLeased && (sellCheck.canSell || sellCheck.reason);
  const upgradeBadges = getTruckUpgradeSummary(truck);
  const upgradeLevel = truck.upgradeLevel ?? 0;
  const nextUpgradeType = (['engine', 'fuelEfficiency', 'cargo', 'durability'] as TruckUpgradeType[]).find(
    (type) => canUpgradeTruck(truck, type),
  );
  const nextUpgradeCost = nextUpgradeType ? getTruckUpgradeCost(truck, nextUpgradeType) : 0;
  const canUpgrade = isIdle && !isLeased && !!nextUpgradeType && playerMoney >= nextUpgradeCost;
  const maintenanceDiscountToken = getActiveMaintenanceDiscountToken(
    monetization,
    truck.id,
    currentTime,
  );
  const { finalCost: discountedRepairCost } = calculateDiscountedRepairCost(
    repairCost,
    maintenanceDiscountToken,
  );
  const effectiveRepairCost = maintenanceDiscountToken ? discountedRepairCost : repairCost;
  const canAffordEffectiveRepair = playerMoney >= effectiveRepairCost;
  const showMaintenanceAdOffer =
    showRepairButton && repairCost > 300 && !maintenanceDiscountToken;

  const handleSellPress = () => {
    if (!sellCheck.canSell) {
      onShowSellBlocked(sellCheck.reason ?? 'Kamyon satılamaz.');
      return;
    }
    onSell(truck);
  };

  return (
    <AppCard style={styles.fleetCard} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.entityIconBox}>
          <GameIcon name="truck" size={18} color={colors.accentBlue} />
        </View>

        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
            {truck.name}
          </Text>
        </View>

        <View style={styles.cardRight}>
          {isIdle ? (
            <StatusBadge
              label={formatCityLocative(truckCityId, truckCityName)}
              variant="info"
              size="sm"
            />
          ) : null}
          <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
        </View>
      </View>

      <Text style={styles.statsRow} numberOfLines={1} ellipsizeMode="tail">
        {isIdle ? null : `Konum: ${truckCityName} · `}
        {truck.capacity ?? 0} ton · {truck.speed ?? 0} km/h
        {upgradeLevel > 0 ? ` · Geliştirme +${upgradeLevel}` : ''}
      </Text>

      {upgradeBadges.length > 0 ? (
        <Text style={styles.footerMuted} numberOfLines={2}>
          {upgradeBadges.join(' · ')}
        </Text>
      ) : null}

      {isLeaseExpired ? (
        <View style={styles.leaseInfoBlock}>
          <View style={styles.leaseBadgeRow}>
            <StatusBadge label="Kira süresi doldu" variant="danger" size="sm" />
            <Text style={styles.leaseInfoText} numberOfLines={1} ellipsizeMode="tail">
              Bu kamyon yeni işlerde kullanılamaz.
            </Text>
          </View>
        </View>
      ) : isLeased ? (
        <View style={styles.leaseInfoBlock}>
          <View style={styles.leaseBadgeRow}>
            <StatusBadge label="Kiralık" variant="amber" size="sm" />
            <Text style={styles.leaseInfoText} numberOfLines={1} ellipsizeMode="tail">
              Haftalık kira: {formatMoney(weeklyLeaseCost)} · Kalan:{' '}
              {formatLeaseRemainingDays(currentTime, truck.leaseExpiresAt)}
            </Text>
          </View>
          <Text style={styles.leaseInfoSubtext} numberOfLines={1} ellipsizeMode="tail">
            Günlük karşılık: {formatMoney(leaseDailyAccrual)}
          </Text>
        </View>
      ) : null}

      {isOnRoute && delivery ? (
        <View style={styles.inlineRouteBlock}>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="route" size={12} color={colors.accentBlue} />
            <Text style={styles.routeText} numberOfLines={1} ellipsizeMode="tail">
              {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
            </Text>
          </View>
          <View style={styles.inlineRouteMetaRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.routeMeta} numberOfLines={1} ellipsizeMode="tail">
              {formatRatioPercent(delivery.progress)} · {destinationCityName}'ya gidiyor
            </Text>
          </View>
          <ProgressBar progress={delivery.progress} color={colors.accentBlue} height={3} />
        </View>
      ) : null}

      {isTransferring && transfer ? (
        <View style={styles.inlineRouteBlock}>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="route" size={12} color={colors.info} />
            <Text style={styles.routeText} numberOfLines={1} ellipsizeMode="tail">
              {getCityName(transfer.fromCityId)} → {getCityName(transfer.toCityId)}
            </Text>
          </View>
          <View style={styles.inlineRouteMetaRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.routeMeta} numberOfLines={1} ellipsizeMode="tail">
              Boş transfer · {formatRatioPercent(transfer.progress)} ·{' '}
              {formatRemainingHours(currentTime, transfer.estimatedArrivalAt)} kaldı
            </Text>
          </View>
          <ProgressBar progress={transfer.progress} color={colors.info} height={3} />
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

      {isLeased ? (
        <Text style={styles.footerMuted}>Kiralık kamyon satılamaz</Text>
      ) : showSellInfo ? (
        <Text style={styles.resaleHint} numberOfLines={1}>
          Satış değeri: {formatMoney(resaleValue)}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        {showMaintenanceAdOffer ? (
          <AdRewardButton
            slotId="maintenance_discount"
            label="Reklam izle, bakım %30 indirimli"
            description="Sonraki bakımda en fazla $500 indirim uygulanır."
            context={{
              selectedTruckId: truck.id,
              currentRepairCost: repairCost,
            }}
            variant="secondary"
          />
        ) : null}
        {showRepairButton ? (
          <ActionButton
            label={
              canAffordEffectiveRepair
                ? maintenanceDiscountToken
                  ? `Bakım Yap (${formatMoney(effectiveRepairCost)} indirimli)`
                  : `Bakım Yap (${formatMoney(repairCost)})`
                : 'Yetersiz nakit'
            }
            onPress={() => onRepair(truck)}
            disabled={!canAffordEffectiveRepair}
            variant="secondary"
            icon="repair"
            iconSize={13}
            compact
            style={styles.compactAction}
          />
        ) : null}
        {isIdle && !isLeased && nextUpgradeType ? (
          <ActionButton
            label={
              canUpgrade
                ? `Yükselt (${TRUCK_UPGRADE_LABELS[nextUpgradeType]})`
                : 'Yetersiz nakit'
            }
            onPress={() => onUpgrade(truck, nextUpgradeType)}
            disabled={!canUpgrade}
            variant="secondary"
            iconSize={13}
            compact
            style={styles.compactAction}
          />
        ) : null}
        {isOnRoute ? (
          <Text style={styles.footerMuted}>Teslimat sürüyor</Text>
        ) : isTransferring ? (
          <Text style={styles.footerMuted}>Boş transfer sürüyor</Text>
        ) : truck.status === 'maintenance' ? (
          <>
            <Text style={styles.footerMuted}>Tamir tamamlanmadan işe çıkamaz</Text>
            {showSellButton ? (
              <ActionButton
                label={sellCheck.canSell ? 'Sat' : 'Satılamaz'}
                onPress={handleSellPress}
                disabled={!sellCheck.canSell}
                variant="secondary"
                icon="cash"
                iconSize={13}
                compact
                style={[styles.compactAction, styles.sellActionButton]}
              />
            ) : null}
          </>
        ) : isIdle ? (
          <View style={styles.transferActionsRow}>
            <ActionButton
              label={hasIdleDriver ? 'Yönlendir' : 'Şoför gerekli'}
              onPress={() => onTransfer(truck)}
              disabled={!canTransfer}
              variant="secondary"
              icon="route"
              iconSize={13}
              compact
              style={styles.compactAction}
            />
            {showRecallIzmir ? (
              <ActionButton
                label="İzmir'e Çağır"
                onPress={() => onTransfer(truck, 'izmir')}
                disabled={!canTransfer}
                variant="secondary"
                icon="warehouse"
                iconSize={13}
                compact
                style={styles.compactAction}
              />
            ) : null}
            {showSellButton ? (
              <ActionButton
                label={sellCheck.canSell ? 'Sat' : 'Satılamaz'}
                onPress={handleSellPress}
                disabled={!sellCheck.canSell}
                variant="secondary"
                icon="cash"
                iconSize={13}
                compact
                style={[styles.compactAction, styles.sellActionButton]}
              />
            ) : null}
          </View>
        ) : null}
        {isIdle && !hasIdleDriver ? (
          <Text style={styles.footerMuted}>Yönlendirme için boşta şoför gerekiyor.</Text>
        ) : isIdle ? (
          <Text style={styles.idleLocationHint} numberOfLines={2}>
            {formatIdleTruckReadyHint(truckCityId, truckCityName)}
          </Text>
        ) : null}
      </View>
    </AppCard>
  );
});

interface OwnedDriverCardProps {
  driver: Driver;
  trucks: Truck[];
  activeDelivery?: Delivery;
  playerMoney: number;
  fireCheck: DriverFireCheck;
  onFire: (driver: Driver) => void;
  onShowFireBlocked: (reason: string) => void;
}

const OwnedDriverCard = React.memo(function OwnedDriverCard({
  driver,
  trucks,
  activeDelivery,
  playerMoney,
  fireCheck,
  onFire,
  onShowFireBlocked,
}: OwnedDriverCardProps) {
  const needsLiveTime = driver.status === 'driving';
  const currentTime = useGameStore((state) => (needsLiveTime ? state.currentTime : 0));
  const statusBadge = getDriverStatusBadge(driver.status);
  const trait = getDriverTrait(driver);
  const assignedTruck =
    trucks.find((t) => t.id === driver.assignedTruckId) ??
    (activeDelivery ? trucks.find((t) => t.id === activeDelivery.truckId) : undefined);
  const attention = Math.round(driver.attention ?? 0);
  const experience = Math.round(driver.experience ?? 0);
  const driverLevel = driver.level ?? 1;
  const driverXp = getDriverXpProgress(driver);
  const onTimeRate = getDriverOnTimeRate(driver);
  const completedCount = driver.completedDeliveries ?? 0;
  const isDriving = driver.status === 'driving';
  const isIdle = driver.status === 'idle';
  const severanceCost = fireCheck.severanceCost ?? calculateDriverSeveranceCost(driver);
  const canAffordSeverance = playerMoney >= severanceCost;

  const handleFirePress = () => {
    if (!fireCheck.canFire) {
      onShowFireBlocked(fireCheck.reason ?? 'Şoför işten çıkarılamaz.');
      return;
    }
    if (!canAffordSeverance) {
      onShowFireBlocked(`Çıkış maliyeti için ${formatMoney(severanceCost)} gerekli.`);
      return;
    }
    onFire(driver);
  };

  return (
    <AppCard style={styles.fleetCard} padded>
      <View style={styles.cardTopRow}>
        <View style={[styles.entityIconBox, styles.driverIconCircle]}>
          <GameIcon name="driver" size={18} color={colors.accentBlue} />
        </View>

        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
            {driver.name}
          </Text>
        </View>

        <View style={styles.cardRight}>
          <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
        </View>
      </View>

      <Text style={styles.statsRow} numberOfLines={1} ellipsizeMode="tail">
        Seviye {driverLevel} · XP {driverXp.xp}
        {driverLevel < 5 ? ` / ${driverXp.xpForNextLevel}` : ''} · Deneyim {experience} · Dikkat {attention}
      </Text>
      <Text style={styles.statsRow} numberOfLines={1} ellipsizeMode="tail">
        Teslimat {completedCount}
        {completedCount > 0 ? ` · Zamanında %${Math.round(onTimeRate * 100)}` : ''}
        {driver.specialty ? ` · Uzmanlık: ${driver.specialty}` : ''}
        {' · '}Maaş {formatMoney(driver.salaryPerDay ?? 0)}/gün
      </Text>
      {driverLevel < 5 ? (
        <ProgressBar progress={driverXp.progressRatio} color={colors.accentBlue} height={3} />
      ) : null}

      {isDriving && activeDelivery ? (
        <View style={styles.inlineRouteBlock}>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="truck" size={12} color={colors.accentBlue} />
            <Text style={styles.routeMeta} numberOfLines={1} ellipsizeMode="tail">
              {assignedTruck?.name ?? 'Atanmış kamyon'}
            </Text>
          </View>
          <View style={styles.inlineRouteRow}>
            <GameIcon name="route" size={12} color={colors.accentBlue} />
            <Text style={styles.routeText} numberOfLines={1} ellipsizeMode="tail">
              {getCityName(activeDelivery.originCityId)} → {getCityName(activeDelivery.destinationCityId)}
            </Text>
          </View>
          <View style={styles.inlineRouteMetaRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.routeMeta} numberOfLines={1} ellipsizeMode="tail">
              {formatRatioPercent(activeDelivery.progress)} ·{' '}
              {formatRemainingHours(currentTime, activeDelivery.estimatedArrivalTime)} kaldı
            </Text>
          </View>
          <ProgressBar progress={activeDelivery.progress} color={colors.accentBlue} height={3} />
        </View>
      ) : null}

      <View style={styles.traitRow}>
        <StatusBadge label={trait.label} variant={trait.variant} size="sm" />
      </View>

      <Text style={styles.severanceHint} numberOfLines={1}>
        Çıkış maliyeti: {formatMoney(severanceCost)}
      </Text>

      <View style={styles.cardFooter}>
        {isIdle ? (
          <Text style={styles.footerMuted}>Yeni teslimat için hazır</Text>
        ) : driver.status === 'resting' ? (
          <Text style={styles.footerMuted}>Dinleniyor</Text>
        ) : isDriving ? (
          <Text style={styles.footerMuted}>Aktif teslimatta</Text>
        ) : null}

        <ActionButton
          label={
            !fireCheck.canFire
              ? 'Çıkarılamaz'
              : !canAffordSeverance
                ? 'Nakit yetersiz'
                : 'İşten Çıkar'
          }
          onPress={handleFirePress}
          disabled={!fireCheck.canFire || !canAffordSeverance}
          variant="danger"
          icon="driver"
          iconSize={13}
          compact
          style={styles.compactAction}
        />
      </View>
    </AppCard>
  );
});

interface ShopTruckCardProps {
  template: TruckMarketItem;
  playerMoney: number;
  playerLevel: number;
  ownedCount: number;
  canBuy: boolean;
  canLease: boolean;
  onBuy: (catalogId: string) => void;
  onLease: (catalogId: string) => void;
}

const ShopTruckCard = React.memo(function ShopTruckCard({
  template,
  playerMoney,
  playerLevel,
  ownedCount,
  canBuy,
  canLease,
  onBuy,
  onLease,
}: ShopTruckCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const requiredLevel = resolveTruckMarketRequiredLevel(template);
  const isLevelLocked = safePlayerLevel < requiredLevel;
  const weeklyLeaseCost = template.weeklyLeaseCost ?? 0;
  const canAffordBuy = playerMoney >= template.purchasePrice;
  const canAffordLease = weeklyLeaseCost > 0 && playerMoney >= weeklyLeaseCost;
  const buyDisabled = !canBuy || !canAffordBuy || isLevelLocked;
  const leaseDisabled = !canLease || !canAffordLease || isLevelLocked || weeklyLeaseCost <= 0;
  const tags = getTruckShopTags(template);

  let buyButtonLabel = 'Satın Al';
  if (isLevelLocked) {
    buyButtonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canBuy) {
    buyButtonLabel = 'Yakında';
  } else if (!canAffordBuy) {
    buyButtonLabel = 'Nakit yetersiz';
  } else if (ownedCount > 0) {
    buyButtonLabel = 'Tekrar Satın Al';
  }

  let leaseButtonLabel = 'Haftalık Kirala';
  if (isLevelLocked) {
    leaseButtonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canLease || weeklyLeaseCost <= 0) {
    leaseButtonLabel = 'Kiralama yok';
  } else if (!canAffordLease) {
    leaseButtonLabel = 'Nakit yetersiz';
  }

  return (
    <AppCard style={[styles.fleetCard, isLevelLocked && styles.lockedCard]} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.entityIconBox}>
          <GameIcon name="truck" size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
            {template.name}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <View style={styles.priceRow}>
            <GameIcon name="cash" size={12} color={colors.success} />
            <Text style={styles.priceText} numberOfLines={1} ellipsizeMode="tail">
              {formatMoney(template.purchasePrice)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.statsRow} numberOfLines={1} ellipsizeMode="tail">
        {template.capacity} ton · {template.speed} km/h · {template.fuelConsumptionPerKm.toFixed(2)} L/km ·
        Dayanıklılık {template.reliability}
        {requiredLevel > 1 ? ` · Lv.${requiredLevel}` : ''}
      </Text>

      {weeklyLeaseCost > 0 ? (
        <Text style={styles.leaseHint} numberOfLines={1} ellipsizeMode="tail">
          Haftalık kira: {formatMoney(weeklyLeaseCost)} · 7 gün
        </Text>
      ) : null}

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

      <View style={styles.shopButtonRow}>
        <ActionButton
          label={buyButtonLabel}
          onPress={() => onBuy(template.id)}
          disabled={buyDisabled}
          variant="primary"
          icon={isLevelLocked ? 'level' : 'plus'}
          iconSize={13}
          compact
          style={styles.shopActionHalf}
        />
        <ActionButton
          label={leaseButtonLabel}
          onPress={() => onLease(template.id)}
          disabled={leaseDisabled}
          variant="secondary"
          icon="truck"
          iconSize={13}
          compact
          style={styles.shopActionHalf}
        />
      </View>
    </AppCard>
  );
});

interface ShopDriverCardProps {
  template: DriverMarketItem;
  playerMoney: number;
  playerLevel: number;
  alreadyHired: boolean;
  canHire: boolean;
  onHire: (poolId: string) => void;
}

const ShopDriverCard = React.memo(function ShopDriverCard({
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
          <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
            {template.name}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <View style={styles.priceRow}>
            <GameIcon name="cash" size={12} color={colors.accentAmber} />
            <Text style={styles.priceTextHire} numberOfLines={1} ellipsizeMode="tail">
              {formatMoney(template.hiringFee)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.statsRow} numberOfLines={1} ellipsizeMode="tail">
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
});

export default function FleetScreen() {
  const { showDialog, alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const activeTransfers = useGameStore((state) => state.activeTransfers) ?? [];
  const monetization = useGameStore((state) => state.monetization);
  const buyTruck = useGameStore((state) => state.buyTruck);
  const leaseTruck = useGameStore((state) => state.leaseTruck);
  const hireDriver = useGameStore((state) => state.hireDriver);
  const sellTruck = useGameStore((state) => state.sellTruck);
  const fireDriver = useGameStore((state) => state.fireDriver);
  const repairTruck = useGameStore((state) => state.repairTruck);
  const upgradeTruck = useGameStore((state) => state.upgradeTruck);
  const pendingFleetSubTab = useGameStore((state) => state.pendingFleetSubTab);
  const clearPendingFleetSubTab = useGameStore((state) => state.clearPendingFleetSubTab);

  const [activeTab, setActiveTab] = useState<FleetTab>('trucks');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [transferModalTruck, setTransferModalTruck] = useState<Truck | null>(null);
  const [transferTargetCityId, setTransferTargetCityId] = useState<string | undefined>();

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

  const trucks = useMemo(() => player?.trucks ?? [], [player?.trucks]);
  const drivers = useMemo(() => player?.drivers ?? [], [player?.drivers]);
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerMoney = player?.money ?? 0;

  const fleetSummary = useMemo(
    () => ({
      idleTrucks: trucks.filter((t) => t.status === 'idle' && !t.leaseExpired).length,
      onRouteTrucks: trucks.filter((t) => t.status === 'on_route' || t.status === 'transferring').length,
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

  const fleetManagementState = useMemo(
    () => ({
      player: {
        trucks,
        drivers,
        money: playerMoney,
      },
      activeDeliveries,
      activeTransfers,
    }),
    [trucks, drivers, playerMoney, activeDeliveries, activeTransfers],
  );

  const deliveryByTruckId = useMemo(() => {
    const map = new Map<string, Delivery>();
    for (const delivery of activeDeliveries) {
      if (ACTIVE_DELIVERY_STATUSES.includes(delivery.status)) {
        map.set(delivery.truckId, delivery);
      }
    }
    return map;
  }, [activeDeliveries]);

  const transferByTruckId = useMemo(() => {
    const map = new Map<string, TruckTransfer>();
    for (const transfer of activeTransfers) {
      if (transfer.status === 'active') {
        map.set(transfer.truckId, transfer);
      }
    }
    return map;
  }, [activeTransfers]);

  const deliveryByDriverId = useMemo(() => {
    const map = new Map<string, Delivery>();
    for (const delivery of activeDeliveries) {
      if (ACTIVE_DELIVERY_STATUSES.includes(delivery.status)) {
        map.set(delivery.driverId, delivery);
      }
    }
    return map;
  }, [activeDeliveries]);

  const sellCheckByTruckId = useMemo(() => {
    const map = new Map<string, TruckSellCheck>();
    for (const truck of trucks) {
      map.set(truck.id, canSellTruck(truck.id, fleetManagementState));
    }
    return map;
  }, [trucks, fleetManagementState]);

  const fireCheckByDriverId = useMemo(() => {
    const map = new Map<string, DriverFireCheck>();
    for (const driver of drivers) {
      map.set(driver.id, canFireDriver(driver.id, fleetManagementState));
    }
    return map;
  }, [drivers, fleetManagementState]);

  const ownedTruckCountByCatalog = useMemo(() => {
    const map = new Map<string, number>();
    for (const template of sortedTruckMarket) {
      map.set(template.id, countOwnedTrucksOfCatalog(trucks, template.id));
    }
    return map;
  }, [sortedTruckMarket, trucks]);

  const handleUpgrade = useCallback((truck: Truck, upgradeType: TruckUpgradeType) => {
    if (typeof upgradeTruck !== 'function') {
      setStatusMessage({ type: 'error', text: 'Geliştirme henüz kullanılamıyor' });
      return;
    }
    try {
      upgradeTruck(truck.id, upgradeType);
      setStatusMessage({ type: 'success', text: `${truck.name} geliştirildi` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: translateErrorMessage(error, 'Yetersiz nakit') });
    }
  }, [upgradeTruck]);

  const handleRepair = useCallback((truck: Truck) => {
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
  }, [repairTruck]);

  const handleBuyTruck = useCallback((catalogId: string) => {
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
  }, [buyTruck]);

  const handleLeaseTruck = useCallback((catalogId: string) => {
    if (typeof leaseTruck !== 'function') {
      setStatusMessage({ type: 'error', text: 'Kiralama henüz kullanılamıyor' });
      return;
    }
    const result = leaseTruck(catalogId);
    if (!result.success) {
      setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
      return;
    }
    setStatusMessage({ type: 'success', text: result.message ?? 'Kamyon kiralandı' });
  }, [leaseTruck]);

  const handleHireDriver = useCallback((poolId: string) => {
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
  }, [hireDriver]);

  const handleSellTruck = useCallback((truck: Truck) => {
    const sellCheck = canSellTruck(truck.id, fleetManagementState);
    if (!sellCheck.canSell) {
      showAlert('Kamyon satılamaz', sellCheck.reason ?? 'Bu kamyon şu anda satılamaz.');
      return;
    }

    const salePrice = sellCheck.salePrice ?? 0;
    const condition = Math.round(truck.condition ?? 100);

    // Native Alert yerine AppDialog — kamyon satış onayı
    showDialog({
      title: 'Kamyonu sat',
      message: `${truck.name} satılacak.`,
      variant: 'danger',
      details: [
        { label: 'Kondisyon', value: `%${condition}` },
        { label: 'Satış fiyatı', value: formatMoney(salePrice), tone: 'success' },
      ],
      footerNote: 'Bu işlem geri alınamaz.',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'Sat',
      destructive: true,
      onConfirm: () => {
        if (typeof sellTruck !== 'function') {
          setStatusMessage({ type: 'error', text: 'Satış henüz kullanılamıyor' });
          return;
        }
        const result = sellTruck(truck.id);
        if (!result.success) {
          setStatusMessage({ type: 'error', text: result.message ?? 'Satış başarısız' });
          return;
        }
        setStatusMessage({ type: 'success', text: result.message ?? 'Kamyon satıldı' });
      },
    });
  }, [fleetManagementState, showAlert, showDialog, sellTruck]);

  const handleShowSellBlocked = useCallback((reason: string) => {
    showAlert('Kamyon satılamaz', reason);
  }, [showAlert]);

  const handleFireDriver = useCallback((driver: Driver) => {
    const fireCheck = canFireDriver(driver.id, fleetManagementState);
    if (!fireCheck.canFire) {
      showAlert('Şoför işten çıkarılamaz', fireCheck.reason ?? 'Bu şoför şu anda çıkarılamaz.');
      return;
    }

    const severanceCost = fireCheck.severanceCost ?? calculateDriverSeveranceCost(driver);
    const dailySalary = driver.salaryPerDay ?? driver.dailySalary ?? 0;

    // Native Alert yerine AppDialog — şoför çıkış onayı
    showDialog({
      title: 'Şoförü işten çıkar',
      message: `${driver.name} işten çıkarılacak.`,
      variant: 'danger',
      details: [
        { label: 'Günlük maaş', value: formatMoney(dailySalary), tone: 'warning' },
        { label: 'Çıkış maliyeti', value: formatMoney(severanceCost), tone: 'danger' },
      ],
      footerNote: 'Bu işlem geri alınamaz.',
      cancelLabel: 'Vazgeç',
      confirmLabel: 'İşten Çıkar',
      destructive: true,
      onConfirm: () => {
        if (typeof fireDriver !== 'function') {
          setStatusMessage({ type: 'error', text: 'İşten çıkarma henüz kullanılamıyor' });
          return;
        }
        const result = fireDriver(driver.id);
        if (!result.success) {
          setStatusMessage({ type: 'error', text: result.message ?? 'İşlem başarısız' });
          return;
        }
        setStatusMessage({ type: 'success', text: result.message ?? 'Şoför işten çıkarıldı' });
      },
    });
  }, [fleetManagementState, showAlert, showDialog, fireDriver]);

  const handleShowFireBlocked = useCallback((reason: string) => {
    showAlert('Şoför işten çıkarılamaz', reason);
  }, [showAlert]);

  const handleOpenTransfer = useCallback((truck: Truck, targetCityId?: string) => {
    if (!selectDriverForTransfer(truck.id, drivers)) {
      setStatusMessage({ type: 'error', text: 'Yönlendirme için boşta şoför gerekiyor.' });
      return;
    }
    setTransferTargetCityId(targetCityId);
    setTransferModalTruck(truck);
  }, [drivers]);

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
    <AppScreen scroll>
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
          <SectionTitle
            title="Kamyonlar"
            subtitle="Teslimat sonrası kamyon varış şehrinde kalır · Yönlendir ile taşıyabilirsin"
            compact
          />

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
                  delivery={deliveryByTruckId.get(truck.id)}
                  transfer={transferByTruckId.get(truck.id)}
                  drivers={drivers}
                  homeCityId={player.homeCityId}
                  monetization={monetization}
                  sellCheck={sellCheckByTruckId.get(truck.id) ?? { canSell: false }}
                  onRepair={handleRepair}
                  onUpgrade={handleUpgrade}
                  onTransfer={handleOpenTransfer}
                  onSell={handleSellTruck}
                  onShowSellBlocked={handleShowSellBlocked}
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
                activeDelivery={deliveryByDriverId.get(driver.id)}
                playerMoney={playerMoney}
                fireCheck={fireCheckByDriverId.get(driver.id) ?? { canFire: false }}
                onFire={handleFireDriver}
                onShowFireBlocked={handleShowFireBlocked}
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
                ownedCount={ownedTruckCountByCatalog.get(template.id) ?? 0}
                canBuy={typeof buyTruck === 'function'}
                canLease={typeof leaseTruck === 'function'}
                onBuy={handleBuyTruck}
                onLease={handleLeaseTruck}
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

      <TruckTransferModal
        visible={transferModalTruck != null}
        truck={transferModalTruck}
        initialToCityId={transferTargetCityId}
        onClose={() => {
          setTransferModalTruck(null);
          setTransferTargetCityId(undefined);
        }}
        onStarted={(message) => setStatusMessage({ type: 'success', text: message })}
        onError={(message) => setStatusMessage({ type: 'error', text: message })}
      />
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
    borderColor: 'rgba(148, 163, 184, 0.28)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 18,
  },
  statsRow: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
    minWidth: 0,
  },
  cardRight: {
    flexShrink: 0,
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
    minWidth: 0,
    lineHeight: 16,
  },
  routeMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
    lineHeight: 15,
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
    gap: spacing.xs,
  },
  transferActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
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
  resaleHint: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '700',
    marginTop: 4,
  },
  severanceHint: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 4,
  },
  sellActionButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.65)',
  },
  idleLocationHint: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
    marginTop: 4,
    lineHeight: 16,
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
    flexShrink: 0,
    lineHeight: 17,
  },
  priceTextHire: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
    fontSize: 13,
    flexShrink: 0,
    lineHeight: 17,
  },
  ownedHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  leaseHint: {
    ...typography.caption,
    color: colors.accentAmber,
    marginTop: spacing.xs,
  },
  leaseInfoBlock: {
    marginTop: spacing.xs,
    gap: 2,
  },
  leaseBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  leaseInfoText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
    lineHeight: 15,
  },
  leaseInfoSubtext: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    minWidth: 0,
    lineHeight: 15,
  },
  shopButtonRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 4,
  },
  shopActionHalf: {
    flex: 1,
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
