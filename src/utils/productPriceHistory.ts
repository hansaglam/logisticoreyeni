/**
 * Ürün fiyat geçmişi — mini trend grafikleri için.
 */

import type { City, CityProductState, ProductId } from '../types/game';
import {
  enrichPriceHistory,
  generateMarketPriceHistory,
  shouldEnrichPriceHistory,
  type PriceHistoryGenerateContext,
} from './marketPriceHistoryGenerator';
import {
  appendProductPriceHistory,
  PRODUCT_PRICE_HISTORY_MAX,
} from './priceHistoryCore';

export { appendProductPriceHistory, PRODUCT_PRICE_HISTORY_MAX } from './priceHistoryCore';

export type { PriceHistoryGenerateContext } from './marketPriceHistoryGenerator';

function resolveStockStatus(productState: CityProductState): string {
  const stock = productState.stock ?? 0;
  const targetStock =
    productState.targetStock && productState.targetStock > 0
      ? productState.targetStock
      : Math.max(stock, 1);
  const ratio = stock / targetStock;

  if (ratio < 0.3) return 'Kritik Kıtlık';
  if (ratio < 0.7) return 'Kıtlık';
  if (ratio <= 1.2) return 'Dengeli';
  if (ratio <= 1.6) return 'Fazla';
  return 'Yüksek Fazla';
}

function buildPriceHistoryContext(
  productState: CityProductState,
  productId: ProductId | string,
  cityId: string,
): PriceHistoryGenerateContext {
  return {
    productId,
    cityId,
    basePrice: productState.basePrice,
    stock: productState.stock,
    targetStock: productState.targetStock,
    stockStatus: resolveStockStatus(productState),
  };
}

export function seedProductPriceHistory(
  price: number,
  context?: PriceHistoryGenerateContext,
): number[] {
  const safe = Math.max(price, 0.01);
  if (!context) {
    return generateMarketPriceHistory({
      endPrice: safe,
      productId: 'steel',
      cityId: 'default',
    });
  }
  return generateMarketPriceHistory({
    ...context,
    endPrice: safe,
    seed: `${context.cityId ?? 'city'}-${context.productId}-seed`,
  });
}

export function normalizePriceHistory(
  history: unknown,
  currentPrice: number,
  context?: PriceHistoryGenerateContext,
): number[] {
  const safePrice = Math.max(currentPrice, 0.01);

  if (!Array.isArray(history)) {
    return context
      ? seedProductPriceHistory(safePrice, context)
      : seedProductPriceHistory(safePrice);
  }

  const cleaned = history
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length === 0) {
    return context
      ? seedProductPriceHistory(safePrice, context)
      : seedProductPriceHistory(safePrice);
  }

  let result = cleaned;
  const last = cleaned[cleaned.length - 1];
  if (Math.abs(last - safePrice) > 0.001) {
    result = appendProductPriceHistory(cleaned, safePrice);
  }

  if (context && shouldEnrichPriceHistory(result)) {
    return enrichPriceHistory(result, {
      ...context,
      endPrice: safePrice,
    }).slice(-PRODUCT_PRICE_HISTORY_MAX);
  }

  return result.slice(-PRODUCT_PRICE_HISTORY_MAX);
}

export function normalizeCityProductState(
  productState: CityProductState,
  productId: ProductId,
  cityId: string,
): CityProductState {
  const currentPrice = productState.currentPrice ?? productState.basePrice;
  const context = buildPriceHistoryContext(productState, productId, cityId);

  return {
    ...productState,
    currentPrice,
    priceHistory: normalizePriceHistory(productState.priceHistory, currentPrice, context),
  };
}

export function normalizeCitiesPriceHistory(cities: City[]): City[] {
  return cities.map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([productId, productState]) => [
        productId,
        normalizeCityProductState(productState, productId as ProductId, city.id),
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
