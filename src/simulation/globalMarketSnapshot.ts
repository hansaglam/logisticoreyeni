/**
 * Canonical global market snapshot.
 *
 * IMPORTANT: generation only depends on the global epoch/config/catalog/event
 * inputs. Player saves, installation time, level and Math.random are forbidden.
 */

import { CITIES } from '../data/cities';
import type {
  City,
  GlobalEconomy,
  GlobalEconomySnapshot,
  GlobalMarketHistoryEntry,
  ProductId,
  WorldEvent,
} from '../types/game';
import {
  ECONOMY_CONFIG_VERSION,
  getEconomyNow,
  getMarketEpoch,
  getMarketEpochStartMs,
  getNextMarketTickAt,
  MARKET_TICK_INTERVAL_MS,
} from './economyClock';
import {
  DEFAULT_GLOBAL_ECONOMY,
  FUEL_PRICE_MAX_PER_LITER,
  FUEL_PRICE_MIN_PER_LITER,
  normalizeGlobalEconomy,
  sanitizeFuelPricePerLiter,
} from './economy';
import { clampPrice } from './marketEconomyCalculations';

export const GLOBAL_MARKET_SEED = 'logisticore-global-market-v2';
export { ECONOMY_CONFIG_VERSION };
export type { GlobalEconomySnapshot, GlobalMarketHistoryEntry };
export {
  FUEL_PRICE_MAX_PER_LITER,
  FUEL_PRICE_MIN_PER_LITER,
  sanitizeFuelPricePerLiter,
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic 0..1 RNG. Never replace with Math.random for global data. */
export function createMarketSeededRng(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function buildMarketSeed(
  epoch: number,
  cityId: string,
  productId: string,
  configVersion = ECONOMY_CONFIG_VERSION,
): string {
  return `${GLOBAL_MARKET_SEED}|${configVersion}|${epoch}|${cityId}|${productId}`;
}

export function resolveActiveEventModifiers(events: WorldEvent[] | undefined): {
  fuelMultiplier: number;
  maintenanceMultiplier: number;
  demandMultiplier: number;
} {
  let fuelMultiplier = 1;
  let maintenanceMultiplier = 1;
  let demandMultiplier = 1;
  for (const event of events ?? []) {
    if (!event.isActive) continue;
    const impact = event.impact;
    if (Number.isFinite(impact?.fuelPriceMultiplier)) {
      fuelMultiplier *= Math.max(0.75, Math.min(1.35, impact.fuelPriceMultiplier!));
    }
    if (Number.isFinite(impact?.maintenanceCostMultiplier)) {
      maintenanceMultiplier *= Math.max(
        0.5,
        Math.min(1.5, impact.maintenanceCostMultiplier!),
      );
    }
    if (Number.isFinite(impact?.productDemandMultiplier)) {
      demandMultiplier *= Math.max(
        0.5,
        Math.min(1.5, impact.productDemandMultiplier!),
      );
    }
  }
  return { fuelMultiplier, maintenanceMultiplier, demandMultiplier };
}

/**
 * Global event schedule. Event windows are a pure function of epoch/config.
 * A backend can replace this policy while keeping the repository contract.
 */
export function buildGlobalEventsForEpoch(
  epoch: number,
  configVersion = ECONOMY_CONFIG_VERSION,
): WorldEvent[] {
  const cycleStart = epoch - (epoch % 24);
  const slot = hashString(`${GLOBAL_MARKET_SEED}|event|${configVersion}|${cycleStart}`) % 5;
  if (slot > 1 || epoch - cycleStart >= 6) return [];

  const isFuelCrisis = slot === 0;
  const startsAt = getMarketEpochStartMs(cycleStart);
  const endsAt = getMarketEpochStartMs(cycleStart + 6);
  return [{
    id: `global-${configVersion}-${cycleStart}-${isFuelCrisis ? 'fuel' : 'demand'}`,
    type: isFuelCrisis ? 'fuel_crisis' : 'city_demand_boom',
    title: isFuelCrisis ? 'Küresel Yakıt Baskısı' : 'Küresel Talep Dalgası',
    description: isFuelCrisis
      ? 'Dünya genelinde yakıt tedariki geçici baskı altında.'
      : 'Dünya piyasalarında ürün talebi yükseliyor.',
    startsAtDay: cycleStart,
    endsAtDay: cycleStart + 6,
    durationDays: 1,
    startsAt,
    endsAt,
    globalEpoch: cycleStart,
    economyConfigVersion: configVersion,
    impact: isFuelCrisis
      ? { fuelPriceMultiplier: 1.12 }
      : { productDemandMultiplier: 1.08 },
    severity: isFuelCrisis ? 'high' : 'medium',
    isActive: true,
  }];
}

function getCatalog(cities?: City[]): City[] {
  // Callers may pass a catalog subset for focused tests. Runtime state values
  // (currentPrice, stock, history) are intentionally ignored below.
  return cities?.length ? cities : CITIES;
}

function getDeterministicPrice(
  epoch: number,
  configVersion: number,
  cityId: string,
  productId: ProductId,
  basePrice: number,
  eventMultiplier: number,
): number {
  const rng = createMarketSeededRng(buildMarketSeed(epoch, cityId, productId, configVersion));
  const slowWave = Math.sin((epoch + (hashString(cityId) % 31)) / 13) * 0.075;
  const productWave = Math.sin((epoch + (hashString(productId) % 17)) / 5) * 0.04;
  const jitter = (rng() - 0.5) * 0.035;
  return clampPrice(basePrice * (1 + slowWave + productWave + jitter) * eventMultiplier, basePrice);
}

export function buildGlobalEconomySnapshot(params: {
  /** Deprecated compatibility input; runtime values do not influence generation. */
  globalEconomy?: GlobalEconomy | null;
  /** Catalog or catalog subset. currentPrice/stock/history are ignored. */
  cities?: City[];
  /** Backend supplied global events; omitted means deterministic global schedule. */
  activeEvents?: WorldEvent[];
  nowMs?: number;
  epoch?: number;
  configVersion?: number;
} = {}): GlobalEconomySnapshot {
  const nowMs = params.nowMs ?? getEconomyNow();
  const epoch = params.epoch ?? getMarketEpoch(nowMs);
  const configVersion = params.configVersion ?? ECONOMY_CONFIG_VERSION;
  const generatedAt = getMarketEpochStartMs(epoch);
  const validUntil = getMarketEpochStartMs(epoch + 1);
  const activeEvents = (
    params.activeEvents ?? buildGlobalEventsForEpoch(epoch, configVersion)
  ).filter((event) => event.isActive);
  const modifiers = resolveActiveEventModifiers(activeEvents);

  // The canonical base is config-owned, never player-save-owned.
  const baseEconomy = normalizeGlobalEconomy(DEFAULT_GLOBAL_ECONOMY);
  const fuelRng = createMarketSeededRng(
    `${GLOBAL_MARKET_SEED}|fuel|${configVersion}|${epoch}`,
  );
  const fuelWave = Math.sin(epoch / 11) * 0.045 + (fuelRng() - 0.5) * 0.025;
  const fuelPricePerLiter = sanitizeFuelPricePerLiter(
    baseEconomy.fuelPrice * (1 + fuelWave) * modifiers.fuelMultiplier,
  );

  const cityMarketPrices: GlobalEconomySnapshot['cityMarketPrices'] = {};
  const supplyDemandState: GlobalEconomySnapshot['supplyDemandState'] = {};
  const marketMovements: GlobalEconomySnapshot['marketMovements'] = [];
  const catalog = getCatalog(params.cities);

  for (const city of catalog) {
    cityMarketPrices[city.id] = {};
    supplyDemandState[city.id] = {};
    for (const [rawProductId, product] of Object.entries(city.products)) {
      const productId = rawProductId as ProductId;
      const basePrice = Math.max(0.01, product.basePrice || 1);
      const eventMultiplier = activeEvents.some(
        (event) =>
          (!event.cityId || event.cityId === city.id) &&
          (!event.productId || event.productId === productId),
      )
        ? modifiers.demandMultiplier
        : 1;
      const price = getDeterministicPrice(
        epoch,
        configVersion,
        city.id,
        productId,
        basePrice,
        eventMultiplier,
      );
      const previousPrice = getDeterministicPrice(
        epoch - 1,
        configVersion,
        city.id,
        productId,
        basePrice,
        eventMultiplier,
      );
      const sdRng = createMarketSeededRng(
        `${GLOBAL_MARKET_SEED}|supply|${configVersion}|${epoch}|${city.id}|${productId}`,
      );
      const supply = Math.max(
        0,
        Math.round(product.targetStock * (0.65 + sdRng() * 0.8)),
      );
      const demand = Math.max(
        1,
        Math.round(
          (product.consumptionPerDay || product.targetStock * 0.08) *
            (0.8 + sdRng() * 0.5) *
            eventMultiplier,
        ),
      );
      const ratio = supply / Math.max(1, product.targetStock);
      const movementPercent =
        previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0;

      cityMarketPrices[city.id]![productId] = price;
      supplyDemandState[city.id]![productId] = {
        supply,
        demand,
        status: ratio < 0.7 ? 'shortage' : ratio > 1.2 ? 'surplus' : 'balanced',
      };
      marketMovements.push({
        cityId: city.id,
        productId,
        price,
        previousPrice,
        movementPercent,
        direction: movementPercent > 0.15 ? 'up' : movementPercent < -0.15 ? 'down' : 'flat',
      });
    }
  }

  const opportunities: GlobalEconomySnapshot['opportunities'] = [];
  const productIds = Array.from(
    new Set(catalog.flatMap((city) => Object.keys(city.products) as ProductId[])),
  );
  for (const productId of productIds) {
    const prices = catalog
      .map((city) => ({ cityId: city.id, price: cityMarketPrices[city.id]?.[productId] }))
      .filter((entry): entry is { cityId: string; price: number } => Number.isFinite(entry.price));
    if (prices.length < 2) continue;
    prices.sort((a, b) => a.price - b.price);
    const low = prices[0]!;
    const high = prices[prices.length - 1]!;
    const marginPercent = ((high.price - low.price) / Math.max(0.01, low.price)) * 100;
    if (marginPercent >= 4) {
      opportunities.push({
        id: `${epoch}-${productId}-${low.cityId}-${high.cityId}`,
        fromCityId: low.cityId,
        toCityId: high.cityId,
        productId,
        buyPrice: low.price,
        sellPrice: high.price,
        marginPercent,
      });
    }
  }
  opportunities.sort((a, b) => b.marginPercent - a.marginPercent);
  const significantMovements = marketMovements.filter(
    (movement) => Math.abs(movement.movementPercent) >= 1,
  ).length;
  const worldStatus = activeEvents.some((event) => event.severity === 'high')
    ? 'crisis'
    : significantMovements > marketMovements.length * 0.45
      ? 'volatile'
      : 'stable';

  return {
    version: 2,
    configVersion,
    economyConfigVersion: configVersion,
    epoch,
    generatedAt,
    validUntil,
    fuelPricePerLiter,
    cityMarketPrices,
    supplyDemandState,
    marketMovements,
    opportunities,
    marketMovementCount: significantMovements,
    globalOpportunityCount: opportunities.length,
    worldStatus,
    activeEvents,
    modifiers,
  };
}

export function buildGlobalMarketHistoryEntries(
  snapshot: GlobalEconomySnapshot,
): GlobalMarketHistoryEntry[] {
  return snapshot.marketMovements.map((movement) => {
    const supplyDemand =
      snapshot.supplyDemandState[movement.cityId]?.[movement.productId];
    return {
      epoch: snapshot.epoch,
      generatedAt: snapshot.generatedAt,
      cityId: movement.cityId,
      productId: movement.productId,
      price: movement.price,
      supply: supplyDemand?.supply ?? 0,
      demand: supplyDemand?.demand ?? 0,
      movementPercent: movement.movementPercent,
      activeEventIds: snapshot.activeEvents.map((event) => event.id),
      configVersion: snapshot.configVersion,
    };
  });
}

/** Converts the global snapshot/history into the legacy City view model. */
export function buildGlobalMarketHistoryPriceIndex(
  history: GlobalMarketHistoryEntry[],
): Map<string, number[]> {
  const buckets = new Map<string, Array<{ epoch: number; price: number }>>();
  for (const entry of history) {
    const key = `${entry.cityId}:${entry.productId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push({ epoch: entry.epoch, price: entry.price });
  }

  const index = new Map<string, number[]>();
  for (const [key, bucket] of buckets) {
    bucket.sort((left, right) => left.epoch - right.epoch);
    index.set(
      key,
      bucket.map((item) => item.price),
    );
  }
  return index;
}

/** Converts the global snapshot/history into the legacy City view model. */
export function materializeSnapshotCities(
  catalog: City[],
  snapshot: GlobalEconomySnapshot,
  history: GlobalMarketHistoryEntry[] = [],
): City[] {
  const historyIndex = buildGlobalMarketHistoryPriceIndex(history);
  return catalog.map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([rawProductId, product]) => {
        const productId = rawProductId as ProductId;
        const sd = snapshot.supplyDemandState[city.id]?.[productId];
        const prices = historyIndex.get(`${city.id}:${productId}`) ?? [];
        return [productId, {
          ...product,
          stock: sd?.supply ?? product.stock,
          currentPrice:
            snapshot.cityMarketPrices[city.id]?.[productId] ?? product.basePrice,
          priceHistory: prices,
        }];
      }),
    ) as City['products'],
  }));
}

export function getSnapshotFuelPrice(
  snapshot: GlobalEconomySnapshot | null | undefined,
  fallbackEconomy?: GlobalEconomy | null,
): number {
  return sanitizeFuelPricePerLiter(
    snapshot?.fuelPricePerLiter ??
      normalizeGlobalEconomy(fallbackEconomy ?? DEFAULT_GLOBAL_ECONOMY).fuelPrice,
  );
}

export function applyFuelPriceSanitizationToEconomy(
  globalEconomy: GlobalEconomy | null | undefined,
): GlobalEconomy {
  const normalized = normalizeGlobalEconomy(globalEconomy ?? {});
  return {
    ...normalized,
    fuelPrice: sanitizeFuelPricePerLiter(normalized.fuelPrice),
  };
}

export { MARKET_TICK_INTERVAL_MS, getMarketEpoch, getNextMarketTickAt };
