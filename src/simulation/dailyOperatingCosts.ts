/**
 * Günlük operasyon giderleri — şoför maaşları, depo, genel operasyon.
 *
 * Kiralık kamyon (V1): haftalık kira kiralama anında peşin tahsil edilir (truck_lease ledger).
 * leaseDailyCost yalnızca UI tahmini içindir; günlük cash kesintisine dahil edilmez.
 */

import { operatingCostBalance, timeBalance } from '../config/balance';
import {
  calculateWarehouseDailyOperatingCost,
} from '../utils/warehouseCalculations';
import type {
  Driver,
  FinanceLedgerBreakdown,
  FinanceLedgerEntry,
  Player,
  Truck,
  Warehouse,
} from '../types/game';
import { formatDailyOperatingCostDescription } from '../utils/financeLedger';
import {
  isRentalReturnPending,
  isRentalTruckReturned,
  processExpiredTruckLeases,
} from './rentalTruckLifecycle';

export { processExpiredTruckLeases };
export type { ExpiredLeaseResult } from './rentalTruckLifecycle';

export interface DailyOperatingCostBreakdown {
  driverSalaries: number;
  warehouseOperating: number;
  /** Bilgi amaçlı — aktif kiralık kamyonların günlük karşılığı; cash'ten kesilmez */
  truckLeaseDailyAccrual: number;
  /** Günlük işletme giderinde cash'ten kesilecek kira (V1: her zaman 0) */
  chargedTruckLeaseTotal: number;
  operations: number;
  total: number;
}

export function getDriverDailySalary(driver: Driver): number {
  return (
    driver.dailySalary ??
    driver.salaryPerDay ??
    operatingCostBalance.fallbackDriverDailySalary
  );
}

export function getWarehouseDailyOperatingCost(warehouse: Warehouse): number {
  return calculateWarehouseDailyOperatingCost(warehouse);
}

export function isActiveLeasedTruck(truck: Truck): boolean {
  if ((truck.ownershipType ?? 'owned') !== 'leased') {
    return false;
  }
  if (isRentalTruckReturned(truck)) {
    return false;
  }
  if (truck.leaseExpired && !isRentalReturnPending(truck)) {
    return false;
  }
  return true;
}

/** Aktif kiralık kamyonların günlük karşılık toplamı — yalnızca bilgi amaçlı */
export function getTruckLeaseDailyAccrual(trucks: Truck[] | undefined): number {
  return (trucks ?? []).reduce((sum, truck) => {
    if (!isActiveLeasedTruck(truck)) {
      return sum;
    }
    return sum + (truck.leaseDailyCost ?? 0);
  }, 0);
}

export function getTruckWeeklyLeaseCost(truck: Truck): number {
  if (!isActiveLeasedTruck(truck)) {
    return 0;
  }
  if (truck.leaseWeeklyCost != null && truck.leaseWeeklyCost > 0) {
    return truck.leaseWeeklyCost;
  }
  if (truck.leaseDailyCost != null && truck.leaseDailyCost > 0) {
    return truck.leaseDailyCost * timeBalance.daysPerWeek;
  }
  return 0;
}

/** Aktif kiralık kamyonların toplam haftalık kira yükü — peşin ödenmiş dönem için bilgi amaçlı */
export function getWeeklyLeaseBurden(trucks: Truck[] | undefined): number {
  return (trucks ?? []).reduce((sum, truck) => sum + getTruckWeeklyLeaseCost(truck), 0);
}

export function calculateDailyOperatingCostBreakdown(
  player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'>,
): DailyOperatingCostBreakdown {
  const driverSalaries = (player.drivers ?? []).reduce(
    (sum, driver) => sum + getDriverDailySalary(driver),
    0,
  );

  const warehouseOperating = (player.warehouses ?? []).reduce(
    (sum, warehouse) => sum + getWarehouseDailyOperatingCost(warehouse),
    0,
  );

  const truckLeaseDailyAccrual = getTruckLeaseDailyAccrual(player.trucks);
  const chargedTruckLeaseTotal = 0;

  const ownedTruckCount = (player.trucks ?? []).filter(
    (truck) => (truck.ownershipType ?? 'owned') === 'owned' && !truck.leaseExpired,
  ).length;
  const driverCount = player.drivers?.length ?? 0;

  const operations =
    operatingCostBalance.dailyOperationsBase +
    ownedTruckCount * operatingCostBalance.operationsPerOwnedTruck +
    driverCount * operatingCostBalance.operationsPerDriver;

  const total =
    driverSalaries + warehouseOperating + operations + chargedTruckLeaseTotal;

  return {
    driverSalaries,
    warehouseOperating,
    truckLeaseDailyAccrual,
    chargedTruckLeaseTotal,
    operations,
    total,
  };
}

export function buildDailyOperatingCostLedgerEntries(
  breakdown: DailyOperatingCostBreakdown,
  currentTime: number,
): Array<Omit<FinanceLedgerEntry, 'id'>> {
  if (breakdown.total <= 0) {
    return [];
  }

  const dayNumber = Math.floor(currentTime / timeBalance.hoursPerDay) + 1;
  const entries: Array<Omit<FinanceLedgerEntry, 'id'>> = [];

  if (breakdown.driverSalaries > 0) {
    entries.push({
      time: currentTime,
      type: 'expense',
      category: 'driver_salary',
      amount: breakdown.driverSalaries,
      description: `Gün ${dayNumber} · Şoför maaşları`,
    });
  }

  if (breakdown.warehouseOperating > 0) {
    entries.push({
      time: currentTime,
      type: 'expense',
      category: 'warehouse_rent',
      amount: breakdown.warehouseOperating,
      description: `Gün ${dayNumber} · Depo işletme`,
    });
  }

  if (breakdown.operations > 0) {
    entries.push({
      time: currentTime,
      type: 'expense',
      category: 'operations',
      amount: breakdown.operations,
      description: `Gün ${dayNumber} · Genel operasyon`,
    });
  }

  return entries;
}

export type DailyOperatingCostReason = 'daily_tick' | 'offline_catchup' | 'debug';

/** Tek özet ledger kaydı — çok günlük kesintilerde şişmeyi önler */
export function buildSummarizedDailyOperatingCostLedgerEntry(
  breakdown: DailyOperatingCostBreakdown,
  currentTime: number,
  days: number,
  elapsedDays?: number,
): Omit<FinanceLedgerEntry, 'id'> | null {
  const safeDays = Math.max(1, Math.floor(days));
  if (breakdown.total <= 0) {
    return null;
  }

  const totalCost = breakdown.total * safeDays;
  const ledgerBreakdown: FinanceLedgerBreakdown = {
    driverSalary: breakdown.driverSalaries * safeDays,
    warehouseOperating: breakdown.warehouseOperating * safeDays,
    generalOperations: breakdown.operations * safeDays,
    chargedTruckLease: breakdown.chargedTruckLeaseTotal * safeDays,
  };

  return {
    time: currentTime,
    type: 'expense',
    category: 'daily_operating_cost',
    amount: totalCost,
    title: safeDays === 1 ? 'Günlük işletme giderleri' : 'İşletme giderleri',
    description: formatDailyOperatingCostDescription(
      ledgerBreakdown,
      safeDays,
      breakdown.truckLeaseDailyAccrual,
      elapsedDays,
    ),
    breakdown: ledgerBreakdown,
  };
}

export function computeElapsedOperatingDays(
  lastDailyOperatingCostTime: number,
  newTime: number,
  hoursPerDay = timeBalance.hoursPerDay,
): number {
  const last = Number.isFinite(lastDailyOperatingCostTime) ? lastDailyOperatingCostTime : 0;
  const target = Number.isFinite(newTime) ? newTime : 0;
  if (target <= last) {
    return 0;
  }
  return Math.floor((target - last) / hoursPerDay);
}

export function normalizeOperatingCostDays(days: number): number {
  if (!Number.isFinite(days)) {
    return 0;
  }
  return Math.max(0, Math.floor(days));
}

export function resolveOperatingCostElapsedDays(
  elapsedDays: number | undefined,
  chargedDays: number,
): number {
  const charged = normalizeOperatingCostDays(chargedDays);
  const elapsed =
    elapsedDays != null ? normalizeOperatingCostDays(elapsedDays) : charged;
  return Math.max(charged, elapsed);
}

export function getSkippedOperatingDaysDueToCap(
  elapsedDays: number,
  chargedDays: number,
): number {
  const elapsed = normalizeOperatingCostDays(elapsedDays);
  const charged = Math.min(normalizeOperatingCostDays(chargedDays), elapsed);
  return Math.max(0, elapsed - charged);
}

export function formatOperatingCostNotificationMessage(
  params: {
    elapsedDays: number;
    chargedDays: number;
    amount: number;
  },
  formatAmount: (amount: number) => string,
): string {
  const elapsed = resolveOperatingCostElapsedDays(params.elapsedDays, params.chargedDays);
  const charged = Math.min(normalizeOperatingCostDays(params.chargedDays), elapsed);
  const safeAmount = Number.isFinite(params.amount) ? params.amount : 0;
  const amountText = formatAmount(safeAmount);

  if (charged <= 0) {
    return '';
  }

  if (elapsed > charged) {
    return `${elapsed} gün geçti. Oyuncu dostu limit nedeniyle yalnızca ${charged} günlük sabit gider kesildi: ${amountText}`;
  }

  const dayLabel = charged === 1 ? '1 günlük' : `${charged} günlük`;
  return `${dayLabel} sabit gider ödendi: ${amountText}`;
}

export function formatOperatingCostEventLogMessage(params: {
  elapsedDays: number;
  chargedDays: number;
}): string {
  const elapsed = resolveOperatingCostElapsedDays(params.elapsedDays, params.chargedDays);
  const charged = Math.min(normalizeOperatingCostDays(params.chargedDays), elapsed);

  if (charged <= 0) {
    return '';
  }

  if (elapsed > charged) {
    return `${elapsed} günlük zaman atlaması işlendi. Maksimum offline gider limiti nedeniyle ${charged} günlük gider kesildi.`;
  }

  const dayLabel = charged === 1 ? '1 günlük' : `${charged} günlük`;
  return `${dayLabel} işletme gideri işlendi.`;
}

export function summarizeDailyOperatingCostsFromLedger(
  entries: FinanceLedgerEntry[] | undefined,
): DailyOperatingCostBreakdown {
  let driverSalaries = 0;
  let warehouseOperating = 0;
  let chargedTruckLeaseTotal = 0;
  let operations = 0;
  let total = 0;

  for (const entry of entries ?? []) {
    if (entry.type !== 'expense') continue;
    switch (entry.category) {
      case 'driver_salary':
        driverSalaries += entry.amount;
        break;
      case 'warehouse_rent':
        warehouseOperating += entry.amount;
        break;
      case 'truck_rental':
        chargedTruckLeaseTotal += entry.amount;
        break;
      case 'operations':
        operations += entry.amount;
        break;
      case 'daily_operating_cost':
        total += entry.amount;
        break;
      default:
        break;
    }
  }

  if (total === 0) {
    total = driverSalaries + warehouseOperating + chargedTruckLeaseTotal + operations;
  }

  return {
    driverSalaries,
    warehouseOperating,
    truckLeaseDailyAccrual: 0,
    chargedTruckLeaseTotal,
    operations,
    total,
  };
}

