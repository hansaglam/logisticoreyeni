/**
 * Ürün fiyat geçmişi — mini trend grafikleri için.
 */

import type { City, CityProductState, ProductId } from '../types/game';
import {
  appendProductPriceHistory,
  PRODUCT_PRICE_HISTORY_MAX,
  seedProductPriceHistory,
} from './priceHistoryCore';

export { appendProductPriceHistory, PRODUCT_PRICE_HISTORY_MAX, seedProductPriceHistory } from './priceHistoryCore';

export function normalizePriceHistory(
  history: unknown,
  currentPrice: number,
): number[] {
  if (!Array.isArray(history)) {
    return seedProductPriceHistory(currentPrice);
  }

  const cleaned = history
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length === 0) {
    return seedProductPriceHistory(currentPrice);
  }

  const last = cleaned[cleaned.length - 1];
  if (Math.abs(last - currentPrice) > 0.001) {
    return appendProductPriceHistory(cleaned, currentPrice);
  }

  return cleaned.slice(-PRODUCT_PRICE_HISTORY_MAX);
}

export function normalizeCityProductState(
  productState: CityProductState,
): CityProductState {
  const currentPrice = productState.currentPrice ?? productState.basePrice;
  return {
    ...productState,
    currentPrice,
    priceHistory: normalizePriceHistory(productState.priceHistory, currentPrice),
  };
}

export function normalizeCitiesPriceHistory(cities: City[]): City[] {
  return cities.map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([productId, productState]) => [
        productId,
        normalizeCityProductState(productState),
      ]),
    ) as City['products'],
  }));
}

export function updateCityProductPriceHistory(
  city: City,
  productId: ProductId,
  newPrice: number,
): City {
  const productState = city.products[productId];
  if (!productState) {
    return city;
  }

  return {
    ...city,
    products: {
      ...city.products,
      [productId]: {
        ...productState,
        currentPrice: newPrice,
        priceHistory: appendProductPriceHistory(productState.priceHistory, newPrice),
      },
    },
  };
}
