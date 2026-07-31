/**
 * LogistiCore - Filo Ekranı
 *
 * Premium kompakt filo yönetimi — kamyonlar, şoförler ve mağaza.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import OwnedTruckCard from '../components/fleet/OwnedTruckCard';
import DriverCard from '../components/fleet/DriverCard';
import OwnedTrailerCard from '../components/fleet/OwnedTrailerCard';
/** Kamyon kartı aksiyon etiketleri: Bakım Yap · Geliştirmeleri Yönet */
import {
  FLEET_HEADER_HEIGHT,
  FLEET_METRIC_HEIGHT,
  FLEET_SECTION_GAP,
  FLEET_SEGMENT_BG,
  FLEET_SEGMENT_BORDER,
  getFleetDriverColumnWidths,
} from '../components/fleet/fleetTheme';

import {
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ProgressBar,
  StatusBadge,
} from '../components/ui';
import type { GameIconName } from '../theme/icons';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { getCityName } from '../utils/entityLookup';
import { resolveTruckCityId } from '../simulation/delivery';
import { getTruckEffectiveCapacityTons } from '../simulation/capacity';
import {
  getTrailerStatusLabel,
  getTrailerTypeLabel,
} from '../simulation/trailerOps';
import {
  getDriverOnTimeRate,
  getDriverXpProgress,
} from '../simulation/driverProgress';
import { findActiveTransferForTruck, selectDriverForTransfer } from '../simulation/truckTransfer';
import {
  calculateDriverSeveranceCost,
  canFireDriver,
  canSellTruck,
  resolveDriverDailySalary,
  type TruckSellCheck,
} from '../simulation/fleetManagement';
import TruckTransferModal from '../components/TruckTransferModal';
import TruckRefuelSheet from '../components/TruckRefuelSheet';
import RoadsideFuelSheet from '../components/RoadsideFuelSheet';
import UpgradesScreen from './UpgradesScreen';
import { useGameStore } from '../store/gameStore';
import { colors, formatDisplayPercent, formatMoney, spacing, typography } from '../theme';
import type { Delivery, DeliveryStatus, Driver, Trailer, Truck, TruckTransfer } from '../types/game';

const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route', 'paused'];

type FleetTab = 'trucks' | 'drivers' | 'trailers';
type StatusMessage = { type: 'success' | 'error'; text: string } | null;

const FLEET_TABS = [
  { key: 'trucks' as const, label: 'Kamyonlar', icon: 'truck' as const },
  { key: 'drivers' as const, label: 'Şoförler', icon: 'driver' as const },
  { key: 'trailers' as const, label: 'Dorseler', icon: 'route' as const },
];

function findActiveDeliveryForTruck(truckId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function getConditionColor(condition: number): string {
  if (condition >= 70) return colors.success;
  if (condition >= 35) return colors.accentAmber;
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

interface FleetMetricTileProps {
  label: string;
  value: string;
  icon: GameIconName;
  accentColor: string;
}

function FleetMetricTile({ label, value, icon, accentColor }: FleetMetricTileProps) {
  return (
    <View style={styles.metricTile}>
      <View style={[styles.metricIconWrap, { backgroundColor: `${accentColor}18` }]}>
        <GameIcon name={icon} size={24} color={accentColor} />
      </View>
      <View style={styles.metricTextBlock}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color: accentColor }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
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
  averageCondition,
}: Omit<FleetMetricStripProps, 'onRouteTrucks'>) {
  return (
    <View style={styles.metricStrip}>
      <FleetMetricTile label="Kamyon" value={String(truckCount)} icon="truck" accentColor={colors.accentBlue} />
      <FleetMetricTile label="Şoför" value={String(driverCount)} icon="driver" accentColor={colors.info} />
      <FleetMetricTile label="Boşta" value={String(idleTrucks)} icon="success" accentColor={colors.success} />
      <FleetMetricTile
        label="Kondisyon"
        value={formatDisplayPercent(averageCondition)}
        icon="maintenance"
        accentColor={getConditionColor(averageCondition)}
      />
    </View>
  );
});

function FleetTabSegment({
  activeTab,
  onChange,
}: {
  activeTab: FleetTab;
  onChange: (tab: FleetTab) => void;
}) {
  return (
    <View style={styles.segmentContainer}>
      {FLEET_TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            style={[styles.segmentTab, isActive && styles.segmentTabActive]}
            onPress={() => onChange(tab.key)}
          >
            {tab.icon ? (
              <GameIcon
                name={tab.icon}
                size={14}
                color={isActive ? colors.accentBlue : colors.textMuted}
              />
            ) : null}
            <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
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

export default function FleetScreen() {
  const { showDialog, alert: showAlert } = useAppDialog();
  const { width: screenWidth } = useWindowDimensions();
  const driverHireLayout = useMemo(() => getFleetDriverColumnWidths(screenWidth), [screenWidth]);
  const { contentBottomPadding } = useTabBarLayout();
  const player = useGameStore((state) => state.player);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const activeTransfers = useGameStore((state) => state.activeTransfers) ?? [];
  const monetization = useGameStore((state) => state.monetization);
  const attachTrailerToTruck = useGameStore((state) => state.attachTrailerToTruck);
  const detachTrailerFromTruck = useGameStore((state) => state.detachTrailerFromTruck);
  const sellTruck = useGameStore((state) => state.sellTruck);
  const fireDriver = useGameStore((state) => state.fireDriver);
  const repairTruck = useGameStore((state) => state.repairTruck);
  const pendingFleetSubTab = useGameStore((state) => state.pendingFleetSubTab);
  const clearPendingFleetSubTab = useGameStore((state) => state.clearPendingFleetSubTab);
  const requestNavigationToShop = useGameStore((state) => state.requestNavigationToShop);
  const openVehicleMarketplaceForTruck = useGameStore(
    (state) => state.openVehicleMarketplaceForTruck,
  );

  const [activeTab, setActiveTab] = useState<FleetTab>('trucks');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [transferModalTruck, setTransferModalTruck] = useState<Truck | null>(null);
  const [refuelSheetTruck, setRefuelSheetTruck] = useState<Truck | null>(null);
  const [roadsideFuelJobId, setRoadsideFuelJobId] = useState<string | null>(null);
  const [transferTargetCityId, setTransferTargetCityId] = useState<string | undefined>();
  const [managingUpgradesTruckId, setManagingUpgradesTruckId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFleetSubTab) return;

    if (pendingFleetSubTab === 'trucks') {
      setActiveTab('trucks');
    } else if (pendingFleetSubTab === 'drivers') {
      setActiveTab('drivers');
    } else if (pendingFleetSubTab === 'trailers') {
      setActiveTab('trailers');
    }

    clearPendingFleetSubTab();
  }, [pendingFleetSubTab, clearPendingFleetSubTab]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const trucks = useMemo(() => player?.trucks ?? [], [player?.trucks]);
  const trailers = useMemo(() => player?.trailers ?? [], [player?.trailers]);
  const drivers = useMemo(() => player?.drivers ?? [], [player?.drivers]);
  const playerMoney = player?.money ?? 0;

  const fleetSummary = useMemo(
    () => ({
      idleTrucks: trucks.filter((t) => t.status === 'idle' && !t.leaseExpired).length,
      onRouteTrucks: trucks.filter(
        (t) =>
          t.status === 'on_route' ||
          t.status === 'transferring' ||
          t.status === 'out_of_fuel',
      ).length,
      idleDrivers: drivers.filter((d) => d.status === 'idle').length,
      averageCondition: calculateAverageCondition(trucks),
    }),
    [trucks, drivers],
  );

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
      if (transfer.status === 'active' || transfer.status === 'paused') {
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

  const handleManageUpgrades = useCallback((truck: Truck) => {
    setManagingUpgradesTruckId(truck.id);
  }, []);

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

  const eligibleTrucksForTrailer = useCallback(
    (trailer: Trailer) =>
      trucks.filter(
        (truck) =>
          truck.status === 'idle' &&
          (truck.ownershipType ?? 'owned') === 'owned' &&
          !truck.leaseExpired &&
          resolveTruckCityId(truck, player?.homeCityId) === trailer.city &&
          !trailers.some(
            (item) => item.attachedTruckId === truck.id && item.id !== trailer.id,
          ),
      ),
    [trucks, trailers, player?.homeCityId],
  );

  const handleAttachTrailer = useCallback(
    (trailer: Trailer) => {
      const eligible = eligibleTrucksForTrailer(trailer);
      if (eligible.length === 0) {
        showAlert(
          'Uygun kamyon yok',
          `${getCityName(trailer.city)} şehrinde boşta ve uygun kamyon bulunamadı.`,
        );
        return;
      }

      showDialog({
        title: 'Araç Seç',
        message: `${trailer.name} dorsesini hangi kamyona bağlamak istiyorsun?`,
        variant: 'confirm',
        details: [
          { label: 'Dorse', value: getTrailerTypeLabel(trailer.type) },
          { label: 'Bulunduğu şehir', value: getCityName(trailer.city) },
          { label: 'Kapasite bonusu', value: `+${Math.round(trailer.capacityBonusTons)} t` },
        ],
        footerNote: 'Yalnızca aynı şehirdeki boş ve dorsesiz kamyonlar gösterilir.',
        actions: [
          ...eligible.map((truck) => {
            const currentCapacity = getTruckEffectiveCapacityTons(truck, trailers);
            const capacityAfterAttach = currentCapacity + Math.max(0, trailer.capacityBonusTons);
            const condition = Math.round(truck.condition ?? 100);

            return {
              label: `${truck.name} · ${capacityAfterAttach.toFixed(1)} t · %${condition}`,
              variant: 'primary' as const,
              onPress: () => {
                const result = attachTrailerToTruck(trailer.id, truck.id);
                setStatusMessage({
                  type: result.success ? 'success' : 'error',
                  text:
                    result.message ??
                    (result.success ? `${trailer.name}, ${truck.name} aracına bağlandı.` : 'Bağlama başarısız'),
                });
              },
            };
          }),
          {
            label: 'Vazgeç',
            variant: 'secondary' as const,
            onPress: () => {},
          },
        ],
      });
    },
    [attachTrailerToTruck, eligibleTrucksForTrailer, showAlert, showDialog, trailers],
  );

  const handleDetachTrailer = useCallback(
    (trailer: Trailer) => {
      const result = detachTrailerFromTruck(trailer.id);
      setStatusMessage({
        type: result.success ? 'success' : 'error',
        text: result.message ?? (result.success ? 'Dorse ayrıldı' : 'Ayırma başarısız'),
      });
    },
    [detachTrailerFromTruck],
  );

  const handleTrailerMaintenance = useCallback(
    (trailer: Trailer) => {
      const condition = Math.round(trailer.condition ?? 100);
      showDialog({
        title: 'Dorse bakımı',
        message: trailer.name,
        details: [
          { label: 'Kondisyon', value: `%${condition}` },
          { label: 'Durum', value: getTrailerStatusLabel(trailer, trucks) },
          { label: 'Şehir', value: getCityName(trailer.city) },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: 'Tamam',
      });
    },
    [showDialog, trucks],
  );

  const handleTrailerDetail = useCallback(
    (trailer: Trailer) => {
      const linkedTruck = trailer.attachedTruckId
        ? trucks.find((truck) => truck.id === trailer.attachedTruckId)
        : undefined;
      const condition = Math.round(trailer.condition ?? 100);
      showDialog({
        title: trailer.name,
        message: `${getTrailerTypeLabel(trailer.type)} · ${getCityName(trailer.city)}`,
        details: [
          { label: 'Kapasite bonusu', value: `+${Math.round(trailer.capacityBonusTons)} t` },
          { label: 'Kondisyon', value: `%${condition}` },
          { label: 'Durum', value: getTrailerStatusLabel(trailer, trucks) },
          { label: 'Bağlı kamyon', value: linkedTruck?.name ?? 'Yok' },
          { label: 'Satın alma', value: formatMoney(trailer.purchasePrice ?? 0), tone: 'warning' },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: 'Tamam',
      });
    },
    [showDialog, trucks],
  );

  const handleTrailerMore = useCallback(
    (trailer: Trailer) => {
      const linkedTruck = trailer.attachedTruckId
        ? trucks.find((truck) => truck.id === trailer.attachedTruckId)
        : undefined;
      const condition = Math.round(trailer.condition ?? 100);
      const canDetach = trailer.status === 'attached';

      showDialog({
        title: 'Dorse İşlemleri',
        message: trailer.name,
        variant: 'info',
        details: [
          { label: 'Dorse tipi', value: getTrailerTypeLabel(trailer.type) },
          { label: 'Kapasite', value: `+${Math.round(trailer.capacityBonusTons)} t` },
          { label: 'Kondisyon', value: `%${condition}` },
          { label: 'Bulunduğu şehir', value: getCityName(trailer.city) },
          { label: 'Bağlı kamyon', value: linkedTruck?.name ?? 'Yok' },
          { label: 'Satın alma değeri', value: formatMoney(trailer.purchasePrice ?? 0), tone: 'warning' },
          { label: 'Satış değeri', value: '—', tone: 'muted' },
          { label: 'Durum', value: getTrailerStatusLabel(trailer, trucks) },
        ],
        cancelLabel: 'Kapat',
        confirmLabel: canDetach ? 'Kamyondan Ayır' : 'Tamam',
        destructive: canDetach,
        onConfirm: canDetach ? () => handleDetachTrailer(trailer) : undefined,
      });
    },
    [handleDetachTrailer, showDialog, trucks],
  );

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

  const handleGoToHireDrivers = useCallback(() => {
    requestNavigationToShop('drivers');
  }, [requestNavigationToShop]);

  const handleAssignDriver = useCallback((driver: Driver) => {
    if (driver.status === 'driving') {
      showAlert('Atama yapılamaz', 'Şoför aktif teslimatta.');
      return;
    }
    if (driver.status === 'resting') {
      showAlert('Atama yapılamaz', 'Şoför dinleniyor.');
      return;
    }
    const assignedTruck = trucks.find((truck) => truck.id === driver.assignedTruckId);
    if (assignedTruck) {
      showAlert(
        'Kamyon ataması',
        `${driver.name} → ${assignedTruck.name}. Yeni atama için Sözleşmeler sekmesinden teslimat başlat.`,
      );
      return;
    }
    showAlert(
      'Kamyon ata',
      'Boşta şoförü kamyona atamak için Sözleşmeler sekmesinden teslimat başlat.',
    );
  }, [showAlert, trucks]);

  const handleDriverTraining = useCallback((driver: Driver) => {
    const xpProgress = getDriverXpProgress(driver);
    const completedCount = driver.completedDeliveries ?? 0;
    const onTimeRate = getDriverOnTimeRate(driver);
    showDialog({
      title: 'Şoför gelişimi',
      message: `${driver.name} teslimatlarla XP kazanır ve seviye atlar.`,
      details: [
        { label: 'Seviye', value: `Lv. ${xpProgress.level}` },
        {
          label: 'XP',
          value:
            xpProgress.level >= 5
              ? String(xpProgress.xp)
              : `${xpProgress.xp} / ${xpProgress.xpForNextLevel}`,
        },
        { label: 'Deneyim', value: String(Math.round(driver.experience ?? 0)) },
        {
          label: 'Teslimat',
          value: completedCount > 0 ? `${completedCount} · %${Math.round(onTimeRate * 100)} zamanında` : '0',
        },
      ],
      cancelLabel: 'Kapat',
      confirmLabel: 'Tamam',
    });
  }, [showDialog]);

  const handleDriverDetail = useCallback((driver: Driver) => {
    const xpProgress = getDriverXpProgress(driver);
    const dailySalary = driver.salaryPerDay ?? driver.dailySalary ?? resolveDriverDailySalary(driver);
    const assignedTruck = trucks.find((truck) => truck.id === driver.assignedTruckId);
    const completedCount = driver.completedDeliveries ?? 0;
    const onTimeRate = getDriverOnTimeRate(driver);
    const statusLabel =
      driver.status === 'driving' ? 'Teslimatta' : driver.status === 'resting' ? 'Dinleniyor' : 'Boşta';

    showDialog({
      title: driver.name,
      message: assignedTruck ? `Atanan kamyon: ${assignedTruck.name}` : 'Araç atanmamış',
      details: [
        { label: 'Durum', value: statusLabel },
        { label: 'Seviye', value: `Lv. ${xpProgress.level}` },
        { label: 'Maaş', value: `${formatMoney(dailySalary)}/gün`, tone: 'warning' },
        { label: 'Deneyim', value: String(Math.round(driver.experience ?? 0)) },
        { label: 'Güvenlik', value: String(Math.round(driver.attention ?? 0)) },
        { label: 'Yakıt', value: String(Math.round(driver.fuelSaving ?? 0)) },
        { label: 'Moral', value: `%${Math.round(driver.morale ?? 80)}` },
        {
          label: 'Teslimat',
          value: completedCount > 0 ? `${completedCount} · %${Math.round(onTimeRate * 100)} zamanında` : '0',
        },
        ...(driver.specialty ? [{ label: 'Uzmanlık', value: driver.specialty }] : []),
      ],
      cancelLabel: 'Kapat',
      confirmLabel: 'Tamam',
    });
  }, [showDialog, trucks]);

  const handleDriverMore = useCallback((driver: Driver) => {
    const fireCheck = canFireDriver(driver.id, fleetManagementState);
    const severanceCost = fireCheck.severanceCost ?? calculateDriverSeveranceCost(driver);
    const dailySalary = driver.salaryPerDay ?? driver.dailySalary ?? resolveDriverDailySalary(driver);
    const assignedTruck =
      trucks.find((truck) => truck.id === driver.assignedTruckId) ??
      (() => {
        const delivery = deliveryByDriverId.get(driver.id);
        return delivery ? trucks.find((truck) => truck.id === delivery.truckId) : undefined;
      })();
    const activeDelivery = deliveryByDriverId.get(driver.id);
    const completedCount = driver.completedDeliveries ?? 0;

    let routeText = '—';
    if (activeDelivery && ACTIVE_DELIVERY_STATUSES.includes(activeDelivery.status)) {
      routeText = `${getCityName(activeDelivery.originCityId)} → ${getCityName(activeDelivery.destinationCityId)}`;
    } else if (assignedTruck) {
      routeText = getCityName(resolveTruckCityId(assignedTruck, player?.homeCityId));
    }

    showDialog({
      title: 'Şoför İşlemleri',
      message: driver.name,
      variant: 'info',
      details: [
        { label: 'Atandığı araç', value: assignedTruck?.name ?? 'Atanmamış' },
        { label: 'Şehir / rota', value: routeText },
        { label: 'Uzmanlık', value: driver.specialty ?? '—' },
        { label: 'Teslimat sayısı', value: String(completedCount) },
        { label: 'Günlük maaş', value: `${formatMoney(dailySalary)}/gün`, tone: 'warning' },
        { label: 'Çıkış maliyeti', value: formatMoney(severanceCost), tone: 'danger' },
      ],
      cancelLabel: 'Kapat',
      confirmLabel: 'İşten Çıkar',
      destructive: true,
      onConfirm: () => {
        if (!fireCheck.canFire) {
          showAlert('Şoför işten çıkarılamaz', fireCheck.reason ?? 'Bu şoför şu anda çıkarılamaz.');
          return;
        }
        if (playerMoney < severanceCost) {
          showAlert('Şoför işten çıkarılamaz', `Çıkış maliyeti için ${formatMoney(severanceCost)} gerekli.`);
          return;
        }
        handleFireDriver(driver);
      },
    });
  }, [
    deliveryByDriverId,
    fleetManagementState,
    handleFireDriver,
    player?.homeCityId,
    playerMoney,
    showAlert,
    showDialog,
    trucks,
  ]);

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

  if (managingUpgradesTruckId) {
    return (
      <UpgradesScreen
        truckId={managingUpgradesTruckId}
        onBack={() => setManagingUpgradesTruckId(null)}
        backLabel="‹ Filo"
      />
    );
  }

  return (
    <AppScreen scroll scrollBottomPadding={contentBottomPadding}>
      <View style={styles.screenStack}>
        <View style={styles.fleetHeader}>
          <View style={styles.fleetHeaderText}>
            <Text style={styles.fleetTitle}>Filo</Text>
            <Text style={styles.fleetSubtitle}>Araçlarını ve şoförlerini yönet</Text>
          </View>
        </View>

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
          averageCondition={fleetSummary.averageCondition}
        />

        <FleetTabSegment activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'trucks' ? (
          <View style={styles.tabContent}>
            {trucks.length === 0 ? (
            <EmptyState
              title="Henüz kamyon yok"
              message="Mağazadan ilk kamyonunu satın al."
              icon="truck"
              actionLabel="Mağazaya Git"
              onAction={() => requestNavigationToShop('trucks')}
            />
          ) : (
            <>
              {trucks.map((truck) => (
                <OwnedTruckCard
                  key={truck.id}
                  truck={truck}
                  trailers={trailers}
                  playerMoney={playerMoney}
                  delivery={deliveryByTruckId.get(truck.id)}
                  transfer={transferByTruckId.get(truck.id)}
                  drivers={drivers}
                  homeCityId={player.homeCityId}
                  monetization={monetization}
                  sellCheck={sellCheckByTruckId.get(truck.id) ?? { canSell: false }}
                  onRepair={handleRepair}
                  onManageUpgrades={handleManageUpgrades}
                  onTransfer={handleOpenTransfer}
                  onRefuel={setRefuelSheetTruck}
                  onRoadsideFuel={setRoadsideFuelJobId}
                  onSell={handleSellTruck}
                  onMarketplaceSell={(selectedTruck) =>
                    openVehicleMarketplaceForTruck(selectedTruck.id)
                  }
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
                    Mağazadan yeni kamyon satın al.
                  </Text>
                </AppCard>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {activeTab === 'trailers' ? (
        <View style={styles.tabContent}>
          <View style={styles.trailerSectionHeader}>
            <Text style={styles.trailerSectionTitle}>Dorseler</Text>
            <Text style={styles.trailerSectionSubtitle}>
              Dorselerini kamyonlara bağla ve taşıma kapasiteni artır.
            </Text>
          </View>

          {trailers.length === 0 ? (
            <EmptyState
              title="Henüz dorsen yok"
              message="Kamyonlarının kapasitesini artırmak için mağazadan dorse satın al."
              icon="route"
              actionLabel="Dorse Mağazasına Git"
              onAction={() => requestNavigationToShop('trailers')}
              compact
            />
          ) : (
            trailers.map((trailer) => (
              <OwnedTrailerCard
                key={trailer.id}
                trailer={trailer}
                trucks={trucks}
                onAttach={handleAttachTrailer}
                onDetach={handleDetachTrailer}
                onMaintenance={handleTrailerMaintenance}
                onDetail={handleTrailerDetail}
                onMore={handleTrailerMore}
              />
            ))
          )}
        </View>
      ) : null}

      {activeTab === 'drivers' ? (
        <View style={styles.tabContent}>
          <View style={styles.driverHireRow}>
            <Pressable style={styles.driverHireBtn} onPress={handleGoToHireDrivers}>
              <GameIcon name="plus" size={14} color="#FFFFFF" />
              <Text style={styles.driverHireBtnText}>Şoför İşe Al</Text>
            </Pressable>
            <View style={[styles.driverSlotBadge, { minWidth: driverHireLayout.slotBadgeWidth }]}>
              <Text style={styles.driverSlotValue}>
                {drivers.length} / {trucks.length}
              </Text>
              <Text style={styles.driverSlotLabel}>slot</Text>
            </View>
          </View>

          {drivers.length === 0 ? (
            <EmptyState
              title="Henüz şoförün yok"
              message="Yeni araçlarını kullanabilmek için şoför işe al."
              icon="driver"
              actionLabel="Şoför İşe Al"
              onAction={handleGoToHireDrivers}
              compact
            />
          ) : (
            drivers.map((driver) => (
              <DriverCard
                key={driver.id}
                driver={driver}
                trucks={trucks}
                homeCityId={player.homeCityId}
                activeDelivery={deliveryByDriverId.get(driver.id)}
                onAssign={handleAssignDriver}
                onTraining={handleDriverTraining}
                onDetail={handleDriverDetail}
                onMore={handleDriverMore}
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
      <TruckRefuelSheet
        visible={refuelSheetTruck != null}
        truck={refuelSheetTruck}
        onClose={() => setRefuelSheetTruck(null)}
        onSuccess={(message) => setStatusMessage({ type: 'success', text: message })}
      />
      <RoadsideFuelSheet
        visible={roadsideFuelJobId != null}
        jobId={roadsideFuelJobId}
        onClose={() => setRoadsideFuelJobId(null)}
        onSuccess={(message) => setStatusMessage({ type: 'success', text: message })}
      />
      </View>
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
    marginBottom: 0,
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
  screenStack: {
    gap: FLEET_SECTION_GAP,
  },
  fleetHeader: {
    height: FLEET_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
  },
  fleetHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  fleetTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 28,
  },
  fleetSubtitle: {
    fontSize: 11.5,
    color: '#A9B6CC',
    marginTop: 2,
    lineHeight: 14,
  },
  metricStrip: {
    flexDirection: 'row',
    gap: 6,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    height: FLEET_METRIC_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 5,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 8,
    lineHeight: 10,
    color: colors.textMuted,
    marginBottom: 1,
  },
  metricValue: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '800',
  },
  segmentContainer: {
    height: 44,
    borderRadius: 14,
    padding: 3,
    backgroundColor: FLEET_SEGMENT_BG,
    borderWidth: 1,
    borderColor: FLEET_SEGMENT_BORDER,
    flexDirection: 'row',
    gap: 3,
  },
  segmentTab: {
    flex: 1,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  segmentTabActive: {
    backgroundColor: 'rgba(35,136,255,0.13)',
    borderColor: colors.accentBlue,
  },
  segmentLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8795AA',
  },
  segmentLabelActive: {
    color: colors.accentBlue,
    fontWeight: '700',
  },
  tabContent: {
    gap: FLEET_SECTION_GAP,
  },
  driverHireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverHireBtn: {
    flex: 1,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.accentBlue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  driverHireBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  driverSlotBadge: {
    height: 40,
    borderRadius: 12,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    flexShrink: 0,
  },
  driverSlotValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 13,
  },
  driverSlotLabel: {
    fontSize: 7.5,
    color: '#74839B',
    lineHeight: 9,
    marginTop: 1,
  },
  trailerSectionHeader: {
    gap: 3,
    marginBottom: 2,
  },
  trailerSectionTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 18,
  },
  trailerSectionSubtitle: {
    fontSize: 10,
    color: '#91A0B8',
    lineHeight: 13,
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
  upgradeManageBlock: {
    gap: 4,
    marginTop: 2,
  },
  upgradeManageHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
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
