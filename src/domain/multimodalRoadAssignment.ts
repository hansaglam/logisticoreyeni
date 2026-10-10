/**
 * Planned (non-mutating) ROAD first/last-mile assignment for future multimodal shipments.
 * Map V2 Step 25. Does not reserve, dispatch, or write save.
 */

import { buildDriverAssignmentContext } from './driverOperationalState';
import {
  evaluateDriverOption,
  evaluateTruckOption,
} from '../utils/assignmentOptions';
import { getAttachedTrailerForTruck } from '../simulation/trailerAttachment';
import { resolveTruckCityId } from '../simulation/delivery';
import { canTruckCarryCargo } from '../simulation/capacity';
import type { Driver, Trailer, Truck, TruckTransfer, Delivery } from '../types/game';
import {
  findRoadTransferAccess,
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
  type MultimodalRoadTransferAccessArtifactV1,
  type MultimodalRoadTransferAccessRecord,
  type MultimodalRoadTransferMode,
} from './multimodalRoadAccess';

export const MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION = 'multimodal-road-assignment-v1' as const;

/**
 * Future live acceptance MUST revalidate this plan (TOCTOU):
 * trucks/drivers/trailers may change between planning and accept.
 * Reservation is not implemented here.
 */
export const MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU =
  'PLANNING_ONLY_REVALIDATE_AT_ACCEPTANCE' as const;

export type MultimodalRoadLegRole = 'FIRST_MILE' | 'LAST_MILE';

export type MultimodalRoadAssignmentStatus =
  | 'READY'
  | 'INVALID_PLAN'
  | 'INVALID_CITY'
  | 'INVALID_REQUESTED_TRUCK'
  | 'NO_ELIGIBLE_ORIGIN_TRUCK'
  | 'NO_ELIGIBLE_DESTINATION_TRUCK'
  | 'NO_ELIGIBLE_DRIVER'
  | 'NO_ELIGIBLE_TRAILER'
  | 'CARGO_INCOMPATIBLE'
  | 'ROAD_ACCESS_UNRESOLVED'
  | 'TRANSFER_INFRASTRUCTURE_UNRESOLVED'
  | 'UNSUPPORTED_MODE'
  | 'UNSUPPORTED_ROUTE'
  | 'UNSUPPORTED_SCHEMA'
  | 'NOT_EXECUTABLE'
  | 'SAME_TRUCK_TELEPORT';

export type MultimodalRoadFleetSnapshot = {
  trucks: readonly Truck[];
  drivers: readonly Driver[];
  trailers: readonly Trailer[];
  activeDeliveries?: readonly Delivery[];
  activeTransfers?: readonly TruckTransfer[];
  currentTime?: number;
};

export type MultimodalRoadLegAssignment = {
  status: MultimodalRoadAssignmentStatus;
  role: MultimodalRoadLegRole;
  policyVersion: typeof MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION;
  plannedOnly: true;
  legacyCityId: string;
  geoCityId: string | null;
  truckId: string | null;
  driverId: string | null;
  trailerId: string | null;
  transferMode: MultimodalRoadTransferMode | null;
  infrastructureId: string | null;
  transferNodeId: string | null;
  associationType: MultimodalRoadTransferAccessRecord['associationType'] | null;
  cityRoadAnchorNodeId: string | null;
  infrastructureRoadNodeId: string | null;
  distanceMeters: number | null;
  distanceAuthority: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS | null;
  routeReference: string | null;
  sourceHash: `sha256:${string}` | null;
  algorithmId: string | null;
  evidenceStatus: string | null;
  snapDistanceMeters: number | null;
  reason?: string;
};

export type MultimodalRoadAssignmentPlan = {
  status: MultimodalRoadAssignmentStatus;
  policyVersion: typeof MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION;
  plannedOnly: true;
  toctou: typeof MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU;
  originCityId: string;
  destinationCityId: string;
  transferMode: MultimodalRoadTransferMode | string;
  firstMile: MultimodalRoadLegAssignment;
  lastMile: MultimodalRoadLegAssignment;
  reasons: string[];
};

export type PlanMultimodalRoadAssignmentInput = {
  originCityId: string;
  destinationCityId: string;
  transferMode: MultimodalRoadTransferMode | string;
  originInfrastructureId?: string | null;
  destinationInfrastructureId?: string | null;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  fleet: MultimodalRoadFleetSnapshot;
  cargoWeightTons: number;
  requestedFirstMileTruckId?: string | null;
  requestedLastMileTruckId?: string | null;
  requestedFirstMileDriverId?: string | null;
  requestedLastMileDriverId?: string | null;
};

function emptyLeg(
  role: MultimodalRoadLegRole,
  cityId: string,
  status: MultimodalRoadAssignmentStatus,
  reason: string,
  extra?: Partial<MultimodalRoadLegAssignment>,
): MultimodalRoadLegAssignment {
  return {
    status,
    role,
    policyVersion: MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION,
    plannedOnly: true,
    legacyCityId: cityId,
    geoCityId: extra?.geoCityId ?? null,
    truckId: extra?.truckId ?? null,
    driverId: extra?.driverId ?? null,
    trailerId: extra?.trailerId ?? null,
    transferMode: extra?.transferMode ?? null,
    infrastructureId: extra?.infrastructureId ?? null,
    transferNodeId: extra?.transferNodeId ?? null,
    associationType: extra?.associationType ?? null,
    cityRoadAnchorNodeId: extra?.cityRoadAnchorNodeId ?? null,
    infrastructureRoadNodeId: extra?.infrastructureRoadNodeId ?? null,
    distanceMeters: extra?.distanceMeters ?? null,
    distanceAuthority: extra?.distanceAuthority ?? null,
    routeReference: extra?.routeReference ?? null,
    sourceHash: extra?.sourceHash ?? null,
    algorithmId: extra?.algorithmId ?? null,
    evidenceStatus: extra?.evidenceStatus ?? null,
    snapDistanceMeters: extra?.snapDistanceMeters ?? null,
    reason,
  };
}

function accessFields(access: MultimodalRoadTransferAccessRecord): Partial<MultimodalRoadLegAssignment> {
  return {
    geoCityId: access.geoCityId,
    transferMode: access.transferMode,
    infrastructureId: access.infrastructureId,
    transferNodeId: access.transferNodeId,
    associationType: access.associationType,
    cityRoadAnchorNodeId: access.cityRoadAnchorNodeId,
    infrastructureRoadNodeId: access.infrastructureRoadNodeId,
    distanceMeters: access.distanceMeters,
    distanceAuthority: SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
    routeReference: access.routeReference,
    sourceHash: access.sourceRoadPackageHash,
    algorithmId: access.algorithmId,
    evidenceStatus: access.evidenceStatus,
    snapDistanceMeters: access.snapDistanceMeters,
  };
}

function isTransferMode(value: string): value is MultimodalRoadTransferMode {
  return value === 'RAIL' || value === 'SEA' || value === 'AIR';
}

function compareTruckId(a: Truck, b: Truck): number {
  return a.id.localeCompare(b.id);
}

function compareDriverId(a: Driver, b: Driver): number {
  return a.id.localeCompare(b.id);
}

function estimatedHoursForAccess(truck: Truck, distanceMeters: number): number {
  const speed = Math.max(1, truck.speed ?? 60);
  return distanceMeters / 1000 / speed;
}

function noEligibleTruckStatus(role: MultimodalRoadLegRole): MultimodalRoadAssignmentStatus {
  return role === 'FIRST_MILE' ? 'NO_ELIGIBLE_ORIGIN_TRUCK' : 'NO_ELIGIBLE_DESTINATION_TRUCK';
}

function pickSelectableTruck(
  role: MultimodalRoadLegRole,
  trucks: readonly Truck[],
  cityId: string,
  cargoWeightTons: number,
  trailers: readonly Trailer[],
  fleet: MultimodalRoadFleetSnapshot,
  distanceMeters: number,
  requestedTruckId: string | null | undefined,
  excludedTruckIds: ReadonlySet<string>,
): { truck: Truck | null; trailerId: string | null; status: MultimodalRoadAssignmentStatus; reason?: string } {
  if (requestedTruckId && excludedTruckIds.has(requestedTruckId)) {
    return {
      truck: null,
      trailerId: null,
      status: 'SAME_TRUCK_TELEPORT',
      reason: 'REQUESTED_TRUCK_ALREADY_PLANNED_FOR_OTHER_LEG',
    };
  }
  const available = trucks.filter((truck) => !excludedTruckIds.has(truck.id));
  const options = available.map((truck) =>
    evaluateTruckOption(
      truck,
      cargoWeightTons,
      cityId,
      [...trailers],
      fleet.currentTime,
      fleet.activeDeliveries ? [...fleet.activeDeliveries] : undefined,
      estimatedHoursForAccess(truck, distanceMeters),
    ),
  );
  const selectable = options.filter((row) => row.selectable).sort((a, b) => compareTruckId(a.truck, b.truck));

  if (requestedTruckId) {
    const requested = options.find((row) => row.truck.id === requestedTruckId);
    if (!requested || !requested.selectable) {
      return {
        truck: null,
        trailerId: null,
        status: 'INVALID_REQUESTED_TRUCK',
        reason: requested ? requested.issue : 'REQUESTED_TRUCK_NOT_FOUND',
      };
    }
    const trailer = getAttachedTrailerForTruck(requested.truck.id, [...trailers]);
    if (!canTruckCarryCargo(requested.truck, cargoWeightTons, [...trailers])) {
      return { truck: null, trailerId: null, status: 'CARGO_INCOMPATIBLE', reason: 'CARGO_INCOMPATIBLE' };
    }
    return { truck: requested.truck, trailerId: trailer?.id ?? null, status: 'READY' };
  }

  if (selectable.length === 0) {
    const capacityFail = options.some(
      (row) => resolveTruckCityId(row.truck) === cityId && row.issue === 'capacity',
    );
    const status = capacityFail ? 'CARGO_INCOMPATIBLE' : noEligibleTruckStatus(role);
    return { truck: null, trailerId: null, status, reason: status };
  }

  const truck = selectable[0].truck;
  const trailer = getAttachedTrailerForTruck(truck.id, [...trailers]);
  return { truck, trailerId: trailer?.id ?? null, status: 'READY' };
}

function pickSelectableDriver(
  drivers: readonly Driver[],
  fleet: MultimodalRoadFleetSnapshot,
  requestedDriverId: string | null | undefined,
  excludedDriverIds: ReadonlySet<string>,
  preferredTruckId?: string | null,
): { driver: Driver | null; status: MultimodalRoadAssignmentStatus; reason?: string } {
  const context = buildDriverAssignmentContext({
    trucks: [...fleet.trucks],
    activeDeliveries: fleet.activeDeliveries ? [...fleet.activeDeliveries] : [],
    activeTransfers: fleet.activeTransfers ? [...fleet.activeTransfers] : [],
  });
  const candidates = drivers.filter((driver) => !excludedDriverIds.has(driver.id));
  const withContext = candidates.map((driver) => evaluateDriverOption(driver, context));
  const selectable = withContext.filter((row) => row.selectable);
  if (requestedDriverId) {
    const requested = withContext.find((row) => row.driver.id === requestedDriverId);
    if (!requested?.selectable) {
      return { driver: null, status: 'NO_ELIGIBLE_DRIVER', reason: 'REQUESTED_DRIVER_UNAVAILABLE' };
    }
    return { driver: requested.driver, status: 'READY' };
  }
  const attached = selectable
    .filter((row) => preferredTruckId && row.driver.assignedTruckId === preferredTruckId)
    .sort((a, b) => compareDriverId(a.driver, b.driver));
  const rest = selectable
    .filter((row) => !preferredTruckId || row.driver.assignedTruckId !== preferredTruckId)
    .sort((a, b) => compareDriverId(a.driver, b.driver));
  const chosen = attached[0] ?? rest[0];
  if (!chosen) {
    return { driver: null, status: 'NO_ELIGIBLE_DRIVER', reason: 'NO_ELIGIBLE_DRIVER' };
  }
  return { driver: chosen.driver, status: 'READY' };
}

function planOneLeg(input: {
  role: MultimodalRoadLegRole;
  cityId: string;
  transferMode: MultimodalRoadTransferMode;
  infrastructureId?: string | null;
  accessArtifact: MultimodalRoadTransferAccessArtifactV1;
  fleet: MultimodalRoadFleetSnapshot;
  cargoWeightTons: number;
  requestedTruckId?: string | null;
  requestedDriverId?: string | null;
  excludedTruckIds: ReadonlySet<string>;
  excludedDriverIds: ReadonlySet<string>;
}): MultimodalRoadLegAssignment {
  if (!input.cityId) {
    return emptyLeg(input.role, '', 'INVALID_CITY', 'INVALID_CITY');
  }
  const access = findRoadTransferAccess(
    input.accessArtifact,
    input.cityId,
    input.transferMode,
    input.infrastructureId,
  );
  if (!access) {
    return emptyLeg(input.role, input.cityId, 'ROAD_ACCESS_UNRESOLVED', 'ROAD_ACCESS_UNRESOLVED', {
      transferMode: input.transferMode,
      infrastructureId: input.infrastructureId ?? null,
    });
  }
  if (
    !Number.isFinite(access.distanceMeters) ||
    access.distanceMeters <= 0 ||
    access.roadEdgeCount < 0 ||
    (access.distanceMeters > 0 && access.cityRoadAnchorNodeId !== access.infrastructureRoadNodeId && access.roadEdgeCount < 1)
  ) {
    return emptyLeg(input.role, input.cityId, 'ROAD_ACCESS_UNRESOLVED', 'INVALID_ACCESS_DISTANCE', accessFields(access));
  }

  const truckPick = pickSelectableTruck(
    input.role,
    input.fleet.trucks,
    input.cityId,
    input.cargoWeightTons,
    input.fleet.trailers,
    input.fleet,
    access.distanceMeters,
    input.requestedTruckId,
    input.excludedTruckIds,
  );
  if (truckPick.status !== 'READY' || !truckPick.truck) {
    return emptyLeg(
      input.role,
      input.cityId,
      truckPick.status,
      truckPick.reason ?? truckPick.status,
      accessFields(access),
    );
  }

  const driverPick = pickSelectableDriver(
    input.fleet.drivers,
    input.fleet,
    input.requestedDriverId,
    input.excludedDriverIds,
    truckPick.truck.id,
  );
  if (driverPick.status !== 'READY' || !driverPick.driver) {
    return emptyLeg(input.role, input.cityId, 'NO_ELIGIBLE_DRIVER', driverPick.reason ?? 'NO_ELIGIBLE_DRIVER', {
      ...accessFields(access),
      truckId: truckPick.truck.id,
      trailerId: truckPick.trailerId,
    });
  }

  return {
    status: 'READY',
    role: input.role,
    policyVersion: MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION,
    plannedOnly: true,
    legacyCityId: input.cityId,
    ...accessFields(access),
    geoCityId: access.geoCityId,
    truckId: truckPick.truck.id,
    driverId: driverPick.driver.id,
    trailerId: truckPick.trailerId,
    transferMode: access.transferMode,
    reason: undefined,
  } as MultimodalRoadLegAssignment;
}

export function planMultimodalRoadAssignment(
  input: PlanMultimodalRoadAssignmentInput,
): MultimodalRoadAssignmentPlan {
  const reasons: string[] = [];
  const failed = (
    status: MultimodalRoadAssignmentStatus,
    first: MultimodalRoadLegAssignment,
    last: MultimodalRoadLegAssignment,
    extra?: string,
  ): MultimodalRoadAssignmentPlan => ({
    status,
    policyVersion: MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION,
    plannedOnly: true,
    toctou: MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
    originCityId: input.originCityId,
    destinationCityId: input.destinationCityId,
    transferMode: input.transferMode,
    firstMile: first,
    lastMile: last,
    reasons: [...reasons, extra ?? status].filter(Boolean),
  });

  if (!isTransferMode(String(input.transferMode))) {
    const first = emptyLeg('FIRST_MILE', input.originCityId, 'UNSUPPORTED_MODE', 'UNSUPPORTED_MODE');
    const last = emptyLeg('LAST_MILE', input.destinationCityId, 'UNSUPPORTED_MODE', 'UNSUPPORTED_MODE');
    return failed('UNSUPPORTED_MODE', first, last);
  }
  const mode = input.transferMode as MultimodalRoadTransferMode;
  if (!input.originCityId || !input.destinationCityId) {
    return failed(
      'INVALID_CITY',
      emptyLeg('FIRST_MILE', input.originCityId ?? '', 'INVALID_CITY', 'INVALID_CITY'),
      emptyLeg('LAST_MILE', input.destinationCityId ?? '', 'INVALID_CITY', 'INVALID_CITY'),
    );
  }
  if (input.originCityId === input.destinationCityId) {
    return failed(
      'UNSUPPORTED_ROUTE',
      emptyLeg('FIRST_MILE', input.originCityId, 'UNSUPPORTED_ROUTE', 'SAME_CITY_UNSUPPORTED'),
      emptyLeg('LAST_MILE', input.destinationCityId, 'UNSUPPORTED_ROUTE', 'SAME_CITY_UNSUPPORTED'),
    );
  }
  if (input.accessArtifact?.schemaVersion !== 1 || input.accessArtifact.packageId !== 'map-v2.country.tur.multimodal-road-transfer-access.v1') {
    return failed(
      'UNSUPPORTED_SCHEMA',
      emptyLeg('FIRST_MILE', input.originCityId, 'UNSUPPORTED_SCHEMA', 'UNSUPPORTED_SCHEMA'),
      emptyLeg('LAST_MILE', input.destinationCityId, 'UNSUPPORTED_SCHEMA', 'UNSUPPORTED_SCHEMA'),
    );
  }

  const firstMile = planOneLeg({
    role: 'FIRST_MILE',
    cityId: input.originCityId,
    transferMode: mode,
    infrastructureId: input.originInfrastructureId,
    accessArtifact: input.accessArtifact,
    fleet: input.fleet,
    cargoWeightTons: input.cargoWeightTons,
    requestedTruckId: input.requestedFirstMileTruckId,
    requestedDriverId: input.requestedFirstMileDriverId,
    excludedTruckIds: new Set(),
    excludedDriverIds: new Set(),
  });
  if (firstMile.status !== 'READY') {
    return failed(
      firstMile.status,
      firstMile,
      emptyLeg('LAST_MILE', input.destinationCityId, firstMile.status, 'ORIGIN_PLAN_FAILED'),
    );
  }

  const excludedTrucks = new Set<string>([firstMile.truckId!]);
  const excludedDrivers = new Set<string>();
  if (firstMile.driverId) excludedDrivers.add(firstMile.driverId);
  for (const driver of input.fleet.drivers) {
    if (driver.assignedTruckId && excludedTrucks.has(driver.assignedTruckId)) {
      excludedDrivers.add(driver.id);
    }
  }

  const lastMile = planOneLeg({
    role: 'LAST_MILE',
    cityId: input.destinationCityId,
    transferMode: mode,
    infrastructureId: input.destinationInfrastructureId,
    accessArtifact: input.accessArtifact,
    fleet: input.fleet,
    cargoWeightTons: input.cargoWeightTons,
    requestedTruckId: input.requestedLastMileTruckId,
    requestedDriverId: input.requestedLastMileDriverId,
    excludedTruckIds: excludedTrucks,
    excludedDriverIds: excludedDrivers,
  });

  if (
    firstMile.truckId &&
    lastMile.truckId &&
    firstMile.truckId === lastMile.truckId &&
    input.originCityId !== input.destinationCityId
  ) {
    const blocked = emptyLeg('LAST_MILE', input.destinationCityId, 'SAME_TRUCK_TELEPORT', 'SAME_TRUCK_TELEPORT', {
      ...lastMile,
      truckId: lastMile.truckId,
    });
    return failed('SAME_TRUCK_TELEPORT', firstMile, blocked);
  }

  if (lastMile.status !== 'READY') {
    const status =
      lastMile.status === 'NO_ELIGIBLE_ORIGIN_TRUCK' ? 'NO_ELIGIBLE_DESTINATION_TRUCK' : lastMile.status;
    return failed(status, firstMile, { ...lastMile, status });
  }

  return {
    status: 'READY',
    policyVersion: MULTIMODAL_ROAD_ASSIGNMENT_POLICY_VERSION,
    plannedOnly: true,
    toctou: MULTIMODAL_ROAD_ASSIGNMENT_TOCTOU,
    originCityId: input.originCityId,
    destinationCityId: input.destinationCityId,
    transferMode: mode,
    firstMile,
    lastMile,
    reasons: [],
  };
}
