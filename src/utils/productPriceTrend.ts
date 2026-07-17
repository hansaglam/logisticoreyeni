import { colors } from '../theme';
import type { ProductId } from '../types/game';
import {
  buildMarketChartSnapshot,
  type ChartTrendInfo,
  type MarketChartPattern,
} from './marketChartSeries';
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
  /** Stok durumu — grafik pattern seçimi için */
  stockStatus?: string;
}

export interface ProductPriceTrend {
  /** Detay analiz grafiği (48 nokta) */
  prices: number[];
  /** Mini kart sparkline (son 18 nokta) */
  miniPrices: number[];
  /** Oyun zamanı — grafik X ekseni etiketleri */
  chartCurrentTime: number;
  /** Kontrollü chart pattern */
  chartPattern: MarketChartPattern;
  /** Status + pattern ile hizalı trend bilgisi */
  chartTrendInfo: ChartTrendInfo;
  /** 0–1 normalize edilmiş noktalar (legacy uyumluluk) */
  points: number[];
  direction: ProductTrendDirection;
  changePercent: number;
  label: string;
  color: string;
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
  const currentPrice = marketState.currentPrice;

  const rawHistory = marketState.priceHistory ?? [];
  const cleanedHistory = rawHistory
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  let rawPrices =
    cleanedHistory.length > 0
      ? cleanedHistory.slice(-PRODUCT_PRICE_HISTORY_MAX)
      : [currentPrice];

  if (
    rawPrices.length === 0 ||
    Math.abs(rawPrices[rawPrices.length - 1] - currentPrice) > 0.001
  ) {
    rawPrices.push(currentPrice);
  } else {
    rawPrices[rawPrices.length - 1] = currentPrice;
  }

  const chartInput = {
    rawHistory: rawPrices,
    currentPrice,
    productId: input.productId,
    cityId: input.cityId,
    marketStatus: input.stockStatus,
    currentTime: input.currentTime,
  };

  const snapshot = buildMarketChartSnapshot(chartInput);
  const detailPrices = [...snapshot.detailPrices];
  const miniPrices = [...snapshot.miniPrices];
  detailPrices[detailPrices.length - 1] = currentPrice;
  miniPrices[miniPrices.length - 1] = currentPrice;

  const { chartTrendInfo } = snapshot;

  return {
    prices: detailPrices,
    miniPrices,
    chartCurrentTime: input.currentTime,
    chartPattern: chartTrendInfo.selectedPattern,
    chartTrendInfo,
    points: buildNormalizedPoints(detailPrices),
    direction: chartTrendInfo.displayTrendDirection,
    changePercent: chartTrendInfo.displayPercentChange,
    label: chartTrendInfo.displayTrendLabel,
    color: chartTrendInfo.displayTrendColor,
  };
}

export function formatTrendChangeDisplay(
  trend: ProductPriceTrend,
): { label: string; color: string } {
  const pct = trend.changePercent;

  if (trend.direction === 'stable' || pct === 0) {
    return { label: 'Dengeli', color: trend.color };
  }

  const arrow =
    trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '—';

  if (trend.direction === 'up') {
    return { label: `${arrow} +${Math.abs(pct)}%`, color: trend.color };
  }
  if (trend.direction === 'down') {
    return { label: `${arrow} -${Math.abs(pct)}%`, color: trend.color };
  }

  const signed = pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : '0%';
  return { label: `${arrow} ${signed}`, color: trend.color };
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
      return 'Normal';
  }
}

export type { MarketChartPattern, ChartTrendInfo } from './marketChartSeries';
