/**
 * Canonical fuel tank / price authority (Map V2 Step 29Q).
 *
 * INTERNAL_TEST / foundation. Server derives tank, capacity, price, liters, cost.
 * Client cannot supply fuel amounts, capacity, price, or cost as authority.
 * Pure. No React. No Firebase.
 */

import { calculateContractEconomics } from '../simulation/contractEconomics';
import { sanitizeFuelPricePerLiter } from '../simulation/economy';
import { CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK } from './canonicalRoadContract';
import {
  classifyCanonicalFleetSelection,
  truckFromCanonicalFleetAsset,
  type CanonicalFleetAssetDocument,
} from './canonicalRoadFleet';
import { resolveAssetTrustClass } from './canonicalProductionFleet';
import { getRoute } from '../data/routes';
import {
  calculateTruckRefuelQuote,
  getDefaultFuelFillRatio,
  getDefaultFuelTankCapacityL,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import type { Truck } from '../types/game';

export const CANONICAL_FUEL_TANK_PRICE_AUTHORITY_STATUS =
  'CANONICAL_FUEL_TANK_PRICE_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_FUEL_AUTHORITY_BACKEND_ENV = 'CANONICAL_FUEL_AUTHORITY' as const;
export const CANONICAL_FUEL_STATE_POLICY_VERSION = 'canonical-fuel-state-v1' as const;
export const CANONICAL_FUEL_PRICE_POLICY_VERSION = 'canonical-fuel-price-v1' as const;
export const CANONICAL_FUEL_CONSUMPTION_POLICY_VERSION =
  'canonical-fuel-consumption-accept-burn-v1' as const;
export const CANONICAL_FUEL_RECEIPTS_COLLECTION = 'canonicalFuelReceipts' as const;
export const CANONICAL_FUEL_STATE_SCHEMA_VERSION = 1 as const;

export const FUEL_CASH_AUTHORITY_STATUS =
  'FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED' as const;
export const ROADSIDE_FUEL_AUTHORITY_STATUS =
  'ROADSIDE_FUEL_AUTHORITY_BLOCKED_LOCAL_PURCHASE' as const;
export const FUEL_INCIDENT_AUTHORITY_STATUS = 'FUEL_AUTHORITY_BLOCKED_INCIDENT_FUEL_DELTA' as const;

export const CANONICAL_FUEL_PRICE_SOURCE = 'GLOBAL_SERVER_OR_INTERNAL_FALLBACK' as const;

export type CanonicalFuelAuthorityGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalFuelAuthorityGate(options?: {
  envValue?: string | null;
}): CanonicalFuelAuthorityGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_FUEL_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalFuelAuthorityAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalFuelAuthorityGate(options) === 'INTERNAL_TEST';
}

export type CanonicalFuelReadiness =
  | 'CANONICAL_FUEL_READY'
  | 'LEGACY_FLEET_UNVERIFIED'
  | 'TANK_STATE_MISSING'
  | 'PRICE_AUTHORITY_MISSING'
  | 'INSUFFICIENT_FUEL'
  | 'ROADSIDE_AUTHORITY_MISSING'
  | 'INCIDENT_FUEL_AUTHORITY_MISSING'
  | 'SCHEMA_UNSUPPORTED'
  | 'TRAILER_HAS_NO_FUEL'
  | 'CANONICAL_FUEL_AUTHORITY_OFF';

export type CanonicalFuelPurchaseMode = 'FILL_TO_CAPACITY' | 'BUY_LITERS';

export function isValidCanonicalFuelIntentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isCanonicalFuelPurchaseMode(value: unknown): value is CanonicalFuelPurchaseMode {
  return value === 'FILL_TO_CAPACITY' || value === 'BUY_LITERS';
}

const PURCHASE_FORBIDDEN = [
  'currentFuelL',
  'fuelAfter',
  'fuelBefore',
  'tankCapacity',
  'fuelCapacityL',
  'fuelTankCapacityL',
  'price',
  'pricePerLiter',
  'fuelCost',
  'cost',
  'cashDelta',
  'payment',
  'serverCash',
  'fuelRequired',
  'consumedFuel',
];

export function hasOnlyCanonicalFuelPurchaseKeys(data: Record<string, unknown>): boolean {
  if (PURCHASE_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['assetId', 'fuelPurchaseIntentId', 'mode', 'requestedLiters', 'canonicalSchemaVersion'].includes(
      key,
    ),
  );
}

export function createCanonicalFuelPurchaseOperationId(
  assetId: string,
  intentId: string,
): string {
  return `fuel:${assetId}:${intentId}`;
}

export function createCanonicalFuelConsumptionOperationId(
  assetId: string,
  deliveryId: string,
): string {
  return `fuel:${assetId}:delivery:${deliveryId}`;
}

export function roundCanonicalFuelL(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

export function deriveCanonicalFuelCapacityL(asset: CanonicalFleetAssetDocument): number {
  const truck = truckFromCanonicalFleetAsset(asset);
  return getDefaultFuelTankCapacityL(truck);
}

export function deriveInitialCanonicalFuelL(
  asset: CanonicalFleetAssetDocument,
  capacityL: number,
): number {
  return Math.round(capacityL * getDefaultFuelFillRatio(asset.assetId));
}

export function withCanonicalFuelState(
  asset: CanonicalFleetAssetDocument,
): CanonicalFleetAssetDocument {
  if (asset.assetType !== 'TRUCK') return asset;
  if (
    asset.fuelStateSchemaVersion === CANONICAL_FUEL_STATE_SCHEMA_VERSION &&
    Number.isFinite(asset.currentFuelL) &&
    Number.isFinite(asset.fuelCapacityL) &&
    Number.isFinite(asset.fuelRevision)
  ) {
    return asset;
  }
  const fuelCapacityL = deriveCanonicalFuelCapacityL(asset);
  const currentFuelL = deriveInitialCanonicalFuelL(asset, fuelCapacityL);
  return {
    ...asset,
    fuelStateSchemaVersion: CANONICAL_FUEL_STATE_SCHEMA_VERSION,
    currentFuelL,
    fuelCapacityL,
    fuelRevision: asset.fuelRevision && Number.isFinite(asset.fuelRevision) ? asset.fuelRevision : 1,
    fuelPolicyVersion: CANONICAL_FUEL_STATE_POLICY_VERSION,
  };
}

export function classifyCanonicalFuelAuthority(
  asset: CanonicalFleetAssetDocument | null | undefined,
  options?: { envValue?: string | null },
): CanonicalFuelReadiness {
  if (!isCanonicalFuelAuthorityAllowed(options)) return 'CANONICAL_FUEL_AUTHORITY_OFF';
  if (!asset) return 'LEGACY_FLEET_UNVERIFIED';
  if (classifyCanonicalFleetSelection(asset.assetId) === 'LEGACY') return 'LEGACY_FLEET_UNVERIFIED';
  if (asset.assetType !== 'TRUCK') return 'TRAILER_HAS_NO_FUEL';
  if (asset.canonicalFleetAssetSchemaVersion !== 1) return 'SCHEMA_UNSUPPORTED';
  const trust = resolveAssetTrustClass(asset);
  if (trust !== 'SERVER_CANONICAL' && trust !== 'INTERNAL_TEST_FIXTURE') {
    return 'LEGACY_FLEET_UNVERIFIED';
  }
  if (
    asset.fuelStateSchemaVersion !== CANONICAL_FUEL_STATE_SCHEMA_VERSION ||
    !Number.isFinite(asset.currentFuelL) ||
    !Number.isFinite(asset.fuelCapacityL)
  ) {
    return 'TANK_STATE_MISSING';
  }
  return 'CANONICAL_FUEL_READY';
}

export function deriveCanonicalFuelPricePerLiter(raw: unknown): {
  ok: true;
  pricePerLiter: number;
  source: 'GLOBAL_SERVER' | 'INTERNAL_FALLBACK';
} {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const sanitized = sanitizeFuelPricePerLiter(raw);
    if (Number.isFinite(sanitized) && sanitized > 0) {
      return { ok: true, pricePerLiter: sanitized, source: 'GLOBAL_SERVER' };
    }
  }
  return {
    ok: true,
    pricePerLiter: CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK,
    source: 'INTERNAL_FALLBACK',
  };
}

export function deriveCanonicalFuelPurchaseCost(liters: number, pricePerLiter: number): number {
  const litersSafe = roundCanonicalFuelL(liters);
  const cost = Number((litersSafe * pricePerLiter).toFixed(2));
  return Math.round(cost);
}

export function quoteCanonicalFuelPurchase(input: {
  asset: CanonicalFleetAssetDocument;
  mode: CanonicalFuelPurchaseMode;
  requestedLiters?: number;
  pricePerLiter: number;
}):
  | {
      ok: true;
      litersToAdd: number;
      fuelBefore: number;
      fuelAfter: number;
      fuelCapacityL: number;
      pricePerLiter: number;
      cost: number;
      notNeeded: boolean;
    }
  | { ok: false; reason: string } {
  if (input.asset.assetType !== 'TRUCK') return { ok: false, reason: 'TRAILER_HAS_NO_FUEL' };
  const fueled = withCanonicalFuelState(input.asset);
  const truck: Truck = {
    ...truckFromCanonicalFleetAsset(fueled),
    currentFuelL: fueled.currentFuelL,
    fuelTankCapacityL: fueled.fuelCapacityL,
  };
  const normalized = normalizeTruckFuel(truck);
  const space = Math.max(0, (normalized.fuelTankCapacityL ?? 0) - (normalized.currentFuelL ?? 0));
  if (space <= 1e-6) {
    return {
      ok: true,
      litersToAdd: 0,
      fuelBefore: normalized.currentFuelL ?? 0,
      fuelAfter: normalized.currentFuelL ?? 0,
      fuelCapacityL: normalized.fuelTankCapacityL ?? 0,
      pricePerLiter: input.pricePerLiter,
      cost: 0,
      notNeeded: true,
    };
  }
  const requested =
    input.mode === 'FILL_TO_CAPACITY'
      ? space
      : Math.max(0, Number(input.requestedLiters) || 0);
  if (input.mode === 'BUY_LITERS' && (!Number.isFinite(requested) || requested <= 0)) {
    return { ok: false, reason: 'INVALID_REQUESTED_LITERS' };
  }
  const quote = calculateTruckRefuelQuote(normalized, requested, input.pricePerLiter);
  const cost = deriveCanonicalFuelPurchaseCost(quote.litersToAdd, input.pricePerLiter);
  return {
    ok: true,
    litersToAdd: quote.litersToAdd,
    fuelBefore: quote.currentFuelL,
    fuelAfter: quote.newFuelL,
    fuelCapacityL: quote.fuelTankCapacityL,
    pricePerLiter: input.pricePerLiter,
    cost,
    notNeeded: quote.litersToAdd <= 1e-6,
  };
}

export function deriveCanonicalRoadFuelRequirement(input: {
  truckAsset: CanonicalFleetAssetDocument;
  trailerAsset: CanonicalFleetAssetDocument | null;
  originCityId: string;
  destinationCityId: string;
  amount: number;
  payment: number;
  urgency?: number;
  /** Step 29AG: trusted canonical driver fuelSaving (production fuel liters input). */
  driverFuelSaving?: number | null;
}): { ok: true; requiredFuelL: number } | { ok: false; reason: string } {
  const route = getRoute(input.originCityId, input.destinationCityId);
  if (!route) return { ok: false, reason: 'UNSUPPORTED_ROUTE' };
  const truck = truckFromCanonicalFleetAsset(withCanonicalFuelState(input.truckAsset));
  const economics = calculateContractEconomics({
    contract: {
      payment: input.payment,
      amount: input.amount,
      distanceKm: route.distanceKm,
      urgency: input.urgency ?? 0,
      contractType: 'standard',
      riskLevel: 'low',
    },
    truck,
    trailer: null,
    driver:
      input.driverFuelSaving != null && Number.isFinite(input.driverFuelSaving)
        ? { fuelSaving: input.driverFuelSaving, salaryPerDay: 0, speed: 0, tier: 'rookie' }
        : null,
    route,
    globalEconomySnapshot: { fuelPricePerLiter: CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK },
    activeEvents: [],
  });
  return { ok: true, requiredFuelL: economics.fuelLiters };
}

export type CanonicalFuelReceipt = {
  operationId: string;
  operationType: 'PURCHASE' | 'CONSUMPTION';
  assetId: string;
  ownerUid: string;
  mode: CanonicalFuelPurchaseMode | 'ACCEPT_BURN';
  litersDelta: number;
  fuelBefore: number;
  fuelAfter: number;
  fuelCapacityL: number;
  pricePerLiter: number | null;
  cost: number;
  cashBefore: number | null;
  cashAfter: number | null;
  cashTransactionId: string | null;
  fuelRevisionBefore: number;
  fuelRevisionAfter: number;
  pricePolicyVersion: typeof CANONICAL_FUEL_PRICE_POLICY_VERSION | null;
  fuelPolicyVersion: typeof CANONICAL_FUEL_STATE_POLICY_VERSION;
  consumptionPolicyVersion: typeof CANONICAL_FUEL_CONSUMPTION_POLICY_VERSION | null;
  deliveryId: string | null;
  createdAtMs: number;
  authoritySource: CanonicalFleetAssetDocument['authoritySource'];
};
