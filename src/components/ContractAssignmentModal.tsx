/**
 * LogistiCore - Sözleşme teslimat ekibi seçim modalı
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { deliveryBalance } from '../config/balance';
import { getBottomInset } from '../constants/layout';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { getRoute as findRoute } from '../data/routes';
import {
  getContractAvailability,
  getContractCargoWeight,
  isTruckAtContractOrigin,
  resolveTruckCityId,
} from '../simulation/delivery';
import { useGameStore } from '../store/gameStore';
import { colors, spacing, typography } from '../theme';
import { formatMoney } from '../theme/format';
import type { GameIconName } from '../theme/icons';
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
import type { Contract, Driver, GlobalEconomy, ProductId, Truck } from '../types/game';

const MIN_TRUCK_CONDITION = 30;
const LOW_CONDITION_WARNING = 50;
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

type TruckIssue =
  | 'eligible'
  | 'on_route'
  | 'maintenance'
  | 'wrong_city'
  | 'capacity'
  | 'condition_blocked'
  | 'condition_warning';

type DriverIssue = 'eligible' | 'on_route' | 'resting';

interface TruckOption {
  truck: Truck;
  issue: TruckIssue;
  label: string;
  selectable: boolean;
}

interface DriverOption {
  driver: Driver;
  issue: DriverIssue;
  label: string;
  selectable: boolean;
}

interface ContractSummaryFinancials {
  expense: number;
  profit: number;
}

function formatTimeLeft(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? 'Bilinmeyen yük';
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

function estimateSummaryFinancials(
  contract: Contract,
  globalEconomy: GlobalEconomy | null,
): ContractSummaryFinancials | null {
  if (!globalEconomy) return null;

  const fuelCost =
    contract.distanceKm * globalEconomy.fuelPrice * deliveryBalance.fuelCostEstimateMultiplier;
  const travelHours = contract.distanceKm / deliveryBalance.defaultAverageSpeed;
  const driverCost =
    (deliveryBalance.fallbackDriverSalaryPerDay / 24) *
    travelHours *
    deliveryBalance.driverCostMultiplier;
  const routeDifficulty = findRoute(contract.originCityId, contract.destinationCityId)?.difficulty ?? 0.5;
  const maintenanceCost = contract.distanceKm * deliveryBalance.maintenanceCostPerKm * routeDifficulty;
  const expense = fuelCost + driverCost + maintenanceCost;

  return {
    expense,
    profit: contract.payment - expense,
  };
}

function evaluateTruckOption(
  truck: Truck,
  cargoWeight: number,
  originCityId: string,
): TruckOption {
  const capacity = truck.capacity ?? 0;
  const condition = truck.condition ?? 100;

  if (truck.status === 'on_route') {
    return { truck, issue: 'on_route', label: 'Teslimatta', selectable: false };
  }
  if (truck.status === 'transferring') {
    return { truck, issue: 'on_route', label: 'Yönlendiriliyor', selectable: false };
  }
  if (truck.status === 'maintenance') {
    return { truck, issue: 'maintenance', label: 'Bakım gerekli', selectable: false };
  }
  if (truck.status !== 'idle') {
    return { truck, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }

  const truckCityId = resolveTruckCityId(truck);
  if (originCityId && truckCityId !== originCityId) {
    const cityName = getCityName(truckCityId);
    return {
      truck,
      issue: 'wrong_city',
      label: `${cityName}'da · çıkış şehrinde değil`,
      selectable: false,
    };
  }

  if (capacity < cargoWeight) {
    return {
      truck,
      issue: 'capacity',
      label: `${cargoWeight.toFixed(1)}t gerekli / ${capacity.toFixed(1)}t mevcut`,
      selectable: false,
    };
  }
  if (condition < MIN_TRUCK_CONDITION) {
    return {
      truck,
      issue: 'condition_blocked',
      label: 'Kondisyon çok düşük',
      selectable: false,
    };
  }
  if (condition < LOW_CONDITION_WARNING) {
    return {
      truck,
      issue: 'condition_warning',
      label: 'Kondisyon düşük, risk artar',
      selectable: true,
    };
  }
  return { truck, issue: 'eligible', label: 'Uygun', selectable: true };
}

function evaluateDriverOption(driver: Driver): DriverOption {
  if (driver.status === 'driving') {
    return { driver, issue: 'on_route', label: 'Şu anda teslimatta', selectable: false };
  }
  if (driver.status === 'resting') {
    return { driver, issue: 'resting', label: 'Dinleniyor', selectable: false };
  }
  if (driver.status !== 'idle') {
    return { driver, issue: 'on_route', label: 'Müsait değil', selectable: false };
  }
  return { driver, issue: 'eligible', label: 'Uygun', selectable: true };
}

function getTruckBadge(option: TruckOption): { label: string; variant: StatusBadgeVariant } {
  switch (option.issue) {
    case 'eligible':
      return { label: 'UYGUN', variant: 'success' };
    case 'condition_warning':
      return { label: 'KONDİSYON DÜŞÜK', variant: 'warning' };
    case 'capacity':
      return { label: 'KAPASİTE YETERSİZ', variant: 'danger' };
    case 'condition_blocked':
      return { label: 'KONDİSYON DÜŞÜK', variant: 'danger' };
    case 'on_route':
      return { label: 'YOLDA', variant: 'amber' };
    case 'wrong_city':
      return { label: 'KONUM UYGUN DEĞİL', variant: 'warning' };
    case 'maintenance':
      return { label: 'BAKIM', variant: 'danger' };
    default:
      return { label: 'MÜSAİT DEĞİL', variant: 'muted' };
  }
}

function getDriverBadge(option: DriverOption): { label: string; variant: StatusBadgeVariant } {
  if (option.issue === 'eligible') {
    return { label: 'UYGUN', variant: 'success' };
  }
  if (option.issue === 'resting') {
    return { label: 'DİNLENİYOR', variant: 'amber' };
  }
  return { label: 'YOLDA', variant: 'amber' };
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
  const { truck } = option;
  const condition = Math.round(truck.condition ?? 100);
  const badge = getTruckBadge(option);
  const statusVariant: StatusBadgeVariant = truck.status === 'idle' ? 'success' : 'muted';

  const handlePress = () => {
    if (option.selectable) {
      onSelect();
      return;
    }
    Alert.alert('Kamyon seçilemiyor', option.label);
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
  const { driver } = option;
  const badge = getDriverBadge(option);
  const trait = getDriverTrait(driver);
  const statusVariant: StatusBadgeVariant = driver.status === 'idle' ? 'success' : 'muted';

  const handlePress = () => {
    if (option.selectable) {
      onSelect();
      return;
    }
    Alert.alert('Şoför seçilemiyor', option.label);
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
  const insets = useAppSafeAreaInsets();
  const bottomInset = getBottomInset(insets);
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

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
    return getContractAvailability(contract, safeTrucks, safeDrivers, playerLevel);
  }, [contract, safeTrucks, safeDrivers, playerLevel]);

  const summaryFinancials = useMemo(() => {
    if (!contract) return null;
    return estimateSummaryFinancials(contract, globalEconomy);
  }, [contract, globalEconomy]);

  const truckOptions = useMemo(
    () =>
      safeTrucks.map((truck) =>
        evaluateTruckOption(truck, cargoWeight, contract?.originCityId ?? ''),
      ),
    [safeTrucks, cargoWeight, contract?.originCityId],
  );

  const driverOptions = useMemo(
    () => safeDrivers.map((driver) => evaluateDriverOption(driver)),
    [safeDrivers],
  );

  const eligibleTrucks = truckOptions.filter((option) => option.selectable);
  const eligibleDrivers = driverOptions.filter((option) => option.selectable);

  const selectedTruckOption = truckOptions.find((option) => option.truck.id === selectedTruckId);
  const selectedDriverOption = driverOptions.find((option) => option.driver.id === selectedDriverId);

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
  }, [visible, contract?.id, eligibleTrucks.length, eligibleDrivers.length]);

  if (!contract) {
    return null;
  }

  const routeLabel = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
  const selectionSummary = canConfirm
    ? `${selectedTruckOption?.truck.name ?? 'Kamyon'} + ${selectedDriverOption?.driver.name ?? 'Şoför'} hazır`
    : 'Kamyon ve şoför seçmelisin';

  const renderAvailabilityWarning = () => {
    if (!availability || availability.canStart) {
      return null;
    }

    const showFleetButton =
      availability.reason === 'NO_TRUCKS' ||
      availability.reason === 'NO_IDLE_TRUCKS' ||
      availability.reason === 'NO_TRUCK_IN_ORIGIN_CITY' ||
      availability.reason === 'CAPACITY_INSUFFICIENT';

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

    return (
      <AppCard variant="soft" style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Uygun kamyon yok</Text>
        <Text style={styles.emptyMessage}>
          Bu iş için {cargoWeight.toFixed(1)} ton kapasite gerekiyor. Boşta en yüksek kamyon
          kapasiten {maxIdleCapacity.toFixed(1)} ton.
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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
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
                  <Text style={styles.summaryFinanceLabel}>Tahmini kâr</Text>
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
                  <Text style={styles.summaryFinanceLabel}>Gider</Text>
                  <Text style={styles.summaryExpense}>{formatMoney(summaryFinancials.expense)}</Text>
                </View>
              </>
            ) : null}
          </View>
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
            {truckOptions.map((option) => (
              <TruckCard
                key={option.truck.id}
                option={option}
                selected={option.truck.id === selectedTruckId}
                onSelect={() => setSelectedTruckId(option.truck.id)}
              />
            ))}
          </AssignmentSection>

          <AssignmentSection
            icon="driver"
            title="Şoför seç"
            subtitle="Teslimatı yapacak şoförü seç."
          >
            {renderNoDriverCard()}
            {driverOptions.map((option) => (
              <DriverCard
                key={option.driver.id}
                option={option}
                selected={option.driver.id === selectedDriverId}
                onSelect={() => setSelectedDriverId(option.driver.id)}
              />
            ))}
          </AssignmentSection>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
          <Text style={styles.selectionSummary}>{selectionSummary}</Text>
          {!canConfirm ? (
            <Text style={styles.footerHint}>Başlamak için uygun kamyon ve şoför seç.</Text>
          ) : null}
          <ActionButton
            label="Teslimatı Başlat"
            icon="truck"
            onPress={() => {
              if (selectedTruckId && selectedDriverId && canConfirm) {
                onConfirm(selectedTruckId, selectedDriverId);
              }
            }}
            disabled={!canConfirm}
            fullWidth
            variant="primary"
            style={styles.startButton}
          />
        </View>
      </View>
    </Modal>
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
