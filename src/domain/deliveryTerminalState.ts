/**
 * Offline/online delivery terminal rules.
 * Closing the app must never be more punitive than equivalent online ticks.
 */

import { getGameHoursPerTick } from '../config/balance';
import { isInternalBuildProfile } from '../config/buildProfile';
import type { Delivery, DeliveryFailureReason } from '../types/game';
import type { DeliverySettlementRecord } from './deliveryDelayDiagnostics';
import type { DeliveryPunctuality } from '../simulation/reputationSettlement';
import { deliveryFailureReasonToReputationDelta } from '../simulation/reputationSettlement';

/** Larger than two max-speed game-loop ticks — catch-up / debug skip, not a live tick. */
export const RANDOM_FAILURE_MAX_TICK_HOURS =
  Math.max(getGameHoursPerTick(1), getGameHoursPerTick(8)) * 2;

export type DeliveryTerminalStatus = 'completed' | 'failed' | 'cancelled';

export function shouldAllowRandomDeliveryFailures(input: {
  hoursPassed: number;
  offline: boolean;
  progress: number;
}): boolean {
  if (input.offline) {
    return false;
  }
  if (input.progress >= 1 - 1e-6) {
    return false;
  }
  if (!(input.hoursPassed > 0) || input.hoursPassed > RANDOM_FAILURE_MAX_TICK_HOURS) {
    return false;
  }
  return true;
}

export function clearStaleActiveFailureReason<T extends Pick<Delivery, 'status' | 'failureReason'>>(
  delivery: T,
): T {
  if (delivery.status === 'failed') {
    return delivery;
  }
  if (delivery.failureReason == null) {
    return delivery;
  }
  return { ...delivery, failureReason: undefined };
}

export function resolveTerminalStatus(input: {
  punctuality: DeliveryPunctuality | 'cancelled';
  failureReason?: DeliveryFailureReason;
}): DeliveryTerminalStatus {
  if (input.failureReason === 'cancelled' || input.punctuality === 'cancelled') {
    return 'cancelled';
  }
  if (
    input.punctuality === 'early' ||
    input.punctuality === 'on-time' ||
    input.punctuality === 'late-minor' ||
    input.punctuality === 'late-major'
  ) {
    return 'completed';
  }
  if (
    input.failureReason === 'breakdown' ||
    input.failureReason === 'accident' ||
    input.failureReason === 'too_late' ||
    input.punctuality === 'failed'
  ) {
    return 'failed';
  }
  return 'completed';
}

export function sanitizeDeliverySettlementRecord(
  record: DeliverySettlementRecord,
): DeliverySettlementRecord {
  const terminalStatus = resolveTerminalStatus({
    punctuality: record.punctualityResult,
    failureReason: record.failureReason,
  });

  if (terminalStatus === 'completed') {
    if (record.failureReason) {
      logOfflineDeliveryInvariantError({
        deliveryId: record.deliveryId,
        issue: 'completed-with-failure-reason',
        failureReason: record.failureReason,
        punctuality: record.punctualityResult,
      });
    }
    return {
      ...record,
      failureReason: undefined,
      terminalStatus: 'completed',
      primaryCause:
        record.punctualityResult === 'late-minor' || record.punctualityResult === 'late-major'
          ? record.primaryCause
          : record.primaryCause === 'BREAKDOWN' || record.primaryCause === 'ACCIDENT'
            ? 'ON_TIME'
            : record.primaryCause,
      contributingCauses: record.contributingCauses.filter(
        (cause) => cause !== 'BREAKDOWN' && cause !== 'ACCIDENT',
      ),
    };
  }

  return {
    ...record,
    terminalStatus,
  };
}

export function expectedReputationDeltaForFailure(
  reason: DeliveryFailureReason,
): number {
  return deliveryFailureReasonToReputationDelta(reason).delta;
}

export function logOfflineDeliveryBefore(payload: Record<string, unknown>): void {
  logOfflineDelivery('OFFLINE_DELIVERY_BEFORE', payload);
}

export function logOfflineDeliverySettlement(payload: Record<string, unknown>): void {
  logOfflineDelivery('OFFLINE_DELIVERY_SETTLEMENT', payload);
}

export function logOfflineDeliveryInvariantError(payload: Record<string, unknown>): void {
  logOfflineDelivery('OFFLINE_DELIVERY_INVARIANT_ERROR', payload);
}

function logOfflineDelivery(tag: string, payload: Record<string, unknown>): void {
  const enabled =
    (typeof __DEV__ !== 'undefined' && __DEV__) ||
    isInternalBuildProfile() ||
    process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true';
  if (!enabled) {
    return;
  }
  console.log(`[${tag}] ${JSON.stringify(payload)}`);
}
