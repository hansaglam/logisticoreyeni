/**
 * Active delivery health status for cards / tracking UI.
 */

import type { Delivery, Truck } from '../types/game';
import { isPendingIncidentBlocking } from './deliveryDelayDiagnostics';
import { normalizeTruckFuel } from '../utils/truckFuel';
import { clamp } from '../utils/math';

export type DeliveryHealthStatus =
  | 'on_time'
  | 'deadline_risk'
  | 'late'
  | 'out_of_fuel'
  | 'incident_pending'
  | 'critical';

export interface DeliveryHealthSnapshot {
  status: DeliveryHealthStatus;
  label: string;
  etaHoursLeft: number;
  deadlineHoursLeft: number;
  latenessHours: number;
  alreadyLate: boolean;
  clockContinues: boolean;
  deadlinePaused: boolean;
  detailLine: string | null;
  canonicalFuelL: number | null;
  fuelCapacityL: number | null;
  showOutOfFuelWarning: boolean;
  showLowFuelWarning: boolean;
  showRefuelCta: boolean;
}

const FUEL_EPS = 1e-6;

export function resolveCanonicalAssignedFuel(truck?: Truck | null): {
  currentFuelL: number | null;
  fuelCapacityL: number | null;
} {
  if (!truck) {
    return { currentFuelL: null, fuelCapacityL: null };
  }
  const normalized = normalizeTruckFuel(truck);
  return {
    currentFuelL: normalized.currentFuelL ?? 0,
    fuelCapacityL: normalized.fuelTankCapacityL ?? 0,
  };
}

function remainingFuelRequiredL(delivery: Delivery): number {
  return Math.max(0, delivery.fuelLitersTotal ?? 0) * (1 - clamp(delivery.progress, 0, 1));
}

export function resolveDeliveryHealth(input: {
  delivery: Delivery;
  currentTime: number;
  truck?: Truck | null;
}): DeliveryHealthSnapshot {
  const { delivery, currentTime } = input;
  const etaHoursLeft = Math.max(0, delivery.estimatedArrivalTime - currentTime);
  const deadlineHoursLeft = delivery.deadlineTime - currentTime;
  const alreadyLate = currentTime > delivery.deadlineTime;
  const latenessHours = alreadyLate ? currentTime - delivery.deadlineTime : 0;
  const canonical = resolveCanonicalAssignedFuel(input.truck);
  const currentFuelL = canonical.currentFuelL;
  // Out-of-fuel UI follows the live tank. Stale pausedReason / out_of_fuel
  // flags must not show YAKITSIZ while the assigned vehicle still has fuel.
  const fuelEmpty = currentFuelL != null && currentFuelL <= FUEL_EPS;
  const remainingRequiredL = remainingFuelRequiredL(delivery);
  const insufficientForRoute =
    currentFuelL != null &&
    currentFuelL > FUEL_EPS &&
    remainingRequiredL > FUEL_EPS &&
    currentFuelL + FUEL_EPS < remainingRequiredL;
  const incidentPending = isPendingIncidentBlocking(delivery);
  const remainingProgress = Math.max(0, 1 - delivery.progress);
  const remainingTravelHours = remainingProgress * Math.max(delivery.travelHours, 0.1);
  const projectedArrival = currentTime + remainingTravelHours;
  const projectedLate = projectedArrival > delivery.deadlineTime + 1e-6;
  const criticallyLate =
    alreadyLate && latenessHours >= Math.max(1, (delivery.deadlineTime - delivery.startedAt) * 0.3);

  let status: DeliveryHealthStatus = 'on_time';
  if (fuelEmpty && remainingProgress > 0) {
    status = 'out_of_fuel';
  } else if (incidentPending) {
    status = 'incident_pending';
  } else if (criticallyLate || (alreadyLate && remainingProgress > 0.35)) {
    status = 'critical';
  } else if (alreadyLate) {
    status = 'late';
  } else if (projectedLate || delivery.estimatedArrivalTime > delivery.deadlineTime) {
    status = 'deadline_risk';
  }

  const clockContinues = status !== 'out_of_fuel' && status !== 'incident_pending';
  const deadlinePaused = !clockContinues;

  const showOutOfFuelWarning = fuelEmpty && remainingProgress > 0;
  const showLowFuelWarning = !showOutOfFuelWarning && insufficientForRoute && remainingProgress > 0;

  return {
    status,
    label:
      showLowFuelWarning && status === 'on_time'
        ? 'YAKIT DÜŞÜK'
        : getDeliveryHealthLabel(status),
    etaHoursLeft,
    deadlineHoursLeft: Math.max(0, deadlineHoursLeft),
    latenessHours,
    alreadyLate,
    clockContinues,
    deadlinePaused,
    detailLine:
      status === 'out_of_fuel' || status === 'incident_pending'
        ? getDeliveryHealthDetail(status, {
            etaHoursLeft,
            deadlineHoursLeft: Math.max(0, deadlineHoursLeft),
            latenessHours,
          })
        : showLowFuelWarning
          ? 'Yakıt düşük — mevcut yakıt kalan rota için yeterli değil.'
          : getDeliveryHealthDetail(status, {
              etaHoursLeft,
              deadlineHoursLeft: Math.max(0, deadlineHoursLeft),
              latenessHours,
            }),
    canonicalFuelL: currentFuelL,
    fuelCapacityL: canonical.fuelCapacityL,
    showOutOfFuelWarning,
    showLowFuelWarning,
    showRefuelCta: showOutOfFuelWarning || showLowFuelWarning,
  };
}

export function getDeliveryHealthLabel(status: DeliveryHealthStatus): string {
  switch (status) {
    case 'on_time':
      return 'ZAMANINDA';
    case 'deadline_risk':
      return 'GEÇ KALMA RİSKİ';
    case 'late':
      return 'GECİKİYOR';
    case 'out_of_fuel':
      return 'YAKITSIZ';
    case 'incident_pending':
      return 'OLAY BEKLİYOR';
    case 'critical':
      return 'KRİTİK';
    default:
      return 'ZAMANINDA';
  }
}

function getDeliveryHealthDetail(
  status: DeliveryHealthStatus,
  times: { etaHoursLeft: number; deadlineHoursLeft: number; latenessHours: number },
): string | null {
  if (status === 'out_of_fuel') {
    return 'Yakıt bitti — teslimat durdu. Son teslim süresi de durdu; yakıt alınca devam eder.';
  }
  if (status === 'incident_pending') {
    return 'Operasyon kararı bekleniyor — teslimat ve son teslim süresi durdu. Karar verince devam eder.';
  }
  return null;
}
