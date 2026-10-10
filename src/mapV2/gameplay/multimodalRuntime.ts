/**
 * DEV-only multimodal shipment runtime. Mode-generic: ROAD + RAIL, SEA, or AIR middle legs.
 * Not live Delivery.
 *
 * Planned duration comes from src/domain/multimodalDurationPolicy.ts.
 * Wall-clock playback is DEV-only and must not be stored as production duration.
 */
import {
  estimateMultimodalShipmentDuration,
  MULTIMODAL_DURATION_POLICY_VERSION,
  type MultimodalDistanceAuthority,
  type MultimodalShipmentDurationEstimate,
} from '../../domain/multimodalDurationPolicy';
import { SOURCE_BACKED_ROAD_TRANSFER_ACCESS } from '../../domain/multimodalRoadAccess';
import type {
  MultimodalShipmentPlan,
  TransferNode,
  TransportLeg,
  TransportLegStatus,
  TransferRuntimeStatus,
} from '../domain/multimodal';

export const DEV_SIMULATED_ROAD_CARRIER = 'DEV_SIMULATED_ROAD_CARRIER' as const;
export const DEV_SIMULATION_TIMING_POLICY = 'DEV_SIMULATION_ONLY' as const;
export const DEV_LOCAL_DISTANCE_KIND = 'DEV_LOCAL_TRANSFER_DISTANCE' as const;
export const SOURCE_BACKED_RAIL_DISTANCE_KIND = 'SOURCE_BACKED_RAIL_LENGTH' as const;
export const SOURCE_BACKED_SEA_DISTANCE_KIND = 'SOURCE_BACKED_SEA_LENGTH' as const;
export const SOURCE_BACKED_AIR_DISTANCE_KIND = 'SOURCE_BACKED_AIR_GEODESIC' as const;
export const SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND = SOURCE_BACKED_ROAD_TRANSFER_ACCESS;

/** 1 planned game hour plays back in this many real milliseconds at inspector speed 1x. */
export const DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR = 1_000;
export const DEV_FALLBACK_LOCAL_TRANSFER_METERS = 5_000;

export function getDevPlaybackWallMs(plannedDurationGameSeconds: number): number {
  if (!Number.isFinite(plannedDurationGameSeconds) || plannedDurationGameSeconds <= 0) {
    return 0;
  }
  return Math.max(
    1,
    Math.round((plannedDurationGameSeconds / 3600) * DEV_PLAYBACK_REAL_MS_PER_GAME_HOUR),
  );
}

export type MultimodalRuntimeShipmentStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type GenericCargoFixture = {
  units: number;
  weightKg: number;
  kind: 'GENERIC';
};

export type TransportLegRuntimeState = {
  legId: string;
  mode: TransportLeg['mode'];
  status: TransportLegStatus;
  progress: number;
  startedAt: number | null;
  completedAt: number | null;
  distanceMeters: number;
  distanceKind:
    | typeof DEV_LOCAL_DISTANCE_KIND
    | typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND
    | typeof SOURCE_BACKED_RAIL_DISTANCE_KIND
    | typeof SOURCE_BACKED_SEA_DISTANCE_KIND
    | typeof SOURCE_BACKED_AIR_DISTANCE_KIND;
  plannedDurationGameSeconds: number;
  durationSimMs: number;
  durationPolicy: typeof MULTIMODAL_DURATION_POLICY_VERSION | 'NOT_EXECUTABLE';
};

export type TransferRuntimeState = {
  transferNodeId: string;
  status: TransferRuntimeStatus;
  progress: number;
  startedAt: number | null;
  completedAt: number | null;
  plannedDurationGameSeconds: number;
  durationSimMs: number;
  durationPolicy: typeof MULTIMODAL_DURATION_POLICY_VERSION | 'NOT_EXECUTABLE';
  timingPolicy: typeof DEV_SIMULATION_TIMING_POLICY;
};

export type MultimodalShipmentRuntime = {
  shipmentId: string;
  planId: string;
  originCityId: string;
  destinationCityId: string;
  status: MultimodalRuntimeShipmentStatus;
  playing: boolean;
  speed: 1 | 4 | 16;
  simulationTimeMs: number;
  currentStepIndex: number;
  legStates: TransportLegRuntimeState[];
  transferStates: TransferRuntimeState[];
  durationEstimate: MultimodalShipmentDurationEstimate;
  startedAt: number | null;
  completedAt: number | null;
  cargo: GenericCargoFixture;
  roadCarrier: typeof DEV_SIMULATED_ROAD_CARRIER;
  transitionLog: string[];
  plan: MultimodalShipmentPlan;
  transferNodes: readonly TransferNode[];
};

export type MultimodalRuntimeEvent =
  | { type: 'START' }
  | { type: 'TICK'; wallDtMs: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: 1 | 4 | 16 }
  | { type: 'FAIL_LEG' }
  | { type: 'BLOCK_TRANSFER' }
  | { type: 'CANCEL' }
  | { type: 'RESET'; seed: MultimodalShipmentRuntime };

export type RuntimeStepKind = 'LEG' | 'TRANSFER';

export function runtimeStepKind(index: number): RuntimeStepKind {
  return index % 2 === 0 ? 'LEG' : 'TRANSFER';
}

export function runtimeStepSlot(index: number): number {
  return Math.floor(index / 2);
}

export function distanceAuthorityFromKind(
  kind: TransportLegRuntimeState['distanceKind'],
): MultimodalDistanceAuthority {
  if (kind === SOURCE_BACKED_RAIL_DISTANCE_KIND) return 'SOURCE_BACKED_RAIL_LENGTH';
  if (kind === SOURCE_BACKED_SEA_DISTANCE_KIND) return 'SOURCE_BACKED_SEA_LENGTH';
  if (kind === SOURCE_BACKED_AIR_DISTANCE_KIND) return 'SOURCE_BACKED_AIR_GEODESIC';
  if (kind === SOURCE_BACKED_ROAD_TRANSFER_ACCESS_KIND) return 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS';
  return 'PROVIDED_PLANNING_METERS';
}

function transferModesFromNode(node: TransferNode): { fromMode: TransportLeg['mode']; toMode: TransportLeg['mode'] } {
  const caps = node.transferCapabilities;
  if (caps.includes('ROAD_TO_AIR') || caps.includes('AIR_TO_ROAD')) {
    return caps.includes('AIR_TO_ROAD') && !caps.includes('ROAD_TO_AIR')
      ? { fromMode: 'AIR', toMode: 'ROAD' }
      : { fromMode: 'ROAD', toMode: 'AIR' };
  }
  if (caps.includes('ROAD_TO_SEA') || caps.includes('SEA_TO_ROAD')) {
    return caps.includes('SEA_TO_ROAD') && !caps.includes('ROAD_TO_SEA')
      ? { fromMode: 'SEA', toMode: 'ROAD' }
      : { fromMode: 'ROAD', toMode: 'SEA' };
  }
  if (caps.includes('RAIL_TO_ROAD') && !caps.includes('ROAD_TO_RAIL')) {
    return { fromMode: 'RAIL', toMode: 'ROAD' };
  }
  return { fromMode: 'ROAD', toMode: 'RAIL' };
}

/**
 * Weighted overall progress from step durations and 0..1 step progress.
 * overall = sum(step.progress * step.duration) / sum(durations)
 * No economy meaning.
 */
export function calculateOverallProgress(runtime: MultimodalShipmentRuntime): number {
  const weights: number[] = [];
  const progresses: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    if (runtimeStepKind(i) === 'LEG') {
      const leg = runtime.legStates[runtimeStepSlot(i)];
      weights.push(leg.plannedDurationGameSeconds);
      progresses.push(leg.status === 'COMPLETED' ? 1 : leg.status === 'FAILED' || leg.status === 'CANCELLED' ? leg.progress : leg.progress);
    } else {
      const transfer = runtime.transferStates[runtimeStepSlot(i)];
      weights.push(transfer.plannedDurationGameSeconds);
      progresses.push(transfer.status === 'COMPLETED' ? 1 : transfer.progress);
    }
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return weights.reduce((sum, weight, index) => sum + weight * progresses[index], 0) / total;
}

export function getActiveShipmentStep(runtime: MultimodalShipmentRuntime): {
  index: number;
  kind: RuntimeStepKind;
  slot: number;
  label: string;
} | null {
  if (runtime.status === 'PLANNED' || runtime.status === 'COMPLETED') return null;
  const index = runtime.currentStepIndex;
  const kind = runtimeStepKind(index);
  const slot = runtimeStepSlot(index);
  if (kind === 'LEG') {
    const mode = runtime.legStates[slot].mode;
    return { index, kind, slot, label: `${mode} leg ${slot + 1}` };
  }
  return { index, kind, slot, label: `Transfer ${slot + 1}` };
}

function log(runtime: MultimodalShipmentRuntime, entry: string): MultimodalShipmentRuntime {
  return { ...runtime, transitionLog: [...runtime.transitionLog, entry] };
}

function activateStep(runtime: MultimodalShipmentRuntime, index: number): MultimodalShipmentRuntime {
  const kind = runtimeStepKind(index);
  const slot = runtimeStepSlot(index);
  const now = runtime.simulationTimeMs;
  if (kind === 'LEG') {
    const legs = runtime.legStates.map((leg, i) =>
      i === slot ? { ...leg, status: 'READY' as const, progress: 0, startedAt: now } : leg,
    );
    const withReady = log({ ...runtime, currentStepIndex: index, legStates: legs }, `LEG:${legs[slot].legId}:READY`);
    const inProgress = withReady.legStates.map((leg, i) =>
      i === slot ? { ...leg, status: 'IN_PROGRESS' as const } : leg,
    );
    return log({ ...withReady, legStates: inProgress }, `LEG:${inProgress[slot].legId}:IN_PROGRESS`);
  }
  const transfers = runtime.transferStates.map((row, i) =>
    i === slot ? { ...row, status: 'READY' as const, progress: 0, startedAt: now } : row,
  );
  const withReady = log({ ...runtime, currentStepIndex: index, transferStates: transfers }, `TRANSFER:${transfers[slot].transferNodeId}:READY`);
  const inProgress = withReady.transferStates.map((row, i) =>
    i === slot ? { ...row, status: 'IN_PROGRESS' as const } : row,
  );
  return log({ ...withReady, transferStates: inProgress }, `TRANSFER:${inProgress[slot].transferNodeId}:IN_PROGRESS`);
}

function completeCurrent(runtime: MultimodalShipmentRuntime): MultimodalShipmentRuntime {
  const index = runtime.currentStepIndex;
  const kind = runtimeStepKind(index);
  const slot = runtimeStepSlot(index);
  const now = runtime.simulationTimeMs;
  let next = runtime;
  if (kind === 'LEG') {
    const legs = runtime.legStates.map((leg, i) =>
      i === slot ? { ...leg, status: 'COMPLETED' as const, progress: 1, completedAt: now } : leg,
    );
    next = log({ ...runtime, legStates: legs }, `LEG:${legs[slot].legId}:COMPLETED`);
  } else {
    const transfers = runtime.transferStates.map((row, i) =>
      i === slot ? { ...row, status: 'COMPLETED' as const, progress: 1, completedAt: now } : row,
    );
    next = log({ ...runtime, transferStates: transfers }, `TRANSFER:${transfers[slot].transferNodeId}:COMPLETED`);
  }
  if (index >= 4) {
    return log(
      { ...next, status: 'COMPLETED', playing: false, completedAt: now, currentStepIndex: 4 },
      'SHIPMENT:COMPLETED',
    );
  }
  return activateStep(next, index + 1);
}

export function createMultimodalRuntime(input: {
  plan: MultimodalShipmentPlan;
  transferNodes: readonly TransferNode[];
  legs: ReadonlyArray<{
    distanceMeters: number;
    distanceKind: TransportLegRuntimeState['distanceKind'];
  }>;
}): MultimodalShipmentRuntime {
  const shipmentId = `runtime.${input.plan.id}`;
  const durationEstimate = estimateMultimodalShipmentDuration({
    planId: input.plan.id,
    shipmentSchemaVersion: 1,
    legs: input.plan.legs.map((leg, index) => ({
      legId: leg.id,
      mode: leg.mode,
      distanceMeters: input.legs[index]?.distanceMeters,
      distanceAuthority: distanceAuthorityFromKind(
        input.legs[index]?.distanceKind ?? DEV_LOCAL_DISTANCE_KIND,
      ),
      routeReference: leg.routeReference,
    })),
    transfers: input.transferNodes.map((node) => {
      const modes = transferModesFromNode(node);
      return {
        transferId: node.id,
        fromMode: modes.fromMode,
        toMode: modes.toMode,
      };
    }),
  });
  const executable = durationEstimate.status === 'READY';
  const durationPolicy = executable ? MULTIMODAL_DURATION_POLICY_VERSION : 'NOT_EXECUTABLE';
  const legStates: TransportLegRuntimeState[] = input.plan.legs.map((leg, index) => {
    const planned = durationEstimate.legDurations[index]?.durationGameSeconds ?? 0;
    return {
      legId: leg.id,
      mode: leg.mode,
      status: 'PLANNED',
      progress: 0,
      startedAt: null,
      completedAt: null,
      distanceMeters: input.legs[index].distanceMeters,
      distanceKind: input.legs[index].distanceKind,
      plannedDurationGameSeconds: planned,
      durationSimMs: getDevPlaybackWallMs(planned),
      durationPolicy,
    };
  });
  const transferStates: TransferRuntimeState[] = input.transferNodes.map((node, index) => {
    const planned = durationEstimate.transferDurations[index]?.durationGameSeconds ?? 0;
    return {
      transferNodeId: node.id,
      status: 'PENDING',
      progress: 0,
      startedAt: null,
      completedAt: null,
      plannedDurationGameSeconds: planned,
      durationSimMs: getDevPlaybackWallMs(planned),
      durationPolicy,
      timingPolicy: DEV_SIMULATION_TIMING_POLICY,
    };
  });
  return {
    shipmentId,
    planId: input.plan.id,
    originCityId: input.plan.originCityId,
    destinationCityId: input.plan.destinationCityId,
    status: 'PLANNED',
    playing: false,
    speed: 1,
    simulationTimeMs: 0,
    currentStepIndex: 0,
    legStates,
    transferStates,
    durationEstimate,
    startedAt: null,
    completedAt: null,
    cargo: { units: 1, weightKg: 1000, kind: 'GENERIC' },
    roadCarrier: DEV_SIMULATED_ROAD_CARRIER,
    transitionLog: ['SHIPMENT:PLANNED'],
    plan: input.plan,
    transferNodes: input.transferNodes,
  };
}

export function advanceMultimodalRuntime(
  runtime: MultimodalShipmentRuntime,
  event: MultimodalRuntimeEvent,
): MultimodalShipmentRuntime {
  switch (event.type) {
    case 'RESET':
      return event.seed;
    case 'SET_SPEED':
      return { ...runtime, speed: event.speed };
    case 'PAUSE':
      if (runtime.status !== 'ACTIVE') return runtime;
      return { ...runtime, playing: false };
    case 'RESUME':
      if (runtime.status !== 'ACTIVE') return runtime;
      return { ...runtime, playing: true };
    case 'START': {
      if (runtime.status !== 'PLANNED') return runtime;
      const started = log(
        { ...runtime, status: 'ACTIVE', playing: true, startedAt: 0 },
        'SHIPMENT:ACTIVE',
      );
      return activateStep(started, 0);
    }
    case 'CANCEL': {
      if (runtime.status !== 'ACTIVE' && runtime.status !== 'BLOCKED') return runtime;
      const kind = runtimeStepKind(runtime.currentStepIndex);
      const slot = runtimeStepSlot(runtime.currentStepIndex);
      let next = runtime;
      if (kind === 'LEG') {
        const legs = runtime.legStates.map((leg, i) =>
          i === slot && (leg.status === 'IN_PROGRESS' || leg.status === 'READY')
            ? { ...leg, status: 'CANCELLED' as const }
            : leg,
        );
        next = { ...runtime, legStates: legs };
      }
      return log({ ...next, status: 'CANCELLED', playing: false }, 'SHIPMENT:CANCELLED');
    }
    case 'FAIL_LEG': {
      if (runtime.status !== 'ACTIVE') return runtime;
      if (runtimeStepKind(runtime.currentStepIndex) !== 'LEG') return runtime;
      const slot = runtimeStepSlot(runtime.currentStepIndex);
      const legs = runtime.legStates.map((leg, i) =>
        i === slot && leg.status === 'IN_PROGRESS' ? { ...leg, status: 'FAILED' as const } : leg,
      );
      if (legs[slot].status !== 'FAILED') return runtime;
      const failed = log({ ...runtime, legStates: legs, status: 'FAILED', playing: false }, `LEG:${legs[slot].legId}:FAILED`);
      return log(failed, 'SHIPMENT:FAILED');
    }
    case 'BLOCK_TRANSFER': {
      if (runtime.status !== 'ACTIVE') return runtime;
      if (runtimeStepKind(runtime.currentStepIndex) !== 'TRANSFER') return runtime;
      const slot = runtimeStepSlot(runtime.currentStepIndex);
      const transfers = runtime.transferStates.map((row, i) =>
        i === slot && (row.status === 'IN_PROGRESS' || row.status === 'READY')
          ? { ...row, status: 'BLOCKED' as const }
          : row,
      );
      if (transfers[slot].status !== 'BLOCKED') return runtime;
      const blocked = log(
        { ...runtime, transferStates: transfers, status: 'BLOCKED', playing: false },
        `TRANSFER:${transfers[slot].transferNodeId}:BLOCKED`,
      );
      return log(blocked, 'SHIPMENT:BLOCKED');
    }
    case 'TICK': {
      if (!runtime.playing || runtime.status !== 'ACTIVE') return runtime;
      const dt = Math.max(0, event.wallDtMs) * runtime.speed;
      if (dt <= 0) return runtime;
      let next: MultimodalShipmentRuntime = { ...runtime, simulationTimeMs: runtime.simulationTimeMs + dt };
      const kind = runtimeStepKind(next.currentStepIndex);
      const slot = runtimeStepSlot(next.currentStepIndex);
      if (kind === 'LEG') {
        const leg = next.legStates[slot];
        if (leg.status !== 'IN_PROGRESS') return next;
        if (leg.durationSimMs <= 0) return next;
        const progress = Math.min(1, leg.progress + dt / leg.durationSimMs);
        const legs = next.legStates.map((row, i) => (i === slot ? { ...row, progress } : row));
        next = { ...next, legStates: legs };
        if (progress >= 1) next = completeCurrent(next);
        return next;
      }
      const transfer = next.transferStates[slot];
      if (transfer.status !== 'IN_PROGRESS') return next;
      if (transfer.durationSimMs <= 0) return next;
      const progress = Math.min(1, transfer.progress + dt / transfer.durationSimMs);
      const transfers = next.transferStates.map((row, i) => (i === slot ? { ...row, progress } : row));
      next = { ...next, transferStates: transfers };
      if (progress >= 1) next = completeCurrent(next);
      return next;
    }
    default:
      return runtime;
  }
}

export function createRuntimeFromFixture(fixture: {
  plan: MultimodalShipmentPlan;
  transferNodes: readonly TransferNode[];
  legDistances: ReadonlyArray<{
    distanceMeters: number;
    distanceKind: TransportLegRuntimeState['distanceKind'];
  }>;
}): MultimodalShipmentRuntime {
  return createMultimodalRuntime({
    plan: fixture.plan,
    transferNodes: fixture.transferNodes,
    legs: fixture.legDistances,
  });
}

export function runUntilIdle(runtime: MultimodalShipmentRuntime, wallDtMs = 60_000): MultimodalShipmentRuntime {
  let next = runtime;
  for (let i = 0; i < 64; i += 1) {
    if (next.status !== 'ACTIVE' || !next.playing) return next;
    const before = next.simulationTimeMs;
    next = advanceMultimodalRuntime(next, { type: 'TICK', wallDtMs });
    if (next.simulationTimeMs === before) return next;
  }
  return next;
}
