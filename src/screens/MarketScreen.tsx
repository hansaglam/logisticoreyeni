/**
 * LogistiCore - Piyasa (Market) Ekranı
 *
 * Premium piyasa analizi: stoklar, fiyatlar ve taşıma fırsatları.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import MarketAlertModal from '../components/market/MarketAlertModal';
import ActiveMarketAlertsSection from '../components/market/ActiveMarketAlertsSection';
import MarketWorldEventsStrip from '../components/market/MarketWorldEventsStrip';
import ProductMarketDetailModal from '../components/market/ProductMarketDetailModal';
import MarketSparkline from '../components/market/MarketSparkline';
import {
  getMarketProductColumnWidths,
  getProductAccentColor,
  MARKET_CARD_BG,
  MARKET_CARD_BORDER,
  MARKET_HEADER_HEIGHT,
  MARKET_METRIC_HEIGHT,
  MARKET_PRODUCT_CARD_MIN_HEIGHT,
  MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW,
  MARKET_REFRESH_BG,
  MARKET_REFRESH_BORDER,
  MARKET_SECTION_GAP,
  MARKET_SECTION_GAP_TIGHT,
  MARKET_SEGMENT_BG,
  MARKET_SEGMENT_BORDER,
  MARKET_SUMMARY_STRIP_HEIGHT,
  marketCityChipActive,
  marketCityChipInactive,
} from '../components/market/marketTheme';
import TradeProductModal, { type TradeWarehouseOption } from '../components/TradeProductModal';
import { TutorialTarget } from '../tutorial/TutorialTarget';
import {
  ActionButton,
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ProductIcon,
  StatusBadge,
} from '../components/ui';
import type { StatusBadgeVariant } from '../components/ui';
import type { GameIconName } from '../theme/icons';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { countMarketContractMatches } from '../utils/marketContractMatch';
import {
  gameDayFromTime,
  getEventsForProduct,
  getPrimaryWorldEventLabel,
  getProductPriceEventMultiplier,
} from '../simulation/worldEvents';
import { getSnapshotFuelPrice } from '../simulation/globalMarketSnapshot';
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
  WAREHOUSE_SELL_SAME_CITY_RULE,
} from '../simulation/trading';
import {
  detectMarketTradeOpportunities,
  formatMarketTradeOpportunityTitle,
  type MarketTradeOpportunity,
} from '../utils/marketTradeOpportunities';
import { formatTradeProfitDisplay, resolveMarketBuyState, resolveMarketSellState } from '../utils/tradeDisplay';
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
  formatLiveEconomyCompact,
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
  { key: 'opportunities' as const, label: 'Fırsatlar', icon: 'reputation' as const },
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
    <View style={styles.worldStatusRow}>
      <GameIcon name="map" size={13} color={colors.textMuted} />
      <Text style={styles.worldStatusText} numberOfLines={1}>
        <Text style={styles.worldStatusLabel}>Dünya Durumu</Text>
        {'  '}
        {mood} · {criticalCount} talep · {opportunityCount} fırsat
      </Text>
    </View>
  );
}

interface MarketMetricTileProps {
  label: string;
  value: string;
  icon: GameIconName;
  accentColor: string;
}

function MarketMetricTile({ label, value, icon, accentColor }: MarketMetricTileProps) {
  return (
    <View style={styles.metricTile}>
      <View style={[styles.metricIconWrap, { backgroundColor: `${accentColor}18` }]}>
        <GameIcon name={icon} size={16} color={accentColor} />
      </View>
      <View style={styles.metricTextBlock}>
        <Text style={styles.metricLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.metricValue, { color: accentColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
        >
          {value}
        </Text>
      </View>
    </View>
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
    <View style={styles.metricStrip}>
      <MarketMetricTile
        label="Yakıt Fiyatı"
        value={formatUnitPrice(fuelPrice, '/L')}
        icon="fuel"
        accentColor={isFuelExpensiveForDisplay(fuelPrice) ? colors.danger : colors.accentAmber}
      />
      <MarketMetricTile
        label="Piyasa"
        value={formatLiveEconomyCompact()}
        icon="time"
        accentColor={colors.info}
      />
      <MarketMetricTile
        label="Hareket"
        value={String(criticalCount)}
        icon="warning"
        accentColor={criticalCount > 0 ? colors.danger : colors.success}
      />
      <MarketMetricTile
        label="Fırsatlar"
        value={String(opportunityCount)}
        icon="contract"
        accentColor="#A78BFA"
      />
    </View>
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
    <View style={styles.citySummaryStrip}>
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.danger }]}>{shortages}</Text>
        <Text style={styles.citySummaryLabel}>{getMarketStatusShortLabel('Kıtlık')}</Text>
      </View>
      <View style={styles.citySummaryDivider} />
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.success }]}>{surpluses}</Text>
        <Text style={styles.citySummaryLabel}>Stok Fazla</Text>
      </View>
      <View style={styles.citySummaryDivider} />
      <View style={styles.citySummaryMetric}>
        <Text style={[styles.citySummaryValue, { color: colors.accentAmber }]}>
          {formatMoney(avgPrice)}
        </Text>
        <Text style={styles.citySummaryLabel}>Ort. fiyat</Text>
      </View>
      <View style={styles.citySummaryTrendSlot}>
        <GameIcon name="market" size={16} color={colors.info} />
        <Text style={styles.citySummaryName} numberOfLines={1}>
          {cityName}
        </Text>
      </View>
    </View>
  );
}

function MarketTabSegment({
  activeTab,
  onChange,
}: {
  activeTab: MarketTab;
  onChange: (tab: MarketTab) => void;
}) {
  return (
    <View style={styles.segmentContainer}>
      {MARKET_TABS.map((tab) => {
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
                size={15}
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

function MarketCityChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = selected ? marketCityChipActive : marketCityChipInactive;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.cityChip,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
      ]}
    >
      <Text
        style={[
          styles.cityChipLabel,
          { color: palette.textColor, fontWeight: selected ? '700' : '600' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
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

const ProductMarketCard = React.memo(function ProductMarketCard({
  cityId,
  currentTime,
  market,
  hasWarehouse,
  depotQuantity,
  estimatedProfit,
  canSell,
  buyButtonLabel,
  buyButtonDisabled,
  buyButtonDetailLabel,
  showSellButton,
  sellButtonLabel,
  sellButtonDisabled,
  eventLabel,
  displayPrice,
  onBuyPress,
  onSellPress,
  onAlarmPress,
  onPress,
  leftColWidth,
  actionColWidth,
  chartMinWidth,
  cardHeight,
  narrowScreen,
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
  buyButtonDetailLabel?: string;
  showSellButton: boolean;
  sellButtonLabel: string;
  sellButtonDisabled: boolean;
  eventLabel?: string;
  displayPrice?: number;
  onBuyPress: (productId: ProductId) => void;
  onSellPress: (productId: ProductId) => void;
  onAlarmPress: (productId: ProductId) => void;
  onPress?: (productId: ProductId) => void;
  leftColWidth: number;
  actionColWidth: number;
  chartMinWidth: number;
  cardHeight: number;
  narrowScreen: boolean;
}) {
  const stockRatio = calculateStockRatio(market);
  const status = getMarketStatus(stockRatio);
  const statusVariant = getMarketStatusColorVariant(status);
  const hint = getOpportunityHint(market);
  const shownPrice = displayPrice ?? market.currentPrice;
  const accentColor = getProductAccentColor(market.productId);
  const trend = useMemo(
    () =>
      getProductPriceTrend({
        cityId,
        productId: market.productId,
        currentTime,
        stockStatus: status,
        marketState: {
          currentPrice: market.currentPrice,
          basePrice: market.basePrice,
          priceHistory: market.priceHistory,
        },
      }),
    [
      cityId,
      currentTime,
      market.basePrice,
      market.currentPrice,
      market.priceHistory,
      market.productId,
      status,
    ],
  );
  const priceChangeDisplay = formatTrendChangeDisplay(trend);
  const profitDisplay =
    hasWarehouse && depotQuantity > 0 && estimatedProfit != null
      ? formatTradeProfitDisplay(estimatedProfit)
      : null;

  const stockMeta = !hasWarehouse
    ? 'Depo yok'
    : depotQuantity > 0
      ? `Stok: ${depotQuantity.toFixed(0)} t`
      : 'Depoda yok';

  const cardBody = (
    <View
      style={[styles.productCardInner, { minHeight: cardHeight }]}
      onLayout={(event) => {
        if (!__DEV__) return;
        const { width: cardWidth } = event.nativeEvent.layout;
        // eslint-disable-next-line no-console
        console.log('[market-card-layout]', {
          platform: Platform.OS,
          productId: market.productId,
          cardWidth,
          infoColumnWidth: leftColWidth,
          contentColumnWidth: Math.max(0, cardWidth - leftColWidth - actionColWidth - 12),
          actionColumnWidth: actionColWidth,
          titleWidth: Math.max(0, leftColWidth - (narrowScreen ? 28 : 32) - 5),
          actionLabelWidth: Math.max(0, actionColWidth - 12),
          fontScale: PixelRatio.getFontScale(),
        });
      }}
    >
      <View
        style={[
          styles.productLeftCol,
          { flexBasis: leftColWidth, maxWidth: leftColWidth, width: leftColWidth },
        ]}
      >
        <View style={styles.productTitleRow}>
          <View
            style={[
              styles.productIconBox,
              narrowScreen && styles.productIconBoxNarrow,
              { borderColor: `${accentColor}44` },
            ]}
          >
            <ProductIcon
              productId={market.productId}
              size={narrowScreen ? 13 : 14}
              color={accentColor}
            />
          </View>
          <Text
            style={styles.productName}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.86}
            ellipsizeMode="tail"
          >
            {getProductName(market.productId)}
          </Text>
        </View>
        <Text style={styles.productPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {formatMoney(shownPrice)}
          <Text style={styles.productPriceUnit}> / ton</Text>
        </Text>
        <Text
          style={[styles.priceChangeText, { color: priceChangeDisplay.color }]}
          numberOfLines={1}
        >
          {priceChangeDisplay.label}
        </Text>
        <View style={styles.productBadgeRow}>
          <StatusBadge label={getMarketStatusLabel(status)} variant={statusVariant} size="sm" />
        </View>
        {eventLabel ? (
          <Text style={styles.eventLabel} numberOfLines={1}>
            {eventLabel}
          </Text>
        ) : null}
      </View>

      <View style={[styles.productChartCol, { minWidth: chartMinWidth }]}>
        <MarketSparkline
          productId={market.productId}
          priceHistory={market.priceHistory}
          currentPrice={market.currentPrice}
          changePercent={trend.changePercent}
          width={chartMinWidth}
        />
        <Text style={styles.productHint} numberOfLines={3}>
          {hint}
        </Text>
        <Text style={styles.stockMeta} numberOfLines={1}>
          {stockMeta}
          {profitDisplay ? (
            <Text style={{ color: profitDisplay.color }}> · {profitDisplay.label}</Text>
          ) : null}
        </Text>
      </View>

      <View
        style={[
          styles.productActionsCol,
          { width: actionColWidth, minWidth: actionColWidth, maxWidth: actionColWidth },
        ]}
      >
        <Pressable
          style={[styles.productBuyBtn, buyButtonDisabled && styles.productBtnDisabled]}
          onPress={() => onBuyPress(market.productId)}
          disabled={buyButtonDisabled}
          accessibilityLabel={buyButtonDetailLabel ?? buyButtonLabel}
        >
          <GameIcon name="cash" size={narrowScreen ? 12 : 13} color="#FFFFFF" />
          <Text
            style={styles.productBuyBtnText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {buyButtonLabel}
          </Text>
        </Pressable>
        {showSellButton ? (
          <Pressable
            style={[styles.productSellBtn, sellButtonDisabled && styles.productBtnDisabled]}
            onPress={() => onSellPress(market.productId)}
            disabled={sellButtonDisabled}
          >
            <GameIcon name="market" size={12} color={colors.textSecondary} />
            <Text
              style={styles.productSellBtnText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {sellButtonLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.productAlarmBtn} onPress={() => onAlarmPress(market.productId)}>
          <GameIcon name="notification" size={narrowScreen ? 12 : 13} color={colors.textSecondary} />
          {!narrowScreen ? (
            <Text style={styles.productAlarmBtnText} numberOfLines={1}>
              Alarm
            </Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.productCard}>
      {onPress ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => onPress(market.productId)}>
          {cardBody}
        </TouchableOpacity>
      ) : (
        cardBody
      )}
    </View>
  );
});

function TradeOpportunityCard({
  opportunity,
  onPress,
}: {
  opportunity: MarketTradeOpportunity;
  onPress: () => void;
}) {
  const badgeVariant: StatusBadgeVariant =
    opportunity.type === 'sell' ? 'amber' : opportunity.type === 'buy' ? 'success' : 'info';

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <AppCard style={styles.tradeOpportunityCard} padded>
        <View style={styles.cardTopRow}>
          <View style={styles.productIconBox}>
            <GameIcon
              name={opportunity.type === 'sell' ? 'warehouse' : 'market'}
              size={16}
              color={colors.accentBlue}
            />
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.opportunityRoute} numberOfLines={1}>
              {formatMarketTradeOpportunityTitle(opportunity)}
            </Text>
            <Text style={styles.opportunityProduct} numberOfLines={2}>
              {opportunity.description}
            </Text>
          </View>
          <StatusBadge label={opportunity.label} variant={badgeVariant} size="sm" />
        </View>
        {opportunity.netProfit != null ? (
          <Text
            style={[
              styles.tradeOpportunityProfit,
              { color: opportunity.netProfit >= 0 ? colors.success : colors.danger },
            ]}
          >
            Net kâr: {opportunity.netProfit >= 0 ? '+' : ''}
            {formatMoney(opportunity.netProfit)}
          </Text>
        ) : null}
      </AppCard>
    </TouchableOpacity>
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
  const { width: screenWidth } = useWindowDimensions();
  const { contentBottomPadding } = useTabBarLayout();
  const productLayout = useMemo(() => getMarketProductColumnWidths(screenWidth), [screenWidth]);
  const narrowScreen = screenWidth < 360;
  const productCardHeight = narrowScreen
    ? MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW
    : MARKET_PRODUCT_CARD_MIN_HEIGHT;
  const player = useGameStore((state) => state.player);
  const playerMoney = useGameStore((state) => state.player?.money ?? 0);
  const playerWarehouses = useGameStore((state) => state.player?.warehouses ?? []);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const globalSnapshot = useGameStore((state) => state.cachedGlobalEconomySnapshot);
  const marketSyncStatus = useGameStore((state) => state.globalMarketSyncStatus);
  const marketLastSyncedAtMs = useGameStore(
    (state) => state.globalMarketLastSyncedAtMs,
  );
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

  const isOnboardingMarket = false;

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
    setDetailProductId(pendingMarketFocus.productId);
    setDetailModalVisible(true);
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

  const activeWorldEvents = globalSnapshot?.activeEvents ?? [];

  const fuelPrice = useMemo(
    () => getSnapshotFuelPrice(globalSnapshot, globalEconomy),
    [globalEconomy, globalSnapshot],
  );

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
    () => {
      if (!globalSnapshot) return [];
      return globalSnapshot.opportunities.slice(0, MAX_OPPORTUNITIES).map(
        (opportunity): MarketOpportunity => {
          const route = routes.find(
            (candidate) =>
              (candidate.fromCityId === opportunity.fromCityId &&
                candidate.toCityId === opportunity.toCityId) ||
              (candidate.fromCityId === opportunity.toCityId &&
                candidate.toCityId === opportunity.fromCityId),
          );
          return {
            id: opportunity.id,
            fromCityId: opportunity.fromCityId,
            toCityId: opportunity.toCityId,
            productId: opportunity.productId,
            fromCityName: getCityName(opportunity.fromCityId),
            toCityName: getCityName(opportunity.toCityId),
            productName: getProductName(opportunity.productId),
            priceGap: opportunity.sellPrice - opportunity.buyPrice,
            distanceKm: route?.distanceKm ?? 0,
            score: opportunity.marginPercent,
            demandLevel:
              opportunity.marginPercent >= 15
                ? 'high'
                : opportunity.marginPercent >= 8
                  ? 'medium'
                  : 'low',
          };
        },
      );
    },
    [globalSnapshot, routes],
  );

  const tradeOpportunities = useMemo(() => {
    if (!player) return [];
    return detectMarketTradeOpportunities({
      player,
      cities,
      products,
      currentTime,
      limit: 6,
    });
  }, [player, cities, products, currentTime]);

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
    return playerWarehouses
      .filter((item) => item.cityId === selectedCity.id)
      .map((item) => normalizeWarehouse(item));
  }, [playerWarehouses, selectedCity]);

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

  const marketMood = useMemo((): MarketMood => {
    if (globalSnapshot?.worldStatus === 'crisis') return 'Kriz';
    if (globalSnapshot?.worldStatus === 'volatile') return 'Hareketli';
    if ((globalSnapshot?.globalOpportunityCount ?? 0) > 0) return 'Fırsatlı';
    return 'Sakin';
  }, [globalSnapshot]);

  const selectedCityProductCards = useMemo(() => {
    if (!selectedCity || activeTab !== 'products') {
      return [];
    }

    const gameDay = gameDayFromTime(currentTime);
    const hasWarehouse = selectedCityWarehouses.length > 0;
    const cards: Array<{
      productId: ProductId;
      cityId: string;
      market: NormalizedProductMarket;
      hasWarehouse: boolean;
      depotQuantity: number;
      estimatedProfit: number | null;
      canSell: boolean;
      buyButtonLabel: string;
      buyButtonDisabled: boolean;
      buyButtonDetailLabel: string;
      showSellButton: boolean;
      sellButtonLabel: string;
      sellButtonDisabled: boolean;
      eventLabel?: string;
      displayPrice?: number;
    }> = [];

    for (const product of products) {
      const market = getProductMarket(selectedCity, product.id);
      if (!market) continue;

      const inventory = cityInventoryByProduct.get(product.id) ?? {
        quantity: 0,
        averageBuyPrice: 0,
        quality: 100,
        primaryWarehouseId: null,
      };
      const priceMultiplier = getProductPriceEventMultiplier(
        product.id,
        selectedCity.id,
        activeWorldEvents,
        gameDay,
      );
      const displayPrice =
        priceMultiplier !== 1
          ? Number(Math.max(1, market.currentPrice * priceMultiplier).toFixed(2))
          : market.currentPrice;
      const productEvent = getEventsForProduct(
        activeWorldEvents,
        product.id,
        gameDay,
        selectedCity.id,
      ).find((event) => event.impact.productPriceMultiplier);
      const eventLabel = productEvent
        ? `Etkinlik: ${getPrimaryWorldEventLabel(productEvent)}`
        : undefined;
      const estimatedProfit =
        inventory.quantity > 0
          ? calculateTradeProfit(
              displayPrice,
              inventory.averageBuyPrice,
              inventory.quantity,
              inventory.quality,
            )
          : null;
      const canStoreProduct = selectedCityWarehouses.some((warehouse) => {
        const warehouseType = resolveWarehouseType(warehouse.warehouseType);
        return evaluateStorageSuitability(product, warehouseType) !== 'blocked';
      });
      const buyButton = resolveMarketBuyState({
        hasWarehouse,
        marketStock: market.stock,
        freeCapacity: selectedCityTotalFreeCapacity,
        playerMoney,
        unitPrice: displayPrice,
        canStoreProduct,
      });
      const sellButton = resolveMarketSellState({
        hasWarehouse,
        inventoryQuantity: inventory.quantity,
      });

      cards.push({
        productId: product.id,
        cityId: selectedCity.id,
        market,
        hasWarehouse,
        depotQuantity: inventory.quantity,
        estimatedProfit,
        canSell: sellButton.canSell,
        buyButtonLabel: buyButton.label,
        buyButtonDisabled: buyButton.disabled,
        buyButtonDetailLabel: buyButton.detailLabel,
        showSellButton: sellButton.showSellButton,
        sellButtonLabel: sellButton.label,
        sellButtonDisabled: sellButton.disabled,
        eventLabel,
        displayPrice,
      });
    }

    return cards;
  }, [
    activeTab,
    selectedCity,
    products,
    selectedCityWarehouses,
    cityInventoryByProduct,
    activeWorldEvents,
    currentTime,
    selectedCityTotalFreeCapacity,
    playerMoney,
  ]);

  const closeTradeModal = () => {
    setTradeModalVisible(false);
    setTradeProductId(null);
    setTradeMode('buy');
  };

  const handleBuyProductPress = useCallback((productId: ProductId) => {
    if (!selectedCity) return;

    if (selectedCityWarehouses.length === 0) {
      showAlert(
        'Depo gerekli',
        'Bu şehirden ürün almak için önce burada depo açmalısın.',
      );
      return;
    }

    const market = getProductMarket(selectedCity, productId);
    const productDef = products.find((item) => item.id === productId);
    const canStoreProduct = selectedCityWarehouses.some((warehouse) => {
      const warehouseType = resolveWarehouseType(warehouse.warehouseType);
      return productDef
        ? evaluateStorageSuitability(productDef, warehouseType) !== 'blocked'
        : true;
    });
    const buyState = resolveMarketBuyState({
      hasWarehouse: true,
      marketStock: market?.stock ?? 0,
      freeCapacity: selectedCityTotalFreeCapacity,
      playerMoney,
      unitPrice: market?.currentPrice ?? 0,
      canStoreProduct,
    });

    if (!buyState.canBuy) {
      return;
    }

    setTradeMode('buy');
    setTradeProductId(productId);
    setTradeModalVisible(true);
  }, [
    selectedCity,
    selectedCityWarehouses,
    products,
    selectedCityTotalFreeCapacity,
    playerMoney,
    showAlert,
  ]);

  const handleSellProductPress = useCallback((productId: ProductId) => {
    if (!selectedCity) return;

    const inventory = cityInventoryByProduct.get(productId);
    const sellState = resolveMarketSellState({
      hasWarehouse: selectedCityWarehouses.length > 0,
      inventoryQuantity: inventory?.quantity ?? 0,
    });

    if (!sellState.canSell) {
      if ((inventory?.quantity ?? 0) <= 0) {
        showAlert('Stok yok', 'Bu şehirdeki depolarında satılacak ürün bulunmuyor.');
      }
      return;
    }

    setTradeMode('sell');
    setTradeProductId(productId);
    setTradeModalVisible(true);
  }, [selectedCity, selectedCityWarehouses, cityInventoryByProduct, showAlert]);

  const closeAlertModal = () => {
    setAlertModalVisible(false);
    setAlertProductId(null);
  };

  const handleAlarmProductPress = useCallback((productId: ProductId) => {
    if (!selectedCity) return;
    setAlertProductId(productId);
    setAlertModalVisible(true);
  }, [selectedCity]);

  const handleProductCardPress = useCallback((productId: ProductId) => {
    if (!selectedCity) return;
    setDetailProductId(productId);
    setDetailModalVisible(true);
  }, [selectedCity]);

  const closeDetailModal = useCallback(() => {
    setDetailModalVisible(false);
    setDetailProductId(null);
  }, []);

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

  const handleRefreshMarket = async () => {
    const result = await refreshMarketSnapshot();
    setStatusMessage(
      !result.success
        ? 'Piyasa verilerine ulaşılamıyor'
        : result.stale
        ? 'Çevrimdışı piyasa verisi gösteriliyor'
        : 'Global piyasa senkronize edildi',
    );
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
    <AppScreen scroll scrollBottomPadding={contentBottomPadding}>
      <View style={styles.screenStack}>
        <View style={styles.marketHeader}>
          <View style={styles.marketHeaderText}>
            <Text style={styles.marketTitle}>Piyasa</Text>
            <Text style={styles.marketSubtitle}>Fiyatları izle, al veya sat</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={handleRefreshMarket}>
            <GameIcon name="refresh" size={19} color={colors.info} />
          </Pressable>
        </View>

        {statusMessage ? (
          <AppCard variant="success" style={styles.statusBanner} padded>
            <View style={styles.statusBannerRow}>
              <GameIcon name="success" size={14} color={colors.success} />
              <Text style={styles.statusBannerText}>{statusMessage}</Text>
            </View>
          </AppCard>
        ) : null}

        {marketSyncStatus === 'offline-cache' ? (
          <AppCard variant="highlighted" style={styles.statusBanner} padded>
            <View style={styles.statusBannerRow}>
              <GameIcon name="alert" size={14} color={colors.warning} />
              <Text style={styles.statusBannerText}>
                Çevrimdışı piyasa verisi
                {marketLastSyncedAtMs
                  ? ` · Son senkronizasyon ${Math.max(
                      0,
                      Math.round((Date.now() - marketLastSyncedAtMs) / 60_000),
                    )} dk önce`
                  : ''}
              </Text>
            </View>
          </AppCard>
        ) : null}

        {marketSyncStatus === 'error' ? (
          <AppCard variant="danger" style={styles.statusBanner} padded>
            <View style={styles.statusBannerRow}>
              <GameIcon name="alert" size={14} color={colors.danger} />
              <Text style={styles.statusBannerText}>
                Piyasa verilerine ulaşılamıyor
              </Text>
            </View>
          </AppCard>
        ) : null}

        <View style={styles.ruleBanner}>
          <GameIcon name="alert" size={13} color={colors.info} />
          <Text style={styles.ruleBannerText} numberOfLines={1}>
            {WAREHOUSE_SELL_SAME_CITY_RULE}
          </Text>
        </View>

        <MarketMetricStrip
          fuelPrice={fuelPrice}
          currentTime={currentTime}
          criticalCount={marketHighlights.criticalCount}
          opportunityCount={globalSnapshot?.globalOpportunityCount ?? opportunities.length}
        />

        <MarketStatusSummary
          mood={marketMood}
          criticalCount={marketHighlights.criticalCount}
          opportunityCount={globalSnapshot?.globalOpportunityCount ?? opportunities.length}
        />

        <MarketWorldEventsStrip events={activeWorldEvents} />

        <MarketTabSegment activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'products' ? (
          <View style={styles.tabContent}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              contentContainerStyle={styles.cityChipRow}
            >
              {cities.map((city) => (
                <MarketCityChip
                  key={city.id}
                  label={city.name}
                  selected={city.id === selectedCityId}
                  onPress={() => setSelectedCityId(city.id)}
                />
              ))}
            </ScrollView>

            <ActiveMarketAlertsSection
              alerts={activeMarketAlerts}
              selectedCityId={selectedCityId}
              onPressAlert={handlePressMarketAlert}
              onDeleteAlert={(alertId) => void handleDeleteMarketAlert(alertId)}
              hideEmptyHint={isOnboardingMarket}
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
                  <View style={styles.productsSectionHeader}>
                    <Text style={styles.productsSectionTitle}>Ürün Piyasası</Text>
                    <Text style={styles.productsSectionSubtitle}>
                      {selectedCity.name} · alım ve satım
                    </Text>
                  </View>
                </TutorialTarget>

                {selectedCityProductCards.length === 0 ? (
                  <EmptyState title="Ürün verisi yok" icon="inventory" />
                ) : (
                  (() => {
                    let firstProductWrapped = false;
                    return selectedCityProductCards.map((cardData) => {
                      const card = (
                        <ProductMarketCard
                          cityId={cardData.cityId}
                          currentTime={currentTime}
                          market={cardData.market}
                          hasWarehouse={cardData.hasWarehouse}
                          depotQuantity={cardData.depotQuantity}
                          estimatedProfit={cardData.estimatedProfit}
                          canSell={cardData.canSell}
                          buyButtonLabel={cardData.buyButtonLabel}
                          buyButtonDisabled={cardData.buyButtonDisabled}
                          buyButtonDetailLabel={cardData.buyButtonDetailLabel}
                          showSellButton={cardData.showSellButton}
                          sellButtonLabel={cardData.sellButtonLabel}
                          sellButtonDisabled={cardData.sellButtonDisabled}
                          eventLabel={cardData.eventLabel}
                          displayPrice={cardData.displayPrice}
                          onBuyPress={handleBuyProductPress}
                          onSellPress={handleSellProductPress}
                          onAlarmPress={handleAlarmProductPress}
                          onPress={handleProductCardPress}
                          leftColWidth={productLayout.leftCol}
                          actionColWidth={productLayout.actionCol}
                          chartMinWidth={productLayout.chartMinWidth}
                          cardHeight={productCardHeight}
                          narrowScreen={narrowScreen}
                        />
                      );

                      if (firstProductWrapped) {
                        return <React.Fragment key={cardData.productId}>{card}</React.Fragment>;
                      }

                      firstProductWrapped = true;
                      return (
                        <TutorialTarget key={cardData.productId} id="market-first-product">
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
            <View style={styles.productsSectionHeader}>
              <Text style={styles.productsSectionTitle}>Depo Ticaret Fırsatları</Text>
              <Text style={styles.productsSectionSubtitle}>
                Alım, satış ve takip önerileri — net kâr fee sonrası hesaplanır.
              </Text>
            </View>

          {tradeOpportunities.length === 0 ? (
            <EmptyState
              title="Şu an depo ticaret fırsatı yok"
              message="Depo, stok veya nakit uygun olduğunda yeni fırsatlar görünecek."
              icon="warehouse"
            />
          ) : (
            tradeOpportunities.map((item) => (
              <TradeOpportunityCard
                key={item.id}
                opportunity={item}
                onPress={() => {
                  setSelectedCityId(item.cityId);
                  setDetailProductId(item.productId);
                  setDetailModalVisible(true);
                }}
              />
            ))
          )}

          <View style={[styles.productsSectionHeader, styles.productsSectionHeaderSpaced]}>
            <Text style={styles.productsSectionTitle}>Taşıma Fırsatları</Text>
            <Text style={styles.productsSectionSubtitle}>
              Şehirler arası fiyat farklarına göre olası sözleşme rotaları.
            </Text>
          </View>

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
      </View>

      {detailModalVisible && selectedCity && detailProductId ? (
        <ProductMarketDetailModal
          visible={detailModalVisible}
          cityId={selectedCity.id}
          productId={detailProductId}
          onClose={closeDetailModal}
          onBuy={handleBuyProductPress}
          onSell={handleSellProductPress}
          onCreateAlert={handleAlarmProductPress}
        />
      ) : null}

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
    marginBottom: 0,
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
  screenStack: {
    gap: MARKET_SECTION_GAP,
  },
  marketHeader: {
    height: MARKET_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  marketHeaderText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  marketTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 28,
  },
  marketSubtitle: {
    fontSize: 11.5,
    color: '#A9B6CC',
    marginTop: 2,
    lineHeight: 14,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: MARKET_REFRESH_BG,
    borderWidth: 1,
    borderColor: MARKET_REFRESH_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(35,136,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(35,136,255,0.24)',
  },
  ruleBannerText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSecondary,
  },
  metricStrip: {
    flexDirection: 'row',
    gap: 7,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    height: MARKET_METRIC_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 7,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricIconWrap: {
    width: 29,
    height: 29,
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
    fontSize: 8.5,
    lineHeight: 10,
    color: colors.textMuted,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
  },
  worldStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 2,
  },
  worldStatusText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  worldStatusLabel: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  segmentContainer: {
    height: 42,
    borderRadius: 14,
    padding: 3,
    backgroundColor: MARKET_SEGMENT_BG,
    borderWidth: 1,
    borderColor: MARKET_SEGMENT_BORDER,
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
    gap: 5,
    paddingHorizontal: 6,
  },
  segmentTabActive: {
    backgroundColor: 'rgba(35,136,255,0.13)',
    borderColor: colors.accentBlue,
  },
  segmentLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentLabelActive: {
    color: colors.accentBlue,
    fontWeight: '700',
  },
  citySummaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MARKET_SUMMARY_STRIP_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 11,
  },
  citySummaryMetric: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  citySummaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(70,120,190,0.22)',
  },
  citySummaryValue: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 17,
  },
  citySummaryLabel: {
    fontSize: 8.5,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 10,
  },
  citySummaryTrendSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 6,
    minWidth: 44,
    maxWidth: 56,
  },
  citySummaryName: {
    fontSize: 8.5,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  tabContent: {
    gap: MARKET_SECTION_GAP_TIGHT,
  },
  cityChipRow: {
    flexDirection: 'row',
    gap: 7,
    paddingVertical: 2,
  },
  cityChip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cityChipLabel: {
    fontSize: 10.5,
  },
  productsSectionHeader: {
    gap: 2,
    marginBottom: 2,
  },
  productsSectionHeaderSpaced: {
    marginTop: 4,
  },
  productsSectionTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  productsSectionSubtitle: {
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 13,
  },
  productCard: {
    marginBottom: 9,
    borderRadius: 17,
    backgroundColor: MARKET_CARD_BG,
    borderWidth: 1,
    borderColor: MARKET_CARD_BORDER,
    overflow: 'hidden',
  },
  productCardInner: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 6,
  },
  productLeftCol: {
    minWidth: 0,
    flexGrow: 0,
    flexShrink: 1,
    justifyContent: 'space-between',
    gap: 1,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  productChartCol: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  productActionsCol: {
    flexShrink: 0,
    justifyContent: 'center',
    gap: 6,
  },
  productBadgeRow: {
    marginTop: 2,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  stockMeta: {
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  productBuyBtn: {
    minHeight: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.accentBlue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  productSellBtn: {
    minHeight: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(12,24,48,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(90,135,195,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  productAlarmBtn: {
    minHeight: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(90,135,195,0.40)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  productBtnDisabled: {
    opacity: 0.45,
  },
  productBuyBtnText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  productSellBtnText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  productAlarmBtnText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  opportunityCard: {
    marginBottom: 9,
  },
  tradeOpportunityCard: {
    marginBottom: 8,
  },
  tradeOpportunityProfit: {
    ...typography.caption,
    fontWeight: '800',
    marginTop: 6,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  productIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(35,136,255,0.10)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productIconBoxNarrow: {
    width: 28,
    height: 28,
    borderRadius: 9,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    minWidth: 0,
  },
  eventLabel: {
    fontSize: 8.5,
    fontWeight: '700',
    color: colors.accentAmber,
    marginTop: 1,
  },
  productPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.accentAmber,
    marginTop: 2,
  },
  productPriceUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textMuted,
  },
  priceChangeText: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  productHint: {
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
    marginTop: 3,
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
