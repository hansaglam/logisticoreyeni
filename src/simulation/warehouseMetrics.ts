/**
 * Depo performans metrikleri — sahte değer üretmez.
 * Desteklenmeyen alanlar undefined bırakılır.
 */

import { timeBalance } from '../config/balance';
import type {
  City,
  FinanceLedgerEntry,
  Warehouse,
  WarehouseInventoryItem,
} from '../types/game';
import { getCityProductMarketPrice, normalizeWarehouse } from './trading';
import {
  calculateWarehouseDailyOperatingCost,
  getWarehouseCapacityTons,
} from '../utils/warehouseCalculations';

export interface WarehouseMetrics {
  usedCapacityTons: number;
  totalCapacityTons: number;
  occupancyPercent: number;
  inventoryValue: number;
  unrealizedProfit: number;
  /** financeLedger trade_sale meta.profit özetinden — yoksa undefined */
  realizedProfit7d?: number;
  dailyOperatingCost: number;
  /** realizedProfit7d − (dailyCost × 7) — realized yoksa undefined */
  netPerformance7d?: number;
  productTypeCount: number;
}

function sumInventoryCost(inventory: WarehouseInventoryItem[]): number {
  return inventory.reduce((sum, item) => {
    const qty = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    const avg = Number.isFinite(item.averageBuyPrice) ? Math.max(0, item.averageBuyPrice) : 0;
    return sum + qty * avg;
  }, 0);
}

function sumInventoryMarketValue(
  inventory: WarehouseInventoryItem[],
  city: City | undefined,
): number {
  if (!city) {
    return 0;
  }
  return inventory.reduce((sum, item) => {
    const qty = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    const market = getCityProductMarketPrice(city, item.productId);
    return sum + qty * Math.max(0, market);
  }, 0);
}

/** Son 7 oyun günündeki trade_sale net kâr toplamı (meta.profit). Yoksa undefined. */
export function sumRealizedTradeProfitFromLedger(
  entries: FinanceLedgerEntry[] | undefined,
  currentTime: number,
  windowDays = 7,
): number | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }

  const windowHours = windowDays * timeBalance.hoursPerDay;
  const cutoff = currentTime - windowHours;
  let found = false;
  let total = 0;

  for (const entry of entries) {
    if (
      entry.type !== 'income' ||
      (entry.category !== 'trade_sale' && entry.category !== 'market_sale')
    ) {
      continue;
    }
    if (entry.time < cutoff) {
      continue;
    }
    found = true;
    const metaProfit = (entry.meta as { profit?: number } | undefined)?.profit;
    if (typeof metaProfit === 'number' && Number.isFinite(metaProfit)) {
      total += metaProfit;
    } else {
      // meta yoksa gelir tutarını kâr gibi sayma — maliyet bilinmiyor
      continue;
    }
  }

  return found ? total : undefined;
}

export function getWarehouseMetrics(
  warehouse: Warehouse,
  city?: City,
  options?: {
    financeLedger?: FinanceLedgerEntry[];
    currentTime?: number;
  },
): WarehouseMetrics {
  const normalized = normalizeWarehouse(warehouse, options?.currentTime ?? 0);
  const inventory = normalized.inventory ?? [];
  const usedCapacityTons = inventory.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const totalCapacityTons = getWarehouseCapacityTons(normalized);
  const occupancyPercent =
    totalCapacityTons > 0
      ? Math.min(100, Math.max(0, (usedCapacityTons / totalCapacityTons) * 100))
      : 0;

  const inventoryValue = sumInventoryMarketValue(inventory, city);
  const inventoryCost = sumInventoryCost(inventory);
  const unrealizedProfit = inventoryValue - inventoryCost;
  const dailyOperatingCost = calculateWarehouseDailyOperatingCost(normalized, city);

  const realizedProfit7d =
    options?.financeLedger != null && options.currentTime != null
      ? sumRealizedTradeProfitFromLedger(options.financeLedger, options.currentTime, 7)
      : undefined;

  const netPerformance7d =
    realizedProfit7d != null ? realizedProfit7d - dailyOperatingCost * 7 : undefined;

  const productTypeCount = inventory.filter((item) => item.quantity > 0).length;

  return {
    usedCapacityTons,
    totalCapacityTons,
    occupancyPercent,
    inventoryValue,
    unrealizedProfit,
    realizedProfit7d,
    dailyOperatingCost,
    netPerformance7d,
    productTypeCount,
  };
}
