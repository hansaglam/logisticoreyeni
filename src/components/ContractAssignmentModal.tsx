/**
 * LogistiCore - Sözleşme teslimat ekibi seçim modalı
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppDialog } from './AppDialogProvider';

import { getBottomInset } from '../constants/layout';
import { getScreenTopPadding } from '../utils/screenInsets';
import { getCityName, getProductName } from '../utils/entityLookup';
import { getRoute as findRoute } from '../data/routes';
import {
  buildContractPreview,
  CONTRACT_OPERATIONAL_PROFIT_DETAIL_HINT,
  CONTRACT_OPERATIONAL_PROFIT_INFO,
} from '../simulation/contractPreview';
import {
  getContractAvailability,
  getContractCargoWeight,
  isTruckAtContractOrigin,
  estimateAssignmentDurationHours,
} from '../simulation/delivery';
import {
  evaluateDriverOption,
  evaluateTruckOption,
  getDriverBadge,
  getTruckBadge,
  type DriverOption,
  type TruckOption,
} from '../utils/assignmentOptions';
import { useGameStore } from '../store/gameStore';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
import { colors, spacing, typography } from '../theme';
import { formatMoney } from '../theme/format';
import type { GameIconName } from '../theme/icons';
import { shouldEmbedNestedFuelUi } from '../utils/modalPresentation';
import {
  ActionButton,
  AppCard,
  GameIcon,
  ProductIcon,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from './ui';
import type { StatusBadgeVariant } from './ui';
import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import TutorialOverlay from './tutorial/TutorialOverlay';
import TruckRefuelSheet from './TruckRefuelSheet';
import FuelRequirementModal from './FuelRequirementModal';
import DeliveryReadinessCard from './delivery/DeliveryReadinessCard';
import RentalAssignmentFitBanner from './delivery/RentalAssignmentFitBanner';
import { evaluateDeliveryReadiness } from '../domain/deliveryReadiness';
import {
  formatRentalHoursLabel,
  getRentalFitBadgeLabel,
} from '../domain/rentalAssignmentFit';
import { getAttachedTrailerForTruck } from '../simulation/trailerAttachment';
import { TutorialTarget } from '../tutorial/TutorialTarget';
import type { Contract, Driver, Truck } from '../types/game';

const START_BUTTON_HEIGHT = 50;
const FOOTER_SCROLL_EXTRA = 40;
const FOOTER_CONTENT_HEIGHT = 120;

export type ContractAssignmentModalProps = {
  visible: boolean;
  contract: Contract | null;
  trucks: Truck[];
  drivers: Driver[];
  playerLevel?: number;
  onClose: () => void;
  onConfirm: (truckId: string, driverId: string) => void;
  onGoToFleet?: (subTab?: 'trucks' | 'drivers' | 'shop') => void;
};

interface ContractSummaryFinancials {
  expense: number;
  profit: number;
  durationHours: number;
  effectiveSpeedKmh: number;
}

function formatTimeLeft(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function getTruckStatusLabel(status: Truck['status']): string {
  switch (status) {
    case 'idle':
      return 'Boşta';
    case 'on_route':
      return 'Yolda';
    case 'maintenance':
      return 'Bakım gerekli';
    default:
      return status;
  }
}

function getDriverStatusLabel(status: Driver['status']): string {
  switch (status) {
    case 'idle':
      return 'Boşta';
    case 'driving':
      return 'Yolda';
    case 'resting':
      return 'Dinleniyor';
    default:
      return status;
  }
}

function getConditionColor(condition: number): string {
  if (condition >= 70) return colors.success;
  if (condition >= 40) return colors.accentAmber;
  return colors.danger;
}

function getDriverTrait(driver: Driver): { label: string; variant: StatusBadgeVariant } {
  const fuelSaving = driver.fuelSaving ?? 0;
  const experience = driver.experience ?? 0;
  const attention = driver.attention ?? 50;
  const speed = driver.speed ?? 0;

  if (fuelSaving >= 65) {
    return { label: 'Yakıt tasarruflu', variant: 'success' };
  }
  if (experience >= 65) {
    return { label: 'Tecrübeli', variant: 'info' };
  }
  if (attention < 40 || speed > 40) {
    return { label: 'Riskli', variant: 'danger' };
  }
  return { label: 'Dengeli şoför', variant: 'muted' };
}

function calculateMaxIdleCapacity(trucks: Truck[]): number {
  const idleCapacities = trucks
    .filter((truck) => truck.status === 'idle')
    .map((truck) => truck.capacity ?? 0);
  return idleCapacities.length > 0 ? Math.max(...idleCapacities) : 0;
}

interface AssignmentSectionProps {
  icon: GameIconName;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function AssignmentSection({ icon, title, subtitle, children }: AssignmentSectionProps) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIconWrap}>
          <GameIcon name={icon} size={16} color={colors.accentBlue} />
        </View>
        <SectionTitle title={title} subtitle={subtitle} style={styles.sectionTitleWrap} />
      </View>
      {children}
    </View>
  );
}

interface TruckCardProps {
  option: TruckOption;
  selected: boolean;
  onSelect: () => void;
}

function TruckCard({ option, selected, onSelect }: TruckCardProps) {
  const { alert: showAlert } = useAppDialog();
  const { truck } = option;
  const condition = Math.round(truck.condition ?? 100);
  const badge = getTruckBadge(option);
  const statusVariant: StatusBadgeVariant = truck.status === 'idle' ? 'success' : 'muted';

  const handlePress = () => {
    if (option.selectable) {
      onSelect();
      return;
    }
    showAlert('Kamyon seçilemiyor', option.label);
  };

  return (
    <Pressable onPress={handlePress}>
      <AppCard
        variant={selected ? 'selected' : 'default'}
        style={[
          styles.optionCard,
          selected && styles.optionCardSelected,
          !option.selectable && styles.optionCardDisabled,
        ]}
        padded
      >
        {selected ? (
          <View style={styles.selectedCheck}>
            <GameIcon name="success" size={14} color={colors.accentBlue} />
          </View>
        ) : null}

        <View style={styles.optionHeaderRow}>
          <View style={styles.optionIconWrap}>
            <GameIcon name="truck" size={18} color={colors.accentBlue} />
          </View>
          <View style={styles.optionTitleBlock}>
            <Text style={styles.optionTitle} numberOfLines={1}>
              {truck.name}
            </Text>
            <Text style={styles.optionMetaLine}>
              {truck.capacity ?? 0} ton · {truck.speed ?? 0} km/h
            </Text>
          </View>
          <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Kapasite</Text>
            <Text style={styles.metricValue}>{truck.capacity ?? 0}t</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Hız</Text>
            <Text style={styles.metricValue}>{truck.speed ?? 0} km/h</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Durum</Text>
            <StatusBadge label={getTruckStatusLabel(truck.status)} variant={statusVariant} size="sm" />
          </View>
        </View>

        <View style={styles.conditionRow}>
          <Text style={styles.metricLabel}>Kondisyon {condition}%</Text>
          <ProgressBar
            progress={condition / 100}
            color={getConditionColor(condition)}
            height={4}
          />
        </View>
        {option.rentalFit?.applicable ? (
          <View style={styles.rentalRow}>
            <Text style={styles.rentalLine}>
              Kalan kira: {formatRentalHoursLabel(option.rentalFit.remainingHours)}
            </Text>
            <Text style={styles.rentalLine}>
              Tahmini teslimat: {formatRentalHoursLabel(option.rentalFit.estimatedTravelHours)}
            </Text>
            <Text style={styles.rentalLine}>
              {getRentalFitBadgeLabel(option.rentalFit.status)}
            </Text>
          </View>
        ) : null}
      </AppCard>
    </Pressable>
  );
}

interface DriverCardProps {
  option: DriverOption;
  selected: boolean;
  onSelect: () => void;
}

function DriverCard({ option, selected, onSelect }: DriverCardProps) {
  const { alert: showAlert } = useAppDialog();
  const { driver } = option;
  const badge = getDriverBadge(option);
  const trait = getDriverTrait(driver);
  const statusVariant: StatusBadgeVariant = driver.status === 'idle' ? 'success' : 'muted';

  const handlePress = () => {
    if (option.selectable) {
      onSelect();
      return;
    }
    showAlert('Şoför seçilemiyor', option.label);
  };

  return (
    <Pressable onPress={handlePress}>
      <AppCard
        variant={selected ? 'selected' : 'default'}
        style={[
          styles.optionCard,
          selected && styles.optionCardSelected,
          !option.selectable && styles.optionCardDisabled,
        ]}
        padded
      >
        {selected ? (
          <View style={styles.selectedCheck}>
            <GameIcon name="success" size={14} color={colors.accentBlue} />
          </View>
        ) : null}

        <View style={styles.optionHeaderRow}>
          <View style={styles.optionIconWrap}>
            <GameIcon name="driver" size={18} color={colors.accentBlue} />
          </View>
          <View style={styles.optionTitleBlock}>
            <Text style={styles.optionTitle} numberOfLines={1}>
              {driver.name}
            </Text>
            <Text style={styles.optionMetaLine}>
              Deneyim {Math.round(driver.experience ?? 0)} · Dikkat {Math.round(driver.attention ?? 0)} ·
              Maaş {formatMoney(driver.salaryPerDay ?? 0)}/gün
            </Text>
          </View>
          <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
        </View>

        <View style={styles.driverFooterRow}>
          <StatusBadge label={trait.label} variant={trait.variant} size="sm" />
          <StatusBadge label={getDriverStatusLabel(driver.status)} variant={statusVariant} size="sm" />
          {(driver.fuelSaving ?? 0) >= 50 ? (
            <StatusBadge label={`Tasarruf ${Math.round(driver.fuelSaving ?? 0)}%`} variant="info" size="sm" />
          ) : null}
        </View>
      </AppCard>
    </Pressable>
  );
}

export default function ContractAssignmentModal({
  visible,
  contract,
  trucks,
  drivers,
  playerLevel = 1,
  onClose,
  onConfirm,
  onGoToFleet,
}: ContractAssignmentModalProps) {
  const { alert: showAlert } = useAppDialog();
  const insets = useAppSafeAreaInsets();
  const bottomInset = getBottomInset(insets);
  const globalEconomyState = useGameStore((state) => state.globalEconomy);
  const snapshot = useGameStore((state) => state.cachedGlobalEconomySnapshot);
  const globalEconomy = useMemo(
    () => ({
      ...globalEconomyState,
      fuelPrice: getSnapshotFuelPrice(snapshot, globalEconomyState),
    }),
    [globalEconomyState, snapshot],
  );
  const currentTime = useGameStore((state) => state.currentTime);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries);
  const trailers = useGameStore((state) => state.player?.trailers ?? []);
  const homeCityId = useGameStore((state) => state.player?.homeCityId);
  const playerReputation = useGameStore((state) => state.player?.reputation ?? 0);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [refuelVisible, setRefuelVisible] = useState(false);
  const [fuelRequirementVisible, setFuelRequirementVisible] = useState(false);

  const safeTrucks = trucks ?? [];
  const safeDrivers = drivers ?? [];

  const cargoWeight = useMemo(() => {
    if (!contract) return 0;
    return getContractCargoWeight(contract);
  }, [contract]);

  const availability = useMemo(() => {
    if (!contract) {
      return null;
    }
    return getContractAvailability(
      contract,
      safeTrucks,
      safeDrivers,
      playerLevel,
      currentTime,
      playerReputation,
      homeCityId,
      trailers,
    );
  }, [contract, safeTrucks, safeDrivers, playerLevel, currentTime, playerReputation, homeCityId, trailers]);

  const selectedDriver = useMemo(
    () => safeDrivers.find((driver) => driver.id === selectedDriverId) ?? null,
    [safeDrivers, selectedDriverId],
  );

  const truckOptions = useMemo(
    () =>
      safeTrucks.map((truck) =>
        evaluateTruckOption(
          truck,
          cargoWeight,
          contract?.originCityId ?? '',
          trailers,
          currentTime,
          activeDeliveries,
          contract
            ? estimateAssignmentDurationHours({
                contract,
                truck,
                driver: selectedDriver,
                trailers,
              })
            : undefined,
        ),
      ),
    [
      safeTrucks,
      cargoWeight,
      contract,
      trailers,
      currentTime,
      activeDeliveries,
      selectedDriver,
    ],
  );

  const driverOptions = useMemo(
    () => safeDrivers.map((driver) => evaluateDriverOption(driver)),
    [safeDrivers],
  );

  const eligibleTrucks = truckOptions.filter((option) => option.selectable);
  const eligibleDrivers = driverOptions.filter((option) => option.selectable);

  const selectedTruckOption = truckOptions.find((option) => option.truck.id === selectedTruckId);
  const selectedDriverOption = driverOptions.find((option) => option.driver.id === selectedDriverId);
  const liveRefuelTruck = useGameStore((state) =>
    selectedTruckId
      ? state.player?.trucks.find((candidate) => candidate.id === selectedTruckId) ?? null
      : null,
  );

  const fuelReadiness = useMemo(() => {
    if (!contract || !selectedTruckId || !selectedDriverOption?.driver) return null;
    if (!liveRefuelTruck) return null;
    const route = findRoute(contract.originCityId, contract.destinationCityId);
    if (!route) return null;
    return evaluateDeliveryReadiness({
      contract,
      truck: liveRefuelTruck,
      trailer: getAttachedTrailerForTruck(liveRefuelTruck.id, trailers),
      driver: selectedDriverOption.driver,
      route,
      fuelPricePerLiter: globalEconomy?.fuelPrice ?? 0,
    });
  }, [
    contract,
    globalEconomy?.fuelPrice,
    liveRefuelTruck,
    selectedDriverOption?.driver,
    selectedTruckId,
    trailers,
  ]);
  const truckFuelReadiness = fuelReadiness?.fuelReadiness ?? null;

  const summaryFinancials = useMemo((): ContractSummaryFinancials | null => {
    if (!contract) return null;

    const preview = buildContractPreview({
      contract,
      globalEconomy: globalEconomy ?? undefined,
      trucks: safeTrucks,
      trailers,
      drivers: safeDrivers,
      companyLevel: playerLevel,
      truck: selectedTruckOption?.truck,
      driver: selectedDriverOption?.driver,
      playerReputation,
      homeCityId,
    });

    return {
      expense: preview.estimatedTripCost,
      profit: preview.estimatedOperationalProfit,
      durationHours: preview.estimatedTravelHours,
      effectiveSpeedKmh: preview.effectiveAverageSpeedKmh,
    };
  }, [
    contract,
    globalEconomy,
    safeTrucks,
    trailers,
    safeDrivers,
    playerLevel,
    selectedTruckOption?.truck,
    selectedDriverOption?.driver,
    playerReputation,
    homeCityId,
  ]);

  const canConfirm =
    !!selectedTruckOption?.selectable &&
    !!selectedDriverOption?.selectable &&
    !!contract &&
    !!selectedTruckOption &&
    isTruckAtContractOrigin(selectedTruckOption.truck, contract);

  const scrollBottomPadding = useMemo(
    () => FOOTER_CONTENT_HEIGHT + bottomInset + FOOTER_SCROLL_EXTRA,
    [bottomInset],
  );

  const footerBottomPadding = useMemo(
    () => bottomInset + spacing.lg,
    [bottomInset],
  );

  const maxIdleCapacity = useMemo(
    () => calculateMaxIdleCapacity(safeTrucks),
    [safeTrucks],
  );

  useEffect(() => {
    if (!visible || !contract) return;

    const defaultTruck = [...eligibleTrucks].sort(
      (a, b) => (a.truck.capacity ?? 0) - (b.truck.capacity ?? 0),
    )[0];
    const defaultDriver = eligibleDrivers[0];

    setSelectedTruckId(defaultTruck?.truck.id ?? null);
    setSelectedDriverId(defaultDriver?.driver.id ?? null);
    setFuelRequirementVisible(false);
    setRefuelVisible(false);
  }, [visible, contract?.id, eligibleTrucks.length, eligibleDrivers.length]);

  if (!contract) {
    return null;
  }

  const routeLabel = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
  const selectionSummary = canConfirm
    ? `${selectedTruckOption?.truck.name ?? 'Kamyon'} + ${selectedDriverOption?.driver.name ?? 'Şoför'} hazır`
    : 'Kamyon ve şoför seçmelisin';

  const handleStartDelivery = () => {
    if (selectedTruckOption?.rentalFit && !selectedTruckOption.rentalFit.canAssign) {
      showAlert(
        'Teslimat başlatılamadı',
        `Bu kiralık aracın süresi bu teslimat için yeterli değil.\nKalan süre: ${formatRentalHoursLabel(selectedTruckOption.rentalFit.remainingHours)}\nTahmini teslimat: ${formatRentalHoursLabel(selectedTruckOption.rentalFit.estimatedTravelHours)}`,
      );
      return;
    }
    if (!selectedTruckId || !selectedDriverId || !canConfirm) return;
    if (fuelReadiness?.reasons.includes('INSUFFICIENT_FUEL')) {
      setFuelRequirementVisible(true);
      return;
    }
    if (fuelReadiness?.reasons.includes('DEADLINE_IMPOSSIBLE')) {
      setSelectedTruckId(null);
      return;
    }
    onConfirm(selectedTruckId, selectedDriverId);
  };

  const startLabel = fuelReadiness?.reasons.includes('INSUFFICIENT_FUEL')
    ? 'Yakıt gerekli'
    : fuelReadiness?.reasons.includes('DEADLINE_IMPOSSIBLE')
      ? 'Başka Araç Seç'
      : 'Teslimatı Başlat';
  const nestFuelUi = shouldEmbedNestedFuelUi();
  const fuelFlow = (
    <>
      <FuelRequirementModal
        visible={fuelRequirementVisible}
        readiness={truckFuelReadiness}
        embedded={nestFuelUi}
        onCancel={() => setFuelRequirementVisible(false)}
        onBuyFuel={() => {
          setFuelRequirementVisible(false);
          setRefuelVisible(true);
        }}
      />
      <TruckRefuelSheet
        visible={refuelVisible}
        truck={liveRefuelTruck}
        preferredMinimumLiters={truckFuelReadiness?.fuelDeficitL ?? null}
        embedded={nestFuelUi}
        source="job_assignment"
        onClose={() => setRefuelVisible(false)}
        onSuccess={() => {
          setRefuelVisible(false);
        }}
      />
    </>
  );

  const renderAvailabilityWarning = () => {
    if (!availability || availability.canStart) {
      return null;
    }

    const showFleetButton =
      availability.reason === 'NO_TRUCKS' ||
      availability.reason === 'NO_IDLE_TRUCKS' ||
      availability.reason === 'NO_TRUCK_IN_ORIGIN_CITY' ||
      availability.reason === 'NO_TRUCK_WITH_CAPACITY' ||
      availability.reason === 'CAPACITY_INSUFFICIENT' ||
      availability.reason === 'RENTAL_DURATION_INSUFFICIENT';

    const showDriverButton =
      availability.reason === 'NO_DRIVERS' || availability.reason === 'NO_IDLE_DRIVERS';

    return (
      <AppCard variant="highlighted" style={styles.warningCard}>
        <View style={styles.warningTitleRow}>
          <GameIcon name="warning" size={16} color={colors.accentAmber} />
          <Text style={styles.warningTitle}>{availability.title ?? availability.buttonLabel}</Text>
        </View>
        <Text style={styles.warningMessage}>{availability.message}</Text>
        {showFleetButton && onGoToFleet ? (
          <ActionButton
            label="Filo Mağazasına Git"
            onPress={() => onGoToFleet('shop')}
            variant="secondary"
            style={styles.warningButton}
          />
        ) : null}
        {showDriverButton && onGoToFleet ? (
          <ActionButton
            label="Şoför Havuzuna Git"
            onPress={() => onGoToFleet('drivers')}
            variant="secondary"
            style={styles.warningButton}
          />
        ) : null}
      </AppCard>
    );
  };

  const renderNoTruckCard = () => {
    if (safeTrucks.length === 0) {
      return (
        <AppCard variant="soft" style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Uygun kamyon yok</Text>
          <Text style={styles.emptyMessage}>Filonda kamyon bulunmuyor.</Text>
          {onGoToFleet ? (
            <ActionButton
              label="Filo Mağazasına Git"
              onPress={() => onGoToFleet('shop')}
              variant="secondary"
              style={styles.warningButton}
            />
          ) : null}
        </AppCard>
      );
    }

    if (eligibleTrucks.length > 0) {
      return null;
    }

    const rentalBlocked = truckOptions.some((option) => option.issue === 'rental_duration');
    return (
      <AppCard variant="soft" style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Uygun kamyon yok</Text>
        <Text style={styles.emptyMessage}>
          {rentalBlocked
            ? 'Kiralık araçların kalan süresi bu teslimat için yeterli değil. Başka bir araç seç veya filodan yeni araç al.'
            : `Bu iş için ${cargoWeight.toFixed(1)} ton kapasite gerekiyor. Boşta en yüksek kamyon kapasiten ${maxIdleCapacity.toFixed(1)} ton.`}
        </Text>
        {onGoToFleet ? (
          <ActionButton
            label="Filo Mağazasına Git"
            onPress={() => onGoToFleet('shop')}
            variant="secondary"
            style={styles.warningButton}
          />
        ) : null}
      </AppCard>
    );
  };

  const renderNoDriverCard = () => {
    if (safeDrivers.length === 0) {
      return (
        <AppCard variant="soft" style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Boşta şoför yok</Text>
          <Text style={styles.emptyMessage}>Filonda şoför bulunmuyor.</Text>
          {onGoToFleet ? (
            <ActionButton
              label="Şoför Havuzuna Git"
              onPress={() => onGoToFleet('drivers')}
              variant="secondary"
              style={styles.warningButton}
            />
          ) : null}
        </AppCard>
      );
    }

    if (eligibleDrivers.length > 0) {
      return null;
    }

    return (
      <AppCard variant="soft" style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Boşta şoför yok</Text>
        <Text style={styles.emptyMessage}>Tüm şoförler şu anda başka görevde.</Text>
        {onGoToFleet ? (
          <ActionButton
            label="Şoför Havuzuna Git"
            onPress={() => onGoToFleet('drivers')}
            variant="secondary"
            style={styles.warningButton}
          />
        ) : null}
      </AppCard>
    );
  };

  return (
    <>
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: getScreenTopPadding(insets) }]}>
        <View style={styles.headerWrap}>
          <ScreenHeader
            title="Teslimat Ekibi Seç"
            subtitle={routeLabel}
            onBack={onClose}
            rightAction={<StatusBadge label="Yeni teslimat" variant="info" size="sm" />}
          />
        </View>

        <AppCard style={styles.summaryCard}>
          <View style={styles.summaryTopRow}>
            <View style={styles.summaryIconWrap}>
              <ProductIcon productId={contract.productId} size={22} color={colors.info} />
            </View>
            <View style={styles.summaryMain}>
              <Text style={styles.summaryProduct}>{getProductName(contract.productId)}</Text>
              <Text style={styles.summaryMeta}>
                {cargoWeight.toFixed(1)} ton · {Math.round(contract.distanceKm)} km ·{' '}
                {formatTimeLeft(contract.deadlineHours)}
              </Text>
            </View>
          </View>

          <View style={styles.summaryFinanceRow}>
            <View style={styles.summaryFinanceItem}>
              <Text style={styles.summaryFinanceLabel}>Ödeme</Text>
              <Text style={styles.summaryPayment}>{formatMoney(contract.payment)}</Text>
            </View>
            {summaryFinancials ? (
              <>
                <View style={styles.summaryFinanceItem}>
                  <Pressable
                    onPress={() => showAlert('İş kârı', CONTRACT_OPERATIONAL_PROFIT_INFO)}
                    hitSlop={8}
                  >
                    <Text style={styles.summaryFinanceLabel}>İş kârı ⓘ</Text>
                  </Pressable>
                  <Text
                    style={[
                      styles.summaryProfit,
                      {
                        color:
                          summaryFinancials.profit >= 0 ? colors.success : colors.danger,
                      },
                    ]}
                  >
                    {formatMoney(summaryFinancials.profit)}
                  </Text>
                </View>
                <View style={styles.summaryFinanceItem}>
                  <Text style={styles.summaryFinanceLabel}>İş gideri</Text>
                  <Text style={styles.summaryExpense}>{formatMoney(summaryFinancials.expense)}</Text>
                </View>
              </>
            ) : null}
          </View>
          {summaryFinancials ? (
            <>
              <Text style={styles.summaryOperationMeta}>
                Operasyon süresi: {formatTimeLeft(summaryFinancials.durationHours)} · Ortalama hız:{' '}
                {Math.round(summaryFinancials.effectiveSpeedKmh)} km/sa
              </Text>
              <Text style={styles.summaryFinanceHint}>{CONTRACT_OPERATIONAL_PROFIT_DETAIL_HINT}</Text>
            </>
          ) : null}
        </AppCard>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: scrollBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {renderAvailabilityWarning()}

          <AssignmentSection
            icon="truck"
            title="Kamyon seç"
            subtitle="Bu sözleşme için uygun kamyonu seç."
          >
            {renderNoTruckCard()}
            {truckOptions.map((option, index) => {
              const card = (
                <TruckCard
                  key={option.truck.id}
                  option={option}
                  selected={option.truck.id === selectedTruckId}
                  onSelect={() => setSelectedTruckId(option.truck.id)}
                />
              );

              if (index !== 0) {
                return card;
              }

              return (
                <TutorialTarget key={option.truck.id} id="assignment-truck-card">
                  {card}
                </TutorialTarget>
              );
            })}
          </AssignmentSection>

          <AssignmentSection
            icon="driver"
            title="Şoför seç"
            subtitle="Teslimatı yapacak şoförü seç."
          >
            {renderNoDriverCard()}
            {driverOptions.map((option, index) => {
              const card = (
                <DriverCard
                  key={option.driver.id}
                  option={option}
                  selected={option.driver.id === selectedDriverId}
                  onSelect={() => setSelectedDriverId(option.driver.id)}
                />
              );

              if (index !== 0) {
                return card;
              }

              return (
                <TutorialTarget key={option.driver.id} id="assignment-driver-card">
                  {card}
                </TutorialTarget>
              );
            })}
          </AssignmentSection>
          <DeliveryReadinessCard
            readiness={fuelReadiness}
            onSelectAnotherVehicle={() => setSelectedTruckId(null)}
            onBuyFuel={() => setFuelRequirementVisible(true)}
          />
          <RentalAssignmentFitBanner
            fit={selectedTruckOption?.rentalFit}
            onSelectAnotherVehicle={() => setSelectedTruckId(null)}
            onGoBack={onClose}
          />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
          <Text style={styles.selectionSummary}>{selectionSummary}</Text>
          {!canConfirm ? (
            <Text style={styles.footerHint}>Başlamak için uygun kamyon ve şoför seç.</Text>
          ) : null}
          <TutorialTarget
            id="assignment-start-button"
            onTutorialPress={handleStartDelivery}
          >
            <ActionButton
              label={startLabel}
              icon="truck"
              onPress={handleStartDelivery}
              disabled={!canConfirm}
              fullWidth
              variant="primary"
              style={styles.startButton}
            />
          </TutorialTarget>
        </View>
      </View>
      <TutorialOverlay layer="modal" />
      {nestFuelUi ? fuelFlow : null}
    </Modal>
    {nestFuelUi ? null : fuelFlow}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  summaryCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryMain: {
    flex: 1,
    minWidth: 0,
  },
  summaryProduct: {
    ...typography.cardTitle,
    fontSize: 16,
    marginBottom: 4,
  },
  summaryMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  summaryFinanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  summaryFinanceItem: {
    minWidth: 92,
  },
  summaryFinanceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 2,
  },
  summaryPayment: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
  },
  summaryProfit: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  summaryExpense: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
  },
  summaryOperationMeta: {
    ...typography.caption,
    color: colors.info,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  summaryFinanceHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  sectionBlock: {
    marginTop: spacing.lg,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sectionTitleWrap: {
    flex: 1,
    marginBottom: 0,
  },
  warningCard: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  warningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  warningTitle: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
    flex: 1,
  },
  warningMessage: {
    ...typography.caption,
    color: colors.textPrimary,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  warningButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  emptyCard: {
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  optionCard: {
    marginBottom: spacing.sm,
    position: 'relative',
    overflow: 'visible',
  },
  optionCardSelected: {
    borderWidth: 2,
    borderColor: colors.accentBlue,
  },
  optionCardDisabled: {
    opacity: 0.65,
  },
  selectedCheck: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingRight: spacing.lg,
  },
  optionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  optionMetaLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricItem: {
    minWidth: 88,
    gap: 2,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  metricValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  conditionRow: {
    gap: 4,
  },
  rentalRow: {
    marginTop: spacing.sm,
    gap: 2,
  },
  rentalLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  driverFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  fuelWarning: {
    width: '100%',
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    backgroundColor: colors.warningSoft,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fuelWarningText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  fuelWarningActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fuelWarningButton: {
    flex: 1,
    minHeight: 44,
  },
  selectionSummary: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  startButton: {
    minHeight: START_BUTTON_HEIGHT,
    borderRadius: 14,
  },
});
