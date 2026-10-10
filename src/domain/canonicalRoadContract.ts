/**
 * Canonical ROAD contract issuance policy (Map V2 Step 29G).
 *
 * INTERNAL_TEST server-owned simplified issuance. Not live market parity.
 * Pure. No React. No Firebase. No money mutation.
 */

import { ROUTES } from '../data/routes';
import {
  createCanonicalRoadBatchId,
  createIssuedCanonicalRoadContractId,
} from './canonicalRoadDelivery';
import {
  buildFixtureMarket,
  issueCanonicalRoadContractFromTrustedState,
  type CanonicalRoadContractSnapshot,
} from './canonicalRoadEconomics';

export const CANONICAL_ROAD_CONTRACT_ISSUANCE_STATUS =
  'CANONICAL_ROAD_CONTRACT_ISSUANCE_PASS_INTERNAL_POLICY_ONLY' as const;

export const CANONICAL_ROAD_CONTRACT_PRODUCTION_PARITY =
  'PRODUCTION_PARITY_BLOCKED_WORLD_STATE_AUTHORITY' as const;

export const CANONICAL_ROAD_ISSUANCE_POLICY_VERSION =
  'canonical-road-contract-issuance-internal-v1' as const;

export const CANONICAL_ROAD_CONTRACT_SCHEMA_VERSION = 1 as const;

export const CANONICAL_ROAD_CONTRACTS_ENV_KEY = 'EXPO_PUBLIC_CANONICAL_ROAD_CONTRACTS' as const;

export const CANONICAL_ROAD_CONTRACT_BATCHES_COLLECTION = 'canonicalRoadContractBatches' as const;

export const CANONICAL_ROAD_ISSUANCE_OFFER_COUNT = 8;
export const CANONICAL_ROAD_ISSUANCE_WINDOW_MS = 15 * 60 * 1000;
export const CANONICAL_ROAD_ISSUANCE_TTL_MS = 30 * 60 * 1000;
export const CANONICAL_ROAD_INTERNAL_AMOUNT_BANDS = [10, 12, 25] as const;
export const CANONICAL_ROAD_INTERNAL_PRODUCTS = ['steel', 'fruit', 'textile', 'beverage'] as const;
export const CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK = 1.72;

export const ROAD_CANONICAL_SETTLEMENT_READINESS =
  'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY' as const;

export type CanonicalRoadContractsGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadContractsGate(options?: {
  envValue?: string | null;
}): CanonicalRoadContractsGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_CONTRACTS ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export type CanonicalRoadContractStatus = 'AVAILABLE' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

export const CANONICAL_ROAD_INTERNAL_ORIGIN_MARKET = buildFixtureMarket({
  currentPrice: 1900,
  basePrice: 2000,
  stock: 90,
  targetStock: 30,
});

export const CANONICAL_ROAD_INTERNAL_DESTINATION_MARKET = buildFixtureMarket({
  currentPrice: 2500,
  basePrice: 2000,
  stock: 8,
  targetStock: 60,
  consumptionPerDay: 18,
});

export function hashIssuanceSeed(parts: string[]): number {
  let hash = 2166136261;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function issuanceWindowId(nowMs: number): number {
  return Math.floor(nowMs / CANONICAL_ROAD_ISSUANCE_WINDOW_MS);
}

export type PreparedCanonicalRoadBatch = {
  batchId: string;
  windowId: number;
  generationSeed: number;
  issuedAtMs: number;
  expiresAtMs: number;
  policyVersion: typeof CANONICAL_ROAD_ISSUANCE_POLICY_VERSION;
  contracts: CanonicalRoadContractSnapshot[];
};

export function prepareCanonicalRoadContractBatch(input: {
  uid: string;
  nowMs: number;
  fuelPricePerLiter: number;
}): PreparedCanonicalRoadBatch | { ok: false; reason: 'ISSUANCE_POLICY_UNAVAILABLE' } {
  const windowId = issuanceWindowId(input.nowMs);
  const batchId = createCanonicalRoadBatchId(windowId);
  const generationSeed = hashIssuanceSeed([
    CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
    input.uid,
    String(windowId),
  ]);
  const rng = mulberry32(generationSeed);
  const contracts: CanonicalRoadContractSnapshot[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (contracts.length < CANONICAL_ROAD_ISSUANCE_OFFER_COUNT && guard < 80) {
    guard += 1;
    const route = ROUTES[Math.floor(rng() * ROUTES.length)]!;
    const productId =
      CANONICAL_ROAD_INTERNAL_PRODUCTS[
        Math.floor(rng() * CANONICAL_ROAD_INTERNAL_PRODUCTS.length)
      ]!;
    const amount =
      CANONICAL_ROAD_INTERNAL_AMOUNT_BANDS[
        Math.floor(rng() * CANONICAL_ROAD_INTERNAL_AMOUNT_BANDS.length)
      ]!;
    const key = `${route.fromCityId}-${route.toCityId}-${productId}-${amount}`;
    if (used.has(key)) continue;
    used.add(key);
    const sequence = contracts.length;
    const issued = issueCanonicalRoadContractFromTrustedState({
      originCityId: route.fromCityId,
      destinationCityId: route.toCityId,
      productId,
      amount,
      originMarket: CANONICAL_ROAD_INTERNAL_ORIGIN_MARKET,
      destinationMarket: CANONICAL_ROAD_INTERNAL_DESTINATION_MARKET,
      fuelPricePerLiter: input.fuelPricePerLiter,
      sequence,
      contractId: createIssuedCanonicalRoadContractId(batchId, sequence),
    });
    if (!issued.ok) continue;
    contracts.push(issued.snapshot);
  }
  if (contracts.length !== CANONICAL_ROAD_ISSUANCE_OFFER_COUNT) {
    return { ok: false, reason: 'ISSUANCE_POLICY_UNAVAILABLE' };
  }
  return {
    batchId,
    windowId,
    generationSeed,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + CANONICAL_ROAD_ISSUANCE_TTL_MS,
    policyVersion: CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
    contracts,
  };
}

const ISSUANCE_REQUEST_KEYS = new Set(['canonicalSchemaVersion', 'refreshReason']);

export function hasOnlyCanonicalRoadIssuanceKeys(data: Record<string, unknown>): boolean {
  if (
    ['payment', 'deadlineHours', 'amount', 'cargoAmount', 'distanceKm', 'originCityId', 'destinationCityId'].some(
      (key) => key in data,
    )
  ) {
    return false;
  }
  return Object.keys(data).every((key) => ISSUANCE_REQUEST_KEYS.has(key));
}
