/**
 * Piyasa / depo ticaret fırsatları — Dashboard ve Market için tek kaynak.
 * Şehirler arası ürün taşıma yok; yalnızca depo bulunan şehirlerde alım/satım.
 */

import { tradingBalance } from '../config/balance';
import {
  buildTradeProfitBreakdown,
  calculateTradeBuyCost,
  getCityProductMarketPrice,
  getCityProductStock,
  getWarehouseFreeCapacityTon,
  normalizeWarehouse,
} from '../simulation/trading';
import type { City, Player, Product, ProductId } from '../types/game';
import { getCityName, getProductName } from './entityLookup';
import { computePriceMomentum } from './marketPriceHistoryGenerator';
import {
  buildMarketProductViewModel,
  getCityProductInventorySummary,
  getProductMarket,
  type MarketStockStatus,
} from './marketProductViewModel';

export type MarketTradeOpportunityType = 'buy' | 'sell' | 'watch';

export interface MarketTradeOpportunity {
  id: string;
  type: MarketTradeOpportunityType;
  cityId: string;
  productId: ProductId;
  label: string;
  description: string;
  netProfit: number | null;
  score: number;
}

export interface DetectMarketTradeOpportunitiesInput {
  player: Player;
  cities: City[];
  products: Product[];
  currentTime: number;
  limit?: number;
}

const OPPORTUNITY_TYPE_LABELS: Record<MarketTradeOpportunityType, string> = {
  buy: 'Alım Fırsatı',
  sell: 'Satış Fırsatı',
  watch: 'Takip Et',
};

const OPPORTUNITY_TYPE_DESCRIPTIONS: Record<MarketTradeOpportunityType, string> = {
  buy: 'Fiyat düşük, stok için takip edilebilir.',
  sell: 'Depodaki stok kârla satılabilir.',
  watch: 'Fiyat hareketi yüksek, alarm kurulabilir.',
};

function isSurplusStatus(status: MarketStockStatus): boolean {
  return status === 'Fazla' || status === 'Yüksek Fazla';
}

function isDemandStatus(status: MarketStockStatus): boolean {
  return status === 'Kritik Kıtlık' || status === 'Kıtlık';
}

function scoreBuyOpportunity(
  stockStatus: MarketStockStatus,
  priceBelowBase: boolean,
  trendUp: boolean,
  momentum: ReturnType<typeof computePriceMomentum>,
): number {
  let score = 40;
  if (isSurplusStatus(stockStatus)) score += 35;
  if (priceBelowBase) score += 25;
  if (!trendUp) score += 10;
  if (momentum.isSlowing && momentum.mediumTerm < 0) score += 15;
  if (momentum.mediumTerm > 4) score -= 20;
  if (momentum.isAccelerating && momentum.mediumTerm > 0) score -= 12;
  return score;
}

function scoreSellOpportunity(
  netProfit: number,
  stockStatus: MarketStockStatus,
  trendUp: boolean,
  momentum: ReturnType<typeof computePriceMomentum>,
): number {
  let score = 50 + Math.min(netProfit / 50, 40);
  if (isDemandStatus(stockStatus)) score += 30;
  if (trendUp) score += 20;
  if (momentum.isAccelerating && momentum.mediumTerm > 0) score += 12;
  if (momentum.isSlowing && trendUp) score -= 8;
  return score;
}

function scoreWatchOpportunity(
  trendStrength: number,
  stockStatus: MarketStockStatus,
  momentum: ReturnType<typeof computePriceMomentum>,
): number {
  let score = 20 + Math.min(Math.abs(trendStrength), 30);
  if (isSurplusStatus(stockStatus) || isDemandStatus(stockStatus)) {
    score += 15;
  }
  if (momentum.volatility > 1.2) score += 10;
  if (momentum.isSlowing) score += 8;
  return score;
}

export function detectMarketTradeOpportunities(
  input: DetectMarketTradeOpportunitiesInput,
): MarketTradeOpportunity[] {
  const { player, cities, products, currentTime, limit = 6 } = input;
  const warehouses = (player.warehouses ?? []).map((warehouse) =>
    normalizeWarehouse(warehouse, currentTime),
  );
  const playerMoney = Math.max(0, player.money ?? 0);
  const minQty = tradingBalance.minTradeQuantity;
  const opportunities: MarketTradeOpportunity[] = [];

  for (const city of cities) {
    const cityWarehouses = warehouses.filter((warehouse) => warehouse.cityId === city.id);
    const hasWarehouse = cityWarehouses.length > 0;
    const totalFreeCapacity = cityWarehouses.reduce(
      (sum, warehouse) => sum + getWarehouseFreeCapacityTon(warehouse),
      0,
    );

    for (const product of products) {
      const market = getProductMarket(city, product.id);
      if (!market) continue;

      const viewModel = buildMarketProductViewModel({
        city,
        productId: product.id,
        currentTime,
        warehouses: cityWarehouses,
        totalFreeCapacity,
        playerMoney,
        products,
      });
      if (!viewModel) continue;

      const unitPrice = getCityProductMarketPrice(city, product.id);
      const minBuyCost = calculateTradeBuyCost(unitPrice, minQty);
      const canAffordMinBuy = playerMoney >= minBuyCost;
      const priceBelowBase = market.currentPrice < market.basePrice * 0.98;
      const trendUp = viewModel.trendDirection === 'up';
      const trendStrength = Math.abs(viewModel.changePercent ?? 0);
      const momentum = computePriceMomentum(market.priceHistory ?? viewModel.priceHistory);

      const sellQty =
        viewModel.warehouseQuantity >= minQty
          ? Math.min(viewModel.warehouseQuantity, tradingBalance.defaultTradeQuantity)
          : 0;
      const inventory = getCityProductInventorySummary(cityWarehouses, product.id);

      const sellProfitBreakdown =
        sellQty > 0
          ? buildTradeProfitBreakdown(
              unitPrice,
              viewModel.averageBuyPrice,
              sellQty,
              inventory.quality,
            )
          : null;

      const netSellProfit = sellProfitBreakdown?.netProfit ?? viewModel.profitLoss;

      const isSell =
        hasWarehouse &&
        viewModel.warehouseQuantity >= minQty &&
        netSellProfit != null &&
        netSellProfit > 1 &&
        (isDemandStatus(viewModel.stockStatus) ||
          trendUp ||
          netSellProfit > 50) &&
        !(momentum.mediumTerm < -3 && !isDemandStatus(viewModel.stockStatus));

      if (isSell) {
        opportunities.push({
          id: `sell-${city.id}-${product.id}`,
          type: 'sell',
          cityId: city.id,
          productId: product.id,
          label: OPPORTUNITY_TYPE_LABELS.sell,
          description: OPPORTUNITY_TYPE_DESCRIPTIONS.sell,
          netProfit: netSellProfit,
          score: scoreSellOpportunity(
            netSellProfit ?? 0,
            viewModel.stockStatus,
            trendUp,
            momentum,
          ),
        });
        continue;
      }

      const isBuy =
        hasWarehouse &&
        totalFreeCapacity >= minQty &&
        market.stock >= minQty &&
        canAffordMinBuy &&
        (isSurplusStatus(viewModel.stockStatus) || priceBelowBase) &&
        momentum.mediumTerm < 5;

      if (isBuy) {
        opportunities.push({
          id: `buy-${city.id}-${product.id}`,
          type: 'buy',
          cityId: city.id,
          productId: product.id,
          label: OPPORTUNITY_TYPE_LABELS.buy,
          description: OPPORTUNITY_TYPE_DESCRIPTIONS.buy,
          netProfit: null,
          score: scoreBuyOpportunity(viewModel.stockStatus, priceBelowBase, trendUp, momentum),
        });
        continue;
      }

      const isWatch =
        trendStrength >= 3 ||
        isSurplusStatus(viewModel.stockStatus) ||
        isDemandStatus(viewModel.stockStatus);

      if (isWatch) {
        opportunities.push({
          id: `watch-${city.id}-${product.id}`,
          type: 'watch',
          cityId: city.id,
          productId: product.id,
          label: OPPORTUNITY_TYPE_LABELS.watch,
          description: OPPORTUNITY_TYPE_DESCRIPTIONS.watch,
          netProfit: null,
          score: scoreWatchOpportunity(trendStrength, viewModel.stockStatus, momentum),
        });
      }
    }
  }

  const typePriority: Record<MarketTradeOpportunityType, number> = {
    sell: 3,
    buy: 2,
    watch: 1,
  };

  return opportunities
    .sort((a, b) => {
      const typeDiff = typePriority[b.type] - typePriority[a.type];
      if (typeDiff !== 0) return typeDiff;
      return b.score - a.score;
    })
    .slice(0, limit);
}

/**
 * Dashboard önizlemesi için skor sırasını koruyarak farklı ürün çeşitliliği sağlar.
 */
export function pickDiverseMarketTradeOpportunities(
  opportunities: MarketTradeOpportunity[],
  limit = 2,
): MarketTradeOpportunity[] {
  if (opportunities.length <= limit) {
    return opportunities;
  }

  const picked: MarketTradeOpportunity[] = [opportunities[0]];
  const firstProduct = opportunities[0].productId;

  const diverse = opportunities.slice(1).find((item) => item.productId !== firstProduct);
  if (diverse) {
    picked.push(diverse);
  } else {
    picked.push(opportunities[1]);
  }

  return picked.slice(0, limit);
}

export function formatMarketTradeOpportunityTitle(
  opportunity: MarketTradeOpportunity,
): string {
  return `${getCityName(opportunity.cityId)} · ${getProductName(opportunity.productId)}`;
}
