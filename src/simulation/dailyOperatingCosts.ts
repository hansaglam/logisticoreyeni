/**
 * Günlük operasyon giderleri — şoför maaşları, depo, genel operasyon.
 */

import {
  operatingCostBalance,
  timeBalance,
  warehouseBalance,
} from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import type {
  Driver,
  FinanceLedgerEntry,
  Player,
  Truck,
  Warehouse,
} from '../types/game';

export interface DailyOperatingCostBreakdown {
  driverSalaries: number;
  warehouseOperating: number;
  truckRental: number;
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
  if (warehouse.dailyOperatingCost != null && warehouse.dailyOperatingCost > 0) {
    return warehouse.dailyOperatingCost;
  }

  const city = CITIES_BY_ID[warehouse.cityId];
  const modifier = city?.warehouseCostModifier ?? 1;
  const tier = warehouse.upgradeTier ?? 1;
  const capacity = warehouse.capacityTons ?? warehouse.capacityTon ?? 80;

  const rent = capacity * warehouseBalance.rentPerTon * modifier;
  const electricity = capacity * warehouseBalance.electricityPerTon * modifier;
  const staff = warehouseBalance.staffCostPerLevel * tier;

  const computed = Math.round(rent + electricity + staff);
  return computed > 0 ? computed : operatingCostBalance.fallbackWarehouseDailyCost;
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

  const truckRental = 0;

  const ownedTruckCount = (player.trucks ?? []).filter(
    (truck) => (truck.ownershipType ?? 'owned') === 'owned' && !truck.leaseExpired,
  ).length;
  const driverCount = player.drivers?.length ?? 0;

  const operations =
    operatingCostBalance.dailyOperationsBase +
    ownedTruckCount * operatingCostBalance.operationsPerOwnedTruck +
    driverCount * operatingCostBalance.operationsPerDriver;

  const total = driverSalaries + warehouseOperating + truckRental + operations;

  return {
    driverSalaries,
    warehouseOperating,
    truckRental,
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

export function summarizeDailyOperatingCostsFromLedger(
  entries: FinanceLedgerEntry[] | undefined,
): DailyOperatingCostBreakdown {
  let driverSalaries = 0;
  let warehouseOperating = 0;
  let truckRental = 0;
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
        truckRental += entry.amount;
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
    total = driverSalaries + warehouseOperating + truckRental + operations;
  }

  return { driverSalaries, warehouseOperating, truckRental, operations, total };
}

export interface ExpiredLeaseResult {
  trucks: Truck[];
  expiredTruckNames: string[];
}

/** Kira süresi dolmuş boşta kamyonları pasifleştirir */
export function processExpiredTruckLeases(
  trucks: Truck[],
  currentTime: number,
): ExpiredLeaseResult {
  const expiredTruckNames: string[] = [];

  const updatedTrucks = trucks.map((truck) => {
    if ((truck.ownershipType ?? 'owned') !== 'leased') {
      return truck;
    }
    if (truck.leaseExpired) {
      return truck;
    }
    if (truck.leaseExpiresAt == null) {
      return truck;
    }
    if (truck.leaseExpiresAt > currentTime) {
      return truck;
    }
    if (truck.status !== 'idle') {
      return truck;
    }

    expiredTruckNames.push(truck.name);
    return {
      ...truck,
      leaseExpired: true,
    };
  });

  return { trucks: updatedTrucks, expiredTruckNames };
}

export function getWeeklyLeaseBurden(trucks: Truck[]): number {
  return trucks.reduce((sum, truck) => {
    if ((truck.ownershipType ?? 'owned') !== 'leased' || truck.leaseExpired) {
      return sum;
    }
    if (truck.leasePeriod === 'weekly' && truck.leaseDailyCost != null) {
      return sum + truck.leaseDailyCost * timeBalance.daysPerWeek;
    }
    return sum;
  }, 0);
}
