/**
 * Delivery delay diagnostics — pause tracking, settlement history, primary cause.
 * Reputation deltas are not computed here.
 */

import type {
  Delivery,
  DeliveryFailureReason,
} from '../types/game';
import type { DeadlineRiskLevel } from '../utils/deadlineUx';
import { clamp } from '../utils/math';
import type { DeliveryPunctuality } from '../simulation/reputationSettlement';

export const DELIVERY_SETTLEMENT_HISTORY_MAX = 20;
const MATERIAL_PAUSE_HOURS = 0.15;
const DOMINANT_SHARE = 0.4;

export type DeliveryDelayCause =
  | 'BREAKDOWN'
  | 'ACCIDENT'
  | 'TOO_LATE'
  | 'CANCELLED'
  | 'OUT_OF_FUEL'
  | 'INCIDENT_WAIT'
  | 'VEHICLE_TOO_SLOW'
  | 'GENERAL_LATENESS'
  | 'ON_TIME';

export interface DeliveryDelayDiagnostics {
  outOfFuelHours: number;
  incidentPendingHours: number;
  otherPausedHours: number;
  fuelOutCount: number;
  incidentChoiceDelayHours?: number;
}

export type DeliveryDelayDiagnosticsFields = DeliveryDelayDiagnostics;

export interface DeliveryStartReadinessSnapshot {
  estimatedTravelHours: number;
  deadlineHours: number;
  timeMarginHours: number;
  deadlineRisk: DeadlineRiskLevel;
  requiredFuelL: number;
  currentFuelL: number;
}

export interface DeliverySettlementRecord {
  deliveryId: string;
  contractId: string;
  vehicleId: string;
  originCityId: string;
  destinationCityId: string;
  distanceKm: number;
  startedAt: number;
  completedAt: number;
  estimatedTravelHours: number;
  deadlineHours: number;
  actualTravelHours: number;
  /** Ham oyun saati — arka plan catch-up dahil; yalnızca şeffaflık için */
  wallClockTravelHours?: number;
  latenessHours: number;
  latenessRatio: number;
  punctualityResult: DeliveryPunctuality | 'cancelled';
  failureReason?: DeliveryFailureReason;
  timePausedOutOfFuel: number;
  timePausedIncident: number;
  incidentChoiceDelayHours: number;
  fuelOutEventCount: number;
  incidentCount: number;
  vehicleEstimatedDurationAtStart: number;
  deadlineRiskAtStart: DeadlineRiskLevel | null;
  reputationDelta: number;
  primaryCause: DeliveryDelayCause;
  contributingCauses: DeliveryDelayCause[];
}

export function createEmptyDelayDiagnostics(): DeliveryDelayDiagnostics {
  return {
    outOfFuelHours: 0,
    incidentPendingHours: 0,
    otherPausedHours: 0,
    fuelOutCount: 0,
    incidentChoiceDelayHours: 0,
  };
}

export function normalizeDelayDiagnostics(
  value: unknown,
): DeliveryDelayDiagnostics {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<DeliveryDelayDiagnostics>)
      : {};
  const finite = (raw: unknown): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return {
    outOfFuelHours: finite(source.outOfFuelHours),
    incidentPendingHours: finite(source.incidentPendingHours),
    otherPausedHours: finite(source.otherPausedHours),
    fuelOutCount: Math.floor(finite(source.fuelOutCount)),
    incidentChoiceDelayHours: finite(source.incidentChoiceDelayHours),
  };
}

export function addDelayHours(
  diagnostics: DeliveryDelayDiagnostics | undefined,
  field: keyof Pick<
    DeliveryDelayDiagnostics,
    'outOfFuelHours' | 'incidentPendingHours' | 'otherPausedHours' | 'incidentChoiceDelayHours'
  >,
  hours: number,
): DeliveryDelayDiagnostics {
  const next = normalizeDelayDiagnostics(diagnostics);
  if (!(hours > 0)) {
    return next;
  }
  next[field] = (next[field] ?? 0) + hours;
  return next;
}

export function incrementFuelOutCount(
  diagnostics: DeliveryDelayDiagnostics | undefined,
): DeliveryDelayDiagnostics {
  const next = normalizeDelayDiagnostics(diagnostics);
  next.fuelOutCount += 1;
  return next;
}

export function isPendingIncidentBlocking(delivery: Pick<Delivery, 'incident' | 'incidentResolved'>): boolean {
  return (
    delivery.incident?.status === 'pending' &&
    delivery.incidentResolved !== true &&
    !delivery.incident?.resolvedChoiceId
  );
}

/** Beklenmeyen olay / yakıt duraklamalarının toplamı (saat). */
export function computePausedHours(
  diagnostics: DeliveryDelayDiagnostics | undefined,
): number {
  const normalized = normalizeDelayDiagnostics(diagnostics);
  return (
    normalized.outOfFuelHours +
    normalized.incidentPendingHours +
    normalized.otherPausedHours +
    (normalized.incidentChoiceDelayHours ?? 0)
  );
}

/**
 * Son teslim hesabında kullanılan efektif yol süresi.
 * Arka plan saati şişirmesini ve kayıtlı duraklamaları düşer; ilerlemeye göre tavan uygular.
 */
export function computeEffectiveTravelHours(
  delivery: Pick<
    Delivery,
    'startedAt' | 'travelHours' | 'progress' | 'delayDiagnostics'
  >,
  currentTime: number,
): number {
  const wallClockHours = Math.max(0, currentTime - delivery.startedAt);
  const pausedHours = computePausedHours(delivery.delayDiagnostics);
  const afterPause = Math.max(0, wallClockHours - pausedHours);

  const travelHours = Math.max(delivery.travelHours ?? 0.1, 0.1);
  const progress = clamp(delivery.progress ?? 0, 0, 1);
  const progressCeiling =
    progress >= 1 - 1e-6
      ? travelHours
      : Math.max(travelHours * progress, travelHours * 0.01);

  return Math.min(afterPause, progressCeiling);
}

export function computeWallClockTravelHours(
  delivery: Pick<Delivery, 'startedAt'>,
  currentTime: number,
): number {
  return Math.max(0, currentTime - delivery.startedAt);
}

export function accumulateDeliveryTickDiagnostics(
  delivery: Delivery,
  hoursPassed: number,
  options: {
    wasOutOfFuel: boolean;
    isOutOfFuel: boolean;
    incidentBlocking: boolean;
    otherPaused: boolean;
  },
): Delivery {
  if (!(hoursPassed > 0)) {
    return {
      ...delivery,
      delayDiagnostics: normalizeDelayDiagnostics(delivery.delayDiagnostics),
    };
  }

  let diagnostics = normalizeDelayDiagnostics(delivery.delayDiagnostics);
  if (options.isOutOfFuel) {
    diagnostics = addDelayHours(diagnostics, 'outOfFuelHours', hoursPassed);
    if (!options.wasOutOfFuel) {
      diagnostics = incrementFuelOutCount(diagnostics);
    }
  } else if (options.incidentBlocking) {
    diagnostics = addDelayHours(diagnostics, 'incidentPendingHours', hoursPassed);
  } else if (options.otherPaused) {
    diagnostics = addDelayHours(diagnostics, 'otherPausedHours', hoursPassed);
  }

  const deadlinePaused =
    options.isOutOfFuel || options.incidentBlocking || options.otherPaused;
  const bumpEta = deadlinePaused;
  return {
    ...delivery,
    delayDiagnostics: diagnostics,
    estimatedArrivalTime: bumpEta
      ? delivery.estimatedArrivalTime + hoursPassed
      : delivery.estimatedArrivalTime,
    deadlineTime: deadlinePaused
      ? delivery.deadlineTime + hoursPassed
      : delivery.deadlineTime,
    currentSpeedKmh:
      options.isOutOfFuel || options.incidentBlocking || options.otherPaused
        ? 0
        : delivery.currentSpeedKmh,
  };
}

export function deriveDeliveryDelayCauses(input: {
  failureReason?: DeliveryFailureReason;
  punctuality: DeliveryPunctuality | 'cancelled';
  outOfFuelHours: number;
  incidentPendingHours: number;
  latenessHours: number;
  vehicleEstimatedDurationAtStart: number;
  deadlineHours: number;
}): { primaryCause: DeliveryDelayCause; contributingCauses: DeliveryDelayCause[] } {
  if (input.failureReason === 'breakdown') {
    return { primaryCause: 'BREAKDOWN', contributingCauses: [] };
  }
  if (input.failureReason === 'accident') {
    return { primaryCause: 'ACCIDENT', contributingCauses: [] };
  }
  if (input.failureReason === 'cancelled' || input.punctuality === 'cancelled') {
    return { primaryCause: 'CANCELLED', contributingCauses: [] };
  }
  if (input.failureReason === 'too_late') {
    const lateCauses = collectLatenessCauses(input);
    return {
      primaryCause: 'TOO_LATE',
      contributingCauses: lateCauses.filter((cause) => cause !== 'TOO_LATE' && cause !== 'GENERAL_LATENESS'),
    };
  }

  const isLate =
    input.punctuality === 'late-minor' ||
    input.punctuality === 'late-major' ||
    input.punctuality === 'failed';
  if (!isLate) {
    return { primaryCause: 'ON_TIME', contributingCauses: [] };
  }

  const causes = collectLatenessCauses(input);
  return {
    primaryCause: causes[0] ?? 'GENERAL_LATENESS',
    contributingCauses: causes.slice(1),
  };
}

function collectLatenessCauses(input: {
  outOfFuelHours: number;
  incidentPendingHours: number;
  latenessHours: number;
  vehicleEstimatedDurationAtStart: number;
  deadlineHours: number;
}): DeliveryDelayCause[] {
  const causes: DeliveryDelayCause[] = [];
  const lateness = Math.max(input.latenessHours, 0.01);
  const fuelMaterial =
    input.outOfFuelHours >= MATERIAL_PAUSE_HOURS &&
    input.outOfFuelHours / lateness >= 0.2;
  const incidentMaterial =
    input.incidentPendingHours >= MATERIAL_PAUSE_HOURS &&
    input.incidentPendingHours / lateness >= 0.2;
  const tooSlowAtStart = input.vehicleEstimatedDurationAtStart > input.deadlineHours + 1e-6;

  const ranked: Array<{ cause: DeliveryDelayCause; hours: number }> = [
    { cause: 'OUT_OF_FUEL', hours: input.outOfFuelHours },
    { cause: 'INCIDENT_WAIT', hours: input.incidentPendingHours },
  ];
  ranked.sort((a, b) => b.hours - a.hours);

  if (fuelMaterial || incidentMaterial) {
    for (const item of ranked) {
      const material =
        item.cause === 'OUT_OF_FUEL' ? fuelMaterial : incidentMaterial;
      if (material) {
        causes.push(item.cause);
      }
    }
  } else if (ranked[0] && ranked[0].hours >= MATERIAL_PAUSE_HOURS && ranked[0].hours / lateness >= DOMINANT_SHARE) {
    causes.push(ranked[0].cause);
  }

  if (tooSlowAtStart) {
    causes.push('VEHICLE_TOO_SLOW');
  }
  if (causes.length === 0) {
    causes.push('GENERAL_LATENESS');
  }
  return causes;
}

export function buildDeliverySettlementRecord(input: {
  delivery: Delivery;
  contractId: string;
  completedAt: number;
  actualTravelHours: number;
  wallClockTravelHours?: number;
  deadlineHours: number;
  punctualityResult: DeliveryPunctuality | 'cancelled';
  failureReason?: DeliveryFailureReason;
  reputationDelta: number;
}): DeliverySettlementRecord {
  const diagnostics = normalizeDelayDiagnostics(input.delivery.delayDiagnostics);
  const start = input.delivery.startReadiness;
  const estimatedTravelHours =
    start?.estimatedTravelHours ?? input.delivery.travelHours;
  const effectiveTravelHours = Math.max(0, input.actualTravelHours);
  const wallClockTravelHours =
    input.wallClockTravelHours ??
    computeWallClockTravelHours(input.delivery, input.completedAt);
  const latenessHours = Math.max(0, effectiveTravelHours - input.deadlineHours);
  const latenessRatio = latenessHours / Math.max(input.deadlineHours, 0.1);
  const { primaryCause, contributingCauses } = deriveDeliveryDelayCauses({
    failureReason: input.failureReason,
    punctuality: input.punctualityResult,
    outOfFuelHours: diagnostics.outOfFuelHours,
    incidentPendingHours: diagnostics.incidentPendingHours,
    latenessHours,
    vehicleEstimatedDurationAtStart: estimatedTravelHours,
    deadlineHours: input.deadlineHours,
  });
  const incidentCount = Math.max(
    input.delivery.incident ? 1 : 0,
    input.delivery.incidentGenerated ? 1 : 0,
    input.delivery.incidentResolutionHistory?.length ?? 0,
  );

  return {
    deliveryId: input.delivery.id,
    contractId: input.contractId,
    vehicleId: input.delivery.truckId,
    originCityId: input.delivery.originCityId,
    destinationCityId: input.delivery.destinationCityId,
    distanceKm: input.delivery.distanceKm,
    startedAt: input.delivery.startedAt,
    completedAt: input.completedAt,
    estimatedTravelHours,
    deadlineHours: input.deadlineHours,
    actualTravelHours: effectiveTravelHours,
    wallClockTravelHours,
    latenessHours,
    latenessRatio,
    punctualityResult: input.punctualityResult,
    failureReason: input.failureReason,
    timePausedOutOfFuel: diagnostics.outOfFuelHours,
    timePausedIncident: diagnostics.incidentPendingHours,
    incidentChoiceDelayHours: diagnostics.incidentChoiceDelayHours ?? 0,
    fuelOutEventCount: diagnostics.fuelOutCount,
    incidentCount,
    vehicleEstimatedDurationAtStart: estimatedTravelHours,
    deadlineRiskAtStart: start?.deadlineRisk ?? null,
    reputationDelta: input.reputationDelta,
    primaryCause,
    contributingCauses,
  };
}

export function prependSettlementRecord(
  history: DeliverySettlementRecord[] | undefined,
  record: DeliverySettlementRecord,
): DeliverySettlementRecord[] {
  const existing = Array.isArray(history) ? history : [];
  const withoutDup = existing.filter((item) => item.deliveryId !== record.deliveryId);
  return [record, ...withoutDup].slice(0, DELIVERY_SETTLEMENT_HISTORY_MAX);
}

export function normalizeSettlementHistory(value: unknown): DeliverySettlementRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is DeliverySettlementRecord => {
      return (
        item != null &&
        typeof item === 'object' &&
        typeof (item as DeliverySettlementRecord).deliveryId === 'string' &&
        typeof (item as DeliverySettlementRecord).actualTravelHours === 'number'
      );
    })
    .map((item) => ({
      ...item,
      incidentChoiceDelayHours:
        typeof item.incidentChoiceDelayHours === 'number' && Number.isFinite(item.incidentChoiceDelayHours)
          ? Math.max(0, item.incidentChoiceDelayHours)
          : 0,
      timePausedOutOfFuel: Math.max(0, item.timePausedOutOfFuel ?? 0),
      timePausedIncident: Math.max(0, item.timePausedIncident ?? 0),
      contributingCauses: Array.isArray(item.contributingCauses) ? item.contributingCauses : [],
    }))
    .slice(0, DELIVERY_SETTLEMENT_HISTORY_MAX);
}

export function findSettlementRecord(
  history: DeliverySettlementRecord[] | undefined,
  deliveryId: string | undefined,
): DeliverySettlementRecord | null {
  if (!deliveryId) {
    return null;
  }
  return history?.find((item) => item.deliveryId === deliveryId) ?? null;
}
