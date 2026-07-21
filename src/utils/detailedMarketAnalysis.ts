/**
 * Reklamla açılan detaylı piyasa analiz metni — fiyat/simülasyonu değiştirmez.
 */

import type { ProductTrendDirection } from '../utils/productPriceTrend';

export interface DetailedMarketAnalysisInput {
  productName: string;
  cityName: string;
  trendDirection: ProductTrendDirection;
  trendChangeLabel: string;
  stockStatusLabel: string;
  stockStatusDescription: string;
  eventLabel?: string;
  eventImpactLabel?: string;
}

export function buildDetailedMarketTrendCommentary(input: DetailedMarketAnalysisInput): string {
  const directionHint =
    input.trendDirection === 'up'
      ? 'Kısa vadede fiyat baskısı yukarı yönlü görünüyor.'
      : input.trendDirection === 'down'
        ? 'Kısa vadede fiyat baskısı aşağı yönlü görünüyor.'
        : 'Fiyat bandında yatay seyir baskın.';

  const eventHint = input.eventLabel
    ? ` Aktif olay (${input.eventLabel}${input.eventImpactLabel ? ` · ${input.eventImpactLabel}` : ''}) trendi etkileyebilir.`
    : '';

  return (
    `${input.cityName} ${input.productName} için 24 oyun saatlik detaylı yorum: ` +
    `${input.trendChangeLabel}. Stok durumu: ${input.stockStatusLabel.toLowerCase()} — ` +
    `${input.stockStatusDescription} ${directionHint}${eventHint} ` +
    'Bu analiz yalnızca bilgi amaçlıdır; işlem fiyatlarını doğrudan değiştirmez.'
  );
}
