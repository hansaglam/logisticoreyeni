/**
 * LogistiCore - Piyasa (Market) Ekranı
 *
 * Premium piyasa analizi: stoklar, fiyatlar ve taşıma fırsatları.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
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
  getCityProductMarketPrice,
  getCityProductStock,
  getWarehouseFreeCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import {
  cityHasWarehouseType,
  evaluateStorageSuitability,
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
  formatPriceChangeDisplay,
  formatStockDisplay,
  formatUnitPrice,
  isFuelExpensiveForDisplay,
  spacing,
  typography,
} from '../theme';
import type { City, CityProductState, MarketOpportunity, Product, ProductId, Route } from '../types/game';

const CRITICAL_SHORTAGE_RATIO = 0.35;
const HIGH_SURPLUS_RATIO = 1.5;
const SHORTAGE_THRESHOLD = 0.7;
const SURPLUS_THRESHOLD = 1.2;
const STATUS_MESSAGE_TIMEOUT_MS = 2000;
const MAX_OPPORTUNITIES = 3;
const OPPORTUNITY_SCORE_CAP = 2500;

type MarketTab = 'products' | 'opportunities';
type MarketStatus = 'Kritik Kıtlık' | 'Kıtlık' | 'Dengeli' | 'Fazla' | 'Yüksek Fazla';

const MARKET_TABS = [
  { key: 'products' as const, label: 'Ürünler', icon: 'inventory' as const },
  { key: 'opportunities' as const, label: 'Fırsatlar', icon: 'route' as const },
];

interface NormalizedProductMarket {
  productId: ProductId;
  stock: number;
  targetStock: number;
  currentPrice: number;
  basePrice: number;
  productionPerDay: number;
  consumptionPerDay: number;
}

interface MarketHighlight {
  cityId: string;
  productId: ProductId;
  stockRatio: number;
}

interface MarketAlert {
  isStable: boolean;
  criticalShortage: MarketHighlight | null;
  highestSurplus: MarketHighlight | null;
  bestOpportunity: MarketOpportunity | null;
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

function getProductMarket(
  city: City | null | undefined,
  productId: ProductId,
): NormalizedProductMarket | null {
  if (!city || !city.products) {
    return null;
  }

  const raw = city.products[productId] as (CityProductState & { price?: number }) | undefined;
  if (!raw) {
    return null;
  }

  const basePrice = raw.basePrice ?? 0;
  const currentPrice = raw.currentPrice ?? raw.price ?? basePrice;
  const stock = raw.stock ?? 0;
  const targetStock = raw.targetStock && raw.targetStock > 0 ? raw.targetStock : Math.max(stock, 1);

  return {
    productId,
    stock,
    targetStock,
    currentPrice,
    basePrice,
    productionPerDay: raw.productionPerDay ?? 0,
    consumptionPerDay: raw.consumptionPerDay ?? 0,
  };
}

function calculateStockRatio(market: NormalizedProductMarket): number {
  const safeTarget = Math.max(market.targetStock, 1);
  return market.stock / safeTarget;
}

function getMarketStatus(stockRatio: number): MarketStatus {
  if (stockRatio < 0.3) return 'Kritik Kıtlık';
  if (stockRatio < 0.7) return 'Kıtlık';
  if (stockRatio <= 1.2) return 'Dengeli';
  if (stockRatio <= 1.6) return 'Fazla';
  return 'Yüksek Fazla';
}

function getMarketStatusVariant(status: MarketStatus): StatusBadgeVariant {
  switch (status) {
    case 'Kritik Kıtlık':
      return 'danger';
    case 'Kıtlık':
      return 'warning';
    case 'Dengeli':
      return 'muted';
    case 'Fazla':
      return 'success';
    case 'Yüksek Fazla':
      return 'success';
    default:
      return 'muted';
  }
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
  if (stockRatio < 0.5) return 'Bu şehirde ürün ihtiyacı duyuluyor.';
  if (stockRatio > 1.4) return 'Bu şehirde ürün fazlası var.';
  return 'Bu ürün dengeli seviyede.';
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

function buildMarketAlert(cities: City[], products: Product[], routes: Route[]): MarketAlert {
  const { criticalShortage, highestSurplus } = findMarketHighlights(cities, products);
  const opportunities = findMarketOpportunities(cities, routes, products, MAX_OPPORTUNITIES);
  const bestOpportunity = opportunities[0] ?? null;
  const isStable = !criticalShortage && !highestSurplus && !bestOpportunity;

  return { isStable, criticalShortage, highestSurplus, bestOpportunity };
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
        label="Kritik"
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

function FuelPriceCard({ fuelPrice }: { fuelPrice: number }) {
  const trendBars = [0.5, 0.65, 0.58, 0.72, 0.68, 0.85];
  const expensive = isFuelExpensiveForDisplay(fuelPrice);

  return (
    <AppCard style={styles.fuelCard} padded={false}>
      <View style={styles.fuelRow}>
        <View style={styles.fuelIconWrap}>
          <GameIcon name="fuel" size={16} color={colors.accentAmber} />
        </View>
        <View style={styles.fuelMain}>
          <Text style={styles.fuelLabel}>Yakıt Fiyatı</Text>
          <Text style={styles.fuelValue}>{formatUnitPrice(fuelPrice, ' / L')}</Text>
        </View>
        <View style={styles.fuelTrendMini}>
          {trendBars.map((height, index) => (
            <View
              key={`fuel-bar-${index}`}
              style={[
                styles.trendBar,
                {
                  height: 6 + height * 8,
                  backgroundColor:
                    index === trendBars.length - 1 ? colors.accentAmber : colors.borderStrong,
                },
              ]}
            />
          ))}
        </View>
        {expensive ? (
          <StatusBadge label="Yakıt pahalı" variant="warning" size="sm" />
        ) : (
          <StatusBadge label="Canlı" variant="amber" size="sm" />
        )}
      </View>
    </AppCard>
  );
}

function MarketAlertCard({ alert }: { alert: MarketAlert }) {
  return (
    <AppCard variant="highlighted" style={styles.alertCard} padded>
      <View style={styles.alertHeaderRow}>
        <View style={styles.alertTitleRow}>
          <GameIcon name="warning" size={16} color={colors.accentAmber} />
          <Text style={styles.alertTitle}>Piyasa Uyarısı</Text>
        </View>
        <StatusBadge label="Piyasa yeni" variant="info" size="sm" />
      </View>

      {alert.criticalShortage ? (
        <Text style={styles.alertLine} numberOfLines={2}>
          <Text style={styles.alertLabel}>Kritik kıtlık: </Text>
          {getCityName(alert.criticalShortage.cityId)}'de{' '}
          {getProductName(alert.criticalShortage.productId)} stoğu çok düşük.
        </Text>
      ) : (
        <Text style={[styles.alertLine, { color: colors.success }]} numberOfLines={1}>
          Piyasa dengeli görünüyor.
        </Text>
      )}

      {alert.bestOpportunity ? (
        <Text style={styles.alertLine} numberOfLines={2}>
          <Text style={styles.alertLabel}>En iyi fırsat: </Text>
          {getCityName(alert.bestOpportunity.fromCityId)} →{' '}
          {getCityName(alert.bestOpportunity.toCityId)} · {alert.bestOpportunity.productName} ·{' '}
          {formatMoney(alert.bestOpportunity.priceGap)} fiyat farkı
        </Text>
      ) : (
        <Text style={styles.alertHint} numberOfLines={1}>
          Henüz belirgin taşıma fırsatı yok.
        </Text>
      )}
    </AppCard>
  );
}

function CityOverviewCard({
  cityName,
  shortages,
  surpluses,
  avgPrice,
  fuelModifier,
}: {
  cityName: string;
  shortages: number;
  surpluses: number;
  avgPrice: number;
  fuelModifier: number;
}) {
  return (
    <AppCard style={styles.cityOverviewCard} padded>
      <Text style={styles.cityOverviewTitle}>{cityName} Piyasa Özeti</Text>
      <View style={styles.cityOverviewRow}>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: colors.danger }]}>{shortages}</Text>
          <Text style={styles.cityOverviewLabel}>Kritik kıtlık</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: colors.success }]}>{surpluses}</Text>
          <Text style={styles.cityOverviewLabel}>Fazla stok</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: colors.accentAmber }]}>
            {formatMoney(avgPrice)}
          </Text>
          <Text style={styles.cityOverviewLabel}>Ort. fiyat</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: colors.info }]}>
            {fuelModifier.toFixed(2)}x
          </Text>
          <Text style={styles.cityOverviewLabel}>Yakıt etkisi</Text>
        </View>
      </View>
      <Text style={styles.cityOverviewHint}>
        Bu şehirde eksik ürünler daha pahalı, fazla ürünler daha ucuz olur.
      </Text>
    </AppCard>
  );
}

function ProductMarketCard({
  market,
  hasWarehouse,
  onBuyPress,
}: {
  market: NormalizedProductMarket;
  hasWarehouse: boolean;
  onBuyPress: () => void;
}) {
  const stockRatio = calculateStockRatio(market);
  const status = getMarketStatus(stockRatio);
  const statusVariant = getMarketStatusVariant(status);
  const hint = getOpportunityHint(market);
  const priceChange = getPriceChangePercent(market);
  const priceChangeLabel = formatPriceChangeDisplay(priceChange);
  const priceChangePositive = (priceChange ?? 0) >= 0;
  const progressValue = Math.min(stockRatio, 2) / 2;
  const stockDisplay = formatStockDisplay(market.stock, market.targetStock);

  return (
    <AppCard style={styles.productCard} padded={false}>
      <View style={styles.cardTopRow}>
        <View style={styles.productIconBox}>
          <ProductIcon productId={market.productId} size={15} color={colors.info} />
        </View>
        <View style={styles.cardMain}>
          <View style={styles.productTitleRow}>
            <Text style={styles.productName} numberOfLines={1} ellipsizeMode="tail">
              {getProductName(market.productId)}
            </Text>
            <StatusBadge label={status} variant={statusVariant} size="sm" />
          </View>
          <Text style={styles.productStock} numberOfLines={1} ellipsizeMode="tail">
            {stockDisplay.primary}
          </Text>
          {stockDisplay.detail ? (
            <Text style={styles.productStockDetail} numberOfLines={1} ellipsizeMode="tail">
              {stockDisplay.detail}
            </Text>
          ) : null}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.productPrice}>{formatMoney(market.currentPrice)}</Text>
          <Text style={styles.productPriceUnit}>/ ton</Text>
          {priceChangeLabel ? (
            <Text
              style={[
                styles.priceChangeText,
                { color: priceChangePositive ? colors.success : colors.danger },
              ]}
              numberOfLines={1}
            >
              {priceChangeLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.productHint} numberOfLines={1}>
        {hint}
      </Text>

      <View style={styles.productFooterRow}>
        <View style={styles.productProgress}>
          <ProgressBar progress={progressValue} color={getStockBarColor(stockRatio)} height={2} />
        </View>
        <ActionButton
          label={hasWarehouse ? 'Satın Al' : 'Depo Gerekli'}
          onPress={onBuyPress}
          variant={hasWarehouse ? 'primary' : 'secondary'}
          icon={hasWarehouse ? 'cash' : 'warehouse'}
          iconSize={11}
          compact
          style={styles.productAction}
        />
      </View>
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
  const notifyMarketScreenOpened = useGameStore((state) => state.notifyMarketScreenOpened);

  const [activeTab, setActiveTab] = useState<MarketTab>('products');
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [tradeProductId, setTradeProductId] = useState<ProductId | null>(null);

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

  const marketAlert = useMemo(
    () => buildMarketAlert(cities, products, routes),
    [cities, products, routes],
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

  const handleBuyProductPress = (productId: ProductId) => {
    if (!selectedCity) return;

    if (selectedCityWarehouses.length === 0) {
      showAlert(
        'Depo gerekli',
        'Bu şehirden ürün almak için önce burada depo açmalısın.',
      );
      return;
    }

    setTradeProductId(productId);
    setTradeModalVisible(true);
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

    setTradeModalVisible(false);
    setTradeProductId(null);
    setStatusMessage(result.message ?? 'Ürün satın alındı');
  };

  const handleOpenWarehouses = () => {
    useGameStore.setState({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'warehouse',
    });
    setTradeModalVisible(false);
    setTradeProductId(null);
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
        subtitle="Stokları, fiyatları ve taşıma fırsatlarını analiz et"
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

      <FuelPriceCard fuelPrice={fuelPrice} />
      <MarketAlertCard alert={marketAlert} />

      <SegmentedControl
        options={MARKET_TABS}
        activeKey={activeTab}
        onChange={setActiveTab}
        accentColor={colors.accentBlue}
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

          {!selectedCity ? (
            <EmptyState title="Şehir seç" message="Ürün fiyatlarını görmek için bir şehir seç." icon="city" />
          ) : (
            <>
              <CityOverviewCard
                cityName={selectedCity.name}
                shortages={selectedCityOverview.shortages}
                surpluses={selectedCityOverview.surpluses}
                avgPrice={selectedCityOverview.avgPrice}
                fuelModifier={selectedCityOverview.fuelModifier}
              />

              <SectionTitle title="Ürün Piyasası" subtitle={`${selectedCity.name} ürün fiyatları`} compact />

              {products.every((product) => !getProductMarket(selectedCity, product.id)) ? (
                <EmptyState title="Ürün verisi yok" icon="inventory" />
              ) : (
                products.map((product) => {
                  const market = getProductMarket(selectedCity, product.id);
                  if (!market) return null;
                  return (
                    <ProductMarketCard
                      key={product.id}
                      market={market}
                      hasWarehouse={selectedCityWarehouses.length > 0}
                      onBuyPress={() => handleBuyProductPress(product.id)}
                    />
                  );
                })
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

      <TradeProductModal
        visible={tradeModalVisible}
        mode="buy"
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
        cityWarehouses={tradeWarehouseOptions}
        showColdWarehouseSuggestion={showColdWarehouseSuggestion}
        playerCash={player?.money ?? 0}
        onConfirm={handleConfirmBuy}
        onOpenWarehouses={handleOpenWarehouses}
        onClose={() => {
          setTradeModalVisible(false);
          setTradeProductId(null);
        }}
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
  fuelCard: {
    marginBottom: spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fuelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  fuelIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.accentAmberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fuelMain: {
    flex: 1,
    minWidth: 0,
  },
  fuelLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  fuelValue: {
    ...typography.bodySmall,
    fontSize: 13,
    fontWeight: '800',
    color: colors.accentAmber,
    marginTop: 1,
  },
  fuelTrendMini: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
    width: 42,
  },
  trendBar: {
    flex: 1,
    borderRadius: 2,
    minWidth: 4,
  },
  alertCard: {
    marginBottom: spacing.sm,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  alertTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  alertLine: {
    ...typography.caption,
    color: colors.textPrimary,
    lineHeight: 17,
    marginTop: 4,
  },
  alertLabel: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  alertHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  tabContent: {
    marginTop: spacing.sm,
  },
  cityChipRow: {
    paddingBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  cityOverviewCard: {
    marginBottom: spacing.sm,
  },
  cityOverviewTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  cityOverviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cityOverviewItem: {
    flex: 1,
    alignItems: 'center',
  },
  cityOverviewValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  cityOverviewLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  cityOverviewHint: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 14,
    marginTop: spacing.sm,
  },
  productCard: {
    marginBottom: 8,
    paddingVertical: 10,
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
    minWidth: 72,
  },
  productName: {
    ...typography.cardTitle,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  productStock: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  productStockDetail: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  productPrice: {
    ...typography.bodySmall,
    fontSize: 12,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  productPriceUnit: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
  },
  priceChangeText: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  productHint: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
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
  productAction: {
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 10,
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
