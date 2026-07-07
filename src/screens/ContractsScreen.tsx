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
import { getRoute as findRoute } from '../data/routes';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { getCityName, getProductByIdSafe, getProductName } from '../utils/entityLookup';
import { dedupeAvailableContracts, getContractFilterSortTier } from '../simulation/contracts';
import {
  buildContractPreview,
  type ContractPreview,
  type ContractRiskLevel,
} from '../simulation/contractPreview';
import {
  countMarketContractMatches,
  getContractMarketSortScore,
  getMarketContractMatchTier,
  getMarketMatchBadgeVariant,
  isExactMarketContractMatch,
  MARKET_MATCH_BADGE_LABEL,
  type MarketContractMatchTier,
  type MarketMatchBadgeVariant,
} from '../utils/marketContractMatch';
import {
  getContractAvailability,
  getContractCargoWeight,
  getIdleTruckOriginCityIds,
  hasIdleTruckAtOrigin,
} from '../simulation/delivery';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, formatRatioPercent, spacing } from '../theme';
import { STATUS_BAR_HEIGHT } from '../theme/ui';
import type {
  Contract,
  ContractAvailability,
  Delivery,
  Driver,
  MarketContractFilter,
  ProductId,
  Truck,
} from '../types/game';

const STATUS_MESSAGE_TIMEOUT_MS = 2500;
const MARKET_HIGHLIGHT_TIMEOUT_MS = 8000;
const DAY_HOURS = 24;
const LIST_FILTER: FilterKey = 'bestPayment';

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

function formatPercent(value: number): string {
  return formatRatioPercent(value);
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

interface ContractCardBadge {
  key: string;
  label: string;
  icon?: React.ComponentProps<typeof GameIcon>['name'];
  iconColor?: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  soft?: boolean;
  muted?: boolean;
  compact?: boolean;
  warning?: boolean;
}

const TRUCK_UNAVAILABLE_BADGE = {
  label: 'Kamyon yok',
  textColor: '#F59E0B',
  backgroundColor: 'rgba(245, 158, 11, 0.12)',
  borderColor: 'rgba(245, 158, 11, 0.65)',
} as const;

const NO_TRUCK_IN_ORIGIN_BADGE = {
  label: 'Şehirde kamyon yok',
  textColor: '#F59E0B',
  backgroundColor: 'rgba(245, 158, 11, 0.14)',
  borderColor: 'rgba(245, 158, 11, 0.7)',
} as const;

const NO_IDLE_TRUCK_IN_ORIGIN_BADGE = {
  label: 'Şehirde müsait kamyon yok',
  textColor: '#FBBF24',
  backgroundColor: 'rgba(245, 158, 11, 0.10)',
  borderColor: 'rgba(245, 158, 11, 0.5)',
} as const;

function createTruckUnavailableBadge(): ContractCardBadge {
  return {
    key: 'availability',
    label: TRUCK_UNAVAILABLE_BADGE.label,
    textColor: TRUCK_UNAVAILABLE_BADGE.textColor,
    backgroundColor: TRUCK_UNAVAILABLE_BADGE.backgroundColor,
    borderColor: TRUCK_UNAVAILABLE_BADGE.borderColor,
    warning: true,
  };
}

function createOriginTruckBadge(kind: 'missing' | 'busy'): ContractCardBadge {
  const style = kind === 'missing' ? NO_TRUCK_IN_ORIGIN_BADGE : NO_IDLE_TRUCK_IN_ORIGIN_BADGE;
  return {
    key: 'availability',
    label: style.label,
    textColor: style.textColor,
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    warning: true,
  };
}

function getAvailabilityBadge(
  availability: ContractAvailability,
  playerLevel: number,
  hasTruckAtOrigin: boolean,
): ContractCardBadge | null {
  if (availability.canStart) {
    if (hasTruckAtOrigin) {
      return {
        key: 'availability',
        label: 'Kamyon hazır',
        icon: 'truck',
        iconColor: COLORS.green,
        textColor: COLORS.green,
        backgroundColor: COLORS.card,
        borderColor: colors.success,
      };
    }
    return null;
  }

  switch (availability.reason) {
    case 'LEVEL_INSUFFICIENT': {
      const requiredLevel = availability.requiredLevel ?? 1;
      const safePlayerLevel = Math.max(1, playerLevel ?? 1);
      const label =
        requiredLevel === safePlayerLevel + 1
          ? `Level ${requiredLevel} gerekli`
          : 'Seviye yetersiz';
      return {
        key: 'availability',
        label,
        textColor: colors.accentAmber,
        backgroundColor: colors.accentAmberSoft,
        borderColor: colors.accentAmber,
      };
    }
    case 'NO_TRUCK_AT_ORIGIN':
    case 'NO_TRUCK_IN_ORIGIN_CITY':
      return createOriginTruckBadge('missing');
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
      return createOriginTruckBadge('busy');
    case 'NO_TRUCKS':
      return createTruckUnavailableBadge();
    case 'NO_IDLE_TRUCKS':
      return {
        key: 'availability',
        label: 'Müsait kamyon yok',
        textColor: '#FBBF24',
        backgroundColor: 'rgba(245, 158, 11, 0.10)',
        borderColor: 'rgba(245, 158, 11, 0.5)',
        warning: true,
      };
    case 'NO_DRIVERS':
    case 'NO_IDLE_DRIVERS':
      return {
        key: 'availability',
        label: 'Şoför yok',
        textColor: COLORS.muted,
        backgroundColor: colors.cardSoft,
        borderColor: COLORS.border,
      };
    case 'CAPACITY_INSUFFICIENT':
      return {
        key: 'availability',
        label: 'Kapasite yetersiz',
        textColor: COLORS.muted,
        backgroundColor: colors.cardSoft,
        borderColor: COLORS.border,
      };
    case 'TRUCK_CONDITION_TOO_LOW':
      return {
        key: 'availability',
        label: 'Kondisyon düşük',
        textColor: COLORS.muted,
        backgroundColor: colors.cardSoft,
        borderColor: COLORS.border,
      };
    default:
      return null;
  }
}

function buildContractFooterBadges(params: {
  availability: ContractAvailability;
  playerLevel: number;
  hasTruckAtOrigin: boolean;
  urgent: boolean;
  riskLabel: string;
  riskOutline: ReturnType<typeof getRiskOutlineStyle>;
  riskSoft: boolean;
}): ContractCardBadge[] {
  const {
    availability,
    playerLevel,
    hasTruckAtOrigin,
    urgent,
    riskLabel,
    riskOutline,
    riskSoft,
  } = params;
  const badges: ContractCardBadge[] = [];

  if (!availability.canStart) {
    const availabilityBadge = getAvailabilityBadge(availability, playerLevel, hasTruckAtOrigin);
    if (availabilityBadge) {
      badges.push(availabilityBadge);
    }
  }

  if (urgent) {
    badges.push({
      key: 'urgent',
      label: 'Acil',
      icon: 'urgent',
      iconColor: COLORS.red,
      textColor: COLORS.red,
      backgroundColor: COLORS.card,
      borderColor: COLORS.red,
    });
  }

  badges.push({
    key: 'risk',
    label: formatRiskDisplayLabel(riskLabel ?? ''),
    textColor: riskOutline.color,
    backgroundColor: riskOutline.backgroundColor,
    borderColor: riskOutline.borderColor,
    soft: riskSoft,
  });

  return badges.slice(0, 3);
}

function formatRiskDisplayLabel(label: string): string {
  if (label === 'Yüksek risk') return 'Yüksek Risk';
  if (label === 'Orta risk') return 'Orta Risk';
  if (label === 'Düşük risk') return 'Düşük Risk';
  return label || 'Düşük Risk';
}

function getRiskOutlineStyle(
  riskLevel: ContractRiskLevel,
  soft = false,
): { backgroundColor: string; borderColor: string; color: string } {
  if (riskLevel === 'high') {
    return {
      backgroundColor: COLORS.card,
      borderColor: soft ? 'rgba(248, 113, 113, 0.45)' : COLORS.red,
      color: soft ? 'rgba(248, 113, 113, 0.85)' : COLORS.red,
    };
  }
  if (riskLevel === 'medium') {
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

function getPreviewProfit(
  contract: Contract,
  previewById: Map<string, ContractPreview>,
): number {
  return previewById.get(contract.id)?.estimatedOperationalProfit ?? 0;
}

function isRouteContractFilter(
  filter: MarketContractFilter | null | undefined,
): filter is MarketContractFilter {
  return filter?.source === 'market' || filter?.source === 'map';
}

function isMarketOpportunityFilter(
  filter: MarketContractFilter | null | undefined,
): filter is MarketContractFilter {
  return filter?.source === 'market';
}

function getMarketMatchBadgeColors(variant: MarketMatchBadgeVariant): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  switch (variant) {
    case 'exact':
      return {
        backgroundColor: colors.successSoft,
        borderColor: colors.success,
        textColor: colors.success,
      };
    case 'strong':
      return {
        backgroundColor: colors.accentAmberSoft,
        borderColor: colors.accentAmber,
        textColor: colors.accentAmber,
      };
    default:
      return {
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        borderColor: colors.accentBlue,
        textColor: colors.accentBlue,
      };
  }
}

function compareContractsForDisplay(
  a: Contract,
  b: Contract,
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  activeFilter: FilterKey,
  previewById: Map<string, ContractPreview>,
  marketFilter?: MarketContractFilter | null,
): number {
  if (isMarketOpportunityFilter(marketFilter)) {
    const matchDiff =
      getContractMarketSortScore(b, marketFilter) - getContractMarketSortScore(a, marketFilter);
    if (matchDiff !== 0) return matchDiff;
  }

  const priorityDiff =
    getContractSortPriority(a, trucks, drivers, playerLevel, marketFilter) -
    getContractSortPriority(b, trucks, drivers, playerLevel, marketFilter);
  if (priorityDiff !== 0) return priorityDiff;

  if (activeFilter === 'shortDistance') {
    return a.distanceKm - b.distanceKm;
  }

  if (activeFilter === 'urgent') {
    return a.deadlineHours - b.deadlineHours || b.payment - a.payment;
  }

  if (activeFilter === 'lowRisk') {
    return getPreviewProfit(b, previewById) - getPreviewProfit(a, previewById);
  }

  if (activeFilter === 'bestPayment' || activeFilter === 'all') {
    const paymentDiff = b.payment - a.payment;
    if (paymentDiff !== 0) return paymentDiff;
    const profitDiff = getPreviewProfit(b, previewById) - getPreviewProfit(a, previewById);
    if (profitDiff !== 0) return profitDiff;
    if (isMarketOpportunityFilter(marketFilter)) {
      return (b.urgency ?? 0) - (a.urgency ?? 0);
    }
    return 0;
  }

  const profitDiff = getPreviewProfit(b, previewById) - getPreviewProfit(a, previewById);
  if (profitDiff !== 0) return profitDiff;
  const paymentDiff = b.payment - a.payment;
  if (paymentDiff !== 0) return paymentDiff;
  if (isMarketOpportunityFilter(marketFilter)) {
    return (b.urgency ?? 0) - (a.urgency ?? 0);
  }
  return 0;
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

  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const requiredLevel = contract.requiredLevel ?? 1;
  const levelGap = requiredLevel - safePlayerLevel;
  const atOrigin = hasIdleTruckAtOrigin(trucks, contract.originCityId);

  let priority = 0;

  if (marketFilter?.source === 'map' && isRouteContractFilter(marketFilter)) {
    const tier = getContractFilterSortTier(contract, marketFilter);
    priority += tier * 20;
  }

  if (levelGap <= 0) {
    const availability = getContractAvailability(contract, trucks, drivers, safePlayerLevel);
    if (availability.canStart) {
      priority += 0;
    } else if (
      availability.reason === 'NO_TRUCK_AT_ORIGIN' ||
      availability.reason === 'NO_TRUCK_IN_ORIGIN_CITY'
    ) {
      priority += 20;
    } else if (availability.reason === 'NO_IDLE_TRUCK_IN_ORIGIN_CITY') {
      priority += 18;
    } else if (
      availability.reason === 'NO_TRUCKS' ||
      availability.reason === 'NO_IDLE_TRUCKS' ||
      availability.reason === 'NO_DRIVERS' ||
      availability.reason === 'NO_IDLE_DRIVERS'
    ) {
      priority += 35;
    } else if (availability.reason === 'CAPACITY_INSUFFICIENT') {
      priority += 40;
    } else if (availability.reason === 'TRUCK_CONDITION_TOO_LOW') {
      priority += 45;
    } else {
      priority += 50;
    }
    if (
      atOrigin &&
      !availability.canStart &&
      availability.reason !== 'NO_TRUCK_AT_ORIGIN' &&
      availability.reason !== 'NO_TRUCK_IN_ORIGIN_CITY' &&
      availability.reason !== 'NO_IDLE_TRUCK_IN_ORIGIN_CITY'
    ) {
      priority -= 3;
    }
    return priority;
  }

  if (levelGap === 1) {
    return priority + (atOrigin ? 55 : 65);
  }

  return priority + (atOrigin ? 100 : 110) + levelGap * 5;
}

function sortContractsForDisplay(
  items: Contract[],
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  activeFilter: FilterKey,
  previewById: Map<string, ContractPreview>,
  marketFilter?: MarketContractFilter | null,
): Contract[] {
  const list = [...items];

  if (activeFilter === 'shortDistance') {
    return list.sort((a, b) =>
      compareContractsForDisplay(
        a,
        b,
        trucks,
        drivers,
        playerLevel,
        activeFilter,
        previewById,
        marketFilter,
      ),
    );
  }

  if (activeFilter === 'urgent') {
    return list
      .filter((contract) => previewById.get(contract.id)?.isUrgent)
      .sort((a, b) =>
        compareContractsForDisplay(
          a,
          b,
          trucks,
          drivers,
          playerLevel,
          activeFilter,
          previewById,
          marketFilter,
        ),
      );
  }

  if (activeFilter === 'lowRisk') {
    return list
      .filter((contract) => previewById.get(contract.id)?.riskLevel === 'low')
      .sort((a, b) =>
        compareContractsForDisplay(
          a,
          b,
          trucks,
          drivers,
          playerLevel,
          activeFilter,
          previewById,
          marketFilter,
        ),
      );
  }

  return list.sort((a, b) =>
    compareContractsForDisplay(
      a,
      b,
      trucks,
      drivers,
      playerLevel,
      activeFilter,
      previewById,
      marketFilter,
    ),
  );
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

interface MarketFilterInfoCardProps {
  routeLine: string;
  exactCount: number;
  relatedCount: number;
  onClear: () => void;
}

function MarketFilterInfoCard({
  routeLine,
  exactCount,
  relatedCount,
  onClear,
}: MarketFilterInfoCardProps) {
  const detailMessage =
    exactCount > 0
      ? 'Bu fırsatla tam eşleşen işler bulundu.'
      : relatedCount > 0
        ? 'Tam eşleşme yok, aynı rota/şehir/ürünle ilişkili işler gösteriliyor.'
        : 'Bu fırsata uygun iş şu anda yok. Yakın işler ve diğer sözleşmeler aşağıda gösteriliyor.';

  return (
    <View style={styles.marketFilterInfoCard}>
      <View style={styles.marketFilterInfoHeader}>
        <Text style={styles.marketFilterInfoTitle}>Piyasa fırsatına göre sıralanıyor</Text>
        <TouchableOpacity onPress={onClear} activeOpacity={0.85}>
          <Text style={styles.marketFilterClear}>Filtreyi temizle</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.marketFilterInfoRoute} numberOfLines={1}>
        {routeLine}
      </Text>
      <Text style={styles.marketFilterInfoMessage}>{detailMessage}</Text>
      <Text style={styles.marketFilterInfoHint}>
        Eşleşen ve yakın sözleşmeler üstte gösteriliyor.
      </Text>
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

interface OriginCitiesBannerProps {
  trucks: Truck[];
}

function OriginCitiesBanner({ trucks }: OriginCitiesBannerProps) {
  const idleCount = (trucks ?? []).filter((truck) => truck.status === 'idle').length;
  const originCityIds = getIdleTruckOriginCityIds(trucks);

  if (idleCount === 0) {
    return (
      <View style={styles.originBanner}>
        <Text style={styles.originBannerText}>
          Boşta kamyon yok. Yeni iş almak için teslimatın bitmesini bekle.
        </Text>
      </View>
    );
  }

  const cityLabels = originCityIds.map((cityId) => getCityName(cityId)).join(', ');

  return (
    <View style={styles.originBanner}>
      <Text style={styles.originBannerText} numberOfLines={2}>
        Uygun çıkış şehirleri: {cityLabels || getCityName('izmir')}
      </Text>
    </View>
  );
}

interface ContractCardProps {
  contract: Contract;
  preview: ContractPreview;
  trucks: Truck[];
  playerLevel: number;
  isPinnedMarketMatch?: boolean;
  marketMatchTier?: MarketContractMatchTier | null;
  onPress: () => void;
}

function ContractCard({
  contract,
  preview,
  trucks,
  playerLevel,
  isPinnedMarketMatch = false,
  marketMatchTier = null,
  onPress,
}: ContractCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const { availability } = preview;
  const cargoWeight = availability.requiredCapacity ?? getContractCargoWeight(contract);
  const urgent = preview.isUrgent;
  const hasTruckAtOrigin = hasIdleTruckAtOrigin(trucks, contract.originCityId);
  const riskSoft = urgent && preview.riskLevel === 'high';
  const riskOutline = getRiskOutlineStyle(preview.riskLevel, riskSoft);
  const payment = contract.payment ?? 0;
  const estimatedProfit = preview.estimatedOperationalProfit ?? 0;
  const totalExpense = preview.estimatedTripCost ?? 0;
  const profitMargin = preview.estimatedMarginPercent ?? 0;
  const footerBadges = buildContractFooterBadges({
    availability,
    playerLevel: safePlayerLevel,
    hasTruckAtOrigin,
    urgent,
    riskLabel: preview.riskLabel ?? '',
    riskOutline,
    riskSoft,
  });
  const matchBadgeVariant =
    marketMatchTier && marketMatchTier !== 'none'
      ? getMarketMatchBadgeVariant(marketMatchTier)
      : null;
  const matchBadgeColors = matchBadgeVariant
    ? getMarketMatchBadgeColors(matchBadgeVariant)
    : null;

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
        !availability.canStart && styles.listCardDimmed,
      ]}
    >
      {isPinnedMarketMatch ? (
        <View style={styles.marketOpportunityTag}>
          <Text style={styles.marketOpportunityTagText}>Piyasa fırsatı</Text>
        </View>
      ) : null}

      <View style={styles.cardHeader}>
        <View style={styles.contractIconBox}>
          <ProductIcon productId={contract.productId} size={20} color={COLORS.cyan} />
        </View>

        <View style={styles.leftInfo}>
          <Text style={styles.contractRoute} numberOfLines={1} ellipsizeMode="tail">
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text style={styles.contractProduct} numberOfLines={1} ellipsizeMode="tail">
            {getProductName(contract.productId)}
          </Text>
          <Text style={styles.contractMetaLine} numberOfLines={1} ellipsizeMode="tail">
            Yük {formatTonsCompact(cargoWeight)} · Kalan {formatTimeLeft(contract.deadlineHours)}
          </Text>
        </View>

        <View style={styles.rightPrice}>
          <Text style={styles.contractPayment} numberOfLines={1} ellipsizeMode="tail">
            {formatMoney(payment)}
          </Text>
          <Text
            style={[
              styles.contractProfit,
              { color: estimatedProfit >= 0 ? COLORS.green : COLORS.red },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            İş kârı {formatMoney(estimatedProfit)}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.cardFinanceLine} numberOfLines={1} ellipsizeMode="tail">
          İş gideri {formatMoney(totalExpense)} · Marj {formatPercent(profitMargin)}
        </Text>

        <View style={styles.cardBadgeRow}>
          {marketMatchTier && marketMatchTier !== 'none' && matchBadgeColors ? (
            <View
              style={[
                styles.marketMatchBadge,
                {
                  backgroundColor: matchBadgeColors.backgroundColor,
                  borderColor: matchBadgeColors.borderColor,
                },
              ]}
            >
              <Text
                style={[styles.marketMatchBadgeText, { color: matchBadgeColors.textColor }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {MARKET_MATCH_BADGE_LABEL[marketMatchTier]}
              </Text>
            </View>
          ) : null}
          {footerBadges.map((badge) => (
            <View
              key={badge.key}
              style={[
                styles.miniBadge,
                badge.soft && styles.miniBadgeSoft,
                badge.compact && styles.miniBadgeCompact,
                badge.warning && styles.miniBadgeWarning,
                {
                  backgroundColor: badge.backgroundColor,
                  borderColor: badge.borderColor,
                },
              ]}
            >
              {badge.icon ? (
                <GameIcon name={badge.icon} size={10} color={badge.iconColor ?? badge.textColor} />
              ) : null}
              <Text
                style={[
                  styles.miniBadgeText,
                  badge.soft && styles.miniBadgeTextSoft,
                  badge.muted && styles.miniBadgeTextMuted,
                  badge.compact && styles.miniBadgeTextCompact,
                  badge.warning && styles.miniBadgeTextWarning,
                  { color: badge.textColor },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {badge.label}
              </Text>
            </View>
          ))}
          {availability.canStart ? (
            <View style={[styles.actionPill, styles.actionPillReady]}>
              <Text style={[styles.actionPillText, styles.actionPillTextReady]} numberOfLines={1}>
                Ekibi Seç
              </Text>
            </View>
          ) : null}
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
          <Text style={styles.cardRoute} numberOfLines={1} ellipsizeMode="tail">
            {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
          </Text>
          <Text style={styles.cardProduct} numberOfLines={1} ellipsizeMode="tail">
            {getProductName(delivery.productId)}
          </Text>
          <Text style={styles.cardMetaLine} numberOfLines={1} ellipsizeMode="tail">
            {truck?.name ?? 'Kamyon'} · {driver?.name ?? 'Şoför'}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPayment} numberOfLines={1} ellipsizeMode="tail">
            {formatMoney(delivery.estimatedProfit)}
          </Text>
          <View style={styles.cardMetricTimeRow}>
            <GameIcon name="time" size={11} color={COLORS.muted} />
            <Text style={styles.cardMetaValue} numberOfLines={1} ellipsizeMode="tail">
              {formatTimeLeft(hoursLeft)}
            </Text>
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
  netProfit?: number;
  fallbackPreview?: ContractPreview;
}

function CompletedContractCard({
  contract,
  netProfit,
  fallbackPreview,
}: CompletedContractCardProps) {
  const profit = netProfit ?? fallbackPreview?.estimatedNetProfit ?? 0;

  return (
    <View style={styles.listCard}>
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <ProductIcon productId={contract.productId} size={22} color={COLORS.green} />
        </View>
        <View style={styles.cardCenter}>
          <Text style={styles.cardRoute} numberOfLines={1} ellipsizeMode="tail">
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text style={styles.cardProduct} numberOfLines={1} ellipsizeMode="tail">
            {getProductName(contract.productId)}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPayment} numberOfLines={1} ellipsizeMode="tail">
            {formatMoney(contract.payment)}
          </Text>
          <Text
            style={[styles.cardProfit, { color: COLORS.green }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
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
  const notifyContractsScreenOpened = useGameStore((state) => state.notifyContractsScreenOpened);
  const notifyContractAssignmentOpened = useGameStore((state) => state.notifyContractAssignmentOpened);
  const { tabBarHeight, scrollBottomPadding } = useTabBarLayout();

  const scrollRef = useRef<ScrollViewType>(null);

  const [activeSegment, setActiveSegment] = useState<SegmentKey>('available');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [assignmentContract, setAssignmentContract] = useState<Contract | null>(null);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);

  useEffect(() => {
    notifyContractsScreenOpened();
  }, [notifyContractsScreenOpened]);

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

  const contractPreviewById = useMemo(() => {
    if (!globalEconomy) {
      return new Map<string, ContractPreview>();
    }

    const previews = new Map<string, ContractPreview>();
    for (const contract of availableContracts) {
      previews.set(
        contract.id,
        buildContractPreview({
          contract,
          globalEconomy,
          trucks,
          drivers,
          companyLevel: playerLevel,
        }),
      );
    }
    return previews;
  }, [availableContracts, trucks, drivers, globalEconomy, playerLevel]);

  const filteredContracts = useMemo(() => {
    if (!globalEconomy) return [];
    return sortContractsForDisplay(
      availableContracts,
      trucks,
      drivers,
      playerLevel,
      LIST_FILTER,
      contractPreviewById,
      marketContractFilter,
    );
  }, [
    availableContracts,
    trucks,
    drivers,
    playerLevel,
    globalEconomy,
    contractPreviewById,
    marketContractFilter,
  ]);

  const completedPreviewById = useMemo(() => {
    if (!globalEconomy) {
      return new Map<string, ContractPreview>();
    }

    const previews = new Map<string, ContractPreview>();
    for (const contract of completedContracts) {
      previews.set(
        contract.id,
        buildContractPreview({
          contract,
          globalEconomy,
          trucks,
          drivers,
          companyLevel: playerLevel,
        }),
      );
    }
    return previews;
  }, [completedContracts, trucks, drivers, globalEconomy, playerLevel]);

  const tabSegments = useMemo<TabSegment[]>(
    () => [
      { key: 'available', label: 'Müsait', count: availableContracts.length },
      { key: 'active', label: 'Aktif', count: runningDeliveries.length },
      { key: 'completed', label: 'Tamamlanan', count: completedContracts.length },
    ],
    [availableContracts.length, runningDeliveries.length, completedContracts.length],
  );

  const marketMatchStats = useMemo(() => {
    if (!isMarketOpportunityFilter(marketContractFilter)) {
      return { exactMatchesCount: 0, relatedMatchesCount: 0 };
    }

    return countMarketContractMatches(availableContracts, marketContractFilter);
  }, [availableContracts, marketContractFilter]);

  useEffect(() => {
    if (!isRouteContractFilter(marketContractFilter)) {
      return;
    }

    let firstExactId: string | null = null;
    const pinnedContractId = marketContractFilter.contractId ?? null;

    for (const contract of availableContracts) {
      if (isExactMarketContractMatch(contract, marketContractFilter)) {
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
    notifyContractAssignmentOpened();
  };

  const closeAssignmentModal = () => {
    setAssignmentModalVisible(false);
    setAssignmentContract(null);
  };

  const handleConfirmAssignment = (truckId: string, driverId: string) => {
    if (!assignmentContract) return;

    const truck = (player.trucks ?? []).find((item) => item.id === truckId);
    const driver = (player.drivers ?? []).find((item) => item.id === driverId);
    const preview = buildContractPreview({
      contract: assignmentContract,
      globalEconomy,
      trucks: player.trucks,
      drivers: player.drivers,
      companyLevel: playerLevel,
      truck,
      driver,
      route: findRoute(assignmentContract.originCityId, assignmentContract.destinationCityId),
      product: getProductByIdSafe(assignmentContract.productId) ?? undefined,
    });

    if (player.money < preview.estimatedFuelCost) {
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
          <View style={styles.headerSideSlot} />
          <Text style={styles.headerTitle}>Sözleşmeler</Text>
          <View style={styles.headerSideSlot}>
            <IconButton
              icon="refresh"
              onPress={handleRefresh}
              size={16}
              color={COLORS.cyan}
              backgroundColor={COLORS.card}
              style={styles.headerIconButton}
            />
          </View>
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

        <OriginCitiesBanner trucks={trucks} />

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
            { paddingBottom: Math.max(scrollBottomPadding, tabBarHeight + 48) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {activeSegment === 'available' ? (
            <>
              {isMarketOpportunityFilter(marketContractFilter) ? (
                <MarketFilterInfoCard
                  routeLine={marketFilterLine}
                  exactCount={marketMatchStats.exactMatchesCount}
                  relatedCount={marketMatchStats.relatedMatchesCount}
                  onClear={handleClearMarketFilter}
                />
              ) : isRouteContractFilter(marketContractFilter) ? (
                <View style={styles.marketFilterCompact}>
                  <Text style={styles.marketFilterLine} numberOfLines={1}>
                    Harita önerisi · {marketFilterLine}
                  </Text>
                  <TouchableOpacity onPress={handleClearMarketFilter} activeOpacity={0.85}>
                    <Text style={styles.marketFilterClear}>Temizle</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {availableContracts.length === 0 ? (
                <EmptyState
                  title="Şu anda uygun sözleşme yok"
                  message="Piyasa yeni fırsatlar oluşturdukça burada görünecek."
                  icon="contract"
                />
              ) : (
                filteredContracts.map((contract) => {
                  const preview = contractPreviewById.get(contract.id);
                  if (!preview) {
                    return null;
                  }

                  return (
                    <ContractCard
                      key={contract.id}
                      contract={contract}
                      preview={preview}
                      trucks={player.trucks ?? []}
                      playerLevel={player.level ?? player.companyLevel ?? 1}
                      isPinnedMarketMatch={highlightedContractId === contract.id}
                      marketMatchTier={
                        isMarketOpportunityFilter(marketContractFilter)
                          ? getMarketContractMatchTier(contract, marketContractFilter)
                          : null
                      }
                      onPress={() => openAssignmentModal(contract)}
                    />
                  );
                })
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
                    netProfit={linkedDelivery?.estimatedProfit}
                    fallbackPreview={completedPreviewById.get(contract.id)}
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
  headerSideSlot: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
    minWidth: 0,
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
    marginBottom: spacing.xs,
    minHeight: 30,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  originBanner: {
    marginBottom: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  originBannerText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  listCardDimmed: {
    opacity: 0.72,
  },
  originReadyBadge: {
    borderColor: 'rgba(74, 222, 128, 0.45)',
    backgroundColor: 'rgba(74, 222, 128, 0.08)',
  },
  originMissingBadge: {
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
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
  marketFilterInfoCard: {
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: colors.accentAmber,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
  },
  marketFilterInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  marketFilterInfoTitle: {
    flex: 1,
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '800',
  },
  marketFilterInfoRoute: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  marketFilterInfoMessage: {
    fontSize: 11,
    color: colors.accentAmber,
    fontWeight: '700',
    lineHeight: 15,
  },
  marketFilterInfoHint: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '500',
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
  marketMatchBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  marketMatchBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  listCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  leftInfo: {
    flex: 1,
    minWidth: 0,
  },
  rightPrice: {
    flexShrink: 0,
    alignItems: 'flex-end',
    minWidth: 100,
    maxWidth: 130,
    paddingLeft: 6,
  },
  contractIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractRoute: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 1,
    lineHeight: 19,
  },
  contractProduct: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 1,
    minWidth: 0,
    lineHeight: 17,
  },
  contractMetaLine: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    minWidth: 0,
    lineHeight: 17,
  },
  contractPayment: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.green,
    marginBottom: 2,
    lineHeight: 24,
  },
  contractProfit: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.green,
    lineHeight: 18,
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
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 2,
    lineHeight: 18,
  },
  cardProduct: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 2,
    minWidth: 0,
    lineHeight: 15,
  },
  cardMetaLine: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
    minWidth: 0,
    lineHeight: 14,
  },
  cardRight: {
    flexShrink: 0,
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
    marginTop: 6,
    gap: 4,
  },
  cardFinanceLine: {
    width: '100%',
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: '600',
  },
  cardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 6,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 150,
    flexShrink: 1,
  },
  miniBadgeCompact: {
    maxWidth: 160,
  },
  miniBadgeWarning: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 120,
  },
  miniBadgeSoft: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  miniBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    flexShrink: 1,
  },
  miniBadgeTextSoft: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 13,
  },
  miniBadgeTextMuted: {
    fontWeight: '600',
  },
  miniBadgeTextCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  miniBadgeTextWarning: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionPillReady: {
    backgroundColor: colors.infoSoft,
    borderColor: COLORS.cyan,
  },
  actionPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  actionPillTextReady: {
    color: COLORS.cyan,
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
