/**
 * LogistiCore - İşler / Sözleşmeler Ekranı
 *
 * Piyasadaki taşıma sözleşmelerini premium dark UI ile yönetme ekranı.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type FlatList as FlatListType,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import ContractAssignmentModal from '../components/ContractAssignmentModal';
import ContractQuickActionSheet from '../components/contracts/ContractQuickActionSheet';
import DeliveryIncidentCard from '../components/delivery/DeliveryIncidentCard';
import DeliveryBoostPanel from '../components/monetization/DeliveryBoostPanel';
import AdRewardButton from '../components/monetization/AdRewardButton';
import { contractGenerationBalance } from '../config/balance';
import { TutorialTarget } from '../tutorial/TutorialTarget';
import { ENABLE_SPOTLIGHT_TUTORIAL } from '../tutorial/featureFlags';
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
import { countPlayableContracts } from '../simulation/contracts';
import { selectAvailableContractsForUi, logContractsUiSelector, inspectContractsUiSelector } from '../utils/contractsUiSelector';
import {
  buildContractPreview,
  type ContractPreview,
} from '../simulation/contractPreview';
import {
  countMarketContractMatches,
  isExactMarketContractMatch,
} from '../utils/marketContractMatch';
import { getContractCargoWeight, getIdleTruckOriginCityIds } from '../simulation/delivery';
import {
  buildContractCardBadges,
  getContractCardVisualTier,
  type ContractCardBadge,
} from '../utils/contractBadges';
import {
  compareContractsBySmartScore,
  getActiveDeliveryDestinationCityIds,
  isMarketOpportunityFilter,
  isRouteContractFilter,
} from '../utils/contractSorting';
import { useGameStore } from '../store/gameStore';
import OnboardingHintCard from '../components/onboarding/OnboardingHintCard';
import TruckLocationHintRow from '../components/shared/TruckLocationHintRow';
import { useActiveOnboardingHint, useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import { useSpotlightTutorialStore } from '../store/spotlightTutorialStore';
import { colors, formatMoney, formatRatioPercent, spacing } from '../theme';
import type { Contract, Delivery, Driver, MarketContractFilter, Truck } from '../types/game';
import {
  formatIdleTruckSummaryLine,
  shouldShowPostDeliveryLocationHint,
} from '../utils/truckLocationUx';

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

const EMPTY_CONTRACT_PREVIEW_MAP = new Map<string, ContractPreview>();

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

function getPreviewProfit(
  contract: Contract,
  previewById: Map<string, ContractPreview>,
): number {
  return previewById.get(contract.id)?.estimatedOperationalProfit ?? 0;
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
  activeDeliveries: Delivery[] = [],
  fallbackHomeCityId?: string,
): number {
  const smartDiff = compareContractsBySmartScore(a, b, {
    trucks,
    drivers,
    playerLevel,
    activeDeliveries,
    previewById,
    marketFilter,
    fallbackHomeCityId,
  });
  if (smartDiff !== 0) {
    return smartDiff;
  }

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

function sortContractsForDisplay(
  items: Contract[],
  trucks: Truck[],
  drivers: Driver[],
  playerLevel: number,
  activeFilter: FilterKey,
  previewById: Map<string, ContractPreview>,
  marketFilter?: MarketContractFilter | null,
  activeDeliveries: Delivery[] = [],
  fallbackHomeCityId?: string,
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
        activeDeliveries,
        fallbackHomeCityId,
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
          activeDeliveries,
          fallbackHomeCityId,
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
          activeDeliveries,
          fallbackHomeCityId,
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
      activeDeliveries,
      fallbackHomeCityId,
    ),
  );
}

function getDeliveryStatusVariant(status: Delivery['status']): 'blue' | 'amber' | 'success' | 'danger' {
  switch (status) {
    case 'on_route':
      return 'blue';
    case 'preparing':
      return 'amber';
    case 'paused':
      return 'danger';
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
    case 'paused':
      return 'Yakıt Bitti';
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

interface ContractsSummaryStripProps {
  availableCount: number;
  activeCount: number;
  bestPayment: number;
  playableCount: number;
  trucks: Truck[];
}

function ContractsSummaryStrip({
  availableCount,
  activeCount,
  bestPayment,
  playableCount,
  trucks,
}: ContractsSummaryStripProps) {
  const idleCount = (trucks ?? []).filter((truck) => truck.status === 'idle').length;
  const originCityIds = getIdleTruckOriginCityIds(trucks);
  const cityLabels = originCityIds.map((cityId) => getCityName(cityId)).join(', ');

  const originLine = formatIdleTruckSummaryLine(cityLabels, idleCount, playableCount);

  return (
    <View style={styles.summaryStrip}>
      <Text style={styles.compactStatText}>
        <Text style={styles.statValueSuccess}>{playableCount}</Text>
        {' uygun iş · '}
        <Text style={styles.statValueInfo}>{availableCount}</Text>
        {' iş ilanı · '}
        <Text style={styles.statValueAmber}>{activeCount}</Text>
        {' aktif · En yüksek '}
        <Text style={styles.statValueSuccess}>{formatMoney(bestPayment)}</Text>
      </Text>
      <Text style={styles.summarySubline} numberOfLines={2}>
        {originLine}
      </Text>
    </View>
  );
}

interface NextRouteHintCardProps {
  deliveries: Delivery[];
}

function NextRouteHintCard({ deliveries }: NextRouteHintCardProps) {
  const destinationIds = [...getActiveDeliveryDestinationCityIds(deliveries)];
  if (destinationIds.length === 0) {
    return null;
  }

  const message =
    destinationIds.length === 1
      ? `Sıradaki rota önerileri: ${getCityName(destinationIds[0])}'a varacak kamyon için ${getCityName(destinationIds[0])} çıkışlı işler ayrıca öne çıkarılır.`
      : 'Sıradaki rota önerileri: Kamyonlarının varış şehirlerinden çıkan işler ayrıca öne çıkarılır.';

  return (
    <View style={styles.nextRouteHint}>
      <Text style={styles.nextRouteHintTitle}>Sıradaki rota önerileri</Text>
      <Text style={styles.nextRouteHintText} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

type ContractsListItem =
  | { key: string; type: 'available'; contract: Contract }
  | { key: string; type: 'active'; delivery: Delivery }
  | { key: string; type: 'completed'; contract: Contract };

interface ContractCardProps {
  contract: Contract;
  preview: ContractPreview;
  playerLevel: number;
  isPinnedMarketMatch?: boolean;
  onPress: () => void;
}

const ContractCard = React.memo(function ContractCard({
  contract,
  preview,
  playerLevel,
  isPinnedMarketMatch = false,
  onPress,
}: ContractCardProps) {
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const { availability } = preview;
  const cargoWeight = availability.requiredCapacity ?? getContractCargoWeight(contract);
  const visualTier = getContractCardVisualTier(
    availability,
    safePlayerLevel,
    contract.requiredLevel ?? 1,
  );
  const isMuted = visualTier !== 'available';
  const footerBadges = buildContractCardBadges({
    availability,
    playerLevel: safePlayerLevel,
    urgent: preview.isUrgent,
    riskLevel: preview.riskLevel,
    riskLabel: preview.riskLabel ?? '',
    contractType: preview.contractType,
    contractTypeLabel: preview.contractTypeLabel,
    cargoWeightTons: cargoWeight,
  });
  const payment = preview.estimatedGrossPayment ?? contract.payment ?? 0;
  const estimatedProfit = preview.estimatedOperationalProfit ?? 0;
  const worldEventLabel = preview.worldEventLabels?.[0];
  const profitColor =
    estimatedProfit >= 0
      ? isMuted
        ? 'rgba(74, 222, 128, 0.55)'
        : COLORS.green
      : isMuted
        ? 'rgba(248, 113, 113, 0.55)'
        : COLORS.red;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.listCard,
        isPinnedMarketMatch && styles.listCardHighlight,
        visualTier === 'blocked' && styles.listCardBlocked,
        visualTier === 'locked' && styles.listCardLocked,
      ]}
    >
      {isPinnedMarketMatch ? (
        <View style={styles.marketOpportunityTag}>
          <Text style={styles.marketOpportunityTagText}>Piyasa fırsatı</Text>
        </View>
      ) : null}

      <View style={styles.cardHeader}>
        <View style={[styles.contractIconBox, isMuted && styles.contractIconBoxMuted]}>
          <ProductIcon
            productId={contract.productId}
            size={20}
            color={isMuted ? 'rgba(56, 189, 248, 0.45)' : COLORS.cyan}
          />
        </View>

        <View style={styles.leftInfo}>
          <Text
            style={[styles.contractRoute, isMuted && styles.contractTextMuted]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
          </Text>
          <Text
            style={[styles.contractProduct, isMuted && styles.contractSubtextMuted]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {getProductName(contract.productId)}
          </Text>
          <Text
            style={[styles.contractMetaLine, isMuted && styles.contractSubtextMuted]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {formatTonsCompact(cargoWeight)} · Teslim {formatTimeLeft(contract.deadlineHours)}
          </Text>
        </View>

        <View style={styles.rightPrice}>
          <Text
            style={[styles.contractPayment, isMuted && styles.contractPaymentMuted]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {formatMoney(payment)}
          </Text>
          <Text
            style={[styles.contractProfit, { color: profitColor }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            İş kârı {formatMoney(estimatedProfit)}
          </Text>
        </View>
      </View>

      {footerBadges.length > 0 || (worldEventLabel && footerBadges.length < 2) ? (
        <View style={styles.cardFooter}>
          <View style={styles.cardBadgeRow}>
            {worldEventLabel && footerBadges.length < 2 ? (
              <View style={[styles.miniBadge, styles.miniBadgeSoft, styles.eventBadge]}>
                <Text style={[styles.miniBadgeText, styles.eventBadgeText]} numberOfLines={1}>
                  Olay · {worldEventLabel}
                </Text>
              </View>
            ) : null}
            {footerBadges.map((badge: ContractCardBadge) => (
              <View
                key={badge.key}
                style={[
                  styles.miniBadge,
                  badge.soft && styles.miniBadgeSoft,
                  {
                    backgroundColor: badge.backgroundColor,
                    borderColor: badge.borderColor,
                  },
                ]}
              >
                {visualTier === 'locked' && badge.key === 'availability' ? (
                  <GameIcon name="lock" size={10} color={badge.textColor} />
                ) : null}
                <Text
                  style={[styles.miniBadgeText, { color: badge.textColor }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {badge.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

interface ActiveDeliveryCardProps {
  delivery: Delivery;
  trucks: Truck[];
  drivers: Driver[];
  onBoostSuccess?: () => void;
}

const ActiveDeliveryCard = React.memo(function ActiveDeliveryCard({
  delivery,
  trucks,
  drivers,
  onBoostSuccess,
}: ActiveDeliveryCardProps) {
  const currentTime = useGameStore((state) => Math.floor(state.currentTime * 4) / 4);
  const deadlineHoursLeft = Math.max(0, delivery.deadlineTime - currentTime);
  const etaHoursLeft = Math.max(0, delivery.estimatedArrivalTime - currentTime);
  const isLateRisk = delivery.estimatedArrivalTime > delivery.deadlineTime;
  const truck = (trucks ?? []).find((item) => item.id === delivery.truckId);
  const driver = (drivers ?? []).find((item) => item.id === delivery.driverId);
  const showBoost =
    (delivery.status === 'on_route' ||
      delivery.status === 'preparing' ||
      delivery.status === 'paused') &&
    delivery.progress < 1;

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
            <GameIcon name="time" size={11} color={isLateRisk ? COLORS.red : COLORS.muted} />
            <Text
              style={[styles.cardMetaValue, isLateRisk && styles.cardMetaLateRisk]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {isLateRisk ? 'Deadline riski · ' : ''}
              Teslim {formatTimeLeft(deadlineHoursLeft)} · Varış ~{formatTimeLeft(etaHoursLeft)}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.activeProgressRow}>
        <ProgressBar progress={delivery.progress} color={COLORS.cyan} height={3} />
        <Text style={styles.activeProgressText}>{formatPercent(delivery.progress)}</Text>
      </View>
      {delivery.incident || delivery.incidentResolved ? (
        <DeliveryIncidentCard delivery={delivery} />
      ) : null}
      {showBoost ? (
        <DeliveryBoostPanel delivery={delivery} truck={truck} onSuccess={onBoostSuccess} />
      ) : null}
    </View>
  );
});

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
  const { alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
  const monetization = useGameStore((state) => state.monetization);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);
  const worldEvents = useGameStore((state) => state.worldEvents) ?? [];
  const getActiveWorldEventsValue = useGameStore((state) => state.getActiveWorldEventsValue);

  const startDelivery = useGameStore((state) => state.startDelivery);
  const requestNavigationToFleet = useGameStore((state) => state.requestNavigationToFleet);
  const marketContractFilter = useGameStore((state) => state.marketContractFilter);
  const highlightedContractId = useGameStore((state) => state.highlightedContractId);
  const clearMarketContractFilter = useGameStore((state) => state.clearMarketContractFilter);
  const setHighlightedContractId = useGameStore((state) => state.setHighlightedContractId);
  const refreshContractsFromMarket = useGameStore((state) => state.refreshContractsFromMarket);
  const lastManualContractRefreshTime = useGameStore(
    (state) => state.lastManualContractRefreshTime ?? 0,
  );
  const notifyContractsScreenOpened = useGameStore((state) => state.notifyContractsScreenOpened);
  const notifyContractAssignmentOpened = useGameStore((state) => state.notifyContractAssignmentOpened);
  const { scrollBottomPadding, screenTopPadding } = useTabBarLayout();

  useOnboardingScreenVisit('Contracts');
  const onboardingHint = useActiveOnboardingHint(['choose_first_contract', 'assign_team']);

  const scrollRef = useRef<FlatListType<ContractsListItem>>(null);

  const [activeSegment, setActiveSegment] = useState<SegmentKey>('available');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [assignmentContract, setAssignmentContract] = useState<Contract | null>(null);
  const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
  const [quickSheetContract, setQuickSheetContract] = useState<Contract | null>(null);
  const [quickSheetVisible, setQuickSheetVisible] = useState(false);

  useEffect(() => {
    notifyContractsScreenOpened();
  }, [notifyContractsScreenOpened]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerReputation = player?.reputation ?? 0;
  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];
  const trailers = player?.trailers ?? [];
  const completedDeliveryCount = player?.completedContracts ?? 0;
  const previewTruckKey = trucks
    .map((truck) =>
      truck.status === 'idle'
        ? `${truck.id}:${truck.currentCityId}:${truck.capacity}:${Math.floor(truck.currentFuelL ?? 0)}`
        : `${truck.id}:${truck.status}`,
    )
    .join('|');
  const previewDriverKey = drivers
    .map((driver) => `${driver.id}:${driver.status}:${driver.currentCityId ?? ''}`)
    .join('|');
  const previewTrucks = useMemo(
    () => trucks.filter((truck) => truck.status === 'idle'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewTruckKey],
  );
  const previewDrivers = useMemo(
    () => drivers.filter((driver) => driver.status === 'idle'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewDriverKey],
  );
  const showTruckLocationHint = shouldShowPostDeliveryLocationHint(completedDeliveryCount);

  const needsContractPreviews =
    activeSegment === 'available' || activeSegment === 'completed';

  const activeWorldEvents = useMemo(
    () => (needsContractPreviews ? getActiveWorldEventsValue() : []),
    [getActiveWorldEventsValue, worldEvents, currentTime, needsContractPreviews],
  );

  const availableContracts = useMemo(
    () => selectAvailableContractsForUi(contracts),
    [contracts],
  );

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
      return;
    }
    const originHint = getIdleTruckOriginCityIds(trucks, player?.homeCityId)[0] ?? player?.homeCityId ?? null;
    logContractsUiSelector(
      inspectContractsUiSelector({
        contracts,
        currentCityId: originHint,
        originCityId: originHint,
        destinationCityId: 'adana',
      }),
    );
  }, [contracts, trucks, player?.homeCityId]);

  const runningDeliveries = useMemo(
    () =>
      activeDeliveries.filter(
        (d) =>
          d.status === 'on_route' ||
          d.status === 'preparing' ||
          d.status === 'paused',
      ),
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
    if (activeSegment !== 'available' || !globalEconomy) {
      return EMPTY_CONTRACT_PREVIEW_MAP;
    }

    const previews = new Map<string, ContractPreview>();
    for (const contract of availableContracts) {
      previews.set(
        contract.id,
        buildContractPreview({
          contract,
          globalEconomy,
          trucks: previewTrucks,
          trailers,
          drivers: previewDrivers,
          companyLevel: playerLevel,
          currentTime,
          activeWorldEvents,
          playerReputation,
          homeCityId: player?.homeCityId,
        }),
      );
    }
    return previews;
  }, [activeSegment, availableContracts, previewTrucks, trailers, previewDrivers, globalEconomy, playerLevel, playerReputation, currentTime, activeWorldEvents, player?.homeCityId]);

  const playableContractCount = useMemo(
    () =>
      countPlayableContracts(
        availableContracts,
        previewTrucks,
        previewDrivers,
        playerLevel,
        currentTime,
        {
          playerMoney: player?.money,
          globalEconomy,
          playerReputation,
          homeCityId: player?.homeCityId,
          trailers,
        },
      ),
    [
      availableContracts,
      previewTrucks,
      previewDrivers,
      playerLevel,
      currentTime,
      player?.money,
      player?.homeCityId,
      globalEconomy,
      playerReputation,
    ],
  );

  const filteredContracts = useMemo(() => {
    if (!globalEconomy) return [];
    return sortContractsForDisplay(
      availableContracts,
      previewTrucks,
      previewDrivers,
      playerLevel,
      LIST_FILTER,
      contractPreviewById,
      marketContractFilter,
      runningDeliveries,
      player?.homeCityId,
    );
  }, [
    availableContracts,
    previewTrucks,
    previewDrivers,
    playerLevel,
    globalEconomy,
    contractPreviewById,
    marketContractFilter,
    runningDeliveries,
    player?.homeCityId,
  ]);

  const firstTutorialContractId = useMemo(() => {
    for (const contract of filteredContracts) {
      const preview = contractPreviewById.get(contract.id);
      if (preview?.availability.canStart) {
        return contract.id;
      }
    }
    return filteredContracts[0]?.id ?? null;
  }, [contractPreviewById, filteredContracts]);

  const hasActiveMarketFilter =
    isMarketOpportunityFilter(marketContractFilter) || isRouteContractFilter(marketContractFilter);

  useEffect(() => {
    if (!ENABLE_SPOTLIGHT_TUTORIAL || !__DEV__) {
      return;
    }
    const spotlight = useSpotlightTutorialStore.getState();
    if (
      spotlight.isActive &&
      spotlight.tutorialId === 'first_contract' &&
      spotlight.currentStepIndex === 1 &&
      spotlight.activeTab === 'contracts' &&
      !firstTutorialContractId
    ) {
      console.warn('[tutorial] No starter contract found for first_contract tutorial');
    }
  }, [firstTutorialContractId]);

  const scrollTutorialContractIntoView = useCallback(() => {
    scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const completedPreviewById = useMemo(() => {
    if (activeSegment !== 'completed' || !globalEconomy) {
      return EMPTY_CONTRACT_PREVIEW_MAP;
    }

    const previews = new Map<string, ContractPreview>();
    for (const contract of completedContracts) {
      previews.set(
        contract.id,
        buildContractPreview({
          contract,
          globalEconomy,
          trucks: previewTrucks,
          trailers,
          drivers: previewDrivers,
          companyLevel: playerLevel,
          currentTime,
          activeWorldEvents,
          playerReputation,
          homeCityId: player?.homeCityId,
        }),
      );
    }
    return previews;
  }, [activeSegment, completedContracts, previewTrucks, trailers, previewDrivers, globalEconomy, playerLevel, playerReputation, currentTime, activeWorldEvents, player?.homeCityId]);

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

    scrollRef.current?.scrollToOffset({ offset: 0, animated: true });

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

  const openQuickSheet = useCallback((contract: Contract) => {
    setQuickSheetContract(contract);
    setQuickSheetVisible(true);
    notifyContractAssignmentOpened();
  }, [notifyContractAssignmentOpened]);

  const closeQuickSheet = () => {
    setQuickSheetVisible(false);
    setQuickSheetContract(null);
  };

  const closeAssignmentModal = () => {
    setAssignmentModalVisible(false);
    setAssignmentContract(null);
  };

  const handleQuickStartDelivery = (truckId: string, driverId: string) => {
    if (!quickSheetContract) return;

    const result = startDelivery(quickSheetContract.id, truckId, driverId);
    if (!result.success) {
      showAlert('Teslimat başlatılamadı', result.message ?? 'Bilinmeyen hata');
      return;
    }

    closeQuickSheet();
    setStatusMessage({ type: 'success', text: 'Teslimat başlatıldı' });
    setActiveSegment('active');
  };

  const handleOpenAdvancedAssignment = () => {
    if (!quickSheetContract) return;
    const contract = quickSheetContract;
    closeQuickSheet();
    openAssignmentModal(contract);
  };

  const handleConfirmAssignment = (truckId: string, driverId: string) => {
    if (!assignmentContract) return;

    const result = startDelivery(assignmentContract.id, truckId, driverId);
    if (!result.success) {
      showAlert('Teslimat başlatılamadı', result.message ?? 'Bilinmeyen hata');
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

  const handleGoToFleetFromQuick = (subTab?: 'trucks' | 'drivers' | 'shop') => {
    closeQuickSheet();
    requestNavigationToFleet(subTab ?? 'shop');
  };

  const handleClearMarketFilter = () => {
    clearMarketContractFilter();
    setHighlightedContractId(null);
  };

  const handleRefresh = () => {
    refreshContractsFromMarket();
    setStatusMessage({ type: 'success', text: 'Piyasa güncellendi' });
  };

  const isRefreshOnCooldown = useMemo(() => {
    const hoursSinceManual = currentTime - lastManualContractRefreshTime;
    return hoursSinceManual < contractGenerationBalance.manualRefreshCooldownHours;
  }, [currentTime, lastManualContractRefreshTime]);

  const handleAdRefreshSuccess = () => {
    setStatusMessage({ type: 'success', text: 'Reklam sonrası piyasa yenilendi' });
  };

  const handleDeliveryBoostSuccess = useCallback(() => {
    setStatusMessage({ type: 'success', text: 'Teslimat hızlandırıldı' });
  }, []);

  const marketFilterLine = isRouteContractFilter(marketContractFilter)
    ? `${marketContractFilter.fromCityName} → ${marketContractFilter.toCityName} · ${marketContractFilter.productName}`
    : '';

  const listItems = useMemo((): ContractsListItem[] => {
    if (activeSegment === 'available') {
      return filteredContracts.map((contract) => ({
        key: contract.id,
        type: 'available',
        contract,
      }));
    }
    if (activeSegment === 'active') {
      return runningDeliveries.map((delivery) => ({
        key: delivery.id,
        type: 'active',
        delivery,
      }));
    }
    return completedContracts.map((contract) => ({
      key: contract.id,
      type: 'completed',
      contract,
    }));
  }, [activeSegment, filteredContracts, runningDeliveries, completedContracts]);

  const renderContractListItem = useCallback(
    ({ item }: { item: ContractsListItem }) => {
      if (item.type === 'available') {
        const preview = contractPreviewById.get(item.contract.id);
        if (!preview) {
          return null;
        }

        const card = (
          <ContractCard
            contract={item.contract}
            preview={preview}
            playerLevel={player.level ?? player.companyLevel ?? 1}
            isPinnedMarketMatch={highlightedContractId === item.contract.id}
            onPress={() => openQuickSheet(item.contract)}
          />
        );

        if (item.contract.id !== firstTutorialContractId) {
          return card;
        }

        return (
          <TutorialTarget
            id="contract-first-card"
            onTutorialPress={() => openQuickSheet(item.contract)}
            scrollIntoView={scrollTutorialContractIntoView}
          >
            {card}
          </TutorialTarget>
        );
      }

      if (item.type === 'active') {
        return (
          <ActiveDeliveryCard
            delivery={item.delivery}
            trucks={player.trucks ?? []}
            drivers={player.drivers ?? []}
            onBoostSuccess={handleDeliveryBoostSuccess}
          />
        );
      }

      const linkedDelivery = findDeliveryForContract(item.contract.id, activeDeliveries);
      return (
        <CompletedContractCard
          contract={item.contract}
          netProfit={linkedDelivery?.estimatedProfit}
          fallbackPreview={completedPreviewById.get(item.contract.id)}
        />
      );
    },
    [
      contractPreviewById,
      player,
      highlightedContractId,
      firstTutorialContractId,
      scrollTutorialContractIntoView,
      activeDeliveries,
      completedPreviewById,
      openQuickSheet,
      handleDeliveryBoostSuccess,
    ],
  );

  const listExtraData = useMemo(() => {
    if (activeSegment === 'active') {
      return activeDeliveries
        .map((delivery) => `${delivery.id}:${Math.floor(delivery.progress * 100)}:${delivery.status}`)
        .join('|');
    }
    if (activeSegment === 'available') {
      return `${highlightedContractId ?? ''}:${monetization.totalRewardedAdsToday}`;
    }
    return activeSegment;
  }, [activeSegment, activeDeliveries, highlightedContractId, monetization.totalRewardedAdsToday]);

  const listHeader = useMemo(() => {
    if (activeSegment !== 'available') {
      return null;
    }

    return (
      <>
        <NextRouteHintCard deliveries={runningDeliveries} />

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
      </>
    );
  }, [
    activeSegment,
    runningDeliveries,
    marketContractFilter,
    marketFilterLine,
    marketMatchStats.exactMatchesCount,
    marketMatchStats.relatedMatchesCount,
    handleClearMarketFilter,
  ]);

  const listEmpty = useMemo(() => {
    if (activeSegment === 'available') {
      if (availableContracts.length === 0) {
        return (
          <EmptyState
            title="Şu anda piyasada sözleşme yok."
            message="Piyasa yeni fırsatlar oluşturdukça burada görünecek."
            icon="contract"
          />
        );
      }
      if (filteredContracts.length === 0) {
        return (
          <EmptyState
            title="Bu filtreye uygun sözleşme yok."
            message={
              hasActiveMarketFilter
                ? 'Filtreyi temizleyerek tüm müsait sözleşmeleri görebilirsin.'
                : 'Farklı bir filtre seçerek veya piyasanın yenilenmesini bekleyerek tekrar dene.'
            }
            icon="contract"
          />
        );
      }
      return null;
    }

    if (activeSegment === 'active') {
      return (
        <EmptyState
          title="Şu anda aktif teslimat yok."
          message="Yeni bir sözleşme başlattığında rotalar burada görünecek."
          icon="truck"
        />
      );
    }

    return (
      <EmptyState
        title="Henüz tamamlanan sözleşme yok."
        message="Tamamlanan işler burada listelenecek."
        icon="success"
      />
    );
  }, [
    activeSegment,
    availableContracts.length,
    filteredContracts.length,
    hasActiveMarketFilter,
  ]);

  return (
    <View style={styles.screenRoot}>
      <View style={[styles.safeArea, { paddingTop: screenTopPadding }]}>
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

        {onboardingHint ? (
          <OnboardingHintCard
            title={onboardingHint.title}
            description={onboardingHint.description}
            icon={onboardingHint.icon}
            badgeLabel={onboardingHint.badgeLabel}
            accentVariant={onboardingHint.accentVariant}
            onDismiss={onboardingHint.onDismiss}
            style={styles.onboardingHint}
          />
        ) : null}

        <ContractsSummaryStrip
          availableCount={availableContracts.length}
          activeCount={runningDeliveries.length}
          bestPayment={topSummary.bestPayment}
          playableCount={playableContractCount}
          trucks={trucks}
        />

        {showTruckLocationHint ? (
          <TruckLocationHintRow style={styles.truckLocationHint} />
        ) : null}

        {isRefreshOnCooldown ? (
          <View style={styles.adRewardStrip}>
            <AdRewardButton
              slotId="contract_refresh"
              label="Reklam izle, piyasayı şimdi yenile"
              description="Manuel yenileme bekleme süresini atla."
              context={{
                manualRefreshCooldownRemaining:
                  contractGenerationBalance.manualRefreshCooldownHours -
                  (currentTime - lastManualContractRefreshTime),
              }}
              onSuccess={handleAdRefreshSuccess}
              variant="secondary"
            />
          </View>
        ) : null}

        <ContractsTabBar
          segments={tabSegments}
          activeKey={activeSegment}
          onChange={setActiveSegment}
        />

        <FlatList
          ref={scrollRef}
          data={listItems}
          keyExtractor={(item) => item.key}
          renderItem={renderContractListItem}
          extraData={listExtraData}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          style={styles.listScroll}
          contentContainerStyle={[
            styles.listScrollContent,
            { paddingBottom: scrollBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={12}
          windowSize={8}
        />
      </View>

      <ContractQuickActionSheet
        visible={quickSheetVisible}
        contract={quickSheetContract}
        preview={
          quickSheetContract ? contractPreviewById.get(quickSheetContract.id) ?? null : null
        }
        trucks={player.trucks ?? []}
        drivers={player.drivers ?? []}
        playerLevel={player.level ?? player.companyLevel ?? 1}
        playerMoney={player.money ?? 0}
        onClose={closeQuickSheet}
        onStartDelivery={handleQuickStartDelivery}
        onOpenAdvancedAssignment={handleOpenAdvancedAssignment}
        onGoToFleet={handleGoToFleetFromQuick}
      />

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
    paddingHorizontal: spacing.lg,
  },
  onboardingHint: {
    marginBottom: 12,
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
  summaryStrip: {
    marginBottom: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 3,
  },
  summarySubline: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  truckLocationHint: {
    marginBottom: spacing.sm,
  },
  adRewardStrip: {
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  nextRouteHint: {
    marginBottom: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  nextRouteHintTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.cyan,
    marginBottom: 2,
  },
  nextRouteHintText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
    lineHeight: 15,
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
  listCardBlocked: {
    backgroundColor: '#0D1524',
    borderColor: 'rgba(148, 163, 184, 0.12)',
    opacity: 0.88,
  },
  listCardLocked: {
    backgroundColor: '#0A101C',
    borderColor: 'rgba(100, 116, 139, 0.12)',
    opacity: 0.72,
  },
  contractIconBoxMuted: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderColor: 'rgba(148, 163, 184, 0.12)',
  },
  contractTextMuted: {
    color: 'rgba(226, 232, 240, 0.72)',
  },
  contractSubtextMuted: {
    color: 'rgba(148, 163, 184, 0.75)',
  },
  contractPaymentMuted: {
    color: 'rgba(74, 222, 128, 0.55)',
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
  cardMetaLateRisk: {
    color: COLORS.red,
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
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '48%',
    flexShrink: 1,
    minWidth: 0,
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
  eventBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  eventBadgeText: {
    color: colors.accentAmber,
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
  deliveryBoostRow: {
    marginTop: spacing.sm,
  },
});
