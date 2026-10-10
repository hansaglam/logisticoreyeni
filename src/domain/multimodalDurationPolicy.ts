/**
 * Production multimodal duration policy (Map V2 Step 24).
 *
 * Pure / deterministic. Planned game time only — not DEV wall-clock playback.
 * Does not pay, settle, generate contracts, or import Map V2 prototypes.
 */

import { calculateContractDurationHours } from '../simulation/contractEconomics';
import {
  isExecutablePersistedMultimodalShipment,
  isUnreadablePersistedMultimodalShipment,
  type PersistedMultimodalShipment,
} from './multimodalShipmentPersistence';

export const MULTIMODAL_DURATION_POLICY_VERSION = 'multimodal-duration-policy-v1' as const;

/** Canonical planned-time unit. 3600 game seconds = 1 game hour. */
export const MULTIMODAL_GAME_SECONDS_PER_HOUR = 3600;

const MAX_PLANNED_GAME_SECONDS = 30 * 24 * MULTIMODAL_GAME_SECONDS_PER_HOUR;

export type DurationTransportMode = 'ROAD' | 'RAIL' | 'SEA' | 'AIR';

/**
 * GAMEPLAY_BALANCE_CONSTANT — not real-world timetable speeds.
 * Relative: AIR fastest, RAIL faster than typical ROAD planning average, SEA slowest.
 */
export const MULTIMODAL_LINE_HAUL_SPEED_KMH = {
  RAIL: 110,
  SEA: 22,
  AIR: 480,
} as const;

/** GAMEPLAY_BALANCE_CONSTANT — terminal dwell, not real operations. */
export const MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS = {
  ROAD_RAIL: 45 * 60,
  ROAD_SEA: 90 * 60,
  ROAD_AIR: 60 * 60,
} as const;

export const MULTIMODAL_TRANSFER_POLICY_IDS = {
  ROAD_RAIL: 'transfer-road-rail-v1',
  ROAD_SEA: 'transfer-road-sea-v1',
  ROAD_AIR: 'transfer-road-air-v1',
} as const;

export type MultimodalDistanceAuthority =
  | 'PRODUCTION_ROAD_ROUTE'
  | 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS'
  | 'SOURCE_BACKED_RAIL_LENGTH'
  | 'SOURCE_BACKED_SEA_LENGTH'
  | 'SOURCE_BACKED_AIR_GEODESIC'
  | 'PROVIDED_PLANNING_METERS';

export type MultimodalDurationStatus =
  | 'READY'
  | 'INVALID_PLAN'
  | 'INVALID_DISTANCE'
  | 'MISSING_ROUTE_DISTANCE'
  | 'MISSING_ROUTE_REFERENCE'
  | 'UNSUPPORTED_MODE'
  | 'UNSUPPORTED_TRANSFER'
  | 'UNRESOLVED_INFRASTRUCTURE'
  | 'UNSUPPORTED_SCHEMA'
  | 'NOT_EXECUTABLE';

export type MultimodalRoadPlanningInput = {
  cargoTons?: number;
  routeDifficulty?: number;
  truckSpeedKmh?: number;
  truckCapacityTons?: number;
  truckCondition?: number;
  truckVehicleClass?: 'light-truck' | 'medium-truck' | 'heavy-truck' | 'tractor' | 'special-heavy';
  truckCatalogId?: string;
  driverSpeed?: number;
  driverTier?: 'rookie' | 'standard' | 'experienced' | 'expert' | 'international';
};

export type MultimodalLegDurationInput = {
  legId: string;
  mode: DurationTransportMode;
  distanceMeters: unknown;
  distanceAuthority: MultimodalDistanceAuthority | string;
  routeReference?: string | null;
  roadPlanning?: MultimodalRoadPlanningInput;
};

export type MultimodalTransferDurationInput = {
  transferId: string;
  fromMode: DurationTransportMode | string;
  toMode: DurationTransportMode | string;
};

export type MultimodalLegDurationEstimate = {
  legId: string;
  mode: DurationTransportMode | string;
  distanceMeters: number | null;
  durationGameSeconds: number | null;
  policyId: string;
  distanceAuthority: string;
  status: MultimodalDurationStatus;
  reason?: string;
};

export type MultimodalTransferDurationEstimate = {
  transferId: string;
  fromMode: string;
  toMode: string;
  durationGameSeconds: number | null;
  policyId: string;
  status: MultimodalDurationStatus;
  reason?: string;
};

export type MultimodalShipmentDurationEstimate = {
  planId?: string;
  policyVersion: typeof MULTIMODAL_DURATION_POLICY_VERSION;
  status: MultimodalDurationStatus;
  legDurations: MultimodalLegDurationEstimate[];
  transferDurations: MultimodalTransferDurationEstimate[];
  movementDurationGameSeconds: number | null;
  transferDurationGameSeconds: number | null;
  totalDurationGameSeconds: number | null;
  reason?: string;
};

export function estimateTransportLegDuration(
  input: MultimodalLegDurationInput,
): MultimodalLegDurationEstimate {
  const base: MultimodalLegDurationEstimate = {
    legId: input.legId,
    mode: input.mode,
    distanceMeters: null,
    durationGameSeconds: null,
    policyId: MULTIMODAL_DURATION_POLICY_VERSION,
    distanceAuthority: String(input.distanceAuthority),
    status: 'READY',
  };

  if (input.mode !== 'ROAD' && input.mode !== 'RAIL' && input.mode !== 'SEA' && input.mode !== 'AIR') {
    return { ...base, status: 'UNSUPPORTED_MODE', reason: 'UNSUPPORTED_MODE' };
  }

  const distance = readDistanceMeters(input.distanceMeters);
  if (distance == null) {
    const status =
      input.distanceMeters == null || input.distanceMeters === ''
        ? 'MISSING_ROUTE_DISTANCE'
        : 'INVALID_DISTANCE';
    return { ...base, status, reason: status };
  }
  if (distance === 0) {
    return { ...base, distanceMeters: 0, status: 'INVALID_DISTANCE', reason: 'ZERO_DISTANCE' };
  }

  if (input.mode === 'ROAD') {
    if (
      input.distanceAuthority !== 'PRODUCTION_ROAD_ROUTE' &&
      input.distanceAuthority !== 'PROVIDED_PLANNING_METERS' &&
      input.distanceAuthority !== 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS'
    ) {
      return {
        ...base,
        distanceMeters: distance,
        status: 'INVALID_DISTANCE',
        reason: 'ROAD_REQUIRES_PRODUCTION_PROVIDED_OR_TRANSFER_ACCESS_DISTANCE',
      };
    }
    const hours = calculateContractDurationHours({
      distanceKm: distance / 1000,
      cargoTons: input.roadPlanning?.cargoTons ?? 0,
      routeDifficulty: input.roadPlanning?.routeDifficulty ?? 0,
      truckSpeedKmh: input.roadPlanning?.truckSpeedKmh,
      truckCapacityTons: input.roadPlanning?.truckCapacityTons,
      truckCondition: input.roadPlanning?.truckCondition,
      truckVehicleClass: input.roadPlanning?.truckVehicleClass,
      truckCatalogId: input.roadPlanning?.truckCatalogId,
      driverSpeed: input.roadPlanning?.driverSpeed,
      driverTier: input.roadPlanning?.driverTier,
    }).travelHours;
    const seconds = gameHoursToGameSeconds(hours, distance > 0);
    if (seconds == null) {
      return { ...base, distanceMeters: distance, status: 'INVALID_DISTANCE', reason: 'ROAD_DURATION_UNSAFE' };
    }
    return {
      ...base,
      distanceMeters: distance,
      durationGameSeconds: seconds,
      policyId: 'road-movement-contract-duration-travelHours-v1',
      status: 'READY',
    };
  }

  const requiredAuthority =
    input.mode === 'RAIL'
      ? 'SOURCE_BACKED_RAIL_LENGTH'
      : input.mode === 'SEA'
        ? 'SOURCE_BACKED_SEA_LENGTH'
        : 'SOURCE_BACKED_AIR_GEODESIC';
  if (input.distanceAuthority !== requiredAuthority) {
    return {
      ...base,
      distanceMeters: distance,
      status: 'INVALID_DISTANCE',
      reason: 'DISTANCE_AUTHORITY_MISMATCH',
    };
  }
  if (typeof input.routeReference !== 'string' || input.routeReference.trim().length === 0) {
    return {
      ...base,
      distanceMeters: distance,
      status: 'MISSING_ROUTE_REFERENCE',
      reason: 'MISSING_ROUTE_REFERENCE',
    };
  }
  if (input.routeReference.includes('corridors.json')) {
    return {
      ...base,
      distanceMeters: distance,
      status: 'INVALID_DISTANCE',
      reason: 'VISUAL_CORRIDOR_NOT_DURATION_TRUTH',
    };
  }

  const speedKmh = MULTIMODAL_LINE_HAUL_SPEED_KMH[input.mode];
  const seconds = lineHaulGameSeconds(distance, speedKmh);
  if (seconds == null) {
    return { ...base, distanceMeters: distance, status: 'INVALID_DISTANCE', reason: 'LINE_HAUL_DURATION_UNSAFE' };
  }
  return {
    ...base,
    distanceMeters: distance,
    durationGameSeconds: seconds,
    policyId: `${input.mode.toLowerCase()}-line-haul-v1`,
    status: 'READY',
  };
}

export function estimateTransferDuration(
  input: MultimodalTransferDurationInput,
): MultimodalTransferDurationEstimate {
  const pair = resolveSupportedTransferPair(input.fromMode, input.toMode);
  if (!pair) {
    return {
      transferId: input.transferId,
      fromMode: String(input.fromMode),
      toMode: String(input.toMode),
      durationGameSeconds: null,
      policyId: 'unsupported',
      status: 'UNSUPPORTED_TRANSFER',
      reason: 'UNSUPPORTED_TRANSFER',
    };
  }
  return {
    transferId: input.transferId,
    fromMode: pair.fromMode,
    toMode: pair.toMode,
    durationGameSeconds: MULTIMODAL_TRANSFER_DURATION_GAME_SECONDS[pair.key],
    policyId: MULTIMODAL_TRANSFER_POLICY_IDS[pair.key],
    status: 'READY',
  };
}

export function estimateMultimodalShipmentDuration(input: {
  planId?: string;
  shipmentSchemaVersion?: number;
  unreadable?: boolean;
  legs: readonly MultimodalLegDurationInput[];
  transfers: readonly MultimodalTransferDurationInput[];
}): MultimodalShipmentDurationEstimate {
  if (input.unreadable === true) {
    return emptyEstimate(input.planId, 'NOT_EXECUTABLE', 'UNREADABLE_SHIPMENT');
  }
  if (
    input.shipmentSchemaVersion != null &&
    input.shipmentSchemaVersion !== 1
  ) {
    return emptyEstimate(input.planId, 'UNSUPPORTED_SCHEMA', 'UNSUPPORTED_SCHEMA');
  }
  if (!Array.isArray(input.legs) || input.legs.length === 0) {
    return emptyEstimate(input.planId, 'INVALID_PLAN', 'INVALID_PLAN');
  }

  const legDurations = input.legs.map(estimateTransportLegDuration);
  const transferDurations = input.transfers.map(estimateTransferDuration);
  const failed =
    legDurations.find((row) => row.status !== 'READY') ??
    transferDurations.find((row) => row.status !== 'READY');
  if (failed) {
    return {
      planId: input.planId,
      policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
      status: failed.status,
      legDurations,
      transferDurations,
      movementDurationGameSeconds: null,
      transferDurationGameSeconds: null,
      totalDurationGameSeconds: null,
      reason: failed.reason ?? failed.status,
    };
  }

  const movement = sumSeconds(legDurations.map((row) => row.durationGameSeconds));
  const transfer = sumSeconds(transferDurations.map((row) => row.durationGameSeconds));
  if (movement == null || transfer == null) {
    return {
      planId: input.planId,
      policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
      status: 'INVALID_DISTANCE',
      legDurations,
      transferDurations,
      movementDurationGameSeconds: null,
      transferDurationGameSeconds: null,
      totalDurationGameSeconds: null,
      reason: 'DURATION_SUM_UNSAFE',
    };
  }
  const total = movement + transfer;
  if (total > MAX_PLANNED_GAME_SECONDS) {
    return {
      planId: input.planId,
      policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
      status: 'INVALID_DISTANCE',
      legDurations,
      transferDurations,
      movementDurationGameSeconds: null,
      transferDurationGameSeconds: null,
      totalDurationGameSeconds: null,
      reason: 'DURATION_EXCEEDS_SAFE_BOUND',
    };
  }

  return {
    planId: input.planId,
    policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
    status: 'READY',
    legDurations,
    transferDurations,
    movementDurationGameSeconds: movement,
    transferDurationGameSeconds: transfer,
    totalDurationGameSeconds: total,
  };
}

export function estimateDurationForPersistedShipment(
  shipment: unknown,
): MultimodalShipmentDurationEstimate {
  if (!shipment || typeof shipment !== 'object') {
    return emptyEstimate(undefined, 'INVALID_PLAN', 'INVALID_PLAN');
  }
  const record = shipment as PersistedMultimodalShipment;
  if (isUnreadablePersistedMultimodalShipment(record)) {
    return emptyEstimate(record.shipmentId, 'NOT_EXECUTABLE', 'UNREADABLE_SHIPMENT');
  }
  if (!isExecutablePersistedMultimodalShipment(record)) {
    const shipmentId = (record as { shipmentId?: unknown }).shipmentId;
    return emptyEstimate(
      typeof shipmentId === 'string' ? shipmentId : undefined,
      'UNSUPPORTED_SCHEMA',
      'UNSUPPORTED_SCHEMA',
    );
  }
  return estimateMultimodalShipmentDuration({
    planId: record.shipmentId,
    shipmentSchemaVersion: record.shipmentSchemaVersion,
    legs: record.legs.map((leg) => ({
      legId: leg.legId,
      mode: leg.mode,
      distanceMeters: leg.distanceMeters,
      distanceAuthority: authorityForPersistedMode(leg.mode),
      routeReference: leg.route.routeReference,
    })),
    transfers: record.transfers.map((transfer) => ({
      transferId: transfer.transferId,
      fromMode: transfer.fromMode,
      toMode: transfer.toMode,
    })),
  });
}

export function gameHoursToGameSeconds(hours: number, requirePositive = false): number | null {
  if (!Number.isFinite(hours) || hours < 0) {
    return null;
  }
  const seconds = Math.round(hours * MULTIMODAL_GAME_SECONDS_PER_HOUR);
  if (!Number.isSafeInteger(seconds) || seconds > MAX_PLANNED_GAME_SECONDS) {
    return null;
  }
  if (requirePositive && hours > 0 && seconds < 1) {
    return 1;
  }
  return seconds;
}

function lineHaulGameSeconds(distanceMeters: number, speedKmh: number): number | null {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    return null;
  }
  const hours = distanceMeters / 1000 / speedKmh;
  return gameHoursToGameSeconds(hours, true);
}

function readDistanceMeters(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function resolveSupportedTransferPair(
  fromMode: unknown,
  toMode: unknown,
): { fromMode: DurationTransportMode; toMode: DurationTransportMode; key: 'ROAD_RAIL' | 'ROAD_SEA' | 'ROAD_AIR' } | null {
  const from = fromMode === 'ROAD' || fromMode === 'RAIL' || fromMode === 'SEA' || fromMode === 'AIR' ? fromMode : null;
  const to = toMode === 'ROAD' || toMode === 'RAIL' || toMode === 'SEA' || toMode === 'AIR' ? toMode : null;
  if (!from || !to) {
    return null;
  }
  const key = `${from}|${to}`;
  if (key === 'ROAD|RAIL' || key === 'RAIL|ROAD') {
    return { fromMode: from, toMode: to, key: 'ROAD_RAIL' };
  }
  if (key === 'ROAD|SEA' || key === 'SEA|ROAD') {
    return { fromMode: from, toMode: to, key: 'ROAD_SEA' };
  }
  if (key === 'ROAD|AIR' || key === 'AIR|ROAD') {
    return { fromMode: from, toMode: to, key: 'ROAD_AIR' };
  }
  return null;
}

function authorityForPersistedMode(mode: DurationTransportMode): MultimodalDistanceAuthority {
  if (mode === 'RAIL') return 'SOURCE_BACKED_RAIL_LENGTH';
  if (mode === 'SEA') return 'SOURCE_BACKED_SEA_LENGTH';
  if (mode === 'AIR') return 'SOURCE_BACKED_AIR_GEODESIC';
  return 'PROVIDED_PLANNING_METERS';
}

function sumSeconds(values: Array<number | null>): number | null {
  let total = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value < 0) {
      return null;
    }
    total += value;
  }
  if (!Number.isSafeInteger(total) || total > MAX_PLANNED_GAME_SECONDS) {
    return null;
  }
  return total;
}

function emptyEstimate(
  planId: string | undefined,
  status: MultimodalDurationStatus,
  reason: string,
): MultimodalShipmentDurationEstimate {
  return {
    planId,
    policyVersion: MULTIMODAL_DURATION_POLICY_VERSION,
    status,
    legDurations: [],
    transferDurations: [],
    movementDurationGameSeconds: null,
    transferDurationGameSeconds: null,
    totalDurationGameSeconds: null,
    reason,
  };
}
