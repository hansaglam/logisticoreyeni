/**
 * LogistiCore - Ekonomi simülasyon motoru
 *
 * Şehirlerin günlük üretim, tüketim, stok ve fiyat güncellemelerini yönetir.
 * Tüm güncelleme fonksiyonları orijinal veriyi mutate etmez; yeni obje döndürür.
 */

import type {
  City,
  CityProductState,
  EconomyRandomFactors,
  GlobalEconomy,
  ProductId,
  ProductMarket,
} from '../types/game';
import { PRODUCT_IDS } from '../data/products';
import { economyBalance } from '../config/balance';
import { clamp, randomBetween } from '../utils/math';
import { appendProductPriceHistory } from '../utils/priceHistoryCore';
import { clampPrice } from './marketEconomyCalculations';
import { applyMarketPriceMicroMove } from './marketPriceTick';

export { clampPrice } from './marketEconomyCalculations';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** scarcityMultiplier alt/üst sınırları */
const SCARCITY_MIN = 0.4;
const SCARCITY_MAX = 2.5;

/** Yüksek fiyat tüketimi en fazla bu oranda baskılar */
const PRICE_RESISTANCE_MIN = 0.5;

/** Düşük fiyat tüketimi en fazla bu oranda artırır */
const PRICE_RESISTANCE_MAX = 1.5;

/** stockRatio hesabında sıfıra bölmeyi önlemek için minimum hedef stok */
const MIN_TARGET_STOCK = 1;

/** stockRatio clamp aralığı — aşırı uç değerleri sınırlar */
const STOCK_RATIO_MIN = 0.05;
const STOCK_RATIO_MAX = 5;

/** Varsayılan fiyat yumuşatma — GlobalEconomy'de override edilebilir */
const DEFAULT_PRICE_SMOOTHING = 0.2;

export function safeEconomyNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function getBaseFuelPrice(): number {
  const base = economyBalance?.baseFuelPrice;
  if (typeof base === 'number' && Number.isFinite(base) && base > 0) {
    return base;
  }
  return 1.72;
}

/** Canonical yakıt fiyat aralığı ($/L) — bozuk save / cents / çift ×100 koruması */
export const FUEL_PRICE_MIN_PER_LITER = 0.8;
export const FUEL_PRICE_MAX_PER_LITER = 5.0;

function resolveFuelSanitizeFallback(fallback?: number | null): number {
  const base = getBaseFuelPrice();
  if (fallback == null || !Number.isFinite(fallback) || fallback <= 0) {
    return base;
  }
  // last-valid yalnızca güvenli aralıktaysa kullanılır; asla MAX'a clamp edilmez
  if (fallback < FUEL_PRICE_MIN_PER_LITER || fallback > FUEL_PRICE_MAX_PER_LITER) {
    return base;
  }
  return Math.round(fallback * 100) / 100;
}

/**
 * Internal birim: dolar/litre — $1,529/L gibi değerleri düzeltir.
 * Bozuk değerleri FUEL_PRICE_MAX'a (5.0) sabitlemez; canonical base veya last-valid kullanır.
 */
export function sanitizeFuelPricePerLiter(
  raw: number | undefined | null,
  options?: { fallback?: number | null },
): number {
  const safeFallback = resolveFuelSanitizeFallback(options?.fallback);
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return safeFallback;
  }
  let value = raw;
  // Cents karışımı veya ×100 hatası — yalnızca aşırı büyük değerlerde ölçekle
  if (value > FUEL_PRICE_MAX_PER_LITER * 10) {
    value = value / 100;
  }
  if (value > FUEL_PRICE_MAX_PER_LITER * 10) {
    value = value / 100;
  }
  if (
    !Number.isFinite(value) ||
    value < FUEL_PRICE_MIN_PER_LITER ||
    value > FUEL_PRICE_MAX_PER_LITER
  ) {
    return safeFallback;
  }
  return Math.round(value * 100) / 100;
}

export function createDefaultGlobalEconomy(): GlobalEconomy {
  return {
    fuelPrice: getBaseFuelPrice(),
    globalDemandMultiplier: economyBalance.globalDemandDefault ?? 1,
    globalProductionMultiplier: economyBalance.globalProductionDefault ?? 1,
    eventMultiplier: 1,
    marketVolatility: economyBalance.marketVolatility ?? 0.08,
    priceSmoothing: DEFAULT_PRICE_SMOOTHING,
  };
}

/** Varsayılan küresel ekonomi — oyun başlangıcı ve testler için */
export const DEFAULT_GLOBAL_ECONOMY: GlobalEconomy = createDefaultGlobalEconomy();

function globalEconomyNeededFallback(raw: Record<string, unknown>): boolean {
  if (Object.keys(raw).length === 0) {
    return true;
  }

  const requiredKeys = [
    'fuelPrice',
    'globalDemandMultiplier',
    'globalProductionMultiplier',
    'eventMultiplier',
    'marketVolatility',
  ];

  for (const key of requiredKeys) {
    const value = raw[key];
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return true;
    }
  }

  if (
    raw.priceSmoothing !== undefined &&
    typeof raw.priceSmoothing === 'number' &&
    !Number.isFinite(raw.priceSmoothing)
  ) {
    return true;
  }

  return false;
}

/** Save/load ve runtime için eksik veya bozuk globalEconomy alanlarını tamamlar */
export function normalizeGlobalEconomy(
  rawGlobalEconomy: unknown,
  options?: { logFallback?: boolean },
): GlobalEconomy {
  const defaults = createDefaultGlobalEconomy();

  if (
    rawGlobalEconomy == null ||
    typeof rawGlobalEconomy !== 'object' ||
    Array.isArray(rawGlobalEconomy)
  ) {
    if (options?.logFallback && __DEV__) {
      console.log('[saveGame] globalEconomy normalized with fallback values');
    }
    return { ...defaults };
  }

  const raw = rawGlobalEconomy as Record<string, unknown>;
  const normalized: GlobalEconomy = {
    fuelPrice: sanitizeFuelPricePerLiter(
      safeEconomyNumber(raw.fuelPrice, defaults.fuelPrice),
    ),
    globalDemandMultiplier: safeEconomyNumber(
      raw.globalDemandMultiplier,
      defaults.globalDemandMultiplier,
    ),
    globalProductionMultiplier: safeEconomyNumber(
      raw.globalProductionMultiplier,
      defaults.globalProductionMultiplier,
    ),
    eventMultiplier: safeEconomyNumber(raw.eventMultiplier, defaults.eventMultiplier),
    marketVolatility: safeEconomyNumber(raw.marketVolatility, defaults.marketVolatility),
    priceSmoothing: safeEconomyNumber(
      raw.priceSmoothing,
      defaults.priceSmoothing ?? DEFAULT_PRICE_SMOOTHING,
    ),
  };

  if (options?.logFallback && __DEV__ && globalEconomyNeededFallback(raw)) {
    console.log('[saveGame] globalEconomy normalized with fallback values');
  }

  return normalized;
}

export function getSafeFuelPrice(globalEconomy?: GlobalEconomy | null): number {
  return sanitizeFuelPricePerLiter(
    safeEconomyNumber(globalEconomy?.fuelPrice, getBaseFuelPrice()),
  );
}

export function getSafeGlobalEconomy(globalEconomy?: GlobalEconomy | null): GlobalEconomy {
  return normalizeGlobalEconomy(globalEconomy ?? {});
}

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

export { clamp, randomBetween } from '../utils/math';

/**
 * marketVolatility etrafında günlük rastgele çarpan üretir.
 * Örn. volatility=0.08 → [0.92, 1.08]
 */
export function createRandomFactor(volatility: number): number {
  return randomBetween(1 - volatility, 1 + volatility);
}

/** CityProductState → ProductMarket dönüşümü; currentPrice yoksa basePrice kullanılır */
export function toProductMarket(state: CityProductState): ProductMarket {
  return {
    ...state,
    currentPrice: state.currentPrice ?? state.basePrice,
  };
}

/** Stok / hedef stok oranını güvenli aralıkta hesaplar */
export function calculateStockRatio(stock: number, targetStock: number): number {
  const safeTarget = Math.max(targetStock, MIN_TARGET_STOCK);
  return clamp(stock / safeTarget, STOCK_RATIO_MIN, STOCK_RATIO_MAX);
}

/**
 * Stok oranına göre kıtlık çarpanı.
 * Düşük stok → yüksek çarpan (fiyat artış baskısı).
 * Yüksek stok → düşük çarpan (fiyat düşüş baskısı).
 */
export function calculateScarcityMultiplier(stockRatio: number): number {
  // stockRatio 1.0 iken scarcity ≈ 1.0; ters orantılı ilişki
  const raw = 1 / stockRatio;
  return clamp(raw, SCARCITY_MIN, SCARCITY_MAX);
}

/**
 * Güncel fiyata göre tüketim direnci.
 * Fiyat yükseldikçe tüketim azalır; düştükçe artar.
 */
export function calculatePriceResistance(currentPrice: number, basePrice: number): number {
  const safeBase = Math.max(basePrice, 1);
  const safeCurrent = Math.max(currentPrice, 1);
  return clamp(safeBase / safeCurrent, PRICE_RESISTANCE_MIN, PRICE_RESISTANCE_MAX);
}

/** Test ve simülasyon için günlük rastgele çarpan seti üretir */
export function createEconomyRandomFactors(globalEconomy: GlobalEconomy): EconomyRandomFactors {
  const marketVolatility = safeEconomyNumber(
    globalEconomy.marketVolatility,
    economyBalance.marketVolatility ?? 0.08,
  );
  return {
    production: createRandomFactor(marketVolatility),
    consumption: createRandomFactor(marketVolatility),
    price: createRandomFactor(marketVolatility),
  };
}

// ---------------------------------------------------------------------------
// Üretim, tüketim ve fiyat hesapları
// ---------------------------------------------------------------------------

/**
 * Günlük üretim miktarını hesaplar (ton).
 *
 * dailyProduction =
 *   productionPerDay
 *   × city.productionMultiplier
 *   × globalProductionMultiplier
 *   × eventMultiplier
 *   × randomFactor
 */
export function calculateProduction(
  city: City,
  productMarket: ProductMarket,
  globalEconomy: GlobalEconomy,
  randomFactor?: number,
): number {
  const marketVolatility = safeEconomyNumber(
    globalEconomy.marketVolatility,
    economyBalance.marketVolatility ?? 0.08,
  );
  const factor = randomFactor ?? createRandomFactor(marketVolatility);

  const dailyProduction =
    productMarket.productionPerDay *
    city.productionMultiplier *
    safeEconomyNumber(globalEconomy.globalProductionMultiplier, 1) *
    safeEconomyNumber(globalEconomy.eventMultiplier, 1) *
    factor;

  return Math.max(0, dailyProduction);
}

/**
 * Günlük tüketim miktarını hesaplar (ton).
 *
 * dailyConsumption =
 *   consumptionPerDay
 *   × city.demandMultiplier
 *   × globalDemandMultiplier
 *   × priceResistance
 *   × randomFactor
 */
export function calculateConsumption(
  city: City,
  productMarket: ProductMarket,
  globalEconomy: GlobalEconomy,
  randomFactor?: number,
): number {
  const marketVolatility = safeEconomyNumber(
    globalEconomy.marketVolatility,
    economyBalance.marketVolatility ?? 0.08,
  );
  const factor = randomFactor ?? createRandomFactor(marketVolatility);
  const priceResistance = calculatePriceResistance(
    productMarket.currentPrice,
    productMarket.basePrice,
  );

  const dailyConsumption =
    productMarket.consumptionPerDay *
    city.demandMultiplier *
    safeEconomyNumber(globalEconomy.globalDemandMultiplier, 1) *
    priceResistance *
    factor;

  return Math.max(0, dailyConsumption);
}

/**
 * Stok durumuna göre yeni piyasa fiyatını hesaplar ($).
 *
 * stockRatio = stock / targetStock
 * scarcityMultiplier = f(stockRatio) — düşük stokta yüksek
 *
 * rawPrice = basePrice × scarcityMultiplier × globalDemandMultiplier × randomFactor
 * smoothedPrice = oldPrice + (rawPrice - oldPrice) × priceSmoothing
 */
export function calculateDynamicPrice(
  productMarket: ProductMarket,
  globalEconomy: GlobalEconomy,
  randomFactor?: number,
): number {
  const marketVolatility = safeEconomyNumber(
    globalEconomy.marketVolatility,
    economyBalance.marketVolatility ?? 0.08,
  );
  const factor = randomFactor ?? createRandomFactor(marketVolatility);
  const priceSmoothing = safeEconomyNumber(
    globalEconomy.priceSmoothing,
    DEFAULT_PRICE_SMOOTHING,
  );

  const stockRatio = calculateStockRatio(productMarket.stock, productMarket.targetStock);
  const scarcityMultiplier = calculateScarcityMultiplier(stockRatio);

  const rawPrice =
    productMarket.basePrice *
    scarcityMultiplier *
    safeEconomyNumber(globalEconomy.globalDemandMultiplier, 1) *
    factor;

  const oldPrice = productMarket.currentPrice;
  const smoothedPrice = oldPrice + (rawPrice - oldPrice) * priceSmoothing;

  return clampPrice(smoothedPrice, productMarket.basePrice);
}

// ---------------------------------------------------------------------------
// Şehir güncelleme
// ---------------------------------------------------------------------------

/**
 * Tek bir ürünün günlük ekonomisini günceller.
 * Sıra: üretim → tüketim → stok → fiyat (GDD döngüsüne uygun).
 */
export function updateCityProductEconomy(
  city: City,
  productId: ProductId,
  globalEconomy: GlobalEconomy,
  randomFactors?: EconomyRandomFactors,
): City {
  const factors = randomFactors ?? createEconomyRandomFactors(globalEconomy);
  const productMarket = toProductMarket(city.products[productId]);

  const dailyProduction = calculateProduction(
    city,
    productMarket,
    globalEconomy,
    factors.production,
  );

  const dailyConsumption = calculateConsumption(
    city,
    productMarket,
    globalEconomy,
    factors.consumption,
  );

  // Stok güncelle — asla 0'ın altına inmez
  const newStock = Math.max(0, productMarket.stock + dailyProduction - dailyConsumption);

  // Fiyat, güncellenmiş stok seviyesine göre hesaplanır
  const marketAfterStock: ProductMarket = {
    ...productMarket,
    stock: newStock,
  };

  const newPrice = calculateDynamicPrice(marketAfterStock, globalEconomy, factors.price);

  const stockRatio = calculateStockRatio(newStock, productMarket.targetStock);
  const historyLength = Array.isArray(productMarket.priceHistory)
    ? productMarket.priceHistory.length
    : 0;
  const marketVolatility = safeEconomyNumber(
    globalEconomy.marketVolatility,
    economyBalance.marketVolatility ?? 0.08,
  );

  const microPrice = applyMarketPriceMicroMove({
    cityId: city.id,
    productId,
    previousPrice: productMarket.currentPrice,
    targetPrice: newPrice,
    basePrice: productMarket.basePrice,
    stockRatio,
    tickIndex: historyLength,
    globalVolatility: marketVolatility / 0.08,
  });

  const updatedProduct: CityProductState = {
    ...productMarket,
    stock: newStock,
    currentPrice: microPrice,
    priceHistory: appendProductPriceHistory(productMarket.priceHistory, microPrice),
  };

  return {
    ...city,
    products: {
      ...city.products,
      [productId]: updatedProduct,
    },
  };
}

/** Bir şehirdeki tüm ürünlerin günlük ekonomisini günceller */
export function updateCityEconomy(
  city: City,
  globalEconomy: GlobalEconomy,
  randomFactorsByProduct?: Partial<Record<ProductId, EconomyRandomFactors>>,
): City {
  let updatedCity = city;

  for (const productId of PRODUCT_IDS) {
    const factors = randomFactorsByProduct?.[productId];
    updatedCity = updateCityProductEconomy(updatedCity, productId, globalEconomy, factors);
  }

  return updatedCity;
}

/** Tüm şehirlerin ekonomisini günlük olarak ilerletir */
export function updateAllCitiesEconomy(
  cities: Record<string, City>,
  globalEconomy: GlobalEconomy,
  randomFactorsByCity?: Partial<Record<string, Partial<Record<ProductId, EconomyRandomFactors>>>>,
): Record<string, City> {
  const updatedEntries = Object.entries(cities).map(([cityId, city]) => {
    const cityFactors = randomFactorsByCity?.[cityId];
    const updatedCity = updateCityEconomy(city, globalEconomy, cityFactors);
    return [cityId, updatedCity] as const;
  });

  return Object.fromEntries(updatedEntries);
}

// ---------------------------------------------------------------------------
// Örnek kullanım (yorum — çalıştırılmaz)
// ---------------------------------------------------------------------------

/*
import { CITIES_BY_ID } from '../data/cities';
import {
  DEFAULT_GLOBAL_ECONOMY,
  updateAllCitiesEconomy,
} from './economy';

// Başlangıç şehir verisinin derin kopyası
const cities = structuredClone(CITIES_BY_ID);

// Bir oyun günü ilerlet
const nextDayCities = updateAllCitiesEconomy(cities, DEFAULT_GLOBAL_ECONOMY);

// İzmir'deki meyve stok ve fiyatına bak
const izmirFruit = nextDayCities.izmir.products.fruit;
console.log(izmirFruit.stock, izmirFruit.currentPrice);
*/
