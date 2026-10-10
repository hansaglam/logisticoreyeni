/**
 * Production-safe ROAD→RAIL→ROAD INTERNAL_TEST acceptance (Map V2 Step 29).
 *
 * PREPARE is pure. COMMIT is a separate next-state builder.
 * Does not call startDelivery, does not pay, does not settle.
 */

import { STARTER_DRIVER } from '../data/drivers';
import { STARTER_TRUCK } from '../data/trucks';
import { getFuelRequiredForDistance, getTruckFuelConsumptionPerKm, normalizeTruckFuel } from '../utils/truckFuel';
import { resolveTruckCityId } from '../simulation/delivery';
import type { Truck } from '../types/game';
import type { PlayerFleetSlice } from './multimodalFleetReservation';
import {
  allowMultimodalRailAcceptance,
  type MultimodalFeatureRolloutState,
} from './multimodalFeatureRollout';
import {
  estimateMultimodalShipmentDuration,
  MULTIMODAL_DURATION_POLICY_VERSION,
} from './multimodalDurationPolicy';
import {
  isDriverReservedForMultimodal,
  isTrailerReservedForMultimodal,
  isTruckReservedForMultimodal,
} from './multimodalFleetReservation';
import {
  evaluateRailMultimodalOfferAcceptance,
  RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION,
  RAIL_MULTIMODAL_TRANSPORT_PATTERN,
  type RailMultimodalOffer,
} from './multimodalRailOffer';
import {
  MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION,
  MULTIMODAL_DEADLINE_POLICY_VERSION,
} from './multimodalRailOfferEconomics';
import {
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
} from './multimodalRailTariff';
import {
  planMultimodalRoadAssignment,
  type MultimodalRoadFleetSnapshot,
} from './multimodalRoadAssignment';
import type { MultimodalRoadTransferAccessArtifactV1 } from './multimodalRoadAccess';
import {
  getMultimodalCompletionId,
  getMultimodalSettlementId,
  isValidMultimodalShipmentId,
} from './multimodalSettlementIdentity';
import {
  isExecutablePersistedMultimodalShipment,
  MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL,
  SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
  type PersistedMultimodalShipment,
  type PersistedReadableMultimodalShipment,
} from './multimodalShipmentPersistence';
import { MULTIMODAL_EXECUTION_POLICY_VERSION } from './multimodalRailExecution';

export const MULTIMODAL_FUEL_ACCEPTANCE_POLICY = 'VALIDATED_NOT_CONSUMED' as const;

export type RailAcceptanceStatus =
  | 'READY_TO_COMMIT'
  | 'FEATURE_DISABLED'
  | 'OFFER_SCHEMA_UNSUPPORTED'
  | 'OFFER_ALREADY_ACCEPTED'
  | 'ROUTE_UNSUPPORTED'
  | 'FLEET_REVALIDATION_FAILED'
  | 'ORIGIN_TRUCK_UNAVAILABLE'
  | 'DESTINATION_TRUCK_UNAVAILABLE'
  | 'DRIVER_UNAVAILABLE'
  | 'TRAILER_UNAVAILABLE'
  | 'CARGO_INCOMPATIBLE'
  | 'FUEL_INSUFFICIENT'
  | 'INVALID_DURATION_SNAPSHOT'
  | 'INVALID_TARIFF_SNAPSHOT'
  | 'INVALID_ECONOMIC_SNAPSHOT'
  | 'MAX_ACTIVE_SHIPMENTS_REACHED'
  | 'COMMIT_FAILED'
  | 'SEA_NOT_ACTIVATED'
  | 'AIR_NOT_ACTIVATED';

export type FrozenDurationSnapshot = {
  policyVersion: typeof MULTIMODAL_DURATION_POLICY_VERSION;
  totalDurationGameSeconds: number;
  movementDurationGameSeconds: number;
  transferDurationGameSeconds: number;
  firstMileGameSeconds: number;
  originTransferGameSeconds: number;
  railLinehaulGameSeconds: number;
  destinationTransferGameSeconds: number;
  lastMileGameSeconds: number;
};

export type FrozenAssignmentSnapshot = {
  firstMileTruckId: string;
  firstMileDriverId: string;
  firstMileTrailerId: string | null;
  lastMileTruckId: string;
  lastMileDriverId: string;
  lastMileTrailerId: string | null;
};

export type PreparedRailMultimodalAcceptance = {
  status: 'READY_TO_COMMIT';
  shipmentId: string;
  sourceOfferId: string;
  settlementId: string;
  completionId: string;
  shipment: PersistedReadableMultimodalShipment;
};

export type PrepareRailAcceptanceFailure = {
  status: Exclude<RailAcceptanceStatus, 'READY_TO_COMMIT'>;
  reason: string;
  shipmentId?: string;
};

export type PrepareRailAcceptanceResult =
  | PreparedRailMultimodalAcceptance
  | PrepareRailAcceptanceFailure;

function fnv1aHex(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function mintMultimodalShipmentIdFromOfferId(offerId: string): string | null {
  const sanitized = `mls.${offerId.replace(/:/g, '.')}`;
  if (isValidMultimodalShipmentId(sanitized) && sanitized.length <= 128) {
    return sanitized;
  }
  const hashed = `mls.offer.${fnv1aHex(offerId)}`;
  return isValidMultimodalShipmentId(hashed) ? hashed : null;
}

function requiredFuelLiters(truck: Truck, distanceMeters: number, cargoTons: number): number {
  return getFuelRequiredForDistance({
    distanceKm: distanceMeters / 1000,
    fuelConsumptionPerKm: getTruckFuelConsumptionPerKm(truck),
    cargoWeightTons: cargoTons,
    truckCapacityTons: truck.capacity,
  });
}

function mapPlanFailure(status: string): Exclude<RailAcceptanceStatus, 'READY_TO_COMMIT'> {
  if (status === 'NO_ELIGIBLE_ORIGIN_TRUCK' || status === 'INVALID_REQUESTED_TRUCK') {
    return 'ORIGIN_TRUCK_UNAVAILABLE';
  }
  if (status === 'NO_ELIGIBLE_DESTINATION_TRUCK' || status === 'SAME_TRUCK_TELEPORT') {
    return 'DESTINATION_TRUCK_UNAVAILABLE';
  }
  if (status === 'NO_ELIGIBLE_DRIVER') return 'DRIVER_UNAVAILABLE';
  if (status === 'NO_ELIGIBLE_TRAILER') return 'TRAILER_UNAVAILABLE';
  if (status === 'CARGO_INCOMPATIBLE') return 'CARGO_INCOMPATIBLE';
  if (status === 'UNSUPPORTED_ROUTE' || status === 'UNSUPPORTED_MODE') return 'ROUTE_UNSUPPORTED';
  return 'FLEET_REVALIDATION_FAILED';
}

function findExistingForOffer(
  shipments: readonly PersistedMultimodalShipment[],
  offerId: string,
): PersistedReadableMultimodalShipment | null {
  for (const row of shipments) {
    if (!isExecutablePersistedMultimodalShipment(row)) continue;
    if (row.sourceOfferId === offerId || row.contractId === offerId) {
      return row;
    }
  }
  return null;
}

function countActiveInternal(shipments: readonly PersistedMultimodalShipment[]): number {
  let n = 0;
  for (const row of shipments) {
    if (!isExecutablePersistedMultimodalShipment(row)) continue;
    if (row.status === 'ACTIVE' || row.status === 'PLANNED' || row.status === 'BLOCKED') n += 1;
  }
  return n;
}

export function prepareRailMultimodalAcceptance(input: {
  offer: unknown;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  fleet: MultimodalRoadFleetSnapshot;
  shipments?: readonly PersistedMultimodalShipment[];
  currentTimeGameHours: number;
  nowMs: number;
  rollout?: string;
  allowAcceptance?: boolean;
  transportPatternOverride?: string;
}): PrepareRailAcceptanceResult {
  const allow =
    input.allowAcceptance ??
    allowMultimodalRailAcceptance({
      rollout: input.rollout as MultimodalFeatureRolloutState | undefined,
    });
  if (!allow) {
    return { status: 'FEATURE_DISABLED', reason: 'INTERNAL_TEST_REQUIRED' };
  }

  const pattern = input.transportPatternOverride;
  if (pattern === 'ROAD_SEA_ROAD') {
    return { status: 'SEA_NOT_ACTIVATED', reason: 'SEA_NOT_ACTIVATED' };
  }
  if (pattern === 'ROAD_AIR_ROAD') {
    return { status: 'AIR_NOT_ACTIVATED', reason: 'AIR_NOT_ACTIVATED' };
  }

  const offer = input.offer as RailMultimodalOffer | null;
  if (!offer || typeof offer !== 'object' || offer.offerSchemaVersion !== RAIL_MULTIMODAL_OFFER_SCHEMA_VERSION) {
    return { status: 'OFFER_SCHEMA_UNSUPPORTED', reason: 'OFFER_SCHEMA_UNSUPPORTED' };
  }
  if (offer.transportPattern !== RAIL_MULTIMODAL_TRANSPORT_PATTERN) {
    return { status: 'ROUTE_UNSUPPORTED', reason: 'TRANSPORT_PATTERN' };
  }

  const existing = findExistingForOffer(input.shipments ?? [], offer.offerId);
  if (existing) {
    return {
      status: 'OFFER_ALREADY_ACCEPTED',
      reason: 'OFFER_ALREADY_ACCEPTED',
      shipmentId: existing.shipmentId,
    };
  }

  if (countActiveInternal(input.shipments ?? []) >= MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL) {
    return { status: 'MAX_ACTIVE_SHIPMENTS_REACHED', reason: 'MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL' };
  }

  if (
    offer.durationSnapshot?.policyVersion !== MULTIMODAL_DURATION_POLICY_VERSION ||
    typeof offer.durationSnapshot.totalDurationGameSeconds !== 'number'
  ) {
    return { status: 'INVALID_DURATION_SNAPSHOT', reason: 'MISSING_DURATION' };
  }
  if (offer.railTariffSnapshot?.railTariffPolicyVersion !== MULTIMODAL_RAIL_TARIFF_POLICY_VERSION) {
    return { status: 'INVALID_TARIFF_SNAPSHOT', reason: 'MISSING_TARIFF' };
  }
  if (offer.economics?.policyVersion !== MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'MISSING_ECONOMICS' };
  }

  const preview = evaluateRailMultimodalOfferAcceptance({
    offer,
    accessArtifact: input.accessArtifact,
    fleet: input.fleet,
  });
  if (!preview.structurallyValid) {
    return { status: 'OFFER_SCHEMA_UNSUPPORTED', reason: preview.reasons.join(',') };
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
  if (plan.status !== 'READY' || !plan.firstMile.truckId || !plan.lastMile.truckId) {
    return { status: mapPlanFailure(plan.status), reason: plan.status };
  }
  if (!plan.firstMile.driverId || !plan.lastMile.driverId) {
    return { status: 'DRIVER_UNAVAILABLE', reason: 'DRIVER_UNAVAILABLE' };
  }
  if (plan.firstMile.truckId === plan.lastMile.truckId) {
    return { status: 'DESTINATION_TRUCK_UNAVAILABLE', reason: 'SAME_TRUCK_TELEPORT' };
  }

  const trucks = input.fleet.trucks;
  const drivers = input.fleet.drivers;
  const trailers = input.fleet.trailers;
  const originTruck = trucks.find((row) => row.id === plan.firstMile.truckId);
  const destTruck = trucks.find((row) => row.id === plan.lastMile.truckId);
  const originDriver = drivers.find((row) => row.id === plan.firstMile.driverId);
  const destDriver = drivers.find((row) => row.id === plan.lastMile.driverId);
  if (!originTruck || originTruck.status !== 'idle' || isTruckReservedForMultimodal(originTruck)) {
    return { status: 'ORIGIN_TRUCK_UNAVAILABLE', reason: 'ORIGIN_TRUCK_UNAVAILABLE' };
  }
  if (!destTruck || destTruck.status !== 'idle' || isTruckReservedForMultimodal(destTruck)) {
    return { status: 'DESTINATION_TRUCK_UNAVAILABLE', reason: 'DESTINATION_TRUCK_UNAVAILABLE' };
  }
  if (resolveTruckCityId(originTruck) !== offer.originCityId) {
    return { status: 'ORIGIN_TRUCK_UNAVAILABLE', reason: 'WRONG_CITY' };
  }
  if (resolveTruckCityId(destTruck) !== offer.destinationCityId) {
    return { status: 'DESTINATION_TRUCK_UNAVAILABLE', reason: 'WRONG_CITY' };
  }
  if (!originDriver || originDriver.status === 'driving' || isDriverReservedForMultimodal(originDriver)) {
    return { status: 'DRIVER_UNAVAILABLE', reason: 'ORIGIN_DRIVER' };
  }
  if (!destDriver || destDriver.status === 'driving' || isDriverReservedForMultimodal(destDriver)) {
    return { status: 'DRIVER_UNAVAILABLE', reason: 'DESTINATION_DRIVER' };
  }
  if (originDriver.id === destDriver.id) {
    return { status: 'DRIVER_UNAVAILABLE', reason: 'SAME_DRIVER_ACROSS_CITIES' };
  }

  const firstTrailer = plan.firstMile.trailerId
    ? trailers.find((row) => row.id === plan.firstMile.trailerId)
    : undefined;
  const lastTrailer = plan.lastMile.trailerId
    ? trailers.find((row) => row.id === plan.lastMile.trailerId)
    : undefined;
  if (plan.firstMile.trailerId && (!firstTrailer || isTrailerReservedForMultimodal(firstTrailer))) {
    return { status: 'TRAILER_UNAVAILABLE', reason: 'FIRST_MILE_TRAILER' };
  }
  if (plan.lastMile.trailerId && (!lastTrailer || isTrailerReservedForMultimodal(lastTrailer))) {
    return { status: 'TRAILER_UNAVAILABLE', reason: 'LAST_MILE_TRAILER' };
  }

  const firstFuel = requiredFuelLiters(originTruck, offer.firstMileAccess.distanceMeters, offer.cargo.quantity);
  const lastFuel = requiredFuelLiters(destTruck, offer.lastMileAccess.distanceMeters, offer.cargo.quantity);
  const originFuelNow = normalizeTruckFuel(originTruck).currentFuelL ?? 0;
  const destFuelNow = normalizeTruckFuel(destTruck).currentFuelL ?? 0;
  if (originFuelNow + 1e-6 < firstFuel || destFuelNow + 1e-6 < lastFuel) {
    return { status: 'FUEL_INSUFFICIENT', reason: MULTIMODAL_FUEL_ACCEPTANCE_POLICY };
  }

  const duration = estimateMultimodalShipmentDuration({
    planId: offer.offerId,
    shipmentSchemaVersion: 1,
    legs: [
      {
        legId: 'first-mile',
        mode: 'ROAD',
        distanceMeters: offer.firstMileAccess.distanceMeters,
        distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
        routeReference: offer.firstMileAccess.routeReference,
        roadPlanning: {
          cargoTons: offer.cargo.quantity,
          routeDifficulty: 0.3,
          truckSpeedKmh: STARTER_TRUCK.speed,
          truckCapacityTons: STARTER_TRUCK.capacity,
          truckCondition: STARTER_TRUCK.condition,
          truckVehicleClass: STARTER_TRUCK.vehicleClass,
          truckCatalogId: STARTER_TRUCK.catalogId,
          driverSpeed: STARTER_DRIVER.speed,
          driverTier: STARTER_DRIVER.tier,
        },
      },
      {
        legId: 'rail-line-haul',
        mode: 'RAIL',
        distanceMeters: offer.railDistanceMeters,
        distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
        routeReference: offer.railRouteReference,
      },
      {
        legId: 'last-mile',
        mode: 'ROAD',
        distanceMeters: offer.lastMileAccess.distanceMeters,
        distanceAuthority: 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS',
        routeReference: offer.lastMileAccess.routeReference,
        roadPlanning: {
          cargoTons: offer.cargo.quantity,
          routeDifficulty: 0.3,
          truckSpeedKmh: STARTER_TRUCK.speed,
          truckCapacityTons: STARTER_TRUCK.capacity,
          truckCondition: STARTER_TRUCK.condition,
          truckVehicleClass: STARTER_TRUCK.vehicleClass,
          truckCatalogId: STARTER_TRUCK.catalogId,
          driverSpeed: STARTER_DRIVER.speed,
          driverTier: STARTER_DRIVER.tier,
        },
      },
    ],
    transfers: [
      { transferId: 'origin-transfer', fromMode: 'ROAD', toMode: 'RAIL' },
      { transferId: 'destination-transfer', fromMode: 'RAIL', toMode: 'ROAD' },
    ],
  });
  if (
    duration.status !== 'READY' ||
    duration.totalDurationGameSeconds !== offer.durationSnapshot.totalDurationGameSeconds ||
    duration.movementDurationGameSeconds == null ||
    duration.transferDurationGameSeconds == null
  ) {
    return { status: 'INVALID_DURATION_SNAPSHOT', reason: 'DURATION_MISMATCH' };
  }
  const firstMileGameSeconds = duration.legDurations[0]?.durationGameSeconds ?? null;
  const railGameSeconds = duration.legDurations[1]?.durationGameSeconds ?? null;
  const lastMileGameSeconds = duration.legDurations[2]?.durationGameSeconds ?? null;
  const originTransferGameSeconds = duration.transferDurations[0]?.durationGameSeconds ?? null;
  const destinationTransferGameSeconds = duration.transferDurations[1]?.durationGameSeconds ?? null;
  if (
    firstMileGameSeconds == null ||
    railGameSeconds == null ||
    lastMileGameSeconds == null ||
    originTransferGameSeconds == null ||
    destinationTransferGameSeconds == null
  ) {
    return { status: 'INVALID_DURATION_SNAPSHOT', reason: 'STAGE_DURATION' };
  }

  const shipmentId = mintMultimodalShipmentIdFromOfferId(offer.offerId);
  if (!shipmentId || shipmentId === offer.offerId) {
    return { status: 'COMMIT_FAILED', reason: 'SHIPMENT_ID' };
  }
  const settlement = getMultimodalSettlementId(shipmentId);
  const completion = getMultimodalCompletionId(shipmentId);
  if (!settlement.ok || !completion.ok) {
    return { status: 'COMMIT_FAILED', reason: 'IDENTITY' };
  }

  const durationSnapshot: FrozenDurationSnapshot = {
    policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
    totalDurationGameSeconds: duration.totalDurationGameSeconds,
    movementDurationGameSeconds: duration.movementDurationGameSeconds,
    transferDurationGameSeconds: duration.transferDurationGameSeconds,
    firstMileGameSeconds,
    originTransferGameSeconds,
    railLinehaulGameSeconds: railGameSeconds,
    destinationTransferGameSeconds,
    lastMileGameSeconds,
  };

  const assignment: FrozenAssignmentSnapshot = {
    firstMileTruckId: originTruck.id,
    firstMileDriverId: originDriver.id,
    firstMileTrailerId: firstTrailer?.id ?? null,
    lastMileTruckId: destTruck.id,
    lastMileDriverId: destDriver.id,
    lastMileTrailerId: lastTrailer?.id ?? null,
  };

  const shipment: PersistedReadableMultimodalShipment = {
    shipmentSchemaVersion: SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
    shipmentId,
    contractId: offer.offerId,
    sourceOfferId: offer.offerId,
    transportPattern: RAIL_MULTIMODAL_TRANSPORT_PATTERN,
    originCityId: offer.originCityId,
    destinationCityId: offer.destinationCityId,
    status: 'ACTIVE',
    currentStepIndex: 0,
    createdAt: input.currentTimeGameHours,
    startedAt: input.currentTimeGameHours,
    acceptedAtGameHours: input.currentTimeGameHours,
    lastProgressedRealAtMs: input.nowMs,
    executionPolicyVersion: MULTIMODAL_EXECUTION_POLICY_VERSION,
    executionStage: 'FIRST_MILE_ROAD',
    currentStageElapsedGameSeconds: 0,
    totalElapsedGameSeconds: 0,
    completedStages: [],
    durationSnapshot,
    deadlineSnapshot: {
      policyVersion: MULTIMODAL_DEADLINE_POLICY_VERSION,
      deadlineGameSeconds: offer.deadlineSnapshot.deadlineGameSeconds,
    },
    railTariffSnapshot: {
      policyVersion: offer.railTariffSnapshot.railTariffPolicyVersion,
      routeReference: offer.railTariffSnapshot.routeReference,
      distanceMeters: offer.railTariffSnapshot.distanceMeters,
      cargoQuantity: offer.railTariffSnapshot.cargoQuantity,
      railCarrierCost: offer.railTariffSnapshot.railCarrierCost,
    },
    economicSnapshot: {
      capturedAt: input.currentTimeGameHours,
      currency: 'USD_GAME',
      policyVersion: offer.economics.policyVersion,
      playerPayment: offer.playerPayment,
      railCarrierCost: offer.economics.railCarrierCost,
      expectedGrossMargin: offer.economics.expectedGrossMargin,
      estimatedRoadOperatingCost: offer.economics.estimatedRoadOperatingCost,
    },
    roadAccessSnapshot: {
      firstMileRouteReference: offer.firstMileAccess.routeReference,
      firstMileDistanceMeters: offer.firstMileAccess.distanceMeters,
      lastMileRouteReference: offer.lastMileAccess.routeReference,
      lastMileDistanceMeters: offer.lastMileAccess.distanceMeters,
    },
    assignmentSnapshot: assignment,
    cargoSnapshot: {
      productId: offer.cargo.productId,
      quantity: offer.cargo.quantity,
      quantityUnit: offer.cargo.quantityUnit,
    },
    settlement: {
      settlementId: settlement.id,
    },
    settlementState: 'NOT_SETTLED',
    fuelPolicy: MULTIMODAL_FUEL_ACCEPTANCE_POLICY,
    legs: [
      {
        legId: 'first-mile',
        mode: 'ROAD',
        fromNodeId: `city.${offer.originCityId}`,
        toNodeId: `rail.${offer.originCityId}`,
        route: { routeReference: offer.firstMileAccess.routeReference, mode: 'ROAD' },
        status: 'IN_PROGRESS',
        assignedAssetId: originTruck.id,
        distanceMeters: offer.firstMileAccess.distanceMeters,
        startedAt: input.currentTimeGameHours,
      },
      {
        legId: 'rail-line-haul',
        mode: 'RAIL',
        fromNodeId: `rail.${offer.originCityId}`,
        toNodeId: `rail.${offer.destinationCityId}`,
        route: { routeReference: offer.railRouteReference, mode: 'RAIL' },
        status: 'PLANNED',
        distanceMeters: offer.railDistanceMeters,
      },
      {
        legId: 'last-mile',
        mode: 'ROAD',
        fromNodeId: `rail.${offer.destinationCityId}`,
        toNodeId: `city.${offer.destinationCityId}`,
        route: { routeReference: offer.lastMileAccess.routeReference, mode: 'ROAD' },
        status: 'PLANNED',
        assignedAssetId: destTruck.id,
        distanceMeters: offer.lastMileAccess.distanceMeters,
      },
    ],
    transfers: [
      {
        transferId: 'origin-transfer',
        transferNodeId: `xfer.origin.${offer.originCityId}`,
        fromMode: 'ROAD',
        toMode: 'RAIL',
        status: 'PENDING',
      },
      {
        transferId: 'destination-transfer',
        transferNodeId: `xfer.dest.${offer.destinationCityId}`,
        fromMode: 'RAIL',
        toMode: 'ROAD',
        status: 'PENDING',
      },
    ],
    provenance: {
      modeSequence: ['ROAD', 'RAIL', 'ROAD'],
    },
  };

  return {
    status: 'READY_TO_COMMIT',
    shipmentId,
    sourceOfferId: offer.offerId,
    settlementId: settlement.id,
    completionId: completion.id,
    shipment,
  };
}

export function applyCanonicalAcceptanceReceiptToPrepared(
  prepared: PreparedRailMultimodalAcceptance,
  receipt: {
    shipmentId: string;
    sourceOfferId: string;
    playerPayment: number;
    railCarrierCost: number;
    estimatedRoadOperatingCost?: number;
    expectedGrossMargin?: number;
    currency: string;
    acceptedAtMs: number;
    policyVersions?: { offerEconomicsPolicyVersion?: string };
  },
): PreparedRailMultimodalAcceptance | { status: 'CANONICAL_ACCEPTANCE_CONFLICT'; reason: string } {
  if (prepared.shipmentId !== receipt.shipmentId || prepared.sourceOfferId !== receipt.sourceOfferId) {
    return { status: 'CANONICAL_ACCEPTANCE_CONFLICT', reason: 'CANONICAL_ACCEPTANCE_CONFLICT' };
  }
  return {
    ...prepared,
    shipment: {
      ...prepared.shipment,
      railTariffSnapshot: prepared.shipment.railTariffSnapshot
        ? {
            ...prepared.shipment.railTariffSnapshot,
            railCarrierCost: receipt.railCarrierCost,
          }
        : prepared.shipment.railTariffSnapshot,
      economicSnapshot: {
        ...prepared.shipment.economicSnapshot,
        capturedAt: prepared.shipment.economicSnapshot?.capturedAt,
        currency: receipt.currency === 'USD_GAME_INTEGER' ? 'USD_GAME_INTEGER' : 'USD_GAME',
        policyVersion:
          receipt.policyVersions?.offerEconomicsPolicyVersion ??
          prepared.shipment.economicSnapshot?.policyVersion,
        playerPayment: receipt.playerPayment,
        railCarrierCost: receipt.railCarrierCost,
        expectedGrossMargin:
          receipt.expectedGrossMargin ??
          receipt.playerPayment -
            receipt.railCarrierCost -
            (receipt.estimatedRoadOperatingCost ??
              prepared.shipment.economicSnapshot?.estimatedRoadOperatingCost ??
              0),
        estimatedRoadOperatingCost:
          receipt.estimatedRoadOperatingCost ??
          prepared.shipment.economicSnapshot?.estimatedRoadOperatingCost,
      },
      canonicalAcceptedAtMs: receipt.acceptedAtMs,
      canonicalAuthority: 'SERVER_ACCOUNT_AUTHORITY',
    },
  };
}

export type CommitRailAcceptanceInput = {
  player: PlayerFleetSlice;
  activeDeliveries: readonly unknown[];
  availableContracts: readonly unknown[];
  financeLedger: readonly unknown[];
  multimodalShipments: PersistedMultimodalShipment[];
  prepared: PreparedRailMultimodalAcceptance;
  simulateFailure?: boolean;
};

export type CommitRailAcceptanceResult =
  | {
      status: 'COMMITTED';
      shipmentId: string;
      player: PlayerFleetSlice;
      multimodalShipments: PersistedMultimodalShipment[];
      moneyUnchanged: true;
    }
  | {
      status: 'OFFER_ALREADY_ACCEPTED' | 'COMMIT_FAILED' | 'MAX_ACTIVE_SHIPMENTS_REACHED';
      shipmentId?: string;
      player: PlayerFleetSlice;
      multimodalShipments: PersistedMultimodalShipment[];
    };

function patchById<T extends { id: string }>(list: T[], id: string, fn: (row: T) => T): T[] {
  return list.map((row) => (row.id === id ? fn(row) : row));
}

export function commitRailMultimodalAcceptance(input: CommitRailAcceptanceInput): CommitRailAcceptanceResult {
  const originalPlayer = input.player;
  const originalShipments = input.multimodalShipments;
  try {
    if (input.simulateFailure) {
      throw new Error('simulated-commit-failure');
    }
    const existing = findExistingForOffer(input.multimodalShipments, input.prepared.sourceOfferId);
    if (existing) {
      return {
        status: 'OFFER_ALREADY_ACCEPTED',
        shipmentId: existing.shipmentId,
        player: originalPlayer,
        multimodalShipments: originalShipments,
      };
    }
    if (countActiveInternal(input.multimodalShipments) >= MAX_ACTIVE_MULTIMODAL_SHIPMENTS_INTERNAL) {
      return {
        status: 'MAX_ACTIVE_SHIPMENTS_REACHED',
        player: originalPlayer,
        multimodalShipments: originalShipments,
      };
    }

    const assignment = input.prepared.shipment.assignmentSnapshot;
    if (!assignment) {
      return {
        status: 'COMMIT_FAILED',
        player: originalPlayer,
        multimodalShipments: originalShipments,
      };
    }
    const shipmentId = input.prepared.shipmentId;

    let trucks = input.player.trucks;
    let drivers = input.player.drivers;
    let trailers = input.player.trailers;

    const firstTruckId = assignment.firstMileTruckId;
    const lastTruckId = assignment.lastMileTruckId;
    const firstDriverId = assignment.firstMileDriverId;
    const lastDriverId = assignment.lastMileDriverId;
    if (!firstTruckId || !lastTruckId || !firstDriverId || !lastDriverId) {
      return {
        status: 'COMMIT_FAILED',
        player: originalPlayer,
        multimodalShipments: originalShipments,
      };
    }

    trucks = patchById(trucks, firstTruckId, (truck) => ({
      ...truck,
      status: 'on_route' as const,
      assignedMultimodalShipmentId: shipmentId,
    }));
    trucks = patchById(trucks, lastTruckId, (truck) => ({
      ...truck,
      status: 'idle' as const,
      assignedMultimodalShipmentId: shipmentId,
    }));
    drivers = patchById(drivers, firstDriverId, (driver) => ({
      ...driver,
      status: 'driving' as const,
      assignedTruckId: firstTruckId,
      assignedMultimodalShipmentId: shipmentId,
    }));
    drivers = patchById(drivers, lastDriverId, (driver) => ({
      ...driver,
      status: 'idle' as const,
      assignedTruckId: lastTruckId,
      assignedMultimodalShipmentId: shipmentId,
    }));
    if (assignment.firstMileTrailerId) {
      trailers = patchById(trailers, assignment.firstMileTrailerId, (trailer) => ({
        ...trailer,
        status: 'in_use' as const,
        assignedMultimodalShipmentId: shipmentId,
      }));
    }
    if (assignment.lastMileTrailerId) {
      trailers = patchById(trailers, assignment.lastMileTrailerId, (trailer) => ({
        ...trailer,
        assignedMultimodalShipmentId: shipmentId,
      }));
    }

    const nextShipments = [...input.multimodalShipments, input.prepared.shipment];
    return {
      status: 'COMMITTED',
      shipmentId,
      player: {
        ...input.player,
        trucks,
        drivers,
        trailers,
      },
      multimodalShipments: nextShipments,
      moneyUnchanged: true,
    };
  } catch {
    return {
      status: 'COMMIT_FAILED',
      player: originalPlayer,
      multimodalShipments: originalShipments,
    };
  }
}

export function releaseMultimodalReservations(input: {
  player: PlayerFleetSlice;
  shipmentId: string;
}): PlayerFleetSlice {
  const shipment = input.shipmentId;
  return {
    ...input.player,
    trucks: input.player.trucks.map((truck) => {
      if (truck.assignedMultimodalShipmentId !== shipment) return truck;
      return {
        ...truck,
        status: 'idle' as const,
        assignedMultimodalShipmentId: undefined,
      };
    }),
    drivers: input.player.drivers.map((driver) => {
      if (driver.assignedMultimodalShipmentId !== shipment) return driver;
      return {
        ...driver,
        status: 'idle' as const,
        assignedMultimodalShipmentId: undefined,
      };
    }),
    trailers: input.player.trailers.map((trailer) => {
      if (trailer.assignedMultimodalShipmentId !== shipment) return trailer;
      return {
        ...trailer,
        status: trailer.status === 'in_use' ? ('attached' as const) : trailer.status,
        assignedMultimodalShipmentId: undefined,
      };
    }),
  };
}