/**
 * Kiralık araç → iş atama uygunluğu. Tek kaynak: UI ve startDelivery aynı kuralı kullanır.
 *
 * Kural: remainingHours >= estimatedTravelHours + buffer
 * buffer = max(1 saat, estimatedTravelHours * %10)
 */

import { rentalTruckConfig } from '../config/rentalTruck';
import {
  getLeaseExpiresAt,
  isLeasedTruck,
  isRentalReturnPending,
  isRentalTruckReturned,
} from '../simulation/rentalTruckLifecycle';
import type { Truck } from '../types/game';
import { formatGameDuration } from '../utils/formatGameDuration';

export type RentalAssignmentFitStatus =
  | 'not_applicable'
  | 'suitable'
  | 'risky'
  | 'unsuitable';

export interface RentalAssignmentFitResult {
  applicable: boolean;
  canAssign: boolean;
  status: RentalAssignmentFitStatus;
  remainingHours: number;
  estimatedTravelHours: number;
  bufferHours: number;
  requiredHours: number;
  shortageHours: number;
}

export interface EvaluateRentalAssignmentFitInput {
  truck: Truck;
  currentTime: number;
  estimatedTravelHours: number;
}

export function getRentalAssignmentBufferHours(estimatedTravelHours: number): number {
  const eta = sanitizeHours(estimatedTravelHours);
  return Math.max(
    rentalTruckConfig.assignmentBufferMinHours,
    eta * rentalTruckConfig.assignmentBufferRatio,
  );
}

export function getRequiredRentalHours(estimatedTravelHours: number): number {
  const eta = sanitizeHours(estimatedTravelHours);
  return eta + getRentalAssignmentBufferHours(eta);
}

export function getRentalRemainingHours(truck: Truck, currentTime: number): number | null {
  if (!isLeasedTruck(truck)) {
    return null;
  }
  if (isRentalTruckReturned(truck) || isRentalReturnPending(truck) || truck.leaseExpired) {
    return 0;
  }
  const expiresAt = getLeaseExpiresAt(truck);
  if (expiresAt == null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, expiresAt - currentTime);
}

export function evaluateRentalAssignmentFit(
  input: EvaluateRentalAssignmentFitInput,
): RentalAssignmentFitResult {
  const estimatedTravelHours = sanitizeHours(input.estimatedTravelHours);
  const bufferHours = getRentalAssignmentBufferHours(estimatedTravelHours);
  const requiredHours = estimatedTravelHours + bufferHours;
  const remainingOrNull = getRentalRemainingHours(input.truck, input.currentTime);

  if (remainingOrNull == null) {
    return {
      applicable: false,
      canAssign: true,
      status: 'not_applicable',
      remainingHours: Number.POSITIVE_INFINITY,
      estimatedTravelHours,
      bufferHours,
      requiredHours,
      shortageHours: 0,
    };
  }

  const remainingHours = remainingOrNull;
  const shortageHours = Math.max(0, requiredHours - remainingHours);
  const canAssign = remainingHours >= requiredHours;

  let status: RentalAssignmentFitStatus;
  if (!canAssign) {
    status = 'unsuitable';
  } else if (
    remainingHours < requiredHours + bufferHours ||
    remainingHours <= rentalTruckConfig.expiryWarningGameHours
  ) {
    status = 'risky';
  } else {
    status = 'suitable';
  }

  return {
    applicable: true,
    canAssign,
    status,
    remainingHours,
    estimatedTravelHours,
    bufferHours,
    requiredHours,
    shortageHours,
  };
}

export function getRentalFitBadgeLabel(status: RentalAssignmentFitStatus): string {
  switch (status) {
    case 'suitable':
      return 'Uygun';
    case 'risky':
      return 'Riskli';
    case 'unsuitable':
      return 'Uygun değil';
    default:
      return 'Uygun';
  }
}

export function formatRentalHoursLabel(hours: number): string {
  if (!Number.isFinite(hours)) {
    return '—';
  }
  const rounded = Math.round(Math.max(0, hours) * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded} saat`;
  }
  return `${rounded.toFixed(1)} saat`;
}

export function formatRentalAssignmentBlockMessage(fit: RentalAssignmentFitResult): string {
  return [
    'Bu kiralık aracın süresi bu teslimat için yeterli değil.',
    `Kalan süre: ${formatRentalHoursLabel(fit.remainingHours)}`,
    `Tahmini teslimat: ${formatRentalHoursLabel(fit.estimatedTravelHours)}`,
  ].join('\n');
}

export function formatRentalFitSummary(fit: RentalAssignmentFitResult): string {
  const remaining = Number.isFinite(fit.remainingHours)
    ? formatGameDuration(fit.remainingHours)
    : '—';
  return `Kalan kira ${remaining} · Tahmini teslimat ${formatGameDuration(fit.estimatedTravelHours)}`;
}

function sanitizeHours(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}
