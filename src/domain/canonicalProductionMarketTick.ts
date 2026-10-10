/**
 * Production market tick authority (Map V2 Step 29Z).
 *
 * Live production prices are a pure function of the global market epoch
 * (`buildGlobalEconomySnapshot`). Save city stock is not that clock.
 * Canonical tradable stock stays trade-owned. A tick replaces price and
 * epoch supply/demand only. Fixed 29U snapshots are not ticked until stamped.
 * Pure. No React. No Firebase.
 */

import { CITIES_BY_ID } from '../data/cities';
import type { ProductId } from '../types/game';
import { calculateShortage, calculateSurplus } from '../simulation/contracts';
import {
  ECONOMY_CONFIG_VERSION,
  MARKET_TICK_INTERVAL_MS,
  getMarketEpoch,
  getMarketEpochStartMs,
} from '../simulation/economyClock';
import { toProductMarket } from '../simulation/economy';
import {
  GLOBAL_MARKET_SEED,
  buildGlobalEconomySnapshot,
  buildGlobalEventsForEpoch,
} from '../simulation/globalMarketSnapshot';
import { CANONICAL_CARGO_MARKET_POLICY_VERSION } from './canonicalCargoMarketWorldState';

export const PRODUCTION_MARKET_TICK_AUTHORITY_STATUS =
  'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY' as const;
export const MARKET_OWNERSHIP_MODEL = 'GLOBAL_SHARED_MARKET' as const;
export const PRODUCTION_MARKET_RNG_PARITY =
  'PRODUCTION_MARKET_RNG_MATCHES_GLOBAL_SNAPSHOT_NOT_LOCAL_MATH_RANDOM' as const;
export const ROAD_CONTRACT_MARKET_STATE_STATUS =
  'ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY' as const;
export const PRODUCTION_MARKET_PUBLIC_READINESS = 'PUBLIC_MARKET_NOT_READY' as const;

export const CANONICAL_PRODUCTION_MARKET_TICK_ENV =
  'CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY' as const;
export const CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION =
  'canonical-production-market-tick-internal-v1' as const;
export const CANONICAL_MARKET_CLOCK_COLLECTION = 'canonicalMarketClock' as const;
export const CANONICAL_MARKET_CLOCK_DOC_ID = 'current' as const;
export const CANONICAL_MARKET_TICKS_COLLECTION = 'canonicalMarketTicks' as const;
export const CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE =
  'INTERNAL_PRODUCTION_MARKET_TICK' as const;

export const ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS = [
  'SAVE_CITY_STOCK_NOT_CANONICAL',
  'LOCAL_CONTRACT_WORLD_EVENTS',
  'PLAYER_LEVEL_FLEET_DRIVERS',
  'CONTRACT_AMOUNT_MATH_RANDOM',
  'PUBLIC_MARKET_UI_UNWIRED',
] as const;

const FORBIDDEN_CLIENT_KEYS = [
  'tickCount',
  'elapsed',
  'elapsedMs',
  'offlineDuration',
  'lastTickAt',
  'deviceNow',
  'periodIndex',
  'marketAge',
  'price',
  'currentPrice',
  'stock',
  'surplus',
  'shortage',
  'eventMultiplier',
  'seed',
  'targetUid',
] as const;

export type CanonicalProductionMarketTickGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalProductionMarketTickGate(options?: {
  envValue?: string | null;
}): CanonicalProductionMarketTickGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalProductionMarketTickAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalProductionMarketTickGate(options) === 'INTERNAL_TEST';
}

export function hasOnlyCanonicalMarketTickKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_CLIENT_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => key === 'canonicalSchemaVersion');
}

export function canonicalMarketTickId(epoch: number): string {
  return `marketTick:${epoch}`;
}

export function deriveCanonicalMarketEpoch(serverNowMs: number): number {
  return getMarketEpoch(serverNowMs);
}

export type EpochMarketClassification = 'shortage' | 'balanced' | 'surplus';

export type CanonicalProductionMarketQuote = {
  epoch: number;
  tickId: string;
  cityId: string;
  productId: ProductId;
  price: number;
  previousEpochPrice: number;
  epochSupply: number;
  epochDemand: number;
  targetStock: number;
  status: EpochMarketClassification;
  eventIds: string[];
  fuelPricePerLiter: number;
  economyConfigVersion: number;
  seed: string;
  policyVersion: typeof CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION;
};

const quoteCache = new Map<number, ReturnType<typeof buildGlobalEconomySnapshot>>();

function snapshotForEpoch(epoch: number): ReturnType<typeof buildGlobalEconomySnapshot> {
  const cached = quoteCache.get(epoch);
  if (cached) return cached;
  const snapshot = buildGlobalEconomySnapshot({
    epoch,
    nowMs: getMarketEpochStartMs(epoch),
    configVersion: ECONOMY_CONFIG_VERSION,
  });
  quoteCache.set(epoch, snapshot);
  return snapshot;
}

export function resetCanonicalMarketQuoteCacheForTests(): void {
  quoteCache.clear();
}

export function deriveCanonicalProductionMarketQuote(
  epoch: number,
  cityId: string,
  productId: ProductId,
): CanonicalProductionMarketQuote | null {
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const city = CITIES_BY_ID[cityId];
  const product = city?.products[productId];
  if (!city || !product) return null;
  const snapshot = snapshotForEpoch(epoch);
  const price = snapshot.cityMarketPrices[cityId]?.[productId];
  const supplyDemand = snapshot.supplyDemandState[cityId]?.[productId];
  if (price == null || !supplyDemand) return null;
  const events = buildGlobalEventsForEpoch(epoch, ECONOMY_CONFIG_VERSION);
  return {
    epoch,
    tickId: canonicalMarketTickId(epoch),
    cityId,
    productId,
    price,
    previousEpochPrice: snapshot.marketMovements.find(
      (row) => row.cityId === cityId && row.productId === productId,
    )?.previousPrice ?? price,
    epochSupply: supplyDemand.supply,
    epochDemand: supplyDemand.demand,
    targetStock: product.targetStock,
    status: supplyDemand.status,
    eventIds: events.map((event) => event.id),
    fuelPricePerLiter: snapshot.fuelPricePerLiter,
    economyConfigVersion: ECONOMY_CONFIG_VERSION,
    seed: GLOBAL_MARKET_SEED,
    policyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
  };
}

export function classifyEpochSupplyRatio(
  supply: number,
  targetStock: number,
): EpochMarketClassification {
  const ratio = supply / Math.max(1, targetStock);
  if (ratio < 0.7) return 'shortage';
  if (ratio > 1.2) return 'surplus';
  return 'balanced';
}

export function deriveTradableSurplus(stock: number, targetStock: number): number {
  return calculateSurplus(
    toProductMarket({
      stock,
      targetStock,
      basePrice: 1,
      currentPrice: 1,
      productionPerDay: 0,
      consumptionPerDay: 0,
      priceHistory: [],
    }),
  );
}

export function deriveTradableShortage(stock: number, targetStock: number): number {
  return calculateShortage(
    toProductMarket({
      stock,
      targetStock,
      basePrice: 1,
      currentPrice: 1,
      productionPerDay: 0,
      consumptionPerDay: 0,
      priceHistory: [],
    }),
  );
}

export type CanonicalTickMarketRow = {
  cityId: string;
  productId: ProductId;
  stock: number;
  currentPrice: number;
  marketRevision: number;
  tickPolicyVersion?: string;
  lastAppliedTickIndex?: number;
};

export function isDynamicCanonicalMarketRow(row: {
  tickPolicyVersion?: unknown;
}): boolean {
  return row.tickPolicyVersion === CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION;
}

export type PlannedMarketTickUpdate = {
  cityId: string;
  productId: ProductId;
  quote: CanonicalProductionMarketQuote;
  nextRevision: number;
  stockUnchanged: number;
};

export function planCanonicalProductionMarketTick(input: {
  epoch: number;
  rows: readonly CanonicalTickMarketRow[];
}): {
  tickId: string;
  updates: PlannedMarketTickUpdate[];
  alreadyApplied: number;
  skippedFixedSnapshot: number;
} {
  const updates: PlannedMarketTickUpdate[] = [];
  let alreadyApplied = 0;
  let skippedFixedSnapshot = 0;
  for (const row of input.rows) {
    if (!isDynamicCanonicalMarketRow(row)) {
      skippedFixedSnapshot += 1;
      continue;
    }
    if (row.lastAppliedTickIndex === input.epoch) {
      alreadyApplied += 1;
      continue;
    }
    const quote = deriveCanonicalProductionMarketQuote(input.epoch, row.cityId, row.productId);
    if (!quote) continue;
    updates.push({
      cityId: row.cityId,
      productId: row.productId,
      quote,
      nextRevision: row.marketRevision + 1,
      stockUnchanged: row.stock,
    });
  }
  return {
    tickId: canonicalMarketTickId(input.epoch),
    updates,
    alreadyApplied,
    skippedFixedSnapshot,
  };
}

export function marketTickLeavesPlayerCashUnchanged(): true {
  return true;
}

export function canonicalCargoPolicyRemainsFixedSnapshot(): typeof CANONICAL_CARGO_MARKET_POLICY_VERSION {
  return CANONICAL_CARGO_MARKET_POLICY_VERSION;
}

export function marketTickIntervalMs(): number {
  return MARKET_TICK_INTERVAL_MS;
}
