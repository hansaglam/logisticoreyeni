/**
 * Ekonomi / piyasa fiyatı için ortak saf hesaplar.
 * economy.ts ve marketPriceTick.ts birbirini import etmeden burayı kullanır.
 */

import { clamp } from '../utils/math';

/** Fiyat taban fiyatın en fazla %40 altına inebilir */
export const PRICE_FLOOR_RATIO = 0.4;

/** Fiyat taban fiyatın en fazla %250 üstüne çıkabilir */
export const PRICE_CEILING_RATIO = 2.5;

/** Fiyatı basePrice tabanlı min/max sınırlarına oturtur */
export function clampPrice(price: number, basePrice: number): number {
  const floor = basePrice * PRICE_FLOOR_RATIO;
  const ceiling = basePrice * PRICE_CEILING_RATIO;
  return clamp(price, floor, ceiling);
}

/** Fiyatı iki ondalığa yuvarlar (mikro tick çıktısı) */
export function roundMarketPrice(value: number): number {
  if (!Number.isFinite(value)) return 0.01;
  return Math.max(0.01, Math.round(value * 100) / 100);
}
