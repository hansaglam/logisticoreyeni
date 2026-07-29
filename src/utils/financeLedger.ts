/**
 * Finans defteri yardımcıları — kategori normalizasyonu, kümülatif toplamlar, ledger limiti.
 */

import type {
  FinanceLedgerBreakdown,
  FinanceLedgerCategory,
  FinanceLedgerEntry,
  FinanceTotals,
} from '../types/game';

export const FINANCE_LEDGER_MAX_COUNT = 200;

const CATEGORY_ALIASES: Record<string, FinanceLedgerCategory> = {
  contract_revenue: 'contract_revenue',
  contract: 'contract_income',
  delivery_income: 'contract_income',
  contract_income: 'contract_income',
  market_sale: 'market_sale',
  trade_sale: 'trade_sale',
  bonus: 'bonus',
  reward: 'reward',
  recovery_assistance: 'recovery_assistance',
  other_income: 'other_income',
  fuel_purchase: 'fuel_purchase',
  roadside_fuel: 'roadside_fuel',
  fuel: 'fuel',
  delivery_expense: 'fuel',
  maintenance: 'maintenance',
  penalty: 'penalty',
  market_purchase: 'market_purchase',
  trade_purchase: 'trade_purchase',
  driver_salary: 'driver_salary',
  warehouse_cost: 'warehouse_cost',
  warehouse_rent: 'warehouse_operating',
  warehouse_operating: 'warehouse_operating',
  truck_rental: 'truck_lease',
  truck_lease: 'truck_lease',
  daily_operating_cost: 'daily_operating_cost',
  operations: 'daily_operating_cost',
  vehicle_purchase: 'vehicle_purchase',
  vehicle_sale: 'vehicle_sale',
  fleet_purchase: 'truck_purchase',
  truck_purchase: 'truck_purchase',
  truck_sale: 'truck_sale',
  driver_hire: 'driver_hire',
  driver_severance: 'driver_severance',
  warehouse_open: 'warehouse_open',
  truck_transfer: 'other_expense',
  other_expense: 'other_expense',
  other: 'other_expense',
};

export function createEmptyFinanceTotals(): FinanceTotals {
  return {
    totalIncome: 0,
    totalExpense: 0,
    netProfit: 0,
    incomeByCategory: {},
    expenseByCategory: {},
  };
}

export function createLedgerId(suffix?: string): string {
  const token = suffix ?? Math.random().toString(36).slice(2, 8);
  return `ledger_${Date.now()}_${token}`;
}

export function normalizeLedgerAmount(amount: number | undefined): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.abs(value);
}

export function normalizeFinanceLedgerCategory(
  category: FinanceLedgerCategory | string | undefined,
  type: FinanceLedgerEntry['type'] = 'expense',
): FinanceLedgerCategory {
  if (!category) {
    return type === 'income' ? 'other_income' : 'other_expense';
  }

  const mapped = CATEGORY_ALIASES[category];
  if (mapped) {
    return mapped;
  }

  return type === 'income' ? 'other_income' : 'other_expense';
}

export function normalizeFinanceLedgerEntry(
  entry: Omit<FinanceLedgerEntry, 'id'> & { id?: string },
): Omit<FinanceLedgerEntry, 'id'> {
  const type = entry.type === 'income' ? 'income' : 'expense';
  return {
    ...entry,
    type,
    category: normalizeFinanceLedgerCategory(entry.category, type),
    amount: normalizeLedgerAmount(entry.amount),
  };
}

function addToCategoryMap(
  map: Record<string, number>,
  category: FinanceLedgerCategory,
  amount: number,
): void {
  if (amount <= 0) {
    return;
  }
  map[category] = (map[category] ?? 0) + amount;
}

export function applyFinanceLedgerEntryToTotals(
  totals: FinanceTotals,
  entry: Pick<FinanceLedgerEntry, 'type' | 'category' | 'amount'>,
): FinanceTotals {
  const amount = normalizeLedgerAmount(entry.amount);
  if (amount <= 0) {
    return totals;
  }

  const category = normalizeFinanceLedgerCategory(entry.category, entry.type);
  const incomeByCategory = { ...totals.incomeByCategory };
  const expenseByCategory = { ...totals.expenseByCategory };

  if (entry.type === 'income') {
    addToCategoryMap(incomeByCategory, category, amount);
  } else {
    addToCategoryMap(expenseByCategory, category, amount);
  }

  const totalIncome = Object.values(incomeByCategory).reduce((sum, value) => sum + value, 0);
  const totalExpense = Object.values(expenseByCategory).reduce((sum, value) => sum + value, 0);

  return {
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    incomeByCategory,
    expenseByCategory,
  };
}

export function computeFinanceTotalsFromLedger(
  ledger: FinanceLedgerEntry[] | undefined,
): FinanceTotals {
  let totals = createEmptyFinanceTotals();
  for (const entry of ledger ?? []) {
    totals = applyFinanceLedgerEntryToTotals(totals, entry);
  }
  return totals;
}

export function ensureFinanceTotals(
  ledger: FinanceLedgerEntry[] | undefined,
  totals: FinanceTotals | undefined,
): FinanceTotals {
  if (
    totals &&
    Number.isFinite(totals.totalIncome) &&
    Number.isFinite(totals.totalExpense) &&
    Number.isFinite(totals.netProfit)
  ) {
    return totals;
  }
  return computeFinanceTotalsFromLedger(ledger);
}

export function prependFinanceLedgerEntries(
  ledger: FinanceLedgerEntry[] | undefined,
  entries: Array<Omit<FinanceLedgerEntry, 'id'> & { id?: string }>,
  maxCount = FINANCE_LEDGER_MAX_COUNT,
): FinanceLedgerEntry[] {
  const normalizedEntries = entries.map((entry) => {
    const normalized = normalizeFinanceLedgerEntry(entry);
    return {
      ...normalized,
      id: entry.id ?? createLedgerId(),
    };
  });

  return [...normalizedEntries, ...(ledger ?? [])].slice(0, maxCount);
}

export function addFinanceLedgerEntry(
  ledger: FinanceLedgerEntry[] | undefined,
  totals: FinanceTotals | undefined,
  entry: Omit<FinanceLedgerEntry, 'id'> & { id?: string },
  maxCount = FINANCE_LEDGER_MAX_COUNT,
): { financeLedger: FinanceLedgerEntry[]; financeTotals: FinanceTotals } {
  return addFinanceLedgerEntries(ledger, totals, [entry], maxCount);
}

export function addFinanceLedgerEntries(
  ledger: FinanceLedgerEntry[] | undefined,
  totals: FinanceTotals | undefined,
  entries: Array<Omit<FinanceLedgerEntry, 'id'> & { id?: string }>,
  maxCount = FINANCE_LEDGER_MAX_COUNT,
): { financeLedger: FinanceLedgerEntry[]; financeTotals: FinanceTotals } {
  if (entries.length === 0) {
    return {
      financeLedger: ledger ?? [],
      financeTotals: ensureFinanceTotals(ledger, totals),
    };
  }

  let nextTotals = ensureFinanceTotals(ledger, totals);
  const normalizedEntries: FinanceLedgerEntry[] = [];
  const appliedTransactionIds = new Set(
    (ledger ?? [])
      .map((entry) => entry.transactionId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const appliedReferenceIds = new Set(
    (ledger ?? [])
      .map((entry) => entry.referenceId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const appliedLedgerIds = new Set((ledger ?? []).map((entry) => entry.id));

  for (const entry of entries) {
    const normalized = normalizeFinanceLedgerEntry(entry);
    const record: FinanceLedgerEntry = {
      ...normalized,
      id: entry.id ?? createLedgerId(),
    };
    if (
      appliedLedgerIds.has(record.id) ||
      (record.transactionId != null &&
        appliedTransactionIds.has(record.transactionId)) ||
      (record.referenceId != null &&
        appliedReferenceIds.has(record.referenceId))
    ) {
      continue;
    }
    normalizedEntries.push(record);
    appliedLedgerIds.add(record.id);
    if (record.transactionId) appliedTransactionIds.add(record.transactionId);
    if (record.referenceId) appliedReferenceIds.add(record.referenceId);
    nextTotals = applyFinanceLedgerEntryToTotals(nextTotals, record);
  }

  if (normalizedEntries.length === 0) {
    return {
      financeLedger: ledger ?? [],
      financeTotals: nextTotals,
    };
  }

  return {
    financeLedger: prependFinanceLedgerEntries(ledger, normalizedEntries, maxCount),
    financeTotals: nextTotals,
  };
}

export function hasFinanceLedgerTransaction(
  ledger: FinanceLedgerEntry[] | undefined,
  transactionId: string,
): boolean {
  return (ledger ?? []).some((entry) => entry.transactionId === transactionId);
}

export function hasDeliveryCompletionLedgerEntry(
  ledger: FinanceLedgerEntry[] | undefined,
  deliveryId: string,
): boolean {
  return (ledger ?? []).some((entry) => {
    if (entry.relatedDeliveryId !== deliveryId) {
      return false;
    }
    const category = normalizeFinanceLedgerCategory(entry.category, entry.type);
    return category === 'contract_income' || category === 'contract_revenue';
  });
}

export function formatDailyOperatingCostDescription(
  breakdown: FinanceLedgerBreakdown,
  chargedDays: number,
  leaseDailyAccrual = 0,
  elapsedDays?: number,
): string {
  const charged = Math.max(1, Math.floor(Number.isFinite(chargedDays) ? chargedDays : 1));
  const elapsed = Math.max(
    charged,
    Math.floor(Number.isFinite(elapsedDays ?? charged) ? (elapsedDays ?? charged) : charged),
  );
  const parts = [
    `Şoför: $${breakdown.driverSalary}`,
    `Depo: $${breakdown.warehouseOperating}`,
    `Operasyon: $${breakdown.generalOperations}`,
  ];

  if (leaseDailyAccrual > 0) {
    parts.push(`Kiralık kamyon günlük karşılık: $${leaseDailyAccrual * charged}`);
  }

  if (elapsed > charged) {
    return `${elapsed} gün geçti, ${charged} günlük sabit gider kesildi. ${parts.join(' · ')}`;
  }

  const dayLabel = charged === 1 ? '1 günlük' : `${charged} günlük`;
  return `${dayLabel} sabit gider işlendi. ${parts.join(' · ')}`;
}
