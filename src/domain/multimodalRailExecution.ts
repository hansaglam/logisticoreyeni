/**
 * Persisted INTERNAL_TEST RAIL execution (Map V2 Step 29).
 * Frozen Step 24 game seconds. Not DEV playback. No settlement.
 */

import { realMsToGameHours } from '../config/balance';
import type { Driver, Trailer, Truck } from '../types/game';
import type { PlayerFleetSlice } from './multimodalFleetReservation';
import {
  isExecutablePersistedMultimodalShipment,
  isUnreadablePersistedMultimodalShipment,
  type PersistedMultimodalShipment,
  type PersistedReadableMultimodalShipment,
} from './multimodalShipmentPersistence';

export const MULTIMODAL_EXECUTION_POLICY_VERSION = 'multimodal-execution-v1' as const;

export const MULTIMODAL_EXECUTION_STAGES = [
  'FIRST_MILE_ROAD',
  'ORIGIN_TRANSFER',
  'RAIL_LINEHAUL',
  'DESTINATION_TRANSFER',
  'LAST_MILE_ROAD',
  'COMPLETED_UNSETTLED',
] as const;

export type MultimodalExecutionStage = (typeof MULTIMODAL_EXECUTION_STAGES)[number];

export type MultimodalProgressStatus =
  | 'PROGRESSED'
  | 'NO_ELAPSED_TIME'
  | 'STAGE_ADVANCED'
  | 'COMPLETED_UNSETTLED'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_STATE'
  | 'INVALID_SNAPSHOT'
  | 'RESOURCE_RESERVATION_INVALID'
  | 'EXECUTION_STATE_INVALID';

export type MultimodalProgressResult = {
  status: MultimodalProgressStatus;
  shipments: PersistedMultimodalShipment[];
  player: PlayerFleetSlice;
  completedUnsettledIds: string[];
};

const STAGE_DURATION_KEY: Record<
  Exclude<MultimodalExecutionStage, 'COMPLETED_UNSETTLED'>,
  keyof NonNullable<PersistedReadableMultimodalShipment['durationSnapshot']>
> = {
  FIRST_MILE_ROAD: 'firstMileGameSeconds',
  ORIGIN_TRANSFER: 'originTransferGameSeconds',
  RAIL_LINEHAUL: 'railLinehaulGameSeconds',
  DESTINATION_TRANSFER: 'destinationTransferGameSeconds',
  LAST_MILE_ROAD: 'lastMileGameSeconds',
};

function stagePlannedSeconds(
  shipment: PersistedReadableMultimodalShipment,
  stage: Exclude<MultimodalExecutionStage, 'COMPLETED_UNSETTLED'>,
): number | null {
  const snap = shipment.durationSnapshot;
  if (!snap) return null;
  const value = snap[STAGE_DURATION_KEY[stage]];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function isExecutionStage(value: string): value is MultimodalExecutionStage {
  return (MULTIMODAL_EXECUTION_STAGES as readonly string[]).includes(value);
}

function isInternalExecution(shipment: PersistedReadableMultimodalShipment): boolean {
  return shipment.executionPolicyVersion === MULTIMODAL_EXECUTION_POLICY_VERSION;
}

function patchById<T extends { id: string }>(list: T[], id: string, fn: (row: T) => T): T[] {
  return list.map((row) => (row.id === id ? fn(row) : row));
}

function releaseOwner(
  player: PlayerFleetSlice,
  shipmentId: string,
  ids: { truckId?: string | null; driverId?: string | null; trailerId?: string | null },
  originCityId?: string,
): PlayerFleetSlice {
  let { trucks, drivers, trailers } = player;
  if (ids.truckId) {
    trucks = patchById(trucks, ids.truckId, (truck) => {
      if (truck.assignedMultimodalShipmentId !== shipmentId) return truck;
      return {
        ...truck,
        status: 'idle' as const,
        currentCityId: originCityId ?? truck.currentCityId,
        assignedMultimodalShipmentId: undefined,
      };
    });
  }
  if (ids.driverId) {
    drivers = patchById(drivers, ids.driverId, (driver) => {
      if (driver.assignedMultimodalShipmentId !== shipmentId) return driver;
      return {
        ...driver,
        status: 'idle' as const,
        currentCityId: originCityId ?? driver.currentCityId,
        assignedMultimodalShipmentId: undefined,
      };
    });
  }
  if (ids.trailerId) {
    trailers = patchById(trailers, ids.trailerId, (trailer) => {
      if (trailer.assignedMultimodalShipmentId !== shipmentId) return trailer;
      return {
        ...trailer,
        status: trailer.status === 'in_use' ? ('attached' as const) : trailer.status,
        city: originCityId ?? trailer.city,
        assignedMultimodalShipmentId: undefined,
      };
    });
  }
  return { ...player, trucks, drivers, trailers };
}

function activateLastMile(player: PlayerFleetSlice, shipment: PersistedReadableMultimodalShipment): PlayerFleetSlice {
  const assignment = shipment.assignmentSnapshot;
  if (!assignment) return player;
  const lastTruckId = assignment.lastMileTruckId;
  const lastDriverId = assignment.lastMileDriverId;
  if (!lastTruckId || !lastDriverId) return player;
  let { trucks, drivers, trailers } = player;
  trucks = patchById(trucks, lastTruckId, (truck) =>
    truck.assignedMultimodalShipmentId === shipment.shipmentId
      ? { ...truck, status: 'on_route' as const }
      : truck,
  );
  drivers = patchById(drivers, lastDriverId, (driver) =>
    driver.assignedMultimodalShipmentId === shipment.shipmentId
      ? { ...driver, status: 'driving' as const, assignedTruckId: lastTruckId }
      : driver,
  );
  if (assignment.lastMileTrailerId) {
    trailers = patchById(trailers, assignment.lastMileTrailerId, (trailer) =>
      trailer.assignedMultimodalShipmentId === shipment.shipmentId
        ? { ...trailer, status: 'in_use' as const }
        : trailer,
    );
  }
  return { ...player, trucks, drivers, trailers };
}

function onStageEnter(
  player: PlayerFleetSlice,
  shipment: PersistedReadableMultimodalShipment,
  next: MultimodalExecutionStage,
): PlayerFleetSlice {
  const assignment = shipment.assignmentSnapshot;
  if (!assignment) return player;
  if (next === 'ORIGIN_TRANSFER') {
    return releaseOwner(
      player,
      shipment.shipmentId,
      {
        truckId: assignment.firstMileTruckId,
        driverId: assignment.firstMileDriverId,
        trailerId: assignment.firstMileTrailerId,
      },
      shipment.originCityId,
    );
  }
  if (next === 'LAST_MILE_ROAD') {
    return activateLastMile(player, shipment);
  }
  if (next === 'COMPLETED_UNSETTLED') {
    return releaseOwner(player, shipment.shipmentId, {
      truckId: assignment.lastMileTruckId,
      driverId: assignment.lastMileDriverId,
      trailerId: assignment.lastMileTrailerId,
    }, shipment.destinationCityId);
  }
  return player;
}

function withLegStatuses(
  shipment: PersistedReadableMultimodalShipment,
  stage: MultimodalExecutionStage,
): PersistedReadableMultimodalShipment {
  const legs = shipment.legs.map((leg) => ({ ...leg }));
  const transfers = shipment.transfers.map((row) => ({ ...row }));
  const markLeg = (index: number, status: typeof legs[number]['status']) => {
    if (legs[index]) legs[index] = { ...legs[index], status };
  };
  const markTransfer = (index: number, status: typeof transfers[number]['status']) => {
    if (transfers[index]) transfers[index] = { ...transfers[index], status };
  };
  if (stage === 'FIRST_MILE_ROAD') {
    markLeg(0, 'IN_PROGRESS');
  } else if (stage === 'ORIGIN_TRANSFER') {
    markLeg(0, 'COMPLETED');
    markTransfer(0, 'IN_PROGRESS');
  } else if (stage === 'RAIL_LINEHAUL') {
    markTransfer(0, 'COMPLETED');
    markLeg(1, 'IN_PROGRESS');
  } else if (stage === 'DESTINATION_TRANSFER') {
    markLeg(1, 'COMPLETED');
    markTransfer(1, 'IN_PROGRESS');
  } else if (stage === 'LAST_MILE_ROAD') {
    markTransfer(1, 'COMPLETED');
    markLeg(2, 'IN_PROGRESS');
  } else if (stage === 'COMPLETED_UNSETTLED') {
    markLeg(2, 'COMPLETED');
    markTransfer(1, 'COMPLETED');
  }
  const stepIndex =
    stage === 'FIRST_MILE_ROAD'
      ? 0
      : stage === 'ORIGIN_TRANSFER'
        ? 1
        : stage === 'RAIL_LINEHAUL'
          ? 2
          : stage === 'DESTINATION_TRANSFER'
            ? 3
            : stage === 'LAST_MILE_ROAD'
              ? 4
              : 5;
  return { ...shipment, legs, transfers, currentStepIndex: stepIndex };
}

function advanceOne(
  shipment: PersistedReadableMultimodalShipment,
  player: PlayerFleetSlice,
  budgetSeconds: number,
  nowMs: number,
): {
  shipment: PersistedReadableMultimodalShipment;
  player: PlayerFleetSlice;
  consumed: number;
  status: MultimodalProgressStatus;
} {
  if (shipment.settlementState === 'SETTLED' || shipment.status === 'COMPLETED') {
    return { shipment, player, consumed: 0, status: 'COMPLETED_UNSETTLED' };
  }
  if (shipment.status === 'CANCELLED' || shipment.status === 'FAILED') {
    return { shipment, player, consumed: 0, status: 'INVALID_STATE' };
  }
  if (shipment.executionStage === 'COMPLETED_UNSETTLED' || shipment.status === 'COMPLETED_UNSETTLED') {
    return {
      shipment: {
        ...shipment,
        status: 'COMPLETED_UNSETTLED',
        executionStage: 'COMPLETED_UNSETTLED',
        lastProgressedRealAtMs: nowMs,
      },
      player,
      consumed: 0,
      status: 'COMPLETED_UNSETTLED',
    };
  }
  const stageRaw = shipment.executionStage ?? 'FIRST_MILE_ROAD';
  if (stageRaw === 'COMPLETED_UNSETTLED') {
    return { shipment, player, consumed: 0, status: 'COMPLETED_UNSETTLED' };
  }
  if (!isExecutionStage(stageRaw) || stageRaw === 'COMPLETED_UNSETTLED') {
    return { shipment, player, consumed: 0, status: 'EXECUTION_STATE_INVALID' };
  }
  const stage = stageRaw;
  const planned = stagePlannedSeconds(shipment, stage);
  if (planned == null) {
    return { shipment, player, consumed: 0, status: 'INVALID_SNAPSHOT' };
  }
  const elapsed = Math.max(0, Math.floor(shipment.currentStageElapsedGameSeconds ?? 0));
  const remaining = Math.max(0, planned - elapsed);
  if (budgetSeconds <= 0) {
    return { shipment, player, consumed: 0, status: 'NO_ELAPSED_TIME' };
  }
  const take = Math.min(remaining, budgetSeconds);
  const nextElapsed = elapsed + take;
  const totalElapsed = Math.max(0, Math.floor(shipment.totalElapsedGameSeconds ?? 0) + take);
  const cappedTotal = shipment.durationSnapshot?.totalDurationGameSeconds != null
    ? Math.min(totalElapsed, shipment.durationSnapshot.totalDurationGameSeconds)
    : totalElapsed;

  if (nextElapsed < planned) {
    return {
      shipment: {
        ...shipment,
        currentStageElapsedGameSeconds: nextElapsed,
        totalElapsedGameSeconds: cappedTotal,
        lastProgressedRealAtMs: nowMs,
      },
      player,
      consumed: take,
      status: 'PROGRESSED',
    };
  }

  const completedStages = [...(shipment.completedStages ?? []), stage];
  const stageIndex = MULTIMODAL_EXECUTION_STAGES.indexOf(stage);
  const nextStage = MULTIMODAL_EXECUTION_STAGES[stageIndex + 1] ?? 'COMPLETED_UNSETTLED';
  let nextShipment: PersistedReadableMultimodalShipment = withLegStatuses(
    {
      ...shipment,
      currentStageElapsedGameSeconds: 0,
      totalElapsedGameSeconds: cappedTotal,
      completedStages,
      executionStage: nextStage,
      lastProgressedRealAtMs: nowMs,
      status: nextStage === 'COMPLETED_UNSETTLED' ? 'COMPLETED_UNSETTLED' : 'ACTIVE',
      completedAt: nextStage === 'COMPLETED_UNSETTLED' ? nowMs : shipment.completedAt,
    },
    nextStage,
  );
  const nextPlayer = onStageEnter(player, nextShipment, nextStage);
  return {
    shipment: nextShipment,
    player: nextPlayer,
    consumed: take,
    status: nextStage === 'COMPLETED_UNSETTLED' ? 'COMPLETED_UNSETTLED' : 'STAGE_ADVANCED',
  };
}

export function elapsedGameSecondsFromRealMs(input: {
  elapsedRealMs: number;
  gameSpeed: number;
}): number {
  if (input.elapsedRealMs <= 0) return 0;
  const hours = realMsToGameHours(input.elapsedRealMs, input.gameSpeed);
  return Math.max(0, Math.floor(hours * 3600));
}

export function progressExecutableMultimodalShipments(input: {
  shipments: readonly PersistedMultimodalShipment[];
  player: PlayerFleetSlice;
  elapsedGameSeconds: number;
  nowMs: number;
}): MultimodalProgressResult {
  let player = input.player;
  const completedUnsettledIds: string[] = [];
  let aggregate: MultimodalProgressStatus =
    input.elapsedGameSeconds <= 0 ? 'NO_ELAPSED_TIME' : 'PROGRESSED';

  const nextShipments = input.shipments.map((row) => {
    if (isUnreadablePersistedMultimodalShipment(row)) {
      return row;
    }
    if (!isExecutablePersistedMultimodalShipment(row) || !isInternalExecution(row)) {
      return row;
    }
    if (
      row.status === 'CANCELLED' ||
      row.status === 'FAILED' ||
      row.executionStage === 'COMPLETED_UNSETTLED' ||
      row.status === 'COMPLETED_UNSETTLED'
    ) {
      return row;
    }
    let shipment = row;
    let budget = Math.max(0, Math.floor(input.elapsedGameSeconds));
    let guard = 0;
    while (budget > 0 && guard < 32) {
      guard += 1;
      const step = advanceOne(shipment, player, budget, input.nowMs);
      player = step.player;
      shipment = step.shipment;
      budget -= step.consumed;
      if (step.status === 'COMPLETED_UNSETTLED') {
        aggregate = 'COMPLETED_UNSETTLED';
        completedUnsettledIds.push(shipment.shipmentId);
        break;
      }
      if (step.status === 'NO_ELAPSED_TIME') break;
      if (step.status === 'INVALID_SNAPSHOT' || step.status === 'INVALID_STATE') {
        aggregate = step.status;
        break;
      }
      if (step.status === 'STAGE_ADVANCED') {
        aggregate = 'STAGE_ADVANCED';
      }
      if (step.consumed <= 0) break;
    }
    return shipment;
  });

  return {
    status: aggregate,
    shipments: nextShipments,
    player,
    completedUnsettledIds: [...new Set(completedUnsettledIds)],
  };
}

export function cancelInternalMultimodalShipment(input: {
  shipments: readonly PersistedMultimodalShipment[];
  player: PlayerFleetSlice;
  shipmentId: string;
  nowMs: number;
}): {
  status: 'CANCELLED' | 'NOT_FOUND' | 'UNSUPPORTED_SCHEMA' | 'ALREADY_SETTLED';
  shipments: PersistedMultimodalShipment[];
  player: PlayerFleetSlice;
} {
  const found = input.shipments.find(
    (row) => isExecutablePersistedMultimodalShipment(row) && row.shipmentId === input.shipmentId,
  );
  if (!found || !isExecutablePersistedMultimodalShipment(found)) {
    const unreadable = input.shipments.find((row) => row.shipmentId === input.shipmentId);
    if (unreadable && isUnreadablePersistedMultimodalShipment(unreadable)) {
      return {
        status: 'UNSUPPORTED_SCHEMA',
        shipments: [...input.shipments],
        player: input.player,
      };
    }
    return { status: 'NOT_FOUND', shipments: [...input.shipments], player: input.player };
  }
  if (found.settlementState === 'SETTLED' || found.status === 'COMPLETED') {
    return { status: 'ALREADY_SETTLED', shipments: [...input.shipments], player: input.player };
  }
  const assignment = found.assignmentSnapshot;
  let player = input.player;
  if (assignment) {
    player = releaseOwner(player, found.shipmentId, {
      truckId: assignment.firstMileTruckId,
      driverId: assignment.firstMileDriverId,
      trailerId: assignment.firstMileTrailerId,
    }, found.originCityId);
    player = releaseOwner(player, found.shipmentId, {
      truckId: assignment.lastMileTruckId,
      driverId: assignment.lastMileDriverId,
      trailerId: assignment.lastMileTrailerId,
    }, found.destinationCityId);
  } else {
    player = {
      ...player,
      trucks: player.trucks.map((truck) =>
        truck.assignedMultimodalShipmentId === found.shipmentId
          ? { ...truck, status: 'idle' as const, assignedMultimodalShipmentId: undefined }
          : truck,
      ),
      drivers: player.drivers.map((driver) =>
        driver.assignedMultimodalShipmentId === found.shipmentId
          ? { ...driver, status: 'idle' as const, assignedMultimodalShipmentId: undefined }
          : driver,
      ),
      trailers: player.trailers.map((trailer) =>
        trailer.assignedMultimodalShipmentId === found.shipmentId
          ? { ...trailer, assignedMultimodalShipmentId: undefined }
          : trailer,
      ),
    };
  }
  const shipments = input.shipments.map((row) =>
    isExecutablePersistedMultimodalShipment(row) && row.shipmentId === input.shipmentId
      ? { ...row, status: 'CANCELLED' as const, lastProgressedRealAtMs: input.nowMs }
      : row,
  );
  return { status: 'CANCELLED', shipments, player };
}

export function isDevPlaybackConstantReferenced(): boolean {
  return false;
}
