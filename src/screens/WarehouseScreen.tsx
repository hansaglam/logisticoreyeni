/**
 * LogistiCore - Depo Ekranı
 *
 * More menüsü içinde kullanılan sade depo yönetimi ekranı.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import TradeProductModal from '../components/TradeProductModal';
import { useGameStore } from '../store/gameStore';
import { warehouseBalance } from '../config/balance';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import {
  calculateTradeProfit,
  getCityProductMarketPrice,
  getWarehouseUsedCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import {
  cityHasWarehouseType,
  getEffectiveSellPrice,
  getInventoryQuality,
  getQualityColorHint,
  getWarehouseTypeLabel,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import {
  canOpenMoreWarehouses,
  getMaxWarehousesForLevel,
  getNextLevelForMoreWarehouses,
  getWarehouseUpgradeRequiredLevel,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import type { City, CityProductState, ProductId, Warehouse, WarehouseType } from '../types/game';

const COLORS = {
  background: '#070A12',
  card: '#111827',
  cardAlt: '#121826',
  border: '#1F2A3C',
  primary: '#F59E0B',
  secondary: '#38BDF8',
  success: '#22C55E',
  danger: '#EF4444',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
};

const DEFAULT_RENT_PER_TON = warehouseBalance.rentPerTon;
const DEFAULT_ELECTRICITY_PER_TON = warehouseBalance.electricityPerTon;
const DEFAULT_STAFF_COST_PER_LEVEL = warehouseBalance.staffCostPerLevel;

const BASE_OPEN_COST = warehouseBalance.baseOpenCost;
const BASE_DAILY_RENT = warehouseBalance.baseDailyRent;

const SHORTAGE_RATIO_THRESHOLD = 0.7;
const SURPLUS_RATIO_THRESHOLD = 1.2;
const HIGH_VOLATILITY_THRESHOLD = 15;
const MAX_CITY_OPPORTUNITIES = 3;
const MAX_STRATEGY_TIPS = 3;
const STATUS_MESSAGE_TIMEOUT_MS = 3000;

const STORAGE_STRATEGY_TIPS: string[] = [
  'Ürün fazlası olan şehirlerde depo açmak, ucuz stok toplamak için avantaj sağlar.',
  'Kıtlık yaşayan şehirler yüksek fiyatlı teslimatlar için iyi hedef olabilir.',
  'Depo büyütmek esneklik sağlar ama günlük sabit giderleri artırır.',
];

type WarehouseLike = Warehouse & {
  name?: string;
  level?: number;
  capacity?: number;
  usedCapacity?: number;
  rent?: number;
  electricityCost?: number;
  staffCost?: number;
  quality?: number;
  stocks?: Record<string, number>;
};

interface WarehouseDailyCost {
  rent: number;
  electricityCost: number;
  staffCost: number;
  total: number;
}

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTons(value: number): string {
  return `${value.toFixed(1)} ton`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getWarehouseCity(warehouse: WarehouseLike): City | undefined {
  return CITIES_BY_ID[warehouse.cityId];
}

function getWarehouseName(warehouse: WarehouseLike): string {
  if (warehouse.name) return warehouse.name;
  const city = getWarehouseCity(warehouse);
  const typeLabel = getWarehouseTypeLabel(resolveWarehouseType(warehouse.warehouseType));
  return `${city?.name ?? warehouse.cityId} · ${typeLabel}`;
}

function getWarehouseCapacity(warehouse: WarehouseLike): number {
  return warehouse.capacity ?? warehouse.capacityTons ?? 0;
}

function getWarehouseLevel(warehouse: WarehouseLike): number {
  return warehouse.upgradeTier ?? warehouse.level ?? 1;
}

function getWarehouseStocks(warehouse: WarehouseLike): Record<string, number> {
  const source = warehouse.stocks ?? warehouse.storedProducts ?? {};
  const result: Record<string, number> = {};
  for (const [productId, amount] of Object.entries(source)) {
    if (typeof amount === 'number' && amount > 0) {
      result[productId] = amount;
    }
  }
  return result;
}

function calculateWarehouseUsedCapacity(warehouse: WarehouseLike): number {
  if (typeof warehouse.usedCapacity === 'number') {
    return warehouse.usedCapacity;
  }
  if (typeof warehouse.usedCapacityTon === 'number') {
    return warehouse.usedCapacityTon;
  }
  return getWarehouseUsedCapacityTon(warehouse);
}

function calculateWarehouseFreeCapacity(warehouse: WarehouseLike): number {
  const free = getWarehouseCapacity(warehouse) - calculateWarehouseUsedCapacity(warehouse);
  return Math.max(0, free);
}

function calculateWarehouseDailyCost(warehouse: WarehouseLike): WarehouseDailyCost {
  const capacity = getWarehouseCapacity(warehouse);
  const level = getWarehouseLevel(warehouse);
  const city = getWarehouseCity(warehouse);
  const costModifier = city?.warehouseCostModifier ?? 1;
  const warehouseType = resolveWarehouseType(warehouse.warehouseType);
  const coldElectricityMultiplier =
    warehouseType === 'cold' ? warehouseBalance.coldElectricityMultiplier : 1;

  const rent = warehouse.rent ?? capacity * DEFAULT_RENT_PER_TON * costModifier;
  const electricityCost =
    (warehouse.electricityCost ?? capacity * DEFAULT_ELECTRICITY_PER_TON * costModifier) *
    coldElectricityMultiplier;
  const staffCost = warehouse.staffCost ?? level * DEFAULT_STAFF_COST_PER_LEVEL;

  return {
    rent,
    electricityCost,
    staffCost,
    total: rent + electricityCost + staffCost,
  };
}

function calculateTotalWarehouseCapacity(warehouses: WarehouseLike[]): number {
  return warehouses.reduce((sum, w) => sum + getWarehouseCapacity(w), 0);
}

function calculateTotalUsedCapacity(warehouses: WarehouseLike[]): number {
  return warehouses.reduce((sum, w) => sum + calculateWarehouseUsedCapacity(w), 0);
}

function calculateTotalDailyWarehouseCost(warehouses: WarehouseLike[]): number {
  return warehouses.reduce((sum, w) => sum + calculateWarehouseDailyCost(w).total, 0);
}

function getUtilizationColor(utilization: number): string {
  if (utilization <= 0.5) return COLORS.success;
  if (utilization <= 0.8) return COLORS.primary;
  return COLORS.danger;
}

function getCityProductPrice(city: City | undefined, productId: string): number {
  if (!city) return 0;
  const raw = city.products[productId as ProductId] as
    | (CityProductState & { price?: number })
    | undefined;
  if (!raw) return 0;
  return raw.currentPrice ?? raw.price ?? raw.basePrice ?? 0;
}

function calculateProductStockRatio(state: CityProductState): number {
  const target = state.targetStock && state.targetStock > 0 ? state.targetStock : Math.max(state.stock, 1);
  return state.stock / target;
}

function countCityShortages(city: City): number {
  return Object.values(city.products).filter(
    (state) => calculateProductStockRatio(state) < SHORTAGE_RATIO_THRESHOLD,
  ).length;
}

function countCitySurpluses(city: City): number {
  return Object.values(city.products).filter(
    (state) => calculateProductStockRatio(state) > SURPLUS_RATIO_THRESHOLD,
  ).length;
}

function calculatePriceVolatility(city: City): number {
  const states = Object.values(city.products);
  if (states.length === 0) return 0;

  const diffs = states.map((state) => {
    const current = state.currentPrice ?? state.basePrice;
    const base = Math.max(state.basePrice, 1);
    return Math.abs((current - base) / base) * 100;
  });

  return diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
}

function getWarehouseSuggestion(city: City): string {
  const shortages = countCityShortages(city);
  const surpluses = countCitySurpluses(city);

  if (shortages > surpluses + 1) return 'İyi ithalat merkezi';
  if (surpluses > shortages + 1) return 'İyi ihracat merkezi';
  if (shortages > 0 && surpluses > 0) return 'Dengeli lojistik merkezi';
  if (calculatePriceVolatility(city) > HIGH_VOLATILITY_THRESHOLD) return 'Yüksek ticaret potansiyeli';
  return 'Dengeli piyasa';
}

function getCityOpportunityScore(city: City): number {
  return countCityShortages(city) + countCitySurpluses(city);
}

function getEstimatedOpenCost(city: City, warehouseType: WarehouseType = 'standard'): number {
  const modifier = city.warehouseCostModifier ?? 1;
  const typeMultiplier =
    warehouseType === 'cold' ? warehouseBalance.coldOpenCostMultiplier : 1;
  return BASE_OPEN_COST * modifier * typeMultiplier;
}

function getEstimatedDailyRent(city: City, warehouseType: WarehouseType = 'standard'): number {
  const modifier = city.warehouseCostModifier ?? 1;
  const coldMultiplier =
    warehouseType === 'cold' ? warehouseBalance.coldElectricityMultiplier : 1;
  return BASE_DAILY_RENT * modifier * (warehouseType === 'cold' ? 1.35 : 1) * (coldMultiplier > 1 ? 1.1 : 1);
}

function SummaryCard({
  totalCapacity,
  usedCapacity,
  dailyCost,
}: {
  totalCapacity: number;
  usedCapacity: number;
  dailyCost: number;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryItem}>
        <Text style={[styles.summaryValue, { color: COLORS.secondary }]}>{formatTons(totalCapacity)}</Text>
        <Text style={styles.summaryLabel}>Toplam kapasite</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={[styles.summaryValue, { color: COLORS.success }]}>{formatTons(usedCapacity)}</Text>
        <Text style={styles.summaryLabel}>Kullanılan</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={[styles.summaryValue, { color: COLORS.danger }]}>{formatMoney(dailyCost)}</Text>
        <Text style={styles.summaryLabel}>Günlük gider</Text>
      </View>
    </View>
  );
}

function WarehouseCard({
  warehouse,
  city,
  playerLevel,
  playerMoney,
  onSellProduct,
  onUpgrade,
}: {
  warehouse: WarehouseLike;
  city?: City;
  playerLevel: number;
  playerMoney: number;
  onSellProduct: (warehouse: Warehouse, productId: ProductId) => void;
  onUpgrade: (warehouse: WarehouseLike) => void;
}) {
  const normalized = normalizeWarehouse(warehouse);
  const capacity = getWarehouseCapacity(warehouse);
  const used = calculateWarehouseUsedCapacity(warehouse);
  const free = calculateWarehouseFreeCapacity(warehouse);
  const cost = calculateWarehouseDailyCost(warehouse);
  const warehouseUtilization = capacity > 0 ? used / capacity : 0;
  const utilizationColor = getUtilizationColor(warehouseUtilization);
  const inventory = normalized.inventory ?? [];
  const warehouseTypeLabel = getWarehouseTypeLabel(resolveWarehouseType(warehouse.warehouseType));
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const currentTier = warehouse.upgradeTier ?? 1;
  const upgradeRequiredLevel = getWarehouseUpgradeRequiredLevel(currentTier);
  const isUpgradeMaxed = upgradeRequiredLevel == null;
  const isUpgradeLevelLocked =
    upgradeRequiredLevel != null && safePlayerLevel < upgradeRequiredLevel;
  const estimatedUpgradeCost = Math.round(
    warehouseBalance.baseOpenCost * 0.5 * (city?.warehouseCostModifier ?? 1),
  );
  const canAffordUpgrade = playerMoney >= estimatedUpgradeCost;

  let upgradeButtonLabel = 'Yükselt';
  if (isUpgradeMaxed) {
    upgradeButtonLabel = 'Maksimum';
  } else if (isUpgradeLevelLocked) {
    upgradeButtonLabel = `Level ${upgradeRequiredLevel} gerekli`;
  } else if (!canAffordUpgrade) {
    upgradeButtonLabel = 'Nakit yetersiz';
  } else if (currentTier >= 2) {
    upgradeButtonLabel = 'Büyük depo';
  } else if (currentTier >= 1) {
    upgradeButtonLabel = 'Orta depo';
  }

  const upgradeDisabled = isUpgradeMaxed || isUpgradeLevelLocked || !canAffordUpgrade;

  return (
    <View style={styles.warehouseCard}>
      <View style={styles.warehouseHeaderRow}>
        <View style={styles.warehouseHeaderText}>
          <Text style={styles.warehouseName}>{getWarehouseName(warehouse)}</Text>
          <Text style={styles.warehouseMeta}>
            {city?.name ?? warehouse.cityId} · {warehouseTypeLabel} · Seviye {getWarehouseLevel(warehouse)}
          </Text>
        </View>
        <Text style={[styles.utilizationBadge, { color: utilizationColor }]}>
          {formatPercent(warehouseUtilization)}
        </Text>
      </View>

      <View style={styles.warehouseStatsBlock}>
        <Text style={styles.warehouseStatLine}>Kapasite: {formatTons(capacity)}</Text>
        <Text style={styles.warehouseStatLine}>Kullanılan: {formatTons(used)}</Text>
        <Text style={styles.warehouseStatLine}>Boş alan: {formatTons(free)}</Text>
        <Text style={[styles.warehouseStatLine, { color: COLORS.danger }]}>
          Günlük gider: {formatMoney(cost.total)}
        </Text>
      </View>

      {inventory.length > 0 ? (
        <View style={styles.stockBox}>
          {inventory.map((item) => {
            const currentPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
            const itemQuality = getInventoryQuality(item);
            const qualityHint = getQualityColorHint(itemQuality);
            const qualityColor =
              qualityHint === 'critical'
                ? COLORS.danger
                : qualityHint === 'warning'
                  ? COLORS.primary
                  : COLORS.textSecondary;
            const effectiveSellPrice = getEffectiveSellPrice(currentPrice, itemQuality);
            const estimatedProfit = calculateTradeProfit(
              currentPrice,
              item.averageBuyPrice,
              item.quantity,
              itemQuality,
            );
            const profitColor = estimatedProfit >= 0 ? COLORS.success : COLORS.danger;

            return (
              <View key={item.productId} style={styles.inventoryCard}>
                <Text style={styles.stockProductName}>{getProductName(item.productId)}</Text>
                <Text style={styles.stockValue}>{formatTons(item.quantity)}</Text>
                <Text style={[styles.inventoryMeta, { color: qualityColor }]}>
                  Kalite: {Math.round(itemQuality)}%
                </Text>
                <Text style={styles.inventoryMeta}>
                  Alış ort.: {formatMoney(item.averageBuyPrice)} · Piyasa: {formatMoney(currentPrice)}
                </Text>
                <Text style={styles.inventoryMeta}>
                  Kaliteye göre satış: {formatMoney(effectiveSellPrice)}
                </Text>
                {item.storageWarning ? (
                  <Text style={styles.inventoryWarning}>{item.storageWarning}</Text>
                ) : null}
                <Text style={[styles.inventoryProfit, { color: profitColor }]}>
                  Tahmini kâr: {formatMoney(estimatedProfit)}
                </Text>
                <TouchableOpacity
                  style={styles.sellButton}
                  onPress={() => onSellProduct(normalized, item.productId)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.sellButtonText}>Sat</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyStockBlock}>
          <Text style={styles.emptyStockTitle}>Depo boş.</Text>
          <Text style={styles.emptyStockHint}>
            Piyasa ekranından ucuz ürün alıp burada stoklayabilir, fiyat yükselince satabilirsin.
          </Text>
        </View>
      )}

      <View style={styles.warehouseActionsRow}>
        {isUpgradeLevelLocked ? (
          <Text style={styles.levelLockText}>
            Bu yükseltme için Level {upgradeRequiredLevel} gerekli.
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.secondaryActionButton, upgradeDisabled && styles.openWarehouseButtonDisabled]}
          onPress={() => onUpgrade(warehouse)}
          disabled={upgradeDisabled}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryActionText}>{upgradeButtonLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StrategyTipsSection({ onShowMore }: { onShowMore: () => void }) {
  const visibleTips = STORAGE_STRATEGY_TIPS.slice(0, MAX_STRATEGY_TIPS);

  return (
    <View style={styles.section}>
      <View style={styles.tipsHeaderRow}>
        <Text style={styles.sectionTitle}>Depo Strateji İpuçları</Text>
        <TouchableOpacity onPress={onShowMore} activeOpacity={0.85}>
          <Text style={styles.tipsToggle}>Daha fazla</Text>
        </TouchableOpacity>
      </View>
      {visibleTips.map((tip, index) => (
        <View key={index} style={styles.tipRow}>
          <Text style={styles.tipBullet}>•</Text>
          <Text style={styles.tipText}>{tip}</Text>
        </View>
      ))}
    </View>
  );
}

export default function WarehouseScreen() {
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const openWarehouse = useGameStore((state) => state.openWarehouse);
  const upgradeWarehouse = useGameStore((state) => state.upgradeWarehouse);
  const sellProductFromWarehouse = useGameStore((state) => state.sellProductFromWarehouse);

  const warehouses: WarehouseLike[] = player?.warehouses ?? [];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [sellWarehouse, setSellWarehouse] = useState<Warehouse | null>(null);
  const [sellProductId, setSellProductId] = useState<ProductId | null>(null);
  const { scrollBottomPadding } = useTabBarLayout();

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const totalCapacity = useMemo(() => calculateTotalWarehouseCapacity(warehouses), [warehouses]);
  const usedCapacity = useMemo(() => calculateTotalUsedCapacity(warehouses), [warehouses]);
  const dailyCost = useMemo(() => calculateTotalDailyWarehouseCost(warehouses), [warehouses]);

  const warehouseCityIds = useMemo(() => new Set(warehouses.map((w) => w.cityId)), [warehouses]);
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const maxWarehouses = getMaxWarehousesForLevel(playerLevel);
  const canOpenMore = canOpenMoreWarehouses(playerLevel, warehouses.length);
  const nextWarehouseLevel = getNextLevelForMoreWarehouses(warehouses.length);
  const topCityOpportunities = useMemo(
    () =>
      cities
        .filter((c) => !warehouseCityIds.has(c.id))
        .sort((a, b) => getCityOpportunityScore(b) - getCityOpportunityScore(a))
        .slice(0, MAX_CITY_OPPORTUNITIES),
    [cities, warehouseCityIds],
  );

  const coldDepotOpportunities = useMemo(
    () =>
      cities.filter(
        (city) =>
          warehouseCityIds.has(city.id) &&
          !cityHasWarehouseType(warehouses, city.id, 'cold'),
      ),
    [cities, warehouseCityIds, warehouses],
  );

  const handleUpgradeWarehouse = (warehouse: WarehouseLike) => {
    const result = upgradeWarehouse(warehouse.id);
    if (!result.success) {
      Alert.alert('Depo yükseltilemedi', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }
    setStatusMessage(result.message ?? 'Depo yükseltildi');
  };

  const handleOpenWarehouse = (cityId: string, warehouseType: WarehouseType = 'standard') => {
    const result = openWarehouse(cityId, warehouseType);
    if (!result.success) {
      Alert.alert('Depo açılamadı', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }
    setStatusMessage(result.message ?? 'Depo açıldı');
  };

  const handleSellProduct = (warehouse: Warehouse, productId: ProductId) => {
    setSellWarehouse(warehouse);
    setSellProductId(productId);
    setTradeModalVisible(true);
  };

  const sellCity = useMemo(
    () => cities.find((city) => city.id === sellWarehouse?.cityId) ?? null,
    [cities, sellWarehouse?.cityId],
  );

  const sellProduct = useMemo(
    () => products.find((product) => product.id === sellProductId) ?? null,
    [products, sellProductId],
  );

  const sellInventoryItem = useMemo(() => {
    if (!sellWarehouse || !sellProductId) return null;
    return normalizeWarehouse(sellWarehouse).inventory?.find((item) => item.productId === sellProductId);
  }, [sellWarehouse, sellProductId]);

  const handleConfirmSell = (quantity: number) => {
    if (!sellWarehouse || !sellProductId) return;

    const result = sellProductFromWarehouse({
      warehouseId: sellWarehouse.id,
      productId: sellProductId,
      quantity,
    });

    if (!result.success) {
      Alert.alert('Satış başarısız', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }

    setTradeModalVisible(false);
    setSellWarehouse(null);
    setSellProductId(null);
    setStatusMessage(result.message ?? 'Ürün satıldı');
  };

  const handleShowMoreTips = () => {
    setStatusMessage('Ek depo stratejileri yakında eklenecek.');
  };

  if (!player) {
    return (
      <View style={styles.root}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </View>
    );
  }

  if (cities.length === 0 || products.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyStateTitle}>Şehir veya ürün verisi yok</Text>
          <Text style={styles.emptyStateSubtitle}>
            Depo verileri şehir ve ürün bilgilerine bağlıdır.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {statusMessage ? (
          <View style={styles.statusToast}>
            <Text style={styles.statusToastText}>{statusMessage}</Text>
          </View>
        ) : null}

        <SummaryCard
          totalCapacity={totalCapacity}
          usedCapacity={usedCapacity}
          dailyCost={dailyCost}
        />

        <Text style={styles.warehouseLimitHint}>
          Depo limiti: {warehouses.length}/{maxWarehouses}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Depolarım</Text>
          {warehouses.length === 0 ? (
            <Text style={styles.emptyText}>Henüz bir depon yok.</Text>
          ) : (
            warehouses.map((warehouse) => (
              <WarehouseCard
                key={warehouse.id}
                warehouse={warehouse}
                city={cities.find((city) => city.id === warehouse.cityId)}
                playerLevel={playerLevel}
                playerMoney={player.money}
                onSellProduct={handleSellProduct}
                onUpgrade={handleUpgradeWarehouse}
              />
            ))
          )}
        </View>

        {coldDepotOpportunities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Soğuk Depo Ekle</Text>
            {coldDepotOpportunities.map((city) => {
              const coldOpenCost = getEstimatedOpenCost(city, 'cold');
              const coldDailyRent = getEstimatedDailyRent(city, 'cold');
              const openDisabled = !canOpenMore || player.money < coldOpenCost;

              return (
                <View key={`cold-${city.id}`} style={styles.opportunityCard}>
                  <Text style={styles.warehouseName}>{city.name}</Text>
                  <Text style={styles.depotTypeHint}>
                    Bu şehirde normal depo var. Meyve ve içecek için soğuk depo önerilir.
                  </Text>
                  <Text style={styles.opportunityCostLine}>
                    Açılış: <Text style={styles.opportunityCostValue}>{formatMoney(coldOpenCost)}</Text>
                  </Text>
                  <Text style={styles.opportunityCostLine}>
                    Günlük gider:{' '}
                    <Text style={styles.opportunityCostValue}>{formatMoney(coldDailyRent)}</Text>
                  </Text>
                  <TouchableOpacity
                    style={[styles.openWarehouseButton, openDisabled && styles.openWarehouseButtonDisabled]}
                    onPress={() => handleOpenWarehouse(city.id, 'cold')}
                    disabled={openDisabled}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.openWarehouseButtonText}>
                      {!canOpenMore
                        ? 'Seviye Gerekli'
                        : player.money < coldOpenCost
                          ? 'Nakit yetersiz'
                          : 'Soğuk Depo Aç'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Şehir Depo Fırsatları</Text>
          {topCityOpportunities.length === 0 ? (
            <Text style={styles.emptyText}>Her şehirde zaten bir depon var.</Text>
          ) : (
            topCityOpportunities.map((city) => {
              const suggestion = getWarehouseSuggestion(city);
              const opportunityCount = getCityOpportunityScore(city);
              const costModifier = city.warehouseCostModifier ?? 1;
              const standardOpenCost = getEstimatedOpenCost(city, 'standard');
              const coldOpenCost = getEstimatedOpenCost(city, 'cold');
              const standardDailyRent = getEstimatedDailyRent(city, 'standard');
              const coldDailyRent = getEstimatedDailyRent(city, 'cold');
              const cityUnlocked = isWarehouseCityUnlocked(city.id, playerLevel);
              const openDisabled = !canOpenMore || !cityUnlocked;

              return (
                <View key={city.id} style={styles.opportunityCard}>
                  <View style={styles.warehouseHeaderRow}>
                    <Text style={styles.warehouseName}>{city.name}</Text>
                    <Text style={styles.suggestionBadge}>{suggestion}</Text>
                  </View>
                  <Text style={styles.opportunityMeta}>
                    {opportunityCount} piyasa sinyali · Maliyet etkisi {costModifier.toFixed(2)}x
                  </Text>

                  <View style={styles.depotTypeCard}>
                    <Text style={styles.depotTypeTitle}>Normal Depo</Text>
                    <Text style={styles.opportunityCostLine}>
                      Açılış: <Text style={styles.opportunityCostValue}>{formatMoney(standardOpenCost)}</Text>
                    </Text>
                    <Text style={styles.opportunityCostLine}>
                      Günlük gider:{' '}
                      <Text style={styles.opportunityCostValue}>{formatMoney(standardDailyRent)}</Text>
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.openWarehouseButton,
                        (openDisabled || player.money < standardOpenCost) && styles.openWarehouseButtonDisabled,
                      ]}
                      onPress={() => handleOpenWarehouse(city.id, 'standard')}
                      disabled={openDisabled || player.money < standardOpenCost}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.openWarehouseButtonText}>
                        {!canOpenMore || !cityUnlocked
                          ? 'Seviye Gerekli'
                          : player.money < standardOpenCost
                            ? 'Nakit yetersiz'
                            : 'Normal Depo Aç'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.depotTypeCard}>
                    <Text style={styles.depotTypeTitle}>Soğuk Depo</Text>
                    <Text style={styles.depotTypeHint}>
                      Meyve, içecek ve bozulabilir ürünleri korur.
                    </Text>
                    <Text style={styles.opportunityCostLine}>
                      Açılış: <Text style={styles.opportunityCostValue}>{formatMoney(coldOpenCost)}</Text>
                    </Text>
                    <Text style={styles.opportunityCostLine}>
                      Günlük gider:{' '}
                      <Text style={styles.opportunityCostValue}>{formatMoney(coldDailyRent)}</Text>
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.openWarehouseButton,
                        (openDisabled || player.money < coldOpenCost) && styles.openWarehouseButtonDisabled,
                      ]}
                      onPress={() => handleOpenWarehouse(city.id, 'cold')}
                      disabled={openDisabled || player.money < coldOpenCost}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.openWarehouseButtonText}>
                        {!canOpenMore || !cityUnlocked
                          ? 'Seviye Gerekli'
                          : player.money < coldOpenCost
                            ? 'Nakit yetersiz'
                            : 'Soğuk Depo Aç'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {!canOpenMore ? (
                    <Text style={styles.levelLockText}>
                      Daha fazla depo açmak için şirket seviyeni yükselt. (Level {nextWarehouseLevel})
                    </Text>
                  ) : !cityUnlocked ? (
                    <Text style={styles.levelLockText}>
                      Bu şehirde depo açmak için Level 4 gerekli.
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <StrategyTipsSection onShowMore={handleShowMoreTips} />
      </ScrollView>

      <TradeProductModal
        visible={tradeModalVisible}
        mode="sell"
        city={sellCity}
        product={sellProduct}
        currentPrice={
          sellCity && sellProductId ? getCityProductMarketPrice(sellCity, sellProductId) : 0
        }
        availableStock={0}
        inventoryQuantity={sellInventoryItem?.quantity ?? 0}
        averageBuyPrice={sellInventoryItem?.averageBuyPrice ?? 0}
        inventoryQuality={sellInventoryItem?.quality ?? 100}
        effectiveSellPrice={
          sellCity && sellProductId && sellInventoryItem
            ? getEffectiveSellPrice(
                getCityProductMarketPrice(sellCity, sellProductId),
                sellInventoryItem.quality ?? 100,
              )
            : undefined
        }
        playerCash={player.money}
        onConfirm={handleConfirmSell}
        onClose={() => {
          setTradeModalVisible(false);
          setSellWarehouse(null);
          setSellProductId(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
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

  statusToast: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.secondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusToastText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '700',
  },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 13,
  },

  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
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
  },

  warehouseCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  warehouseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  warehouseHeaderText: {
    flexShrink: 1,
    marginRight: 8,
  },
  warehouseName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  warehouseMeta: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 3,
  },
  utilizationBadge: {
    fontSize: 14,
    fontWeight: '800',
  },
  warehouseStatsBlock: {
    marginTop: 10,
    gap: 4,
  },
  warehouseStatLine: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  stockBox: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  stockProductName: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  stockValue: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  inventoryCard: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 8,
    marginBottom: 4,
  },
  inventoryMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  inventoryWarning: {
    color: COLORS.danger,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  },
  inventoryProfit: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  sellButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sellButtonText: {
    color: '#0B1220',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyStockBlock: {
    marginTop: 10,
  },
  emptyStockTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyStockHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16,
  },

  warehouseActionsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  secondaryActionButton: {
    flex: 1,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.secondary,
    borderRadius: 10,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '700',
  },

  opportunityCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestionBadge: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    maxWidth: '48%',
    textAlign: 'right',
    lineHeight: 14,
  },
  opportunityMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 6,
    marginBottom: 6,
  },
  depotTypeCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 10,
    gap: 4,
  },
  depotTypeTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  depotTypeHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 4,
  },
  opportunityCostLine: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  opportunityCostValue: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  warehouseLimitHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  levelLockText: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  openWarehouseButton: {
    backgroundColor: COLORS.primary,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  openWarehouseButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  openWarehouseButtonText: {
    color: '#0B1220',
    fontSize: 13,
    fontWeight: '800',
  },

  tipsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipsToggle: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  tipRow: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingRight: 8,
  },
  tipBullet: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '800',
    marginRight: 8,
  },
  tipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
});
