/**
 * LogistiCore - Sözleşmeler Ekranı
 *
 * Oyuncunun müsait işleri hızlıca tarayıp en iyi sözleşmeyi seçebileceği sade ekran.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  Alert,
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
import { getRoute as findRoute } from '../data/routes';
import {
  calculateTravelHours,
  getContractAvailability,
  getContractAvailabilityWarningText,
  getContractCargoWeight,
  selectIdleTruckForContract,
} from '../simulation/delivery';
import { dedupeAvailableContracts, getMarketContractMatchTier } from '../simulation/contracts';
import { deliveryBalance } from '../config/balance';
import ContractAssignmentModal from '../components/ContractAssignmentModal';
import type { Contract, Driver, GlobalEconomy, Product, ProductId, Route, Truck } from '../types/game';

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
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

const FALLBACK_FUEL_RATE_PER_KM = deliveryBalance.fuelCostEstimateMultiplier;
const FALLBACK_AVERAGE_SPEED_KMH = deliveryBalance.defaultAverageSpeed;
const FALLBACK_DRIVER_SALARY_PER_DAY = deliveryBalance.fallbackDriverSalaryPerDay;
const URGENT_URGENCY_THRESHOLD = 0.75;
const URGENT_FALLBACK_DEADLINE_HOURS = 10;
const LONG_ROUTE_KM = 350;
const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const MARKET_HIGHLIGHT_TIMEOUT_MS = 7000;

type FilterKey = 'all' | 'bestPayment' | 'shortDistance' | 'urgent' | 'lowRisk';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'bestPayment', label: 'En yüksek ödeme' },
  { key: 'shortDistance', label: 'Kısa rota' },
  { key: 'urgent', label: 'Acil' },
  { key: 'lowRisk', label: 'Düşük risk' },
];

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatHours(hours: number): string {
  const totalHours = Math.max(0, Math.round(hours));
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (days > 0) return `${days}g ${remainingHours}sa`;
  return `${remainingHours}sa`;
}

function formatDistance(km: number): string {
  return `${Math.round(km)} km`;
}

function formatTons(amount: number): string {
  return `${amount.toFixed(1)} ton`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? 'Bilinmeyen yük';
}

function getProductById(productId: ProductId): Product {
  return PRODUCT_BY_ID[productId];
}

function getRoute(originCityId: string, destinationCityId: string): Route | undefined {
  return findRoute(originCityId, destinationCityId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateContractTravelHours(contract: Contract, truck?: Truck, driver?: Driver): number {
  const route = getRoute(contract.originCityId, contract.destinationCityId);
  if (truck && driver && route) {
    try {
      const product = getProductById(contract.productId);
      return calculateTravelHours(contract, truck, driver, route, product);
    } catch {
      /* fallback below */
    }
  }
  if (contract.distanceKm > 0) {
    return contract.distanceKm / FALLBACK_AVERAGE_SPEED_KMH;
  }
  return 0;
}

function getRiskMultiplier(riskLabel: string): number {
  if (riskLabel === 'Yüksek risk') return deliveryBalance.riskReserveHigh;
  if (riskLabel === 'Orta risk') return deliveryBalance.riskReserveMedium;
  return deliveryBalance.riskReserveLow;
}

interface ContractFinancials {
  fuelCost: number;
  driverCost: number;
  maintenanceCost: number;
  riskReserve: number;
  totalExpense: number;
  estimatedProfit: number;
  profitMargin: number;
  travelHours: number;
}

function estimateContractFinancials(
  contract: Contract,
  globalEconomy: GlobalEconomy,
  riskLabel: string,
  truck?: Truck,
  driver?: Driver,
): ContractFinancials {
  const route = getRoute(contract.originCityId, contract.destinationCityId);
  const routeDifficulty = route?.difficulty ?? 0.5;
  const travelHours = estimateContractTravelHours(contract, truck, driver);
  const salaryPerDay = driver?.salaryPerDay ?? FALLBACK_DRIVER_SALARY_PER_DAY;

  const fuelCost = contract.distanceKm * globalEconomy.fuelPrice * FALLBACK_FUEL_RATE_PER_KM;
  const driverCost = (salaryPerDay / 24) * travelHours;
  const maintenanceCost =
    contract.distanceKm * deliveryBalance.maintenanceCostPerKm * routeDifficulty;
  const riskReserve = contract.payment * getRiskMultiplier(riskLabel);
  const totalExpense = fuelCost + driverCost + maintenanceCost + riskReserve;
  const estimatedProfit = contract.payment - totalExpense;
  const profitMargin = contract.payment > 0 ? estimatedProfit / contract.payment : 0;

  return {
    fuelCost,
    driverCost,
    maintenanceCost,
    riskReserve,
    totalExpense,
    estimatedProfit,
    profitMargin,
    travelHours,
  };
}

interface RiskInfo {
  label: string;
  color: string;
  reasons: string[];
  primaryReason: string;
}

function calculateBaseRiskLabel(contract: Contract): Pick<RiskInfo, 'label' | 'color'> {
  const route = getRoute(contract.originCityId, contract.destinationCityId);
  const product = getProductById(contract.productId);
  const difficulty = route?.difficulty ?? 0.5;
  const deadlinePressure = clamp(1 - contract.deadlineHours / 48, 0, 1);

  const riskScore =
    contract.urgency * 0.35 +
    deadlinePressure * 0.25 +
    difficulty * 0.25 +
    product.perishability * 0.15;

  if (riskScore >= 0.6) {
    return { label: 'Yüksek risk', color: COLORS.danger };
  }
  if (riskScore >= 0.35) {
    return { label: 'Orta risk', color: COLORS.primary };
  }
  return { label: 'Düşük risk', color: COLORS.success };
}

function buildRiskReasons(
  contract: Contract,
  travelHours: number,
  profitMargin: number,
): string[] {
  const route = getRoute(contract.originCityId, contract.destinationCityId);
  const product = getProductById(contract.productId);
  const difficulty = route?.difficulty ?? 0.5;
  const reasons: string[] = [];

  if (travelHours > 0 && contract.deadlineHours <= travelHours * 1.25) {
    reasons.push('Sıkı teslim süresi');
  }
  if (contract.distanceKm >= LONG_ROUTE_KM) {
    reasons.push('Uzun rota');
  }
  if (difficulty >= 0.55) {
    reasons.push('Zorlu rota');
  }
  if (product.perishability >= 0.45) {
    reasons.push('Hassas yük');
  }
  if (profitMargin < 0.15) {
    reasons.push('Düşük kâr marjı');
  }

  return reasons;
}

interface ContractAnalysis {
  risk: RiskInfo;
  financials: ContractFinancials;
  suggestedTruck?: Truck;
  suggestedDriver?: Driver;
  route?: Route;
}

function analyzeContract(
  contract: Contract,
  globalEconomy: GlobalEconomy,
  trucks?: Truck[],
  drivers?: Driver[],
): ContractAnalysis {
  const suggestedTruck = trucks
    ? selectIdleTruckForContract(trucks, contract, getProductById(contract.productId))
    : undefined;
  const suggestedDriver = drivers ? findSuggestedDriver(drivers) : undefined;
  const route = getRoute(contract.originCityId, contract.destinationCityId);
  const travelHours = estimateContractTravelHours(contract, suggestedTruck, suggestedDriver);
  const baseRisk = calculateBaseRiskLabel(contract);
  const financials = estimateContractFinancials(
    contract,
    globalEconomy,
    baseRisk.label,
    suggestedTruck,
    suggestedDriver,
  );
  const reasons = buildRiskReasons(contract, travelHours, financials.profitMargin);
  const primaryReason =
    reasons[0] ?? (baseRisk.label === 'Düşük risk' ? 'Güvenli rota' : 'Orta baskı');

  return {
    risk: {
      label: baseRisk.label,
      color: baseRisk.color,
      reasons,
      primaryReason,
    },
    financials,
    suggestedTruck,
    suggestedDriver,
    route,
  };
}

function isUrgentContract(contract: Contract): boolean {
  if (contract.urgency >= URGENT_URGENCY_THRESHOLD) return true;

  const travelHours = estimateContractTravelHours(contract);
  if (travelHours > 0 && contract.deadlineHours <= travelHours * 1.25) {
    return true;
  }

  return contract.deadlineHours <= URGENT_FALLBACK_DEADLINE_HOURS;
}

function getEstimatedProfit(contract: Contract, globalEconomy: GlobalEconomy): number {
  return analyzeContract(contract, globalEconomy).financials.estimatedProfit;
}

function getTruckDetailText(
  availability: ReturnType<typeof getContractAvailability>,
  suggestedTruck?: Truck,
): string {
  if (availability.reason === 'NO_TRUCKS' || availability.reason === 'NO_IDLE_TRUCKS') {
    return 'Müsait kamyon yok';
  }
  if (availability.reason === 'CAPACITY_INSUFFICIENT') {
    return `Kapasite yetersiz (${(availability.requiredCapacity ?? 0).toFixed(1)}t / ${(availability.maxIdleTruckCapacity ?? 0).toFixed(1)}t)`;
  }
  if (!suggestedTruck) {
    return 'Uygun kamyon yok';
  }
  return `${suggestedTruck.name} · kapasite yeterli`;
}

function getDriverDetailText(availability: ReturnType<typeof getContractAvailability>, driver?: Driver): string {
  if (availability.reason === 'NO_DRIVERS' || availability.reason === 'NO_IDLE_DRIVERS') {
    return 'Müsait şoför yok';
  }
  return driver?.name ?? 'Müsait değil';
}

function getDeadlineRiskText(contract: Contract, travelHours: number): string {
  if (contract.deadlineHours < travelHours) return 'Teslim süresi yetersiz';
  if (contract.deadlineHours < travelHours * 1.25) return 'Sıkı teslim penceresi';
  return 'Teslim süresi yeterli';
}

function findSuggestedDriver(drivers: Driver[]): Driver | undefined {
  return (drivers ?? []).find((driver) => driver.status === 'idle');
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

interface ContractCardProps {
  contract: Contract;
  expanded: boolean;
  trucks: Truck[];
  drivers: Driver[];
  globalEconomy: GlobalEconomy;
  marketHighlight?: boolean;
  isPinnedMarketMatch?: boolean;
  onToggle: () => void;
  onAccept: () => void;
}

function ContractCard({
  contract,
  expanded,
  trucks,
  drivers,
  globalEconomy,
  marketHighlight = false,
  isPinnedMarketMatch = false,
  onToggle,
  onAccept,
}: ContractCardProps) {
  const analysis = analyzeContract(contract, globalEconomy, trucks, drivers);
  const availability = getContractAvailability(contract, trucks, drivers);
  const { risk, financials, suggestedTruck, suggestedDriver, route } = analysis;
  const cargoWeight = availability.requiredCapacity ?? getContractCargoWeight(contract);
  const capacityOk = availability.reason === 'OK';
  const deadlineRisk = getDeadlineRiskText(contract, financials.travelHours);
  const availabilityWarning = getContractAvailabilityWarningText(availability);

  const handleAcceptPress = () => {
    if (!availability.canStart) {
      Alert.alert(
        availability.title ?? availability.buttonLabel,
        availability.message ?? 'Bu iş şu anda başlatılamıyor.',
      );
      return;
    }
    onAccept();
  };

  const acceptButtonStyle = styles.acceptButton;
  const acceptButtonExpandedStyle = styles.acceptButtonExpanded;
  const acceptButtonTextStyle = styles.acceptButtonText;

  return (
    <View
      style={[
        styles.contractCard,
        expanded && styles.contractCardExpanded,
        marketHighlight && styles.contractCardMarketHighlight,
        isPinnedMarketMatch && styles.contractCardPinnedMarket,
      ]}
    >
      {isPinnedMarketMatch ? (
        <View style={styles.marketMatchBadge}>
          <Text style={styles.marketMatchBadgeText}>Piyasa fırsatıyla eşleşiyor</Text>
        </View>
      ) : null}
      <TouchableOpacity activeOpacity={0.9} onPress={onToggle}>
        <View style={styles.contractTopRow}>
          <Text style={styles.contractRoute} numberOfLines={1}>
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text style={styles.contractPayment}>{formatMoney(contract.payment)}</Text>
        </View>

        <Text style={styles.contractProduct}>
          {getProductName(contract.productId)} · {formatTons(cargoWeight)}
        </Text>

        <View style={styles.contractMetaRow}>
          <Text style={styles.contractMeta}>{formatDistance(contract.distanceKm)}</Text>
          <Text style={styles.contractMetaDot}>·</Text>
          <Text style={styles.contractMeta}>{formatHours(contract.deadlineHours)} kaldı</Text>
          <Text style={styles.contractMetaDot}>·</Text>
          <Text style={[styles.contractMeta, { color: risk.color }]}>{risk.label}</Text>
        </View>

        <View style={styles.financeRow}>
          <View style={styles.financeItem}>
            <Text style={styles.financeLabel}>
              Kâr:{' '}
              <Text
                style={[
                  styles.financeValue,
                  { color: financials.estimatedProfit >= 0 ? COLORS.success : COLORS.danger },
                ]}
              >
                {formatMoney(financials.estimatedProfit)}
              </Text>
            </Text>
          </View>
          <View style={[styles.financeItem, styles.financeItemRight]}>
            <Text style={styles.financeLabel}>
              Gider: <Text style={styles.financeValue}>{formatMoney(financials.totalExpense)}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.riskReasonRow}>
          <Text style={styles.riskReasonLabel}>Risk sebebi:</Text>
          <Text style={styles.riskReasonValue} numberOfLines={2}>
            {risk.primaryReason}
          </Text>
        </View>

        {availabilityWarning ? (
          <Text style={styles.capacityWarning}>{availabilityWarning}</Text>
        ) : null}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedArea}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Yük ağırlığı</Text>
            <Text style={styles.detailValue}>{formatTons(cargoWeight)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Uygun kamyon</Text>
            <Text
              style={[
                styles.detailValue,
                { color: capacityOk ? COLORS.success : COLORS.danger },
              ]}
            >
              {getTruckDetailText(availability, suggestedTruck)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Uygun şoför</Text>
            <Text style={styles.detailValue}>{getDriverDetailText(availability, suggestedDriver)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Tahmini süre</Text>
            <Text style={styles.detailValue}>{formatHours(financials.travelHours)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Teslim süresi</Text>
            <Text style={styles.detailValue}>{formatHours(contract.deadlineHours)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Yakıt gideri</Text>
            <Text style={styles.detailValue}>{formatMoney(financials.fuelCost)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Şoför gideri</Text>
            <Text style={styles.detailValue}>{formatMoney(financials.driverCost)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Bakım gideri</Text>
            <Text style={styles.detailValue}>{formatMoney(financials.maintenanceCost)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Risk payı</Text>
            <Text style={styles.detailValue}>{formatMoney(financials.riskReserve)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Net tahmini kâr</Text>
            <Text
              style={[
                styles.detailValue,
                { color: financials.estimatedProfit >= 0 ? COLORS.success : COLORS.danger },
              ]}
            >
              {formatMoney(financials.estimatedProfit)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Kâr marjı</Text>
            <Text style={styles.detailValue}>{formatPercent(financials.profitMargin)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Teslim süresi riski</Text>
            <Text style={styles.detailValue}>{deadlineRisk}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Rota zorluğu</Text>
            <Text style={styles.detailValue}>{formatPercent(route?.difficulty ?? 0.5)}</Text>
          </View>
          <TouchableOpacity
            style={acceptButtonExpandedStyle}
            onPress={handleAcceptPress}
            activeOpacity={0.85}
          >
            <Text style={acceptButtonTextStyle}>{availability.buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={acceptButtonStyle} onPress={handleAcceptPress} activeOpacity={0.85}>
        <Text style={acceptButtonTextStyle}>{availability.buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ContractsScreen() {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);

  const startDelivery = useGameStore((state) => state.startDelivery);
  const requestNavigationToFleet = useGameStore((state) => state.requestNavigationToFleet);
  const marketContractFilter = useGameStore((state) => state.marketContractFilter);
  const highlightedContractId = useGameStore((state) => state.highlightedContractId);
  const clearMarketContractFilter = useGameStore((state) => state.clearMarketContractFilter);
  const setHighlightedContractId = useGameStore((state) => state.setHighlightedContractId);
  const { scrollBottomPadding } = useTabBarLayout();

  const scrollRef = useRef<ScrollView>(null);

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [expandedContractId, setExpandedContractId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [assignmentContract, setAssignmentContract] = useState<Contract | null>(null);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const availableContracts = useMemo(
    () => dedupeAvailableContracts(contracts.filter((c) => c.status === 'available')),
    [contracts],
  );

  const activeContracts = useMemo(
    () => (contracts ?? []).filter((c) => c.status === 'active'),
    [contracts],
  );

  const topSummary = useMemo(() => {
    if (availableContracts.length === 0) {
      return {
        bestPayment: 0,
        shortestRoute: 0,
        urgentCount: 0,
      };
    }
    return {
      bestPayment: Math.max(...availableContracts.map((c) => c.payment)),
      shortestRoute: Math.min(...availableContracts.map((c) => c.distanceKm)),
      urgentCount: availableContracts.filter(isUrgentContract).length,
    };
  }, [availableContracts]);

  const filteredContracts = useMemo(() => {
    const list = [...availableContracts];

    const sortByFilter = (items: Contract[]) => {
      switch (activeFilter) {
        case 'bestPayment':
          return items.sort((a, b) => b.payment - a.payment);
        case 'shortDistance':
          return items.sort((a, b) => a.distanceKm - b.distanceKm);
        case 'urgent':
          return items
            .filter(isUrgentContract)
            .sort((a, b) => a.deadlineHours - b.deadlineHours || b.payment - a.payment);
        case 'lowRisk':
          return items
            .filter((c) => analyzeContract(c, globalEconomy).risk.label === 'Düşük risk')
            .sort(
              (a, b) =>
                getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy),
            );
        default:
          return items.sort(
            (a, b) =>
              getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy) ||
              b.payment - a.payment,
          );
      }
    };

    if (marketContractFilter?.source === 'market') {
      return list.sort((a, b) => {
        const tierA = getMarketContractMatchTier(a, marketContractFilter);
        const tierB = getMarketContractMatchTier(b, marketContractFilter);
        if (tierA !== tierB) return tierA - tierB;
        return getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy);
      });
    }

    return sortByFilter(list);
  }, [availableContracts, activeFilter, globalEconomy, marketContractFilter]);

  const marketMatchStats = useMemo(() => {
    if (!marketContractFilter || marketContractFilter.source !== 'market') {
      return { exact: 0, related: 0 };
    }

    let exact = 0;
    let related = 0;
    for (const contract of availableContracts) {
      const tier = getMarketContractMatchTier(contract, marketContractFilter);
      if (tier === 0) exact += 1;
      else if (tier < 99) related += 1;
    }

    if (__DEV__) {
      // TODO: remove verbose market-contract debug logs before release.
      console.log('Matching contracts count', { exact, related, total: availableContracts.length });
    }

    return { exact, related };
  }, [availableContracts, marketContractFilter]);

  useEffect(() => {
    if (!marketContractFilter || marketContractFilter.source !== 'market') {
      return;
    }

    if (__DEV__) {
      // TODO: remove verbose market-contract debug logs before release.
      console.log('Market filter active', marketContractFilter);
    }

    let exactCount = 0;
    let nearbyCount = 0;
    let firstExactId: string | null = null;

    for (const contract of availableContracts) {
      const tier = getMarketContractMatchTier(contract, marketContractFilter);
      if (tier === 0) {
        exactCount += 1;
        if (!firstExactId) {
          firstExactId = contract.id;
        }
      } else if (tier < 99) {
        nearbyCount += 1;
      }
    }

    if (__DEV__) {
      // TODO: remove verbose market-contract debug logs before release.
      console.log('Exact matching contracts', exactCount);
      console.log('Nearby matching contracts', nearbyCount);
    }

    if (firstExactId) {
      setHighlightedContractId(firstExactId);
      setExpandedContractId(firstExactId);
    } else {
      setHighlightedContractId(null);
    }

    scrollRef.current?.scrollTo({ y: 0, animated: true });

    const timer = setTimeout(() => {
      setHighlightedContractId(null);
    }, MARKET_HIGHLIGHT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [
    availableContracts,
    marketContractFilter,
    setHighlightedContractId,
  ]);

  if (!player) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const openAssignmentModal = (contract: Contract) => {
    setAssignmentContract(contract);
    setAssignmentModalVisible(true);
  };

  const closeAssignmentModal = () => {
    setAssignmentModalVisible(false);
    setAssignmentContract(null);
  };

  const handleConfirmAssignment = (truckId: string, driverId: string) => {
    if (!assignmentContract) return;

    const { fuelCost } = analyzeContract(
      assignmentContract,
      globalEconomy,
      player.trucks,
      player.drivers,
    ).financials;

    if (player.money < fuelCost) {
      Alert.alert('Nakit yetersiz', 'Bu teslimat için yeterli nakit bulunmuyor.');
      return;
    }

    const result = startDelivery(assignmentContract.id, truckId, driverId);
    if (!result.success) {
      Alert.alert('Teslimat başlatılamadı', result.message ?? 'Bilinmeyen hata');
      return;
    }

    closeAssignmentModal();
    setStatusMessage({ type: 'success', text: 'Teslimat başlatıldı' });
    setExpandedContractId(null);
  };

  const handleGoToFleet = (subTab?: 'trucks' | 'drivers' | 'shop') => {
    closeAssignmentModal();
    requestNavigationToFleet(subTab ?? 'shop');
  };

  const handleClearMarketFilter = () => {
    clearMarketContractFilter();
    setHighlightedContractId(null);
  };

  const toggleExpanded = (contractId: string) => {
    setExpandedContractId((current) => (current === contractId ? null : contractId));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Sözleşmeler</Text>
          <View style={styles.headerBadges}>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeValue}>{availableContracts.length}</Text>
              <Text style={styles.headerBadgeLabel}>Müsait</Text>
            </View>
            <View style={styles.headerBadge}>
              <Text style={[styles.headerBadgeValue, { color: COLORS.secondary }]}>
                {activeContracts.length}
              </Text>
              <Text style={styles.headerBadgeLabel}>Aktif</Text>
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

        {marketContractFilter?.source === 'market' ? (
          <View style={styles.marketFilterCard}>
            <View style={styles.marketFilterHeaderRow}>
              <View style={styles.marketFilterTextWrap}>
                <Text style={styles.marketFilterTitle}>Piyasa fırsatına göre gösteriliyor</Text>
                <Text style={styles.marketFilterSubtitle}>
                  {marketContractFilter.fromCityName} → {marketContractFilter.toCityName} ·{' '}
                  {marketContractFilter.productName}
                </Text>
                <Text style={styles.marketFilterHint}>
                  Piyasa sayfasındaki fiyat farkına göre ilgili işler üstte listelendi.
                </Text>
              </View>
              <TouchableOpacity onPress={handleClearMarketFilter} activeOpacity={0.85}>
                <Text style={styles.marketFilterClear}>Filtreyi Temizle</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {marketContractFilter?.source === 'market' &&
        marketMatchStats.exact === 0 &&
        marketMatchStats.related === 0 ? (
          <View style={styles.marketNoMatchCard}>
            <Text style={styles.marketNoMatchTitle}>
              Bu fırsata uygun aktif sözleşme şu anda yok.
            </Text>
            <Text style={styles.marketNoMatchSubtitle}>
              Piyasa güncellendikçe bu rota için yeni sözleşmeler oluşabilir.
            </Text>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{availableContracts.length}</Text>
            <Text style={styles.summaryLabel}>Müsait</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.success }]}>
              {formatMoney(topSummary.bestPayment)}
            </Text>
            <Text style={styles.summaryLabel}>En yüksek ödeme</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{formatDistance(topSummary.shortestRoute)}</Text>
            <Text style={styles.summaryLabel}>Kısa rota</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.primary }]}>
              {topSummary.urgentCount}
            </Text>
            <Text style={styles.summaryLabel}>Acil</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {FILTERS.map((filter) => (
            <FilterChip
              key={filter.key}
              label={filter.label}
              active={activeFilter === filter.key}
              onPress={() => setActiveFilter(filter.key)}
            />
          ))}
        </ScrollView>

        {availableContracts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📄</Text>
            <Text style={styles.emptyTitle}>Müsait sözleşme yok</Text>
            <Text style={styles.emptySubtitle}>
              Şu anda uygun sözleşme yok. Piyasa yeni fırsatlar oluşturdukça burada görünecek.
            </Text>
          </View>
        ) : filteredContracts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>Eşleşme yok</Text>
            <Text style={styles.emptySubtitle}>Başka bir filtre deneyerek iş arayın.</Text>
          </View>
        ) : (
          filteredContracts.map((contract) => {
            const matchTier =
              marketContractFilter?.source === 'market'
                ? getMarketContractMatchTier(contract, marketContractFilter)
                : 99;

            return (
              <ContractCard
                key={contract.id}
                contract={contract}
                expanded={expandedContractId === contract.id}
                trucks={player.trucks}
                drivers={player.drivers}
                globalEconomy={globalEconomy}
                marketHighlight={matchTier > 0 && matchTier < 99}
                isPinnedMarketMatch={highlightedContractId === contract.id}
                onToggle={() => toggleExpanded(contract.id)}
                onAccept={() => openAssignmentModal(contract)}
              />
            );
          })
        )}
      </ScrollView>

      <ContractAssignmentModal
        visible={assignmentModalVisible}
        contract={assignmentContract}
        trucks={player.trucks}
        drivers={player.drivers}
        onClose={closeAssignmentModal}
        onConfirm={handleConfirmAssignment}
        onGoToFleet={handleGoToFleet}
      />
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
    gap: 8,
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
    fontSize: 13,
    fontWeight: '800',
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 3,
  },

  filterScroll: {
    marginBottom: 14,
    flexGrow: 0,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: UI.spacing.screen,
  },
  filterChip: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexShrink: 0,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#0B1220',
  },

  contractCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 13,
  },
  contractCardExpanded: {
    borderColor: COLORS.primary,
  },
  contractCardMarketHighlight: {
    borderColor: COLORS.secondary,
    borderWidth: 1.5,
  },
  contractCardPinnedMarket: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  marketMatchBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  marketMatchBadgeText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  contractTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  contractRoute: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    marginRight: 10,
  },
  contractProduct: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: 6,
  },
  contractMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 8,
  },
  contractMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  contractMetaDot: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginHorizontal: 5,
  },
  contractPayment: {
    color: COLORS.success,
    fontSize: 20,
    fontWeight: '800',
  },
  financeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 12,
  },
  financeItem: {
    flex: 1,
  },
  financeItemRight: {
    alignItems: 'flex-end',
  },
  financeLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  financeValue: {
    color: COLORS.textPrimary,
    fontWeight: '800',
  },
  riskReasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  riskReasonLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  riskReasonValue: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
    flexGrow: 1,
  },

  expandedArea: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  detailLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  detailValue: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },

  acceptButton: {
    backgroundColor: COLORS.primary,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  acceptButtonExpanded: {
    backgroundColor: COLORS.primary,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  acceptButtonText: {
    color: '#0B1220',
    fontSize: 14,
    fontWeight: '800',
  },
  acceptButtonBlocked: {
    backgroundColor: '#1C1917',
    borderWidth: 1,
    borderColor: '#EA580C',
  },
  acceptButtonTextBlocked: {
    color: '#FB923C',
  },
  capacityWarning: {
    marginTop: 8,
    color: '#FB923C',
    fontSize: 11,
    fontWeight: '700',
  },
  capacityHint: {
    marginTop: 4,
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },

  marketFilterCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.secondary,
    padding: 12,
    marginBottom: 12,
  },
  marketFilterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  marketFilterTextWrap: {
    flex: 1,
  },
  marketFilterTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  marketFilterSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  marketFilterHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  marketFilterClear: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  marketNoMatchCard: {
    backgroundColor: '#1C1410',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7C2D12',
    padding: 12,
    marginBottom: 12,
  },
  marketNoMatchTitle: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  marketNoMatchSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  marketNoMatchActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  marketNoMatchButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  marketNoMatchButtonText: {
    color: '#0B1220',
    fontSize: 12,
    fontWeight: '800',
  },
  marketNoMatchButtonSecondary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  marketNoMatchButtonSecondaryText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },

  emptyState: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 28,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
  },
  emptyButtonText: {
    color: '#0B1220',
    fontSize: 13,
    fontWeight: '800',
  },
});
