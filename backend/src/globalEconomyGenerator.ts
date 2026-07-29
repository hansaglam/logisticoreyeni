import {
  CANONICAL_CITY_MARKET_CATALOG,
  ECONOMY_CONFIG_VERSION,
  MARKET_TICK_INTERVAL_MS,
} from './generated/canonicalInputs';

export const GLOBAL_MARKET_SEED = 'logisticore-global-market-v2';
const BASE_FUEL_PRICE = 1.72;
const FUEL_MIN = 0.8;
const FUEL_MAX = 5;

type ProductId = keyof (typeof CANONICAL_CITY_MARKET_CATALOG)[number]['products'];

export interface WorkerWorldEvent {
  id: string;
  type: 'fuel_crisis' | 'city_demand_boom';
  title: string;
  description: string;
  startsAtDay: number;
  endsAtDay: number;
  durationDays: number;
  startsAt: number;
  endsAt: number;
  globalEpoch: number;
  economyConfigVersion: number;
  impact: {
    fuelPriceMultiplier?: number;
    productDemandMultiplier?: number;
  };
  severity: 'medium' | 'high';
  isActive: true;
}

export interface WorkerGlobalEconomySnapshot {
  version: 2;
  configVersion: number;
  economyConfigVersion: number;
  epoch: number;
  generatedAt: number;
  validUntil: number;
  fuelPricePerLiter: number;
  cityMarketPrices: Record<string, Record<string, number>>;
  supplyDemandState: Record<
    string,
    Record<string, { supply: number; demand: number; status: string }>
  >;
  marketMovements: Array<{
    cityId: string;
    productId: string;
    price: number;
    previousPrice: number;
    movementPercent: number;
    direction: 'up' | 'down' | 'flat';
  }>;
  opportunities: Array<{
    id: string;
    fromCityId: string;
    toCityId: string;
    productId: string;
    buyPrice: number;
    sellPrice: number;
    marginPercent: number;
  }>;
  marketMovementCount: number;
  globalOpportunityCount: number;
  worldStatus: 'stable' | 'volatile' | 'crisis';
  activeEvents: WorkerWorldEvent[];
  modifiers: {
    fuelMultiplier: number;
    maintenanceMultiplier: number;
    demandMultiplier: number;
  };
}

export interface WorkerHistoryEntry {
  epoch: number;
  configVersion: number;
  generatedAt: number;
  cityId: string;
  productId: string;
  price: number;
  supply: number;
  demand: number;
  movementPercent: number;
  activeEventIds: string[];
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function marketSeed(
  epoch: number,
  cityId: string,
  productId: string,
  configVersion: number,
): string {
  return `${GLOBAL_MARKET_SEED}|${configVersion}|${epoch}|${cityId}|${productId}`;
}

function epochStart(epoch: number): number {
  return epoch * MARKET_TICK_INTERVAL_MS;
}

function clampPrice(price: number, basePrice: number): number {
  return Math.max(basePrice * 0.4, Math.min(basePrice * 2.5, price));
}

function sanitizeFuelPrice(value: number): number {
  if (!Number.isFinite(value) || value < FUEL_MIN || value > FUEL_MAX) {
    return BASE_FUEL_PRICE;
  }
  return Math.round(value * 100) / 100;
}

export function getMarketEpochFromServerTime(serverTimeMs: number): number {
  return Math.floor(Math.max(0, serverTimeMs) / MARKET_TICK_INTERVAL_MS);
}

export function resolveWorkerConfigVersion(): number {
  const configured = Number(
    process.env.ECONOMY_CONFIG_VERSION ?? ECONOMY_CONFIG_VERSION,
  );
  if (
    !Number.isInteger(configured) ||
    configured <= 0 ||
    configured !== ECONOMY_CONFIG_VERSION
  ) {
    throw new Error(
      `ECONOMY_CONFIG_VERSION_MISMATCH:${configured}:${ECONOMY_CONFIG_VERSION}`,
    );
  }
  return configured;
}

export function buildGlobalEventsForEpoch(
  epoch: number,
  configVersion: number,
): WorkerWorldEvent[] {
  const cycleStart = epoch - (epoch % 24);
  const slot =
    hashString(`${GLOBAL_MARKET_SEED}|event|${configVersion}|${cycleStart}`) % 5;
  if (slot > 1 || epoch - cycleStart >= 6) return [];
  const fuelCrisis = slot === 0;
  return [{
    id: `global-${configVersion}-${cycleStart}-${fuelCrisis ? 'fuel' : 'demand'}`,
    type: fuelCrisis ? 'fuel_crisis' : 'city_demand_boom',
    title: fuelCrisis ? 'Küresel Yakıt Baskısı' : 'Küresel Talep Dalgası',
    description: fuelCrisis
      ? 'Dünya genelinde yakıt tedariki geçici baskı altında.'
      : 'Dünya piyasalarında ürün talebi yükseliyor.',
    startsAtDay: cycleStart,
    endsAtDay: cycleStart + 6,
    durationDays: 1,
    startsAt: epochStart(cycleStart),
    endsAt: epochStart(cycleStart + 6),
    globalEpoch: cycleStart,
    economyConfigVersion: configVersion,
    impact: fuelCrisis
      ? { fuelPriceMultiplier: 1.12 }
      : { productDemandMultiplier: 1.08 },
    severity: fuelCrisis ? 'high' : 'medium',
    isActive: true,
  }];
}

function deterministicPrice(
  epoch: number,
  configVersion: number,
  cityId: string,
  productId: string,
  basePrice: number,
  eventMultiplier: number,
): number {
  const rng = createSeededRng(
    marketSeed(epoch, cityId, productId, configVersion),
  );
  const slowWave = Math.sin((epoch + (hashString(cityId) % 31)) / 13) * 0.075;
  const productWave =
    Math.sin((epoch + (hashString(productId) % 17)) / 5) * 0.04;
  const jitter = (rng() - 0.5) * 0.035;
  return clampPrice(
    basePrice * (1 + slowWave + productWave + jitter) * eventMultiplier,
    basePrice,
  );
}

export function buildCanonicalSnapshot(
  epoch: number,
  configVersion = resolveWorkerConfigVersion(),
): WorkerGlobalEconomySnapshot {
  const activeEvents = buildGlobalEventsForEpoch(epoch, configVersion);
  const fuelMultiplier = activeEvents.reduce(
    (value, event) => value * (event.impact.fuelPriceMultiplier ?? 1),
    1,
  );
  const demandMultiplier = activeEvents.reduce(
    (value, event) => value * (event.impact.productDemandMultiplier ?? 1),
    1,
  );
  const fuelRng = createSeededRng(
    `${GLOBAL_MARKET_SEED}|fuel|${configVersion}|${epoch}`,
  );
  const fuelWave = Math.sin(epoch / 11) * 0.045 + (fuelRng() - 0.5) * 0.025;
  const cityMarketPrices: WorkerGlobalEconomySnapshot['cityMarketPrices'] = {};
  const supplyDemandState: WorkerGlobalEconomySnapshot['supplyDemandState'] = {};
  const marketMovements: WorkerGlobalEconomySnapshot['marketMovements'] = [];

  for (const city of CANONICAL_CITY_MARKET_CATALOG) {
    cityMarketPrices[city.id] = {};
    supplyDemandState[city.id] = {};
    for (const [productId, product] of Object.entries(city.products)) {
      const eventMultiplier = activeEvents.length > 0 ? demandMultiplier : 1;
      const price = deterministicPrice(
        epoch,
        configVersion,
        city.id,
        productId,
        product.basePrice,
        eventMultiplier,
      );
      const previousPrice = deterministicPrice(
        epoch - 1,
        configVersion,
        city.id,
        productId,
        product.basePrice,
        eventMultiplier,
      );
      const supplyRng = createSeededRng(
        `${GLOBAL_MARKET_SEED}|supply|${configVersion}|${epoch}|${city.id}|${productId}`,
      );
      const supply = Math.max(
        0,
        Math.round(product.targetStock * (0.65 + supplyRng() * 0.8)),
      );
      const demand = Math.max(
        1,
        Math.round(
          (product.consumptionPerDay || product.targetStock * 0.08) *
            (0.8 + supplyRng() * 0.5) *
            eventMultiplier,
        ),
      );
      const stockRatio = supply / Math.max(1, product.targetStock);
      const movementPercent =
        previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0;
      cityMarketPrices[city.id]![productId] = price;
      supplyDemandState[city.id]![productId] = {
        supply,
        demand,
        status:
          stockRatio < 0.7
            ? 'shortage'
            : stockRatio > 1.2
              ? 'surplus'
              : 'balanced',
      };
      marketMovements.push({
        cityId: city.id,
        productId,
        price,
        previousPrice,
        movementPercent,
        direction:
          movementPercent > 0.15
            ? 'up'
            : movementPercent < -0.15
              ? 'down'
              : 'flat',
      });
    }
  }

  const opportunities: WorkerGlobalEconomySnapshot['opportunities'] = [];
  const productIds = Object.keys(
    CANONICAL_CITY_MARKET_CATALOG[0]?.products ?? {},
  ) as ProductId[];
  for (const productId of productIds) {
    const prices = CANONICAL_CITY_MARKET_CATALOG.map((city) => ({
      cityId: city.id,
      price: cityMarketPrices[city.id]![productId]!,
    })).sort((left, right) => left.price - right.price);
    if (prices.length < 2) continue;
    const low = prices[0]!;
    const high = prices[prices.length - 1]!;
    const marginPercent =
      ((high.price - low.price) / Math.max(0.01, low.price)) * 100;
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
  opportunities.sort((left, right) => right.marginPercent - left.marginPercent);
  const marketMovementCount = marketMovements.filter(
    (movement) => Math.abs(movement.movementPercent) >= 1,
  ).length;

  return {
    version: 2,
    configVersion,
    economyConfigVersion: configVersion,
    epoch,
    generatedAt: epochStart(epoch),
    validUntil: epochStart(epoch + 1),
    fuelPricePerLiter: sanitizeFuelPrice(
      BASE_FUEL_PRICE * (1 + fuelWave) * fuelMultiplier,
    ),
    cityMarketPrices,
    supplyDemandState,
    marketMovements,
    opportunities,
    marketMovementCount,
    globalOpportunityCount: opportunities.length,
    worldStatus: activeEvents.some((event) => event.severity === 'high')
      ? 'crisis'
      : marketMovementCount > marketMovements.length * 0.45
        ? 'volatile'
        : 'stable',
    activeEvents,
    modifiers: {
      fuelMultiplier,
      maintenanceMultiplier: 1,
      demandMultiplier,
    },
  };
}

export function buildHistoryEntries(
  snapshot: WorkerGlobalEconomySnapshot,
): WorkerHistoryEntry[] {
  return snapshot.marketMovements.map((movement) => {
    const state =
      snapshot.supplyDemandState[movement.cityId]?.[movement.productId];
    return {
      epoch: snapshot.epoch,
      configVersion: snapshot.configVersion,
      generatedAt: snapshot.generatedAt,
      cityId: movement.cityId,
      productId: movement.productId,
      price: movement.price,
      supply: state?.supply ?? 0,
      demand: state?.demand ?? 0,
      movementPercent: movement.movementPercent,
      activeEventIds: snapshot.activeEvents.map((event) => event.id),
    };
  });
}
