/**
 * Server-safe ROAD→RAIL→ROAD canonical economics (Map V2 Step 29C).
 * Recomputes Step 26 tariff + Step 27 offer economics. Does not trust client money.
 * No React. No Firebase. No money mutation.
 *
 * This is INTERNAL_TEST_SERVER_AUTHORITY: the server validates deterministic
 * money given client-chosen valid route/product/tonnage/seed. It is not public
 * offer issuance / anti-cheat supply control.
 */

import {
  findRoadTransferAccess,
  MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID,
  type MultimodalRoadTransferAccessArtifactV1,
} from './multimodalRoadAccess';
import {
  canonicalRailTariffRouteReference,
  estimateMultimodalRailTariff,
  findAcceptedRailTariffCorridor,
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
  RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
  RAIL_UNRESOLVED_CITY_IDS,
} from './multimodalRailTariff';

export const CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION = 1 as const;
export const CANONICAL_MULTIMODAL_AUTHORITY_SCOPE = 'INTERNAL_TEST_SERVER_AUTHORITY' as const;
export const CANONICAL_SIGNED_IN_MONEY_PATH = 'users/{uid}/serverState/current.cash' as const;
export const CANONICAL_MULTIMODAL_SHIPMENT_COLLECTION = 'canonicalMultimodalShipments' as const;

export const RAIL_MULTIMODAL_TRANSPORT_PATTERN = 'ROAD_RAIL_ROAD' as const;
export const RAIL_OFFER_CURRENCY = 'USD_GAME_INTEGER' as const;
export const MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION =
  'multimodal-rail-offer-economics-v1' as const;

/** Frozen Step 27 STANDARD_ROAD_ACCESS_COST_PROFILE numbers (balance.ts literals). */
export const CANONICAL_ROAD_ACCESS_COST_PROFILE = {
  id: 'standard-road-access-cost-profile-v1',
  fuelPerKm: 0.32,
  fuelPricePerLiter: 1.72,
  fuelCostMultiplier: 1.25,
  maintenancePerKm: 0.4 * 1.35,
  planningRouteDifficulty: 0.3,
} as const;

export const RAIL_OFFER_COMPLEXITY_PREMIUM = 0.22;
export const RAIL_OFFER_COORDINATION_FEE_DOLLARS = 180;
export const RAIL_OFFER_MIN_GROSS_MARGIN_DOLLARS = 80;
export const RAIL_OFFER_MIN_GROSS_MARGIN_RATIO = 0.08;
export const RAIL_OFFER_ABSOLUTE_PAYMENT_MAX = 65_000;
export const RAIL_OFFER_CARGO_TONNES_BANDS = [1, 5, 10, 25] as const;

export const CANONICAL_PRODUCT_IDS = [
  'fruit',
  'steel',
  'electronics',
  'machinery',
  'textile',
  'furniture',
  'beverage',
] as const;

/** Level 1 unlocks up to 25 t; all Step 27 bands are ≤ 25. */
export const CANONICAL_TONNAGE_LEVEL_TIERS = [
  { level: 1, maxTonnage: 25 },
  { level: 2, maxTonnage: 40 },
  { level: 3, maxTonnage: 60 },
  { level: 4, maxTonnage: 85 },
  { level: 5, maxTonnage: 100 },
  { level: 8, maxTonnage: 120 },
  { level: 10, maxTonnage: 150 },
] as const;

export type CanonicalMultimodalAcceptanceStatus =
  | 'READY'
  | 'UNAUTHENTICATED'
  | 'FEATURE_DISABLED'
  | 'SEA_NOT_ACTIVATED'
  | 'AIR_NOT_ACTIVATED'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_ROUTE'
  | 'UNRESOLVED_RAIL_INFRASTRUCTURE'
  | 'ROAD_ACCESS_UNRESOLVED'
  | 'INVALID_CARGO'
  | 'LEVEL_GATED'
  | 'INVALID_RAIL_TARIFF'
  | 'UNSAFE_ECONOMICS'
  | 'OFFER_ID_MISMATCH'
  | 'UNSUPPORTED_SCHEMA';

export type CanonicalMultimodalEconomicsSnapshot = {
  canonicalSchemaVersion: typeof CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION;
  authorityScope: typeof CANONICAL_MULTIMODAL_AUTHORITY_SCOPE;
  shipmentId: string;
  sourceOfferId: string;
  transportPattern: typeof RAIL_MULTIMODAL_TRANSPORT_PATTERN;
  originCityId: string;
  destinationCityId: string;
  productId: string;
  cargoQuantity: number;
  railRouteReference: string;
  railDistanceMeters: number;
  firstMileAccessMeters: number;
  lastMileAccessMeters: number;
  playerPayment: number;
  railCarrierCost: number;
  estimatedRoadOperatingCost: number;
  expectedGrossMargin: number;
  currency: typeof RAIL_OFFER_CURRENCY;
  railTariffPolicyVersion: typeof MULTIMODAL_RAIL_TARIFF_POLICY_VERSION;
  offerEconomicsPolicyVersion: typeof MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION;
  railSourcePackageHash: typeof RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH;
  roadAccessPackageId: typeof MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID;
  roadAccessContentHash?: string;
  generationSeed: string;
};

export type CanonicalMultimodalAcceptanceComputeResult =
  | { status: 'READY'; snapshot: CanonicalMultimodalEconomicsSnapshot }
  | { status: Exclude<CanonicalMultimodalAcceptanceStatus, 'READY'>; reason: string };

const PRODUCT_SET = new Set<string>(CANONICAL_PRODUCT_IDS);
const TONNE_SET = new Set<number>(RAIL_OFFER_CARGO_TONNES_BANDS);
const UNRESOLVED = new Set<string>(RAIL_UNRESOLVED_CITY_IDS);
const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CITY_PATTERN = /^[a-z0-9_-]{2,32}$/;

export function requiredLevelForCanonicalTonnage(tonnage: number): number {
  for (const tier of CANONICAL_TONNAGE_LEVEL_TIERS) {
    if (tonnage <= tier.maxTonnage) return tier.level;
  }
  return CANONICAL_TONNAGE_LEVEL_TIERS[CANONICAL_TONNAGE_LEVEL_TIERS.length - 1]?.level ?? 1;
}

export function buildCanonicalRailOfferId(input: {
  generationSeed: string;
  originCityId: string;
  destinationCityId: string;
  productId: string;
  cargoQuantity: number;
}): string {
  const tonnesKey = String(input.cargoQuantity).replace('.', 'p');
  return `railOffer:${input.generationSeed}:${input.originCityId}:${input.destinationCityId}:${input.productId}:${tonnesKey}`;
}

export function isValidCanonicalMultimodalShipmentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value) &&
    !value.includes(':')
  );
}

function fnv1aHex(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function mintCanonicalShipmentIdFromOfferId(offerId: string): string | null {
  const sanitized = `mls.${offerId.replace(/:/g, '.')}`;
  if (isValidCanonicalMultimodalShipmentId(sanitized) && sanitized.length <= 128) {
    return sanitized;
  }
  const hashed = `mls.offer.${fnv1aHex(offerId)}`;
  return isValidCanonicalMultimodalShipmentId(hashed) ? hashed : null;
}

function cargoWeightCostMultiplier(cargoWeightTon: number): number {
  const weight = Math.max(0, cargoWeightTon);
  if (weight <= 15) return 1;
  if (weight <= 30) return 1.15;
  if (weight <= 60) return 1.35;
  return 1.6;
}

function roundDollars(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) return null;
  return rounded;
}

export function estimateCanonicalRoadAccessOperatingCostDollars(
  distanceMeters: number,
  cargoTonnes: number,
): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  if (!Number.isFinite(cargoTonnes) || cargoTonnes <= 0) return null;
  const km = distanceMeters / 1000;
  const weight = cargoWeightCostMultiplier(cargoTonnes);
  const route = 1 + CANONICAL_ROAD_ACCESS_COST_PROFILE.planningRouteDifficulty * 0.45;
  const liters = km * CANONICAL_ROAD_ACCESS_COST_PROFILE.fuelPerKm * weight * route;
  const fuel = roundDollars(
    liters *
      CANONICAL_ROAD_ACCESS_COST_PROFILE.fuelPricePerLiter *
      CANONICAL_ROAD_ACCESS_COST_PROFILE.fuelCostMultiplier,
  );
  const maint = roundDollars(
    km *
      CANONICAL_ROAD_ACCESS_COST_PROFILE.maintenancePerKm *
      weight *
      (1 + CANONICAL_ROAD_ACCESS_COST_PROFILE.planningRouteDifficulty * 0.4),
  );
  if (fuel == null || maint == null) return null;
  const total = fuel + maint;
  return Number.isSafeInteger(total) ? total : null;
}

export function estimateCanonicalRailOfferEconomics(input: {
  railCarrierCost: number;
  firstMileDistanceMeters: number;
  lastMileDistanceMeters: number;
  cargoTonnes: number;
}):
  | {
      status: 'READY';
      playerPayment: number;
      railCarrierCost: number;
      estimatedRoadOperatingCost: number;
      expectedGrossMargin: number;
    }
  | { status: 'UNSAFE_ECONOMICS' | 'INVALID_INPUT'; reason: string } {
  const rail = input.railCarrierCost;
  if (!Number.isFinite(rail) || rail < 0 || !Number.isSafeInteger(rail)) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_RAIL_CARRIER_COST' };
  }
  const first = estimateCanonicalRoadAccessOperatingCostDollars(
    input.firstMileDistanceMeters,
    input.cargoTonnes,
  );
  const last = estimateCanonicalRoadAccessOperatingCostDollars(
    input.lastMileDistanceMeters,
    input.cargoTonnes,
  );
  if (first == null || last == null) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_ROAD_ACCESS_OPERATING_COST' };
  }
  const estimatedRoadOperatingCost = first + last;
  const estimatedExpenses = rail + estimatedRoadOperatingCost;
  if (!Number.isSafeInteger(estimatedExpenses) || estimatedExpenses < 0) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'EXPENSE_OVERFLOW' };
  }
  const playerPayment = roundDollars(
    estimatedExpenses * (1 + RAIL_OFFER_COMPLEXITY_PREMIUM) + RAIL_OFFER_COORDINATION_FEE_DOLLARS,
  );
  if (playerPayment == null || playerPayment <= 0) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'INVALID_PLAYER_PAYMENT' };
  }
  if (playerPayment > RAIL_OFFER_ABSOLUTE_PAYMENT_MAX) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'PAYMENT_EXCEEDS_ABSOLUTE_MAX' };
  }
  if (playerPayment === rail) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'PAYMENT_EQUALS_CARRIER_COST' };
  }
  const expectedGrossMargin = playerPayment - estimatedExpenses;
  if (!Number.isSafeInteger(expectedGrossMargin) || expectedGrossMargin <= 0) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'EXPECTED_GROSS_MARGIN_NOT_POSITIVE' };
  }
  const ratio = expectedGrossMargin / playerPayment;
  if (
    expectedGrossMargin < RAIL_OFFER_MIN_GROSS_MARGIN_DOLLARS ||
    ratio < RAIL_OFFER_MIN_GROSS_MARGIN_RATIO
  ) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'MARGIN_TOO_THIN' };
  }
  return {
    status: 'READY',
    playerPayment,
    railCarrierCost: rail,
    estimatedRoadOperatingCost,
    expectedGrossMargin,
  };
}

export function computeCanonicalMultimodalRailAcceptance(input: {
  generationSeed: unknown;
  originCityId: unknown;
  destinationCityId: unknown;
  productId: unknown;
  cargoQuantity: unknown;
  sourceOfferId?: unknown;
  playerPayment?: unknown;
  railCarrierCost?: unknown;
  distanceMeters?: unknown;
  transportPattern?: unknown;
  playerLevel?: unknown;
  canonicalSchemaVersion?: unknown;
  allowAcceptance?: boolean;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
}): CanonicalMultimodalAcceptanceComputeResult {
  if (input.allowAcceptance === false) {
    return { status: 'FEATURE_DISABLED', reason: 'INTERNAL_TEST_REQUIRED' };
  }
  if (
    input.canonicalSchemaVersion != null &&
    input.canonicalSchemaVersion !== CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION
  ) {
    return { status: 'UNSUPPORTED_SCHEMA', reason: 'UNSUPPORTED_CANONICAL_SCHEMA' };
  }
  if (input.transportPattern === 'ROAD_SEA_ROAD') {
    return { status: 'SEA_NOT_ACTIVATED', reason: 'SEA_NOT_ACTIVATED' };
  }
  if (input.transportPattern === 'ROAD_AIR_ROAD') {
    return { status: 'AIR_NOT_ACTIVATED', reason: 'AIR_NOT_ACTIVATED' };
  }
  if (
    input.transportPattern != null &&
    input.transportPattern !== RAIL_MULTIMODAL_TRANSPORT_PATTERN
  ) {
    return { status: 'UNSUPPORTED_ROUTE', reason: 'ROUTE_UNSUPPORTED' };
  }

  const generationSeed = typeof input.generationSeed === 'string' ? input.generationSeed.trim() : '';
  const originCityId = typeof input.originCityId === 'string' ? input.originCityId.trim() : '';
  const destinationCityId =
    typeof input.destinationCityId === 'string' ? input.destinationCityId.trim() : '';
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const cargoQuantity = Number(input.cargoQuantity);

  if (!SEED_PATTERN.test(generationSeed) || !CITY_PATTERN.test(originCityId) || !CITY_PATTERN.test(destinationCityId)) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_IDENTITY' };
  }
  if (originCityId === destinationCityId) {
    return { status: 'UNSUPPORTED_ROUTE', reason: 'SAME_CITY' };
  }
  if (UNRESOLVED.has(originCityId) || UNRESOLVED.has(destinationCityId)) {
    return { status: 'UNRESOLVED_RAIL_INFRASTRUCTURE', reason: 'UNRESOLVED_CITY' };
  }
  if (!PRODUCT_SET.has(productId)) {
    return { status: 'INVALID_CARGO', reason: 'INVALID_PRODUCT' };
  }
  if (!TONNE_SET.has(cargoQuantity) || !Number.isSafeInteger(cargoQuantity) || cargoQuantity <= 0) {
    return { status: 'INVALID_CARGO', reason: 'INVALID_TONNES' };
  }

  if (typeof input.playerLevel === 'number' && Number.isFinite(input.playerLevel)) {
    const required = requiredLevelForCanonicalTonnage(cargoQuantity);
    if (input.playerLevel < required) {
      return { status: 'LEVEL_GATED', reason: 'LEVEL_GATED' };
    }
  }

  const routeReference = canonicalRailTariffRouteReference(originCityId, destinationCityId);
  const corridor = findAcceptedRailTariffCorridor(routeReference);
  if (!corridor) {
    return { status: 'UNSUPPORTED_ROUTE', reason: 'ROUTE_UNSUPPORTED' };
  }
  const first = findRoadTransferAccess(input.accessArtifact, originCityId, 'RAIL');
  const last = findRoadTransferAccess(input.accessArtifact, destinationCityId, 'RAIL');
  if (!first || first.status !== 'READY' || !last || last.status !== 'READY') {
    return { status: 'ROAD_ACCESS_UNRESOLVED', reason: 'ROAD_ACCESS_UNRESOLVED' };
  }

  const tariff = estimateMultimodalRailTariff({
    routeReference,
    distanceMeters: corridor.distanceMeters,
    distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
    cargoQuantity,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    intent: 'PLAN',
  });
  if (tariff.status !== 'READY' || tariff.totalCarrierCost == null) {
    if (tariff.status === 'UNRESOLVED_RAIL_INFRASTRUCTURE') {
      return { status: 'UNRESOLVED_RAIL_INFRASTRUCTURE', reason: tariff.diagnostic ?? tariff.status };
    }
    return { status: 'INVALID_RAIL_TARIFF', reason: tariff.diagnostic ?? tariff.status };
  }

  const corridorMeters = tariff.distanceMeters;
  if (typeof corridorMeters !== 'number') {
    return { status: 'INVALID_RAIL_TARIFF', reason: 'MISSING_DISTANCE' };
  }
  if (typeof input.distanceMeters === 'number' && input.distanceMeters !== corridorMeters) {
    return { status: 'INVALID_RAIL_TARIFF', reason: 'CLIENT_DISTANCE_REJECTED' };
  }

  const economics = estimateCanonicalRailOfferEconomics({
    railCarrierCost: tariff.totalCarrierCost,
    firstMileDistanceMeters: first.distanceMeters,
    lastMileDistanceMeters: last.distanceMeters,
    cargoTonnes: cargoQuantity,
  });
  if (economics.status !== 'READY') {
    return { status: 'UNSAFE_ECONOMICS', reason: economics.reason };
  }

  if (typeof input.playerPayment === 'number' && input.playerPayment !== economics.playerPayment) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'CLIENT_PAYMENT_REJECTED' };
  }
  if (typeof input.railCarrierCost === 'number' && input.railCarrierCost !== economics.railCarrierCost) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'CLIENT_RAIL_COST_REJECTED' };
  }

  const sourceOfferId = buildCanonicalRailOfferId({
    generationSeed,
    originCityId,
    destinationCityId,
    productId,
    cargoQuantity,
  });
  if (typeof input.sourceOfferId === 'string' && input.sourceOfferId !== sourceOfferId) {
    return { status: 'OFFER_ID_MISMATCH', reason: 'OFFER_ID_MISMATCH' };
  }
  const shipmentId = mintCanonicalShipmentIdFromOfferId(sourceOfferId);
  if (!shipmentId) {
    return { status: 'INVALID_INPUT', reason: 'SHIPMENT_ID' };
  }

  return {
    status: 'READY',
    snapshot: {
      canonicalSchemaVersion: CANONICAL_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
      authorityScope: CANONICAL_MULTIMODAL_AUTHORITY_SCOPE,
      shipmentId,
      sourceOfferId,
      transportPattern: RAIL_MULTIMODAL_TRANSPORT_PATTERN,
      originCityId,
      destinationCityId,
      productId,
      cargoQuantity,
      railRouteReference: routeReference,
      railDistanceMeters: corridorMeters,
      firstMileAccessMeters: Math.floor(first.distanceMeters),
      lastMileAccessMeters: Math.floor(last.distanceMeters),
      playerPayment: economics.playerPayment,
      railCarrierCost: economics.railCarrierCost,
      estimatedRoadOperatingCost: economics.estimatedRoadOperatingCost,
      expectedGrossMargin: economics.expectedGrossMargin,
      currency: RAIL_OFFER_CURRENCY,
      railTariffPolicyVersion: MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
      offerEconomicsPolicyVersion: MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION,
      railSourcePackageHash: RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
      roadAccessPackageId: MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID,
      roadAccessContentHash: input.accessArtifact.contentHash,
      generationSeed,
    },
  };
}

export function snapshotsConflict(
  existing: CanonicalMultimodalEconomicsSnapshot,
  next: CanonicalMultimodalEconomicsSnapshot,
): boolean {
  return (
    existing.sourceOfferId !== next.sourceOfferId ||
    existing.originCityId !== next.originCityId ||
    existing.destinationCityId !== next.destinationCityId ||
    existing.productId !== next.productId ||
    existing.cargoQuantity !== next.cargoQuantity ||
    existing.playerPayment !== next.playerPayment ||
    existing.railCarrierCost !== next.railCarrierCost ||
    existing.currency !== next.currency ||
    existing.generationSeed !== next.generationSeed
  );
}
