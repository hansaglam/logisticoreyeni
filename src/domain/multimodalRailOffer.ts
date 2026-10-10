/**
 * Isolated ROAD→RAIL→ROAD multimodal offer generator (Map V2 Step 27).
 *
 * Offer candidates only. Not Contract, not Delivery, not Shipment.
 * Does not write save, mutate money, reserve fleet, or join availableContracts.
 */

import { STARTER_DRIVER } from '../data/drivers';
import { PRODUCTS, PRODUCT_IDS } from '../data/products';
import { STARTER_TRUCK } from '../data/trucks';
import { getRequiredLevelForTonnage } from '../config/levelConfig';
import type { ProductId } from '../types/game';
import {
  estimateMultimodalShipmentDuration,
  MULTIMODAL_DURATION_POLICY_VERSION,
  type MultimodalShipmentDurationEstimate,
} from './multimodalDurationPolicy';
import {
  findRoadTransferAccess,
  type MultimodalRoadTransferAccessArtifactV1,
} from './multimodalRoadAccess';
import {
  MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
  planMultimodalRoadAssignment,
  type MultimodalRoadAssignmentPlan,
  type MultimodalRoadFleetSnapshot,
} from './multimodalRoadAssignment';
import {
  ACCEPTED_RAIL_TARIFF_CORRIDORS,
  canonicalRailTariffRouteReference,
  estimateMultimodalRailTariff,
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
  RAIL_UNRESOLVED_CITY_IDS,
  snapshotReadyRailTariff,
  type FutureMultimodalRailEconomicSnapshot,
} from './multimodalRailTariff';
import {
  estimateRailOfferDeadlineGameSeconds,
  estimateRailOfferEconomics,
  MULTIMODAL_DEADLINE_POLICY_VERSION,
  MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION,
  RAIL_OFFER_CURRENCY,
  type RailOfferEconomicsBreakdown,
} from './multimodalRailOfferEconomics';
import { MULTIMODAL_FEATURE_ROLLOUT } from './multimodalShipmentPersistence';
import { getMultimodalSettlementId } from './multimodalSettlementIdentity';

export const RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION = 1 as const;
export const RAIL_MULTIMODAL_TRANSPORT_PATTERN = 'ROAD_RAIL_ROAD' as const;

/** GAMEPLAY_BALANCE_CONSTANT — isolated pool cap, not live ROAD contract count. */
export const MAX_RAIL_MULTIMODAL_OFFERS = 8;

export const RAIL_OFFER_CARGO_TONNES_BANDS = [1, 5, 10, 25] as const;

export type RailMultimodalOfferStatus = 'STRUCTURALLY_READY';

export type RailOfferCandidateRejection =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_ROUTE'
  | 'UNRESOLVED_RAIL_INFRASTRUCTURE'
  | 'ROAD_ACCESS_UNRESOLVED'
  | 'INVALID_CARGO'
  | 'CARGO_TOO_LARGE'
  | 'INVALID_DURATION'
  | 'INVALID_RAIL_TARIFF'
  | 'NON_POSITIVE_MARGIN'
  | 'UNSAFE_ECONOMICS'
  | 'UNSUPPORTED_SCHEMA'
  | 'NOT_EXECUTABLE'
  | 'LEVEL_GATED';

export type RailOfferFleetFeasibility =
  | 'READY_NOW'
  | 'REQUIRES_FLEET_CHANGE'
  | 'ORIGIN_FLEET_UNAVAILABLE'
  | 'DESTINATION_FLEET_UNAVAILABLE'
  | 'DRIVER_UNAVAILABLE'
  | 'CARGO_INCOMPATIBLE'
  | 'NOT_EVALUATED';

export type RailMultimodalOffer = {
  offerId: string;
  offerSchemaVersion: typeof RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION;
  transportPattern: typeof RAIL_MULTIMODAL_TRANSPORT_PATTERN;
  status: RailMultimodalOfferStatus;
  originCityId: string;
  destinationCityId: string;
  cargo: {
    productId: ProductId;
    quantity: number;
    quantityUnit: typeof RAIL_TARIFF_CARGO_QUANTITY_UNIT;
  };
  requiredLevel: number;
  railRouteReference: string;
  railDistanceMeters: number;
  firstMileAccess: {
    routeReference: string;
    distanceMeters: number;
    infrastructureId: string;
    distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS';
  };
  lastMileAccess: {
    routeReference: string;
    distanceMeters: number;
    infrastructureId: string;
    distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS';
  };
  durationSnapshot: {
    policyVersion: typeof MULTIMODAL_DURATION_POLICY_VERSION;
    totalDurationGameSeconds: number;
    movementDurationGameSeconds: number;
    transferDurationGameSeconds: number;
  };
  deadlineSnapshot: {
    policyVersion: typeof MULTIMODAL_DEADLINE_POLICY_VERSION;
    deadlineGameSeconds: number;
  };
  railTariffSnapshot: FutureMultimodalRailEconomicSnapshot;
  economics: RailOfferEconomicsBreakdown;
  playerPayment: number;
  toctou: typeof MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU;
  expiryPolicy: 'DEFERRED_NOT_IN_LIVE_POOL';
  carrierCostAccounting: 'NET_AT_FINAL_SETTLEMENT';
  generationSeed: string;
};

export type RailOfferGenerationRejection = {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  cargoQuantity: number;
  reason: RailOfferCandidateRejection;
};

export type RailMultimodalOfferGenerationResult = {
  status: 'READY' | 'INVALID_INPUT' | 'NOT_EXECUTABLE';
  offers: RailMultimodalOffer[];
  rejected: RailOfferGenerationRejection[];
  generationSeed: string;
  maxOffers: number;
};

function sanitizeSeed(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!text || text.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(text)) return null;
  return text;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const next = mulberry32(hashSeed(seed));
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function standardRoadPlanning(cargoTons: number) {
  return {
    cargoTons,
    routeDifficulty: 0.3,
    truckSpeedKmh: STARTER_TRUCK.speed,
    truckCapacityTons: STARTER_TRUCK.capacity,
    truckCondition: STARTER_TRUCK.condition,
    truckVehicleClass: STARTER_TRUCK.vehicleClass,
    truckCatalogId: STARTER_TRUCK.catalogId,
    driverSpeed: STARTER_DRIVER.speed,
    driverTier: STARTER_DRIVER.tier,
  };
}

function directionalCorridorPairs(): Array<{
  originCityId: string;
  destinationCityId: string;
}> {
  const pairs: Array<{ originCityId: string; destinationCityId: string }> = [];
  for (const corridor of ACCEPTED_RAIL_TARIFF_CORRIDORS) {
    pairs.push({ originCityId: corridor.leftCityId, destinationCityId: corridor.rightCityId });
    pairs.push({ originCityId: corridor.rightCityId, destinationCityId: corridor.leftCityId });
  }
  pairs.sort((a, b) => {
    if (a.originCityId !== b.originCityId) return a.originCityId.localeCompare(b.originCityId);
    return a.destinationCityId.localeCompare(b.destinationCityId);
  });
  return pairs;
}

export function buildRailMultimodalOfferId(input: {
  generationSeed: string;
  originCityId: string;
  destinationCityId: string;
  productId: string;
  cargoQuantity: number;
}): string {
  const tonnesKey = String(input.cargoQuantity).replace('.', 'p');
  return `railOffer:${input.generationSeed}:${input.originCityId}:${input.destinationCityId}:${input.productId}:${tonnesKey}`;
}

export function isRailMultimodalOfferGenerationAvailable(
  rollout: string = MULTIMODAL_FEATURE_ROLLOUT,
): boolean {
  return rollout === 'INTERNAL_TEST';
}

function reject(
  originCityId: string,
  destinationCityId: string,
  productId: string,
  cargoQuantity: number,
  reason: RailOfferCandidateRejection,
): RailOfferGenerationRejection {
  return { originCityId, destinationCityId, productId, cargoQuantity, reason };
}

function buildCandidate(input: {
  generationSeed: string;
  originCityId: string;
  destinationCityId: string;
  productId: ProductId;
  cargoQuantity: number;
  playerLevel: number;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
}): { offer: RailMultimodalOffer } | { rejection: RailOfferGenerationRejection } {
  const { originCityId, destinationCityId, productId, cargoQuantity, generationSeed } = input;
  const unresolved = RAIL_UNRESOLVED_CITY_IDS as readonly string[];
  if (unresolved.includes(originCityId) || unresolved.includes(destinationCityId)) {
    return {
      rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'UNRESOLVED_RAIL_INFRASTRUCTURE'),
    };
  }

  const product = PRODUCTS.find((row) => row.id === productId);
  if (!product) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'INVALID_CARGO') };
  }
  if (!Number.isFinite(cargoQuantity) || cargoQuantity <= 0) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'INVALID_CARGO') };
  }
  if (cargoQuantity > STARTER_TRUCK.capacity) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'CARGO_TOO_LARGE') };
  }

  const requiredLevel = getRequiredLevelForTonnage(cargoQuantity);
  if (requiredLevel > input.playerLevel) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'LEVEL_GATED') };
  }

  const routeReference = canonicalRailTariffRouteReference(originCityId, destinationCityId);
  const corridor = ACCEPTED_RAIL_TARIFF_CORRIDORS.find((row) => row.routeReference === routeReference);
  if (!corridor) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'UNSUPPORTED_ROUTE') };
  }

  const firstAccess = findRoadTransferAccess(input.accessArtifact, originCityId, 'RAIL');
  const lastAccess = findRoadTransferAccess(input.accessArtifact, destinationCityId, 'RAIL');
  if (!firstAccess || firstAccess.status !== 'READY' || !lastAccess || lastAccess.status !== 'READY') {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'ROAD_ACCESS_UNRESOLVED') };
  }
  if (firstAccess.distanceMeters === 5000 || lastAccess.distanceMeters === 5000) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'ROAD_ACCESS_UNRESOLVED') };
  }

  const tariff = estimateMultimodalRailTariff({
    routeReference,
    distanceMeters: corridor.distanceMeters,
    distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
    cargoQuantity,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    intent: 'PLAN',
  });
  const tariffSnap = snapshotReadyRailTariff(tariff);
  if (tariff.status !== 'READY' || tariffSnap == null) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'INVALID_RAIL_TARIFF') };
  }

  const duration: MultimodalShipmentDurationEstimate = estimateMultimodalShipmentDuration({
    planId: buildRailMultimodalOfferId({
      generationSeed,
      originCityId,
      destinationCityId,
      productId,
      cargoQuantity,
    }),
    shipmentSchemaVersion: 1,
    legs: [
      {
        legId: 'first-mile',
        mode: 'ROAD',
        distanceMeters: firstAccess.distanceMeters,
        distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
        routeReference: firstAccess.routeReference,
        roadPlanning: standardRoadPlanning(cargoQuantity),
      },
      {
        legId: 'rail-line-haul',
        mode: 'RAIL',
        distanceMeters: corridor.distanceMeters,
        distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
        routeReference,
      },
      {
        legId: 'last-mile',
        mode: 'ROAD',
        distanceMeters: lastAccess.distanceMeters,
        distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
        routeReference: lastAccess.routeReference,
        roadPlanning: standardRoadPlanning(cargoQuantity),
      },
    ],
    transfers: [
      { transferId: 'origin-transfer', fromMode: 'ROAD', toMode: 'RAIL' },
      { transferId: 'destination-transfer', fromMode: 'RAIL', toMode: 'ROAD' },
    ],
  });
  if (
    duration.status !== 'READY' ||
    duration.totalDurationGameSeconds == null ||
    duration.movementDurationGameSeconds == null ||
    duration.transferDurationGameSeconds == null
  ) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'INVALID_DURATION') };
  }

  const economics = estimateRailOfferEconomics({
    railCarrierCost: tariffSnap.railCarrierCost,
    firstMileDistanceMeters: firstAccess.distanceMeters,
    lastMileDistanceMeters: lastAccess.distanceMeters,
    cargoTonnes: cargoQuantity,
  });
  if (economics.status !== 'READY' || economics.economics == null) {
    const reason: RailOfferCandidateRejection =
      economics.status === 'NON_POSITIVE_MARGIN' ? 'NON_POSITIVE_MARGIN' : 'UNSAFE_ECONOMICS';
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, reason) };
  }

  const deadlineGameSeconds = estimateRailOfferDeadlineGameSeconds({
    plannedDurationGameSeconds: duration.totalDurationGameSeconds,
    perishability: product.perishability,
  });
  if (deadlineGameSeconds == null || deadlineGameSeconds <= duration.totalDurationGameSeconds) {
    return { rejection: reject(originCityId, destinationCityId, productId, cargoQuantity, 'INVALID_DURATION') };
  }

  const offerId = buildRailMultimodalOfferId({
    generationSeed,
    originCityId,
    destinationCityId,
    productId,
    cargoQuantity,
  });

  const offer: RailMultimodalOffer = {
    offerId,
    offerSchemaVersion: RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION,
    transportPattern: RAIL_MULTIMODAL_TRANSPORT_PATTERN,
    status: 'STRUCTURALLY_READY',
    originCityId,
    destinationCityId,
    cargo: {
      productId,
      quantity: cargoQuantity,
      quantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    },
    requiredLevel,
    railRouteReference: routeReference,
    railDistanceMeters: corridor.distanceMeters,
    firstMileAccess: {
      routeReference: firstAccess.routeReference,
      distanceMeters: firstAccess.distanceMeters,
      infrastructureId: firstAccess.infrastructureId,
      distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
    },
    lastMileAccess: {
      routeReference: lastAccess.routeReference,
      distanceMeters: lastAccess.distanceMeters,
      infrastructureId: lastAccess.infrastructureId,
      distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
    },
    durationSnapshot: {
      policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
      totalDurationGameSeconds: duration.totalDurationGameSeconds,
      movementDurationGameSeconds: duration.movementDurationGameSeconds,
      transferDurationGameSeconds: duration.transferDurationGameSeconds,
    },
    deadlineSnapshot: {
      policyVersion: MULTIMODAL_DEADLINE_POLICY_VERSION,
      deadlineGameSeconds,
    },
    railTariffSnapshot: tariffSnap,
    economics: economics.economics,
    playerPayment: economics.economics.playerPayment,
    toctou: MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
    expiryPolicy: 'DEFERRED_NOT_IN_LIVE_POOL',
    carrierCostAccounting: 'NET_AT_FINAL_SETTLEMENT',
    generationSeed,
  };
  return { offer };
}

function pickDiverseOffers(valid: RailMultimodalOffer[], seed: string, maxOffers: number): RailMultimodalOffer[] {
  const shuffled = seededShuffle(valid, seed);
  const selected: RailMultimodalOffer[] = [];
  const pairCounts = new Map<string, number>();
  const pairKey = (row: RailMultimodalOffer) => `${row.originCityId}>${row.destinationCityId}`;

  const tryTake = (maxPerPair: number) => {
    for (const offer of shuffled) {
      if (selected.length >= maxOffers) return;
      if (selected.some((row) => row.offerId === offer.offerId)) continue;
      const key = pairKey(offer);
      const count = pairCounts.get(key) ?? 0;
      if (count >= maxPerPair) continue;
      selected.push(offer);
      pairCounts.set(key, count + 1);
    }
  };

  tryTake(1);
  tryTake(2);
  for (const offer of shuffled) {
    if (selected.length >= maxOffers) break;
    if (selected.some((row) => row.offerId === offer.offerId)) continue;
    selected.push(offer);
  }

  selected.sort((a, b) => {
    if (a.originCityId !== b.originCityId) return a.originCityId.localeCompare(b.originCityId);
    if (a.destinationCityId !== b.destinationCityId) {
      return a.destinationCityId.localeCompare(b.destinationCityId);
    }
    if (a.cargo.productId !== b.cargo.productId) return a.cargo.productId.localeCompare(b.cargo.productId);
    if (a.cargo.quantity !== b.cargo.quantity) return a.cargo.quantity - b.cargo.quantity;
    return a.offerId.localeCompare(b.offerId);
  });
  return selected;
}

export function enumerateRailMultimodalOfferCandidates(input: {
  generationSeed: string;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  playerLevel?: number;
  productIds?: readonly ProductId[];
  cargoTonnesBands?: readonly number[];
}): { valid: RailMultimodalOffer[]; rejected: RailOfferGenerationRejection[] } {
  const playerLevel = input.playerLevel ?? 1;
  const productIds = [...(input.productIds ?? PRODUCT_IDS)].sort();
  const bands = [...(input.cargoTonnesBands ?? RAIL_OFFER_CARGO_TONNES_BANDS)].sort((a, b) => a - b);
  const pairs = directionalCorridorPairs();
  const rejected: RailOfferGenerationRejection[] = [];
  const valid: RailMultimodalOffer[] = [];

  for (const pair of pairs) {
    for (const productId of productIds) {
      for (const cargoQuantity of bands) {
        const built = buildCandidate({
          generationSeed: input.generationSeed,
          originCityId: pair.originCityId,
          destinationCityId: pair.destinationCityId,
          productId,
          cargoQuantity,
          playerLevel,
          accessArtifact: input.accessArtifact,
        });
        if ('rejection' in built) {
          rejected.push(built.rejection);
        } else {
          valid.push(built.offer);
        }
      }
    }
  }
  return { valid, rejected };
}

export function generateRailMultimodalOffers(input: {
  generationSeed: unknown;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  playerLevel?: number;
  maxOffers?: number;
  productIds?: readonly ProductId[];
  cargoTonnesBands?: readonly number[];
}): RailMultimodalOfferGenerationResult {
  const generationSeed = sanitizeSeed(input.generationSeed);
  if (!generationSeed) {
    return { status: 'INVALID_INPUT', offers: [], rejected: [], generationSeed: '', maxOffers: 0 };
  }
  if (input.accessArtifact?.schemaVersion !== 1 || !Array.isArray(input.accessArtifact.records)) {
    return { status: 'INVALID_INPUT', offers: [], rejected: [], generationSeed, maxOffers: 0 };
  }

  const maxOffers = input.maxOffers ?? MAX_RAIL_MULTIMODAL_OFFERS;
  if (!Number.isInteger(maxOffers) || maxOffers <= 0 || maxOffers > 32) {
    return { status: 'INVALID_INPUT', offers: [], rejected: [], generationSeed, maxOffers: 0 };
  }

  const { valid, rejected } = enumerateRailMultimodalOfferCandidates({
    generationSeed,
    accessArtifact: input.accessArtifact,
    playerLevel: input.playerLevel,
    productIds: input.productIds,
    cargoTonnesBands: input.cargoTonnesBands,
  });

  const offers = pickDiverseOffers(valid, generationSeed, maxOffers);
  return { status: 'READY', offers, rejected, generationSeed, maxOffers };
}

function mapAssignmentToFeasibility(plan: MultimodalRoadAssignmentPlan): RailOfferFleetFeasibility {
  if (plan.status === 'READY') return 'READY_NOW';
  if (plan.status === 'NO_ELIGIBLE_ORIGIN_TRUCK') return 'ORIGIN_FLEET_UNAVAILABLE';
  if (plan.status === 'NO_ELIGIBLE_DESTINATION_TRUCK') return 'DESTINATION_FLEET_UNAVAILABLE';
  if (plan.status === 'NO_ELIGIBLE_DRIVER') return 'DRIVER_UNAVAILABLE';
  if (plan.status === 'CARGO_INCOMPATIBLE') return 'CARGO_INCOMPATIBLE';
  return 'REQUIRES_FLEET_CHANGE';
}

export type RailMultimodalOfferAcceptancePreview = {
  canAcceptNow: false;
  structurallyValid: boolean;
  fleetFeasibility: RailOfferFleetFeasibility;
  reasons: string[];
  suggestedFirstMileTruckId: string | null;
  suggestedLastMileTruckId: string | null;
  productionOffersVisible: boolean;
  revalidateAtAcceptance: typeof MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU;
};

export function evaluateRailMultimodalOfferAcceptance(input: {
  offer: unknown;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  fleet?: MultimodalRoadFleetSnapshot | null;
  productionCheck?: boolean;
}): RailMultimodalOfferAcceptancePreview {
  const base = {
    canAcceptNow: false as const,
    suggestedFirstMileTruckId: null as string | null,
    suggestedLastMileTruckId: null as string | null,
    productionOffersVisible: isRailMultimodalOfferGenerationAvailable(),
    revalidateAtAcceptance: MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
  };

  const offer = input.offer as RailMultimodalOffer | null;
  if (!offer || typeof offer !== 'object') {
    return {
      ...base,
      structurallyValid: false,
      fleetFeasibility: 'NOT_EVALUATED',
      reasons: ['INVALID_INPUT'],
    };
  }
  if (offer.offerSchemaVersion !== RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION) {
    return {
      ...base,
      structurallyValid: false,
      fleetFeasibility: 'NOT_EVALUATED',
      reasons: ['UNSUPPORTED_SCHEMA'],
    };
  }
  if (offer.transportPattern !== RAIL_MULTIMODAL_TRANSPORT_PATTERN) {
    return {
      ...base,
      structurallyValid: false,
      fleetFeasibility: 'NOT_EVALUATED',
      reasons: ['NOT_EXECUTABLE'],
    };
  }
  if (input.productionCheck === true && !isRailMultimodalOfferGenerationAvailable()) {
    return {
      ...base,
      structurallyValid: true,
      fleetFeasibility: 'NOT_EVALUATED',
      reasons: ['MULTIMODAL_OFF'],
    };
  }
  if (!input.fleet) {
    return {
      ...base,
      structurallyValid: true,
      fleetFeasibility: 'NOT_EVALUATED',
      reasons: ['FLEET_NOT_PROVIDED'],
    };
  }

  const plan = planMultimodalRoadAssignment({
    originCityId: offer.originCityId,
    destinationCityId: offer.destinationCityId,
    transferMode: 'RAIL',
    accessArtifact: input.accessArtifact,
    fleet: input.fleet,
    cargoWeightTons: offer.cargo.quantity,
    originInfrastructureId: offer.firstMileAccess.infrastructureId,
    destinationInfrastructureId: offer.lastMileAccess.infrastructureId,
  });
  const fleetFeasibility = mapAssignmentToFeasibility(plan);
  const reasons =
    plan.status === 'READY'
      ? ['STRUCTURALLY_READY', 'FLEET_READY_NOW_STILL_MUST_REVALIDATE']
      : [...plan.reasons];
  return {
    ...base,
    structurallyValid: true,
    fleetFeasibility,
    reasons,
    suggestedFirstMileTruckId: plan.firstMile.truckId ?? null,
    suggestedLastMileTruckId: plan.lastMile.truckId ?? null,
  };
}

export function railOfferSettlementCollision(offerId: string): boolean {
  const settlement = getMultimodalSettlementId(offerId.replace(/[^A-Za-z0-9._-]/g, '_'));
  return settlement.ok && settlement.id === offerId;
}

export {
  MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION,
  RAIL_OFFER_CURRENCY,
  MULTIMODAL_DURATION_POLICY_VERSION,
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
};
