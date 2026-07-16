/**
 * LogistiCore - Piyasa (Market) Ekranı
 *
 * Premium piyasa analizi: stoklar, fiyatlar ve taşıma fırsatları.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import MarketAlertModal from '../components/market/MarketAlertModal';
import ActiveMarketAlertsSection from '../components/market/ActiveMarketAlertsSection';
import ProductMarketDetailModal from '../components/market/ProductMarketDetailModal';
import ProductMiniTrendChart from '../components/market/ProductMiniTrendChart';
import TradeProductModal, { type TradeWarehouseOption } from '../components/TradeProductModal';
import { TutorialTarget } from '../tutorial/TutorialTarget';
import {
  ActionButton,
  AppCard,
  AppScreen,
  EmptyState,
  FilterChip,
  GameIcon,
  IconButton,
  ProductIcon,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SmallStatPill,
  StatusBadge,
} from '../components/ui';
import type { StatusBadgeVariant } from '../components/ui';
import { findMarketOpportunities } from '../simulation/contracts';
import { countMarketContractMatches } from '../utils/marketContractMatch';
import { getSafeFuelPrice } from '../simulation/economy';
import { getCityName, getProductName } from '../utils/entityLookup';
import {
  calculateStockRatio,
  getCityProductInventorySummary,
  getMarketStatus,
  getProductMarket,
  type CityProductInventorySummary,
  type NormalizedProductMarket,
} from '../utils/marketProductViewModel';
import {
  getMarketStatusColorVariant,
  getMarketStatusHint,
  getMarketStatusLabel,
  getMarketStatusShortLabel,
} from '../utils/marketStatusLabels';
import {
  formatTrendChangeDisplay,
  getProductPriceTrend,
} from '../utils/productPriceTrend';
import {
  calculateTradeProfit,
  getCityProductMarketPrice,
  getCityProductStock,
  getWarehouseFreeCapacityTon,
  getWarehouseInventoryItem,
  normalizeWarehouse,
} from '../simulation/trading';
import {
  cityHasWarehouseType,
  evaluateStorageSuitability,
  getEffectiveSellPrice,
  getStorageRiskWarning,
  getSuitabilityLabel,
  getWarehouseTypeLabel,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import { useGameStore } from '../store/gameStore';
import {
  colors,
  formatGameTimeCompact,
  formatMoney,
  formatUnitPrice,
  isFuelExpensiveForDisplay,
  spacing,
  typography,
} from '../theme';
import type {
  City,
  MarketOpportunity,
  MarketPriceAlert,
  MarketPriceAlertCondition,
  Product,
  ProductId,
  Route,
  Warehouse,
} from '../types/game';
import type { TradeProductModalMode } from '../components/TradeProductModal';

const CRITICAL_SHORTAGE_RATIO = 0.35;
const HIGH_SURPLUS_RATIO = 1.5;
const SHORTAGE_THRESHOLD = 0.7;
const SURPLUS_THRESHOLD = 1.2;
const STATUS_MESSAGE_TIMEOUT_MS = 2000;
const MAX_OPPORTUNITIES = 3;
const OPPORTUNITY_SCORE_CAP = 2500;

type MarketTab = 'products' | 'opportunities';
type MarketMood = 'Sakin' | 'Hareketli' | 'Fırsatlı' | 'Kriz';

const MARKET_TABS = [
  { key: 'products' as const, label: 'Ürünler', icon: 'inventory' as const },
  { key: 'opportunities' as const, label: 'Fırsatlar', icon: 'route' as const },
];

interface MarketHighlight {
  cityId: string;
  productId: ProductId;
  stockRatio: number;
}

/** Ham piyasa skorunu 0-100 aralığına normalize eder — yalnızca UI gösterimi */
function normalizeOpportunityScore(rawScore: number | undefined | null): number {
  const safe = Number(rawScore ?? 0);
  if (!Number.isFinite(safe) || safe <= 0) return 0;

  if (safe <= 1) {
    return Math.min(100, Math.round(safe * 100));
  }

  if (safe <= 100) {
    return Math.round(safe);
  }

  const capped = Math.min(safe, OPPORTUNITY_SCORE_CAP);
  if (capped >= 2000) return 100;
  if (capped >= 1200) {
    return 75 + Math.round(((capped - 1200) / 800) * 25);
  }
  if (capped >= 700) {
    return 50 + Math.round(((capped - 700) / 500) * 25);
  }
  return Math.min(49, Math.round((capped / 700) * 49));
}

function formatOpportunityScoreDisplay(rawScore: number | undefined | null): string {
  return `${normalizeOpportunityScore(rawScore)}/100`;
}

function getOpportunityPotential(normalizedScore: number): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (normalizedScore >= 80) {
    return { label: 'Çok güçlü', variant: 'success' };
  }
  if (normalizedScore >= 60) {
    return { label: 'Güçlü', variant: 'success' };
  }
  if (normalizedScore >= 40) {
    return { label: 'Orta', variant: 'warning' };
  }
  return { label: 'Zayıf', variant: 'muted' };
}

function getStockBarColor(stockRatio: number): string {
  if (stockRatio < 0.3) return colors.danger;
  if (stockRatio < 0.7) return colors.accentAmber;
  if (stockRatio <= 1.2) return colors.info;
  return colors.success;
}

function getPriceChangePercent(market: NormalizedProductMarket): number {
  if (!market.basePrice) return 0;
  return (market.currentPrice - market.basePrice) / market.basePrice;
}

function getOpportunityHint(market: NormalizedProductMarket): string {
  const stockRatio = calculateStockRatio(market);
  return getMarketStatusHint(getMarketStatus(stockRatio));
}

function getDemandLevelLabel(level: MarketOpportunity['demandLevel']): string {
  switch (level) {
    case 'high':
      return 'Yüksek';
    case 'medium':
      return 'Orta';
    default:
      return 'Düşük';
  }
}

function getOpportunityStrength(normalizedScore: number): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (normalizedScore >= 75) {
    return { label: 'Güçlü fırsat', variant: 'success' };
  }
  if (normalizedScore >= 50) {
    return { label: 'İyi fırsat', variant: 'info' };
  }
  return { label: 'Orta fırsat', variant: 'muted' };
}

function findMarketHighlights(cities: City[], products: Product[]): {
  criticalShortage: MarketHighlight | null;
  highestSurplus: MarketHighlight | null;
  criticalCount: number;
} {
  let criticalShortage: MarketHighlight | null = null;
  let highestSurplus: MarketHighlight | null = null;
  let criticalCount = 0;

  for (const city of cities) {
    for (const product of products) {
      const market = getProductMarket(city, product.id);
      if (!market) continue;

      const stockRatio = calculateStockRatio(market);

      if (stockRatio < CRITICAL_SHORTAGE_RATIO) {
        criticalCount += 1;
        if (!criticalShortage || stockRatio < criticalShortage.stockRatio) {
          criticalShortage = { cityId: city.id, productId: product.id, stockRatio };
        }
      }

      if (
        stockRatio > HIGH_SURPLUS_RATIO &&
        (!highestSurplus || stockRatio > highestSurplus.stockRatio)
      ) {
        highestSurplus = { cityId: city.id, productId: product.id, stockRatio };
      }
    }
  }

  return { criticalShortage, highestSurplus, criticalCount };
}

function MarketStatusSummary({
  mood,
  criticalCount,
  opportunityCount,
}: {
  mood: MarketMood;
  criticalCount: number;
  opportunityCount: number;
}) {
  return (
    <Text style={styles.marketStatusSummary} numberOfLines={1}>
      Piyasa durumu: {mood} · {criticalCount} talep · {opportunityCount} fırsat
    </Text>
  );
}

interface MarketMetricStripProps {
  fuelPrice: number;
  currentTime: number;
  criticalCount: number;
  opportunityCount: number;
}

function MarketMetricStrip({
  fuelPrice,
  currentTime,
  criticalCount,
  opportunityCount,
}: MarketMetricStripProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.metricStrip}
    >
      <SmallStatPill
        label="Yakıt"
        value={formatUnitPrice(fuelPrice, '/L')}
        icon="fuel"
        accentColor={isFuelExpensiveForDisplay(fuelPrice) ? colors.danger : colors.accentAmber}
        layout="chip"
        dense
      />
      <SmallStatPill
        label="Zaman"
        value={formatGameTimeCompact(currentTime)}
        icon="time"
        accentColor={colors.info}
        layout="chip"
        dense
      />
      <SmallStatPill
        label="Hareket"
        value={String(criticalCount)}
        icon="warning"
        accentColor={criticalCount > 0 ? colors.danger : colors.success}
        layout="chip"
        dense
      />
      <SmallStatPill
        label="Fırsat"
        value={`${opportunityCount}`}
        icon="contract"
        accentColor={colors.accentBlue}
        layout="chip"
        dense
      />
    </ScrollView>
  );
}

function CompactCitySummary({
  cityName,
  shortages,
  surpluses,
  avgPrice,
}: {
  cityName: string;
  shortages: number;
  surpluses: number;
  avgPrice: number;
}) {
  return (
    <View style={styles.citySummaryRow}>
      <View style={styles.citySummaryItem}>
        <Text style={[styles.citySummaryValue, { color: colors.danger }]}>{shortages}</Text>
        <Text style={styles.citySummaryLabel}>
          {getMarketStatusShortLabel('Kıtlık')}
        </Text>
      </View>
      <View style={styles.citySummaryItem}>
        <Text style={[styles.citySummaryValue, { color: colors.success }]}>{surpluses}</Text>
        <Text style={styles.citySummaryLabel}>Stok Fazla</Text>
      </View>
      <View style={styles.citySummaryItem}>
        <Text style={[styles.citySummaryValue, { color: colors.accentAmber }]}>
          {formatMoney(avgPrice)}
        </Text>
        <Text style={styles.citySummaryLabel}>Ort. fiyat</Text>
      </View>
      <Text style={styles.citySummaryName} numberOfLines={1}>
        {cityName}
      </Text>
    </View>
  );
}

interface MarketVolatilitySnapshot {
  avgChange: number;
  avgVolatility: number;
}

function computeMarketVolatility(cities: City[], products: Product[]): MarketVolatilitySnapshot {
  let changeSum = 0;
  let volatilitySum = 0;
  let count = 0;

  for (const city of cities) {
    for (const product of products) {
      const market = getProductMarket(city, product.id);
      if (!market) continue;
      const change = getPriceChangePercent(market);
      changeSum += change;
      volatilitySum += Math.abs(change);
      count += 1;
    }
  }

  if (count === 0) {
    return { avgChange: 0, avgVolatility: 0 };
  }

  return {
    avgChange: changeSum / count,
    avgVolatility: volatilitySum / count,
  };
}

function getMarketMood(
  criticalCount: number,
  opportunityCount: number,
  avgVolatility: number,
): MarketMood {
  if (criticalCount >= 2) return 'Kriz';
  if (opportunityCount >= 2) return 'Fırsatlı';
  if (avgVolatility > 0.08 || opportunityCount >= 1) return 'Hareketli';
  return 'Sakin';
}

function resolveBuyButtonState({
  hasWarehouse,
  canBuy,
  marketStock,
  freeCapacity,
  playerMoney,
}: {
  hasWarehouse: boolean;
  canBuy: boolean;
  marketStock: number;
  freeCapacity: number;
  playerMoney: number;
}): { label: string; disabled: boolean } {
  if (!hasWarehouse) {
    return { label: 'Depo gerekli', disabled: true };
  }
  if (canBuy) {
    return { label: 'Satın Al', disabled: false };
  }
  if (marketStock <= 0) {
    return { label: 'Stok yok', disabled: true };
  }
  if (freeCapacity <= 0) {
    return { label: 'Depo dolu', disabled: true };
  }
  if (playerMoney <= 0) {
    return { label: 'Nakit yetersiz', disabled: true };
  }
  return { label: 'Satın Al', disabled: true };
}

function formatEstimatedProfitLabel(profit: number): { label: string; color: string } {
  if (Math.abs(profit) < 1) {
    return { label: 'Başabaş', color: colors.textMuted };
  }
  if (profit > 0) {
    return { label: `Kâr: +${formatMoney(profit)}`, color: colors.success };
  }
  return { label: `Zarar: ${formatMoney(profit)}`, color: colors.danger };
}

function ProductMarketCard({
  cityId,
  currentTime,
  market,
  hasWarehouse,
  depotQuantity,
  estimatedProfit,
  canSell,
  buyButtonLabel,
  buyButtonDisabled,
  onBuyPress,
  onSellPress,
  onAlarmPress,
  onPress,
}: {
  cityId: string;
  currentTime: number;
  market: NormalizedProductMarket;
  hasWarehouse: boolean;
  depotQuantity: number;
  estimatedProfit: number | null;
  canSell: boolean;
  buyButtonLabel: string;
  buyButtonDisabled: boolean;
  onBuyPress: () => void;
  onSellPress: () => void;
  onAlarmPress: () => void;
  onPress?: () => void;
}) {
  const stockRatio = calculateStockRatio(market);
  const status = getMarketStatus(stockRatio);
  const statusVariant = getMarketStatusColorVariant(status);
  const hint = getOpportunityHint(market);
  const progressValue = Math.min(stockRatio, 2) / 2;
  const trend = getProductPriceTrend({
    cityId,
    productId: market.productId,
    currentTime,
    marketState: {
      currentPrice: market.currentPrice,
      basePrice: market.basePrice,
      priceHistory: market.priceHistory,
    },
  });
  const priceChangeDisplay = formatTrendChangeDisplay(trend);
  const profitDisplay =
    hasWarehouse && depotQuantity > 0 && estimatedProfit != null
      ? formatEstimatedProfitLabel(estimatedProfit)
      : null;

  const cardMainContent = (
    <>
      <View style={styles.cardTopRow}>
        <View style={styles.productIconBox}>
          <ProductIcon productId={market.productId} size={15} color={colors.info} />
        </View>

        <View style={styles.cardMain}>
          <Text style={styles.productName} numberOfLines={1} ellipsizeMode="tail">
            {getProductName(market.productId)}
          </Text>
        </View>

        <View style={styles.cardRight}>
          <Text style={styles.productPrice} numberOfLines={1}>
            {formatMoney(market.currentPrice)}
          </Text>
          <Text style={styles.productPriceUnit} numberOfLines={1}>
            / ton
          </Text>
          <Text
            style={[styles.priceChangeText, { color: priceChangeDisplay.color }]}
            numberOfLines={1}
          >
            {priceChangeDisplay.label}
          </Text>
        </View>
      </View>

      <View style={styles.productMetaRow}>
        <StatusBadge
          label={getMarketStatusLabel(status)}
          variant={statusVariant}
          size="sm"
        />
        <Text style={[styles.trendLabel, { color: trend.color }]} numberOfLines={1}>
          {trend.label}
        </Text>
      </View>

      <View style={styles.chartRow}>
        <ProductMiniTrendChart trend={trend} />
      </View>

      {hasWarehouse ? (
        depotQuantity > 0 ? (
          <Text style={styles.depotText} numberOfLines={1}>
            Depoda: {depotQuantity.toFixed(1)} t
            {profitDisplay ? (
              <Text style={{ color: profitDisplay.color }}> · {profitDisplay.label}</Text>
            ) : null}
          </Text>
        ) : (
          <Text style={styles.depotMutedText} numberOfLines={1}>
            Depoda stok yok
          </Text>
        )
      ) : (
        <Text style={styles.depotMutedText} numberOfLines={1}>
          Bu şehirde depo yok
        </Text>
      )}

      <Text style={styles.productHint} numberOfLines={1}>
        {hint}
      </Text>
    </>
  );

  const cardFooter = (
    <View style={styles.productFooterRow}>
      <View style={styles.productProgress}>
        <ProgressBar progress={progressValue} color={getStockBarColor(stockRatio)} height={2} />
      </View>
      <View style={styles.productActions}>
        <ActionButton
          label={buyButtonLabel}
          onPress={onBuyPress}
          variant="primary"
          icon="cash"
          iconSize={11}
          compact
          disabled={buyButtonDisabled}
          style={styles.productAction}
        />
        {canSell ? (
          <ActionButton
            label="Sat"
            onPress={onSellPress}
            variant="secondary"
            icon="market"
            iconSize={11}
            compact
            style={styles.productAction}
          />
        ) : null}
        <ActionButton
          label="Alarm"
          onPress={onAlarmPress}
          variant="secondary"
          icon="notification"
          iconSize={11}
          compact
          style={styles.productActionAlarm}
        />
      </View>
    </View>
  );

  return (
    <AppCard style={styles.productCard} padded={false}>
      {onPress ? (
        <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
          {cardMainContent}
        </TouchableOpacity>
      ) : (
        cardMainContent
      )}
      {cardFooter}
    </AppCard>
  );
}

function OpportunityCard({
  opportunity,
  exactMatchesCount,
  relatedMatchesCount,
  onViewContracts,
}: {
  opportunity: MarketOpportunity;
  exactMatchesCount: number;
  relatedMatchesCount: number;
  onViewContracts: (opportunity: MarketOpportunity) => void;
}) {
  const normalizedScore = normalizeOpportunityScore(opportunity.score);
  const strength = getOpportunityStrength(normalizedScore);
  const potential = getOpportunityPotential(normalizedScore);
  const hasExactMatches = exactMatchesCount > 0;
  const hasRelatedMatches = relatedMatchesCount > 0;
  const hasAnyMatches = hasExactMatches || hasRelatedMatches;

  return (
    <AppCard style={styles.opportunityCard} padded>
      <View style={styles.cardTopRow}>
        <View style={styles.productIconBox}>
          <GameIcon name="route" size={16} color={colors.accentBlue} />
        </View>
        <View style={styles.cardMain}>
          <Text style={styles.opportunityRoute} numberOfLines={1}>
            {opportunity.fromCityName || getCityName(opportunity.fromCityId)} →{' '}
            {opportunity.toCityName || getCityName(opportunity.toCityId)}
          </Text>
          <Text style={styles.opportunityProduct} numberOfLines={1}>
            Ürün: {opportunity.productName}
          </Text>
        </View>
        <StatusBadge label={strength.label} variant={strength.variant} size="sm" />
      </View>

      <View style={styles.opportunityMetrics}>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          Fiyat farkı: <Text style={styles.opportunityValue}>{formatMoney(opportunity.priceGap)}</Text>
          {' · '}
          Mesafe: <Text style={styles.opportunityValue}>{Math.round(opportunity.distanceKm ?? 0)} km</Text>
        </Text>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          Talep: <Text style={styles.opportunityValue}>{getDemandLevelLabel(opportunity.demandLevel)}</Text>
          {' · '}
          Potansiyel: <Text style={styles.opportunityValue}>{potential.label}</Text>
          {' · '}
          Skor: <Text style={styles.opportunityValue}>{formatOpportunityScoreDisplay(opportunity.score)}</Text>
        </Text>
        <Text style={styles.opportunityLine} numberOfLines={1}>
          {hasAnyMatches ? (
            hasExactMatches && hasRelatedMatches ? (
              <Text style={styles.opportunityValue}>
                {exactMatchesCount} tam · {relatedMatchesCount} yakın iş
              </Text>
            ) : hasExactMatches ? (
              <>
                Tam eşleşme:{' '}
                <Text style={[styles.opportunityValue, { color: colors.success }]}>
                  {exactMatchesCount}
                </Text>
              </>
            ) : (
              <>
                Yakın iş:{' '}
                <Text style={[styles.opportunityValue, { color: colors.accentAmber }]}>
                  {relatedMatchesCount}
                </Text>
              </>
            )
          ) : (
            <Text style={styles.opportunityPending}>Uygun sözleşme bekleniyor</Text>
          )}
        </Text>
      </View>

      <ActionButton
        label="Sözleşmeleri Gör"
        onPress={() => onViewContracts(opportunity)}
        variant="primary"
        icon="contract"
        iconSize={12}
        compact
        style={styles.opportunityAction}
      />
    </AppCard>
  );
}

interface MarketScreenProps {
  onOpenContracts?: () => void;
}

export default function MarketScreen({ onOpenContracts }: MarketScreenProps) {
  const { alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const currentTime = useGameStore((state) => state.currentTime);

  const refreshMarketSnapshot = useGameStore((state) => state.refreshMarketSnapshot);
  const openContractsForMarketOpportunity = useGameStore(
    (state) => state.openContractsForMarketOpportunity,
  );
  const buyProductForWarehouse = useGameStore((state) => state.buyProductForWarehouse);
  const sellProductFromWarehouse = useGameStore((state) => state.sellProductFromWarehouse);
  const notifyMarketScreenOpened = useGameStore((state) => state.notifyMarketScreenOpened);
  const marketAlerts = useGameStore((state) => state.marketAlerts) ?? [];
  const createMarketPriceAlert = useGameStore((state) => state.createMarketPriceAlert);
  const deleteMarketPriceAlert = useGameStore((state) => state.deleteMarketPriceAlert);
  const pendingMarketFocus = useGameStore((state) => state.pendingMarketFocus);
  const clearPendingMarketFocus = useGameStore((state) => state.clearPendingMarketFocus);

  const [activeTab, setActiveTab] = useState<MarketTab>('products');
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [tradeMode, setTradeMode] = useState<TradeProductModalMode>('buy');
  const [tradeProductId, setTradeProductId] = useState<ProductId | null>(null);
  const [alertModalVisible, setAlertModalVisible] = useState(false);
  const [alertProductId, setAlertProductId] = useState<ProductId | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailProductId, setDetailProductId] = useState<ProductId | null>(null);

  useEffect(() => {
    if (!pendingMarketFocus) return;
    setActiveTab('products');
    setSelectedCityId(pendingMarketFocus.cityId);
    clearPendingMarketFocus();
  }, [pendingMarketFocus, clearPendingMarketFocus]);

  const activeMarketAlerts = useMemo(
    () => marketAlerts.filter((alert) => alert.isActive && !alert.triggeredAt),
    [marketAlerts],
  );

  const alertProduct = useMemo(
    () => products.find((item) => item.id === alertProductId) ?? null,
    [products, alertProductId],
  );

  const fuelPrice = getSafeFuelPrice(globalEconomy);

  useEffect(() => {
    notifyMarketScreenOpened();
  }, [notifyMarketScreenOpened]);

  useEffect(() => {
    if (!selectedCityId && cities.length > 0) {
      setSelectedCityId(cities[0].id);
    }
  }, [cities, selectedCityId]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const marketHighlights = useMemo(
    () => findMarketHighlights(cities, products),
    [cities, products],
  );

  const opportunities = useMemo(
    () => findMarketOpportunities(cities, routes, products, MAX_OPPORTUNITIES),
    [cities, routes, products],
  );

  const availableContracts = useMemo(
    () => contracts.filter((contract) => contract.status === 'available'),
    [contracts],
  );

  const opportunityMatchCounts = useMemo(() => {
    const counts = new Map<string, { exactMatchesCount: number; relatedMatchesCount: number }>();
    for (const opportunity of opportunities) {
      counts.set(
        opportunity.id,
        countMarketContractMatches(availableContracts, {
          fromCityId: opportunity.fromCityId,
          toCityId: opportunity.toCityId,
          productId: opportunity.productId,
        }),
      );
    }
    return counts;
  }, [opportunities, availableContracts]);

  const selectedCity = useMemo(
    () => cities.find((c) => c.id === selectedCityId) ?? null,
    [cities, selectedCityId],
  );

  const selectedCityOverview = useMemo(() => {
    if (!selectedCity) {
      return { shortages: 0, surpluses: 0, avgPrice: 0, fuelModifier: 1 };
    }

    let shortages = 0;
    let surpluses = 0;
    let priceTotal = 0;
    let priceCount = 0;

    for (const product of products) {
      const market = getProductMarket(selectedCity, product.id);
      if (!market) continue;

      const ratio = calculateStockRatio(market);
      if (ratio < SHORTAGE_THRESHOLD) shortages += 1;
      if (ratio > SURPLUS_THRESHOLD) surpluses += 1;
      priceTotal += market.currentPrice;
      priceCount += 1;
    }

    return {
      shortages,
      surpluses,
      avgPrice: priceCount > 0 ? priceTotal / priceCount : 0,
      fuelModifier: selectedCity.fuelPriceModifier ?? 1,
    };
  }, [selectedCity, products]);

  const selectedCityWarehouses = useMemo(() => {
    if (!selectedCity) return [];
    return (player?.warehouses ?? [])
      .filter((item) => item.cityId === selectedCity.id)
      .map((item) => normalizeWarehouse(item));
  }, [player?.warehouses, selectedCity]);

  const tradeProduct = useMemo(
    () => products.find((item) => item.id === tradeProductId) ?? null,
    [products, tradeProductId],
  );

  const tradeWarehouseOptions = useMemo((): TradeWarehouseOption[] => {
    if (!tradeProduct || !selectedCity) return [];

    return selectedCityWarehouses.map((warehouse) => {
      const warehouseType = resolveWarehouseType(warehouse.warehouseType);
      const suitability = evaluateStorageSuitability(tradeProduct, warehouseType);
      const cityName = selectedCity.name;
      const typeLabel = getWarehouseTypeLabel(warehouseType);
      return {
        id: warehouse.id,
        name: `${cityName} · ${typeLabel}`,
        warehouseType,
        freeCapacity: getWarehouseFreeCapacityTon(warehouse),
        suitability,
        suitabilityLabel: getSuitabilityLabel(suitability),
        warning: getStorageRiskWarning(tradeProduct, warehouseType),
        disabled: suitability === 'blocked',
      };
    });
  }, [selectedCityWarehouses, tradeProduct, selectedCity]);

  const showColdWarehouseSuggestion = useMemo(() => {
    if (!selectedCity || !tradeProduct) return false;
    return !cityHasWarehouseType(player?.warehouses ?? [], selectedCity.id, 'cold');
  }, [player?.warehouses, selectedCity, tradeProduct]);

  const selectedCityTotalFreeCapacity = useMemo(
    () =>
      selectedCityWarehouses.reduce((sum, warehouse) => sum + getWarehouseFreeCapacityTon(warehouse), 0),
    [selectedCityWarehouses],
  );

  const cityInventoryByProduct = useMemo(() => {
    const map = new Map<ProductId, CityProductInventorySummary>();
    for (const product of products) {
      map.set(product.id, getCityProductInventorySummary(selectedCityWarehouses, product.id));
    }
    return map;
  }, [products, selectedCityWarehouses]);

  const tradeSellInventory = useMemo(() => {
    if (tradeMode !== 'sell' || !tradeProductId) {
      return null;
    }
    return cityInventoryByProduct.get(tradeProductId) ?? null;
  }, [tradeMode, tradeProductId, cityInventoryByProduct]);

  const marketVolatility = useMemo(
    () => computeMarketVolatility(cities, products),
    [cities, products],
  );

  const marketMood = useMemo(
    () =>
      getMarketMood(
        marketHighlights.criticalCount,
        opportunities.length,
        marketVolatility.avgVolatility,
      ),
    [marketHighlights.criticalCount, opportunities.length, marketVolatility.avgVolatility],
  );

  const closeTradeModal = () => {
    setTradeModalVisible(false);
    setTradeProductId(null);
    setTradeMode('buy');
  };

  const handleBuyProductPress = (productId: ProductId) => {
    if (!selectedCity) return;

    if (selectedCityWarehouses.length === 0) {
      showAlert(
        'Depo gerekli',
        'Bu şehirden ürün almak için önce burada depo açmalısın.',
      );
      return;
    }

    setTradeMode('buy');
    setTradeProductId(productId);
    setTradeModalVisible(true);
  };

  const handleSellProductPress = (productId: ProductId) => {
    if (!selectedCity) return;

    const inventory = cityInventoryByProduct.get(productId);
    if (!inventory || inventory.quantity <= 0) {
      showAlert('Stok yok', 'Bu şehirdeki depolarında satılacak ürün bulunmuyor.');
      return;
    }

    setTradeMode('sell');
    setTradeProductId(productId);
    setTradeModalVisible(true);
  };

  const closeAlertModal = () => {
    setAlertModalVisible(false);
    setAlertProductId(null);
  };

  const handleAlarmProductPress = (productId: ProductId) => {
    if (!selectedCity) return;
    setAlertProductId(productId);
    setAlertModalVisible(true);
  };

  const handleProductCardPress = (productId: ProductId) => {
    if (!selectedCity) return;
    setDetailProductId(productId);
    setDetailModalVisible(true);
  };

  const closeDetailModal = () => {
    setDetailModalVisible(false);
    setDetailProductId(null);
  };

  const handleConfirmAlert = async (input: {
    condition: MarketPriceAlertCondition;
    targetPrice: number;
  }) => {
    if (!selectedCity || !alertProductId) return;

    const result = await createMarketPriceAlert({
      cityId: selectedCity.id,
      productId: alertProductId,
      condition: input.condition,
      targetPrice: input.targetPrice,
    });

    if (!result.success) {
      showAlert('Alarm kurulamadı', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }

    closeAlertModal();
    if (result.message?.includes('Bildirim izni kapalı')) {
      showAlert('Bildirim izni', result.message);
    }
    setStatusMessage(result.message ?? 'Alarm kuruldu');
  };

  const handleDeleteMarketAlert = async (alertId: string) => {
    const result = await deleteMarketPriceAlert(alertId);
    if (!result.success) {
      showAlert('Silinemedi', result.message ?? 'Alarm silinemedi.');
      return;
    }
    setStatusMessage(result.message ?? 'Alarm silindi');
  };

  const handlePressMarketAlert = (alert: MarketPriceAlert) => {
    setSelectedCityId(alert.cityId);
    setActiveTab('products');
    setStatusMessage(`${getCityName(alert.cityId)} · ${getProductName(alert.productId)} seçildi`);
  };

  const handleConfirmBuy = (quantity: number, warehouseId?: string) => {
    if (!selectedCity || !tradeProductId || !warehouseId) return;

    const result = buyProductForWarehouse({
      cityId: selectedCity.id,
      productId: tradeProductId,
      quantity,
      warehouseId,
    });

    if (!result.success) {
      showAlert('Satın alma başarısız', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }

    closeTradeModal();
    setStatusMessage(result.message ?? 'Ürün satın alındı');
  };

  const handleConfirmSell = (quantity: number) => {
    if (!tradeProductId || quantity <= 0) return;

    const warehousesWithStock = selectedCityWarehouses
      .map((warehouse) => {
        const item = getWarehouseInventoryItem(warehouse, tradeProductId);
        return {
          warehouseId: warehouse.id,
          quantity: item?.quantity ?? 0,
        };
      })
      .filter((entry) => entry.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);

    if (warehousesWithStock.length === 0) {
      showAlert('Stok yok', 'Bu şehirdeki depolarında satılacak ürün bulunmuyor.');
      return;
    }

    let remaining = quantity;
    let lastMessage: string | undefined;
    let soldAny = false;

    for (const entry of warehousesWithStock) {
      if (remaining <= 0) break;
      const sellQty = Math.min(remaining, entry.quantity);
      const result = sellProductFromWarehouse({
        warehouseId: entry.warehouseId,
        productId: tradeProductId,
        quantity: sellQty,
      });

      if (!result.success) {
        if (!soldAny) {
          showAlert('Satış başarısız', result.message ?? 'İşlem tamamlanamadı.');
          return;
        }
        break;
      }

      soldAny = true;
      remaining -= sellQty;
      lastMessage = result.message;
    }

    if (!soldAny) {
      showAlert('Satış başarısız', 'İşlem tamamlanamadı.');
      return;
    }

    closeTradeModal();
    setStatusMessage(lastMessage ?? 'Ürün satıldı');
  };

  const handleConfirmTrade = (quantity: number, warehouseId?: string) => {
    if (tradeMode === 'sell') {
      handleConfirmSell(quantity);
      return;
    }
    handleConfirmBuy(quantity, warehouseId);
  };

  const handleOpenWarehouses = () => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
    closeTradeModal();
  };

  const handleRefreshMarket = () => {
    refreshMarketSnapshot();
    setStatusMessage('Piyasa güncellendi');
  };

  const handleOpenContractsForOpportunity = (opportunity: MarketOpportunity) => {
    if (__DEV__) {
      console.log('Market opportunity pressed', opportunity);
    }

    if (!opportunity.fromCityId || !opportunity.toCityId || !opportunity.productId) {
      console.warn('[MarketScreen] Opportunity missing route ids', opportunity.id);
      return;
    }

    const normalizedOpportunity: MarketOpportunity = {
      ...opportunity,
      fromCityName: opportunity.fromCityName || getCityName(opportunity.fromCityId),
      toCityName: opportunity.toCityName || getCityName(opportunity.toCityId),
      productName: opportunity.productName || getProductName(opportunity.productId),
      demandLevel: opportunity.demandLevel ?? 'medium',
    };

    openContractsForMarketOpportunity(normalizedOpportunity);
    onOpenContracts?.();
    setStatusMessage('İşler ekranında ilgili sözleşmeler öne çıkarıldı.');
  };

  if (!player) {
    return (
      <AppScreen>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </AppScreen>
    );
  }

  if (cities.length === 0 || products.length === 0) {
    return (
      <AppScreen>
        <EmptyState
          title="Piyasa verisi yok"
          message="Şehir ve ürün verileri henüz yüklenmedi."
          icon="market"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll>
      <ScreenHeader
        title="Piyasa"
        subtitle="Fiyatları izle, al veya sat"
        rightAction={
          <IconButton icon="refresh" onPress={handleRefreshMarket} size={20} color={colors.textSecondary} />
        }
      />

      {statusMessage ? (
        <AppCard variant="success" style={styles.statusBanner} padded>
          <View style={styles.statusBannerRow}>
            <GameIcon name="success" size={14} color={colors.success} />
            <Text style={styles.statusBannerText}>{statusMessage}</Text>
          </View>
        </AppCard>
      ) : null}

      <MarketMetricStrip
        fuelPrice={fuelPrice}
        currentTime={currentTime}
        criticalCount={marketHighlights.criticalCount}
        opportunityCount={opportunities.length}
      />

      <MarketStatusSummary
        mood={marketMood}
        criticalCount={marketHighlights.criticalCount}
        opportunityCount={opportunities.length}
      />

      <SegmentedControl
        options={MARKET_TABS}
        activeKey={activeTab}
        onChange={setActiveTab}
        accentColor={colors.accentBlue}
        compact
      />

      {activeTab === 'products' ? (
        <View style={styles.tabContent}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={styles.cityChipRow}
          >
            {cities.map((city) => (
              <FilterChip
                key={city.id}
                label={city.name}
                selected={city.id === selectedCityId}
                onPress={() => setSelectedCityId(city.id)}
                accentColor={colors.accentAmber}
                compact
              />
            ))}
          </ScrollView>

          <ActiveMarketAlertsSection
            alerts={activeMarketAlerts}
            selectedCityId={selectedCityId}
            onPressAlert={handlePressMarketAlert}
            onDeleteAlert={(alertId) => void handleDeleteMarketAlert(alertId)}
          />

          {!selectedCity ? (
            <EmptyState title="Şehir seç" message="Ürün fiyatlarını görmek için bir şehir seç." icon="city" />
          ) : (
            <>
              <CompactCitySummary
                cityName={selectedCity.name}
                shortages={selectedCityOverview.shortages}
                surpluses={selectedCityOverview.surpluses}
                avgPrice={selectedCityOverview.avgPrice}
              />

              <TutorialTarget id="market-products-section">
                <SectionTitle
                  title="Ürün Piyasası"
                  subtitle={`${selectedCity.name} · alım ve satım`}
                  compact
                />
              </TutorialTarget>

              {products.every((product) => !getProductMarket(selectedCity, product.id)) ? (
                <EmptyState title="Ürün verisi yok" icon="inventory" />
              ) : (
                (() => {
                  let firstProductWrapped = false;
                  return products.map((product) => {
                    const market = getProductMarket(selectedCity, product.id);
                    if (!market) return null;

                    const hasWarehouse = selectedCityWarehouses.length > 0;
                    const inventory = cityInventoryByProduct.get(product.id) ?? {
                      quantity: 0,
                      averageBuyPrice: 0,
                      quality: 100,
                      primaryWarehouseId: null,
                    };
                    const estimatedProfit =
                      inventory.quantity > 0
                        ? calculateTradeProfit(
                            market.currentPrice,
                            inventory.averageBuyPrice,
                            inventory.quantity,
                            inventory.quality,
                          )
                        : null;
                    const canBuy =
                      hasWarehouse &&
                      market.stock > 0 &&
                      selectedCityTotalFreeCapacity > 0 &&
                      (player?.money ?? 0) > 0;
                    const canSell = hasWarehouse && inventory.quantity > 0;
                    const buyButton = resolveBuyButtonState({
                      hasWarehouse,
                      canBuy,
                      marketStock: market.stock,
                      freeCapacity: selectedCityTotalFreeCapacity,
                      playerMoney: player?.money ?? 0,
                    });

                    const card = (
                      <ProductMarketCard
                        cityId={selectedCity.id}
                        currentTime={currentTime}
                        market={market}
                        hasWarehouse={hasWarehouse}
                        depotQuantity={inventory.quantity}
                        estimatedProfit={estimatedProfit}
                        canSell={canSell}
                        buyButtonLabel={buyButton.label}
                        buyButtonDisabled={buyButton.disabled}
                        onBuyPress={() => handleBuyProductPress(product.id)}
                        onSellPress={() => handleSellProductPress(product.id)}
                        onAlarmPress={() => handleAlarmProductPress(product.id)}
                        onPress={() => handleProductCardPress(product.id)}
                      />
                    );

                    if (firstProductWrapped) {
                      return <React.Fragment key={product.id}>{card}</React.Fragment>;
                    }

                    firstProductWrapped = true;
                    return (
                      <TutorialTarget key={product.id} id="market-first-product">
                        {card}
                      </TutorialTarget>
                    );
                  });
                })()
              )}
            </>
          )}
        </View>
      ) : null}

      {activeTab === 'opportunities' ? (
        <View style={styles.tabContent}>
          <SectionTitle
            title="Fırsat Tarayıcı"
            subtitle="Şehirler arası fiyat farklarına göre olası kârlı rotalar."
            compact
          />

          {opportunities.length === 0 ? (
            <EmptyState
              title="Şu anda güçlü fırsat bulunamadı"
              message="Piyasa değiştikçe yeni fırsatlar oluşacak."
              icon="route"
            />
          ) : (
            opportunities.map((opportunity, index) => {
              const matchCounts = opportunityMatchCounts.get(opportunity.id) ?? {
                exactMatchesCount: 0,
                relatedMatchesCount: 0,
              };
              const card = (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  exactMatchesCount={matchCounts.exactMatchesCount}
                  relatedMatchesCount={matchCounts.relatedMatchesCount}
                  onViewContracts={handleOpenContractsForOpportunity}
                />
              );

              if (index !== 0) {
                return card;
              }

              return (
                <TutorialTarget key={opportunity.id} id="market-first-opportunity">
                  {card}
                </TutorialTarget>
              );
            })
          )}
        </View>
      ) : null}

      <ProductMarketDetailModal
        visible={detailModalVisible}
        cityId={selectedCity?.id ?? null}
        productId={detailProductId}
        onClose={closeDetailModal}
        onBuy={handleBuyProductPress}
        onSell={handleSellProductPress}
        onCreateAlert={handleAlarmProductPress}
      />

      <MarketAlertModal
        visible={alertModalVisible}
        city={selectedCity}
        product={alertProduct}
        currentPrice={
          selectedCity && alertProductId
            ? getCityProductMarketPrice(selectedCity, alertProductId)
            : 0
        }
        onConfirm={handleConfirmAlert}
        onClose={closeAlertModal}
      />

      <TradeProductModal
        visible={tradeModalVisible}
        mode={tradeMode}
        city={selectedCity}
        product={tradeProduct}
        currentPrice={
          selectedCity && tradeProductId
            ? getCityProductMarketPrice(selectedCity, tradeProductId)
            : 0
        }
        availableStock={
          selectedCity && tradeProductId ? getCityProductStock(selectedCity, tradeProductId) : 0
        }
        warehouseFreeCapacity={selectedCityTotalFreeCapacity}
        cityWarehouses={tradeMode === 'buy' ? tradeWarehouseOptions : []}
        showColdWarehouseSuggestion={tradeMode === 'buy' ? showColdWarehouseSuggestion : false}
        inventoryQuantity={tradeSellInventory?.quantity ?? 0}
        averageBuyPrice={tradeSellInventory?.averageBuyPrice ?? 0}
        inventoryQuality={tradeSellInventory?.quality ?? 100}
        effectiveSellPrice={
          tradeMode === 'sell' && selectedCity && tradeProductId && tradeSellInventory
            ? getEffectiveSellPrice(
                getCityProductMarketPrice(selectedCity, tradeProductId),
                tradeSellInventory.quality,
              )
            : undefined
        }
        playerCash={player?.money ?? 0}
        onConfirm={handleConfirmTrade}
        onOpenWarehouses={handleOpenWarehouses}
        onClose={closeTradeModal}
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
    color: colors.success,
    fontWeight: '700',
    flex: 1,
  },
  metricStrip: {
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingRight: spacing.sm,
  },
  marketStatusSummary: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  citySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  citySummaryItem: {
    alignItems: 'center',
    minWidth: 52,
  },
  citySummaryValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  citySummaryLabel: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 1,
  },
  citySummaryName: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    flex: 1,
    textAlign: 'right',
    minWidth: 0,
  },
  tabContent: {
    marginTop: spacing.sm,
  },
  cityChipRow: {
    paddingBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  productCard: {
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  opportunityCard: {
    marginBottom: 9,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  productIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  cardRight: {
    alignItems: 'flex-end',
    minWidth: 78,
    gap: 1,
  },
  productName: {
    ...typography.cardTitle,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 0,
  },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 4,
  },
  trendLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  chartRow: {
    width: '100%',
    marginTop: 2,
    marginBottom: 2,
  },
  productPrice: {
    ...typography.bodySmall,
    fontSize: 13,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  productPriceUnit: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  priceChangeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  productHint: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  depotText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
  },
  depotMutedText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  productFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 6,
  },
  productProgress: {
    flex: 1,
    minWidth: 0,
  },
  productActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  productAction: {
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  productActionAlarm: {
    minHeight: 32,
    minWidth: 58,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  opportunityRoute: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  opportunityProduct: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  opportunityMetrics: {
    marginTop: 4,
    gap: 1,
  },
  opportunityLine: {
    ...typography.caption,
    color: colors.textMuted,
  },
  opportunityValue: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  opportunityPending: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  opportunityAction: {
    marginTop: 6,
    minHeight: 34,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
});
