/**
 * LogistiCore - Finans Ekranı
 *
 * More menüsü içinde kullanılan sade finans analiz ekranı.
 */

import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useGameStore } from '../store/gameStore';
import { economyBalance, financeBalance, warehouseBalance } from '../config/balance';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { summarizeFinanceLedger } from '../simulation/trading';
import { getLevelProgress } from '../simulation/leveling';
import type { Contract, Delivery, Driver, ProductId, Truck, Warehouse } from '../types/game';

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
const HIGH_PROFIT_MARGIN = 0.9;

type HealthLabel = 'Güçlü' | 'Dengeli' | 'Riskli' | 'Kritik';

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

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
}

function getProductName(productId: string): string {
  return PRODUCT_BY_ID[productId as ProductId]?.name ?? productId;
}

function getDeliveryRiskLabel(delivery: Delivery): { label: string; color: string } {
  const combinedRisk = (delivery.breakdownChance ?? 0) + (delivery.accidentChance ?? 0);
  if (combinedRisk < 0.1) return { label: 'Düşük', color: COLORS.success };
  if (combinedRisk < 0.25) return { label: 'Orta', color: COLORS.primary };
  return { label: 'Yüksek', color: COLORS.danger };
}

function getDeliveryStatusLabel(status: Delivery['status']): string {
  switch (status) {
    case 'on_route':
      return 'YOLDA';
    case 'preparing':
      return 'HAZIRLANIYOR';
    case 'completed':
      return 'TAMAMLANDI';
    case 'failed':
      return 'BAŞARISIZ';
    default:
      return status.toUpperCase();
  }
}

function getDeliveryStatusColor(status: Delivery['status']): string {
  switch (status) {
    case 'on_route':
      return COLORS.secondary;
    case 'preparing':
      return COLORS.primary;
    case 'completed':
      return COLORS.success;
    case 'failed':
      return COLORS.danger;
    default:
      return COLORS.textMuted;
  }
}

function getFinancialHealthLabel(score: number): HealthLabel {
  if (score >= 80) return 'Güçlü';
  if (score >= 60) return 'Dengeli';
  if (score >= 40) return 'Riskli';
  return 'Kritik';
}

function getFinancialHealthColor(score: number): string {
  switch (getFinancialHealthLabel(score)) {
    case 'Güçlü':
      return COLORS.success;
    case 'Dengeli':
      return COLORS.secondary;
    case 'Riskli':
      return COLORS.primary;
    case 'Kritik':
      return COLORS.danger;
    default:
      return COLORS.textSecondary;
  }
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  color = COLORS.textPrimary,
  isLast = false,
}: {
  label: string;
  value: string;
  color?: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.breakdownRow, isLast && styles.breakdownRowLast]}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={[styles.breakdownValue, { color }]}>{value}</Text>
    </View>
  );
}

function SummaryCard({
  cash,
  netProfit,
  dailyFixedCosts,
  companyValue,
  showNetProfitHint,
}: {
  cash: number;
  netProfit: number;
  dailyFixedCosts: number;
  companyValue: number;
  showNetProfitHint: boolean;
}) {
  return (
    <View style={styles.summaryWrapper}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.success }]}>{formatMoney(cash)}</Text>
          <Text style={styles.summaryLabel}>Nakit</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: netProfit >= 0 ? COLORS.success : COLORS.danger }]}>
            {formatMoney(netProfit)}
          </Text>
          <Text style={styles.summaryLabel}>Net kâr</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.danger }]}>{formatMoney(dailyFixedCosts)}</Text>
          <Text style={styles.summaryLabel}>Günlük sabit gider</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.primary }]}>{formatMoney(companyValue)}</Text>
          <Text style={styles.summaryLabel}>Şirket değeri</Text>
        </View>
      </View>
      {showNetProfitHint ? (
        <Text style={styles.summaryHint}>Teslimat gelirleri tamamlandığında net kâra yansır.</Text>
      ) : null}
    </View>
  );
}

export default function FinanceScreen() {
  const player = useGameStore((state) => state.player);
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];

  const trucks: Truck[] = player?.trucks ?? [];
  const drivers: Driver[] = player?.drivers ?? [];
  const warehouses: Warehouse[] = player?.warehouses ?? [];
  const cash = player?.money ?? 0;
  const fuelPrice = globalEconomy?.fuelPrice ?? BASELINE_FUEL_PRICE;
  const { scrollBottomPadding } = useTabBarLayout();
  const levelProgress = useMemo(
    () => (player ? getLevelProgress(player) : null),
    [player],
  );

  const calculateTotalRevenue = (): number => {
    return contracts
      .filter((c) => c.status === 'completed')
      .reduce((sum, c) => sum + (c.payment ?? 0), 0);
  };

  const calculateDailyDriverSalary = (): number => {
    return drivers.reduce((sum, driver) => sum + (driver.salaryPerDay ?? 0), 0);
  };

  const calculateDailyWarehouseCost = (): number => {
    return warehouses.reduce((sum, warehouse) => {
      const city = CITIES_BY_ID[warehouse.cityId];
      const modifier = city?.warehouseCostModifier ?? 1;
      const rent = warehouse.capacityTons * WAREHOUSE_RENT_PER_TON * modifier;
      const electricity = warehouse.capacityTons * WAREHOUSE_ELECTRICITY_PER_TON * modifier;
      const staff = WAREHOUSE_STAFF_COST_PER_LEVEL;
      return sum + rent + electricity + staff;
    }, 0);
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

  const totalRevenue = useMemo(calculateTotalRevenue, [contracts]);
  const tradeSummary = useMemo(() => summarizeFinanceLedger(financeLedger), [financeLedger]);
  const totalExpenses = useMemo(calculateTotalExpenses, [
    activeDeliveries,
    trucks,
    drivers,
    warehouses,
  ]);
  const netProfit = totalRevenue + tradeSummary.tradeSaleTotal - totalExpenses - tradeSummary.tradePurchaseTotal;
  const dailyFixedCosts = useMemo(
    () => calculateDailyDriverSalary() + calculateDailyWarehouseCost(),
    [drivers, warehouses],
  );
  const companyValue = useMemo(calculateCompanyValue, [trucks, warehouses, player?.reputation, cash]);

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
  const healthColor = getFinancialHealthColor(financialHealth);

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

  const topActiveDeliveries = useMemo(
    () => activeDeliveries.slice(0, MAX_ACTIVE_DELIVERIES),
    [activeDeliveries],
  );

  const showNetProfitHint = activeDeliveries.length > 0 && totalRevenue === 0;
  const showRevenueHint = totalRevenue === 0 && activeDeliveries.length > 0;

  const fuelCosts = calculateActiveFuelCosts();
  const maintenanceCosts = calculateMaintenanceExposure();
  const driverSalaries = calculateDailyDriverSalary();
  const warehouseCosts = calculateDailyWarehouseCost();

  if (!player) {
    return (
      <View style={styles.root}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
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
        <SummaryCard
          cash={cash}
          netProfit={netProfit}
          dailyFixedCosts={dailyFixedCosts}
          companyValue={companyValue}
          showNetProfitHint={showNetProfitHint}
        />

        <View style={styles.breakdownSection}>
          <Text style={styles.sectionTitle}>Şirket İlerlemesi</Text>
          <View style={styles.breakdownCard}>
            <BreakdownRow
              label="Seviye"
              value={`Level ${player.level ?? player.companyLevel ?? 1}`}
              color={COLORS.primary}
            />
            <BreakdownRow
              label="Toplam XP"
              value={`${levelProgress?.totalXp ?? 0}`}
              color={COLORS.secondary}
            />
            <BreakdownRow
              label="Tamamlanan sözleşme"
              value={`${player.completedContracts}`}
              color={COLORS.textPrimary}
            />
            <BreakdownRow label="Kamyon" value={`${trucks.length}`} color={COLORS.textPrimary} />
            <BreakdownRow label="Depo" value={`${warehouses.length}`} color={COLORS.textPrimary} />
            <BreakdownRow
              label="İtibar"
              value={`${Math.round(player.reputation)}/100`}
              color={COLORS.success}
              isLast
            />
          </View>
        </View>

        <View style={styles.breakdownSection}>
          <Text style={styles.sectionTitle}>Gelir Dağılımı</Text>
          {showRevenueHint ? (
            <Text style={styles.sectionHint}>Gelirler teslimat tamamlandığında işlenir.</Text>
          ) : null}
          <View style={styles.breakdownCard}>
            <BreakdownRow label="Sözleşme gelirleri" value={formatMoney(totalRevenue)} color={COLORS.success} />
            <BreakdownRow
              label="Ticaret satışları"
              value={formatMoney(tradeSummary.tradeSaleTotal)}
              color={COLORS.success}
            />
            <BreakdownRow label="Teslimat bonusları (yakında)" value={formatMoney(0)} color={COLORS.textMuted} />
            <BreakdownRow
              label="Ticaret kârı"
              value={formatMoney(tradeSummary.tradeNetProfit)}
              color={tradeSummary.tradeNetProfit >= 0 ? COLORS.success : COLORS.danger}
              isLast
            />
          </View>
        </View>

        <View style={styles.breakdownSection}>
          <Text style={styles.sectionTitle}>Gider Dağılımı</Text>
          <View style={styles.breakdownCard}>
            <BreakdownRow label="Yakıt giderleri" value={formatMoney(fuelCosts)} color={COLORS.danger} />
            <BreakdownRow
              label="Bakım giderleri"
              value={formatMoney(maintenanceCosts)}
              color={COLORS.danger}
            />
            <BreakdownRow label="Şoför maaşları" value={formatMoney(driverSalaries)} color={COLORS.danger} />
            <BreakdownRow label="Depo giderleri" value={formatMoney(warehouseCosts)} color={COLORS.danger} />
            <BreakdownRow
              label="Ürün alımları"
              value={formatMoney(tradeSummary.tradePurchaseTotal)}
              color={COLORS.danger}
            />
            <BreakdownRow label="Gecikme cezaları (yakında)" value={formatMoney(0)} color={COLORS.textMuted} />
            <BreakdownRow
              label="Başarısız teslimat cezaları (yakında)"
              value={formatMoney(0)}
              color={COLORS.textMuted}
              isLast
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Aktif Teslimat Kârlılığı ({activeDeliveries.length})
          </Text>
          {topActiveDeliveries.length === 0 ? (
            <Text style={styles.emptyText}>Şu an aktif teslimat yok.</Text>
          ) : (
            topActiveDeliveries.map((delivery) => {
              const contract = contracts.find((c) => c.id === delivery.contractId);
              const payment = contract?.payment ?? 0;
              const estimatedProfit =
                typeof delivery.estimatedProfit === 'number'
                  ? delivery.estimatedProfit
                  : payment - (delivery.fuelCost ?? 0);
              const profitMargin = payment > 0 ? estimatedProfit / payment : 0;
              const risk = getDeliveryRiskLabel(delivery);
              const statusColor = getDeliveryStatusColor(delivery.status);

              return (
                <View key={delivery.id} style={styles.itemCard}>
                  <View style={styles.itemHeaderRow}>
                    <Text style={styles.itemTitle}>
                      {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                    </Text>
                    <Text style={[styles.itemStatusBadge, { color: statusColor }]}>
                      {getDeliveryStatusLabel(delivery.status)}
                    </Text>
                  </View>
                  <Text style={styles.itemSubtext}>
                    {getProductName(delivery.productId)} · {formatTons(delivery.amount)}
                  </Text>
                  <View style={styles.deliveryStatsBlock}>
                    <Text style={styles.deliveryStat}>Ödeme: {formatMoney(payment)}</Text>
                    <Text style={styles.deliveryStat}>Yakıt: {formatMoney(delivery.fuelCost ?? 0)}</Text>
                    <Text
                      style={[
                        styles.deliveryStat,
                        { color: estimatedProfit >= 0 ? COLORS.success : COLORS.danger },
                      ]}
                    >
                      Tahmini net: {formatMoney(estimatedProfit)}
                    </Text>
                    <Text style={styles.deliveryStat}>Kâr marjı: {formatPercent(profitMargin)}</Text>
                    <Text style={[styles.deliveryStat, { color: risk.color }]}>Risk: {risk.label}</Text>
                  </View>
                  {profitMargin > HIGH_PROFIT_MARGIN ? (
                    <Text style={styles.profitNote}>Bu iş oldukça kârlı görünüyor.</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finansal Sağlık</Text>
          <View style={[styles.healthCard, { borderColor: healthColor }]}>
            <View style={styles.healthHeaderRow}>
              <Text style={[styles.healthScore, { color: healthColor }]}>{Math.round(financialHealth)}</Text>
              <Text style={[styles.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
            </View>
            <ProgressBar progress={financialHealth / 100} color={healthColor} />
            <Text style={styles.healthHint}>
              Nakit rezervi, sabit giderler, filo kondisyonu ve sözleşme geçmişine göre hesaplanır.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finans Uyarıları</Text>
          {alerts.length === 0 ? (
            <Text style={styles.emptyText}>Finansal durum normal görünüyor.</Text>
          ) : (
            alerts.map((alert, index) => (
              <View key={index} style={styles.alertRow}>
                <Text style={styles.alertBullet}>⚠</Text>
                <Text style={styles.alertText}>{alert}</Text>
              </View>
            ))
          )}
        </View>
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

  summaryWrapper: {
    marginBottom: 14,
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 12,
  },
  summaryHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 16,
    fontStyle: 'italic',
  },

  section: {
    marginBottom: 14,
  },
  breakdownSection: {
    marginBottom: 14,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 16,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },

  breakdownCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  breakdownRowLast: {
    borderBottomWidth: 0,
  },
  breakdownLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  breakdownValue: {
    fontSize: 12,
    fontWeight: '700',
  },

  itemCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    marginRight: 8,
  },
  itemStatusBadge: {
    fontSize: 10,
    fontWeight: '800',
  },
  itemSubtext: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 4,
  },
  deliveryStatsBlock: {
    marginTop: 10,
    gap: 4,
  },
  deliveryStat: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  profitNote: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 8,
    fontStyle: 'italic',
  },

  healthCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    marginBottom: 0,
  },
  healthHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  healthScore: {
    fontSize: 28,
    fontWeight: '800',
  },
  healthLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  healthHint: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 16,
  },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  alertRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertBullet: {
    color: COLORS.primary,
    fontSize: 13,
    marginRight: 8,
  },
  alertText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
});
