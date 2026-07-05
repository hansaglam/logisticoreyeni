/**
 * LogistiCore - Finans Ekranı
 *
 * Premium gelir/gider analizi — şirket sağlığı ve ticaret performansı.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  SmallStatPill,
  StatusBadge,
} from '../components/ui';
import type { GameIconName } from '../theme/icons';
import type { StatusBadgeVariant } from '../components/ui';
import { economyBalance, financeBalance, warehouseBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import {
  getCityProductMarketPrice,
  normalizeWarehouse,
  summarizeFinanceLedger,
} from '../simulation/trading';
import {
  calculateDailyOperatingCostBreakdown,
  getDriverDailySalary,
  getWarehouseDailyOperatingCost,
  getWeeklyLeaseBurden,
} from '../simulation/dailyOperatingCosts';
import {
  calculateCompanyScore,
  formatCompanyScore,
  getCompanyScoreBreakdown,
} from '../simulation/companyScore';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, formatRatioPercent, formatTons, spacing, typography } from '../theme';
import type {
  Contract,
  Delivery,
  Driver,
  FinanceLedgerCategory,
  FinanceLedgerEntry,
  ProductId,
  Truck,
  Warehouse,
} from '../types/game';

const WAREHOUSE_RENT_PER_TON = warehouseBalance.rentPerTon;
const WAREHOUSE_ELECTRICITY_PER_TON = warehouseBalance.electricityPerTon;
const WAREHOUSE_STAFF_COST_PER_LEVEL = warehouseBalance.staffCostPerLevel;
const MAINTENANCE_RISK_FACTOR = financeBalance.maintenanceRiskFactor;
const WAREHOUSE_VALUE_PER_TON = warehouseBalance.capacityValueMultiplier;
const REPUTATION_VALUE_PER_POINT = financeBalance.reputationValuePerPoint;

const CRITICAL_CASH_THRESHOLD = financeBalance.lowCashThreshold;
const MAINTENANCE_WARNING_CONDITION = financeBalance.truckConditionThreshold;
const HEALTH_TRUCK_CONDITION_THRESHOLD = financeBalance.truckConditionThreshold;
const FIXED_COST_WARN_RATIO = financeBalance.fixedCostWarnRatio;
const FIXED_COST_HIGH_RATIO = financeBalance.fixedCostHighRatio;
const FUEL_PRICE_SPIKE_RATIO = financeBalance.fuelPriceSpikeRatio;
const BASELINE_FUEL_PRICE = economyBalance.baseFuelPrice;
const MAX_ACTIVE_DELIVERIES = 3;
const MAX_ALERTS = 3;
const MAX_LEDGER_ENTRIES = 5;
const HIGH_PROFIT_MARGIN = 0.9;
const DAY_HOURS = 24;
const RUNNING_DELIVERY_STATUSES: Delivery['status'][] = ['preparing', 'on_route'];

type HealthLabel = 'Güçlü' | 'Dengeli' | 'Riskli' | 'Kritik';

function formatPercent(value: number): string {
  return formatRatioPercent(value);
}

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getFinancialHealthLabel(score: number): HealthLabel {
  if (score >= 80) return 'Güçlü';
  if (score >= 60) return 'Dengeli';
  if (score >= 40) return 'Riskli';
  return 'Kritik';
}

function getHealthBarColor(score: number): string {
  if (score >= 70) return colors.success;
  if (score >= 40) return colors.accentAmber;
  return colors.danger;
}

function getDeliveryRiskBadge(delivery: Delivery): { label: string; variant: StatusBadgeVariant } {
  const combinedRisk = (delivery.breakdownChance ?? 0) + (delivery.accidentChance ?? 0);
  if (combinedRisk < 0.1) return { label: 'Düşük risk', variant: 'success' };
  if (combinedRisk < 0.25) return { label: 'Orta risk', variant: 'warning' };
  return { label: 'Yüksek risk', variant: 'danger' };
}

function getDeliveryStatusBadge(status: Delivery['status']): { label: string; variant: StatusBadgeVariant } {
  switch (status) {
    case 'on_route':
      return { label: 'Yolda', variant: 'blue' };
    case 'preparing':
      return { label: 'Hazırlanıyor', variant: 'amber' };
    case 'completed':
      return { label: 'Tamamlandı', variant: 'success' };
    case 'failed':
      return { label: 'Başarısız', variant: 'danger' };
    default:
      return { label: status, variant: 'muted' };
  }
}

function calculateInventoryStockValue(warehouses: Warehouse[]): number {
  let total = 0;
  for (const warehouse of warehouses) {
    const city = CITIES_BY_ID[warehouse.cityId];
    const inventory = normalizeWarehouse(warehouse).inventory ?? [];
    for (const item of inventory) {
      const qty = item.quantity ?? 0;
      if (qty <= 0) continue;
      const price = city ? getCityProductMarketPrice(city, item.productId) : 0;
      const safePrice = Number.isFinite(price) ? price : 0;
      total += qty * safePrice;
    }
  }
  return Number.isFinite(total) ? total : 0;
}

function formatLedgerTime(entryTime: number): string {
  const safeEntry = Number.isFinite(entryTime) ? entryTime : 0;
  const day = Math.floor(safeEntry / DAY_HOURS) + 1;
  const hour = Math.floor(safeEntry % DAY_HOURS);
  return `Gün ${day} · ${hour.toString().padStart(2, '0')}:00`;
}

function getLedgerDisplay(entry: FinanceLedgerEntry): {
  icon: GameIconName;
  title: string;
  categoryLabel: string;
} {
  const description = entry.description?.trim();
  switch (entry.category) {
    case 'trade_purchase':
      return {
        icon: 'market',
        title: description ?? 'Ürün satın alma',
        categoryLabel: 'Ticaret',
      };
    case 'trade_sale':
      return {
        icon: 'revenue',
        title: description ?? 'Ürün satışı',
        categoryLabel: 'Ticaret',
      };
    case 'delivery_income':
      return {
        icon: 'contract',
        title: description ?? 'Teslimat geliri',
        categoryLabel: 'Teslimat',
      };
    case 'delivery_expense':
      return {
        icon: 'fuel',
        title: description ?? 'Teslimat gideri',
        categoryLabel: 'Teslimat',
      };
    case 'fleet_purchase':
      return {
        icon: 'truck',
        title: description ?? 'Filo alımı',
        categoryLabel: 'Filo',
      };
    case 'warehouse_open':
      return {
        icon: 'warehouse',
        title: description ?? 'Depo açılışı',
        categoryLabel: 'Depo',
      };
    case 'truck_transfer':
      return {
        icon: 'truck',
        title: description ?? 'Boş kamyon transferi',
        categoryLabel: 'Transfer',
      };
    case 'driver_salary':
      return {
        icon: 'driver',
        title: description ?? 'Şoför maaşı',
        categoryLabel: 'Sabit gider',
      };
    case 'driver_hire':
      return {
        icon: 'driver',
        title: description ?? 'Şoför işe alma',
        categoryLabel: 'Yatırım',
      };
    case 'warehouse_rent':
      return {
        icon: 'warehouse',
        title: description ?? 'Depo gideri',
        categoryLabel: 'Sabit gider',
      };
    case 'truck_lease':
    case 'truck_rental':
      return {
        icon: 'truck',
        title: description ?? 'Kamyon kirası',
        categoryLabel: 'Sabit gider',
      };
    case 'operations':
      return {
        icon: 'company',
        title: description ?? 'Genel operasyon',
        categoryLabel: 'Sabit gider',
      };
    case 'daily_operating_cost':
      return {
        icon: 'expense',
        title: description ?? 'Günlük operasyon gideri',
        categoryLabel: 'Sabit gider',
      };
    default:
      return {
        icon: entry.type === 'income' ? 'revenue' : 'expense',
        title: description ?? 'Diğer işlem',
        categoryLabel: 'Diğer',
      };
  }
}

function sumLedgerByCategories(
  entries: FinanceLedgerEntry[],
  categories: FinanceLedgerCategory[],
  type: 'income' | 'expense',
): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== type) continue;
    if (!categories.includes(entry.category)) continue;
    total += entry.amount ?? 0;
  }
  return total;
}

function aggregateOtherLedgerIncome(
  entries: FinanceLedgerEntry[],
  exclude: FinanceLedgerCategory[],
): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== 'income') continue;
    if (exclude.includes(entry.category)) continue;
    total += entry.amount ?? 0;
  }
  return total;
}

function aggregateOtherLedgerExpense(
  entries: FinanceLedgerEntry[],
  exclude: FinanceLedgerCategory[],
): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== 'expense') continue;
    if (exclude.includes(entry.category)) continue;
    total += entry.amount ?? 0;
  }
  return total;
}

interface BreakdownLine {
  icon: GameIconName;
  label: string;
  amount: number;
  color?: string;
}

function BreakdownCard({
  lines,
  hint,
  formatValue = formatMoney,
}: {
  lines: BreakdownLine[];
  hint?: string;
  formatValue?: (value: number) => string;
}) {
  return (
    <AppCard style={styles.breakdownCard} padded={false}>
      {hint ? <Text style={styles.breakdownHint}>{hint}</Text> : null}
      {lines.map((line, index) => (
        <View
          key={line.label}
          style={[styles.breakdownRow, index === lines.length - 1 ? styles.breakdownRowLast : null]}
        >
          <View style={styles.breakdownLeft}>
            <View style={styles.breakdownIconWrap}>
              <GameIcon name={line.icon} size={14} color={line.color ?? colors.textSecondary} />
            </View>
            <Text style={styles.breakdownLabel} numberOfLines={1}>
              {line.label}
            </Text>
          </View>
          <Text style={[styles.breakdownValue, { color: line.color ?? colors.textPrimary }]}>
            {formatValue(line.amount)}
          </Text>
        </View>
      ))}
    </AppCard>
  );
}

function FinanceMetricStrip({
  cash,
  netProfit,
  dailyFixedCosts,
  companyValue,
}: {
  cash: number;
  netProfit: number;
  dailyFixedCosts: number;
  companyValue: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.metricStrip}
    >
      <View style={styles.metricPillWrap}>
        <SmallStatPill
          label="Nakit"
          value={formatMoney(cash)}
          icon="cash"
          accentColor={colors.success}
          layout="chip"
        />
      </View>
      <View style={styles.metricPillWrap}>
        <SmallStatPill
          label="Net kâr"
          value={formatMoney(netProfit)}
          icon="profit"
          accentColor={netProfit >= 0 ? colors.success : colors.danger}
          layout="chip"
        />
      </View>
      <View style={styles.metricPillWrap}>
        <SmallStatPill
          label="Günlük gider"
          value={formatMoney(dailyFixedCosts)}
          icon="expense"
          accentColor={colors.danger}
          layout="chip"
        />
      </View>
      <View style={styles.metricPillWrap}>
        <SmallStatPill
          label="Şirket değeri"
          value={formatMoney(companyValue)}
          icon="company"
          accentColor={colors.accentAmber}
          layout="chip"
        />
      </View>
    </ScrollView>
  );
}

export default function FinanceScreen() {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);

  const trucks: Truck[] = player?.trucks ?? [];
  const drivers: Driver[] = player?.drivers ?? [];
  const warehouses: Warehouse[] = player?.warehouses ?? [];
  const cash = player?.money ?? 0;
  const fuelPrice = globalEconomy?.fuelPrice ?? BASELINE_FUEL_PRICE;

  const calculateTotalRevenue = (): number => {
    return contracts
      .filter((c) => c.status === 'completed')
      .reduce((sum, c) => sum + (c.payment ?? 0), 0);
  };

  const calculateDailyDriverSalary = (): number => {
    return drivers.reduce((sum, driver) => sum + getDriverDailySalary(driver), 0);
  };

  const calculateDailyWarehouseCost = (): number => {
    return warehouses.reduce(
      (sum, warehouse) => sum + getWarehouseDailyOperatingCost(warehouse),
      0,
    );
  };

  const calculateMaintenanceExposure = (): number => {
    return trucks.reduce((sum, truck) => {
      const missingCondition = Math.max(0, 100 - truck.condition);
      return sum + missingCondition * truck.maintenanceCost * MAINTENANCE_RISK_FACTOR;
    }, 0);
  };

  const calculateActiveFuelCosts = (): number => {
    return activeDeliveries.reduce((sum, delivery) => sum + (delivery.fuelCost ?? 0), 0);
  };

  const calculateLatePenalties = (): number => 0;
  const calculateFailedDeliveryPenalties = (): number => 0;

  const calculateTotalExpenses = (): number => {
    return (
      calculateActiveFuelCosts() +
      calculateMaintenanceExposure() +
      calculateDailyDriverSalary() +
      calculateDailyWarehouseCost() +
      calculateLatePenalties() +
      calculateFailedDeliveryPenalties()
    );
  };

  const calculateAverageTruckCondition = (): number => {
    if (trucks.length === 0) return 0;
    return trucks.reduce((sum, truck) => sum + truck.condition, 0) / trucks.length;
  };

  const calculateCompanyValue = (): number => {
    const truckValue = trucks.reduce(
      (sum, truck) => sum + truck.purchasePrice * (truck.condition / 100),
      0,
    );
    const warehouseValue = warehouses.reduce(
      (sum, warehouse) => sum + warehouse.capacityTons * WAREHOUSE_VALUE_PER_TON,
      0,
    );
    const reputationValue = (player?.reputation ?? 0) * REPUTATION_VALUE_PER_POINT;
    return cash + truckValue + warehouseValue + reputationValue;
  };

  const projectedDailyCosts = useMemo(
    () => calculateDailyOperatingCostBreakdown({ drivers, warehouses, trucks }),
    [drivers, warehouses, trucks],
  );

  const ledgerTotals = useMemo(() => {
    const contractIncome = sumLedgerByCategories(financeLedger, ['delivery_income'], 'income');
    const contractRevenue =
      contractIncome > 0
        ? contractIncome
        : contracts
            .filter((c) => c.status === 'completed')
            .reduce((sum, c) => sum + (c.payment ?? 0), 0);

    return {
      contractRevenue,
      tradeSaleTotal: sumLedgerByCategories(financeLedger, ['trade_sale'], 'income'),
      otherIncome: aggregateOtherLedgerIncome(financeLedger, [
        'trade_sale',
        'delivery_income',
      ]),
      deliveryFuelExpense: sumLedgerByCategories(financeLedger, ['delivery_expense'], 'expense'),
      driverSalaryExpense: sumLedgerByCategories(financeLedger, ['driver_salary'], 'expense'),
      warehouseRentExpense: sumLedgerByCategories(financeLedger, ['warehouse_rent'], 'expense'),
      truckLeaseExpense: sumLedgerByCategories(
        financeLedger,
        ['truck_lease', 'truck_rental'],
        'expense',
      ),
      operationsExpense: sumLedgerByCategories(financeLedger, ['operations'], 'expense'),
      fleetPurchaseExpense: sumLedgerByCategories(financeLedger, ['fleet_purchase'], 'expense'),
      warehouseOpenExpense: sumLedgerByCategories(financeLedger, ['warehouse_open'], 'expense'),
      driverHireExpense: sumLedgerByCategories(financeLedger, ['driver_hire'], 'expense'),
      tradePurchaseExpense: sumLedgerByCategories(financeLedger, ['trade_purchase'], 'expense'),
      totalIncome: financeLedger
        .filter((e) => e.type === 'income')
        .reduce((sum, e) => sum + (e.amount ?? 0), 0),
      totalExpense: financeLedger
        .filter((e) => e.type === 'expense')
        .reduce((sum, e) => sum + (e.amount ?? 0), 0),
    };
  }, [financeLedger, contracts]);

  const totalRevenue = ledgerTotals.contractRevenue;
  const tradeSummary = useMemo(() => summarizeFinanceLedger(financeLedger), [financeLedger]);
  const totalExpenses = useMemo(calculateTotalExpenses, [
    activeDeliveries,
    trucks,
    drivers,
    warehouses,
  ]);
  const netProfit =
    ledgerTotals.totalIncome > 0 || ledgerTotals.totalExpense > 0
      ? ledgerTotals.totalIncome - ledgerTotals.totalExpense
      : totalRevenue + tradeSummary.tradeSaleTotal - totalExpenses - tradeSummary.tradePurchaseTotal;
  const dailyFixedCosts = projectedDailyCosts.total;
  const weeklyLeaseBurden = useMemo(() => getWeeklyLeaseBurden(trucks), [trucks]);
  const companyValue = useMemo(calculateCompanyValue, [trucks, warehouses, player?.reputation, cash]);
  const inventoryStockValue = useMemo(
    () => calculateInventoryStockValue(warehouses),
    [warehouses],
  );

  const companyScoreBreakdown = useMemo(
    () =>
      getCompanyScoreBreakdown({
        player,
        cities,
        products,
        financeLedger,
        currentTime,
      }),
    [player, cities, products, financeLedger, currentTime],
  );

  const companyScoreLines: BreakdownLine[] = useMemo(
    () => [
      { icon: 'cash', label: 'Nakit', amount: companyScoreBreakdown.cashScore, color: colors.success },
      {
        icon: 'truck',
        label: 'Filo değeri',
        amount: companyScoreBreakdown.truckValueScore,
        color: colors.accentBlue,
      },
      {
        icon: 'warehouse',
        label: 'Depo değeri',
        amount: companyScoreBreakdown.warehouseValueScore,
        color: colors.accentAmber,
      },
      {
        icon: 'market',
        label: 'Stok değeri',
        amount: companyScoreBreakdown.inventoryValueScore,
        color: colors.info,
      },
      {
        icon: 'contract',
        label: 'Teslimat bonusu',
        amount: companyScoreBreakdown.completedContractsScore,
        color: colors.success,
      },
      {
        icon: 'company',
        label: 'İtibar bonusu',
        amount: companyScoreBreakdown.reputationScore,
        color: colors.accentAmber,
      },
      {
        icon: 'upgrade',
        label: 'Seviye bonusu',
        amount: companyScoreBreakdown.levelScore,
        color: colors.accentBlue,
      },
      {
        icon: 'profit',
        label: 'Haftalık ticaret bonusu',
        amount: companyScoreBreakdown.weeklyTradeProfitScore,
        color: colors.success,
      },
      {
        icon: 'warning',
        label: 'Cezalar',
        amount: companyScoreBreakdown.penaltiesScore,
        color: colors.danger,
      },
    ],
    [companyScoreBreakdown],
  );

  const availableContractCount = useMemo(
    () => contracts.filter((c) => c.status === 'available').length,
    [contracts],
  );

  const idleTruckCount = useMemo(
    () => trucks.filter((truck) => truck.status === 'idle').length,
    [trucks],
  );

  const financialHealth = useMemo(() => {
    let score = 100;
    const averageCondition = calculateAverageTruckCondition();
    const hasFailedContract = contracts.some((c) => c.status === 'failed');

    if (cash < CRITICAL_CASH_THRESHOLD) score -= financeBalance.healthPenaltyLowCash;
    if (netProfit < 0) score -= financeBalance.healthPenaltyNegativeProfit;
    if (cash > 0 && dailyFixedCosts > cash * FIXED_COST_WARN_RATIO) {
      score -= financeBalance.healthPenaltyHighFixedCosts;
    }
    if (cash > 0 && dailyFixedCosts > cash * FIXED_COST_HIGH_RATIO) {
      score -= financeBalance.healthPenaltyHighFixedCosts;
    }
    if (activeDeliveries.length === 0 && availableContractCount === 0) score -= 10;
    if (trucks.length > 0 && averageCondition < HEALTH_TRUCK_CONDITION_THRESHOLD) {
      score -= financeBalance.healthPenaltyLowTruckCondition;
    }
    if (idleTruckCount === 0 && activeDeliveries.length > 0) score -= 5;
    if (hasFailedContract) score -= 15;

    return Math.max(0, Math.min(100, score));
  }, [
    cash,
    netProfit,
    dailyFixedCosts,
    trucks,
    contracts,
    activeDeliveries.length,
    availableContractCount,
    idleTruckCount,
  ]);

  const healthLabel = getFinancialHealthLabel(financialHealth);
  const healthColor = getHealthBarColor(financialHealth);

  const alerts = useMemo(() => {
    const nextAlerts: string[] = [];

    if (idleTruckCount === 0 && trucks.length > 0 && activeDeliveries.length > 0) {
      nextAlerts.push(
        'Boşta kamyonun yok. Yeni iş almak için teslimatın bitmesini bekle veya yeni kamyon satın al.',
      );
    }
    if (cash > 0 && dailyFixedCosts > cash * FIXED_COST_WARN_RATIO) {
      nextAlerts.push('Sabit giderler nakit rezervine göre yüksek.');
    }
    if (fuelPrice > BASELINE_FUEL_PRICE * FUEL_PRICE_SPIKE_RATIO) {
      nextAlerts.push('Yakıt giderleri artıyor. Uzun rotalarda kâr düşebilir.');
    }
    if (trucks.some((truck) => truck.condition < MAINTENANCE_WARNING_CONDITION)) {
      nextAlerts.push('Bazı kamyonların bakıma ihtiyacı olabilir.');
    }

    return nextAlerts.slice(0, MAX_ALERTS);
  }, [idleTruckCount, trucks, activeDeliveries.length, cash, dailyFixedCosts, fuelPrice]);

  const topRunningDeliveries = useMemo(
    () =>
      activeDeliveries
        .filter((delivery) => RUNNING_DELIVERY_STATUSES.includes(delivery.status))
        .slice(0, MAX_ACTIVE_DELIVERIES),
    [activeDeliveries],
  );

  const runningDeliveryCount = useMemo(
    () =>
      activeDeliveries.filter((delivery) =>
        RUNNING_DELIVERY_STATUSES.includes(delivery.status),
      ).length,
    [activeDeliveries],
  );

  const recentLedgerEntries = useMemo(
    () => (financeLedger ?? []).slice(0, MAX_LEDGER_ENTRIES),
    [financeLedger],
  );

  const showNetProfitHint = activeDeliveries.length > 0 && totalRevenue === 0;
  const showRevenueHint = totalRevenue === 0 && activeDeliveries.length > 0;
  const hasTradeActivity =
    tradeSummary.tradePurchaseTotal > 0 ||
    tradeSummary.tradeSaleTotal > 0 ||
    inventoryStockValue > 0;

  const fuelCosts =
    ledgerTotals.deliveryFuelExpense > 0
      ? ledgerTotals.deliveryFuelExpense
      : calculateActiveFuelCosts();
  const maintenanceCosts = calculateMaintenanceExposure();
  const driverSalaries =
    ledgerTotals.driverSalaryExpense > 0
      ? ledgerTotals.driverSalaryExpense
      : calculateDailyDriverSalary();
  const warehouseCosts =
    ledgerTotals.warehouseRentExpense > 0
      ? ledgerTotals.warehouseRentExpense
      : calculateDailyWarehouseCost();
  const truckLeaseCosts = ledgerTotals.truckLeaseExpense;
  const operationsCosts = ledgerTotals.operationsExpense;
  const otherIncome = ledgerTotals.otherIncome;
  const otherExpense = aggregateOtherLedgerExpense(financeLedger, [
    'trade_purchase',
    'delivery_expense',
    'fleet_purchase',
    'warehouse_open',
    'truck_transfer',
    'driver_salary',
    'warehouse_rent',
    'truck_lease',
    'truck_rental',
    'operations',
    'driver_hire',
    'daily_operating_cost',
  ]);

  const incomeLines: BreakdownLine[] = [
    {
      icon: 'contract',
      label: 'Sözleşme gelirleri',
      amount: ledgerTotals.contractRevenue,
      color: colors.success,
    },
    {
      icon: 'revenue',
      label: 'Ticaret satışları',
      amount: ledgerTotals.tradeSaleTotal || tradeSummary.tradeSaleTotal,
      color: colors.success,
    },
    { icon: 'cash', label: 'Diğer gelirler', amount: otherIncome, color: colors.info },
  ];

  const deliveryExpenseLines: BreakdownLine[] = [
    { icon: 'fuel', label: 'Yakıt', amount: fuelCosts, color: colors.danger },
    { icon: 'repair', label: 'Bakım payı', amount: maintenanceCosts, color: colors.danger },
    {
      icon: 'warning',
      label: 'Risk/ceza',
      amount: calculateLatePenalties() + calculateFailedDeliveryPenalties(),
      color: colors.textMuted,
    },
  ];

  const fixedExpenseLines: BreakdownLine[] = [
    { icon: 'driver', label: 'Şoför maaşları', amount: driverSalaries, color: colors.danger },
    { icon: 'warehouse', label: 'Depo giderleri', amount: warehouseCosts, color: colors.danger },
    { icon: 'truck', label: 'Kamyon kiraları', amount: truckLeaseCosts, color: colors.danger },
    { icon: 'company', label: 'Genel operasyon', amount: operationsCosts, color: colors.danger },
  ];

  const investmentExpenseLines: BreakdownLine[] = [
    {
      icon: 'truck',
      label: 'Kamyon satın alma',
      amount: ledgerTotals.fleetPurchaseExpense,
      color: colors.danger,
    },
    {
      icon: 'warehouse',
      label: 'Depo açma',
      amount: ledgerTotals.warehouseOpenExpense,
      color: colors.danger,
    },
    {
      icon: 'driver',
      label: 'Şoför işe alma',
      amount: ledgerTotals.driverHireExpense,
      color: colors.danger,
    },
    {
      icon: 'market',
      label: 'Ürün satın alma',
      amount: ledgerTotals.tradePurchaseExpense || tradeSummary.tradePurchaseTotal,
      color: colors.danger,
    },
  ];

  if (!player) {
    return (
      <AppScreen>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll embedded>
      <ScreenHeader
        title="Finans"
        subtitle="Gelirleri, giderleri ve şirket sağlığını takip et"
        compact
      />

      <FinanceMetricStrip
        cash={cash}
        netProfit={netProfit}
        dailyFixedCosts={dailyFixedCosts}
        companyValue={companyValue}
      />

      {showNetProfitHint ? (
        <Text style={styles.summaryHint}>Teslimat gelirleri tamamlandığında net kâra yansır.</Text>
      ) : null}

      <SectionTitle
        title="Şirket Puanı Dağılımı"
        subtitle={`Toplam: ${formatCompanyScore(companyScoreBreakdown.totalScore)}`}
        compact
      />
      <BreakdownCard
        lines={companyScoreLines}
        formatValue={formatCompanyScore}
        hint="Haftalık leaderboard sıralaması bu puana göre yapılacak. Sadece nakit değil, filo ve operasyon gücü de sayılır."
      />

      <SectionTitle title="Gelirler" compact />
      <BreakdownCard
        lines={incomeLines}
        hint={showRevenueHint ? 'Gelirler teslimat tamamlandığında işlenir.' : undefined}
      />

      <SectionTitle title="Teslimat Giderleri" compact />
      <BreakdownCard lines={deliveryExpenseLines} />

      <SectionTitle
        title="Sabit Giderler"
        subtitle={`Günlük tahmin: ${formatMoney(dailyFixedCosts)} · Haftalık kira yükü: ${formatMoney(weeklyLeaseBurden)}`}
        compact
      />
      <BreakdownCard lines={fixedExpenseLines} />

      <SectionTitle title="Tek Seferlik Yatırımlar" compact />
      <BreakdownCard lines={investmentExpenseLines} />

      {otherExpense > 0 ? (
        <>
          <SectionTitle title="Diğer Giderler" compact />
          <BreakdownCard
            lines={[
              { icon: 'alert', label: 'Diğer', amount: otherExpense, color: colors.danger },
            ]}
          />
        </>
      ) : null}

      <SectionTitle title="Ticaret Performansı" compact />
      <AppCard style={styles.tradeCard} padded={false}>
        {hasTradeActivity ? (
          <>
            <View style={styles.tradeRow}>
              <Text style={styles.tradeLabel}>Ürün alımları</Text>
              <Text style={[styles.tradeValue, { color: colors.danger }]}>
                {formatMoney(tradeSummary.tradePurchaseTotal)}
              </Text>
            </View>
            <View style={styles.tradeRow}>
              <Text style={styles.tradeLabel}>Ürün satışları</Text>
              <Text style={[styles.tradeValue, { color: colors.success }]}>
                {formatMoney(tradeSummary.tradeSaleTotal)}
              </Text>
            </View>
            <View style={styles.tradeRow}>
              <Text style={styles.tradeLabel}>Tahmini ticaret kârı</Text>
              <Text
                style={[
                  styles.tradeValue,
                  {
                    color:
                      tradeSummary.tradeNetProfit >= 0 ? colors.success : colors.danger,
                  },
                ]}
              >
                {formatMoney(tradeSummary.tradeNetProfit)}
              </Text>
            </View>
            <View style={[styles.tradeRow, styles.tradeRowLast]}>
              <Text style={styles.tradeLabel}>Depodaki stok değeri</Text>
              <Text style={[styles.tradeValue, { color: colors.accentAmber }]}>
                {formatMoney(inventoryStockValue)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.tradeEmpty}>Henüz ticaret işlemi yok.</Text>
        )}
      </AppCard>

      <SectionTitle
        title="Aktif Teslimat Kârlılığı"
        subtitle={
          runningDeliveryCount > 0 ? `${runningDeliveryCount} aktif teslimat` : undefined
        }
        compact
      />

      {topRunningDeliveries.length === 0 ? (
        <EmptyState
          title="Şu anda aktif teslimat yok"
          message="Yeni sözleşme alarak filonu çalıştırabilirsin."
          icon="route"
        />
      ) : (
        topRunningDeliveries.map((delivery) => {
          const contract = contracts.find((c) => c.id === delivery.contractId);
          const payment = contract?.payment ?? 0;
          const estimatedProfit =
            typeof delivery.estimatedProfit === 'number'
              ? delivery.estimatedProfit
              : payment - (delivery.fuelCost ?? 0);
          const profitMargin = payment > 0 ? estimatedProfit / payment : 0;
          const risk = getDeliveryRiskBadge(delivery);
          const status = getDeliveryStatusBadge(delivery.status);
          const progress = Number.isFinite(delivery.progress) ? delivery.progress : 0;

          return (
            <AppCard key={delivery.id} style={styles.deliveryCard} padded={false}>
              <View style={styles.deliveryHeader}>
                <View style={styles.deliveryTitleBlock}>
                  <Text style={styles.deliveryRoute} numberOfLines={1}>
                    {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                  </Text>
                  <Text style={styles.deliverySub} numberOfLines={1}>
                    {getProductName(delivery.productId)} · {formatTons(delivery.amount)}
                  </Text>
                </View>
                <StatusBadge label={status.label} variant={status.variant} size="sm" />
              </View>

              <View style={styles.deliveryStats}>
                <Text style={styles.deliveryStat}>Ödeme: {formatMoney(payment)}</Text>
                <Text style={styles.deliveryStat}>
                  Yakıt/gider: {formatMoney(delivery.fuelCost ?? 0)}
                </Text>
                <Text
                  style={[
                    styles.deliveryStat,
                    { color: estimatedProfit >= 0 ? colors.success : colors.danger },
                  ]}
                >
                  Tahmini net kâr: {formatMoney(estimatedProfit)}
                </Text>
              </View>

              <View style={styles.deliveryFooter}>
                <StatusBadge label={risk.label} variant={risk.variant} size="sm" />
                <Text style={styles.deliveryMargin}>Marj: {formatPercent(profitMargin)}</Text>
              </View>

              {delivery.status === 'on_route' ? (
                <View style={styles.deliveryProgress}>
                  <ProgressBar progress={progress} color={colors.accentBlue} height={5} />
                  <Text style={styles.deliveryProgressText}>{formatPercent(progress)}</Text>
                </View>
              ) : null}

              {profitMargin > HIGH_PROFIT_MARGIN ? (
                <Text style={styles.profitNote}>Bu iş oldukça kârlı görünüyor.</Text>
              ) : null}
            </AppCard>
          );
        })
      )}

      <SectionTitle title="Finansal Sağlık" compact />
      <AppCard
        variant="soft"
        style={[styles.healthCard, { borderColor: healthColor }]}
        padded={false}
      >
        <View style={styles.healthHeader}>
          <View>
            <Text style={[styles.healthScore, { color: healthColor }]}>
              {Math.round(financialHealth)}
              <Text style={styles.healthScoreSuffix}> / 100</Text>
            </Text>
            <Text style={[styles.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
          </View>
          <GameIcon name="success" size={22} color={healthColor} />
        </View>
        <ProgressBar progress={financialHealth / 100} color={healthColor} height={8} />
        <Text style={styles.healthHint} numberOfLines={2}>
          Nakit rezervi, sabit giderler, filo kondisyonu ve sözleşme geçmişine göre hesaplanır.
        </Text>
      </AppCard>

      <SectionTitle title="Son Finans Hareketleri" compact />
      {recentLedgerEntries.length === 0 ? (
        <AppCard variant="soft" style={styles.ledgerEmptyCard} padded={false}>
          <Text style={styles.ledgerEmptyText}>Henüz finans hareketi yok.</Text>
        </AppCard>
      ) : (
        recentLedgerEntries.map((entry, index) => {
          const display = getLedgerDisplay(entry);
          const amountColor = entry.type === 'income' ? colors.success : colors.danger;
          const amountPrefix = entry.type === 'income' ? '+' : '-';

          return (
            <AppCard
              key={entry.id ?? `ledger-${index}`}
              style={styles.ledgerRow}
              padded={false}
            >
              <View style={styles.ledgerIconWrap}>
                <GameIcon name={display.icon} size={16} color={amountColor} />
              </View>
              <View style={styles.ledgerMain}>
                <Text style={styles.ledgerTitle} numberOfLines={1}>
                  {display.title}
                </Text>
                <Text style={styles.ledgerMeta} numberOfLines={1}>
                  {display.categoryLabel} · {formatLedgerTime(entry.time)}
                </Text>
              </View>
              <View style={styles.ledgerAmountCol}>
                <Text style={[styles.ledgerAmount, { color: amountColor }]}>
                  {amountPrefix}
                  {formatMoney(entry.amount ?? 0)}
                </Text>
                <Text style={[styles.ledgerAmountType, { color: amountColor }]}>
                  {entry.type === 'income' ? 'Gelir' : 'Gider'}
                </Text>
              </View>
            </AppCard>
          );
        })
      )}

      {alerts.length > 0 ? (
        <>
          <SectionTitle title="Finans Uyarıları" compact />
          <AppCard style={styles.alertsCard} padded={false}>
            {alerts.map((alert, index) => (
              <View key={index} style={styles.alertRow}>
                <GameIcon name="warning" size={14} color={colors.accentAmber} />
                <Text style={styles.alertText}>{alert}</Text>
              </View>
            ))}
          </AppCard>
        </>
      ) : null}
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

  metricStrip: {
    gap: spacing.md,
    paddingRight: spacing.lg,
    paddingBottom: spacing.xs,
    marginBottom: 12,
  },
  metricPillWrap: {
    minWidth: 108,
  },
  summaryHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },

  breakdownCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  breakdownHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  breakdownRowLast: {
    borderBottomWidth: 0,
  },
  breakdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  breakdownIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.cardSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  breakdownValue: {
    ...typography.bodySmall,
    fontWeight: '800',
  },

  tradeCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tradeRowLast: {
    borderBottomWidth: 0,
  },
  tradeLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  tradeValue: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  tradeEmpty: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  deliveryCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  deliveryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  deliveryTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  deliveryRoute: {
    ...typography.cardTitle,
    fontSize: 13,
  },
  deliverySub: {
    ...typography.caption,
    marginTop: 2,
  },
  deliveryStats: {
    gap: 3,
    marginBottom: spacing.sm,
  },
  deliveryStat: {
    ...typography.bodySmall,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  deliveryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deliveryMargin: {
    ...typography.caption,
    color: colors.textMuted,
  },
  deliveryProgress: {
    marginTop: spacing.sm,
    gap: 4,
  },
  deliveryProgressText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'right',
  },
  profitNote: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },

  healthCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  healthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  healthScore: {
    fontSize: 28,
    fontWeight: '800',
  },
  healthScoreSuffix: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  healthLabel: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  healthHint: {
    ...typography.caption,
    marginTop: spacing.sm,
    lineHeight: 16,
  },

  ledgerEmptyCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  ledgerEmptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  ledgerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerMain: {
    flex: 1,
    minWidth: 0,
  },
  ledgerTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
  ledgerMeta: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 2,
  },
  ledgerAmount: {
    ...typography.bodySmall,
    fontWeight: '800',
    textAlign: 'right',
  },
  ledgerAmountCol: {
    alignItems: 'flex-end',
    minWidth: 72,
  },
  ledgerAmountType: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'right',
  },

  alertsCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  alertText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
    color: colors.textSecondary,
  },
});
