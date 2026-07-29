/**
 * LogistiCore - Depo ticareti yardımcıları
 *
 * Envanter normalizasyonu, kapasite ve alım/satım hesapları.
 */

import { operatingCostBalance, tradingBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import { getProductName } from '../utils/entityLookup';
import { calculateWarehouseDailyOperatingCostBreakdown } from '../utils/warehouseCalculations';
import {
  getEffectiveSellPrice,
  getInventoryQuality,
  mergeInventoryOnBuyWithQuality,
  normalizeInventoryItem,
  resolveWarehouseType,
  computeWeightedAverageBuyPrice,
} from './warehouseStorage';
import type {
  City,
  FinanceLedgerEntry,
  ProductId,
  Warehouse,
  WarehouseInventoryItem,
} from '../types/game';
import { toProductMarket } from './economy';

// Depolar arası stok transferi V2 — henüz yok (yalnız kamyon empty transfer var).

/** Eski save kayıtlarındaki legacy storedProducts alanını okur */
function readLegacyStoredProducts(
  warehouse: Warehouse,
): Partial<Record<ProductId, number>> {
  const legacy = (warehouse as Warehouse & {
    storedProducts?: Partial<Record<ProductId, number>>;
  }).storedProducts;
  return legacy ?? {};
}

export function getCityProductMarketPrice(city: City | undefined, productId: ProductId): number {
  if (!city?.products?.[productId]) {
    return 0;
  }
  return toProductMarket(city.products[productId]).currentPrice;
}

export { applyWorldEventImpactToProductPrice } from './worldEvents';

export function getCityProductStock(city: City | undefined, productId: ProductId): number {
  return city?.products?.[productId]?.stock ?? 0;
}

/** Eski storedProducts kayıtlarını inventory'ye dönüştürür */
export function normalizeWarehouseInventory(
  warehouse: Warehouse,
  currentTime = 0,
): WarehouseInventoryItem[] {
  if (warehouse.inventory && warehouse.inventory.length > 0) {
    return warehouse.inventory.map((item) => normalizeInventoryItem(item, warehouse, currentTime));
  }

  const legacy = readLegacyStoredProducts(warehouse);
  const warehouseType = resolveWarehouseType(warehouse.warehouseType);
  return Object.entries(legacy)
    .filter(([, quantity]) => (quantity ?? 0) > 0)
    .map(([productId, quantity]) =>
      normalizeInventoryItem(
        {
          productId: productId as ProductId,
          quantity: quantity ?? 0,
          averageBuyPrice: 0,
          quality: 100,
          storedAt: currentTime,
          lastQualityUpdateAt: currentTime,
          warehouseType,
        },
        warehouse,
        currentTime,
      ),
    );
}

export function normalizeWarehouse(warehouse: Warehouse, currentTime = 0): Warehouse {
  const inventory = normalizeWarehouseInventory(warehouse, currentTime);
  const usedCapacityTon = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const capacityTons = warehouse.capacityTons ?? warehouse.capacityTon ?? tradingBalance.defaultWarehouseCapacityTons;
  const city = CITIES_BY_ID[warehouse.cityId];
  const computedDailyCost = calculateWarehouseDailyOperatingCostBreakdown(warehouse, city).total;
  const dailyOperatingCost =
    warehouse.dailyOperatingCost ??
    (computedDailyCost > 0 ? computedDailyCost : operatingCostBalance.fallbackWarehouseDailyCost);

  return {
    ...warehouse,
    capacityTons,
    capacityTon: capacityTons,
    dailyOperatingCost,
    warehouseType: resolveWarehouseType(warehouse.warehouseType),
    qualityProtection:
      warehouse.qualityProtection ??
      (resolveWarehouseType(warehouse.warehouseType) === 'cold' ? 1 : 0.5),
    inventory,
    usedCapacityTon,
  };
}

export function getWarehouseUsedCapacityTon(warehouse: Warehouse): number {
  if (typeof warehouse.usedCapacityTon === 'number') {
    return warehouse.usedCapacityTon;
  }
  return normalizeWarehouseInventory(warehouse).reduce((sum, item) => sum + item.quantity, 0);
}

export function getWarehouseFreeCapacityTon(warehouse: Warehouse): number {
  const capacity =
    warehouse.capacityTons ??
    warehouse.capacityTon ??
    tradingBalance.defaultWarehouseCapacityTons;
  return Math.max(0, capacity - getWarehouseUsedCapacityTon(warehouse));
}

export { computeWeightedAverageBuyPrice } from './warehouseStorage';


export function getWarehouseInventoryItem(
  warehouse: Warehouse,
  productId: ProductId,
): WarehouseInventoryItem | undefined {
  return normalizeWarehouseInventory(warehouse).find((item) => item.productId === productId);
}

/** Ürünler yalnızca bulunduğu şehirdeki depodan satılabilir */
export const WAREHOUSE_SELL_SAME_CITY_RULE =
  'Ürünler yalnızca bulunduğu şehirdeki depodan satılabilir.';

export function calculateTradeBuyCost(unitPrice: number, quantity: number): number {
  const base = unitPrice * quantity;
  const fee = base * tradingBalance.warehouseBuyFeeRate;
  return base + fee;
}

export function calculateTradeSellRevenue(
  unitPrice: number,
  quantity: number,
  quality = 100,
): number {
  const effectiveUnitPrice = getEffectiveSellPrice(unitPrice, quality);
  const base = effectiveUnitPrice * quantity;
  const fee = base * tradingBalance.warehouseSellFeeRate;
  return Math.max(0, base - fee);
}

export function calculateTradeProfit(
  sellUnitPrice: number,
  averageBuyPrice: number,
  quantity: number,
  quality = 100,
): number {
  return buildTradeProfitBreakdown(sellUnitPrice, averageBuyPrice, quantity, quality).netProfit;
}

/** UI ve ledger için tek kaynak net kâr dökümü */
export interface TradeProfitBreakdown {
  quantity: number;
  sellUnitPrice: number;
  averageBuyPrice: number;
  quality: number;
  grossSellRevenue: number;
  sellFeeAmount: number;
  sellRevenueAfterFee: number;
  averageCostIncludingBuyFee: number;
  buyFeeAmount: number;
  totalFees: number;
  netProfit: number;
}

export function buildTradeProfitBreakdown(
  sellUnitPrice: number,
  averageBuyPrice: number,
  quantity: number,
  quality = 100,
): TradeProfitBreakdown {
  const safeQty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const safeSell = Number.isFinite(sellUnitPrice) ? Math.max(0, sellUnitPrice) : 0;
  const safeBuy = Number.isFinite(averageBuyPrice) ? Math.max(0, averageBuyPrice) : 0;
  const safeQuality = Number.isFinite(quality)
    ? Math.max(0, Math.min(100, quality))
    : 100;

  const averageCostIncludingBuyFee = calculateTradeBuyCost(safeBuy, safeQty);
  const buyFeeAmount = safeBuy * safeQty * tradingBalance.warehouseBuyFeeRate;
  const sellRevenueAfterFee = calculateTradeSellRevenue(safeSell, safeQty, safeQuality);
  const effectiveUnitPrice = getEffectiveSellPrice(safeSell, safeQuality);
  const grossSellRevenue = effectiveUnitPrice * safeQty;
  const sellFeeAmount = grossSellRevenue * tradingBalance.warehouseSellFeeRate;
  const totalFees = buyFeeAmount + sellFeeAmount;
  const netProfit = sellRevenueAfterFee - averageCostIncludingBuyFee;

  return {
    quantity: safeQty,
    sellUnitPrice: safeSell,
    averageBuyPrice: safeBuy,
    quality: safeQuality,
    grossSellRevenue,
    sellFeeAmount,
    sellRevenueAfterFee,
    averageCostIncludingBuyFee,
    buyFeeAmount,
    totalFees,
    netProfit,
  };
}

/** Aynı fiyattan al-sat senaryosunda net sonuç (fee sonrası, zarar beklenir) */
export function calculateSamePriceRoundTripTradeResult(
  unitPrice: number,
  quantity: number,
  quality = 100,
): number {
  return calculateTradeProfit(unitPrice, unitPrice, quantity, quality);
}

/** UI için işlem gideri özeti */
export function getTradeFeeSummaryLabel(): string {
  const buyPct = Math.round(tradingBalance.warehouseBuyFeeRate * 100);
  const sellPct = Math.round(tradingBalance.warehouseSellFeeRate * 100);
  return `İşlem gideri: alım %${buyPct} · satım %${sellPct}`;
}

export function mergeInventoryOnBuy(
  inventory: WarehouseInventoryItem[],
  productId: ProductId,
  quantity: number,
  unitPrice: number,
  warehouse?: Warehouse,
  currentTime = 0,
  storageWarning?: string,
): WarehouseInventoryItem[] {
  if (warehouse) {
    return mergeInventoryOnBuyWithQuality(
      inventory,
      productId,
      quantity,
      unitPrice,
      warehouse,
      currentTime,
      storageWarning,
    );
  }

  const next = [...inventory];
  const index = next.findIndex((item) => item.productId === productId);

  if (index < 0) {
    next.push({ productId, quantity, averageBuyPrice: unitPrice, quality: 100 });
    return next;
  }

  const existing = next[index];
  const totalQuantity = existing.quantity + quantity;
  const weightedAverage = computeWeightedAverageBuyPrice(
    existing.quantity,
    existing.averageBuyPrice,
    quantity,
    unitPrice,
  );

  next[index] = {
    productId,
    quantity: totalQuantity,
    averageBuyPrice: weightedAverage,
    quality: getInventoryQuality(existing),
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

/** Store katmanı trade miktar doğrulaması — hata mesajı veya null */
export function validateTradeQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 'Geçerli bir miktar seçmelisin.';
  }
  if (quantity < tradingBalance.minTradeQuantity) {
    return `Minimum işlem miktarı ${tradingBalance.minTradeQuantity} ton.`;
  }
  if (quantity > tradingBalance.maxTradeQuantity) {
    return `Maksimum işlem miktarı ${tradingBalance.maxTradeQuantity} ton.`;
  }
  return null;
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
    if (
      (entry.category === 'trade_purchase' || entry.category === 'market_purchase') &&
      entry.type === 'expense'
    ) {
      tradePurchaseTotal += entry.amount;
    }
    if (
      (entry.category === 'trade_sale' || entry.category === 'market_sale') &&
      entry.type === 'income'
    ) {
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

export function getProductDisplayName(productId: ProductId | string | undefined | null): string {
  return getProductName(productId);
}
