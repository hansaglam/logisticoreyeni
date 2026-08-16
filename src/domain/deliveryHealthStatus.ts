/**
 * Active delivery health status for cards / tracking UI.
 */

import type { Delivery, Truck } from '../types/game';
import { isPendingIncidentBlocking } from './deliveryDelayDiagnostics';
import { normalizeTruckFuel } from '../utils/truckFuel';

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
  detailLine: string | null;
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
  const fuelEmpty =
    delivery.pausedReason === 'out-of-fuel' ||
    (delivery.status === 'paused' &&
      input.truck != null &&
      (normalizeTruckFuel(input.truck).currentFuelL ?? 0) <= 1e-6);
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

  const clockContinues = status === 'out_of_fuel' || status === 'incident_pending';

  return {
    status,
    label: getDeliveryHealthLabel(status),
    etaHoursLeft,
    deadlineHoursLeft: Math.max(0, deadlineHoursLeft),
    latenessHours,
    alreadyLate,
    clockContinues,
    detailLine: getDeliveryHealthDetail(status, {
      etaHoursLeft,
      deadlineHoursLeft: Math.max(0, deadlineHoursLeft),
      latenessHours,
    }),
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
    return 'Yakıt bitti — teslimat süresi işlemeye devam ediyor.';
  }
  if (status === 'incident_pending') {
    return 'Teslimat, karar verene kadar ilerlemiyor. Son teslim süresi işlemeye devam ediyor.';
  }
  return null;
}
