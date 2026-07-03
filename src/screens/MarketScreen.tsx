/**
 * LogistiCore - Piyasa (Market) Ekranı
 *
 * Stratejik ekonomi analizi: piyasa özeti, şehir stokları ve ticaret fırsatları.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import TradeProductModal from '../components/TradeProductModal';
import { useGameStore } from '../store/gameStore';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { countExactMarketContractMatches, findMarketOpportunities } from '../simulation/contracts';
import {
  getCityProductMarketPrice,
  getCityProductStock,
  getWarehouseFreeCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import type { City, CityProductState, MarketOpportunity, Product, ProductId, Route } from '../types/game';

const COLORS = {
  background: '#070A12',
  card: '#111827',
  cardAlt: '#121826',
  border: '#1F2A3C',
  primary: '#F59E0B',
  secondary: '#38BDF8',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#FB923C',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
};

const CRITICAL_SHORTAGE_RATIO = 0.35;
const HIGH_SURPLUS_RATIO = 1.5;
const SHORTAGE_THRESHOLD = 0.7;
const SURPLUS_THRESHOLD = 1.2;
const STATUS_MESSAGE_TIMEOUT_MS = 2000;

const MAX_OPPORTUNITIES = 3;

type MarketStatus = 'Kritik Kıtlık' | 'Kıtlık' | 'Dengeli' | 'Fazla' | 'Yüksek Fazla';

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

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTons(value: number): string {
  return `${value.toFixed(1)} ton`;
}

function formatTime(hours: number): string {
  const totalHours = Math.max(0, Math.floor(hours));
  const day = Math.floor(totalHours / 24) + 1;
  const hourOfDay = totalHours % 24;
  return `Gün ${day} · ${hourOfDay.toString().padStart(2, '0')}:00`;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductMarket(
  city: City | null | undefined,
  productId: ProductId,
): NormalizedProductMarket | null {
  if (!city || !city.products) {
    return null;
  }

  const raw = city.products[productId] as
    | (CityProductState & { price?: number })
    | undefined;

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

function getMarketStatusColor(status: MarketStatus): string {
  switch (status) {
    case 'Kritik Kıtlık':
      return COLORS.danger;
    case 'Kıtlık':
      return COLORS.warning;
    case 'Dengeli':
      return COLORS.secondary;
    case 'Fazla':
      return COLORS.success;
    case 'Yüksek Fazla':
      return '#A3E635';
    default:
      return COLORS.textSecondary;
  }
}

function getOpportunityHint(market: NormalizedProductMarket): string {
  const stockRatio = calculateStockRatio(market);

  if (stockRatio < 0.5) {
    return 'Bu şehirde ürün ihtiyacı duyuluyor.';
  }
  if (stockRatio > 1.4) {
    return 'Bu şehirde ürün fazlası var.';
  }
  return 'Bu ürün dengeli seviyede.';
}

function getDemandLevelLabel(level: MarketOpportunity['demandLevel']): string {
  switch (level) {
    case 'high':
      return 'yüksek';
    case 'medium':
      return 'orta';
    default:
      return 'düşük';
  }
}

function findMarketHighlights(cities: City[], products: Product[]): {
  criticalShortage: MarketHighlight | null;
  highestSurplus: MarketHighlight | null;
} {
  let criticalShortage: MarketHighlight | null = null;
  let highestSurplus: MarketHighlight | null = null;

  for (const city of cities) {
    for (const product of products) {
      const market = getProductMarket(city, product.id);
      if (!market) continue;

      const stockRatio = calculateStockRatio(market);

      if (
        stockRatio < CRITICAL_SHORTAGE_RATIO &&
        (!criticalShortage || stockRatio < criticalShortage.stockRatio)
      ) {
        criticalShortage = { cityId: city.id, productId: product.id, stockRatio };
      }

      if (
        stockRatio > HIGH_SURPLUS_RATIO &&
        (!highestSurplus || stockRatio > highestSurplus.stockRatio)
      ) {
        highestSurplus = { cityId: city.id, productId: product.id, stockRatio };
      }
    }
  }

  return { criticalShortage, highestSurplus };
}

function buildMarketAlert(
  cities: City[],
  products: Product[],
  routes: Route[],
): MarketAlert {
  const { criticalShortage, highestSurplus } = findMarketHighlights(cities, products);
  const opportunities = findMarketOpportunities(cities, routes, products, MAX_OPPORTUNITIES);
  const bestOpportunity = opportunities[0] ?? null;

  const isStable = !criticalShortage && !highestSurplus && !bestOpportunity;

  return { isStable, criticalShortage, highestSurplus, bestOpportunity };
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function CityButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.cityButton, active && styles.cityButtonActive]} onPress={onPress}>
      <Text style={[styles.cityButtonText, active && styles.cityButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MarketAlertCard({
  alert,
  onRefresh,
}: {
  alert: MarketAlert;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.alertCard}>
      <View style={styles.alertHeaderRow}>
        <Text style={styles.alertTitle}>Piyasa Uyarısı</Text>
        <TouchableOpacity style={styles.alertRefreshButton} onPress={onRefresh} activeOpacity={0.85}>
          <Text style={styles.alertRefreshButtonText}>Piyasayı Yenile</Text>
        </TouchableOpacity>
      </View>

      {alert.criticalShortage ? (
        <Text style={styles.alertBodyText}>
          <Text style={styles.alertBodyLabel}>Kritik kıtlık: </Text>
          {getCityName(alert.criticalShortage.cityId)}'da {getProductName(alert.criticalShortage.productId)}{' '}
          stoğu kritik seviyede.
        </Text>
      ) : (
        <Text style={[styles.alertBodyText, { color: COLORS.success }]}>Piyasa dengeli görünüyor.</Text>
      )}

      {alert.bestOpportunity ? (
        <Text style={[styles.alertBodyText, styles.alertBodyTextSpaced]}>
          <Text style={styles.alertBodyLabel}>En iyi fırsat: </Text>
          {getCityName(alert.bestOpportunity.fromCityId)} →{' '}
          {getCityName(alert.bestOpportunity.toCityId)} ·{' '}
          {alert.bestOpportunity.productName} ·{' '}
          {formatMoney(alert.bestOpportunity.priceGap)} fiyat farkı
        </Text>
      ) : (
        <Text style={[styles.alertHintText, styles.alertBodyTextSpaced]}>
          Henüz belirgin taşıma fırsatı yok.
        </Text>
      )}
    </View>
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
    <View style={styles.cityOverviewCard}>
      <Text style={styles.sectionTitle}>{cityName} Piyasa Özeti</Text>
      <View style={styles.cityOverviewRow}>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: COLORS.danger }]}>{shortages}</Text>
          <Text style={styles.cityOverviewLabel}>Kritik kıtlık</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: COLORS.success }]}>{surpluses}</Text>
          <Text style={styles.cityOverviewLabel}>Fazla stok</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: COLORS.primary }]}>{formatMoney(avgPrice)}</Text>
          <Text style={styles.cityOverviewLabel}>Ort. fiyat</Text>
        </View>
        <View style={styles.cityOverviewItem}>
          <Text style={[styles.cityOverviewValue, { color: COLORS.secondary }]}>
            {fuelModifier.toFixed(2)}x
          </Text>
          <Text style={styles.cityOverviewLabel}>Yakıt etkisi</Text>
        </View>
      </View>
      <Text style={styles.cityOverviewHint}>
        Bu şehirde eksik ürünler daha pahalı, fazla ürünler daha ucuz olur.
      </Text>
    </View>
  );
}

function ProductMarketCard({
  market,
  cityStock,
  hasWarehouse,
  onBuyPress,
}: {
  market: NormalizedProductMarket;
  cityStock: number;
  hasWarehouse: boolean;
  onBuyPress: () => void;
}) {
  const stockRatio = calculateStockRatio(market);
  const status = getMarketStatus(stockRatio);
  const statusColor = getMarketStatusColor(status);
  const hint = getOpportunityHint(market);
  const progressValue = Math.min(stockRatio, 2) / 2;

  return (
    <View style={styles.productCard}>
      <View style={styles.productHeaderRow}>
        <Text style={styles.productName}>{getProductName(market.productId)}</Text>
        <Text style={[styles.marketStatusBadge, { color: statusColor }]}>{status}</Text>
      </View>

      <ProgressBar progress={progressValue} color={statusColor} />

      <View style={styles.productMetaRow}>
        <Text style={styles.productMeta}>
          Stok: {market.stock.toFixed(1)} / {market.targetStock.toFixed(1)} ton
        </Text>
        <Text style={styles.productMeta}>Doluluk: {formatPercent(stockRatio)}</Text>
      </View>

      <Text style={styles.productPrice}>{formatMoney(market.currentPrice)}</Text>
      <Text style={styles.productMeta}>Şehir stoğu: {cityStock.toFixed(1)} ton</Text>
      <Text style={styles.opportunityHint}>{hint}</Text>
      <Text style={styles.productDetail}>
        Üretim: {market.productionPerDay.toFixed(1)} ton/gün · Tüketim:{' '}
        {market.consumptionPerDay.toFixed(1)} ton/gün
      </Text>

      <TouchableOpacity
        style={[styles.tradeActionButton, !hasWarehouse && styles.tradeActionButtonMuted]}
        onPress={onBuyPress}
        activeOpacity={0.85}
      >
        <Text style={styles.tradeActionButtonText}>{hasWarehouse ? 'Satın Al' : 'Depo Gerekli'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function OpportunityCard({
  opportunity,
  matchingContractsCount,
  onViewContracts,
}: {
  opportunity: MarketOpportunity;
  matchingContractsCount: number;
  onViewContracts: (opportunity: MarketOpportunity) => void;
}) {
  const hasActiveContracts = matchingContractsCount > 0;

  return (
    <View style={styles.opportunityCard}>
      <View style={styles.opportunityHeaderRow}>
        <View style={styles.opportunityHeaderMain}>
          <Text style={styles.opportunityRoute}>
            {opportunity.fromCityName || getCityName(opportunity.fromCityId)} →{' '}
            {opportunity.toCityName || getCityName(opportunity.toCityId)}
          </Text>
          <Text style={styles.opportunityProduct}>Ürün: {opportunity.productName}</Text>
        </View>
      </View>

      <Text style={styles.opportunityLine}>
        Fiyat farkı: <Text style={styles.opportunityLineValue}>{formatMoney(opportunity.priceGap)}</Text>
      </Text>
      <Text style={styles.opportunityLine}>
        Mesafe: <Text style={styles.opportunityLineValue}>{Math.round(opportunity.distanceKm)} km</Text>
      </Text>
      <Text style={styles.opportunityLine}>
        Tahmini talep:{' '}
        <Text style={styles.opportunityLineValue}>{getDemandLevelLabel(opportunity.demandLevel)}</Text>
      </Text>
      <Text style={styles.opportunityLine}>
        Aktif sözleşme:{' '}
        <Text style={[styles.opportunityLineValue, { color: hasActiveContracts ? COLORS.success : COLORS.textMuted }]}>
          {matchingContractsCount}
        </Text>
      </Text>

      {!hasActiveContracts ? (
        <Text style={styles.opportunityPendingHint}>Bu rota için aktif sözleşme bekleniyor</Text>
      ) : null}

      <TouchableOpacity
        style={styles.opportunityActionButton}
        onPress={() => onViewContracts(opportunity)}
        activeOpacity={0.85}
      >
        <Text style={styles.opportunityActionButtonText}>Sözleşmeleri Gör</Text>
      </TouchableOpacity>
    </View>
  );
}

interface MarketScreenProps {
  onOpenContracts?: () => void;
}

export default function MarketScreen({ onOpenContracts }: MarketScreenProps) {
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
  const { scrollBottomPadding } = useTabBarLayout();

  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [tradeProductId, setTradeProductId] = useState<ProductId | null>(null);

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
    const counts = new Map<string, number>();
    for (const opportunity of opportunities) {
      counts.set(
        opportunity.id,
        countExactMarketContractMatches(availableContracts, {
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

  const selectedCityWarehouse = useMemo(() => {
    if (!selectedCity) return null;
    const warehouse = (player?.warehouses ?? []).find((item) => item.cityId === selectedCity.id);
    return warehouse ? normalizeWarehouse(warehouse) : null;
  }, [player?.warehouses, selectedCity]);

  const tradeProduct = useMemo(
    () => products.find((item) => item.id === tradeProductId) ?? null,
    [products, tradeProductId],
  );

  const handleBuyProductPress = (productId: ProductId) => {
    if (!selectedCity) return;

    if (!selectedCityWarehouse) {
      Alert.alert(
        'Depo gerekli',
        'Bu şehirden ürün almak için önce burada depo açmalısın.',
      );
      return;
    }

    setTradeProductId(productId);
    setTradeModalVisible(true);
  };

  const handleConfirmBuy = (quantity: number) => {
    if (!selectedCity || !tradeProductId) return;

    const result = buyProductForWarehouse({
      cityId: selectedCity.id,
      productId: tradeProductId,
      quantity,
      warehouseId: selectedCityWarehouse?.id,
    });

    if (!result.success) {
      Alert.alert('Satın alma başarısız', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }

    setTradeModalVisible(false);
    setTradeProductId(null);
    setStatusMessage(result.message ?? 'Ürün satın alındı');
  };

  const handleRefreshMarket = () => {
    refreshMarketSnapshot();
    setStatusMessage('Piyasa yenilendi');
  };

  const handleOpenContractsForOpportunity = (opportunity: MarketOpportunity) => {
    if (__DEV__) {
      // TODO: remove verbose market-contract debug logs before release.
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (cities.length === 0 || products.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyStateTitle}>Piyasa verisi yok</Text>
          <Text style={styles.emptyStateSubtitle}>Şehir ve ürün verileri henüz yüklenmedi.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Piyasa</Text>
          <Text style={styles.subtitle}>
            Şehir stoklarını, fiyatları ve taşıma fırsatlarını analiz et.
          </Text>
          <View style={styles.headerBadges}>
            <View style={styles.headerBadge}>
              <Text style={[styles.headerBadgeValue, { color: COLORS.secondary }]}>
                ${globalEconomy.fuelPrice.toFixed(2)}/L
              </Text>
              <Text style={styles.headerBadgeLabel}>Yakıt</Text>
            </View>
            <View style={styles.headerBadge}>
              <Text style={[styles.headerBadgeValue, { color: COLORS.primary }]}>
                {formatTime(currentTime)}
              </Text>
              <Text style={styles.headerBadgeLabel}>Zaman</Text>
            </View>
          </View>
        </View>

        {statusMessage ? (
          <View style={styles.statusToast}>
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        ) : null}

        <MarketAlertCard alert={marketAlert} onRefresh={handleRefreshMarket} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={styles.citySelectorScroll}
          contentContainerStyle={styles.citySelectorContent}
        >
          {cities.map((city) => (
            <CityButton
              key={city.id}
              label={city.name}
              active={city.id === selectedCityId}
              onPress={() => setSelectedCityId(city.id)}
            />
          ))}
        </ScrollView>

        {selectedCity ? (
          <CityOverviewCard
            cityName={selectedCity.name}
            shortages={selectedCityOverview.shortages}
            surpluses={selectedCityOverview.surpluses}
            avgPrice={selectedCityOverview.avgPrice}
            fuelModifier={selectedCityOverview.fuelModifier}
          />
        ) : null}

        {selectedCity ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ürün Piyasası</Text>
            {products.map((product) => {
              const market = getProductMarket(selectedCity, product.id);
              if (!market) return null;
              return (
                <ProductMarketCard
                  key={product.id}
                  market={market}
                  cityStock={getCityProductStock(selectedCity, product.id)}
                  hasWarehouse={!!selectedCityWarehouse}
                  onBuyPress={() => handleBuyProductPress(product.id)}
                />
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fırsat Tarayıcı</Text>
          <Text style={styles.sectionSubtitle}>
            Şehirler arası fiyat ve stok farklarına göre olası kârlı rotalar.
          </Text>
          {opportunities.length === 0 ? (
            <Text style={styles.emptyText}>Henüz belirgin taşıma fırsatı yok.</Text>
          ) : (
            opportunities.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                matchingContractsCount={opportunityMatchCounts.get(opportunity.id) ?? 0}
                onViewContracts={handleOpenContractsForOpportunity}
              />
            ))
          )}
        </View>
      </ScrollView>

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
        warehouseFreeCapacity={selectedCityWarehouse ? getWarehouseFreeCapacityTon(selectedCityWarehouse) : 0}
        playerCash={player?.money ?? 0}
        onConfirm={handleConfirmBuy}
        onClose={() => {
          setTradeModalVisible(false);
          setTradeProductId(null);
        }}
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
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },

  header: {
    marginBottom: 14,
  },
  title: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  headerBadges: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  headerBadge: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerBadgeValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  headerBadgeLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 1,
  },

  statusToast: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusToastText: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '700',
  },

  alertCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  alertRefreshButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.card,
  },
  alertRefreshButtonText: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  alertBodyText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  alertBodyLabel: {
    color: COLORS.textMuted,
    fontWeight: '700',
  },
  alertBodyTextSpaced: {
    marginTop: 8,
  },
  alertHintText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },

  citySelectorScroll: {
    marginBottom: 12,
  },
  citySelectorContent: {
    paddingRight: UI.spacing.screen,
  },
  cityButton: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexShrink: 0,
  },
  cityButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  cityButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  cityButtonTextActive: {
    color: '#0B1220',
  },

  cityOverviewCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    fontSize: 15,
    fontWeight: '800',
  },
  cityOverviewLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  cityOverviewHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },

  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },

  emptyStateTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyStateSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyStateButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyStateButtonText: {
    color: '#0B1220',
    fontSize: 13,
    fontWeight: '700',
  },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  productCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 15,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  productHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  productName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
    marginRight: 8,
  },
  marketStatusBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  productMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  productMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  productPrice: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  opportunityHint: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 3,
  },
  productDetail: {
    color: COLORS.textMuted,
    fontSize: 10,
    opacity: 0.65,
  },

  opportunityCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 15,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  opportunityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  opportunityHeaderMain: {
    flex: 1,
  },
  opportunityStrengthBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: COLORS.cardAlt,
  },
  opportunityStrengthText: {
    fontSize: 10,
    fontWeight: '800',
  },
  opportunityRoute: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  opportunityProduct: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  opportunityLine: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  opportunityLineValue: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  opportunityPendingHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  opportunityActionButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  opportunityActionButtonText: {
    color: '#0B1220',
    fontSize: 12,
    fontWeight: '800',
  },
  tradeActionButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  tradeActionButtonMuted: {
    backgroundColor: '#334155',
  },
  tradeActionButtonText: {
    color: '#0B1220',
    fontSize: 12,
    fontWeight: '800',
  },
});
