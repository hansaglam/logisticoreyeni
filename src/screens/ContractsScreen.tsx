/**
 * LogistiCore - İşler / Sözleşmeler Ekranı
 *
 * Piyasadaki taşıma sözleşmelerini premium dark UI ile yönetme ekranı.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ScrollView as ScrollViewType,
} from 'react-native';

import ContractAssignmentModal from '../components/ContractAssignmentModal';
import {
  AppScreen,
  EmptyState,
  GameIcon,
  IconButton,
  ProgressBar,
  ProductIcon,
} from '../components/ui';
import { deliveryBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { getRoute as findRoute } from '../data/routes';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { dedupeAvailableContracts, getContractFilterSortTier } from '../simulation/contracts';
import {
  calculateTravelHours,
  getContractAvailability,
  getContractCargoWeight,
  selectIdleTruckForContract,
} from '../simulation/delivery';
import { useGameStore } from '../store/gameStore';
import { colors, spacing } from '../theme';
import { STATUS_BAR_HEIGHT } from '../theme/ui';
import type {
  Contract,
  ContractAvailability,
  Delivery,
  Driver,
  GlobalEconomy,
  MarketContractFilter,
  Product,
  ProductId,
  Route,
  Truck,
} from '../types/game';

const FALLBACK_FUEL_RATE_PER_KM = deliveryBalance.fuelCostEstimateMultiplier;
const FALLBACK_AVERAGE_SPEED_KMH = deliveryBalance.defaultAverageSpeed;
const FALLBACK_DRIVER_SALARY_PER_DAY = deliveryBalance.fallbackDriverSalaryPerDay;
const URGENT_URGENCY_THRESHOLD = 0.75;
const URGENT_DEADLINE_SLACK = 0.95;
const LONG_ROUTE_KM = 350;
const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const MARKET_HIGHLIGHT_TIMEOUT_MS = 8000;
const DAY_HOURS = 24;
const LIST_FILTER: FilterKey = 'bestPayment';
const LIST_SCROLL_BOTTOM_EXTRA = 110;

const COLORS = {
  background: colors.background,
  card: colors.card,
  border: colors.borderStrong,
  cyan: colors.info,
  green: colors.success,
  red: colors.danger,
  muted: colors.textMuted,
  text: colors.textPrimary,
  textSecondary: colors.textSecondary,
};

type FilterKey = 'all' | 'bestPayment' | 'shortDistance' | 'urgent' | 'lowRisk';
type SegmentKey = 'available' | 'active' | 'completed';

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
  const days = Math.floor(totalHours / DAY_HOURS);
  const remainingHours = totalHours % DAY_HOURS;
  if (days > 0) return `${days}g ${remainingHours}s`;
  return `${remainingHours}s`;
}

function formatDistance(km: number): string {
  return `${Math.round(km)} km`;
}

function formatTonsCompact(amount: number): string {
  return `${amount.toFixed(1)} t`;
}

function formatTimeLeft(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function getActionPillLabel(availability: ContractAvailability): string {
  switch (availability.reason) {
    case 'LEVEL_INSUFFICIENT':
      return 'Seviye Yetersiz';
    case 'NO_TRUCKS':
    case 'NO_IDLE_TRUCKS':
      return 'Kamyon Yok';
    case 'NO_DRIVERS':
    case 'NO_IDLE_DRIVERS':
      return 'Şoför Yok';
    case 'CAPACITY_INSUFFICIENT':
      return 'Kapasite Yetersiz';
    case 'TRUCK_CONDITION_TOO_LOW':
      return 'Tamir Gerekli';
    default:
      return 'Ekibi Seç';
  }
}

function formatRiskDisplayLabel(label: string): string {
  if (label === 'Yüksek risk') return 'Yüksek Risk';
  if (label === 'Orta risk') return 'Orta Risk';
  return 'Düşük Risk';
}

function getRiskOutlineStyle(
  label: string,
  soft = false,
): { backgroundColor: string; borderColor: string; color: string } {
  if (label === 'Yüksek risk') {
    return {
      backgroundColor: COLORS.card,
      borderColor: soft ? 'rgba(248, 113, 113, 0.45)' : COLORS.red,
      color: soft ? 'rgba(248, 113, 113, 0.85)' : COLORS.red,
    };
  }
  if (label === 'Orta risk') {
    return {
      backgroundColor: COLORS.card,
      borderColor: colors.accentAmber,
      color: colors.accentAmber,
    };
  }
  return {
    backgroundColor: COLORS.card,
    borderColor: colors.success,
    color: colors.success,
  };
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
    return { label: 'Yüksek risk', color: colors.danger };
  }
  if (riskScore >= 0.35) {
    return { label: 'Orta risk', color: colors.accentAmber };
  }
  return { label: 'Düşük risk', color: colors.success };
}

function getRiskBadgeVariant(label: string): 'danger' | 'warning' | 'success' {
  if (label === 'Yüksek risk') return 'danger';
  if (label === 'Orta risk') return 'warning';
  return 'success';
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
  if (contract.urgency >= URGENT_URGENCY_THRESHOLD) {
    return true;
  }

  const travelHours = estimateContractTravelHours(contract);
  if (travelHours <= 0) {
    return false;
  }

  // Yalnızca teslim süresi, tahmini yol süresinden belirgin şekilde kısaysa acil say
  return contract.deadlineHours < travelHours * URGENT_DEADLINE_SLACK;
}

function getEstimatedProfit(contract: Contract, globalEconomy: GlobalEconomy): number {
  return analyzeContract(contract, globalEconomy).financials.estimatedProfit;
}

function isRouteContractFilter(
  filter: MarketContractFilter | null | undefined,
): filter is MarketContractFilter {
  return filter?.source === 'market' || filter?.source === 'map';
}

function getContractSortPriority(
  contract: Contract,
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  marketFilter?: MarketContractFilter | null,
): number {
  if (marketFilter?.contractId && contract.id === marketFilter.contractId) {
    return -1000;
  }

  const availability = getContractAvailability(contract, trucks, drivers, playerLevel);
  let priority = 0;

  if (isRouteContractFilter(marketFilter)) {
    const tier = getContractFilterSortTier(contract, marketFilter);
    priority += tier * 20;
  }

  if (availability.canStart) {
    return priority;
  }
  if (availability.reason === 'LEVEL_INSUFFICIENT') {
    return priority + 100;
  }
  if (availability.reason === 'NO_TRUCKS' || availability.reason === 'NO_IDLE_TRUCKS') {
    return priority + 110;
  }
  if (availability.reason === 'NO_DRIVERS' || availability.reason === 'NO_IDLE_DRIVERS') {
    return priority + 120;
  }
  if (availability.reason === 'CAPACITY_INSUFFICIENT') {
    return priority + 130;
  }
  return priority + 140;
}

function sortContractsForDisplay(
  items: Contract[],
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  globalEconomy: GlobalEconomy,
  activeFilter: FilterKey,
  marketFilter?: MarketContractFilter | null,
): Contract[] {
  const list = [...items];

  if (activeFilter === 'shortDistance') {
    return list.sort((a, b) => {
      const priorityDiff =
        getContractSortPriority(a, trucks, drivers, playerLevel, marketFilter) -
        getContractSortPriority(b, trucks, drivers, playerLevel, marketFilter);
      if (priorityDiff !== 0) return priorityDiff;
      return a.distanceKm - b.distanceKm;
    });
  }

  if (activeFilter === 'urgent') {
    return list
      .filter(isUrgentContract)
      .sort((a, b) => {
        const priorityDiff =
          getContractSortPriority(a, trucks, drivers, playerLevel, marketFilter) -
          getContractSortPriority(b, trucks, drivers, playerLevel, marketFilter);
        if (priorityDiff !== 0) return priorityDiff;
        return a.deadlineHours - b.deadlineHours || b.payment - a.payment;
      });
  }

  if (activeFilter === 'lowRisk') {
    return list
      .filter((c) => analyzeContract(c, globalEconomy).risk.label === 'Düşük risk')
      .sort((a, b) => {
        const priorityDiff =
          getContractSortPriority(a, trucks, drivers, playerLevel, marketFilter) -
          getContractSortPriority(b, trucks, drivers, playerLevel, marketFilter);
        if (priorityDiff !== 0) return priorityDiff;
        return getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy);
      });
  }

  return list.sort((a, b) => {
    const priorityDiff =
      getContractSortPriority(a, trucks, drivers, playerLevel, marketFilter) -
      getContractSortPriority(b, trucks, drivers, playerLevel, marketFilter);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (activeFilter === 'bestPayment' || activeFilter === 'all') {
      return b.payment - a.payment || getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy);
    }
    return getEstimatedProfit(b, globalEconomy) - getEstimatedProfit(a, globalEconomy) || b.payment - a.payment;
  });
}

function findSuggestedDriver(drivers: Driver[]): Driver | undefined {
  return (drivers ?? []).find((driver) => driver.status === 'idle');
}

function getDeliveryStatusVariant(status: Delivery['status']): 'blue' | 'amber' | 'success' | 'danger' {
  switch (status) {
    case 'on_route':
      return 'blue';
    case 'preparing':
      return 'amber';
    case 'completed':
      return 'success';
    default:
      return 'danger';
  }
}

function getDeliveryStatusLabel(status: Delivery['status']): string {
  switch (status) {
    case 'on_route':
      return 'Yolda';
    case 'preparing':
      return 'Hazırlanıyor';
    case 'completed':
      return 'Tamamlandı';
    default:
      return 'Başarısız';
  }
}

function findDeliveryForContract(contractId: string, deliveries: Delivery[]): Delivery | undefined {
  return deliveries.find((delivery) => delivery.contractId === contractId);
}

interface TabSegment {
  key: SegmentKey;
  label: string;
  count: number;
}

interface ContractsTabBarProps {
  segments: TabSegment[];
  activeKey: SegmentKey;
  onChange: (key: SegmentKey) => void;
}

function ContractsTabBar({ segments, activeKey, onChange }: ContractsTabBarProps) {
  return (
    <View style={styles.tabBar}>
      {segments.map((segment, index) => {
        const isActive = segment.key === activeKey;
        return (
          <React.Fragment key={segment.key}>
            {index > 0 ? <View style={styles.tabDivider} /> : null}
            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => onChange(segment.key)}
              activeOpacity={0.85}
            >
              <View style={styles.tabLabelRow}>
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {segment.label}
                </Text>
                {segment.count > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {segment.count > 99 ? '99+' : segment.count}
                    </Text>
                  </View>
                ) : null}
              </View>
              {isActive ? <View style={styles.tabUnderline} /> : null}
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </View>
  );
}

interface CompactStatRowProps {
  availableCount: number;
  activeCount: number;
  bestPayment: number;
}

function CompactStatRow({ availableCount, activeCount, bestPayment }: CompactStatRowProps) {
  return (
    <View style={styles.compactStatRow}>
      <Text style={styles.compactStatText}>
        Müsait{' '}
        <Text style={styles.statValueInfo}>{availableCount}</Text>
        {' · '}Aktif{' '}
        <Text style={styles.statValueAmber}>{activeCount}</Text>
        {' · '}En yüksek{' '}
        <Text style={styles.statValueSuccess}>{formatMoney(bestPayment)}</Text>
      </Text>
    </View>
  );
}

interface ContractCardProps {
  contract: Contract;
  trucks: Truck[];
  drivers: Driver[];
  playerLevel: number;
  globalEconomy: GlobalEconomy;
  isPinnedMarketMatch?: boolean;
  onPress: () => void;
}

function ContractCard({
  contract,
  trucks,
  drivers,
  playerLevel,
  globalEconomy,
  isPinnedMarketMatch = false,
  onPress,
}: ContractCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const availability = getContractAvailability(contract, trucks, drivers, safePlayerLevel);
  const cargoWeight = availability.requiredCapacity ?? getContractCargoWeight(contract);
  const analysis = analyzeContract(contract, globalEconomy, trucks, drivers);
  const { financials, risk } = analysis;
  const urgent = isUrgentContract(contract);
  const pillLabel = getActionPillLabel(availability);
  const riskSoft = urgent && risk.label === 'Yüksek risk';
  const riskOutline = getRiskOutlineStyle(risk.label, riskSoft);

  const handlePress = () => {
    if (!availability.canStart) {
      Alert.alert(
        availability.title ?? availability.buttonLabel,
        availability.message ?? 'Bu iş şu anda başlatılamıyor.',
      );
      return;
    }
    onPress();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={handlePress}
      style={[
        styles.listCard,
        isPinnedMarketMatch && styles.listCardHighlight,
      ]}
    >
      {isPinnedMarketMatch ? (
        <View style={styles.marketOpportunityTag}>
          <Text style={styles.marketOpportunityTagText}>Piyasa fırsatı</Text>
        </View>
      ) : null}

      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <ProductIcon productId={contract.productId} size={22} color={COLORS.cyan} />
        </View>

        <View style={styles.cardCenter}>
          <Text style={styles.cardRoute} numberOfLines={1}>
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text style={styles.cardProduct} numberOfLines={1}>
            {getProductName(contract.productId)}
          </Text>
          <Text style={styles.cardMetaLine} numberOfLines={1}>
            Yük {formatTonsCompact(cargoWeight)} · Kalan {formatTimeLeft(contract.deadlineHours)}
          </Text>
        </View>

        <View style={styles.cardRight}>
          <Text style={styles.cardPayment}>{formatMoney(contract.payment)}</Text>
          <Text
            style={[
              styles.cardProfit,
              { color: financials.estimatedProfit >= 0 ? COLORS.green : COLORS.red },
            ]}
          >
            Kâr {formatMoney(financials.estimatedProfit)}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.cardFinanceLine} numberOfLines={1}>
          Gider {formatMoney(financials.totalExpense)} · Marj {formatPercent(financials.profitMargin)}
        </Text>
        <View style={styles.cardFooterActions}>
          <View style={styles.cardFooterBadges}>
            {urgent ? (
              <View style={[styles.miniBadge, styles.urgentBadge]}>
                <GameIcon name="urgent" size={9} color={COLORS.red} />
                <Text style={styles.urgentBadgeText}>Acil</Text>
              </View>
            ) : null}
            <View
              style={[
                styles.miniBadge,
                riskSoft && styles.miniBadgeSoft,
                {
                  backgroundColor: riskOutline.backgroundColor,
                  borderColor: riskOutline.borderColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.miniBadgeText,
                  riskSoft && styles.miniBadgeTextSoft,
                  { color: riskOutline.color },
                ]}
              >
                {formatRiskDisplayLabel(risk.label)}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.actionPill,
              availability.canStart ? styles.actionPillReady : styles.actionPillBlocked,
            ]}
          >
            <Text
              style={[
                styles.actionPillText,
                availability.canStart ? styles.actionPillTextReady : styles.actionPillTextBlocked,
              ]}
            >
              {pillLabel}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface ActiveDeliveryCardProps {
  delivery: Delivery;
  trucks: Truck[];
  drivers: Driver[];
  currentTime: number;
}

function ActiveDeliveryCard({ delivery, trucks, drivers, currentTime }: ActiveDeliveryCardProps) {
  const hoursLeft = Math.max(0, delivery.deadlineTime - currentTime);
  const truck = (trucks ?? []).find((item) => item.id === delivery.truckId);
  const driver = (drivers ?? []).find((item) => item.id === delivery.driverId);

  return (
    <View style={styles.listCard}>
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <ProductIcon productId={delivery.productId} size={22} color={COLORS.cyan} />
        </View>
        <View style={styles.cardCenter}>
          <Text style={styles.cardRoute} numberOfLines={1}>
            {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
          </Text>
          <Text style={styles.cardProduct} numberOfLines={1}>
            {getProductName(delivery.productId)}
          </Text>
          <Text style={styles.cardMetaLine} numberOfLines={1}>
            {truck?.name ?? 'Kamyon'} · {driver?.name ?? 'Şoför'}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPayment}>{formatMoney(delivery.estimatedProfit)}</Text>
          <View style={styles.cardMetricTimeRow}>
            <GameIcon name="time" size={11} color={COLORS.muted} />
            <Text style={styles.cardMetaValue}>{formatTimeLeft(hoursLeft)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.activeProgressRow}>
        <ProgressBar progress={delivery.progress} color={COLORS.cyan} height={3} />
        <Text style={styles.activeProgressText}>{formatPercent(delivery.progress)}</Text>
      </View>
    </View>
  );
}

interface CompletedContractCardProps {
  contract: Contract;
  globalEconomy: GlobalEconomy;
  netProfit?: number;
}

function CompletedContractCard({ contract, globalEconomy, netProfit }: CompletedContractCardProps) {
  const profit =
    netProfit ??
    analyzeContract(contract, globalEconomy).financials.estimatedProfit;

  return (
    <View style={styles.listCard}>
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <ProductIcon productId={contract.productId} size={22} color={COLORS.green} />
        </View>
        <View style={styles.cardCenter}>
          <Text style={styles.cardRoute} numberOfLines={1}>
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text style={styles.cardProduct} numberOfLines={1}>
            {getProductName(contract.productId)}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPayment}>{formatMoney(contract.payment)}</Text>
          <Text style={[styles.cardProfit, { color: COLORS.green }]}>
            Kâr {formatMoney(profit)}
          </Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={[styles.miniBadge, styles.completedBadge]}>
          <GameIcon name="success" size={10} color={COLORS.green} />
          <Text style={[styles.miniBadgeText, { color: COLORS.green }]}>Tamamlandı</Text>
        </View>
      </View>
    </View>
  );
}

export default function ContractsScreen() {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);

  const startDelivery = useGameStore((state) => state.startDelivery);
  const requestNavigationToFleet = useGameStore((state) => state.requestNavigationToFleet);
  const marketContractFilter = useGameStore((state) => state.marketContractFilter);
  const highlightedContractId = useGameStore((state) => state.highlightedContractId);
  const clearMarketContractFilter = useGameStore((state) => state.clearMarketContractFilter);
  const setHighlightedContractId = useGameStore((state) => state.setHighlightedContractId);
  const refreshMarketSnapshot = useGameStore((state) => state.refreshMarketSnapshot);
  const { tabBarHeight, bottomInset } = useTabBarLayout();
  const listScrollBottomPadding = tabBarHeight + bottomInset + LIST_SCROLL_BOTTOM_EXTRA;

  const scrollRef = useRef<ScrollViewType>(null);

  const [activeSegment, setActiveSegment] = useState<SegmentKey>('available');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [assignmentContract, setAssignmentContract] = useState<Contract | null>(null);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];

  const availableContracts = useMemo(
    () => dedupeAvailableContracts(contracts.filter((c) => c.status === 'available')),
    [contracts],
  );

  const runningDeliveries = useMemo(
    () => activeDeliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing'),
    [activeDeliveries],
  );

  const completedContracts = useMemo(
    () => contracts.filter((c) => c.status === 'completed'),
    [contracts],
  );

  const topSummary = useMemo(() => {
    if (availableContracts.length === 0) {
      return { bestPayment: 0 };
    }
    return {
      bestPayment: Math.max(...availableContracts.map((c) => c.payment)),
    };
  }, [availableContracts]);

  const filteredContracts = useMemo(() => {
    if (!globalEconomy) return [];
    return sortContractsForDisplay(
      availableContracts,
      trucks,
      drivers,
      playerLevel,
      globalEconomy,
      LIST_FILTER,
      marketContractFilter,
    );
  }, [
    availableContracts,
    trucks,
    drivers,
    playerLevel,
    globalEconomy,
    marketContractFilter,
  ]);

  const tabSegments = useMemo<TabSegment[]>(
    () => [
      { key: 'available', label: 'Müsait', count: availableContracts.length },
      { key: 'active', label: 'Aktif', count: runningDeliveries.length },
      { key: 'completed', label: 'Tamamlanan', count: completedContracts.length },
    ],
    [availableContracts.length, runningDeliveries.length, completedContracts.length],
  );

  const marketMatchStats = useMemo(() => {
    if (!isRouteContractFilter(marketContractFilter)) {
      return { exact: 0, related: 0 };
    }

    let exact = 0;
    let related = 0;
    for (const contract of availableContracts) {
      const tier = getContractFilterSortTier(contract, marketContractFilter);
      if (tier === -1 || tier === 0) exact += 1;
      else if (tier < 99) related += 1;
    }

    return { exact, related };
  }, [availableContracts, marketContractFilter]);

  useEffect(() => {
    if (!isRouteContractFilter(marketContractFilter)) {
      return;
    }

    let firstExactId: string | null = null;
    const pinnedContractId = marketContractFilter.contractId ?? null;

    for (const contract of availableContracts) {
      const tier = getContractFilterSortTier(contract, marketContractFilter);
      if (tier === -1 || tier === 0) {
        if (!firstExactId) {
          firstExactId = contract.id;
        }
      }
    }

    const highlightId =
      pinnedContractId &&
      availableContracts.some((contract) => contract.id === pinnedContractId)
        ? pinnedContractId
        : firstExactId;

    if (highlightId) {
      setHighlightedContractId(highlightId);
      setActiveSegment('available');
    } else {
      setHighlightedContractId(null);
    }

    scrollRef.current?.scrollTo({ y: 0, animated: true });

    const timer = setTimeout(() => {
      setHighlightedContractId(null);
    }, MARKET_HIGHLIGHT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [availableContracts, marketContractFilter, setHighlightedContractId]);

  if (!player || !globalEconomy) {
    return (
      <AppScreen scroll>
        <EmptyState title="Oyun başlatılıyor..." icon="contract" />
      </AppScreen>
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
    setActiveSegment('active');
  };

  const handleGoToFleet = (subTab?: 'trucks' | 'drivers' | 'shop') => {
    closeAssignmentModal();
    requestNavigationToFleet(subTab ?? 'shop');
  };

  const handleClearMarketFilter = () => {
    clearMarketContractFilter();
    setHighlightedContractId(null);
  };

  const handleRefresh = () => {
    refreshMarketSnapshot();
    setStatusMessage({ type: 'success', text: 'Piyasa güncellendi' });
  };

  const marketFilterLine = isRouteContractFilter(marketContractFilter)
    ? `${marketContractFilter.fromCityName} → ${marketContractFilter.toCityName} · ${marketContractFilter.productName}`
    : '';

  return (
    <View style={[styles.screenRoot, { paddingBottom: tabBarHeight }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => {}} activeOpacity={0.8}>
            <Text style={styles.headerIconText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Sözleşmeler</Text>
          <IconButton
            icon="refresh"
            onPress={handleRefresh}
            size={16}
            color={COLORS.cyan}
            backgroundColor={COLORS.card}
            style={styles.headerIconButton}
          />
        </View>

        {statusMessage ? (
          <View
            style={[
              styles.statusBanner,
              {
                borderColor: statusMessage.type === 'success' ? COLORS.green : COLORS.red,
                backgroundColor:
                  statusMessage.type === 'success' ? colors.successSoft : colors.dangerSoft,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBannerText,
                { color: statusMessage.type === 'success' ? COLORS.green : COLORS.red },
              ]}
            >
              {statusMessage.text}
            </Text>
          </View>
        ) : null}

        <CompactStatRow
          availableCount={availableContracts.length}
          activeCount={runningDeliveries.length}
          bestPayment={topSummary.bestPayment}
        />

        <ContractsTabBar
          segments={tabSegments}
          activeKey={activeSegment}
          onChange={setActiveSegment}
        />

        <ScrollView
          ref={scrollRef}
          style={styles.listScroll}
          contentContainerStyle={[
            styles.listScrollContent,
            { paddingBottom: listScrollBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {activeSegment === 'available' ? (
            <>
              {isRouteContractFilter(marketContractFilter) ? (
                <View style={styles.marketFilterCompact}>
                  <Text style={styles.marketFilterLine} numberOfLines={1}>
                    Piyasa fırsatı · {marketFilterLine}
                  </Text>
                  <TouchableOpacity onPress={handleClearMarketFilter} activeOpacity={0.85}>
                    <Text style={styles.marketFilterClear}>Temizle</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {isRouteContractFilter(marketContractFilter) &&
              marketMatchStats.exact === 0 &&
              marketMatchStats.related === 0 ? (
                <View style={styles.marketNoMatchCompact}>
                  <Text style={styles.marketNoMatchText}>
                    Bu fırsata uygun aktif sözleşme şu anda yok.
                  </Text>
                </View>
              ) : null}

              {availableContracts.length === 0 ? (
                <EmptyState
                  title="Şu anda uygun sözleşme yok"
                  message="Piyasa yeni fırsatlar oluşturdukça burada görünecek."
                  icon="contract"
                />
              ) : (
                filteredContracts.map((contract) => (
                  <ContractCard
                    key={contract.id}
                    contract={contract}
                    trucks={player.trucks ?? []}
                    drivers={player.drivers ?? []}
                    playerLevel={player.level ?? player.companyLevel ?? 1}
                    globalEconomy={globalEconomy}
                    isPinnedMarketMatch={highlightedContractId === contract.id}
                    onPress={() => openAssignmentModal(contract)}
                  />
                ))
              )}
            </>
          ) : null}

          {activeSegment === 'active' ? (
            runningDeliveries.length === 0 ? (
              <EmptyState
                title="Şu anda aktif teslimat yok."
                message="Yeni bir sözleşme başlattığında rotalar burada görünecek."
                icon="truck"
              />
            ) : (
              runningDeliveries.map((delivery) => (
                <ActiveDeliveryCard
                  key={delivery.id}
                  delivery={delivery}
                  trucks={player.trucks ?? []}
                  drivers={player.drivers ?? []}
                  currentTime={currentTime}
                />
              ))
            )
          ) : null}

          {activeSegment === 'completed' ? (
            completedContracts.length === 0 ? (
              <EmptyState
                title="Henüz tamamlanan sözleşme yok."
                message="Tamamlanan işler burada listelenecek."
                icon="success"
              />
            ) : (
              completedContracts.map((contract) => {
                const linkedDelivery = findDeliveryForContract(contract.id, activeDeliveries);
                return (
                  <CompletedContractCard
                    key={contract.id}
                    contract={contract}
                    globalEconomy={globalEconomy}
                    netProfit={linkedDelivery?.estimatedProfit}
                  />
                );
              })
            )
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <ContractAssignmentModal
        visible={assignmentModalVisible}
        contract={assignmentContract}
        trucks={player.trucks ?? []}
        drivers={player.drivers ?? []}
        playerLevel={player.level ?? player.companyLevel ?? 1}
        onClose={closeAssignmentModal}
        onConfirm={handleConfirmAssignment}
        onGoToFleet={handleGoToFleet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: STATUS_BAR_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    paddingTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
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
  headerTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  statusBanner: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  compactStatRow: {
    marginBottom: spacing.sm,
    minHeight: 30,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  compactStatText: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '600',
    textAlign: 'center',
  },
  statValueInfo: {
    color: COLORS.cyan,
    fontWeight: '800',
  },
  statValueAmber: {
    color: colors.accentAmber,
    fontWeight: '800',
  },
  statValueSuccess: {
    color: COLORS.green,
    fontWeight: '800',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  tabDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.muted,
  },
  tabLabelActive: {
    color: COLORS.cyan,
    fontWeight: '800',
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.text,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: spacing.sm,
    right: spacing.sm,
    height: 2,
    backgroundColor: COLORS.cyan,
    borderRadius: 1,
  },
  marketFilterCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  marketFilterLine: {
    flex: 1,
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  marketFilterClear: {
    fontSize: 11,
    color: colors.accentAmber,
    fontWeight: '800',
  },
  marketNoMatchCompact: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  marketNoMatchText: {
    fontSize: 11,
    color: colors.accentAmber,
    fontWeight: '700',
  },
  listCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  listCardHighlight: {
    borderColor: colors.accentAmber,
    borderLeftWidth: 3,
    backgroundColor: colors.accentAmberSoft,
  },
  marketOpportunityTag: {
    alignSelf: 'flex-start',
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: colors.accentAmber,
  },
  marketOpportunityTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCenter: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  cardRoute: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 2,
  },
  cardProduct: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 2,
  },
  cardMetaLine: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  cardRight: {
    alignItems: 'flex-end',
    minWidth: 92,
    maxWidth: 112,
    paddingTop: 1,
  },
  cardPayment: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.green,
    marginBottom: 3,
  },
  cardProfit: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.green,
  },
  cardMetaValue: {
    fontSize: 10,
    color: COLORS.text,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 8,
  },
  cardFinanceLine: {
    flex: 1,
    flexShrink: 1,
    fontSize: 10,
    color: COLORS.muted,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
  cardFooterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  cardFooterBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 21,
    paddingHorizontal: 7,
    borderRadius: 11,
    borderWidth: 1,
  },
  miniBadgeSoft: {
    height: 20,
    paddingHorizontal: 6,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  miniBadgeTextSoft: {
    fontSize: 9,
    fontWeight: '600',
  },
  urgentBadge: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.red,
    height: 22,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.red,
  },
  completedBadge: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  actionPill: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillReady: {
    backgroundColor: colors.infoSoft,
    borderColor: COLORS.cyan,
  },
  actionPillBlocked: {
    backgroundColor: colors.cardSoft,
    borderColor: COLORS.border,
  },
  actionPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  actionPillTextReady: {
    color: COLORS.cyan,
  },
  actionPillTextBlocked: {
    color: COLORS.muted,
  },
  cardMetricTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  activeProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  activeProgressText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.muted,
    minWidth: 30,
    textAlign: 'right',
  },
});
