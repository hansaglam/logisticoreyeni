import {
  REPUTATION_EARLY_TRAVEL_RATIO,
  REPUTATION_LATE_MAJOR_RATIO,
  REPUTATION_LATE_MINOR_RATIO,
  REPUTATION_RULES,
} from '../config/reputationRules';
import type { ReputationReason } from '../domain/reputationModel';
import { shouldGrantHighReputationBonus } from './contractTypes';
import type { Contract, Delivery } from '../types/game';

export type DeliveryPunctuality =
  | 'early'
  | 'on-time'
  | 'late-minor'
  | 'late-major'
  | 'failed';

export type DeliveryReputationResult = {
  delta: number;
  reasons: ReputationReason[];
  punctuality: DeliveryPunctuality;
};

export function classifyDeliveryPunctuality(input: {
  actualTravelHours: number;
  deadlineHours: number;
  estimatedTravelHours: number;
  failed?: boolean;
}): DeliveryPunctuality {
  if (input.failed) {
    return 'failed';
  }

  const deadlineHours = Math.max(0.1, input.deadlineHours);
  const actual = Math.max(0, input.actualTravelHours);
  const estimated = Math.max(0.1, input.estimatedTravelHours);

  if (actual > deadlineHours) {
    const latenessRatio = (actual - deadlineHours) / deadlineHours;
    if (latenessRatio <= REPUTATION_LATE_MINOR_RATIO) {
      return 'late-minor';
    }
    return 'late-major';
  }

  if (actual <= estimated * REPUTATION_EARLY_TRAVEL_RATIO) {
    return 'early';
  }

  return 'on-time';
}

export function calculateDeliveryReputationResult(input: {
  contract: Contract;
  delivery: Delivery;
  actualTravelHours: number;
  failed?: boolean;
}): DeliveryReputationResult {
  const punctuality = classifyDeliveryPunctuality({
    actualTravelHours: input.actualTravelHours,
    deadlineHours: input.contract.deadlineHours,
    estimatedTravelHours: input.delivery.travelHours,
    failed: input.failed,
  });

  const reasons: ReputationReason[] = [];
  let delta = 0;

  switch (punctuality) {
    case 'early':
      delta += REPUTATION_RULES.deliveryEarly;
      reasons.push('delivery-early');
      break;
    case 'on-time':
      delta += REPUTATION_RULES.deliveryOnTime;
      reasons.push('delivery-on-time');
      break;
    case 'late-minor':
      delta += REPUTATION_RULES.deliveryLateMinor;
      reasons.push('delivery-late-minor');
      break;
    case 'late-major':
      delta += REPUTATION_RULES.deliveryLateMajor;
      reasons.push('delivery-late-major');
      break;
    case 'failed':
      delta += REPUTATION_RULES.deliveryFailed;
      reasons.push('delivery-failed');
      break;
    default:
      break;
  }

  if (
    !input.failed &&
    punctuality !== 'late-minor' &&
    punctuality !== 'late-major' &&
    shouldGrantHighReputationBonus(input.contract)
  ) {
    delta += REPUTATION_RULES.highRiskDeliverySuccess;
    reasons.push('high-risk-success');
  }

  return { delta, reasons, punctuality };
}

export function deliveryFailureReasonToReputationDelta(reason: import('../types/game').DeliveryFailureReason): {
  delta: number;
  reason: ReputationReason;
  source: 'delivery-failure' | 'contract-cancelled';
} {
  if (reason === 'cancelled') {
    return {
      delta: REPUTATION_RULES.contractCancelled,
      reason: 'contract-cancelled',
      source: 'contract-cancelled',
    };
  }
  return {
    delta: REPUTATION_RULES.deliveryFailed,
    reason: 'delivery-failed',
    source: 'delivery-failure',
  };
}

export function buildDeliverySettlementIdempotencyKey(deliveryId: string): string {
  return `reputation:delivery:${deliveryId}:settlement`;
}

export function buildDeliveryFailureIdempotencyKey(deliveryId: string): string {
  return `reputation:delivery:${deliveryId}:failure`;
}

export function buildOperationReputationIdempotencyKey(
  deliveryId: string,
  eventId: string,
  choiceId: string,
): string {
  return `reputation:operation:${deliveryId}:${eventId}:${choiceId}`;
}
