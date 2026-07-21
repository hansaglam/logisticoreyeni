import { getWarehouseInventoryItem } from '../simulation/trading';
import {
  evaluateStorageSuitability,
  getInventoryQuality,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import { formatMoney } from '../theme';
import type { City, CityProductState, Product, ProductId, Warehouse, WorldEvent } from '../types/game';
import { getCityName, getProductName } from './entityLookup';
import {
  formatWorldEventImpactPercent,
  gameDayFromTime,
  getEventsForProduct,
  getPrimaryWorldEventLabel,
  getProductPriceEventMultiplier,
} from '../simulation/worldEvents';
import {
  getMarketStatusDescription,
  getMarketStatusLabel,
} from './marketStatusLabels';
import {
  formatTrendChangeDisplay,
  getProductPriceTrend,
  type ProductPriceTrend,
  type ProductTrendDirection,
} from './productPriceTrend';
import { getChartTrendCommentary, getMarketChartPatternCommentary } from './marketChartSeries';
import { resolveInventoryTradeProfit, resolveMarketBuyState, resolveMarketSellState } from './tradeDisplay';

export interface NormalizedProductMarket {
  productId: ProductId;
  stock: number;
  targetStock: number;
  currentPrice: number;
  basePrice: number;
  productionPerDay: number;
  consumptionPerDay: number;
  priceHistory: number[];
}

export interface CityProductInventorySummary {
  quantity: number;
  averageBuyPrice: number;
  quality: number;
  primaryWarehouseId: string | null;
}

export type MarketStockStatus =
  | 'Kritik Kıtlık'
  | 'Kıtlık'
  | 'Dengeli'
  | 'Fazla'
  | 'Yüksek Fazla';

export interface MarketProductViewModel {
  productName: string;
  cityName: string;
  currentPrice: number;
  pricePerTonLabel: string;
  changePercent: number;
  trendDirection: ProductTrendDirection;
  trendLabel: string;
  trendColor: string;
  trendChangeLabel: string;
  trend: ProductPriceTrend;
  priceHistory: number[];
  stockStatus: MarketStockStatus;
  stockStatusLabel: string;
  warehouseQuantity: number;
  averageBuyPrice: number;
  warehouseQuality: number;
  currentValue: number;
  profitLoss: number | null;
  commentary: string;
  stockStatusDescription: string;
  canBuy: boolean;
  canSell: boolean;
  buyButtonLabel: string;
  buyButtonDisabled: boolean;
  showSellButton: boolean;
  sellButtonLabel: string;
  sellButtonDisabled: boolean;
  hasWarehouse: boolean;
  eventLabel?: string;
  eventImpactLabel?: string;
  eventDescription?: string;
  displayPrice: number;
}

export function getProductMarket(
  city: City | null | undefined,
  productId: ProductId,
): NormalizedProductMarket | null {
  if (!city || !city.products) {
    return null;
  }

  const raw = city.products[productId] as (CityProductState & { price?: number }) | undefined;
  if (!raw) {
    return null;
  }

  const basePrice = raw.basePrice ?? 0;
  const currentPrice = raw.currentPrice ?? raw.price ?? basePrice;
  const stock = raw.stock ?? 0;
  const targetStock = raw.targetStock && raw.targetStock > 0 ? raw.targetStock : Math.max(stock, 1);

  return {
    productId,
    stock,
    targetStock,
    currentPrice,
    basePrice,
    productionPerDay: raw.productionPerDay ?? 0,
    consumptionPerDay: raw.consumptionPerDay ?? 0,
    priceHistory: Array.isArray(raw.priceHistory)
      ? raw.priceHistory
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [currentPrice],
  };
}

export function calculateStockRatio(market: NormalizedProductMarket): number {
  const safeTarget = Math.max(market.targetStock, 1);
  return market.stock / safeTarget;
}

export function getMarketStatus(stockRatio: number): MarketStockStatus {
  if (stockRatio < 0.3) return 'Kritik Kıtlık';
  if (stockRatio < 0.7) return 'Kıtlık';
  if (stockRatio <= 1.2) return 'Dengeli';
  if (stockRatio <= 1.6) return 'Fazla';
  return 'Yüksek Fazla';
}

export function getCityProductInventorySummary(
  warehouses: Warehouse[],
  productId: ProductId,
): CityProductInventorySummary {
  let quantity = 0;
  let costBasis = 0;
  let qualityWeighted = 0;
  let primaryWarehouseId: string | null = null;
  let primaryQty = 0;

  for (const warehouse of warehouses) {
    const item = getWarehouseInventoryItem(warehouse, productId);
    if (!item || item.quantity <= 0) continue;

    const itemQty = item.quantity;
    const itemQuality = getInventoryQuality(item);
    quantity += itemQty;
    costBasis += itemQty * (item.averageBuyPrice ?? 0);
    qualityWeighted += itemQty * itemQuality;

    if (itemQty > primaryQty) {
      primaryQty = itemQty;
      primaryWarehouseId = warehouse.id;
    }
  }

  return {
    quantity,
    averageBuyPrice: quantity > 0 ? costBasis / quantity : 0,
    quality: quantity > 0 ? qualityWeighted / quantity : 100,
    primaryWarehouseId,
  };
}

function canStoreProductInCity(warehouses: Warehouse[], product: Product | undefined): boolean {
  if (!product || warehouses.length === 0) {
    return warehouses.length > 0;
  }

  return warehouses.some((warehouse) => {
    const warehouseType = resolveWarehouseType(warehouse.warehouseType);
    return evaluateStorageSuitability(product, warehouseType) !== 'blocked';
  });
}

export function getMarketCommentary(input: {
  stockStatus: MarketStockStatus;
  trendDirection: ProductTrendDirection;
  warehouseQuantity: number;
  profitLoss: number | null;
  chartTrendInfo?: ProductPriceTrend['chartTrendInfo'];
}): string {
  const { stockStatus, warehouseQuantity, profitLoss, chartTrendInfo } = input;

  if (warehouseQuantity > 0 && profitLoss != null) {
    if (profitLoss > 1) {
      return 'Mevcut stok kârda. Satış için değerlendirilebilir.';
    }
    if (profitLoss < -1) {
      return 'Mevcut stok zararda. Fiyat toparlanana kadar takip edebilirsin.';
    }
  }

  if (chartTrendInfo) {
    return getChartTrendCommentary(chartTrendInfo);
  }

  const isSurplus = stockStatus === 'Fazla' || stockStatus === 'Yüksek Fazla';
  const isShortage = stockStatus === 'Kıtlık' || stockStatus === 'Kritik Kıtlık';

  if (isSurplus) {
    return getMarketChartPatternCommentary('DOWN_WITH_BOUNCE', 'STOK_FAZLA');
  }

  if (isShortage) {
    return getMarketChartPatternCommentary(
      'UP_WITH_PULLBACK',
      stockStatus === 'Kritik Kıtlık' ? 'YOGUN_TALEP' : 'STOK_AZ',
    );
  }

  return getMarketChartPatternCommentary('SIDEWAYS_ACCUMULATION', 'NORMAL');
}

export interface BuildMarketProductViewModelInput {
  city: City | null | undefined;
  productId: ProductId;
  currentTime: number;
  warehouses: Warehouse[];
  totalFreeCapacity: number;
  playerMoney: number;
  products?: Product[];
  activeWorldEvents?: WorldEvent[];
}

export function buildMarketProductViewModel(
  input: BuildMarketProductViewModelInput,
): MarketProductViewModel | null {
  const { city, productId, currentTime, warehouses, totalFreeCapacity, playerMoney } = input;

  if (!city) {
    return null;
  }

  const market = getProductMarket(city, productId);
  if (!market) {
    return null;
  }

  const productName =
    input.products?.find((item) => item.id === productId)?.name ?? getProductName(productId);
  const cityName = city.name ?? getCityName(city.id);
  const hasWarehouse = warehouses.length > 0;
  const inventory = getCityProductInventorySummary(warehouses, productId);
  const stockRatio = calculateStockRatio(market);
  const stockStatus = getMarketStatus(stockRatio);
  const currentDay = gameDayFromTime(currentTime);
  const productEvents = getEventsForProduct(
    input.activeWorldEvents ?? [],
    productId,
    currentDay,
    city.id,
  ).filter((event) => event.impact.productPriceMultiplier);
  const priceMultiplier = getProductPriceEventMultiplier(
    productId,
    city.id,
    input.activeWorldEvents ?? [],
    currentDay,
  );
  const displayPrice =
    priceMultiplier !== 1
      ? Number(Math.max(1, market.currentPrice * priceMultiplier).toFixed(2))
      : market.currentPrice;
  const primaryEvent = productEvents[0];
  const eventLabel = primaryEvent ? getPrimaryWorldEventLabel(primaryEvent) : undefined;
  const eventImpactLabel =
    priceMultiplier !== 1 ? formatWorldEventImpactPercent(priceMultiplier) : undefined;
  const eventDescription = primaryEvent?.description;

  const trend = getProductPriceTrend({
    cityId: city.id,
    productId,
    currentTime,
    stockStatus,
    marketState: {
      currentPrice: market.currentPrice,
      basePrice: market.basePrice,
      priceHistory: market.priceHistory,
    },
  });

  const priceChangeDisplay = formatTrendChangeDisplay(trend);
  const trendChangeLabel =
    priceChangeDisplay.label === trend.label
      ? trend.label
      : `${priceChangeDisplay.label} · ${trend.label}`;
  const inventoryTrade =
    inventory.quantity > 0
      ? resolveInventoryTradeProfit(
          displayPrice,
          inventory.averageBuyPrice,
          inventory.quantity,
          inventory.quality,
        )
      : null;
  const profitLoss = inventoryTrade?.breakdown.netProfit ?? null;

  const currentValue = inventory.quantity > 0 ? inventory.quantity * displayPrice : 0;

  const productDef = input.products?.find((item) => item.id === productId);
  const canStoreProduct = canStoreProductInCity(warehouses, productDef);

  const buyState = resolveMarketBuyState({
    hasWarehouse,
    marketStock: market.stock,
    freeCapacity: totalFreeCapacity,
    playerMoney,
    unitPrice: displayPrice,
    canStoreProduct,
  });

  const sellState = resolveMarketSellState({
    hasWarehouse,
    inventoryQuantity: inventory.quantity,
  });

  return {
    productName,
    cityName,
    currentPrice: market.currentPrice,
    displayPrice,
    pricePerTonLabel: `${formatMoney(displayPrice)} / ton`,
    changePercent: trend.changePercent,
    trendDirection: trend.direction,
    trendLabel: trend.label,
    trendColor: trend.color,
    trendChangeLabel,
    trend,
    priceHistory: trend.prices,
    stockStatus,
    stockStatusLabel: getMarketStatusLabel(stockStatus),
    warehouseQuantity: inventory.quantity,
    averageBuyPrice: inventory.averageBuyPrice,
    warehouseQuality: inventory.quality,
    currentValue,
    profitLoss,
    commentary: getMarketCommentary({
      stockStatus,
      trendDirection: trend.direction,
      warehouseQuantity: inventory.quantity,
      profitLoss,
      chartTrendInfo: trend.chartTrendInfo,
    }),
    stockStatusDescription: getMarketStatusDescription(stockStatus),
    canBuy: buyState.canBuy,
    canSell: sellState.canSell,
    buyButtonLabel: buyState.label,
    buyButtonDisabled: buyState.disabled,
    showSellButton: sellState.showSellButton,
    sellButtonLabel: sellState.label,
    sellButtonDisabled: sellState.disabled,
    hasWarehouse,
    eventLabel: eventLabel ? `Etkinlik: ${eventLabel}` : undefined,
    eventImpactLabel,
    eventDescription,
  };
}
