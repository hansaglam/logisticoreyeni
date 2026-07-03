/**
 * LogistiCore - Depo ticareti yardımcıları
 *
 * Envanter normalizasyonu, kapasite ve alım/satım hesapları.
 */

import { tradingBalance } from '../config/balance';
import { PRODUCT_BY_ID } from '../data/products';
import type {
  City,
  FinanceLedgerEntry,
  ProductId,
  Warehouse,
  WarehouseInventoryItem,
} from '../types/game';
import { toProductMarket } from './economy';

// TODO: Add warehouse-to-warehouse cargo transfer in V2.

export function getCityProductMarketPrice(city: City | undefined, productId: ProductId): number {
  if (!city?.products?.[productId]) {
    return 0;
  }
  return toProductMarket(city.products[productId]).currentPrice;
}

export function getCityProductStock(city: City | undefined, productId: ProductId): number {
  return city?.products?.[productId]?.stock ?? 0;
}

/** Eski storedProducts kayıtlarını inventory'ye dönüştürür */
export function normalizeWarehouseInventory(warehouse: Warehouse): WarehouseInventoryItem[] {
  if (warehouse.inventory && warehouse.inventory.length > 0) {
    return warehouse.inventory.map((item) => ({
      productId: item.productId,
      quantity: Math.max(0, item.quantity ?? 0),
      averageBuyPrice: Math.max(0, item.averageBuyPrice ?? 0),
    }));
  }

  const legacy = warehouse.storedProducts ?? {};
  return Object.entries(legacy)
    .filter(([, quantity]) => (quantity ?? 0) > 0)
    .map(([productId, quantity]) => ({
      productId: productId as ProductId,
      quantity: quantity ?? 0,
      averageBuyPrice: 0,
    }));
}

export function normalizeWarehouse(warehouse: Warehouse): Warehouse {
  const inventory = normalizeWarehouseInventory(warehouse);
  const usedCapacityTon = inventory.reduce((sum, item) => sum + item.quantity, 0);
  return {
    ...warehouse,
    inventory,
    usedCapacityTon,
    storedProducts: inventory.reduce<Partial<Record<ProductId, number>>>((acc, item) => {
      acc[item.productId] = item.quantity;
      return acc;
    }, {}),
  };
}

export function getWarehouseUsedCapacityTon(warehouse: Warehouse): number {
  if (typeof warehouse.usedCapacityTon === 'number') {
    return warehouse.usedCapacityTon;
  }
  return normalizeWarehouseInventory(warehouse).reduce((sum, item) => sum + item.quantity, 0);
}

export function getWarehouseFreeCapacityTon(warehouse: Warehouse): number {
  const capacity = warehouse.capacityTons ?? 0;
  return Math.max(0, capacity - getWarehouseUsedCapacityTon(warehouse));
}

export function getWarehouseInventoryItem(
  warehouse: Warehouse,
  productId: ProductId,
): WarehouseInventoryItem | undefined {
  return normalizeWarehouseInventory(warehouse).find((item) => item.productId === productId);
}

export function calculateTradeBuyCost(unitPrice: number, quantity: number): number {
  const base = unitPrice * quantity;
  const fee = base * tradingBalance.warehouseBuyFeeRate;
  return base + fee;
}

export function calculateTradeSellRevenue(unitPrice: number, quantity: number): number {
  const base = unitPrice * quantity;
  const fee = base * tradingBalance.warehouseSellFeeRate;
  return Math.max(0, base - fee);
}

export function calculateTradeProfit(
  sellUnitPrice: number,
  averageBuyPrice: number,
  quantity: number,
): number {
  const revenue = calculateTradeSellRevenue(sellUnitPrice, quantity);
  const costBasis = averageBuyPrice * quantity;
  return revenue - costBasis;
}

export function mergeInventoryOnBuy(
  inventory: WarehouseInventoryItem[],
  productId: ProductId,
  quantity: number,
  unitPrice: number,
): WarehouseInventoryItem[] {
  const next = [...inventory];
  const index = next.findIndex((item) => item.productId === productId);

  if (index < 0) {
    next.push({ productId, quantity, averageBuyPrice: unitPrice });
    return next;
  }

  const existing = next[index];
  const totalQuantity = existing.quantity + quantity;
  const weightedAverage =
    totalQuantity > 0
      ? (existing.quantity * existing.averageBuyPrice + quantity * unitPrice) / totalQuantity
      : unitPrice;

  next[index] = {
    productId,
    quantity: totalQuantity,
    averageBuyPrice: weightedAverage,
  };
  return next;
}

export function reduceInventoryOnSell(
  inventory: WarehouseInventoryItem[],
  productId: ProductId,
  quantity: number,
): WarehouseInventoryItem[] {
  return inventory
    .map((item) => {
      if (item.productId !== productId) {
        return item;
      }
      return {
        ...item,
        quantity: Math.max(0, item.quantity - quantity),
      };
    })
    .filter((item) => item.quantity > 0);
}

export function clampTradeQuantity(
  requested: number,
  maxByStock: number,
  maxByCapacity?: number,
): number {
  const safeRequested = Math.max(0, requested);
  const caps = [maxByStock, tradingBalance.maxTradeQuantity];
  if (maxByCapacity != null) {
    caps.push(maxByCapacity);
  }
  return Math.min(safeRequested, ...caps.filter((cap) => cap >= 0));
}

export function getTradeQuantityPresets(
  maxQuantity: number,
): number[] {
  const presets = [
    tradingBalance.minTradeQuantity,
    tradingBalance.defaultTradeQuantity,
    25,
    maxQuantity,
  ];
  const unique = Array.from(new Set(presets.filter((value) => value > 0 && value <= maxQuantity)));
  if (maxQuantity > 0 && !unique.includes(maxQuantity)) {
    unique.push(maxQuantity);
  }
  return unique.sort((a, b) => a - b);
}

export function summarizeFinanceLedger(entries: FinanceLedgerEntry[] | undefined): {
  tradePurchaseTotal: number;
  tradeSaleTotal: number;
  tradeNetProfit: number;
} {
  let tradePurchaseTotal = 0;
  let tradeSaleTotal = 0;

  for (const entry of entries ?? []) {
    if (entry.category === 'trade_purchase' && entry.type === 'expense') {
      tradePurchaseTotal += entry.amount;
    }
    if (entry.category === 'trade_sale' && entry.type === 'income') {
      tradeSaleTotal += entry.amount;
    }
  }

  return {
    tradePurchaseTotal,
    tradeSaleTotal,
    tradeNetProfit: tradeSaleTotal - tradePurchaseTotal,
  };
}

export function getTotalInventoryTons(warehouses: Warehouse[] | undefined): number {
  return (warehouses ?? []).reduce((sum, warehouse) => sum + getWarehouseUsedCapacityTon(warehouse), 0);
}

export function getProductDisplayName(productId: ProductId): string {
  return PRODUCT_BY_ID[productId]?.name ?? productId;
}
