import { colors } from '../theme';
import type { ProductId } from '../types/game';
import { PRODUCT_PRICE_HISTORY_MAX } from './priceHistoryCore';

export type ProductTrendDirection = 'up' | 'down' | 'stable';

export interface ProductPriceTrendMarketState {
  currentPrice: number;
  basePrice: number;
  priceHistory?: number[];
}

export interface ProductPriceTrendInput {
  cityId: string;
  productId: ProductId;
  currentTime: number;
  marketState: ProductPriceTrendMarketState;
}

export interface ProductPriceTrend {
  /** Ham fiyat serisi — grafik için */
  prices: number[];
  /** 0–1 normalize edilmiş noktalar (legacy uyumluluk) */
  points: number[];
  direction: ProductTrendDirection;
  changePercent: number;
  label: string;
  color: string;
}

function resolveTrendLabel(direction: ProductTrendDirection): string {
  switch (direction) {
    case 'up':
      return 'Yükselişte';
    case 'down':
      return 'Düşüşte';
    default:
      return 'Dengeli';
  }
}

function resolveTrendColor(direction: ProductTrendDirection): string {
  switch (direction) {
    case 'up':
      return colors.success;
    case 'down':
      return colors.danger;
    default:
      return colors.info;
  }
}

function resolveDirectionFromPrices(prices: number[]): ProductTrendDirection {
  if (prices.length < 2) {
    return 'stable';
  }

  const first = prices[0];
  const last = prices[prices.length - 1];
  const safeFirst = Math.max(first, 0.01);
  const changePercent = ((last - first) / safeFirst) * 100;

  if (changePercent > 1.5) {
    return 'up';
  }
  if (changePercent < -1.5) {
    return 'down';
  }
  return 'stable';
}

function buildNormalizedPoints(prices: number[]): number[] {
  if (prices.length === 0) {
    return [];
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;

  if (range <= 0.001) {
    return prices.map(() => 0.5);
  }

  return prices.map((price) => {
    const normalized = (price - min) / range;
    return Math.max(0.08, Math.min(0.92, normalized));
  });
}

export function getProductPriceTrend(input: ProductPriceTrendInput): ProductPriceTrend {
  const { marketState } = input;
  const safeBase = Math.max(marketState.basePrice, 1);
  const currentPrice = marketState.currentPrice;

  const rawHistory = marketState.priceHistory ?? [];
  const cleanedHistory = rawHistory
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const prices =
    cleanedHistory.length > 0
      ? cleanedHistory.slice(-PRODUCT_PRICE_HISTORY_MAX)
      : [currentPrice];

  if (
    prices.length === 0 ||
    Math.abs(prices[prices.length - 1] - currentPrice) > 0.001
  ) {
    prices.push(currentPrice);
  }

  const uniqueTail = prices.slice(-PRODUCT_PRICE_HISTORY_MAX);
  const direction = resolveDirectionFromPrices(uniqueTail);

  const historyFirst = uniqueTail[0] ?? currentPrice;
  const historyChangePercent = Math.round(
    ((currentPrice - historyFirst) / Math.max(historyFirst, 0.01)) * 100,
  );
  const baseChangePercent = Math.round(((currentPrice - safeBase) / safeBase) * 100);

  const changePercent =
    uniqueTail.length >= 2 ? historyChangePercent : baseChangePercent;

  return {
    prices: uniqueTail,
    points: buildNormalizedPoints(uniqueTail),
    direction,
    changePercent,
    label: resolveTrendLabel(direction),
    color: resolveTrendColor(direction),
  };
}

export function formatTrendChangeDisplay(
  trend: ProductPriceTrend,
): { label: string; color: string } {
  if (trend.direction === 'stable' && Math.abs(trend.changePercent) <= 1) {
    return { label: '— 0%', color: colors.textMuted };
  }

  const arrow =
    trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '—';
  const signed =
    trend.changePercent > 0
      ? `+${trend.changePercent}%`
      : trend.changePercent < 0
        ? `${trend.changePercent}%`
        : '0%';

  return {
    label: `${arrow} ${signed}`,
    color: trend.color,
  };
}

/** @deprecated Prefer getMarketStatusLabel from marketStatusLabels */
export function getCompactMarketStatusLabel(status: string): string {
  switch (status) {
    case 'Kritik Kıtlık':
    case 'critical':
    case 'CRITICAL':
      return 'Yoğun Talep';
    case 'Kıtlık':
    case 'shortage':
    case 'SHORTAGE':
      return 'Stok Az';
    case 'Fazla':
    case 'Yüksek Fazla':
    case 'surplus':
    case 'SURPLUS':
      return 'Stok Fazla';
    case 'Dengeli':
    case 'balanced':
    case 'BALANCED':
      return 'Normal';
    default:
      return status;
  }
}
