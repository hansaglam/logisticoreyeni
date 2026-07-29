/**
 * LogistiCore - Finans Ekranı
 *
 * Premium gelir/gider analizi — şirket sağlığı ve ticaret performansı.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ProgressBar,
  SectionTitle,
  SmallStatPill,
  StatusBadge,
} from '../components/ui';
import type { GameIconName } from '../theme/icons';
import type { StatusBadgeVariant } from '../components/ui';
import { economyBalance, financeBalance } from '../config/balance';
import { getSafeFuelPrice } from '../simulation/economy';
import { getCityName, getProductName } from '../utils/entityLookup';
import {
  calculateFinanceAlerts,
  calculateFinanceSummary,
  calculateFinancialHealthScore,
  calculateInventoryStockValue,
  getCategoryAmount,
  getLedgerCategoryLabel,
  sumCategoriesExcept,
} from '../utils/financeCalculations';
import {
  formatCompanyScore,
  getCompanyScoreBreakdown,
} from '../simulation/companyScore';
import { calculateDeliverySettlement } from '../simulation/delivery';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, formatRatioPercent, formatTons, spacing, typography } from '../theme';
import type {
  Delivery,
  Driver,
  FinanceLedgerEntry,
  Truck,
} from '../types/game';

const MAINTENANCE_WARNING_CONDITION = financeBalance.truckConditionThreshold;
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
    case 'paused':
      return { label: 'Yakıt Bitti', variant: 'danger' };
    case 'completed':
      return { label: 'Tamamlandı', variant: 'success' };
    case 'failed':
      return { label: 'Başarısız', variant: 'danger' };
    default:
      return { label: status, variant: 'muted' };
  }
}

function formatLedgerTime(entryTime: number): string {
  const safeEntry = Number.isFinite(entryTime) ? entryTime : 0;
  const day = Math.floor(safeEntry / DAY_HOURS) + 1;
  const hour = Math.floor(safeEntry % DAY_HOURS);
  return `Gün ${day} · ${hour.toString().padStart(2, '0')}:00`;
}

function getLedgerIcon(
  category: FinanceLedgerEntry['category'],
  type: FinanceLedgerEntry['type'],
): GameIconName {
  switch (category) {
    case 'trade_purchase':
    case 'trade_sale':
      return 'market';
    case 'contract_income':
    case 'delivery_income':
      return 'contract';
    case 'fuel':
    case 'delivery_expense':
      return 'fuel';
    case 'maintenance':
      return 'repair';
    case 'penalty':
      return 'expense';
    case 'truck_purchase':
    case 'fleet_purchase':
    case 'truck_lease':
    case 'truck_rental':
    case 'truck_transfer':
      return 'truck';
    case 'warehouse_open':
    case 'warehouse_operating':
    case 'warehouse_rent':
      return 'warehouse';
    case 'driver_salary':
    case 'driver_hire':
      return 'driver';
    case 'daily_operating_cost':
    case 'operations':
      return 'expense';
    default:
      return type === 'income' ? 'revenue' : 'expense';
  }
}

function getLedgerDisplay(entry: FinanceLedgerEntry): {
  icon: GameIconName;
  title: string;
  categoryLabel: string;
  detail?: string;
} {
  const categoryLabel = getLedgerCategoryLabel(entry.category, entry.type);
  const description = entry.description?.trim();
  const title = entry.title?.trim() || description || categoryLabel;

  if (entry.category === 'daily_operating_cost') {
    return {
      icon: 'expense',
      title: entry.title?.trim() || 'Günlük işletme giderleri',
      categoryLabel,
      detail: description,
    };
  }

  return {
    icon: getLedgerIcon(entry.category, entry.type),
    title,
    categoryLabel,
    detail: entry.title && description ? description : undefined,
  };
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
            <Text style={styles.breakdownLabel} numberOfLines={1} ellipsizeMode="tail">
              {line.label}
            </Text>
          </View>
          <Text
            style={[styles.breakdownValue, { color: line.color ?? colors.textPrimary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {formatValue(line.amount)}
          </Text>
        </View>
      ))}
    </AppCard>
  );
}

function FinanceMetricStrip({
  cash,
  totalRevenue,
  totalExpenses,
  netProfit,
  dailyFixedCosts,
}: {
  cash: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  dailyFixedCosts: number;
}) {
  return (
    <View style={styles.metricStrip}>
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
          label="Toplam gelir"
          value={formatMoney(totalRevenue)}
          icon="revenue"
          accentColor={colors.success}
          layout="chip"
        />
      </View>
      <View style={styles.metricPillWrap}>
        <SmallStatPill
          label="Toplam gider"
          value={formatMoney(totalExpenses)}
          icon="expense"
          accentColor={colors.danger}
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
      <View style={styles.metricPillWrapWide}>
        <SmallStatPill
          label="Günlük sabit gider"
          value={formatMoney(dailyFixedCosts)}
          icon="expense"
          accentColor={colors.danger}
          layout="chip"
        />
      </View>
    </View>
  );
}

export default function FinanceScreen() {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const financeTotals = useGameStore((state) => state.financeTotals);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);

  const trucks: Truck[] = player?.trucks ?? [];
  const drivers: Driver[] = player?.drivers ?? [];
  const warehouses = player?.warehouses ?? [];
  const cash = player?.money ?? 0;
  const fuelPrice = getSafeFuelPrice(globalEconomy);

  const financeSummary = useMemo(
    () =>
      calculateFinanceSummary({
        financeLedger,
        financeTotals,
        contracts,
        activeDeliveries,
        trucks,
        drivers,
        warehouses,
        recentEntryLimit: MAX_LEDGER_ENTRIES,
      }),
    [financeLedger, financeTotals, contracts, activeDeliveries, trucks, drivers, warehouses],
  );

  const {
    totalRevenue,
    totalExpenses,
    netProfit,
    dailyOperatingCost,
    weeklyLeaseBurden,
    recentEntries: recentLedgerEntries,
    tradePurchaseTotal,
    tradeSaleTotal,
    tradeNetProfit,
  } = financeSummary;

  const dailyFixedCosts = dailyOperatingCost.total;

  const inventoryStockValue = useMemo(
    () => calculateInventoryStockValue(warehouses, cities),
    [warehouses, cities],
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
        label: 'Ceza Etkisi',
        amount: companyScoreBreakdown.penaltyScore,
        color: colors.danger,
      },
    ],
    [companyScoreBreakdown],
  );

  const companyScoreHint =
    companyScoreBreakdown.penaltyScore < 0
      ? 'Başarısız ve geç teslimatlar şirket puanını düşürür. Haftalık liderlik tablosu bu puana göre sıralanır.'
      : 'Haftalık liderlik tablosu bu puana göre sıralanır. Sadece nakit değil, filo ve operasyon gücü de sayılır.';

  const availableContractCount = useMemo(
    () => contracts.filter((c) => c.status === 'available').length,
    [contracts],
  );

  const idleTruckCount = useMemo(
    () => trucks.filter((truck) => truck.status === 'idle').length,
    [trucks],
  );

  const financialHealth = useMemo(
    () =>
      calculateFinancialHealthScore({
        cash,
        netProfit,
        dailyFixedCosts,
        trucks,
        contracts,
        activeDeliveryCount: activeDeliveries.length,
        availableContractCount,
        idleTruckCount,
        fixedCostWarnRatio: FIXED_COST_WARN_RATIO,
        fixedCostHighRatio: FIXED_COST_HIGH_RATIO,
      }),
    [
      cash,
      netProfit,
      dailyFixedCosts,
      trucks,
      contracts,
      activeDeliveries.length,
      availableContractCount,
      idleTruckCount,
    ],
  );

  const healthLabel = getFinancialHealthLabel(financialHealth);
  const healthColor = getHealthBarColor(financialHealth);

  const alerts = useMemo(
    () =>
      calculateFinanceAlerts({
        cash,
        dailyFixedCosts,
        fuelPrice,
        baselineFuelPrice: BASELINE_FUEL_PRICE,
        fuelPriceSpikeRatio: FUEL_PRICE_SPIKE_RATIO,
        fixedCostWarnRatio: FIXED_COST_WARN_RATIO,
        trucks,
        idleTruckCount,
        activeDeliveryCount: activeDeliveries.length,
        maintenanceWarningCondition: MAINTENANCE_WARNING_CONDITION,
        maxAlerts: MAX_ALERTS,
      }),
    [idleTruckCount, trucks, activeDeliveries.length, cash, dailyFixedCosts, fuelPrice],
  );

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

  const showNetProfitHint =
    (financeSummary.source === 'ledger' || financeSummary.source === 'totals') &&
    activeDeliveries.length > 0 &&
    totalRevenue === 0;
  const showRevenueHint = showNetProfitHint;
  const showFallbackHint = financeSummary.source === 'fallback';
  const hasTradeActivity =
    tradePurchaseTotal > 0 || tradeSaleTotal > 0 || inventoryStockValue > 0;

  const contractRevenue = getCategoryAmount(financeSummary.incomeByCategory, 'Sözleşme Geliri');
  const otherIncome = sumCategoriesExcept(financeSummary.incomeByCategory, [
    'Sözleşme Geliri',
    'Ticaret Geliri',
  ]);
  const otherExpense = getCategoryAmount(financeSummary.expenseByCategory, 'Diğer');
  const operatingCostLedger = getCategoryAmount(
    financeSummary.expenseByCategory,
    'İşletme Gideri',
  );

  const incomeLines: BreakdownLine[] = [
    {
      icon: 'contract',
      label: 'Sözleşme gelirleri',
      amount: contractRevenue,
      color: colors.success,
    },
    {
      icon: 'revenue',
      label: 'Ticaret satışları',
      amount: tradeSaleTotal,
      color: colors.success,
    },
    { icon: 'cash', label: 'Diğer gelirler', amount: otherIncome, color: colors.info },
  ];

  const deliveryExpenseLines: BreakdownLine[] = [
    {
      icon: 'fuel',
      label: 'Yakıt',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Yakıt'),
      color: colors.danger,
    },
    {
      icon: 'repair',
      label: 'Bakım',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Bakım'),
      color: colors.danger,
    },
    {
      icon: 'warning',
      label: 'Ceza',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Ceza'),
      color: colors.textMuted,
    },
  ];

  const fixedExpenseLines: BreakdownLine[] = [
    {
      icon: 'driver',
      label: 'Şoför maaşları',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Şoför Maaşı'),
      color: colors.danger,
    },
    {
      icon: 'warehouse',
      label: 'Depo giderleri',
      amount:
        getCategoryAmount(financeSummary.expenseByCategory, 'Depo Gideri') + operatingCostLedger,
      color: colors.danger,
    },
    {
      icon: 'truck',
      label: 'Kamyon kiraları',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Kamyon Kirası'),
      color: colors.danger,
    },
    {
      icon: 'company',
      label: 'Genel operasyon',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Genel Operasyon'),
      color: colors.danger,
    },
  ];

  const investmentExpenseLines: BreakdownLine[] = [
    {
      icon: 'truck',
      label: 'Kamyon satın alma',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Kamyon Alımı'),
      color: colors.danger,
    },
    {
      icon: 'warehouse',
      label: 'Depo açma',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Depo Açılışı'),
      color: colors.danger,
    },
    {
      icon: 'driver',
      label: 'Şoför işe alma',
      amount: getCategoryAmount(financeSummary.expenseByCategory, 'Şoför İşe Alım'),
      color: colors.danger,
    },
    {
      icon: 'market',
      label: 'Ürün satın alma',
      amount: tradePurchaseTotal,
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
      <Text style={styles.embeddedSubtitle}>
        Gelirleri, giderleri ve şirket sağlığını takip et
      </Text>

      <FinanceMetricStrip
        cash={cash}
        totalRevenue={totalRevenue}
        totalExpenses={totalExpenses}
        netProfit={netProfit}
        dailyFixedCosts={dailyFixedCosts}
      />

      {showFallbackHint ? (
        <Text style={styles.summaryHint}>Finans özeti tahmini verilerle hesaplanıyor.</Text>
      ) : null}

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
        hint={companyScoreHint}
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
        subtitle={`Günlük tahmin (cash): ${formatMoney(dailyFixedCosts)} · Aktif kiralık: ${formatMoney(weeklyLeaseBurden)}/hafta (peşin)`}
        compact
      />
      <Text style={styles.breakdownHint}>
        Günlük sabit gider; şoför maaşı, depo ve operasyon maliyetlerini içerir.
      </Text>
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
              <Text style={styles.tradeLabel} numberOfLines={1} ellipsizeMode="tail">
                Ürün alımları
              </Text>
              <Text style={[styles.tradeValue, { color: colors.danger }]} numberOfLines={1}>
                {formatMoney(tradePurchaseTotal)}
              </Text>
            </View>
            <View style={styles.tradeRow}>
              <Text style={styles.tradeLabel} numberOfLines={1} ellipsizeMode="tail">
                Ürün satışları
              </Text>
              <Text style={[styles.tradeValue, { color: colors.success }]} numberOfLines={1}>
                {formatMoney(tradeSaleTotal)}
              </Text>
            </View>
            <View style={styles.tradeRow}>
              <Text style={styles.tradeLabel} numberOfLines={1} ellipsizeMode="tail">
                Tahmini ticaret kârı
              </Text>
              <Text
                style={[
                  styles.tradeValue,
                  {
                    color: tradeNetProfit >= 0 ? colors.success : colors.danger,
                  },
                ]}
                numberOfLines={1}
              >
                {formatMoney(tradeNetProfit)}
              </Text>
            </View>
            <View style={[styles.tradeRow, styles.tradeRowLast]}>
              <Text style={styles.tradeLabel} numberOfLines={1} ellipsizeMode="tail">
                Depodaki stok değeri
              </Text>
              <Text style={[styles.tradeValue, { color: colors.accentAmber }]} numberOfLines={1}>
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
          const fuelCost = delivery.fuelCost ?? 0;
          const maintenanceCost = delivery.maintenanceCost ?? 0;
          const settlement =
            typeof delivery.estimatedProfit === 'number'
              ? {
                  grossRevenue: payment,
                  fuelCost,
                  maintenanceCost,
                  penaltyCost: 0,
                  totalCost: fuelCost + maintenanceCost,
                  netProfit: delivery.estimatedProfit,
                  cashDeltaOnCompletion: payment - maintenanceCost,
                }
              : calculateDeliverySettlement({
                  contractPayment: payment,
                  fuelCost,
                  maintenanceCost,
                  penaltyCost: 0,
                  fuelAlreadyPaid: true,
                });
          const estimatedProfit = settlement.netProfit;
          const totalExpense = settlement.totalCost;
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
                  Toplam gider: {formatMoney(totalExpense)}
                </Text>
                <Text style={styles.deliveryStat}>
                  Yakıt: {formatMoney(fuelCost)} · Bakım: {formatMoney(maintenanceCost)}
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
          const displayAmount = Math.abs(entry.amount ?? 0);

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
                <Text style={styles.ledgerMeta} numberOfLines={display.detail ? 2 : 1}>
                  {display.detail ?? `${display.categoryLabel} · ${formatLedgerTime(entry.time)}`}
                </Text>
                {display.detail ? (
                  <Text style={styles.ledgerMetaSecondary} numberOfLines={1}>
                    {display.categoryLabel} · {formatLedgerTime(entry.time)}
                  </Text>
                ) : null}
              </View>
              <View style={styles.ledgerAmountCol}>
                <Text style={[styles.ledgerAmount, { color: amountColor }]}>
                  {amountPrefix}
                  {formatMoney(displayAmount)}
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
  embeddedSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
    marginBottom: spacing.md,
  },

  metricStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: 12,
  },
  metricPillWrap: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 148,
    maxWidth: '100%',
  },
  metricPillWrapWide: {
    flexGrow: 1,
    flexBasis: '100%',
    minWidth: 148,
    maxWidth: '100%',
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
    minWidth: 0,
    marginRight: spacing.sm,
    lineHeight: 18,
  },
  breakdownValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    flexShrink: 0,
    lineHeight: 18,
  },

  tradeCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
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
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
    lineHeight: 18,
  },
  tradeValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    flexShrink: 0,
    lineHeight: 18,
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
  ledgerMetaSecondary: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
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
