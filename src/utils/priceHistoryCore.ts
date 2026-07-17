/**
 * Fiyat geçmişi yardımcıları — döngüsel import riski olmadan paylaşılır.
 */

export const PRODUCT_PRICE_HISTORY_MAX = 48;

export function appendProductPriceHistory(
  history: number[] | undefined,
  newPrice: number,
): number[] {
  const safePrice = Math.max(newPrice, 0.01);
  const base = Array.isArray(history) ? [...history] : [];
  const last = base[base.length - 1];

  if (last !== undefined && Math.abs(last - safePrice) < 0.001) {
    return base.slice(-PRODUCT_PRICE_HISTORY_MAX);
  }

  base.push(safePrice);
  return base.slice(-PRODUCT_PRICE_HISTORY_MAX);
}

export function seedProductPriceHistory(price: number): number[] {
  const safe = Math.max(price, 0.01);
  return [safe];
}
