/**
 * Finans özeti — financeTotals birincil kaynak; ledger son hareketler ve fallback için.
 * Tüm fonksiyonlar pure; React/store bağımlılığı yok.
 */

import { financeBalance } from '../config/balance';
import {
  calculateDailyOperatingCostBreakdown,
  getWeeklyLeaseBurden,
} from '../simulation/dailyOperatingCosts';
import { getCityProductMarketPrice, normalizeWarehouse } from '../simulation/trading';
import type {
  City,
  Contract,
  Delivery,
  Driver,
  FinanceLedgerCategory,
  FinanceLedgerEntry,
  FinanceTotals,
  Truck,
  Warehouse,
} from '../types/game';
import { getCityByIdSafe } from './entityLookup';
import {
  normalizeFinanceLedgerCategory,
  normalizeLedgerAmount,
} from './financeLedger';

const MAINTENANCE_RISK_FACTOR = financeBalance.maintenanceRiskFactor;
const DEFAULT_RECENT_ENTRIES = 5;

const CATEGORY_LABELS: Partial<Record<FinanceLedgerCategory, string>> = {
  contract_income: 'Sözleşme Geliri',
  delivery_income: 'Sözleşme Geliri',
  trade_sale: 'Ticaret Geliri',
  bonus: 'Bonus',
  other_income: 'Diğer Gelir',
  fuel: 'Yakıt',
  delivery_expense: 'Yakıt',
  maintenance: 'Bakım',
  penalty: 'Ceza',
  trade_purchase: 'Ürün Alımı',
  driver_salary: 'Şoför Maaşı',
  warehouse_operating: 'Depo Gideri',
  warehouse_rent: 'Depo Gideri',
  daily_operating_cost: 'İşletme Giderleri',
  operations: 'İşletme Giderleri',
  truck_lease: 'Kamyon Kirası',
  truck_rental: 'Kamyon Kirası',
  truck_purchase: 'Kamyon Alımı',
  fleet_purchase: 'Kamyon Alımı',
  driver_hire: 'Şoför İşe Alım',
  warehouse_open: 'Depo Açılışı',
  truck_transfer: 'Kamyon Transferi',
  other_expense: 'Diğer Gider',
  other: 'Diğer Gider',
};

export type FinanceSummarySource = 'totals' | 'ledger' | 'fallback';

export interface DailyOperatingCostSummary {
  driverSalaryTotal: number;
  warehouseOperatingTotal: number;
  chargedTruckLeaseTotal: number;
  generalOperationsTotal: number;
  total: number;
}

export interface CalculateFinanceSummaryInput {
  financeLedger?: FinanceLedgerEntry[];
  financeTotals?: FinanceTotals;
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  trucks?: Truck[];
  drivers?: Driver[];
  warehouses?: Warehouse[];
  recentEntryLimit?: number;
}

export interface FinanceSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  recentEntries: FinanceLedgerEntry[];
  source: FinanceSummarySource;
  tradePurchaseTotal: number;
  tradeSaleTotal: number;
  tradeNetProfit: number;
  dailyOperatingCost: DailyOperatingCostSummary;
  weeklyLeaseBurden: number;
}

/** @deprecated CalculateFinanceSummaryInput kullanın */
export interface FinanceSummaryFallbackState {
  contracts?: Contract[];
  activeDeliveries?: Delivery[];
  trucks?: Truck[];
  drivers?: Driver[];
  warehouses?: Warehouse[];
}

export function normalizeFinanceCategory(
  category: FinanceLedgerCategory | string | undefined,
  type: FinanceLedgerEntry['type'] = 'expense',
): FinanceLedgerCategory {
  return normalizeFinanceLedgerCategory(category, type);
}

export function getFinanceCategoryLabel(
  category: FinanceLedgerCategory | string | undefined,
  type: FinanceLedgerEntry['type'],
): string {
  return getLedgerCategoryLabel(category, type);
}

export function getLedgerCategoryLabel(
  category: FinanceLedgerCategory | string | undefined,
  type: FinanceLedgerEntry['type'],
): string {
  if (!category) {
    return type === 'income' ? 'Diğer Gelir' : 'Diğer Gider';
  }

  const normalized = normalizeFinanceCategory(category, type);
  return CATEGORY_LABELS[normalized] ?? CATEGORY_LABELS[category as FinanceLedgerCategory] ?? 'Diğer';
}

export function groupLedgerByCategory(entries: FinanceLedgerEntry[] | undefined): {
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
} {
  const grouped = aggregateLedgerEntries(entries ?? []);
  return {
    incomeByCategory: grouped.incomeByCategory,
    expenseByCategory: grouped.expenseByCategory,
  };
}

export function calculateDailyOperatingCostSummary(
  drivers: Driver[] | undefined,
  warehouses: Warehouse[] | undefined,
  trucks: Truck[] | undefined,
): DailyOperatingCostSummary {
  const breakdown = calculateDailyOperatingCostBreakdown({
    drivers: drivers ?? [],
    warehouses: warehouses ?? [],
    trucks: trucks ?? [],
  });

  return {
    driverSalaryTotal: breakdown.driverSalaries,
    warehouseOperatingTotal: breakdown.warehouseOperating,
    chargedTruckLeaseTotal: breakdown.chargedTruckLeaseTotal,
    generalOperationsTotal: breakdown.operations,
    total: breakdown.total,
  };
}

export function calculateInventoryStockValue(
  warehouses: Warehouse[] | undefined,
  cities?: City[],
): number {
  const cityById = new Map((cities ?? []).map((city) => [city.id, city]));
  let total = 0;

  for (const warehouse of warehouses ?? []) {
    const city = cityById.get(warehouse.cityId) ?? getCityByIdSafe(warehouse.cityId);
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

export function calculateAverageTruckCondition(trucks: Truck[] | undefined): number {
  const list = trucks ?? [];
  if (list.length === 0) return 0;
  const sum = list.reduce((acc, truck) => acc + (truck.condition ?? 0), 0);
  return sum / list.length;
}

export function sumCategoriesExcept(
  map: Record<string, number>,
  exclude: string[],
): number {
  return Object.entries(map).reduce((sum, [label, amount]) => {
    if (exclude.includes(label)) {
      return sum;
    }
    return sum + amount;
  }, 0);
}

function addToCategoryMap(
  map: Record<string, number>,
  label: string,
  amount: number,
): void {
  if (amount <= 0) {
    return;
  }
  map[label] = (map[label] ?? 0) + amount;
}

function sumCategoryMap(map: Record<string, number>): number {
  return Object.values(map).reduce((sum, value) => sum + value, 0);
}

function totalsToDisplayMaps(totals: FinanceTotals): Pick<
  FinanceSummary,
  'totalRevenue' | 'totalExpenses' | 'netProfit' | 'incomeByCategory' | 'expenseByCategory' | 'tradePurchaseTotal' | 'tradeSaleTotal' | 'tradeNetProfit'
> {
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  for (const [category, amount] of Object.entries(totals.incomeByCategory ?? {})) {
    addToCategoryMap(incomeByCategory, getLedgerCategoryLabel(category, 'income'), amount);
  }

  for (const [category, amount] of Object.entries(totals.expenseByCategory ?? {})) {
    addToCategoryMap(expenseByCategory, getLedgerCategoryLabel(category, 'expense'), amount);
  }

  const totalRevenue = Number.isFinite(totals.totalIncome)
    ? totals.totalIncome
    : sumCategoryMap(incomeByCategory);
  const totalExpenses = Number.isFinite(totals.totalExpense)
    ? totals.totalExpense
    : sumCategoryMap(expenseByCategory);
  const netProfit = Number.isFinite(totals.netProfit)
    ? totals.netProfit
    : totalRevenue - totalExpenses;

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    incomeByCategory,
    expenseByCategory,
    tradePurchaseTotal: expenseByCategory['Ürün Alımı'] ?? 0,
    tradeSaleTotal: incomeByCategory['Ticaret Geliri'] ?? 0,
    tradeNetProfit:
      (incomeByCategory['Ticaret Geliri'] ?? 0) - (expenseByCategory['Ürün Alımı'] ?? 0),
  };
}

function aggregateLedgerEntries(entries: FinanceLedgerEntry[]): Pick<
  FinanceSummary,
  'totalRevenue' | 'totalExpenses' | 'netProfit' | 'incomeByCategory' | 'expenseByCategory' | 'tradePurchaseTotal' | 'tradeSaleTotal' | 'tradeNetProfit'
> {
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  for (const entry of entries) {
    const amount = normalizeLedgerAmount(entry.amount);
    if (amount <= 0) {
      continue;
    }

    const label = getLedgerCategoryLabel(entry.category, entry.type);
    if (entry.type === 'income') {
      addToCategoryMap(incomeByCategory, label, amount);
    } else if (entry.type === 'expense') {
      addToCategoryMap(expenseByCategory, label, amount);
    }
  }

  const totalRevenue = sumCategoryMap(incomeByCategory);
  const totalExpenses = sumCategoryMap(expenseByCategory);

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    incomeByCategory,
    expenseByCategory,
    tradePurchaseTotal: expenseByCategory['Ürün Alımı'] ?? 0,
    tradeSaleTotal: incomeByCategory['Ticaret Geliri'] ?? 0,
    tradeNetProfit:
      (incomeByCategory['Ticaret Geliri'] ?? 0) - (expenseByCategory['Ürün Alımı'] ?? 0),
  };
}

function estimateMaintenanceExposure(trucks: Truck[]): number {
  return trucks.reduce((sum, truck) => {
    const missingCondition = Math.max(0, 100 - (truck.condition ?? 100));
    const maintenanceCost = truck.maintenanceCost ?? 0;
    return sum + missingCondition * maintenanceCost * MAINTENANCE_RISK_FACTOR;
  }, 0);
}

function calculateFallbackSummary(input: CalculateFinanceSummaryInput): Pick<
  FinanceSummary,
  'totalRevenue' | 'totalExpenses' | 'netProfit' | 'incomeByCategory' | 'expenseByCategory' | 'tradePurchaseTotal' | 'tradeSaleTotal' | 'tradeNetProfit'
> {
  const contracts = input.contracts ?? [];
  const activeDeliveries = input.activeDeliveries ?? [];
  const trucks = input.trucks ?? [];
  const drivers = input.drivers ?? [];
  const warehouses = input.warehouses ?? [];

  const contractRevenue = contracts
    .filter((contract) => contract.status === 'completed')
    .reduce((sum, contract) => sum + (contract.payment ?? 0), 0);

  const fuelEstimate = activeDeliveries.reduce(
    (sum, delivery) => sum + (delivery.fuelCost ?? 0),
    0,
  );
  const maintenanceEstimate = estimateMaintenanceExposure(trucks);
  const dailyOperating = calculateDailyOperatingCostSummary(drivers, warehouses, trucks);

  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  addToCategoryMap(incomeByCategory, 'Sözleşme Geliri', contractRevenue);
  addToCategoryMap(expenseByCategory, 'Yakıt', fuelEstimate);
  addToCategoryMap(expenseByCategory, 'Bakım', maintenanceEstimate);
  addToCategoryMap(expenseByCategory, 'Şoför Maaşı', dailyOperating.driverSalaryTotal);
  addToCategoryMap(expenseByCategory, 'Depo Gideri', dailyOperating.warehouseOperatingTotal);

  const totalRevenue = sumCategoryMap(incomeByCategory);
  const totalExpenses = sumCategoryMap(expenseByCategory);

  return {
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    incomeByCategory,
    expenseByCategory,
    tradePurchaseTotal: 0,
    tradeSaleTotal: 0,
    tradeNetProfit: 0,
  };
}

function buildDailyOperatingSections(
  input: CalculateFinanceSummaryInput,
): Pick<FinanceSummary, 'dailyOperatingCost' | 'weeklyLeaseBurden'> {
  const trucks = input.trucks ?? [];
  return {
    dailyOperatingCost: calculateDailyOperatingCostSummary(
      input.drivers,
      input.warehouses,
      trucks,
    ),
    weeklyLeaseBurden: getWeeklyLeaseBurden(trucks),
  };
}

export function calculateFinanceSummary(input: CalculateFinanceSummaryInput): FinanceSummary {
  const entries = input.financeLedger ?? [];
  const recentEntryLimit = input.recentEntryLimit ?? DEFAULT_RECENT_ENTRIES;
  const recentEntries = entries.slice(0, recentEntryLimit);
  const operatingSections = buildDailyOperatingSections(input);

  if (input.financeTotals) {
    return {
      ...totalsToDisplayMaps(input.financeTotals),
      recentEntries,
      source: 'totals',
      ...operatingSections,
    };
  }

  if (entries.length > 0) {
    return {
      ...aggregateLedgerEntries(entries),
      recentEntries,
      source: 'ledger',
      ...operatingSections,
    };
  }

  return {
    ...calculateFallbackSummary(input),
    recentEntries,
    source: 'fallback',
    ...operatingSections,
  };
}

export interface CalculateFinancialHealthInput {
  cash: number;
  netProfit: number;
  dailyFixedCosts: number;
  trucks: Truck[];
  contracts: Contract[];
  activeDeliveryCount: number;
  availableContractCount: number;
  idleTruckCount: number;
  fixedCostWarnRatio?: number;
  fixedCostHighRatio?: number;
}

export function calculateFinancialHealthScore(input: CalculateFinancialHealthInput): number {
  const {
    cash,
    netProfit,
    dailyFixedCosts,
    trucks,
    contracts,
    activeDeliveryCount,
    availableContractCount,
    idleTruckCount,
    fixedCostWarnRatio = financeBalance.fixedCostWarnRatio ?? 0.15,
    fixedCostHighRatio = financeBalance.fixedCostHighRatio ?? 0.25,
  } = input;

  let score = 100;
  const averageCondition = calculateAverageTruckCondition(trucks);
  const hasFailedContract = contracts.some((contract) => contract.status === 'failed');

  if (cash < financeBalance.lowCashThreshold) {
    score -= financeBalance.healthPenaltyLowCash;
  }
  if (netProfit < 0) {
    score -= financeBalance.healthPenaltyNegativeProfit;
  }
  if (cash > 0 && dailyFixedCosts > cash * fixedCostWarnRatio) {
    score -= financeBalance.healthPenaltyHighFixedCosts;
  }
  if (cash > 0 && dailyFixedCosts > cash * fixedCostHighRatio) {
    score -= financeBalance.healthPenaltyHighFixedCosts;
  }
  if (activeDeliveryCount === 0 && availableContractCount === 0) {
    score -= 10;
  }
  if (trucks.length > 0 && averageCondition < financeBalance.truckConditionThreshold) {
    score -= financeBalance.healthPenaltyLowTruckCondition;
  }
  if (idleTruckCount === 0 && activeDeliveryCount > 0) {
    score -= 5;
  }
  if (hasFailedContract) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

export interface CalculateFinanceAlertsInput {
  cash: number;
  dailyFixedCosts: number;
  fuelPrice: number;
  baselineFuelPrice: number;
  fuelPriceSpikeRatio: number;
  fixedCostWarnRatio: number;
  trucks: Truck[];
  idleTruckCount: number;
  activeDeliveryCount: number;
  maintenanceWarningCondition: number;
  maxAlerts?: number;
}

export function calculateFinanceAlerts(input: CalculateFinanceAlertsInput): string[] {
  const {
    cash,
    dailyFixedCosts,
    fuelPrice,
    baselineFuelPrice,
    fuelPriceSpikeRatio,
    fixedCostWarnRatio,
    trucks,
    idleTruckCount,
    activeDeliveryCount,
    maintenanceWarningCondition,
    maxAlerts = 3,
  } = input;

  const alerts: string[] = [];

  if (idleTruckCount === 0 && trucks.length > 0 && activeDeliveryCount > 0) {
    alerts.push(
      'Boşta kamyonun yok. Yeni iş almak için teslimatın bitmesini bekle veya yeni kamyon satın al.',
    );
  }
  if (cash > 0 && dailyFixedCosts > cash * fixedCostWarnRatio) {
    alerts.push('Sabit giderler nakit rezervine göre yüksek.');
  }
  if (fuelPrice > baselineFuelPrice * fuelPriceSpikeRatio) {
    alerts.push('Yakıt giderleri artıyor. Uzun rotalarda kâr düşebilir.');
  }
  if (trucks.some((truck) => (truck.condition ?? 100) < maintenanceWarningCondition)) {
    alerts.push('Bazı kamyonların bakıma ihtiyacı olabilir.');
  }

  return alerts.slice(0, maxAlerts);
}

export function getCategoryAmount(
  map: Record<string, number>,
  label: string,
): number {
  return map[label] ?? 0;
}

export { normalizeLedgerAmount };
