/**
 * LogistiCore - Depo Ekranı
 *
 * More menüsü içinde kullanılan sade depo yönetimi ekranı.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useGameStore } from '../store/gameStore';
import { warehouseBalance } from '../config/balance';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import type { City, CityProductState, ProductId, Warehouse } from '../types/game';

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
  return `${city?.name ?? warehouse.cityId} Deposu`;
}

function getWarehouseCapacity(warehouse: WarehouseLike): number {
  return warehouse.capacity ?? warehouse.capacityTons ?? 0;
}

function getWarehouseLevel(warehouse: WarehouseLike): number {
  return warehouse.level ?? 1;
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
  if (typeof warehouse.usedCapacity === 'number') return warehouse.usedCapacity;
  const stocks = getWarehouseStocks(warehouse);
  return Object.values(stocks).reduce((sum, amount) => sum + amount, 0);
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

  const rent = warehouse.rent ?? capacity * DEFAULT_RENT_PER_TON * costModifier;
  const electricityCost =
    warehouse.electricityCost ?? capacity * DEFAULT_ELECTRICITY_PER_TON * costModifier;
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

function getEstimatedOpenCost(city: City): number {
  const modifier = city.warehouseCostModifier ?? 1;
  return BASE_OPEN_COST * modifier;
}

function getEstimatedDailyRent(city: City): number {
  const modifier = city.warehouseCostModifier ?? 1;
  return BASE_DAILY_RENT * modifier;
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
  getCityMarketPrice,
  onUpgrade,
  onManageStock,
}: {
  warehouse: WarehouseLike;
  getCityMarketPrice: (cityId: string, productId: string) => number;
  onUpgrade: (warehouse: WarehouseLike) => void;
  onManageStock: (warehouse: WarehouseLike) => void;
}) {
  const city = getWarehouseCity(warehouse);
  const capacity = getWarehouseCapacity(warehouse);
  const used = calculateWarehouseUsedCapacity(warehouse);
  const free = calculateWarehouseFreeCapacity(warehouse);
  const cost = calculateWarehouseDailyCost(warehouse);
  const warehouseUtilization = capacity > 0 ? used / capacity : 0;
  const utilizationColor = getUtilizationColor(warehouseUtilization);
  const stocks = getWarehouseStocks(warehouse);
  const stockEntries = Object.entries(stocks);

  return (
    <View style={styles.warehouseCard}>
      <View style={styles.warehouseHeaderRow}>
        <View style={styles.warehouseHeaderText}>
          <Text style={styles.warehouseName}>{getWarehouseName(warehouse)}</Text>
          <Text style={styles.warehouseMeta}>
            {city?.name ?? warehouse.cityId} · Seviye {getWarehouseLevel(warehouse)}
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

      {stockEntries.length > 0 ? (
        <View style={styles.stockBox}>
          {stockEntries.map(([productId, amount]) => {
            const marketPrice = getCityMarketPrice(warehouse.cityId, productId);
            return (
              <View key={productId} style={styles.stockRow}>
                <Text style={styles.stockProductName}>{getProductName(productId)}</Text>
                <Text style={styles.stockValue}>
                  {formatTons(amount)} · {formatMoney(amount * marketPrice)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyStockBlock}>
          <Text style={styles.emptyStockTitle}>Depo boş.</Text>
          <Text style={styles.emptyStockHint}>
            Ucuz ürünleri burada stoklayarak ileride kârlı taşıma fırsatları yakalayabilirsin.
          </Text>
        </View>
      )}

      <View style={styles.warehouseActionsRow}>
        <TouchableOpacity style={styles.secondaryActionButton} onPress={() => onUpgrade(warehouse)} activeOpacity={0.85}>
          <Text style={styles.secondaryActionText}>Yükselt</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryActionButton}
          onPress={() => onManageStock(warehouse)}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryActionText}>Stok Yönet</Text>
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

  const warehouses: WarehouseLike[] = player?.warehouses ?? [];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { scrollBottomPadding } = useTabBarLayout();

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const getCityMarketPrice = (cityId: string, productId: string): number => {
    const city = cities.find((c) => c.id === cityId);
    return getCityProductPrice(city, productId);
  };

  const totalCapacity = useMemo(() => calculateTotalWarehouseCapacity(warehouses), [warehouses]);
  const usedCapacity = useMemo(() => calculateTotalUsedCapacity(warehouses), [warehouses]);
  const dailyCost = useMemo(() => calculateTotalDailyWarehouseCost(warehouses), [warehouses]);

  const warehouseCityIds = useMemo(() => new Set(warehouses.map((w) => w.cityId)), [warehouses]);
  const topCityOpportunities = useMemo(
    () =>
      cities
        .filter((c) => !warehouseCityIds.has(c.id))
        .sort((a, b) => getCityOpportunityScore(b) - getCityOpportunityScore(a))
        .slice(0, MAX_CITY_OPPORTUNITIES),
    [cities, warehouseCityIds],
  );

  const handleUpgradeWarehouse = () => {
    setStatusMessage('Bu özellik yakında eklenecek.');
  };

  const handleManageStock = () => {
    setStatusMessage('Stok yönetimi sonraki sürümde aktif olacak.');
  };

  const handleOpenWarehouse = (cityId: string) => {
    const storeState = useGameStore.getState() as unknown as {
      openWarehouse?: (cityId: string) => void;
    };
    if (typeof storeState.openWarehouse === 'function') {
      storeState.openWarehouse(cityId);
      return;
    }
    setStatusMessage('Depo açma sistemi yakında eklenecek.');
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Depolarım</Text>
          {warehouses.length === 0 ? (
            <Text style={styles.emptyText}>Henüz bir depon yok.</Text>
          ) : (
            warehouses.map((warehouse) => (
              <WarehouseCard
                key={warehouse.id}
                warehouse={warehouse}
                getCityMarketPrice={getCityMarketPrice}
                onUpgrade={handleUpgradeWarehouse}
                onManageStock={handleManageStock}
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Şehir Depo Fırsatları</Text>
          {topCityOpportunities.length === 0 ? (
            <Text style={styles.emptyText}>Her şehirde zaten bir depon var.</Text>
          ) : (
            topCityOpportunities.map((city) => {
              const suggestion = getWarehouseSuggestion(city);
              const opportunityCount = getCityOpportunityScore(city);
              const costModifier = city.warehouseCostModifier ?? 1;
              const estimatedOpenCost = getEstimatedOpenCost(city);
              const estimatedDailyRent = getEstimatedDailyRent(city);

              return (
                <View key={city.id} style={styles.opportunityCard}>
                  <View style={styles.warehouseHeaderRow}>
                    <Text style={styles.warehouseName}>{city.name}</Text>
                    <Text style={styles.suggestionBadge}>{suggestion}</Text>
                  </View>
                  <Text style={styles.opportunityMeta}>
                    {opportunityCount} piyasa sinyali · Maliyet etkisi {costModifier.toFixed(2)}x
                  </Text>
                  <Text style={styles.opportunityCostLine}>
                    Tahmini açılış maliyeti:{' '}
                    <Text style={styles.opportunityCostValue}>{formatMoney(estimatedOpenCost)}</Text>
                  </Text>
                  <Text style={styles.opportunityCostLine}>
                    Günlük kira:{' '}
                    <Text style={styles.opportunityCostValue}>{formatMoney(estimatedDailyRent)}</Text>
                  </Text>
                  <TouchableOpacity
                    style={styles.openWarehouseButton}
                    onPress={() => handleOpenWarehouse(city.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.openWarehouseButtonText}>Depo Aç</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        <StrategyTipsSection onShowMore={handleShowMoreTips} />
      </ScrollView>
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
  opportunityCostLine: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  opportunityCostValue: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  openWarehouseButton: {
    backgroundColor: COLORS.primary,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
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
