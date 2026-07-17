/**
 * LogistiCore - Depo Ekranı
 *
 * Premium stok odaklı depo yönetimi — kapasite, envanter ve ticaret kararları.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';

import TradeProductModal from '../components/TradeProductModal';
import OnboardingHintCard from '../components/onboarding/OnboardingHintCard';
import { useActiveOnboardingHint, useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import {
  ActionButton,
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  IconButton,
  ProductIcon,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import type { StatusBadgeVariant } from '../components/ui';
import {
  canOpenMoreWarehouses,
  getMaxWarehousesForLevel,
  getNextLevelForMoreWarehouses,
  getWarehouseUpgradeRequiredLevel,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import { getCityByIdSafe, getCityName, getProductName } from '../utils/entityLookup';
import {
  buildTradeProfitBreakdown,
  calculateTradeProfit,
  getCityProductMarketPrice,
  getWarehouseUsedCapacityTon,
  normalizeWarehouse,
  WAREHOUSE_SELL_SAME_CITY_RULE,
} from '../simulation/trading';
import {
  calculateWarehouseDailyOperatingCostBreakdown,
  estimateNewWarehouseDailyOperatingCost,
  estimateWarehouseOpenCost,
  estimateWarehouseUpgradeCost,
  getWarehouseCapacityTons,
  getWarehouseUpgradeTier,
  type WarehouseCostInput,
  type WarehouseDailyCostBreakdown,
} from '../utils/warehouseCalculations';
import {
  cityHasWarehouseType,
  getEffectiveSellPrice,
  getInventoryQuality,
  getQualityColorHint,
  getWarehouseTypeLabel,
  productNeedsColdStorage,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, formatRatioPercent, formatTons, spacing, typography } from '../theme';
import type { City, CityProductState, Product, ProductId, Warehouse, WarehouseType } from '../types/game';

const SHORTAGE_RATIO_THRESHOLD = 0.7;
const SURPLUS_RATIO_THRESHOLD = 1.2;
const HIGH_VOLATILITY_THRESHOLD = 15;
const MAX_CITY_OPPORTUNITIES = 3;
const MAX_STRATEGY_TIPS = 3;
const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const CAPACITY_OK_THRESHOLD = 0.7;
const CAPACITY_WARN_THRESHOLD = 0.9;

const STORAGE_STRATEGY_TIPS: string[] = [
  'Stok fazla olan şehirlerde ürün ucuzlar. Depoda bekletip fiyat yükselince satabilirsin.',
  'Stok az olan şehirler yüksek fiyatlı teslimatlar için iyi hedef olabilir.',
  'Depo büyütmek esneklik sağlar ama günlük sabit giderleri artırır.',
];

type WarehouseLike = WarehouseCostInput & {
  name?: string;
  usedCapacity?: number;
  quality?: number;
  stocks?: Record<string, number>;
};

interface PortfolioMetrics {
  productCount: number;
  inventoryValue: number;
  estimatedProfit: number;
}

function formatPercent(value: number): string {
  return formatRatioPercent(value);
}

function getWarehouseCity(warehouse: WarehouseLike): City | undefined {
  return getCityByIdSafe(warehouse.cityId) ?? undefined;
}

function getWarehouseCapacity(warehouse: WarehouseLike): number {
  return getWarehouseCapacityTons(warehouse);
}

function getWarehouseLevel(warehouse: WarehouseLike): number {
  return getWarehouseUpgradeTier(warehouse);
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

function calculateWarehouseDailyCost(warehouse: WarehouseLike): WarehouseDailyCostBreakdown {
  return calculateWarehouseDailyOperatingCostBreakdown(warehouse, getWarehouseCity(warehouse));
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

function getCapacityBarColor(utilization: number): string {
  if (utilization >= CAPACITY_WARN_THRESHOLD) return colors.danger;
  if (utilization >= CAPACITY_OK_THRESHOLD) return colors.accentAmber;
  return colors.success;
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

  if (shortages > surpluses + 1) return 'İthalat merkezi';
  if (surpluses > shortages + 1) return 'Üretim fazlası';
  if (shortages > 0 && surpluses > 0) return 'Stratejik rota';
  if (calculatePriceVolatility(city) > HIGH_VOLATILITY_THRESHOLD) return 'Yüksek ticaret potansiyeli';
  return 'Normal piyasa';
}

function getCityOpportunityScore(city: City): number {
  return countCityShortages(city) + countCitySurpluses(city);
}

function getEstimatedOpenCost(city: City, warehouseType: WarehouseType = 'standard'): number {
  return estimateWarehouseOpenCost(city, warehouseType);
}

function getEstimatedDailyRent(city: City, warehouseType: WarehouseType = 'standard'): number {
  return estimateNewWarehouseDailyOperatingCost(city.id, warehouseType, city);
}

function calculatePortfolioMetrics(
  warehouses: WarehouseLike[],
  cities: City[],
  products: Product[],
): PortfolioMetrics {
  const productIds = new Set<string>();
  let inventoryValue = 0;
  let estimatedProfit = 0;

  for (const warehouse of warehouses) {
    const city = cities.find((c) => c.id === warehouse.cityId);
    const normalized = normalizeWarehouse(warehouse);
    for (const item of normalized.inventory ?? []) {
      const qty = item.quantity ?? 0;
      if (qty <= 0) continue;

      productIds.add(item.productId);
      const currentPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
      const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
      inventoryValue += qty * safePrice;
      estimatedProfit += calculateTradeProfit(
        safePrice,
        item.averageBuyPrice ?? 0,
        qty,
        item.quality ?? 100,
      );
    }
  }

  return {
    productCount: productIds.size,
    inventoryValue: Number.isFinite(inventoryValue) ? inventoryValue : 0,
    estimatedProfit: Number.isFinite(estimatedProfit) ? estimatedProfit : 0,
  };
}

function warehouseHasRisk(warehouse: WarehouseLike, products: Product[]): boolean {
  const normalized = normalizeWarehouse(warehouse);
  const warehouseType = resolveWarehouseType(warehouse.warehouseType);

  for (const item of normalized.inventory ?? []) {
    const qualityHint = getQualityColorHint(getInventoryQuality(item));
    if (qualityHint === 'critical') return true;

    const product = products.find((p) => p.id === item.productId);
    if (
      product &&
      productNeedsColdStorage(product) &&
      warehouseType !== 'cold' &&
      (item.storageWarning || qualityHint === 'warning')
    ) {
      return true;
    }
  }

  return false;
}

function getWarehouseStatusBadge(
  warehouse: WarehouseLike,
  products: Product[],
): { label: string; variant: StatusBadgeVariant } {
  const capacity = getWarehouseCapacity(warehouse);
  const used = calculateWarehouseUsedCapacity(warehouse);
  const utilization = capacity > 0 ? used / capacity : 0;
  const inventory = normalizeWarehouse(warehouse).inventory ?? [];

  if (inventory.length === 0 || used <= 0) {
    return { label: 'Boş', variant: 'muted' };
  }
  if (utilization >= CAPACITY_WARN_THRESHOLD) {
    return { label: 'Dolu', variant: 'danger' };
  }
  if (warehouseHasRisk(warehouse, products)) {
    return { label: 'Riskli', variant: 'warning' };
  }
  return { label: 'Aktif', variant: 'success' };
}

interface WarehouseMetricsGridProps {
  inventoryValue: number;
  totalCapacity: number;
  usedCapacity: number;
  dailyCost: number;
  productCount: number;
}

interface WarehouseMetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  valueColor: string;
}

function WarehouseMetricCard({ label, value, subtitle, valueColor }: WarehouseMetricCardProps) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricValue, { color: valueColor }]} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </Text>
      {subtitle ? (
        <Text style={styles.metricSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function WarehouseMetricsGrid({
  inventoryValue,
  totalCapacity,
  usedCapacity,
  dailyCost,
  productCount,
}: WarehouseMetricsGridProps) {
  const utilization = totalCapacity > 0 ? usedCapacity / totalCapacity : 0;

  return (
    <View style={styles.metricsGrid}>
      <View style={styles.metricsRow}>
        <WarehouseMetricCard
          label="Toplam Değer"
          value={formatMoney(inventoryValue)}
          valueColor={colors.success}
        />
        <WarehouseMetricCard
          label="Depo Doluluk"
          value={formatPercent(utilization)}
          subtitle={`${usedCapacity.toFixed(1)} / ${totalCapacity.toFixed(1)} t · Boş: ${Math.max(0, totalCapacity - usedCapacity).toFixed(1)} t`}
          valueColor={utilization >= 0.8 ? colors.warning : colors.accentBlue}
        />
      </View>
      <View style={styles.metricsRow}>
        <WarehouseMetricCard
          label="Günlük Gider"
          value={formatMoney(dailyCost)}
          subtitle="İşletme maliyeti"
          valueColor={colors.accentAmber}
        />
        <WarehouseMetricCard
          label="Çeşit"
          value={String(productCount)}
          subtitle="ürün türü"
          valueColor={colors.textPrimary}
        />
      </View>
    </View>
  );
}

function getInventoryDecisionHint(estimatedProfit: number): {
  statusLabel: string;
  hint: string;
  variant: 'success' | 'danger' | 'muted';
} {
  if (estimatedProfit > 1) {
    return {
      statusLabel: 'Kârda',
      hint: 'Satış düşünülebilir',
      variant: 'success',
    };
  }
  if (estimatedProfit < -1) {
    return {
      statusLabel: 'Zararda',
      hint: 'Beklemek mantıklı olabilir',
      variant: 'danger',
    };
  }
  return {
    statusLabel: 'Takipte',
    hint: 'Fiyat normale yakın',
    variant: 'muted',
  };
}

function InventoryRow({
  productId,
  quantity,
  averageBuyPrice,
  currentPrice,
  storageWarning,
  showColdHint,
  qualityHint,
  onSell,
}: {
  productId: ProductId;
  quantity: number;
  averageBuyPrice: number;
  currentPrice: number;
  storageWarning?: string;
  showColdHint: boolean;
  qualityHint: 'normal' | 'warning' | 'critical';
  onSell: () => void;
}) {
  const breakdown = buildTradeProfitBreakdown(
    currentPrice,
    averageBuyPrice,
    quantity,
  );
  const netProfit = breakdown.netProfit;
  const decision = getInventoryDecisionHint(netProfit);
  const profitColor =
    decision.variant === 'success'
      ? colors.success
      : decision.variant === 'danger'
        ? colors.danger
        : colors.textMuted;

  return (
    <View style={styles.inventoryRow}>
      <ProductIcon productId={productId} size={24} color={colors.info} />
      <View style={styles.inventoryMain}>
        <View style={styles.inventoryTitleRow}>
          <Text style={styles.inventoryName} numberOfLines={1} ellipsizeMode="tail">
            {getProductName(productId)}
          </Text>
          <Text style={styles.inventoryQty} numberOfLines={1} ellipsizeMode="tail">
            {formatTons(quantity)}
          </Text>
        </View>
        <Text style={styles.inventoryMeta} numberOfLines={1} ellipsizeMode="tail">
          Ortalama maliyet: {formatMoney(averageBuyPrice)} / ton
        </Text>
        <Text style={styles.inventoryMeta} numberOfLines={1} ellipsizeMode="tail">
          Güncel fiyat: {formatMoney(currentPrice)} / ton
        </Text>
        <Text style={[styles.inventoryHint, { color: profitColor }]} numberOfLines={1}>
          {decision.statusLabel} · {decision.hint}
        </Text>
        {showColdHint ? (
          <Text style={styles.inventoryHint} numberOfLines={1}>
            Soğuk depo önerilir
          </Text>
        ) : null}
        {storageWarning && qualityHint === 'critical' ? (
          <Text style={styles.inventoryDanger} numberOfLines={1}>
            {storageWarning}
          </Text>
        ) : storageWarning ? (
          <Text style={styles.inventoryHint} numberOfLines={1}>
            {storageWarning}
          </Text>
        ) : null}
      </View>
      <View style={styles.inventoryRight}>
        <Text style={[styles.inventoryProfit, { color: profitColor }]} numberOfLines={1} ellipsizeMode="tail">
          Net kâr: {netProfit >= 0 ? '+' : ''}
          {formatMoney(netProfit)}
        </Text>
        <ActionButton label="Sat" onPress={onSell} variant="primary" compact style={styles.sellButton} />
      </View>
    </View>
  );
}

function WarehouseCard({
  warehouse,
  city,
  products,
  playerLevel,
  playerMoney,
  onSellProduct,
  onUpgrade,
}: {
  warehouse: WarehouseLike;
  city?: City;
  products: Product[];
  playerLevel: number;
  playerMoney: number;
  onSellProduct: (warehouse: Warehouse, productId: ProductId) => void;
  onUpgrade: (warehouse: WarehouseLike) => void;
}) {
  const normalized = normalizeWarehouse(warehouse);
  const capacity = getWarehouseCapacity(warehouse);
  const used = calculateWarehouseUsedCapacity(warehouse);
  const cost = calculateWarehouseDailyCost(warehouse);
  const warehouseUtilization = capacity > 0 ? used / capacity : 0;
  const barColor = getCapacityBarColor(warehouseUtilization);
  const inventory = normalized.inventory ?? [];
  const warehouseTypeLabel = getWarehouseTypeLabel(resolveWarehouseType(warehouse.warehouseType));
  const statusBadge = getWarehouseStatusBadge(warehouse, products);
  const safePlayerLevel = Math.max(1, playerLevel ?? 1);
  const currentTier = warehouse.upgradeTier ?? 1;
  const upgradeRequiredLevel = getWarehouseUpgradeRequiredLevel(currentTier);
  const isUpgradeMaxed = upgradeRequiredLevel == null;
  const isUpgradeLevelLocked =
    upgradeRequiredLevel != null && safePlayerLevel < upgradeRequiredLevel;
  const estimatedUpgradeCost = estimateWarehouseUpgradeCost(city, warehouse.cityId);
  const canAffordUpgrade = playerMoney >= estimatedUpgradeCost;
  const warehouseType = resolveWarehouseType(warehouse.warehouseType);

  const upgradeDisabled = isUpgradeMaxed || isUpgradeLevelLocked || !canAffordUpgrade;

  const upgradeHelperText = isUpgradeMaxed
    ? 'Maksimum seviyeye ulaşıldı'
    : isUpgradeLevelLocked
      ? `Yükseltme için Level ${upgradeRequiredLevel} gerekli`
      : !canAffordUpgrade
        ? 'Yükseltme için nakit yetersiz'
        : null;

  return (
    <AppCard style={styles.warehouseCard} padded={false}>
      <View style={styles.warehouseHeader}>
        <View style={styles.warehouseIconWrap}>
          <GameIcon name="warehouse" size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.warehouseHeaderText}>
          <Text style={styles.warehouseTitle} numberOfLines={1} ellipsizeMode="tail">
            {city?.name ?? getCityName(warehouse.cityId)}
          </Text>
          <Text style={styles.warehouseMeta} numberOfLines={1} ellipsizeMode="tail">
            {warehouseTypeLabel} · Seviye {getWarehouseLevel(warehouse)}
          </Text>
        </View>
        <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
      </View>

      <View style={styles.capacityBlock}>
        <View style={styles.capacityLabelRow}>
          <Text style={styles.capacityLabel}>
            Kapasite {(Number.isFinite(used) ? used : 0).toFixed(1)} /{' '}
            {(Number.isFinite(capacity) ? capacity : 0).toFixed(1)} ton
          </Text>
          <Text style={[styles.capacityPercent, { color: barColor }]}>
            {formatPercent(warehouseUtilization)}
          </Text>
        </View>
        <ProgressBar progress={warehouseUtilization} color={barColor} height={6} />
        {warehouseUtilization >= 1 ? (
          <Text style={styles.capacityWarning}>Depoda yer yok — yeni alım yapılamaz.</Text>
        ) : warehouseUtilization >= 0.8 ? (
          <Text style={styles.capacityWarning}>
            Depo doluyor — Satış yap veya kapasite yükselt.
          </Text>
        ) : null}
      </View>

      <Text style={styles.dailyCostLine}>
        Günlük gider: <Text style={styles.dailyCostValue}>{formatMoney(cost.total)}</Text>
      </Text>

      {inventory.length > 0 ? (
        <View style={styles.inventoryList}>
          {inventory.map((item, index) => {
            const currentPrice = city ? getCityProductMarketPrice(city, item.productId) : 0;
            const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
            const itemQuality = getInventoryQuality(item);
            const qualityHint = getQualityColorHint(itemQuality);
            const product = products.find((p) => p.id === item.productId);
            const showColdHint =
              !!product &&
              productNeedsColdStorage(product) &&
              warehouseType !== 'cold' &&
              !item.storageWarning;

            return (
              <View
                key={item.productId}
                style={[
                  styles.inventoryItemWrap,
                  index < inventory.length - 1 ? styles.inventoryItemBorder : null,
                ]}
              >
                <InventoryRow
                  productId={item.productId}
                  quantity={item.quantity ?? 0}
                  averageBuyPrice={item.averageBuyPrice ?? 0}
                  currentPrice={safePrice}
                  storageWarning={item.storageWarning}
                  showColdHint={showColdHint}
                  qualityHint={qualityHint}
                  onSell={() => onSellProduct(normalized, item.productId)}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyStockBlock}>
          <Text style={styles.emptyStockTitle}>Depoda ürün yok</Text>
          <Text style={styles.emptyStockHint} numberOfLines={2}>
            Piyasa ekranından ürün satın alarak stok oluşturmaya başlayabilirsin.
          </Text>
        </View>
      )}

      <View style={styles.warehouseFooter}>
        {upgradeHelperText ? (
          <Text style={styles.upgradeHelperText}>{upgradeHelperText}</Text>
        ) : null}
        <ActionButton
          label="Yükselt"
          onPress={() => onUpgrade(warehouse)}
          variant={upgradeDisabled ? 'secondary' : 'primary'}
          disabled={upgradeDisabled}
          compact
          icon="upgrade"
          iconSize={13}
          style={upgradeDisabled ? styles.upgradeButtonDisabled : undefined}
        />
      </View>
    </AppCard>
  );
}

function DepotTypeOption({
  title,
  hint,
  openCost,
  dailyRent,
  buttonLabel,
  disabled,
  onPress,
}: {
  title: string;
  hint?: string;
  openCost: number;
  dailyRent: number;
  buttonLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.depotTypeCard}>
      <Text style={styles.depotTypeTitle}>{title}</Text>
      {hint ? (
        <Text style={styles.depotTypeHint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
      <Text style={styles.depotCostCompact}>
        Açılış {formatMoney(openCost)} · Günlük {formatMoney(dailyRent)}
      </Text>
      <ActionButton
        label={buttonLabel}
        onPress={onPress}
        variant="primary"
        disabled={disabled}
        compact
        fullWidth
        style={styles.depotOpenButton}
      />
    </View>
  );
}

function StrategyTipsCard({ onShowMore }: { onShowMore: () => void }) {
  const visibleTips = STORAGE_STRATEGY_TIPS.slice(0, MAX_STRATEGY_TIPS);

  return (
    <AppCard variant="soft" style={styles.tipsCard} padded={false}>
      <View style={styles.tipsHeader}>
        <View style={styles.tipsTitleRow}>
          <GameIcon name="route" size={16} color={colors.accentAmber} />
          <Text style={styles.tipsTitle}>Depo Strateji İpuçları</Text>
        </View>
        <ActionButton label="Daha fazla" onPress={onShowMore} variant="secondary" compact />
      </View>
      {visibleTips.map((tip, index) => (
        <View key={index} style={styles.tipRow}>
          <Text style={styles.tipBullet}>•</Text>
          <Text style={styles.tipText}>{tip}</Text>
        </View>
      ))}
    </AppCard>
  );
}

export default function WarehouseScreen() {
  const { alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const openWarehouse = useGameStore((state) => state.openWarehouse);
  const upgradeWarehouse = useGameStore((state) => state.upgradeWarehouse);
  const sellProductFromWarehouse = useGameStore((state) => state.sellProductFromWarehouse);

  useOnboardingScreenVisit('Warehouse');
  const onboardingHint = useActiveOnboardingHint(['warehouse_intro']);

  const warehouses: WarehouseLike[] = player?.warehouses ?? [];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [sellWarehouse, setSellWarehouse] = useState<Warehouse | null>(null);
  const [sellProductId, setSellProductId] = useState<ProductId | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const opportunitiesOffsetRef = useRef(0);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const totalCapacity = useMemo(() => calculateTotalWarehouseCapacity(warehouses), [warehouses]);
  const usedCapacity = useMemo(() => calculateTotalUsedCapacity(warehouses), [warehouses]);
  const dailyCost = useMemo(() => calculateTotalDailyWarehouseCost(warehouses), [warehouses]);
  const portfolioMetrics = useMemo(
    () => calculatePortfolioMetrics(warehouses, cities, products),
    [warehouses, cities, products],
  );

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
      showAlert('Depo yükseltilemedi', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }
    setStatusMessage(result.message ?? 'Depo yükseltildi');
  };

  const handleOpenWarehouse = (cityId: string, warehouseType: WarehouseType = 'standard') => {
    const result = openWarehouse(cityId, warehouseType);
    if (!result.success) {
      showAlert('Depo açılamadı', result.message ?? 'İşlem tamamlanamadı.');
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
      showAlert('Satış başarısız', result.message ?? 'İşlem tamamlanamadı.');
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

  const scrollToOpportunities = () => {
    scrollRef.current?.scrollTo({ y: opportunitiesOffsetRef.current, animated: true });
  };

  if (!player) {
    return (
      <AppScreen>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </AppScreen>
    );
  }

  if (cities.length === 0 || products.length === 0) {
    return (
      <AppScreen>
        <EmptyState
          title="Şehir veya ürün verisi yok"
          message="Depo verileri şehir ve ürün bilgilerine bağlıdır."
          icon="warehouse"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll scrollRef={scrollRef}>
      <ScreenHeader
        title="Depolar"
        subtitle="Stoklarını, kapasiteni ve ticaret kârını yönet"
        titleIcon="warehouse"
        rightAction={
          topCityOpportunities.length > 0 || coldDepotOpportunities.length > 0 ? (
            <IconButton
              icon="plus"
              onPress={scrollToOpportunities}
              size={22}
              color={colors.accentAmber}
            />
          ) : undefined
        }
      />

      {onboardingHint ? (
        <OnboardingHintCard
          title={onboardingHint.title}
          description={onboardingHint.description}
          icon={onboardingHint.icon}
          badgeLabel={onboardingHint.badgeLabel}
          accentVariant={onboardingHint.accentVariant}
          onDismiss={onboardingHint.onDismiss}
        />
      ) : null}

      {statusMessage ? (
        <View style={styles.statusToast}>
          <GameIcon name="success" size={14} color={colors.info} />
          <Text style={styles.statusToastText}>{statusMessage}</Text>
        </View>
      ) : null}

      <WarehouseMetricsGrid
        inventoryValue={portfolioMetrics.inventoryValue}
        totalCapacity={totalCapacity}
        usedCapacity={usedCapacity}
        dailyCost={dailyCost}
        productCount={portfolioMetrics.productCount}
      />

      <View style={styles.ruleBanner}>
        <GameIcon name="alert" size={13} color={colors.info} />
        <Text style={styles.ruleBannerText}>{WAREHOUSE_SELL_SAME_CITY_RULE}</Text>
      </View>

      <Text style={styles.limitHint}>
        Depo limiti: {warehouses.length}/{maxWarehouses}
      </Text>

      <SectionTitle
        title="Depolarım"
        subtitle={
          warehouses.length > 0
            ? `${warehouses.length} depo · Tahmini kâr ${formatMoney(portfolioMetrics.estimatedProfit)}`
            : undefined
        }
        compact
      />

      {warehouses.length === 0 ? (
        <EmptyState
          title="Henüz bir depon yok"
          message="Aşağıdaki depo fırsatlarından yeni bir depo açarak ticarete başlayabilirsin."
          icon="warehouse"
        />
      ) : (
        warehouses.map((warehouse) => (
          <WarehouseCard
            key={warehouse.id}
            warehouse={warehouse}
            city={cities.find((city) => city.id === warehouse.cityId)}
            products={products}
            playerLevel={playerLevel}
            playerMoney={player.money}
            onSellProduct={handleSellProduct}
            onUpgrade={handleUpgradeWarehouse}
          />
        ))
      )}

      <View
        onLayout={(event) => {
          opportunitiesOffsetRef.current = event.nativeEvent.layout.y;
        }}
      >
        {coldDepotOpportunities.length > 0 ? (
          <>
            <SectionTitle title="Soğuk Depo Ekle" compact />
            {coldDepotOpportunities.map((city) => {
              const coldOpenCost = getEstimatedOpenCost(city, 'cold');
              const coldDailyRent = getEstimatedDailyRent(city, 'cold');
              const openDisabled = !canOpenMore || player.money < coldOpenCost;

              let buttonLabel = 'Soğuk Depo Aç';
              if (!canOpenMore) {
                buttonLabel = 'Seviye Gerekli';
              } else if (player.money < coldOpenCost) {
                buttonLabel = 'Nakit Yetersiz';
              }

              return (
                <AppCard key={`cold-${city.id}`} style={styles.opportunityCard} padded={false}>
                  <View style={styles.opportunityHeader}>
                    <GameIcon name="city" size={16} color={colors.info} />
                    <Text style={styles.opportunityCity}>{city.name}</Text>
                    <StatusBadge label="Soğuk depo" variant="info" size="sm" />
                  </View>
                  <Text style={styles.opportunityHint} numberOfLines={2}>
                    Bu şehirde normal depo var. Meyve ve içecek için soğuk depo önerilir.
                  </Text>
                  <DepotTypeOption
                    title="Soğuk Depo"
                    openCost={coldOpenCost}
                    dailyRent={coldDailyRent}
                    buttonLabel={buttonLabel}
                    disabled={openDisabled}
                    onPress={() => handleOpenWarehouse(city.id, 'cold')}
                  />
                </AppCard>
              );
            })}
          </>
        ) : null}

        <SectionTitle title="Yeni Depo Fırsatları" compact />

        {topCityOpportunities.length === 0 ? (
          <AppCard variant="soft" style={styles.opportunityEmptyCard} padded={false}>
            <Text style={styles.opportunityEmptyText}>Her şehirde zaten bir depon var.</Text>
          </AppCard>
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

            const standardButtonLabel = !canOpenMore || !cityUnlocked
              ? 'Seviye Gerekli'
              : player.money < standardOpenCost
                ? 'Nakit Yetersiz'
                : 'Depo Aç';

            const coldButtonLabel = !canOpenMore || !cityUnlocked
              ? 'Seviye Gerekli'
              : player.money < coldOpenCost
                ? 'Nakit Yetersiz'
                : 'Soğuk Depo Aç';

            return (
              <AppCard key={city.id} style={styles.opportunityCard} padded={false}>
                <View style={styles.opportunityHeader}>
                  <GameIcon name="city" size={16} color={colors.accentBlue} />
                  <Text style={styles.opportunityCity}>{city.name}</Text>
                  <StatusBadge label={suggestion} variant="amber" size="sm" />
                </View>
                <Text style={styles.opportunityMeta} numberOfLines={1}>
                  {opportunityCount} piyasa sinyali · Maliyet etkisi {costModifier.toFixed(2)}x
                </Text>

                <DepotTypeOption
                  title="Normal Depo"
                  openCost={standardOpenCost}
                  dailyRent={standardDailyRent}
                  buttonLabel={standardButtonLabel}
                  disabled={openDisabled || player.money < standardOpenCost}
                  onPress={() => handleOpenWarehouse(city.id, 'standard')}
                />

                <DepotTypeOption
                  title="Soğuk Depo"
                  hint="Meyve, içecek ve bozulabilir ürünleri korur."
                  openCost={coldOpenCost}
                  dailyRent={coldDailyRent}
                  buttonLabel={coldButtonLabel}
                  disabled={openDisabled || player.money < coldOpenCost}
                  onPress={() => handleOpenWarehouse(city.id, 'cold')}
                />

                {!canOpenMore ? (
                  <Text style={styles.levelLockText}>
                    Daha fazla depo açmak için şirket seviyeni yükselt. (Level {nextWarehouseLevel})
                  </Text>
                ) : !cityUnlocked ? (
                  <Text style={styles.levelLockText}>
                    Bu şehirde depo açmak için Level 4 gerekli.
                  </Text>
                ) : null}
              </AppCard>
            );
          })
        )}
      </View>

      <StrategyTipsCard onShowMore={handleShowMoreTips} />

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
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },

  statusToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: colors.info,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  statusToastText: {
    color: colors.info,
    fontSize: 12,
    fontWeight: '700',
  },

  metricsGrid: {
    gap: 10,
    marginBottom: spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 84,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  metricLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  metricSubtitle: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
  },

  limitHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },

  warehouseCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warehouseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  warehouseIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warehouseHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  warehouseTitle: {
    ...typography.cardTitle,
    fontSize: 14,
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 18,
  },
  warehouseMeta: {
    ...typography.caption,
    marginTop: 2,
    minWidth: 0,
    lineHeight: 15,
  },

  capacityBlock: {
    marginBottom: spacing.sm,
    gap: 4,
  },
  capacityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  capacityLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
  },
  capacityPercent: {
    fontSize: 11,
    fontWeight: '800',
  },

  dailyCostLine: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  dailyCostValue: {
    color: colors.textSecondary,
    fontWeight: '700',
  },

  inventoryList: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  inventoryItemWrap: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  inventoryItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inventoryMain: {
    flex: 1,
    minWidth: 0,
  },
  inventoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minWidth: 0,
  },
  inventoryName: {
    ...typography.bodySmall,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
    lineHeight: 16,
  },
  inventoryQty: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    flexShrink: 0,
    lineHeight: 15,
  },
  inventoryMeta: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    minWidth: 0,
    lineHeight: 14,
  },
  inventoryHint: {
    fontSize: 10,
    color: colors.accentAmber,
    marginTop: 3,
    fontWeight: '600',
  },
  inventoryDanger: {
    fontSize: 10,
    color: colors.danger,
    marginTop: 3,
    fontWeight: '600',
  },
  inventoryRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 76,
  },
  inventoryProfit: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
    flexShrink: 0,
    lineHeight: 14,
  },
  sellButton: {
    minHeight: 32,
    paddingVertical: 4,
  },

  emptyStockBlock: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: 4,
  },
  emptyStockTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptyStockHint: {
    ...typography.caption,
    lineHeight: 15,
    color: colors.textMuted,
  },

  warehouseFooter: {
    gap: 4,
    alignItems: 'flex-start',
  },
  upgradeHelperText: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textMuted,
  },
  upgradeButtonDisabled: {
    opacity: 0.55,
  },
  levelLockText: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
    marginTop: spacing.xs,
  },

  opportunityCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  opportunityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  opportunityCity: {
    ...typography.cardTitle,
    fontSize: 14,
    flex: 1,
  },
  opportunityHint: {
    ...typography.caption,
    marginBottom: spacing.sm,
    lineHeight: 15,
  },
  opportunityMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  opportunityEmptyCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  opportunityEmptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  depotTypeCard: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: spacing.sm,
    gap: 4,
  },
  depotTypeTitle: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  depotTypeHint: {
    ...typography.caption,
    lineHeight: 14,
    marginBottom: 2,
  },
  depotCostCompact: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  depotOpenButton: {
    marginTop: spacing.xs,
  },

  tipsCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  tipsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  tipsTitle: {
    ...typography.sectionTitle,
    fontSize: 14,
  },
  tipRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  tipBullet: {
    color: colors.accentAmber,
    fontSize: 13,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  tipText: {
    ...typography.bodySmall,
    flex: 1,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  capacityWarning: {
    ...typography.caption,
    color: colors.warning,
    marginTop: 4,
    fontWeight: '600',
  },
  ruleBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  ruleBannerText: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
